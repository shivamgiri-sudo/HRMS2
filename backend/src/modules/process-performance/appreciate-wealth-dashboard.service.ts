import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Appreciate Wealth dashboards (company key `appreciate_health`), built ONLY
 * from the five uploader tables in db_masmis: aw_billing, aw_out, aw_inbound,
 * aw_new_cdr, aw_mandate. Read-only: every statement here is a SELECT.
 *
 * ------------------------------------------------------------------------
 * WHAT THE TABLES ARE (verified against the live data, see Data Health tab)
 * ------------------------------------------------------------------------
 *  aw_billing  one row per agent per day ("agent-day report"): dialer call
 *              counts, talk/wrap/idle/pause/login times, AUX codes, login
 *              status, LOB (Inbound / Onboarded / VKYC) and billing_type.
 *  aw_out      one row per agent per day for the Outbound (Onboarded) team,
 *              same call/time columns as aw_billing PLUS sales outcomes
 *              (LRS / Trade / Mutual Fund count + amount + target).
 *  aw_inbound  call-level CDR of the Customer_Support line (Inbound calls,
 *              plus agents' Manual callbacks and the Autocallback dialer).
 *  aw_new_cdr  call-level CDR of the Onboarding team (Progressive + Manual
 *              outbound dialer legs, plus the Onboarded inbound DIDs).
 *  aw_mandate  monthly commercial config per billing_type: mandate (FTEs),
 *              per_fe_rate (Rs per FTE), login_hours_per_fte.
 *
 * ------------------------------------------------------------------------
 * DATA TRAPS HANDLED (every one is also surfaced in the Data Health tab)
 * ------------------------------------------------------------------------
 *  1. Mixed date text. call_date / month arrive as "15-Sep-26" (text) OR an
 *     Excel serial ("46270" = 05-Sep-2026). One SQL expression (SQL_DATE)
 *     turns both into a DATE; rows that parse to NULL are counted, never
 *     silently dropped from the health numbers.
 *  2. Mixed time text. Durations arrive as "H:MM:SS", an Excel day fraction
 *     ("0.1022" = 2:27:11) or plain seconds ("32426"). secs() normalises all
 *     three (contains ":" -> H:M:S; number < 1 -> day fraction x 86400;
 *     otherwise seconds). A duration of exactly 0..1 second written as
 *     seconds is therefore treated as a day fraction (never occurs: calls
 *     are >= 1 s and the values in scope are 0 or well above 1).
 *  3. Re-uploads. The same business record was uploaded up to 4 times (once
 *     per file/format). Records are de-duplicated, never double counted:
 *       aw_billing  key = (date, agent_id)               latest id wins
 *       aw_out      key = (date, agent_id)               a "complete" row (has
 *                   uuid + targets) beats the partial template; then latest id
 *       aw_inbound / aw_new_cdr  key = (call_id, agent_id, start time in s)
 *                   the row with more populated fields wins; then latest id.
 *                   call_id alone is NOT unique: the dialer writes one row
 *                   per agent leg, so the same call_id legitimately repeats
 *                   with different agents (kept as separate legs).
 *       aw_mandate  key = (month, billing_type)          latest id wins
 *  4. Conflicting re-uploads (same agent-day, different sales values) are
 *     listed in Data Health; the complete-template row is the one used.
 *
 * ------------------------------------------------------------------------
 * DEFINITIONS (all sums are over de-duplicated rows in the chosen range)
 * ------------------------------------------------------------------------
 *  Segment       aw_billing.lob2 -> Inbound / Outbound / VKYC. LOB "Onboarded"
 *                is the Outbound team. VKYC agents make no dialer calls
 *                (total_calls = 0, their time sits in the video_kyc_aux code),
 *                so every CALL metric below is computed over Inbound +
 *                Outbound rows only; agent-days, login and late-login include
 *                VKYC.
 *  Agent-days    count of de-duplicated aw_billing rows.
 *  Calls / Connected   sum(total_calls) / sum(connected_calls).
 *  Connect %     connected / calls.
 *  ACHT (s)      (talk + wrap-up) / connected calls. Recomputed from totals,
 *                never an average of the per-row acht (verified equal to the
 *                stored acht on 378/378 rows with connected calls).
 *  Occupancy %   (talk + wrap) / (talk + wrap + idle). Net occupancy % =
 *                (talk + wrap) / net login. Both formulas reproduce the
 *                occupancy columns aw_out itself carries (aw_billing's own
 *                occupancy columns are blank, so they are derived).
 *  Net login     net_login_hrs. Verified: login - net login = bio + bio_break
 *                + lunch + tea + tea_break on 474/474 rows, so "Break time" =
 *                login - net login.
 *  Late login %  rows with late_login_status = YES / agent-days.
 *                (ontime_login_count is NOT used: it is 1 even on late rows.)
 *  Attainment %  Outbound only: sum(total_calls) / sum(calling_target).
 *  Sales         aw_out lrs / trade / mf  count + amount. Target attainment =
 *                sum(amount) / sum(target) over agent-days whose target > 0
 *                (target 0 or blank = no target set, excluded from BOTH sides
 *                of the ratio, still included in the amount totals). The
 *                target columns are compared with the amount columns: their
 *                magnitudes match (Rs 1,00,000 daily), the column itself is
 *                not documented.
 *  Inbound       aw_inbound.call_type = Inbound. Offered = distinct call_id;
 *                Answered = a leg with status Answered; Unanswered with no
 *                agent = never reached an agent. Speed-of-answer / queue time
 *                exist only on the older file layout, so they are averaged
 *                over the calls that carry them and the count is shown.
 *  Dialer        aw_new_cdr legs; connect % = Answered legs / legs.
 *                Disposition is shown as uploaded (Yes__/No__ families are
 *                NOT interpreted: "Yes__Lost__RNR after 8 Attempts" is
 *                stored on Unanswered legs, so Yes__ is not "customer
 *                reached").
 *  Contract value  aw_mandate mandate x per_fe_rate (Rs per month).
 *  Mandated hours  mandate x login_hours_per_fte ("192:00:00" = 192 h).
 *  FTE-equivalent  delivered net login hours / login_hours_per_fte.
 *
 * ------------------------------------------------------------------------
 * DELIBERATELY NOT COMPUTED (cannot be derived from the data)
 * ------------------------------------------------------------------------
 *  - Billed / invoiced revenue: the billing rule (fixed vs pro-rata, caps,
 *    holidays) is not in any table; only mandate x rate and delivered hours
 *    are shown, never a "billable amount".
 *  - actual_mandays, occupancy_pct, net_occupancy_pct (aw_billing): 100 %
 *    blank. Occupancy is derived instead (formula above).
 *  - actual_versant / billing_in_number: one constant per billing_type, no
 *    documented meaning.
 *  - SLA % / abandon % / service level: no SLA threshold or queue-entry data
 *    on the new file layout.
 *  - Sales conversion % on leads: no lead / allocation table exists.
 *  - Client-side revenue for Onboarding / MF beyond aw_out amounts.
 */

/* ------------------------------ constants -------------------------------- */

type Row = RowDataPacket;
const num = (v: unknown): number => {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  const s = String(v ?? "").replace(/,/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;
const p2 = (n: number): string => String(n).padStart(2, "0");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MAX_RANGE_DAYS = 366;
const MAX_DAILY_COLUMNS = 62;
const RECENT_CALLS = 150;

export const AW_SQL_DATE = (c: string): string =>
  `(CASE WHEN ${c} REGEXP '^[0-9]{5}$' THEN DATE_ADD('1899-12-30', INTERVAL CAST(${c} AS UNSIGNED) DAY) ` +
  `WHEN ${c} REGEXP '^[0-9]{1,2}-[A-Za-z]{3}-[0-9]{2}$' THEN STR_TO_DATE(${c}, '%e-%b-%y') ELSE NULL END)`;
const DATE_EXPR = AW_SQL_DATE("call_date");

/** "H:MM:SS" | Excel day-fraction | seconds  ->  whole seconds (null when blank). */
export function secs(v: unknown): number | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  if (s.includes(":")) {
    const parts = s.split(":").map((x) => Number(x));
    if (parts.some((x) => !Number.isFinite(x))) return null;
    let total = 0;
    for (const p of parts) total = total * 60 + p;
    if (parts.length === 2) total *= 60; // "M:SS" never occurs; treat "H:MM" as hours:minutes
    return Math.round(total);
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n < 1 ? Math.round(n * 86400) : Math.round(n);
}
const secsOr0 = (v: unknown): number => secs(v) ?? 0;

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`;
}
function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
function todayLocal(): string {
  const n = new Date();
  return `${n.getFullYear()}-${p2(n.getMonth() + 1)}-${p2(n.getDate())}`;
}
export function resolveRange(fromInput: string, toInput: string): { from: string; to: string } {
  const today = todayLocal();
  let from = DATE_RE.test(fromInput) ? fromInput : `${today.slice(0, 7)}-01`;
  let to = DATE_RE.test(toInput) ? toInput : today;
  if (from > to) [from, to] = [to, from];
  if (addDays(from, MAX_RANGE_DAYS) < to) to = addDays(from, MAX_RANGE_DAYS);
  return { from, to };
}
const dayLabel = (iso: string): string => `${Number(iso.slice(8, 10))}-${MON[Number(iso.slice(5, 7)) - 1]}`;
const weekNo = (iso: string): number => Math.min(5, Math.ceil(Number(iso.slice(8, 10)) / 7));
const daysInMonth = (ym: string): number => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const blankToLabel = (v: unknown, label = "(blank)"): string => {
  const s = String(v ?? "").trim();
  return s === "" || s.toLowerCase() === "null" ? label : s;
};

/* ------------------------------ normalised rows --------------------------- */

export const AUX_CODES: Array<{ key: string; label: string }> = [
  { key: "bio", label: "Bio" }, { key: "bio_break", label: "Bio break" }, { key: "lunch", label: "Lunch" },
  { key: "tea", label: "Tea" }, { key: "tea_break", label: "Tea break" }, { key: "inbound_aux", label: "Inbound AUX" },
  { key: "meeting_aux", label: "Meeting AUX" }, { key: "meeting", label: "Meeting" }, { key: "ticket_work", label: "Ticket work" },
  { key: "whatsapp_chat", label: "WhatsApp chat" }, { key: "technical_cc", label: "Technical (CC)" },
  { key: "technical_dialer", label: "Technical (dialer)" }, { key: "email_work", label: "Email work" },
  { key: "training", label: "Training" }, { key: "sip_disconnected", label: "SIP disconnected" },
  { key: "sip_unregistered", label: "SIP unregistered" }, { key: "technical_issue_dialer", label: "Tech issue (dialer)" },
  { key: "technical_issue_cc", label: "Tech issue (CC)" }, { key: "change_mode", label: "Change mode" },
  { key: "technical_issue_crm", label: "Tech issue (CRM)" }, { key: "qa_feedback", label: "QA feedback" },
  { key: "video_kyc_aux", label: "Video KYC" },
];
const BREAK_KEYS = ["bio", "bio_break", "lunch", "tea", "tea_break"];

export interface BillRec {
  id: number; date: string; agentId: string; agentName: string; empId: string;
  segment: string; lob: string; billingType: string;
  calls: number; connected: number; notConnected: number;
  talkS: number; wrapS: number; pauseS: number; idleS: number; loginS: number; netS: number;
  late: boolean; target: number; breakExceed: number; shift: string; batch: string;
  aux: Record<string, number>;
}
interface OutRec {
  id: number; date: string; agentId: string; agentName: string; empId: string; complete: boolean; batch: string;
  lrsC: number; lrsA: number; trC: number; trA: number; mfC: number; mfA: number;
  lrsT: number; trT: number; mfT: number; calls: number; connected: number;
}
interface CallRec {
  id: number; source: "inbound" | "cdr"; callId: string; date: string; hour: number | null;
  callType: string; campaign: string; skill: string; status: string; answered: boolean;
  agent: string; agentId: string; disposition: string; talkS: number; holdS: number; wrapS: number; handlingS: number;
  queueS: number | null; ttaS: number | null; hangupBy: string; callerNo: string; startS: number | null; batch: string;
}
interface MandateRec {
  id: number; month: string; monthRaw: string; billingType: string; mandate: number; rate: number;
  hoursPerFte: number | null; hoursRaw: string; batch: string; insertedAt: string; superseded: boolean;
}

const BILL_COLS = [
  "id", "call_date", "agent_id", "agent_name", "emp_id", "lob", "lob2", "billing_type", "total_calls", "connected_calls",
  "not_connected_calls", "total_talk_time", "total_wrapup_time", "total_pause_time", "total_idle_time", "total_login_time",
  "net_login_hrs", "late_login_status", "calling_target", "break_exceed_count", "shift_time", "upload_batch_id",
  ...AUX_CODES.map((a) => a.key),
];

async function loadBilling(from: string, to: string): Promise<{ rows: BillRec[]; raw: number; dropped: number; badDates: number }> {
  const [rs] = await db.execute<Row[]>(
    `SELECT ${BILL_COLS.map((c) => `\`${c}\``).join(",")}, DATE_FORMAT(${DATE_EXPR}, '%Y-%m-%d') AS d
       FROM db_masmis.aw_billing WHERE ${DATE_EXPR} BETWEEN ? AND ?`,
    [from, to],
  );
  const best = new Map<string, BillRec>();
  for (const r of rs) {
    const aux: Record<string, number> = {};
    for (const a of AUX_CODES) aux[a.key] = secsOr0(r[a.key]);
    const rec: BillRec = {
      id: Number(r.id), date: String(r.d), agentId: String(r.agent_id), agentName: blankToLabel(r.agent_name, String(r.agent_id)),
      empId: String(r.emp_id ?? ""), segment: blankToLabel(r.lob2 || r.lob, "Unknown"), lob: String(r.lob ?? ""),
      billingType: blankToLabel(r.billing_type, "Unknown"),
      calls: num(r.total_calls), connected: num(r.connected_calls), notConnected: num(r.not_connected_calls),
      talkS: secsOr0(r.total_talk_time), wrapS: secsOr0(r.total_wrapup_time), pauseS: secsOr0(r.total_pause_time),
      idleS: secsOr0(r.total_idle_time), loginS: secsOr0(r.total_login_time), netS: secsOr0(r.net_login_hrs),
      late: String(r.late_login_status ?? "").trim().toUpperCase() === "YES", target: num(r.calling_target),
      breakExceed: num(r.break_exceed_count), shift: String(r.shift_time ?? ""), batch: String(r.upload_batch_id ?? ""), aux,
    };
    const k = `${rec.date}|${rec.agentId}`;
    const cur = best.get(k);
    if (!cur || rec.id > cur.id) best.set(k, rec);
  }
  return { rows: [...best.values()], raw: rs.length, dropped: rs.length - best.size, badDates: 0 };
}

const OUT_COLS = [
  "id", "call_date", "agent_id", "agent_name", "emp_id", "uuid", "upload_batch_id", "total_calls", "connected_calls",
  "lrs_count", "lrs_amount", "trade_count", "trade_amount", "mf_count", "mf_amount", "lrs_target", "trade_target", "mf_target",
];
async function loadOut(from: string, to: string): Promise<{
  rows: OutRec[]; raw: number; dropped: number;
  conflicts: Array<{ date: string; agentId: string; agentName: string; field: string; values: string }>;
}> {
  const [rs] = await db.execute<Row[]>(
    `SELECT ${OUT_COLS.map((c) => `\`${c}\``).join(",")}, DATE_FORMAT(${DATE_EXPR}, '%Y-%m-%d') AS d
       FROM db_masmis.aw_out WHERE ${DATE_EXPR} BETWEEN ? AND ?`,
    [from, to],
  );
  const groups = new Map<string, OutRec[]>();
  for (const r of rs) {
    const rec: OutRec = {
      id: Number(r.id), date: String(r.d), agentId: String(r.agent_id), agentName: blankToLabel(r.agent_name, String(r.agent_id)),
      empId: String(r.emp_id ?? ""), complete: r.uuid !== null && String(r.uuid).trim() !== "", batch: String(r.upload_batch_id ?? ""),
      lrsC: num(r.lrs_count), lrsA: num(r.lrs_amount), trC: num(r.trade_count), trA: num(r.trade_amount),
      mfC: num(r.mf_count), mfA: num(r.mf_amount), lrsT: num(r.lrs_target), trT: num(r.trade_target), mfT: num(r.mf_target),
      calls: num(r.total_calls), connected: num(r.connected_calls),
    };
    const k = `${rec.date}|${rec.agentId}`;
    const arr = groups.get(k) ?? [];
    arr.push(rec);
    groups.set(k, arr);
  }
  const rows: OutRec[] = [];
  const conflicts: Array<{ date: string; agentId: string; agentName: string; field: string; values: string }> = [];
  const FIELDS: Array<[keyof OutRec, string]> = [
    ["calls", "Total calls"], ["connected", "Connected calls"], ["lrsC", "LRS count"], ["lrsA", "LRS amount"],
    ["trC", "Trade count"], ["trA", "Trade amount"], ["mfC", "MF count"], ["mfA", "MF amount"],
  ];
  for (const arr of groups.values()) {
    arr.sort((a, b) => Number(b.complete) - Number(a.complete) || b.id - a.id);
    rows.push(arr[0]);
    if (arr.length > 1) {
      for (const [f, label] of FIELDS) {
        const vals = [...new Set(arr.map((x) => Number(x[f])))];
        if (vals.length > 1) conflicts.push({ date: arr[0].date, agentId: arr[0].agentId, agentName: arr[0].agentName, field: label, values: vals.join(" vs ") });
      }
    }
  }
  return { rows, raw: rs.length, dropped: rs.length - rows.length, conflicts };
}

const CALL_COLS = [
  "id", "call_id", "call_type", "campaign", "skill", "status", "agent", "agent_id", "disposition", "talk_time", "hold_time",
  "wrapup_duration", "handling_time", "time_to_answer", "hangup_by", "caller_no", "start_time", "upload_batch_id", "call_flow",
];
async function loadCalls(source: "inbound" | "cdr", from: string, to: string): Promise<{ rows: CallRec[]; raw: number; dropped: number }> {
  const table = source === "inbound" ? "aw_inbound" : "aw_new_cdr";
  const extra = source === "inbound" ? ", `queue_time`" : "";
  const [rs] = await db.execute<Row[]>(
    `SELECT ${CALL_COLS.map((c) => `\`${c}\``).join(",")}${extra}, DATE_FORMAT(${DATE_EXPR}, '%Y-%m-%d') AS d
       FROM db_masmis.${table} WHERE ${DATE_EXPR} BETWEEN ? AND ?`,
    [from, to],
  );
  const best = new Map<string, { rec: CallRec; rich: number }>();
  for (const r of rs) {
    const startS = secs(r.start_time);
    const status = String(r.status ?? "").trim();
    const rec: CallRec = {
      id: Number(r.id), source, callId: String(r.call_id), date: String(r.d), hour: startS === null ? null : Math.floor(startS / 3600) % 24,
      callType: blankToLabel(r.call_type, "Unknown"), campaign: blankToLabel(r.campaign, "Unknown"), skill: blankToLabel(r.skill, "(none)"),
      status: status || "Unknown", answered: status.toLowerCase() === "answered",
      agent: blankToLabel(r.agent, "(no agent)"), agentId: String(r.agent_id ?? ""), disposition: blankToLabel(r.disposition),
      talkS: secsOr0(r.talk_time), holdS: secsOr0(r.hold_time), wrapS: secsOr0(r.wrapup_duration), handlingS: secsOr0(r.handling_time),
      queueS: source === "inbound" ? secs(r.queue_time) : null, ttaS: secs(r.time_to_answer),
      hangupBy: String(r.hangup_by ?? "").trim(), callerNo: String(r.caller_no ?? ""), startS, batch: String(r.upload_batch_id ?? ""),
    };
    const rich = [rec.queueS, rec.ttaS, rec.hangupBy || null, r.call_flow ? 1 : null, r.skill ? 1 : null].filter((x) => x !== null).length;
    const k = `${rec.callId}|${rec.agentId}|${startS ?? ""}`;
    const cur = best.get(k);
    if (!cur || rich > cur.rich || (rich === cur.rich && rec.id > cur.rec.id)) best.set(k, { rec, rich });
  }
  const rows = [...best.values()].map((x) => x.rec);
  return { rows, raw: rs.length, dropped: rs.length - rows.length };
}

/** "Sep-26" | "46266" | "46266.0" -> "2026-09". */
function mandateMonthKey(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{5}(\.0+)?$/.test(s)) {
    const t = new Date(Date.UTC(1899, 11, 30 + Number(s.split(".")[0])));
    return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}`;
  }
  const m = s.match(/^([A-Za-z]{3})[-\s](\d{2})$/);
  if (m) {
    const mi = MON.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
    if (mi >= 0) return `20${m[2]}-${p2(mi + 1)}`;
  }
  return null;
}
/** "192:00:00" -> 192 (hours). A bare number is hours PER DAY, not comparable -> null. */
function mandateHours(raw: string): number | null {
  const s = raw.trim();
  if (!s.includes(":")) return null;
  const sec = secs(s);
  return sec === null ? null : sec / 3600;
}
async function loadMandate(): Promise<MandateRec[]> {
  const [rs] = await db.execute<Row[]>(
    `SELECT id, billing_type, mandate, per_fe_rate, login_hours_per_fte, month, upload_batch_id, inserted_at
       FROM db_masmis.aw_mandate ORDER BY id`,
  );
  const all: MandateRec[] = [];
  for (const r of rs) {
    const month = mandateMonthKey(String(r.month ?? ""));
    if (!month) continue;
    all.push({
      id: Number(r.id), month, monthRaw: String(r.month ?? ""), billingType: blankToLabel(r.billing_type, "Unknown"),
      mandate: num(r.mandate), rate: num(r.per_fe_rate), hoursPerFte: mandateHours(String(r.login_hours_per_fte ?? "")),
      hoursRaw: String(r.login_hours_per_fte ?? ""), batch: String(r.upload_batch_id ?? ""), insertedAt: String(r.inserted_at ?? ""), superseded: false,
    });
  }
  const latest = new Map<string, MandateRec>();
  for (const m of all) {
    const k = `${m.month}|${m.billingType}`;
    const cur = latest.get(k);
    if (!cur || m.id > cur.id) latest.set(k, m);
  }
  for (const m of all) m.superseded = latest.get(`${m.month}|${m.billingType}`) !== m;
  return all;
}

/* -------------------------- period columns & grids ------------------------ */

export interface PeriodColumn { key: string; label: string; kind: "total" | "week" | "day"; from: string; to: string }
type Fmt = "count" | "pct" | "hrs" | "secs" | "inr" | "dec";
export interface GridRow { label: string; fmt: Fmt; values: Array<number | null>; bold?: boolean }
/** `drill` tells the UI which detail drawer a row label opens: "agent" | "billing" | "group:<inbound|cdr>:<dim>" | "day" (columns only). */
export interface Grid { id: string; slide: string; title: string; rows: GridRow[]; note?: string; drill?: string }
const GRID_DRILL: Record<string, string> = {
  bill_days_seg: "billing", bill_calls_seg: "billing", bill_conn_seg: "billing", bill_connpct_seg: "billing", bill_net_seg: "billing",
  bill_days_type: "billing", bill_net_type: "billing", bill_calls_type: "billing", bill_late_type: "billing",
  in_type: "group:inbound:callType", in_type_ans: "group:inbound:callType", in_campaign: "group:inbound:campaign", in_dispo: "group:inbound:disposition",
  in_agent: "group:inbound:agent", in_agent_ans: "group:inbound:agent", in_hour: "group:inbound:hour",
  cdr_campaign: "group:cdr:campaign", cdr_campaign_ans: "group:cdr:campaign", cdr_campaign_pct: "group:cdr:campaign", cdr_cat: "group:cdr:category",
  cdr_agent: "group:cdr:agent", cdr_agent_ans: "group:cdr:agent", cdr_hour: "group:cdr:hour",
  sales_lrs_agent: "agent", sales_tr_agent: "agent", sales_mf_agent: "agent", sales_total_agent: "agent", sales_count_agent: "agent",
  agent_days: "agent", agent_calls: "agent", agent_conn: "agent", agent_connpct: "agent", agent_net: "agent", agent_late: "agent",
};

function buildColumns(from: string, to: string): { cols: PeriodColumn[]; byDate: Map<string, number[]>; dailyOmitted: boolean } {
  const days = eachDay(from, to);
  const months = [...new Set(days.map((d) => d.slice(0, 7)))];
  const multi = months.length > 1;
  const cols: PeriodColumn[] = [{ key: "total", label: "Value", kind: "total", from, to }];
  const weeks = new Map<string, PeriodColumn>();
  for (const d of days) {
    const key = `${d.slice(0, 7)}-W${weekNo(d)}`;
    const cur = weeks.get(key);
    if (!cur) weeks.set(key, { key, label: multi ? `${MON[Number(d.slice(5, 7)) - 1]} W-${weekNo(d)}` : `W-${weekNo(d)}`, kind: "week", from: d, to: d });
    else cur.to = d;
  }
  cols.push(...weeks.values());
  const dailyOmitted = days.length > MAX_DAILY_COLUMNS;
  if (!dailyOmitted) for (const d of days) cols.push({ key: d, label: dayLabel(d), kind: "day", from: d, to: d });
  const byDate = new Map<string, number[]>();
  cols.forEach((c, i) => {
    for (const d of eachDay(c.from, c.to)) {
      const arr = byDate.get(d) ?? [];
      arr.push(i);
      byDate.set(d, arr);
    }
  });
  return { cols, byDate, dailyOmitted };
}

type Bag = Record<string, number>;
type Cols = ReturnType<typeof buildColumns>;

function bagCols<T>(recs: T[], dateOf: (r: T) => string, cols: Cols, vec: (r: T) => Bag): Bag[] {
  const out: Bag[] = cols.cols.map(() => ({}));
  for (const r of recs) {
    const idxs = cols.byDate.get(dateOf(r));
    if (!idxs) continue;
    const v = vec(r);
    for (const i of idxs) for (const k of Object.keys(v)) out[i][k] = (out[i][k] ?? 0) + v[k];
  }
  return out;
}
interface MetricDef { label: string; fmt: Fmt; f: (b: Bag) => number | null; bold?: boolean }
function metricRows(bags: Bag[], defs: MetricDef[]): GridRow[] {
  return defs.map((d) => ({
    label: d.label, fmt: d.fmt, bold: d.bold,
    values: bags.map((b) => { const v = d.f(b); return v === null ? null : round2(v); }),
  }));
}
const g = (b: Bag, k: string): number => b[k] ?? 0;
const ratio = (n: number, d: number, mult = 1): number | null => (d > 0 ? (n / d) * mult : null);

/** rows = distinct keys (top `maxRows` by total, rest folded into "All others"), sum of `measure`. */
function sumGrid<T>(
  id: string, slide: string, title: string, fmt: Fmt, recs: T[], cols: Cols,
  dateOf: (r: T) => string, rowKey: (r: T) => string, measure: (r: T) => number,
  opts: { maxRows?: number; divisor?: number; totalRow?: boolean; note?: string; order?: string[] } = {},
): Grid {
  const map = new Map<string, number[]>();
  for (const r of recs) {
    const idxs = cols.byDate.get(dateOf(r));
    if (!idxs) continue;
    const k = rowKey(r);
    const arr = map.get(k) ?? new Array<number>(cols.cols.length).fill(0);
    const m = measure(r);
    for (const i of idxs) arr[i] += m;
    map.set(k, arr);
  }
  let entries = [...map.entries()];
  if (opts.order) entries.sort((a, b) => (opts.order!.indexOf(a[0]) + 1 || 99) - (opts.order!.indexOf(b[0]) + 1 || 99));
  else entries.sort((a, b) => b[1][0] - a[1][0] || a[0].localeCompare(b[0]));
  const maxRows = opts.maxRows ?? 30;
  if (entries.length > maxRows) {
    const rest = entries.slice(maxRows - 1);
    const folded = new Array<number>(cols.cols.length).fill(0);
    for (const [, arr] of rest) arr.forEach((v, i) => { folded[i] += v; });
    entries = [...entries.slice(0, maxRows - 1), [`All others (${rest.length})`, folded]];
  }
  const div = opts.divisor ?? 1;
  const rows: GridRow[] = entries.map(([label, arr]) => ({ label, fmt, values: arr.map((v) => round2(v / div)) }));
  if (opts.totalRow !== false && entries.length > 0) {
    const tot = new Array<number>(cols.cols.length).fill(0);
    for (const [, arr] of map) arr.forEach((v, i) => { tot[i] += v; });
    rows.push({ label: "Total", fmt, bold: true, values: tot.map((v) => round2(v / div)) });
  }
  return { id, slide, title, rows, note: opts.note };
}

/** rows = keys; value = sum(num)/sum(den) x mult per column (null when den = 0). */
function ratioGrid<T>(
  id: string, slide: string, title: string, fmt: Fmt, recs: T[], cols: Cols,
  dateOf: (r: T) => string, rowKey: (r: T) => string, numOf: (r: T) => number, denOf: (r: T) => number,
  opts: { mult?: number; maxRows?: number; totalRow?: boolean; note?: string } = {},
): Grid {
  const nMap = new Map<string, number[]>();
  const dMap = new Map<string, number[]>();
  const nTot = new Array<number>(cols.cols.length).fill(0);
  const dTot = new Array<number>(cols.cols.length).fill(0);
  for (const r of recs) {
    const idxs = cols.byDate.get(dateOf(r));
    if (!idxs) continue;
    const k = rowKey(r);
    const na = nMap.get(k) ?? new Array<number>(cols.cols.length).fill(0);
    const da = dMap.get(k) ?? new Array<number>(cols.cols.length).fill(0);
    const nv = numOf(r), dv = denOf(r);
    for (const i of idxs) { na[i] += nv; da[i] += dv; nTot[i] += nv; dTot[i] += dv; }
    nMap.set(k, na); dMap.set(k, da);
  }
  const mult = opts.mult ?? 1;
  const keys = [...dMap.keys()].sort((a, b) => dMap.get(b)![0] - dMap.get(a)![0] || a.localeCompare(b)).slice(0, opts.maxRows ?? 30);
  const rows: GridRow[] = keys.map((k) => ({
    label: k, fmt, values: dMap.get(k)!.map((d, i) => { const v = ratio(nMap.get(k)![i], d, mult); return v === null ? null : round2(v); }),
  }));
  if (opts.totalRow !== false && keys.length > 0) {
    rows.push({ label: "All", fmt, bold: true, values: dTot.map((d, i) => { const v = ratio(nTot[i], d, mult); return v === null ? null : round2(v); }) });
  }
  return { id, slide, title, rows, note: opts.note };
}

/* ------------------------------ metric vectors ---------------------------- */

const isCallSeg = (r: BillRec): boolean => r.segment !== "VKYC";
const billVec = (r: BillRec): Bag => {
  const c = isCallSeg(r);
  return {
    days: 1, calls: r.calls, conn: r.connected, talk: r.talkS, wrap: r.wrapS, idle: r.idleS, pause: r.pauseS, login: r.loginS, net: r.netS,
    late: r.late ? 1 : 0, cDays: c ? 1 : 0, cTalk: c ? r.talkS : 0, cWrap: c ? r.wrapS : 0, cIdle: c ? r.idleS : 0, cNet: c ? r.netS : 0,
    oCalls: r.segment === "Outbound" ? r.calls : 0, oTarget: r.segment === "Outbound" ? r.target : 0,
    brk: Math.max(0, r.loginS - r.netS), breakExceed: r.breakExceed,
  };
};
const BILL_METRICS = {
  agentDays: (b: Bag) => g(b, "days"),
  calls: (b: Bag) => g(b, "calls"),
  conn: (b: Bag) => g(b, "conn"),
  connectPct: (b: Bag) => ratio(g(b, "conn"), g(b, "calls"), 100),
  talkH: (b: Bag) => g(b, "talk") / 3600,
  netH: (b: Bag) => g(b, "net") / 3600,
  loginH: (b: Bag) => g(b, "login") / 3600,
  acht: (b: Bag) => ratio(g(b, "cTalk") + g(b, "cWrap"), g(b, "conn")),
  occ: (b: Bag) => ratio(g(b, "cTalk") + g(b, "cWrap"), g(b, "cTalk") + g(b, "cWrap") + g(b, "cIdle"), 100),
  netOcc: (b: Bag) => ratio(g(b, "cTalk") + g(b, "cWrap"), g(b, "cNet"), 100),
  latePct: (b: Bag) => ratio(g(b, "late"), g(b, "days"), 100),
  breakPct: (b: Bag) => ratio(g(b, "brk"), g(b, "login"), 100),
  callsPerNetHr: (b: Bag) => ratio(g(b, "calls"), g(b, "cNet") / 3600),
  attain: (b: Bag) => ratio(g(b, "oCalls"), g(b, "oTarget"), 100),
};

const outVec = (r: OutRec): Bag => ({
  days: 1, lrsC: r.lrsC, lrsA: r.lrsA, trC: r.trC, trA: r.trA, mfC: r.mfC, mfA: r.mfA,
  lrsAt: r.lrsT > 0 ? r.lrsA : 0, lrsTt: r.lrsT > 0 ? r.lrsT : 0,
  trAt: r.trT > 0 ? r.trA : 0, trTt: r.trT > 0 ? r.trT : 0,
  mfAt: r.mfT > 0 ? r.mfA : 0, mfTt: r.mfT > 0 ? r.mfT : 0,
  total: r.lrsA + r.trA + r.mfA, prod: r.lrsA + r.trA + r.mfA > 0 ? 1 : 0,
});

const callVec = (r: CallRec): Bag => ({
  calls: 1, ans: r.answered ? 1 : 0, unans: r.answered ? 0 : 1, noAgent: !r.answered && r.agent === "(no agent)" ? 1 : 0,
  talk: r.answered ? r.talkS : 0, handling: r.answered ? r.handlingS : 0,
  qN: r.answered && r.queueS !== null ? 1 : 0, qS: r.answered && r.queueS !== null ? r.queueS : 0,
  tN: r.answered && r.ttaS !== null ? 1 : 0, tS: r.answered && r.ttaS !== null ? r.ttaS : 0,
});

/* --------------------------------- filters -------------------------------- */

export interface AwFilters {
  segment: string; billingType: string;
  inCallType: string; inCampaign: string; cdrCallType: string; cdrCampaign: string;
}
const ALL = "All";
export function parseFilters(q: Record<string, unknown>): AwFilters {
  const s = (k: string): string => { const v = String(q[k] ?? "").trim(); return v === "" ? ALL : v.slice(0, 80); };
  return {
    segment: s("segment"), billingType: s("billingType"), inCallType: s("inCallType"), inCampaign: s("inCampaign"),
    cdrCallType: s("cdrCallType"), cdrCampaign: s("cdrCampaign"),
  };
}

/* ------------------------------ dispositions ------------------------------ */

export function dispositionCategory(d: string): string {
  if (d === "(blank)") return d;
  const parts = d.split("__");
  if (parts.length >= 2 && (parts[0] === "Yes" || parts[0] === "No")) return `${parts[0]}__${parts[1]}`;
  if (/^wrap up time exceeded/i.test(d)) return "Wrap up time exceeded";
  return d;
}
const dispositionReason = (d: string): string | null => {
  const parts = d.split("__");
  return parts[0] === "Yes" && parts.length >= 3 ? parts[2] : null;
};

/* -------------------------------- payloads -------------------------------- */

interface Coverage { source: string; table: string; rangeRows: number; uniqueRows: number; duplicatesDropped: number; firstDate: string | null; lastDate: string | null; daysWithData: number; unparsedDates: number; serialDateRows: number; textDateRows: number; latestUpload: string | null }

async function coverageFor(table: string, source: string, rangeRaw: number, rangeUnique: number): Promise<Coverage> {
  if (table === "aw_mandate") {
    const [[m]] = await db.execute<Row[]>("SELECT COUNT(*) n, MAX(inserted_at) up FROM db_masmis.aw_mandate") as unknown as [Row[]];
    return { source, table, rangeRows: rangeRaw, uniqueRows: rangeUnique, duplicatesDropped: rangeRaw - rangeUnique, firstDate: null, lastDate: null, daysWithData: 0, unparsedDates: 0, serialDateRows: 0, textDateRows: 0, latestUpload: m.up ? String(m.up) : null };
  }
  const col = "call_date";
  const exprSql = AW_SQL_DATE(col);
  const [[r]] = await db.execute<Row[]>(
    `SELECT MIN(${exprSql}) mn, MAX(${exprSql}) mx, COUNT(DISTINCT ${exprSql}) dd, SUM(${exprSql} IS NULL) bad,
            SUM(${col} REGEXP '^[0-9]{5}$') serial, SUM(${col} REGEXP '^[0-9]{1,2}-[A-Za-z]{3}-[0-9]{2}$') txt,
            MAX(inserted_at) up
       FROM db_masmis.${table}`,
  ) as unknown as [Row[]];
  const iso = (v: unknown): string | null => (v ? String(v).slice(0, 10) : null);
  return {
    source, table, rangeRows: rangeRaw, uniqueRows: rangeUnique, duplicatesDropped: rangeRaw - rangeUnique,
    firstDate: iso(r.mn), lastDate: iso(r.mx), daysWithData: num(r.dd), unparsedDates: num(r.bad),
    serialDateRows: num(r.serial), textDateRows: num(r.txt), latestUpload: r.up ? String(r.up) : null,
  };
}

const list = (vals: string[]): string[] => [...new Set(vals)].sort((a, b) => a.localeCompare(b));

export interface AwDashboard {
  from: string; to: string; filters: AwFilters; generatedAt: string;
  options: { segments: string[]; billingTypes: string[]; inCallTypes: string[]; inCampaigns: string[]; cdrCallTypes: string[]; cdrCampaigns: string[] };
  columns: PeriodColumn[]; dailyColumnsOmitted: boolean;
  overview: unknown; billing: unknown; mandate: unknown; inbound: unknown; dialer: unknown; sales: unknown; agents: unknown; health: unknown;
  grids: Grid[];
}

export async function getAppreciateWealthDashboard(fromInput: string, toInput: string, filters: AwFilters): Promise<AwDashboard> {
  const { from, to } = resolveRange(fromInput, toInput);
  const cols = buildColumns(from, to);
  const [bill, out, inbound, cdr, mandateAll] = await Promise.all([
    loadBilling(from, to), loadOut(from, to), loadCalls("inbound", from, to), loadCalls("cdr", from, to), loadMandate(),
  ]);
  const days = eachDay(from, to);

  // Filter option lists come from the UNFILTERED domain in the range so a filter never hides its own alternatives.
  const options = {
    segments: list(bill.rows.map((r) => r.segment)),
    billingTypes: list(bill.rows.map((r) => r.billingType)),
    inCallTypes: list(inbound.rows.map((r) => r.callType)),
    inCampaigns: list(inbound.rows.map((r) => r.campaign)),
    cdrCallTypes: list(cdr.rows.map((r) => r.callType)),
    cdrCampaigns: list(cdr.rows.map((r) => r.campaign)),
  };

  const billF = bill.rows.filter((r) => (filters.segment === ALL || r.segment === filters.segment) && (filters.billingType === ALL || r.billingType === filters.billingType));
  const inF = inbound.rows.filter((r) => (filters.inCallType === ALL || r.callType === filters.inCallType) && (filters.inCampaign === ALL || r.campaign === filters.inCampaign));
  const cdrF = cdr.rows.filter((r) => (filters.cdrCallType === ALL || r.callType === filters.cdrCallType) && (filters.cdrCampaign === ALL || r.campaign === filters.cdrCampaign));

  const billTotals = bagCols(bill.rows, (r) => r.date, cols, billVec);
  const outTotals = bagCols(out.rows, (r) => r.date, cols, outVec);
  const inboundTypeOnly = inbound.rows.filter((r) => r.callType === "Inbound");
  const inTotals = bagCols(inboundTypeOnly, (r) => r.date, cols, callVec);
  const dialerLegs = cdr.rows.filter((r) => r.callType !== "Inbound");
  const cdrTotals = bagCols(dialerLegs, (r) => r.date, cols, callVec);

  const grids: Grid[] = [];
  const bT = billTotals[0], oT = outTotals[0], iT = inTotals[0], cT = cdrTotals[0];

  /* ---------- Overview ---------- */
  const overviewMetrics: MetricDef[] = [
    { label: "Agent-days (agent-day report)", fmt: "count", f: BILL_METRICS.agentDays },
    { label: "Calls (Inbound + Outbound agents)", fmt: "count", f: BILL_METRICS.calls },
    { label: "Connected calls", fmt: "count", f: BILL_METRICS.conn },
    { label: "Connect %", fmt: "pct", f: BILL_METRICS.connectPct },
    { label: "Talk hours", fmt: "hrs", f: BILL_METRICS.talkH },
    { label: "Net login hours (all segments)", fmt: "hrs", f: BILL_METRICS.netH },
    { label: "ACHT (s)", fmt: "secs", f: BILL_METRICS.acht },
    { label: "Net occupancy %", fmt: "pct", f: BILL_METRICS.netOcc },
    { label: "Late-login %", fmt: "pct", f: BILL_METRICS.latePct },
  ];
  const inboundMetrics: MetricDef[] = [
    { label: "Inbound calls offered", fmt: "count", f: (b) => g(b, "calls") },
    { label: "Inbound calls answered", fmt: "count", f: (b) => g(b, "ans") },
    { label: "Inbound calls unanswered", fmt: "count", f: (b) => g(b, "unans") },
    { label: "Inbound answer %", fmt: "pct", f: (b) => ratio(g(b, "ans"), g(b, "calls"), 100) },
    { label: "Inbound avg handling time (s)", fmt: "secs", f: (b) => ratio(g(b, "handling"), g(b, "ans")) },
  ];
  const dialerMetrics: MetricDef[] = [
    { label: "Dialer legs (Progressive + Manual)", fmt: "count", f: (b) => g(b, "calls") },
    { label: "Dialer legs answered", fmt: "count", f: (b) => g(b, "ans") },
    { label: "Dialer connect %", fmt: "pct", f: (b) => ratio(g(b, "ans"), g(b, "calls"), 100) },
  ];
  const salesMetrics: MetricDef[] = [
    { label: "LRS amount (Rs)", fmt: "inr", f: (b) => g(b, "lrsA") },
    { label: "Trade amount (Rs)", fmt: "inr", f: (b) => g(b, "trA") },
    { label: "MF amount (Rs)", fmt: "inr", f: (b) => g(b, "mfA") },
    { label: "Total sales amount (Rs)", fmt: "inr", f: (b) => g(b, "total"), bold: true },
  ];
  grids.push({
    id: "overview_key", slide: "Overview", title: "Key metrics - value, week-wise and date-wise",
    rows: [
      ...metricRows(billTotals, overviewMetrics),
      ...metricRows(inTotals, inboundMetrics),
      ...metricRows(cdrTotals, dialerMetrics),
      ...metricRows(outTotals, salesMetrics),
    ],
    note: "Agent-day metrics come from aw_billing; Inbound from aw_inbound (call_type = Inbound); Dialer from aw_new_cdr (Progressive + Manual legs); Sales from aw_out. Each source covers only the days it was uploaded - see Data Health.",
  });

  /* ---------- Billing tab ---------- */
  const billFilteredCols = bagCols(billF, (r) => r.date, cols, billVec);
  const bF = billFilteredCols[0];
  const dailyBill = days.map((d) => {
    const rs = billF.filter((r) => r.date === d);
    const b = rs.reduce<Bag>((a, r) => { const v = billVec(r); for (const k of Object.keys(v)) a[k] = (a[k] ?? 0) + v[k]; return a; }, {});
    return {
      date: d, agentDays: g(b, "days"), calls: g(b, "calls"), connected: g(b, "conn"), netHrs: round2(g(b, "net") / 3600),
      connectPct: round1(BILL_METRICS.connectPct(b) ?? 0),
      bySegment: Object.fromEntries(options.segments.map((s) => [s, rs.filter((r) => r.segment === s).reduce((a, r) => a + r.calls, 0)])),
      netBySegment: Object.fromEntries(options.segments.map((s) => [s, round2(rs.filter((r) => r.segment === s).reduce((a, r) => a + r.netS, 0) / 3600)])),
    };
  });
  const groupBill = (key: (r: BillRec) => string) => {
    const m = new Map<string, BillRec[]>();
    for (const r of billF) { const k = key(r); const a = m.get(k) ?? []; a.push(r); m.set(k, a); }
    return [...m.entries()].map(([name, rs]) => {
      const b = rs.reduce<Bag>((a, r) => { const v = billVec(r); for (const k of Object.keys(v)) a[k] = (a[k] ?? 0) + v[k]; return a; }, {});
      return {
        name, agents: new Set(rs.map((r) => r.agentId)).size, agentDays: g(b, "days"), calls: g(b, "calls"), connected: g(b, "conn"),
        connectPct: round1(BILL_METRICS.connectPct(b) ?? 0), netHrs: round1(g(b, "net") / 3600), acht: BILL_METRICS.acht(b) === null ? null : Math.round(BILL_METRICS.acht(b)!),
        netOccPct: BILL_METRICS.netOcc(b) === null ? null : round1(BILL_METRICS.netOcc(b)!), latePct: round1(BILL_METRICS.latePct(b) ?? 0),
        breakPct: round1(BILL_METRICS.breakPct(b) ?? 0), attainPct: BILL_METRICS.attain(b) === null ? null : round1(BILL_METRICS.attain(b)!),
      };
    }).sort((a, b) => b.agentDays - a.agentDays || a.name.localeCompare(b.name));
  };
  const auxTotals = AUX_CODES.map((a) => ({ code: a.key, label: a.label, hours: round2(billF.reduce((s, r) => s + (r.aux[a.key] ?? 0), 0) / 3600) })).filter((a) => a.hours > 0).sort((a, b) => b.hours - a.hours);
  const weeklyBill = [...cols.cols.filter((c) => c.kind === "week")].map((c) => {
    const i = cols.cols.indexOf(c);
    const b = billFilteredCols[i];
    return { week: c.label, from: c.from, to: c.to, agentDays: g(b, "days"), calls: g(b, "calls"), connected: g(b, "conn"), netHrs: round1(g(b, "net") / 3600), connectPct: round1(BILL_METRICS.connectPct(b) ?? 0), latePct: round1(BILL_METRICS.latePct(b) ?? 0) };
  });
  const billingPayload = {
    kpis: {
      agentDays: g(bF, "days"), agents: new Set(billF.map((r) => r.agentId)).size, calls: g(bF, "calls"), connected: g(bF, "conn"),
      connectPct: BILL_METRICS.connectPct(bF), talkHrs: round1(BILL_METRICS.talkH(bF)), netLoginHrs: round1(BILL_METRICS.netH(bF)), loginHrs: round1(BILL_METRICS.loginH(bF)),
      acht: BILL_METRICS.acht(bF), occupancyPct: BILL_METRICS.occ(bF), netOccupancyPct: BILL_METRICS.netOcc(bF), latePct: BILL_METRICS.latePct(bF),
      breakPct: BILL_METRICS.breakPct(bF), callsPerNetHr: BILL_METRICS.callsPerNetHr(bF), attainPct: BILL_METRICS.attain(bF),
      breakExceedDays: billF.filter((r) => r.breakExceed > 0).length,
    },
    daily: dailyBill, weekly: weeklyBill, bySegment: groupBill((r) => r.segment), byBillingType: groupBill((r) => r.billingType),
    byAgent: groupBill((r) => `${r.agentId}|${r.agentName}`).map((x) => { const [agentId, ...nm] = x.name.split("|"); return { ...x, agentId, name: nm.join("|") }; }),
    aux: auxTotals,
    days: billF.slice().sort((a, b) => (a.date === b.date ? a.agentName.localeCompare(b.agentName) : a.date < b.date ? 1 : -1)).slice(0, 400).map((r) => ({
      id: r.id, date: r.date, agentId: r.agentId, agent: r.agentName, segment: r.segment, billingType: r.billingType, calls: r.calls, connected: r.connected,
      netHrs: round2(r.netS / 3600), late: r.late,
    })),
    daysTruncated: billF.length > 400,
  };
  grids.push(
    { id: "bill_metrics", slide: "Billing", title: `Agent-day metrics${filters.segment !== ALL || filters.billingType !== ALL ? " (filtered)" : ""}`, rows: metricRows(billFilteredCols, [
      ...overviewMetrics,
      { label: "Occupancy % (talk+wrap / talk+wrap+idle)", fmt: "pct", f: BILL_METRICS.occ },
      { label: "Break time % of login", fmt: "pct", f: BILL_METRICS.breakPct },
      { label: "Calls per net login hour", fmt: "dec", f: BILL_METRICS.callsPerNetHr },
      { label: "Outbound calling-target attainment %", fmt: "pct", f: BILL_METRICS.attain },
    ]) },
    sumGrid("bill_days_seg", "Billing", "Agent-days by segment", "count", billF, cols, (r) => r.date, (r) => r.segment, () => 1),
    sumGrid("bill_calls_seg", "Billing", "Calls by segment", "count", billF, cols, (r) => r.date, (r) => r.segment, (r) => r.calls),
    sumGrid("bill_conn_seg", "Billing", "Connected calls by segment", "count", billF, cols, (r) => r.date, (r) => r.segment, (r) => r.connected),
    ratioGrid("bill_connpct_seg", "Billing", "Connect % by segment", "pct", billF.filter(isCallSeg), cols, (r) => r.date, (r) => r.segment, (r) => r.connected, (r) => r.calls, { mult: 100 }),
    sumGrid("bill_net_seg", "Billing", "Net login hours by segment", "hrs", billF, cols, (r) => r.date, (r) => r.segment, (r) => r.netS, { divisor: 3600 }),
    sumGrid("bill_days_type", "Billing", "Agent-days by billing type", "count", billF, cols, (r) => r.date, (r) => r.billingType, () => 1),
    sumGrid("bill_net_type", "Billing", "Net login hours by billing type", "hrs", billF, cols, (r) => r.date, (r) => r.billingType, (r) => r.netS, { divisor: 3600 }),
    sumGrid("bill_calls_type", "Billing", "Calls by billing type", "count", billF, cols, (r) => r.date, (r) => r.billingType, (r) => r.calls),
    sumGrid("bill_late_type", "Billing", "Late logins by billing type", "count", billF, cols, (r) => r.date, (r) => r.billingType, (r) => (r.late ? 1 : 0)),
  );

  /* ---------- Mandate tab ---------- */
  const monthsInRange = [...new Set(days.map((d) => d.slice(0, 7)))];
  const mandateRows = mandateAll.filter((m) => !m.superseded && monthsInRange.includes(m.month));
  const deliveredByType = new Map<string, { net: number; days: number; agents: Set<string>; dates: Set<string> }>();
  for (const r of bill.rows) {
    const k = `${r.date.slice(0, 7)}|${r.billingType}`;
    const cur = deliveredByType.get(k) ?? { net: 0, days: 0, agents: new Set<string>(), dates: new Set<string>() };
    cur.net += r.netS; cur.days += 1; cur.agents.add(r.agentId); cur.dates.add(r.date);
    deliveredByType.set(k, cur);
  }
  const mandateTable = mandateRows.map((m) => {
    const d = deliveredByType.get(`${m.month}|${m.billingType}`);
    const deliveredHrs = (d?.net ?? 0) / 3600;
    const mandatedHrs = m.hoursPerFte !== null ? m.mandate * m.hoursPerFte : null;
    const dim = daysInMonth(m.month);
    const covered = days.filter((x) => x.startsWith(m.month)).length;
    return {
      id: m.id, month: m.month, billingType: m.billingType, mandate: m.mandate, rate: m.rate, hoursPerFte: m.hoursPerFte,
      contractValue: m.mandate * m.rate, mandatedHrs, deliveredHrs: round1(deliveredHrs),
      hoursDeliveredPct: mandatedHrs && mandatedHrs > 0 ? round1((deliveredHrs / mandatedHrs) * 100) : null,
      fteEq: m.hoursPerFte ? round2(deliveredHrs / m.hoursPerFte) : null,
      agents: d?.agents.size ?? 0, agentDays: d?.days ?? 0, daysWithData: d?.dates.size ?? 0, daysInRange: covered, daysInMonth: dim,
    };
  }).sort((a, b) => (a.month === b.month ? a.billingType.localeCompare(b.billingType) : a.month < b.month ? 1 : -1));
  const noMandateMonths = monthsInRange.filter((ym) => !mandateAll.some((m) => !m.superseded && m.month === ym));
  const mandatePayload = {
    table: mandateTable,
    totals: {
      mandate: mandateTable.reduce((s, r) => s + r.mandate, 0), contractValue: mandateTable.reduce((s, r) => s + r.contractValue, 0),
      mandatedHrs: mandateTable.reduce((s, r) => s + (r.mandatedHrs ?? 0), 0), deliveredHrs: round1(mandateTable.reduce((s, r) => s + r.deliveredHrs, 0)),
    },
    noMandateMonths,
    history: mandateAll.slice().sort((a, b) => b.id - a.id).map((m) => ({
      id: m.id, month: m.month, monthRaw: m.monthRaw, billingType: m.billingType, mandate: m.mandate, rate: m.rate, hoursRaw: m.hoursRaw,
      superseded: m.superseded, insertedAt: m.insertedAt,
    })),
    deliveredNoMandate: [...deliveredByType.entries()].filter(([k]) => !mandateAll.some((m) => !m.superseded && `${m.month}|${m.billingType}` === k))
      .map(([k, v]) => ({ month: k.split("|")[0], billingType: k.split("|")[1], deliveredHrs: round1(v.net / 3600), agentDays: v.days })),
  };
  grids.push({
    id: "mandate_static", slide: "Mandate", title: "Mandate vs delivery (per month in range; single Value column - monthly config, not a daily metric)",
    rows: mandateTable.flatMap((m) => [
      { label: `${m.month} ${m.billingType} - mandate (FTE)`, fmt: "dec" as Fmt, values: [m.mandate] },
      { label: `${m.month} ${m.billingType} - rate per FTE (Rs)`, fmt: "inr" as Fmt, values: [m.rate] },
      { label: `${m.month} ${m.billingType} - contract value (Rs)`, fmt: "inr" as Fmt, values: [m.contractValue] },
      { label: `${m.month} ${m.billingType} - delivered net hours (in range)`, fmt: "hrs" as Fmt, values: [m.deliveredHrs] },
    ]),
  });

  /* ---------- Inbound tab ---------- */
  const inHour = new Map<number, { calls: number; ans: number }>();
  for (const r of inF) { if (r.hour === null) continue; const cur = inHour.get(r.hour) ?? { calls: 0, ans: 0 }; cur.calls++; if (r.answered) cur.ans++; inHour.set(r.hour, cur); }
  const inGroup = (key: (r: CallRec) => string, rs: CallRec[]) => {
    const m = new Map<string, CallRec[]>();
    for (const r of rs) { const k = key(r); const a = m.get(k) ?? []; a.push(r); m.set(k, a); }
    return [...m.entries()].map(([name, x]) => {
      const b = x.reduce<Bag>((a, r) => { const v = callVec(r); for (const k of Object.keys(v)) a[k] = (a[k] ?? 0) + v[k]; return a; }, {});
      return {
        name, calls: g(b, "calls"), answered: g(b, "ans"), unanswered: g(b, "unans"), answerPct: round1(ratio(g(b, "ans"), g(b, "calls"), 100) ?? 0),
        avgTalk: ratio(g(b, "talk"), g(b, "ans")) === null ? null : Math.round(ratio(g(b, "talk"), g(b, "ans"))!),
        avgHandling: ratio(g(b, "handling"), g(b, "ans")) === null ? null : Math.round(ratio(g(b, "handling"), g(b, "ans"))!),
        talkHrs: round2(g(b, "talk") / 3600),
      };
    }).sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
  };
  const inB = inF.reduce<Bag>((a, r) => { const v = callVec(r); for (const k of Object.keys(v)) a[k] = (a[k] ?? 0) + v[k]; return a; }, {});
  const inboundOnly = inF.filter((r) => r.callType === "Inbound");
  const inIB = inboundOnly.reduce<Bag>((a, r) => { const v = callVec(r); for (const k of Object.keys(v)) a[k] = (a[k] ?? 0) + v[k]; return a; }, {});
  const inboundPayload = {
    kpis: {
      calls: g(inB, "calls"), answered: g(inB, "ans"), unanswered: g(inB, "unans"), answerPct: ratio(g(inB, "ans"), g(inB, "calls"), 100),
      talkHrs: round2(g(inB, "talk") / 3600), avgTalk: ratio(g(inB, "talk"), g(inB, "ans")), avgHandling: ratio(g(inB, "handling"), g(inB, "ans")),
      inboundOffered: g(inIB, "calls"), inboundAnswered: g(inIB, "ans"), inboundAnswerPct: ratio(g(inIB, "ans"), g(inIB, "calls"), 100),
      inboundNoAgent: g(inIB, "noAgent"), avgQueue: ratio(g(inIB, "qS"), g(inIB, "qN")), queueN: g(inIB, "qN"),
      avgTta: ratio(g(inIB, "tS"), g(inIB, "tN")), ttaN: g(inIB, "tN"),
      uniqueCallers: new Set(inF.map((r) => r.callerNo).filter(Boolean)).size,
      repeatCalls: Math.max(0, inF.length - new Set(inF.map((r) => r.callerNo).filter(Boolean)).size),
      repeatPct: inF.length > 0 ? round1((Math.max(0, inF.length - new Set(inF.map((r) => r.callerNo).filter(Boolean)).size) / inF.length) * 100) : null,
    },
    daily: days.map((d) => { const rs = inF.filter((r) => r.date === d); return { date: d, calls: rs.length, answered: rs.filter((r) => r.answered).length, unanswered: rs.filter((r) => !r.answered).length }; }),
    byHour: [...inHour.entries()].sort((a, b) => a[0] - b[0]).map(([hour, v]) => ({ hour, calls: v.calls, answered: v.ans, answerPct: round1(ratio(v.ans, v.calls, 100) ?? 0) })),
    hourUnknown: inF.filter((r) => r.hour === null).length,
    byCallType: inGroup((r) => r.callType, inF), byCampaign: inGroup((r) => r.campaign, inF), bySkill: inGroup((r) => r.skill, inF),
    byDisposition: inGroup((r) => r.disposition, inF).slice(0, 40), byAgent: inGroup((r) => r.agent, inF),
    byHangup: inGroup((r) => blankToLabel(r.hangupBy, "(not in file layout)"), inF),
    recent: inF.slice().sort((a, b) => (a.date === b.date ? (b.startS ?? 0) - (a.startS ?? 0) : a.date < b.date ? 1 : -1)).slice(0, RECENT_CALLS).map((r) => ({
      id: r.id, date: r.date, startS: r.startS, callType: r.callType, campaign: r.campaign, agent: r.agent, status: r.status, disposition: r.disposition, talkS: r.talkS, callerNo: r.callerNo,
    })),
    recentTruncated: inF.length > RECENT_CALLS,
  };
  const inCols = { d: (r: CallRec) => r.date };
  grids.push(
    { id: "in_metrics", slide: "Inbound", title: "Calls (selected filter) - value, week-wise and date-wise", rows: metricRows(bagCols(inF, inCols.d, cols, callVec), [
      { label: "Calls", fmt: "count", f: (b) => g(b, "calls") }, { label: "Answered", fmt: "count", f: (b) => g(b, "ans") },
      { label: "Unanswered", fmt: "count", f: (b) => g(b, "unans") }, { label: "Answer %", fmt: "pct", f: (b) => ratio(g(b, "ans"), g(b, "calls"), 100) },
      { label: "Talk hours", fmt: "hrs", f: (b) => g(b, "talk") / 3600 }, { label: "Avg talk time (s)", fmt: "secs", f: (b) => ratio(g(b, "talk"), g(b, "ans")) },
      { label: "Avg handling time (s)", fmt: "secs", f: (b) => ratio(g(b, "handling"), g(b, "ans")) },
    ]) },
    sumGrid("in_type", "Inbound", "Calls by call type", "count", inF, cols, inCols.d, (r) => r.callType, () => 1),
    sumGrid("in_type_ans", "Inbound", "Answered calls by call type", "count", inF, cols, inCols.d, (r) => r.callType, (r) => (r.answered ? 1 : 0)),
    sumGrid("in_campaign", "Inbound", "Calls by campaign", "count", inF, cols, inCols.d, (r) => r.campaign, () => 1),
    sumGrid("in_dispo", "Inbound", "Calls by disposition", "count", inF, cols, inCols.d, (r) => r.disposition, () => 1, { maxRows: 20 }),
    sumGrid("in_agent", "Inbound", "Calls by agent", "count", inF, cols, inCols.d, (r) => r.agent, () => 1),
    sumGrid("in_agent_ans", "Inbound", "Answered calls by agent", "count", inF, cols, inCols.d, (r) => r.agent, (r) => (r.answered ? 1 : 0)),
    sumGrid("in_hour", "Inbound", "Calls by hour of day", "count", inF.filter((r) => r.hour !== null), cols, inCols.d, (r) => `${p2(r.hour ?? 0)}:00`, () => 1, { order: Array.from({ length: 24 }, (_, h) => `${p2(h)}:00`), maxRows: 24 }),
  );

  /* ---------- Dialer tab (aw_new_cdr) ---------- */
  const cdrB = cdrF.reduce<Bag>((a, r) => { const v = callVec(r); for (const k of Object.keys(v)) a[k] = (a[k] ?? 0) + v[k]; return a; }, {});
  const cdrHour = new Map<number, { calls: number; ans: number }>();
  for (const r of cdrF) { if (r.hour === null) continue; const cur = cdrHour.get(r.hour) ?? { calls: 0, ans: 0 }; cur.calls++; if (r.answered) cur.ans++; cdrHour.set(r.hour, cur); }
  const catMap = new Map<string, { calls: number; ans: number }>();
  const reasonMap = new Map<string, { calls: number; ans: number }>();
  for (const r of cdrF) {
    const c = dispositionCategory(r.disposition);
    const cur = catMap.get(c) ?? { calls: 0, ans: 0 }; cur.calls++; if (r.answered) cur.ans++; catMap.set(c, cur);
    const rs = dispositionReason(r.disposition);
    if (rs) { const cr = reasonMap.get(`${dispositionCategory(r.disposition)} > ${rs}`) ?? { calls: 0, ans: 0 }; cr.calls++; if (r.answered) cr.ans++; reasonMap.set(`${dispositionCategory(r.disposition)} > ${rs}`, cr); }
  }
  const cdrLegsForCallers = cdrF.filter((r) => r.callType !== "Inbound");
  const cdrUniqueCallers = new Set(cdrLegsForCallers.map((r) => r.callerNo).filter(Boolean)).size;
  const cdrPayload = {
    kpis: {
      legs: g(cdrB, "calls"), answered: g(cdrB, "ans"), connectPct: ratio(g(cdrB, "ans"), g(cdrB, "calls"), 100),
      uniqueNumbers: cdrUniqueCallers,
      uniqueAnswered: new Set(cdrLegsForCallers.filter((r) => r.answered).map((r) => r.callerNo).filter(Boolean)).size,
      talkHrs: round2(g(cdrB, "talk") / 3600), avgTalk: ratio(g(cdrB, "talk"), g(cdrB, "ans")),
      successDispositions: cdrF.filter((r) => dispositionCategory(r.disposition) === "Yes__Success").length,
      callbackDispositions: cdrF.filter((r) => dispositionCategory(r.disposition) === "Yes__Callback").length,
      lostDispositions: cdrF.filter((r) => dispositionCategory(r.disposition) === "Yes__Lost").length,
      noDispositionLegs: cdrF.filter((r) => r.disposition === "(blank)").length,
      repeatLegs: Math.max(0, cdrLegsForCallers.length - cdrUniqueCallers),
      repeatPct: cdrLegsForCallers.length > 0 ? round1((Math.max(0, cdrLegsForCallers.length - cdrUniqueCallers) / cdrLegsForCallers.length) * 100) : null,
    },
    daily: days.map((d) => { const rs = cdrF.filter((r) => r.date === d); return { date: d, legs: rs.length, answered: rs.filter((r) => r.answered).length }; }),
    byHour: [...cdrHour.entries()].sort((a, b) => a[0] - b[0]).map(([hour, v]) => ({ hour, legs: v.calls, answered: v.ans, connectPct: round1(ratio(v.ans, v.calls, 100) ?? 0) })),
    hourUnknown: cdrF.filter((r) => r.hour === null).length,
    byCallType: inGroup((r) => r.callType, cdrF), byCampaign: inGroup((r) => r.campaign, cdrF), byAgent: inGroup((r) => r.agent, cdrF),
    byCategory: [...catMap.entries()].map(([name, v]) => ({ name, legs: v.calls, answered: v.ans, sharePct: round1(ratio(v.calls, cdrF.length, 100) ?? 0) })).sort((a, b) => b.legs - a.legs),
    byReason: [...reasonMap.entries()].map(([name, v]) => ({ name, legs: v.calls, answered: v.ans })).sort((a, b) => b.legs - a.legs).slice(0, 30),
    byDisposition: inGroup((r) => r.disposition, cdrF).slice(0, 40),
    byHangup: inGroup((r) => blankToLabel(r.hangupBy, "(not in file layout)"), cdrF),
    recent: cdrF.slice().sort((a, b) => (a.date === b.date ? (b.startS ?? 0) - (a.startS ?? 0) : a.date < b.date ? 1 : -1)).slice(0, RECENT_CALLS).map((r) => ({
      id: r.id, date: r.date, startS: r.startS, callType: r.callType, campaign: r.campaign, agent: r.agent, status: r.status, disposition: r.disposition, talkS: r.talkS, callerNo: r.callerNo,
    })),
    recentTruncated: cdrF.length > RECENT_CALLS,
  };
  grids.push(
    { id: "cdr_metrics", slide: "Outbound Dialer", title: "Dialer legs (selected filter) - value, week-wise and date-wise", rows: metricRows(bagCols(cdrF, (r) => r.date, cols, callVec), [
      { label: "Legs", fmt: "count", f: (b) => g(b, "calls") }, { label: "Answered legs", fmt: "count", f: (b) => g(b, "ans") },
      { label: "Connect %", fmt: "pct", f: (b) => ratio(g(b, "ans"), g(b, "calls"), 100) }, { label: "Talk hours", fmt: "hrs", f: (b) => g(b, "talk") / 3600 },
      { label: "Avg talk per answered leg (s)", fmt: "secs", f: (b) => ratio(g(b, "talk"), g(b, "ans")) },
    ]) },
    sumGrid("cdr_campaign", "Outbound Dialer", "Legs by campaign", "count", cdrF, cols, (r) => r.date, (r) => r.campaign, () => 1),
    sumGrid("cdr_campaign_ans", "Outbound Dialer", "Answered legs by campaign", "count", cdrF, cols, (r) => r.date, (r) => r.campaign, (r) => (r.answered ? 1 : 0)),
    ratioGrid("cdr_campaign_pct", "Outbound Dialer", "Connect % by campaign", "pct", cdrF, cols, (r) => r.date, (r) => r.campaign, (r) => (r.answered ? 1 : 0), () => 1, { mult: 100 }),
    sumGrid("cdr_cat", "Outbound Dialer", "Legs by disposition category", "count", cdrF, cols, (r) => r.date, (r) => dispositionCategory(r.disposition), () => 1, { maxRows: 20 }),
    sumGrid("cdr_agent", "Outbound Dialer", "Legs by agent", "count", cdrF, cols, (r) => r.date, (r) => r.agent, () => 1),
    sumGrid("cdr_agent_ans", "Outbound Dialer", "Answered legs by agent", "count", cdrF, cols, (r) => r.date, (r) => r.agent, (r) => (r.answered ? 1 : 0)),
    sumGrid("cdr_hour", "Outbound Dialer", "Legs by hour of day", "count", cdrF.filter((r) => r.hour !== null), cols, (r) => r.date, (r) => `${p2(r.hour ?? 0)}:00`, () => 1, { order: Array.from({ length: 24 }, (_, h) => `${p2(h)}:00`), maxRows: 24 }),
  );

  /* ---------- Sales tab (aw_out) ---------- */
  const salesRows = out.rows;
  const salesAgents = new Map<string, OutRec[]>();
  for (const r of salesRows) { const a = salesAgents.get(r.agentId) ?? []; a.push(r); salesAgents.set(r.agentId, a); }
  const sumOut = (rs: OutRec[]): Bag => rs.reduce<Bag>((a, r) => { const v = outVec(r); for (const k of Object.keys(v)) a[k] = (a[k] ?? 0) + v[k]; return a; }, {});
  const pct1 = (n: number, d: number): number | null => { const v = ratio(n, d, 100); return v === null ? null : round1(v); };
  const salesPayload = {
    kpis: {
      agentDays: salesRows.length, agents: salesAgents.size,
      lrsA: g(oT, "lrsA"), lrsC: g(oT, "lrsC"), trA: g(oT, "trA"), trC: g(oT, "trC"), mfA: g(oT, "mfA"), mfC: g(oT, "mfC"), total: g(oT, "total"),
      lrsAttain: pct1(g(oT, "lrsAt"), g(oT, "lrsTt")), trAttain: pct1(g(oT, "trAt"), g(oT, "trTt")), mfAttain: pct1(g(oT, "mfAt"), g(oT, "mfTt")),
      productivePct: pct1(g(oT, "prod"), g(oT, "days")),
      targetAgentDays: salesRows.filter((r) => r.lrsT > 0 || r.trT > 0 || r.mfT > 0).length,
      lrsAov: g(oT, "lrsC") > 0 ? round2(g(oT, "lrsA") / g(oT, "lrsC")) : null,
      trAov: g(oT, "trC") > 0 ? round2(g(oT, "trA") / g(oT, "trC")) : null,
      mfAov: g(oT, "mfC") > 0 ? round2(g(oT, "mfA") / g(oT, "mfC")) : null,
    },
    daily: days.map((d) => { const b = sumOut(salesRows.filter((r) => r.date === d)); return { date: d, lrsA: g(b, "lrsA"), trA: g(b, "trA"), mfA: g(b, "mfA"), total: g(b, "total"), agentDays: g(b, "days") }; }),
    byAgent: [...salesAgents.entries()].map(([agentId, rs]) => {
      const b = sumOut(rs);
      return {
        agentId, name: rs[0].agentName, agentDays: rs.length, lrsA: g(b, "lrsA"), lrsC: g(b, "lrsC"), trA: g(b, "trA"), trC: g(b, "trC"), mfA: g(b, "mfA"), mfC: g(b, "mfC"), total: g(b, "total"),
        lrsAttain: pct1(g(b, "lrsAt"), g(b, "lrsTt")), trAttain: pct1(g(b, "trAt"), g(b, "trTt")), mfAttain: pct1(g(b, "mfAt"), g(b, "mfTt")),
        calls: rs.reduce((s, r) => s + r.calls, 0), connected: rs.reduce((s, r) => s + r.connected, 0),
      };
    }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
    rows: salesRows.slice().sort((a, b) => (a.date === b.date ? a.agentName.localeCompare(b.agentName) : a.date < b.date ? 1 : -1)).slice(0, 400).map((r) => ({
      id: r.id, date: r.date, agentId: r.agentId, agent: r.agentName, lrsA: r.lrsA, lrsC: r.lrsC, trA: r.trA, trC: r.trC, mfA: r.mfA, mfC: r.mfC,
      hasTarget: r.lrsT > 0 || r.trT > 0 || r.mfT > 0, complete: r.complete,
    })),
    rowsTruncated: salesRows.length > 400, conflicts: out.conflicts.length,
  };
  const sd = (r: OutRec) => r.date;
  grids.push(
    { id: "sales_metrics", slide: "Outbound Sales", title: "Sales outcomes - value, week-wise and date-wise", rows: metricRows(outTotals, [
      { label: "Agent-days", fmt: "count", f: (b) => g(b, "days") },
      { label: "LRS count", fmt: "count", f: (b) => g(b, "lrsC") }, { label: "LRS amount (Rs)", fmt: "inr", f: (b) => g(b, "lrsA") },
      { label: "Trade count", fmt: "count", f: (b) => g(b, "trC") }, { label: "Trade amount (Rs)", fmt: "inr", f: (b) => g(b, "trA") },
      { label: "MF count", fmt: "count", f: (b) => g(b, "mfC") }, { label: "MF amount (Rs)", fmt: "inr", f: (b) => g(b, "mfA") },
      { label: "Total sales amount (Rs)", fmt: "inr", f: (b) => g(b, "total"), bold: true },
      { label: "LRS target attainment %", fmt: "pct", f: (b) => ratio(g(b, "lrsAt"), g(b, "lrsTt"), 100) },
      { label: "Trade target attainment %", fmt: "pct", f: (b) => ratio(g(b, "trAt"), g(b, "trTt"), 100) },
      { label: "MF target attainment %", fmt: "pct", f: (b) => ratio(g(b, "mfAt"), g(b, "mfTt"), 100) },
      { label: "Agent-days with any sale %", fmt: "pct", f: (b) => ratio(g(b, "prod"), g(b, "days"), 100) },
    ]) },
    sumGrid("sales_lrs_agent", "Outbound Sales", "LRS amount by agent (Rs)", "inr", salesRows, cols, sd, (r) => r.agentName, (r) => r.lrsA),
    sumGrid("sales_tr_agent", "Outbound Sales", "Trade amount by agent (Rs)", "inr", salesRows, cols, sd, (r) => r.agentName, (r) => r.trA),
    sumGrid("sales_mf_agent", "Outbound Sales", "MF amount by agent (Rs)", "inr", salesRows, cols, sd, (r) => r.agentName, (r) => r.mfA),
    sumGrid("sales_total_agent", "Outbound Sales", "Total sales amount by agent (Rs)", "inr", salesRows, cols, sd, (r) => r.agentName, (r) => r.lrsA + r.trA + r.mfA),
    sumGrid("sales_count_agent", "Outbound Sales", "Deals (LRS + Trade + MF count) by agent", "count", salesRows, cols, sd, (r) => r.agentName, (r) => r.lrsC + r.trC + r.mfC),
  );

  /* ---------- Agent-wise ---------- */
  const agentMap = new Map<string, { name: string; empId: string; segments: Set<string>; bill: BillRec[]; out: OutRec[] }>();
  for (const r of bill.rows) {
    const cur = agentMap.get(r.agentId) ?? { name: r.agentName, empId: r.empId, segments: new Set<string>(), bill: [], out: [] };
    cur.bill.push(r); cur.segments.add(r.segment); agentMap.set(r.agentId, cur);
  }
  for (const r of out.rows) {
    const cur = agentMap.get(r.agentId) ?? { name: r.agentName, empId: r.empId, segments: new Set<string>(["Outbound"]), bill: [], out: [] };
    cur.out.push(r); agentMap.set(r.agentId, cur);
  }
  const agentRows = [...agentMap.entries()].map(([agentId, a]) => {
    const b = a.bill.reduce<Bag>((s, r) => { const v = billVec(r); for (const k of Object.keys(v)) s[k] = (s[k] ?? 0) + v[k]; return s; }, {});
    const o = sumOut(a.out);
    return {
      agentId, name: a.name, empId: a.empId, segments: [...a.segments].sort().join(" / "), agentDays: g(b, "days"), calls: g(b, "calls"), connected: g(b, "conn"),
      connectPct: BILL_METRICS.connectPct(b) === null ? null : round1(BILL_METRICS.connectPct(b)!), netHrs: round1(g(b, "net") / 3600),
      acht: BILL_METRICS.acht(b) === null ? null : Math.round(BILL_METRICS.acht(b)!), netOccPct: BILL_METRICS.netOcc(b) === null ? null : round1(BILL_METRICS.netOcc(b)!),
      latePct: g(b, "days") > 0 ? round1(BILL_METRICS.latePct(b)!) : null, lateDays: g(b, "late"), salesTotal: g(o, "total"), salesDays: a.out.length,
    };
  }).sort((a, b) => b.agentDays - a.agentDays || a.name.localeCompare(b.name));
  const agentsPayload = { rows: agentRows, withoutBilling: agentRows.filter((r) => r.agentDays === 0).length };
  grids.push(
    sumGrid("agent_days", "Agent-wise", "Agent-days by agent", "count", bill.rows, cols, (r) => r.date, (r) => r.agentName, () => 1),
    sumGrid("agent_calls", "Agent-wise", "Calls by agent", "count", bill.rows, cols, (r) => r.date, (r) => r.agentName, (r) => r.calls),
    sumGrid("agent_conn", "Agent-wise", "Connected calls by agent", "count", bill.rows, cols, (r) => r.date, (r) => r.agentName, (r) => r.connected),
    ratioGrid("agent_connpct", "Agent-wise", "Connect % by agent", "pct", bill.rows.filter(isCallSeg), cols, (r) => r.date, (r) => r.agentName, (r) => r.connected, (r) => r.calls, { mult: 100 }),
    sumGrid("agent_net", "Agent-wise", "Net login hours by agent", "hrs", bill.rows, cols, (r) => r.date, (r) => r.agentName, (r) => r.netS, { divisor: 3600 }),
    sumGrid("agent_late", "Agent-wise", "Late logins by agent", "count", bill.rows, cols, (r) => r.date, (r) => r.agentName, (r) => (r.late ? 1 : 0)),
  );

  /* ---------- Overview payload ---------- */
  const coverage = await Promise.all([
    coverageFor("aw_billing", "Agent-day report (Billing)", bill.raw, bill.rows.length),
    coverageFor("aw_out", "Outbound sales (aw_out)", out.raw, out.rows.length),
    coverageFor("aw_inbound", "Inbound CDR", inbound.raw, inbound.rows.length),
    coverageFor("aw_new_cdr", "Outbound dialer CDR", cdr.raw, cdr.rows.length),
    coverageFor("aw_mandate", "Mandate config", mandateAll.length, mandateAll.filter((m) => !m.superseded).length),
  ]);
  const overviewPayload = {
    kpis: {
      agentDays: g(bT, "days"), agents: new Set(bill.rows.map((r) => r.agentId)).size, calls: g(bT, "calls"), connected: g(bT, "conn"),
      connectPct: BILL_METRICS.connectPct(bT), netLoginHrs: round1(BILL_METRICS.netH(bT)), acht: BILL_METRICS.acht(bT), netOccPct: BILL_METRICS.netOcc(bT), latePct: BILL_METRICS.latePct(bT),
      inboundOffered: g(iT, "calls"), inboundAnswered: g(iT, "ans"), inboundAnswerPct: ratio(g(iT, "ans"), g(iT, "calls"), 100),
      dialerLegs: g(cT, "calls"), dialerAnswered: g(cT, "ans"), dialerConnectPct: ratio(g(cT, "ans"), g(cT, "calls"), 100),
      lrsA: g(oT, "lrsA"), trA: g(oT, "trA"), mfA: g(oT, "mfA"), salesTotal: g(oT, "total"),
      contractValue: mandateTable.reduce((s, r) => s + r.contractValue, 0), mandateMonths: mandateTable.length,
    },
    daily: days.map((d) => {
      const rs = bill.rows.filter((r) => r.date === d);
      const o = sumOut(out.rows.filter((r) => r.date === d));
      return {
        date: d, agentDays: rs.length, calls: rs.reduce((s, r) => s + r.calls, 0), connected: rs.reduce((s, r) => s + r.connected, 0),
        inbound: rs.filter((r) => r.segment === "Inbound").reduce((s, r) => s + r.calls, 0), outbound: rs.filter((r) => r.segment === "Outbound").reduce((s, r) => s + r.calls, 0),
        sales: g(o, "total"), lrsA: g(o, "lrsA"), trA: g(o, "trA"), mfA: g(o, "mfA"),
      };
    }),
    segmentMix: options.segments.map((s) => {
      const rs = bill.rows.filter((r) => r.segment === s);
      return { segment: s, agentDays: rs.length, agents: new Set(rs.map((r) => r.agentId)).size, netHrs: round1(rs.reduce((a, r) => a + r.netS, 0) / 3600), calls: rs.reduce((a, r) => a + r.calls, 0) };
    }),
    coverage,
  };

  /* ---------- Data Health ---------- */
  // Agent-day report vs call-level files, per date: are the CDR files complete?
  const outboundBillCalls = new Map<string, number>();
  const inboundBillCalls = new Map<string, number>();
  for (const r of bill.rows) {
    if (r.segment === "Outbound") outboundBillCalls.set(r.date, (outboundBillCalls.get(r.date) ?? 0) + r.calls);
    if (r.segment === "Inbound") inboundBillCalls.set(r.date, (inboundBillCalls.get(r.date) ?? 0) + r.calls);
  }
  const cdrAgentLegs = new Map<string, number>();
  for (const r of cdr.rows) if (r.agentId) cdrAgentLegs.set(r.date, (cdrAgentLegs.get(r.date) ?? 0) + 1);
  const inboundAgentLegs = new Map<string, number>();
  const inboundAgentIds = new Set(bill.rows.filter((r) => r.segment === "Inbound").map((r) => r.agentId));
  for (const r of inbound.rows) if (r.agentId && inboundAgentIds.has(r.agentId)) inboundAgentLegs.set(r.date, (inboundAgentLegs.get(r.date) ?? 0) + 1);
  const reconciliation = days.map((d) => {
    const ob = outboundBillCalls.get(d) ?? 0, oc = cdrAgentLegs.get(d) ?? 0;
    const ib = inboundBillCalls.get(d) ?? 0, ic = inboundAgentLegs.get(d) ?? 0;
    return {
      date: d, outboundReportCalls: ob, dialerCdrLegs: oc, dialerCoveragePct: ob > 0 ? round1((oc / ob) * 100) : null,
      inboundReportCalls: ib, inboundCdrLegs: ic, inboundCoveragePct: ib > 0 ? round1((ic / ib) * 100) : null,
    };
  }).filter((x) => x.outboundReportCalls || x.dialerCdrLegs || x.inboundReportCalls || x.inboundCdrLegs);
  const healthPayload = {
    coverage,
    duplicates: [
      { source: "aw_billing", key: "date + agent_id", raw: bill.raw, kept: bill.rows.length, dropped: bill.dropped },
      { source: "aw_out", key: "date + agent_id (complete row preferred)", raw: out.raw, kept: out.rows.length, dropped: out.dropped },
      { source: "aw_inbound", key: "call_id + agent_id + start time", raw: inbound.raw, kept: inbound.rows.length, dropped: inbound.dropped },
      { source: "aw_new_cdr", key: "call_id + agent_id + start time", raw: cdr.raw, kept: cdr.rows.length, dropped: cdr.dropped },
      { source: "aw_mandate", key: "month + billing_type (latest id)", raw: mandateAll.length, kept: mandateAll.filter((m) => !m.superseded).length, dropped: mandateAll.filter((m) => m.superseded).length },
    ],
    conflicts: out.conflicts.slice(0, 60), conflictCount: out.conflicts.length,
    reconciliation,
    multiLegCallIds: {
      inbound: inbound.rows.length - new Set(inbound.rows.map((r) => r.callId)).size,
      dialer: cdr.rows.length - new Set(cdr.rows.map((r) => r.callId)).size,
    },
    blankDisposition: { inbound: inbound.rows.filter((r) => r.disposition === "(blank)").length, dialer: cdr.rows.filter((r) => r.disposition === "(blank)").length },
    missingDays: days.filter((d) => !bill.rows.some((r) => r.date === d)).length,
    notes: [
      "aw_billing: total_calls / connected_calls / talk time equal the aw_out and CDR figures on every agent-day where the CDR file is complete (verified).",
      "aw_billing.actual_mandays, occupancy_pct and net_occupancy_pct are 100% blank; actual_versant and billing_in_number hold one constant per billing type. None is used.",
      "aw_billing.ontime_login_count is 1 even when late_login_status = YES, so only late_login_status is used for late-login %.",
      "VKYC agents have no dialer calls (their time is in the video_kyc_aux code); call metrics exclude them.",
      "aw_new_cdr disposition Yes__ is stored on Unanswered legs too (e.g. Yes__Lost__RNR after 8 Attempts) - it is shown as uploaded, not read as 'customer reached'.",
      "aw_inbound holds Inbound + Manual + Progressive calls of the Customer_Support campaign; queue time / speed of answer exist only for the older file layout.",
      "aw_mandate has no row for a month that was never uploaded; contract value and utilisation are shown only for months that have one.",
    ],
  };
  grids.push({
    id: "health_dups", slide: "Data Health", title: "Rows after de-duplication (single Value column)",
    rows: healthPayload.duplicates.flatMap((d) => [
      { label: `${d.source} - rows uploaded (range)`, fmt: "count" as Fmt, values: [d.raw] },
      { label: `${d.source} - unique rows used`, fmt: "count" as Fmt, values: [d.kept] },
      { label: `${d.source} - duplicate rows ignored`, fmt: "count" as Fmt, values: [d.dropped] },
    ]),
  });

  for (const gr of grids) gr.drill = GRID_DRILL[gr.id];

  return {
    from, to, filters, generatedAt: new Date().toISOString(), options, columns: cols.cols, dailyColumnsOmitted: cols.dailyOmitted,
    overview: overviewPayload, billing: billingPayload, mandate: mandatePayload, inbound: inboundPayload, dialer: cdrPayload, sales: salesPayload,
    agents: agentsPayload, health: healthPayload, grids,
  };
}

/* ================================ DETAIL ================================== */

const secToHms = (s: number): string => `${Math.floor(s / 3600)}:${p2(Math.floor((s % 3600) / 60))}:${p2(Math.round(s % 60))}`;

async function allColumns(table: string, id: number): Promise<Array<{ field: string; value: string }> | null> {
  const [rs] = await db.execute<Row[]>(`SELECT * FROM db_masmis.${table} WHERE id = ?`, [id]);
  if (!rs[0]) return null;
  return Object.entries(rs[0]).map(([field, value]) => ({ field, value: value === null || value === undefined ? "" : String(value) }));
}
const auditFor = async (table: string, batch: string): Promise<Array<{ batch: string; rows: number; insertedAt: string | null; uploadedBy: string | null }>> => {
  if (!batch) return [];
  const [rs] = await db.execute<Row[]>(
    `SELECT upload_batch_id b, COUNT(*) n, MAX(inserted_at) t, MAX(uploaded_by) u FROM db_masmis.${table} WHERE upload_batch_id = ? GROUP BY upload_batch_id`, [batch],
  );
  return rs.map((r) => ({ batch: String(r.b), rows: Number(r.n), insertedAt: r.t ? String(r.t) : null, uploadedBy: r.u === null ? null : String(r.u) }));
};

export async function getAgentDetail(agentId: string, fromInput: string, toInput: string) {
  const { from, to } = resolveRange(fromInput, toInput);
  const [bill, out, inbound, cdr] = await Promise.all([loadBilling(from, to), loadOut(from, to), loadCalls("inbound", from, to), loadCalls("cdr", from, to)]);
  // The grids label agents by name, so accept a name as well as the dialer agent id.
  if (!bill.rows.some((r) => r.agentId === agentId) && !out.rows.some((r) => r.agentId === agentId)) {
    const byName = bill.rows.find((r) => r.agentName === agentId) ?? out.rows.find((r) => r.agentName === agentId);
    if (byName) agentId = byName.agentId;
  }
  const b = bill.rows.filter((r) => r.agentId === agentId).sort((a, c) => (a.date < c.date ? -1 : 1));
  const o = out.rows.filter((r) => r.agentId === agentId);
  const i = inbound.rows.filter((r) => r.agentId === agentId);
  const c = cdr.rows.filter((r) => r.agentId === agentId);
  if (!b.length && !o.length && !i.length && !c.length) return null;
  const bag = b.reduce<Bag>((s, r) => { const v = billVec(r); for (const k of Object.keys(v)) s[k] = (s[k] ?? 0) + v[k]; return s; }, {});
  const name = b[0]?.agentName ?? o[0]?.agentName ?? i[0]?.agent ?? c[0]?.agent ?? agentId;
  const oByDate = new Map(o.map((r) => [r.date, r]));
  const legsByDate = (rs: CallRec[]) => { const m = new Map<string, { legs: number; ans: number }>(); for (const r of rs) { const x = m.get(r.date) ?? { legs: 0, ans: 0 }; x.legs++; if (r.answered) x.ans++; m.set(r.date, x); } return m; };
  const cdrByDate = legsByDate(c), inByDate = legsByDate(i);
  const dispo = new Map<string, number>();
  for (const r of c) dispo.set(dispositionCategory(r.disposition), (dispo.get(dispositionCategory(r.disposition)) ?? 0) + 1);
  const batches = new Map<string, string>();
  b.forEach((r) => batches.set(`aw_billing|${r.batch}`, "aw_billing")); o.forEach((r) => batches.set(`aw_out|${r.batch}`, "aw_out"));
  const audit = (await Promise.all([...batches.entries()].map(async ([k, t]) => (await auditFor(t, k.split("|")[1])).map((a) => ({ ...a, table: t }))))).flat();
  return {
    agentId, name, empId: b[0]?.empId ?? o[0]?.empId ?? "", segments: [...new Set(b.map((r) => r.segment))], billingTypes: [...new Set(b.map((r) => r.billingType))],
    from, to,
    kpis: {
      agentDays: g(bag, "days"), calls: g(bag, "calls"), connected: g(bag, "conn"), connectPct: BILL_METRICS.connectPct(bag), netHrs: round1(g(bag, "net") / 3600),
      loginHrs: round1(g(bag, "login") / 3600), acht: BILL_METRICS.acht(bag), netOccPct: BILL_METRICS.netOcc(bag), latePct: BILL_METRICS.latePct(bag), lateDays: g(bag, "late"),
      lrsA: o.reduce((s, r) => s + r.lrsA, 0), trA: o.reduce((s, r) => s + r.trA, 0), mfA: o.reduce((s, r) => s + r.mfA, 0),
      dialerLegs: c.length, dialerAnswered: c.filter((r) => r.answered).length, inboundCalls: i.length, inboundAnswered: i.filter((r) => r.answered).length,
    },
    daily: eachDay(from, to).filter((d) => b.some((r) => r.date === d) || oByDate.has(d) || cdrByDate.has(d) || inByDate.has(d)).map((d) => {
      const br = b.find((r) => r.date === d); const or = oByDate.get(d);
      return {
        date: d, billingId: br?.id ?? null, outId: or?.id ?? null, segment: br?.segment ?? "", billingType: br?.billingType ?? "", calls: br?.calls ?? null, connected: br?.connected ?? null,
        netHrs: br ? round2(br.netS / 3600) : null, loginFirst: null as string | null, late: br ? br.late : null,
        salesTotal: or ? or.lrsA + or.trA + or.mfA : null, cdrLegs: cdrByDate.get(d)?.legs ?? null, inboundCalls: inByDate.get(d)?.legs ?? null,
      };
    }),
    aux: AUX_CODES.map((a) => ({ label: a.label, hours: round2(b.reduce((s, r) => s + (r.aux[a.key] ?? 0), 0) / 3600) })).filter((a) => a.hours > 0).sort((x, y) => y.hours - x.hours),
    dispositions: [...dispo.entries()].map(([name2, n]) => ({ name: name2, legs: n })).sort((x, y) => y.legs - x.legs).slice(0, 15),
    audit,
  };
}

/** One day, or (with `toInput`) a week / any period: the date-wise table's column headers drill here. */
export async function getDayDetail(date: string, toInput = "") {
  if (!DATE_RE.test(date)) return null;
  const to = DATE_RE.test(toInput) && toInput >= date ? toInput : date;
  const [bill, out, inbound, cdr] = await Promise.all([loadBilling(date, to), loadOut(date, to), loadCalls("inbound", date, to), loadCalls("cdr", date, to)]);
  if (!bill.rows.length && !out.rows.length && !inbound.rows.length && !cdr.rows.length) return null;
  const bag = bill.rows.reduce<Bag>((s, r) => { const v = billVec(r); for (const k of Object.keys(v)) s[k] = (s[k] ?? 0) + v[k]; return s; }, {});
  const sBag = out.rows.reduce<Bag>((s, r) => { const v = outVec(r); for (const k of Object.keys(v)) s[k] = (s[k] ?? 0) + v[k]; return s; }, {});
  return {
    date, to,
    kpis: {
      agentDays: g(bag, "days"), calls: g(bag, "calls"), connected: g(bag, "conn"), connectPct: BILL_METRICS.connectPct(bag), netHrs: round1(g(bag, "net") / 3600),
      latePct: BILL_METRICS.latePct(bag), salesTotal: g(sBag, "total"), inboundCalls: inbound.rows.length, inboundAnswered: inbound.rows.filter((r) => r.answered).length,
      dialerLegs: cdr.rows.length, dialerAnswered: cdr.rows.filter((r) => r.answered).length,
    },
    agents: bill.rows.sort((a, b) => a.agentName.localeCompare(b.agentName)).map((r) => ({
      id: r.id, agentId: r.agentId, agent: r.agentName, segment: r.segment, billingType: r.billingType, calls: r.calls, connected: r.connected, netHrs: round2(r.netS / 3600), late: r.late,
    })),
    sales: out.rows.sort((a, b) => a.agentName.localeCompare(b.agentName)).map((r) => ({ id: r.id, agent: r.agentName, lrsA: r.lrsA, trA: r.trA, mfA: r.mfA })),
    hours: [...new Set([...inbound.rows, ...cdr.rows].map((r) => r.hour).filter((h): h is number => h !== null))].sort((a, b) => a - b).map((h) => ({
      hour: h, inbound: inbound.rows.filter((r) => r.hour === h).length, dialer: cdr.rows.filter((r) => r.hour === h).length,
    })),
  };
}

export async function getBillingTypeDetail(type: string, fromInput: string, toInput: string) {
  const { from, to } = resolveRange(fromInput, toInput);
  const [bill, mandateAll] = await Promise.all([loadBilling(from, to), loadMandate()]);
  // `type` is a billing type OR a segment (Inbound / Outbound / VKYC) -- the dashboards drill from both.
  const rows = bill.rows.filter((r) => r.billingType === type || r.segment === type);
  const mand = mandateAll.filter((m) => m.billingType === type);
  if (!rows.length && !mand.length) return null;
  const bag = rows.reduce<Bag>((s, r) => { const v = billVec(r); for (const k of Object.keys(v)) s[k] = (s[k] ?? 0) + v[k]; return s; }, {});
  const agents = new Map<string, BillRec[]>();
  for (const r of rows) { const a = agents.get(r.agentId) ?? []; a.push(r); agents.set(r.agentId, a); }
  return {
    billingType: type, from, to, segments: [...new Set(rows.map((r) => r.segment))],
    kpis: {
      agentDays: g(bag, "days"), agents: agents.size, calls: g(bag, "calls"), connected: g(bag, "conn"), connectPct: BILL_METRICS.connectPct(bag), netHrs: round1(g(bag, "net") / 3600),
      acht: BILL_METRICS.acht(bag), netOccPct: BILL_METRICS.netOcc(bag), latePct: BILL_METRICS.latePct(bag), breakPct: BILL_METRICS.breakPct(bag),
    },
    agents: [...agents.entries()].map(([agentId, rs]) => ({
      agentId, name: rs[0].agentName, agentDays: rs.length, calls: rs.reduce((s, r) => s + r.calls, 0), netHrs: round1(rs.reduce((s, r) => s + r.netS, 0) / 3600), lateDays: rs.filter((r) => r.late).length,
    })).sort((a, b) => b.agentDays - a.agentDays),
    daily: eachDay(from, to).map((d) => { const rs = rows.filter((r) => r.date === d); return { date: d, agents: rs.length, calls: rs.reduce((s, r) => s + r.calls, 0), netHrs: round2(rs.reduce((s, r) => s + r.netS, 0) / 3600) }; }).filter((x) => x.agents > 0),
    mandate: mand.sort((a, b) => b.id - a.id).map((m) => ({ id: m.id, month: m.month, mandate: m.mandate, rate: m.rate, hoursRaw: m.hoursRaw, superseded: m.superseded, insertedAt: m.insertedAt })),
  };
}

export async function getGroupDetail(source: string, dim: string, value: string, fromInput: string, toInput: string) {
  if (source !== "inbound" && source !== "cdr") return null;
  const { from, to } = resolveRange(fromInput, toInput);
  const data = await loadCalls(source, from, to);
  const pick = (r: CallRec): string => {
    switch (dim) {
      case "campaign": return r.campaign;
      case "disposition": return r.disposition;
      case "category": return dispositionCategory(r.disposition);
      case "skill": return r.skill;
      case "callType": return r.callType;
      case "agent": return r.agent;
      case "hour": return r.hour === null ? "" : `${p2(r.hour)}:00`;
      case "hangup": return blankToLabel(r.hangupBy, "(not in file layout)");
      default: return " ";
    }
  };
  if (!["campaign", "disposition", "category", "skill", "callType", "agent", "hour", "hangup"].includes(dim)) return null;
  const rows = data.rows.filter((r) => pick(r) === value);
  if (!rows.length) return null;
  const bag = rows.reduce<Bag>((s, r) => { const v = callVec(r); for (const k of Object.keys(v)) s[k] = (s[k] ?? 0) + v[k]; return s; }, {});
  const count = (key: (r: CallRec) => string) => {
    const m = new Map<string, { calls: number; ans: number }>();
    for (const r of rows) { const x = m.get(key(r)) ?? { calls: 0, ans: 0 }; x.calls++; if (r.answered) x.ans++; m.set(key(r), x); }
    return [...m.entries()].map(([name, v]) => ({ name, calls: v.calls, answered: v.ans })).sort((a, b) => b.calls - a.calls).slice(0, 25);
  };
  return {
    source, dim, value, from, to,
    kpis: {
      calls: g(bag, "calls"), answered: g(bag, "ans"), answerPct: ratio(g(bag, "ans"), g(bag, "calls"), 100), talkHrs: round2(g(bag, "talk") / 3600),
      avgTalk: ratio(g(bag, "talk"), g(bag, "ans")), avgHandling: ratio(g(bag, "handling"), g(bag, "ans")), uniqueCallers: new Set(rows.map((r) => r.callerNo)).size,
    },
    daily: eachDay(from, to).map((d) => { const rs = rows.filter((r) => r.date === d); return { date: d, calls: rs.length, answered: rs.filter((r) => r.answered).length }; }).filter((x) => x.calls > 0),
    byAgent: count((r) => r.agent), byDisposition: count((r) => r.disposition), byHour: count((r) => (r.hour === null ? "(unknown)" : `${p2(r.hour)}:00`)),
    calls: rows.slice().sort((a, b) => (a.date === b.date ? (b.startS ?? 0) - (a.startS ?? 0) : a.date < b.date ? 1 : -1)).slice(0, 100).map((r) => ({
      id: r.id, date: r.date, startS: r.startS, agent: r.agent, status: r.status, disposition: r.disposition, talkS: r.talkS, callerNo: r.callerNo,
    })),
    truncated: rows.length > 100,
  };
}

export async function getCallDetail(source: string, id: number) {
  if ((source !== "inbound" && source !== "cdr") || !Number.isInteger(id)) return null;
  const table = source === "inbound" ? "aw_inbound" : "aw_new_cdr";
  const fields = await allColumns(table, id);
  if (!fields) return null;
  const get = (f: string): string => fields.find((x) => x.field === f)?.value ?? "";
  const callId = get("call_id");
  const [siblings] = await db.execute<Row[]>(
    `SELECT id, agent, agent_id, status, disposition, start_time, call_date, upload_batch_id FROM db_masmis.${table} WHERE call_id = ? ORDER BY id LIMIT 50`, [callId],
  );
  const startS = secs(get("start_time"));
  const talk = secs(get("talk_time"));
  const audit = await auditFor(table, get("upload_batch_id"));
  const rec = get("recording_url");
  return {
    source, id, callId, status: get("status"), agent: get("agent"), disposition: get("disposition"),
    summary: {
      startTime: startS === null ? null : secToHms(startS), talkTimeS: talk, handlingS: secs(get("handling_time")), holdS: secs(get("hold_time")),
      wrapupS: secs(get("wrapup_duration")), callDateRaw: get("call_date"),
    },
    recordingUrl: rec && /^https?:\/\//i.test(rec) ? rec : null,
    fields: fields.filter((f) => f.field !== "recording_url"),
    sameCallId: siblings.map((s) => ({ id: Number(s.id), agent: String(s.agent ?? ""), status: String(s.status ?? ""), disposition: String(s.disposition ?? ""), startTime: String(s.start_time ?? ""), callDate: String(s.call_date ?? ""), batch: String(s.upload_batch_id ?? "") })),
    audit,
  };
}

export async function getAgentDayDetail(source: string, id: number) {
  if ((source !== "billing" && source !== "out") || !Number.isInteger(id)) return null;
  const table = source === "billing" ? "aw_billing" : "aw_out";
  const fields = await allColumns(table, id);
  if (!fields) return null;
  const get = (f: string): string => fields.find((x) => x.field === f)?.value ?? "";
  const agentId = get("agent_id");
  const [dateRow] = await db.execute<Row[]>(`SELECT DATE_FORMAT(${DATE_EXPR}, '%Y-%m-%d') d FROM db_masmis.${table} WHERE id = ?`, [id]);
  const date = String(dateRow[0]?.d ?? "");
  const other = source === "billing" ? "aw_out" : "aw_billing";
  const [siblings] = await db.execute<Row[]>(
    `SELECT id, upload_batch_id, inserted_at, total_calls, connected_calls ${source === "billing" ? "" : ", lrs_amount, trade_amount, mf_amount, uuid"} FROM db_masmis.${table}
      WHERE agent_id = ? AND ${DATE_EXPR} = ? ORDER BY id`, [agentId, date],
  );
  const [linked] = await db.execute<Row[]>(
    `SELECT id, upload_batch_id, total_calls, connected_calls FROM db_masmis.${other} WHERE agent_id = ? AND ${DATE_EXPR} = ? ORDER BY id`, [agentId, date],
  );
  const [cdrCount] = await db.execute<Row[]>(
    `SELECT COUNT(*) n, SUM(status='Answered') a FROM db_masmis.aw_new_cdr WHERE agent_id = ? AND ${DATE_EXPR} = ?`, [agentId, date],
  );
  const audit = await auditFor(table, get("upload_batch_id"));
  return {
    source, id, date, agentId, agent: get("agent_name"), empId: get("emp_id"),
    fields, sameAgentDayRows: siblings.map((s) => ({ ...s })), linkedOtherTable: { table: other, rows: linked.map((s) => ({ ...s })) },
    cdrLegs: { legs: num(cdrCount[0]?.n), answered: num(cdrCount[0]?.a) }, audit,
  };
}

const SOURCE_TABLES: Record<string, string> = {
  aw_billing: "call_date", aw_out: "call_date", aw_inbound: "call_date", aw_new_cdr: "call_date", aw_mandate: "month",
};
/** Data Health drill-down: every upload batch behind one source table (whitelisted table names only). */
export async function getSourceDetail(table: string) {
  const col = SOURCE_TABLES[table];
  if (!col) return null;
  const [batches] = await db.execute<Row[]>(
    `SELECT upload_batch_id b, COUNT(*) n, MIN(inserted_at) t, MAX(uploaded_by) u,
            MIN(${AW_SQL_DATE(col)}) mn, MAX(${AW_SQL_DATE(col)}) mx, SUM(${AW_SQL_DATE(col)} IS NULL) bad,
            SUM(${col} REGEXP '^[0-9]{5}$') serial, SUM(${col} REGEXP '^[0-9]{1,2}-[A-Za-z]{3}-[0-9]{2}$') txt
       FROM db_masmis.${table} GROUP BY upload_batch_id ORDER BY MIN(id)`,
  );
  const [cols] = await db.execute<Row[]>(
    `SELECT COLUMN_NAME c, COLUMN_TYPE t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'db_masmis' AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`, [table],
  );
  const [blank] = await db.execute<Row[]>(
    `SELECT ${cols.map((c) => `SUM(\`${c.c}\` IS NULL OR TRIM(CAST(\`${c.c}\` AS CHAR)) = '') AS \`${c.c}\``).join(", ")}, COUNT(*) AS __n FROM db_masmis.${table}`,
  );
  const total = num(blank[0]?.__n);
  return {
    table, rows: total, dateColumn: col,
    batches: batches.map((r) => ({
      batch: String(r.b), rows: Number(r.n), insertedAt: r.t ? String(r.t) : null, uploadedBy: r.u === null ? null : String(r.u),
      firstDate: r.mn ? String(r.mn).slice(0, 10) : null, lastDate: r.mx ? String(r.mx).slice(0, 10) : null,
      unparsedDates: num(r.bad), serialDateRows: num(r.serial), textDateRows: num(r.txt),
    })),
    columns: cols.map((c) => ({ name: String(c.c), type: String(c.t), blankRows: num(blank[0]?.[String(c.c)]), blankPct: total > 0 ? round1((num(blank[0]?.[String(c.c)]) / total) * 100) : 0 })),
  };
}

export async function getMandateDetail(id: number) {
  if (!Number.isInteger(id)) return null;
  const fields = await allColumns("aw_mandate", id);
  if (!fields) return null;
  const all = await loadMandate();
  const me = all.find((m) => m.id === id);
  if (!me) return null;
  const same = all.filter((m) => m.month === me.month && m.billingType === me.billingType).sort((a, b) => a.id - b.id);
  const [d] = await db.execute<Row[]>(
    `SELECT COUNT(*) n, COUNT(DISTINCT agent_id) a, SUM(TIME_TO_SEC(net_login_hrs)) s FROM db_masmis.aw_billing
      WHERE billing_type = ? AND ${AW_SQL_DATE("call_date")} BETWEEN ? AND ?`,
    [me.billingType, `${me.month}-01`, `${me.month}-${p2(daysInMonth(me.month))}`],
  );
  const delivered = num(d[0]?.s) / 3600;
  return {
    id, month: me.month, billingType: me.billingType, superseded: me.superseded, fields,
    derived: {
      contractValue: me.mandate * me.rate, mandatedHrs: me.hoursPerFte !== null ? me.mandate * me.hoursPerFte : null,
      deliveredHrs: round1(delivered), fteEq: me.hoursPerFte ? round2(delivered / me.hoursPerFte) : null, agentDays: num(d[0]?.n), agents: num(d[0]?.a),
    },
    sameMonthRows: same.map((m) => ({ id: m.id, mandate: m.mandate, rate: m.rate, hoursRaw: m.hoursRaw, monthRaw: m.monthRaw, superseded: m.superseded, insertedAt: m.insertedAt, batch: m.batch })),
    audit: await auditFor("aw_mandate", me.batch),
  };
}
