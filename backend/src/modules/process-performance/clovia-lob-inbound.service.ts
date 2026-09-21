import { createHmac } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getDialerPool } from "../../db/dialerDb.js";
import { PROJECTS } from "../call-master/inbound.service.js";
import {
  type ChartSpec, type Column, type CoverageRow, type DetailPayload, type DispoRow, type Directory, type Fmt, type Insight, type Kpi,
  type LobPayload, type PeriodBreakdown, type PeriodTable, type QualRow, type TableSpec, type Tone,
  DATE_EXPR, WEEKDAYS, agentName, avg, bucketOf, buildPeriodColumns, categoryPeriodRows, coverageOf, dispoKpis, dispoSection, fmtDdMmYyyy, inRange,
  kpiPeriodRows, listDays, loadDirectory, loadDispo, loadQuality, maskPhone, num, pct, percentile, qualitySection, resolveRange, round1, round2, sum, tlOf, weekdayOf,
} from "./clovia-lob.shared.js";
import { dispoDetail, qualityDetail } from "./clovia-lob.detail.js";
import { getCloviaInboundSnapshot } from "./clovia-inbound-snapshot.service.js";

/**
 * CLOVIA -- INBOUND add-ons (the call-performance views themselves are the
 * shared InboundInsightsDashboard on the live dialer, cdr_in_250).
 *
 * This service adds what the dialer table cannot know, from the uploaded tables:
 *   CSAT      cl_feedback   IVR post-call survey. One row per response; csat_dsat 1 = Satisfied,
 *                           0 = Not Satisfied (option_val agrees on all 736 rows). advisor_id =
 *                           the agent who took the call, language = Hindi / English.
 *                           CSAT % = Satisfied / responses.  Survey response rate = responses /
 *                           agent-handled calls from the dialer for the same days (null if the
 *                           dialer is unreachable). Exact duplicate rows (same unique_id +
 *                           call_date) are removed, latest upload kept.
 *   Quality   cl_quality    audits with lob = 'Inbound' (audit date). Voice audits carry only the
 *                           overall score, ACPT owner, query and remarks (the six chat/e-mail
 *                           parameters are blank).
 *   Rechurn   cl_rechurn_call  a caller who abandoned and then rang again. abandoned_date = the
 *                           earlier abandoned attempt, call_date = the later call, `agent` = who
 *                           took that later call, status Abandon / Press 2 as uploaded (the exact
 *                           meaning of 'Press 2' is not documented in the upload; it is shown, not
 *                           interpreted). Delay = call_date - abandoned_date in minutes. Exact
 *                           duplicate rows are removed (first kept).
 *   Tickets   cl_dispo      skill = 'inbound' CRM tickets (ticket date). Skill-blank tickets (mostly
 *                           'Call drop' with no action) are shown separately in the skill mix.
 *
 * OMITTED: agent login-hour occupancy and staffing (cl_apr's LOB tag is unreliable), callback
 * outcome (whether the re-call was answered) -- the source rows say only that the caller rang again.
 */

interface FbRow { id: number; date: string; hm: string; advisor: string; agent: string; phoneRaw: string; language: string; sat: boolean; option: string }
interface RcRow { id: number; date: string; agentKey: string; agent: string; phoneRaw: string; phoneKey: string; status: string; delayMin: number | null; callHm: string }
export interface InboundBundle { fb: FbRow[]; rc: RcRow[]; q: QualRow[]; d: DispoRow[]; handled: Map<string, number> | null }
interface Loaded extends InboundBundle {
  dir: Directory; allDispo: DispoRow[]; fbDup: number; rcDup: number; coverage: CoverageRow[]; unparseable: number;
}
const DMY = "%e-%b-%y";
const DELAY_BUCKETS = [
  { label: "Under 15 min", min: -Infinity, max: 14 }, { label: "15-30 min", min: 15, max: 29 }, { label: "30-60 min", min: 30, max: 59 },
  { label: "1-2 hrs", min: 60, max: 119 }, { label: "2-3 hrs", min: 120, max: 179 }, { label: "3+ hrs", min: 180, max: Infinity },
] as const;
const nf = (n: number) => n.toLocaleString("en-IN");
const custKey = (k: string) => createHmac("sha256", process.env.JWT_SECRET || process.env.SESSION_SECRET || "clovia-in").update(k).digest("hex").slice(0, 12);

async function loadHandled(from: string, to: string): Promise<Map<string, number> | null> {
  const p = PROJECTS.find((x) => x.key === "clovia");
  if (!p) return null;
  try {
    const pool = await getDialerPool();
    const ph = p.campaigns.map(() => "?").join(",");
    const [rows] = await pool.execute(
      `SELECT DATE_FORMAT(CallDate,'%Y-%m-%d') AS d, COUNT(*) AS n FROM dialer_db.${p.table}
        WHERE CallDate >= ? AND CallDate < DATE_ADD(DATE(?), INTERVAL 1 DAY) AND CampaignName IN (${ph})
          AND DisconnBy != 'HOLDTIME' AND AgentId != 'VDCL' GROUP BY DATE_FORMAT(CallDate,'%Y-%m-%d')`,
      [from, to, ...p.campaigns],
    );
    return new Map((rows as RowDataPacket[]).map((r) => [String(r.d), num(r.n)]));
  } catch { return null; }
}

async function load(from: string, to: string): Promise<Loaded> {
  const [fbRaw] = await db.execute<RowDataPacket[]>(
    `SELECT id, unique_id, DATE_FORMAT(STR_TO_DATE(report_date,'${DMY}'),'%Y-%m-%d') AS d, DATE_FORMAT(STR_TO_DATE(call_date,'%c/%e/%y %H:%i'),'%H:%i') AS hm,
            advisor_id, phone_number, language, option_val, csat_dsat, call_date
       FROM db_masmis.cl_feedback WHERE STR_TO_DATE(report_date,'${DMY}') BETWEEN ? AND ? ORDER BY id`, [from, to],
  );
  const fbLatest = new Map<string, RowDataPacket>();
  for (const r of fbRaw) fbLatest.set(`${r.unique_id}|${r.call_date}`, r);
  const dir = await loadDirectory();
  const fb: FbRow[] = [...fbLatest.values()].map((r) => ({
    id: num(r.id), date: String(r.d), hm: String(r.hm ?? ""), advisor: String(r.advisor_id ?? ""), agent: agentName(dir, String(r.advisor_id ?? "")), phoneRaw: String(r.phone_number ?? ""),
    language: String(r.language ?? "").trim() || "Unknown", sat: String(r.csat_dsat).trim() === "1", option: String(r.option_val ?? ""),
  })).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

  const [rcRaw] = await db.execute<RowDataPacket[]>(
    `SELECT id, agent, phone_number, status, DATE_FORMAT(STR_TO_DATE(report_date,'${DMY}'),'%Y-%m-%d') AS d,
            DATE_FORMAT(STR_TO_DATE(call_date,'%c/%e/%y %H:%i'),'%H:%i') AS hm,
            TIMESTAMPDIFF(MINUTE, STR_TO_DATE(abandoned_date,'%c/%e/%y %H:%i'), STR_TO_DATE(call_date,'%c/%e/%y %H:%i')) AS delay_min,
            abandoned_date, call_date
       FROM db_masmis.cl_rechurn_call WHERE STR_TO_DATE(report_date,'${DMY}') BETWEEN ? AND ? ORDER BY id`, [from, to],
  );
  const rcSeen = new Map<string, RowDataPacket>();
  for (const r of rcRaw) { const k = [r.agent, r.phone_number, r.call_date, r.abandoned_date, r.status].join("|"); if (!rcSeen.has(k)) rcSeen.set(k, r); }
  const rc: RcRow[] = [...rcSeen.values()].map((r) => {
    const phone = String(r.phone_number ?? "").replace(/\s+/g, "");
    return {
      id: num(r.id), date: String(r.d), agentKey: String(r.agent ?? ""), agent: agentName(dir, String(r.agent ?? "")), phoneRaw: phone,
      phoneKey: /^\d{10,12}$/.test(phone) ? phone.slice(-10) : "", status: String(r.status ?? "").trim() || "Unknown",
      delayMin: r.delay_min === null || r.delay_min === undefined ? null : num(r.delay_min), callHm: String(r.hm ?? ""),
    };
  }).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

  const [q, d, allDispo, handled, cFb, cRc, cQ, cD] = await Promise.all([
    loadQuality(from, to, "Inbound"), loadDispo(from, to, ["inbound"]), loadDispo(from, to, null), loadHandled(from, to),
    coverageOf("IVR feedback (CSAT)", "cl_feedback", DATE_EXPR.feedback, "one row per survey response"),
    coverageOf("Rechurn calls", "cl_rechurn_call", DATE_EXPR.rechurn, "abandoned callers who rang again"),
    coverageOf("Quality audits", "cl_quality", DATE_EXPR.quality, "lob = Inbound is used here"),
    coverageOf("CRM dispositions", "cl_dispo", DATE_EXPR.dispo, "skill = inbound is used here"),
  ]);
  return {
    fb, rc, q, d, handled, dir, allDispo, fbDup: fbRaw.length - fb.length, rcDup: rcRaw.length - rc.length,
    unparseable: [cFb, cRc, cQ, cD].reduce((s, c) => s + c.unparseable, 0),
    coverage: [cFb, cRc, cQ, cD].map(({ unparseable: _u, ...c }) => c),
  };
}

/* ───────────────────────────── KPI engine ───────────────────────────── */

export function computeInbound(b: InboundBundle, from: string, to: string): Record<string, number | null> {
  const f = b.fb; const r = b.rc; const n = f.length;
  const sat = f.filter((x) => x.sat).length;
  const hi = f.filter((x) => x.language.toLowerCase() === "hindi"); const en = f.filter((x) => x.language.toLowerCase() === "english");
  const handledN = b.handled ? sum(listDays(from, to).map((d) => b.handled!.get(d) ?? 0)) : null;
  const delays = r.map((x) => x.delayMin).filter((x): x is number => x !== null).sort((a, z) => a - z);
  const ql = b.q; const tk = dispoKpis(b.d, "");
  return {
    fbN: n, satisfied: sat, notSatisfied: n - sat, csatPct: pct(sat, n), dsatPct: pct(n - sat, n), surveyRate: handledN ? pct(n, handledN) : null, handled: handledN,
    hiN: hi.length, hiCsat: pct(hi.filter((x) => x.sat).length, hi.length), enN: en.length, enCsat: pct(en.filter((x) => x.sat).length, en.length),
    fbAgents: new Set(f.map((x) => x.advisor)).size,
    rcN: r.length, rcUnique: new Set(r.filter((x) => x.phoneKey).map((x) => x.phoneKey)).size, rcAbandon: r.filter((x) => x.status === "Abandon").length, rcPress2: r.filter((x) => x.status === "Press 2").length,
    rcAvgDelay: round1(avg(sum(delays), delays.length)), rcMedianDelay: percentile(delays, 50), rcP90Delay: percentile(delays, 90),
    rcWithin30: pct(delays.filter((x) => x <= 30).length, delays.length), rcWithin60: pct(delays.filter((x) => x <= 60).length, delays.length), rcWithin120: pct(delays.filter((x) => x <= 120).length, delays.length),
    audits: ql.length, avgQuality: ql.length ? round2(sum(ql.map((x) => x.score)) / ql.length) : 0, fatal: ql.filter((x) => x.fatal).length,
    tickets: b.d.length, ticketEsc: tk[2].value as number, ticketFtr: tk[1].value as number, ticketCmp: tk[4].value as number,
    callDropTickets: b.d.filter((x) => x.reason === "Call drop").length,
  };
}

interface KpiDef { key: string; label: string; fmt: Fmt; tone: Tone; icon: string; tab: string; sub?: (v: Record<string, number | null>) => string | undefined }
const DEFS: KpiDef[] = [
  { key: "fbN", label: "Survey responses", fmt: "int", tone: "sky", icon: "MessageSquareHeart", tab: "csat", sub: (v) => (v.surveyRate !== null ? `${v.surveyRate}% of ${nf(v.handled as number)} agent-handled calls` : "handled-call base unavailable") },
  { key: "csatPct", label: "CSAT %", fmt: "pct", tone: "emerald", icon: "Smile", tab: "csat", sub: (v) => `${nf(v.satisfied as number)} satisfied` },
  { key: "dsatPct", label: "DSAT %", fmt: "pct", tone: "red", icon: "Frown", tab: "csat", sub: (v) => `${nf(v.notSatisfied as number)} not satisfied` },
  { key: "hiCsat", label: "Hindi CSAT %", fmt: "pct", tone: "teal", icon: "Languages", tab: "csat", sub: (v) => `${nf(v.hiN as number)} Hindi responses` },
  { key: "enCsat", label: "English CSAT %", fmt: "pct", tone: "indigo", icon: "Languages", tab: "csat", sub: (v) => `${nf(v.enN as number)} English responses` },
  { key: "avgQuality", label: "Avg quality score", fmt: "pct", tone: "emerald", icon: "ShieldCheck", tab: "quality", sub: (v) => `${v.audits} audits · ${v.fatal} fatal` },
  { key: "rcN", label: "Rechurn calls", fmt: "int", tone: "rose", icon: "PhoneForwarded", tab: "rechurn", sub: (v) => `${nf(v.rcUnique as number)} unique callers` },
  { key: "rcAbandon", label: "Status: Abandon", fmt: "int", tone: "amber", icon: "PhoneMissed", tab: "rechurn", sub: (v) => `${nf(v.rcPress2 as number)} status Press 2` },
  { key: "rcAvgDelay", label: "Avg abandon-to-recall gap", fmt: "dec1", tone: "violet", icon: "Timer", tab: "rechurn", sub: (v) => `median ${v.rcMedianDelay} min · p90 ${v.rcP90Delay} min (minutes)` },
  { key: "rcWithin60", label: "Re-called within 1 hr", fmt: "pct", tone: "cyan", icon: "Clock3", tab: "rechurn", sub: (v) => `${v.rcWithin30}% within 30 min · ${v.rcWithin120}% within 2 hrs` },
  { key: "tickets", label: "CRM tickets (inbound)", fmt: "int", tone: "violet", icon: "ClipboardList", tab: "tickets", sub: (v) => `${v.callDropTickets} 'Call drop' · ${v.ticketEsc}% escalated` },
];
const PERIOD_EXTRA: Array<{ key: string; label: string; fmt: Fmt }> = [
  { key: "satisfied", label: "Satisfied", fmt: "int" }, { key: "notSatisfied", label: "Not satisfied", fmt: "int" }, { key: "hiN", label: "Hindi responses", fmt: "int" }, { key: "enN", label: "English responses", fmt: "int" },
  { key: "surveyRate", label: "Survey response rate % (of handled calls)", fmt: "pct" }, { key: "fbAgents", label: "Agents rated", fmt: "int" }, { key: "rcUnique", label: "Rechurn unique callers", fmt: "int" }, { key: "rcPress2", label: "Rechurn status Press 2", fmt: "int" },
  { key: "rcMedianDelay", label: "Median abandon-to-recall (min)", fmt: "dec1" }, { key: "rcWithin30", label: "Re-called within 30 min", fmt: "pct" }, { key: "rcWithin120", label: "Re-called within 2 hrs", fmt: "pct" },
  { key: "audits", label: "Quality audits", fmt: "int" }, { key: "fatal", label: "Fatal audits", fmt: "int" }, { key: "ticketEsc", label: "Tickets escalated %", fmt: "pct" }, { key: "ticketFtr", label: "Tickets FTR % (order-linked)", fmt: "pct" }, { key: "callDropTickets", label: "'Call drop' tickets", fmt: "int" },
];
const slice = (b: InboundBundle, from: string, to: string): InboundBundle => ({ fb: inRange(b.fb, from, to), rc: inRange(b.rc, from, to), q: inRange(b.q, from, to), d: inRange(b.d, from, to), handled: b.handled });

/* ───────────────────────────── report spec ───────────────────────────── */

const groupRows = <T,>(rows: T[], keyFn: (r: T) => string) => {
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = keyFn(r); (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
  return m;
};

export async function getInboundExtras(fromIn: string, toIn: string): Promise<LobPayload> {
  const { from, to } = resolveRange(fromIn, toIn);
  const L = await load(from, to);
  const b: InboundBundle = { fb: L.fb, rc: L.rc, q: L.q, d: L.d, handled: L.handled };
  const v = computeInbound(b, from, to);
  const kpis: Kpi[] = DEFS.map((d) => ({ key: d.key, label: d.label, value: v[d.key] ?? 0, fmt: d.fmt, tone: d.tone, icon: d.icon, sub: d.sub?.(v), tab: d.tab }));
  const days = listDays(from, to);

  const fbDays = days.map((date) => {
    const s = { fb: b.fb.filter((x) => x.date === date), rc: [], q: [], d: [], handled: b.handled } as InboundBundle; const k = computeInbound(s, date, date);
    return { _key: date, date, weekday: WEEKDAYS[weekdayOf(date)], responses: k.fbN as number, satisfied: k.satisfied as number, notSatisfied: k.notSatisfied as number, csatPct: k.csatPct as number, surveyRate: k.surveyRate as number | null, hi: k.hiN as number, en: k.enN as number };
  }).filter((d) => d.responses > 0);
  const fbAgents = [...groupRows(b.fb, (r) => r.advisor).entries()].map(([id, rs]) => {
    const s = rs.filter((x) => x.sat).length;
    return { _key: id, agent: agentName(L.dir, id), empId: id, tl: tlOf(L.dir, id), responses: rs.length, share: pct(rs.length, b.fb.length), satisfied: s, notSatisfied: rs.length - s, csatPct: pct(s, rs.length), hiPct: pct(rs.filter((x) => x.language.toLowerCase() === "hindi").length, rs.length) };
  }).sort((a, z) => z.responses - a.responses);
  const fbLang = [...groupRows(b.fb, (r) => r.language).entries()].map(([k, rs]) => ({ _key: k, label: k, responses: rs.length, share: pct(rs.length, b.fb.length), satisfied: rs.filter((x) => x.sat).length, csatPct: pct(rs.filter((x) => x.sat).length, rs.length) })).sort((a, z) => z.responses - a.responses);

  const rcDays = days.map((date) => {
    const rs = b.rc.filter((x) => x.date === date); const k = computeInbound({ fb: [], rc: rs, q: [], d: [], handled: null }, date, date);
    return { _key: date, date, weekday: WEEKDAYS[weekdayOf(date)], calls: rs.length, unique: k.rcUnique as number, abandon: k.rcAbandon as number, press2: k.rcPress2 as number, avgDelay: k.rcAvgDelay as number, within60: k.rcWithin60 as number };
  }).filter((d) => d.calls > 0);
  const rcAgents = [...groupRows(b.rc, (r) => r.agentKey).entries()].map(([id, rs]) => { const k = computeInbound({ fb: [], rc: rs, q: [], d: [], handled: null }, from, to); return { _key: id, agent: agentName(L.dir, id), empId: id, calls: rs.length, share: pct(rs.length, b.rc.length), unique: k.rcUnique as number, abandon: k.rcAbandon as number, press2: k.rcPress2 as number, avgDelay: k.rcAvgDelay as number }; }).sort((a, z) => z.calls - a.calls);
  const rcStatus = [...groupRows(b.rc, (r) => r.status).entries()].map(([k, rs]) => { const ds = rs.map((x) => x.delayMin).filter((x): x is number => x !== null); return { _key: k, label: k, calls: rs.length, share: pct(rs.length, b.rc.length), avgDelay: round1(avg(sum(ds), ds.length)) }; }).sort((a, z) => z.calls - a.calls);
  const rcDelay = DELAY_BUCKETS.map((w) => ({ _key: w.label, label: w.label, calls: b.rc.filter((x) => x.delayMin !== null && bucketOf(x.delayMin, DELAY_BUCKETS) === w.label).length })).map((x) => ({ ...x, share: pct(x.calls, b.rc.length) }));
  const rcCust = [...groupRows(b.rc.filter((x) => x.phoneKey), (r) => r.phoneKey).entries()].filter(([, rs]) => rs.length > 1).map(([pk, rs]) => ({ _key: custKey(pk), customer: maskPhone(rs[0].phoneRaw), calls: rs.length, days: new Set(rs.map((x) => x.date)).size, agents: new Set(rs.map((x) => x.agentKey)).size, last: fmtDdMmYyyy(rs.map((x) => x.date).sort().pop()) })).sort((a, z) => z.calls - a.calls).slice(0, 25);
  const skillMix = [...groupRows(L.allDispo, (r) => r.skill).entries()].map(([k, rs]) => {
    const linked = rs.filter((x) => x.ftr !== "NA");
    return { _key: k, label: k, tickets: rs.length, share: pct(rs.length, L.allDispo.length), escPct: pct(rs.filter((x) => x.action === "escalated").length, rs.length), ftrPct: pct(linked.filter((x) => x.ftr === "FTR").length, linked.length), callDrop: rs.filter((x) => x.reason === "Call drop").length };
  }).sort((a, z) => z.tickets - a.tickets);

  const charts: ChartSpec[] = [
    { key: "in_csat_daily", title: "Daily survey responses and CSAT %", subtitle: "Bars = responses; line = CSAT % (right axis)", tab: "csat", kind: "combo", xKey: "date", xFmt: "date", span: 2, series: [{ key: "satisfied", label: "Satisfied", color: "#10b981", type: "bar", stackId: "r" }, { key: "notSatisfied", label: "Not satisfied", color: "#f43f5e", type: "bar", stackId: "r" }, { key: "csatPct", label: "CSAT %", color: "#f59e0b", type: "line", axis: "right", fmt: "pct" }], data: fbDays.map((d) => ({ date: d.date, satisfied: d.satisfied, notSatisfied: d.notSatisfied, csatPct: d.csatPct })), drill: { kind: "fb_day", keyField: "date" } },
    { key: "in_csat_lang", title: "Responses by language", tab: "csat", kind: "donut", xKey: "label", series: [{ key: "responses", label: "Responses", color: "#0ea5e9" }], data: fbLang.map((l) => ({ label: l.label, responses: l.responses })), drill: { kind: "fb_lang", keyField: "label" } },
    { key: "in_csat_agent", title: "CSAT % by agent", subtitle: "Agents with at least 5 responses", tab: "csat", kind: "hbar", xKey: "agent", xFmt: "text", series: [{ key: "csatPct", label: "CSAT %", color: "#10b981", fmt: "pct" }], data: fbAgents.filter((a) => a.responses >= 5).map((a) => ({ agent: a.agent, _key: a._key, csatPct: a.csatPct })), drill: { kind: "fb_agent", keyField: "_key" }, span: 2 },
    { key: "in_rc_daily", title: "Rechurn calls by day", tab: "rechurn", kind: "combo", xKey: "date", xFmt: "date", span: 2, series: [{ key: "abandon", label: "Abandon", color: "#f43f5e", type: "bar", stackId: "s" }, { key: "press2", label: "Press 2", color: "#f59e0b", type: "bar", stackId: "s" }, { key: "avgDelay", label: "Avg gap (min)", color: "#6366f1", type: "line", axis: "right" }], data: rcDays.map((d) => ({ date: d.date, abandon: d.abandon, press2: d.press2, avgDelay: d.avgDelay })), drill: { kind: "rc_day", keyField: "date" } },
    { key: "in_rc_delay", title: "Gap between the abandoned call and the re-call", tab: "rechurn", kind: "hbar", xKey: "label", xFmt: "text", series: [{ key: "calls", label: "Calls", color: "#8b5cf6" }], data: rcDelay.map((d) => ({ label: d.label, calls: d.calls })), drill: { kind: "rc_delay", keyField: "label" } },
    { key: "in_rc_status", title: "Rechurn status", tab: "rechurn", kind: "donut", xKey: "label", series: [{ key: "calls", label: "Calls", color: "#f43f5e" }], data: rcStatus.map((d) => ({ label: d.label, calls: d.calls })), drill: { kind: "rc_status", keyField: "label" } },
    { key: "in_skill", title: "Ticket skill mix (all skills)", tab: "tickets", kind: "donut", xKey: "label", series: [{ key: "tickets", label: "Tickets", color: "#6366f1" }], data: skillMix.map((d) => ({ label: d.label, tickets: d.tickets })), drill: { kind: "dispo_skill", keyField: "label" } },
  ];
  const tables: TableSpec[] = [
    { key: "in_csat_daily_t", title: "Date-wise CSAT", tab: "csat", drillKind: "fb_day", keyField: "_key", defaultSort: { key: "date", dir: "asc" }, columns: [{ key: "date", label: "Date", align: "left" }, { key: "weekday", label: "Day", align: "left" }, { key: "responses", label: "Responses", fmt: "int" }, { key: "satisfied", label: "Satisfied", fmt: "int" }, { key: "notSatisfied", label: "Not satisfied", fmt: "int" }, { key: "csatPct", label: "CSAT %", fmt: "pct" }, { key: "surveyRate", label: "Response rate", fmt: "pct", hint: "responses ÷ agent-handled calls that day" }, { key: "hi", label: "Hindi", fmt: "int" }, { key: "en", label: "English", fmt: "int" }], rows: fbDays, totals: { date: "Total", responses: v.fbN, satisfied: v.satisfied, notSatisfied: v.notSatisfied, csatPct: v.csatPct, surveyRate: v.surveyRate, hi: v.hiN, en: v.enN } },
    { key: "in_csat_lang_t", title: "Language-wise CSAT", tab: "csat", drillKind: "fb_lang", keyField: "_key", columns: [{ key: "label", label: "Language", align: "left" }, { key: "responses", label: "Responses", fmt: "int" }, { key: "share", label: "Share", fmt: "pct" }, { key: "satisfied", label: "Satisfied", fmt: "int" }, { key: "csatPct", label: "CSAT %", fmt: "pct" }], rows: fbLang },
    { key: "in_csat_agent_t", title: "Agent-wise CSAT", tab: "csat", drillKind: "fb_agent", keyField: "_key", searchable: true, defaultSort: { key: "responses", dir: "desc" }, columns: [{ key: "agent", label: "Agent", align: "left" }, { key: "empId", label: "Emp ID", align: "left" }, { key: "tl", label: "TL", align: "left" }, { key: "responses", label: "Responses", fmt: "int" }, { key: "share", label: "Share", fmt: "pct" }, { key: "satisfied", label: "Satisfied", fmt: "int" }, { key: "notSatisfied", label: "Not satisfied", fmt: "int" }, { key: "csatPct", label: "CSAT %", fmt: "pct" }, { key: "hiPct", label: "Hindi %", fmt: "pct" }], rows: fbAgents },
    { key: "in_rc_daily_t", title: "Date-wise rechurn", tab: "rechurn", drillKind: "rc_day", keyField: "_key", defaultSort: { key: "date", dir: "asc" }, columns: [{ key: "date", label: "Date", align: "left" }, { key: "weekday", label: "Day", align: "left" }, { key: "calls", label: "Rechurn calls", fmt: "int" }, { key: "unique", label: "Unique callers", fmt: "int" }, { key: "abandon", label: "Abandon", fmt: "int" }, { key: "press2", label: "Press 2", fmt: "int" }, { key: "avgDelay", label: "Avg gap (min)", fmt: "dec1" }, { key: "within60", label: "≤1 hr %", fmt: "pct" }], rows: rcDays, totals: { date: "Total", calls: v.rcN, unique: v.rcUnique, abandon: v.rcAbandon, press2: v.rcPress2, avgDelay: v.rcAvgDelay, within60: v.rcWithin60 } },
    { key: "in_rc_delay_t", title: "Abandon-to-recall gap", tab: "rechurn", drillKind: "rc_delay", keyField: "_key", columns: [{ key: "label", label: "Gap", align: "left" }, { key: "calls", label: "Calls", fmt: "int" }, { key: "share", label: "Share", fmt: "pct" }], rows: rcDelay },
    { key: "in_rc_status_t", title: "Rechurn by status", tab: "rechurn", drillKind: "rc_status", keyField: "_key", columns: [{ key: "label", label: "Status", align: "left" }, { key: "calls", label: "Calls", fmt: "int" }, { key: "share", label: "Share", fmt: "pct" }, { key: "avgDelay", label: "Avg gap (min)", fmt: "dec1" }], rows: rcStatus },
    { key: "in_rc_agent_t", title: "Rechurn by agent taking the re-call", tab: "rechurn", drillKind: "rc_agent", keyField: "_key", searchable: true, columns: [{ key: "agent", label: "Agent", align: "left" }, { key: "empId", label: "Emp ID", align: "left" }, { key: "calls", label: "Calls", fmt: "int" }, { key: "share", label: "Share", fmt: "pct" }, { key: "unique", label: "Unique callers", fmt: "int" }, { key: "abandon", label: "Abandon", fmt: "int" }, { key: "press2", label: "Press 2", fmt: "int" }, { key: "avgDelay", label: "Avg gap (min)", fmt: "dec1" }], rows: rcAgents },
    { key: "in_rc_cust_t", title: "Callers who rang back most often", tab: "rechurn", drillKind: "rc_phone", keyField: "_key", subtitle: "Numbers are masked; click a row for that caller's records.", columns: [{ key: "customer", label: "Caller", align: "left" }, { key: "calls", label: "Rechurn calls", fmt: "int" }, { key: "days", label: "Days", fmt: "int" }, { key: "agents", label: "Agents", fmt: "int" }, { key: "last", label: "Last", align: "left" }], rows: rcCust },
    { key: "in_skill_t", title: "Ticket skill mix", tab: "tickets", drillKind: "dispo_skill", keyField: "_key", subtitle: "All CRM tickets in the range by skill; the sections below use skill = inbound only.", columns: [{ key: "label", label: "Skill", align: "left" }, { key: "tickets", label: "Tickets", fmt: "int" }, { key: "share", label: "Share", fmt: "pct" }, { key: "callDrop", label: "'Call drop'", fmt: "int" }, { key: "escPct", label: "Escalated %", fmt: "pct" }, { key: "ftrPct", label: "FTR %", fmt: "pct" }], rows: skillMix },
  ];
  const qs = qualitySection(b.q, "quality", "in_q");
  kpis.push(...qs.kpis); charts.push(...qs.charts); tables.push(...qs.tables);
  const ds = dispoSection(b.d, "tickets", "in_tk");
  kpis.push(...dispoKpis(b.d, "tickets")); charts.push(...ds.charts); tables.push(...ds.tables);

  const insights: Insight[] = [];
  if (b.fb.length) {
    insights.push({ tone: (v.csatPct as number) >= 90 ? "good" : "warn", text: `CSAT is ${v.csatPct}% from ${nf(v.fbN as number)} survey responses (${nf(v.notSatisfied as number)} not satisfied).${v.surveyRate !== null ? ` That is ${v.surveyRate}% of agent-handled calls.` : ""}`, tab: "csat" });
    if ((v.hiN as number) > 0 && (v.enN as number) > 0) insights.push({ tone: "info", text: `Hindi callers give ${v.hiCsat}% CSAT (${nf(v.hiN as number)} responses) against ${v.enCsat}% for English (${nf(v.enN as number)}).`, tab: "csat" });
    const worst = [...fbAgents].filter((a) => a.responses >= 10).sort((a, z) => a.csatPct - z.csatPct)[0];
    if (worst && fbAgents.length > 1) insights.push({ tone: worst.csatPct < 90 ? "warn" : "info", text: `Lowest CSAT among agents with 10+ responses: ${worst.agent} at ${worst.csatPct}% (${worst.notSatisfied} not satisfied of ${worst.responses}).`, tab: "csat" });
  }
  if (b.rc.length) {
    insights.push({ tone: "warn", text: `${nf(v.rcN as number)} rechurn calls from ${nf(v.rcUnique as number)} callers: on average the caller rang again ${v.rcAvgDelay} minutes after the abandoned call (median ${v.rcMedianDelay}); ${v.rcWithin60}% within an hour.`, tab: "rechurn" });
    const busiest = [...rcDays].sort((a, z) => z.calls - a.calls)[0];
    if (busiest) insights.push({ tone: "info", text: `Most rechurn on ${fmtDdMmYyyy(busiest.date)}: ${busiest.calls} calls (${busiest.abandon} Abandon, ${busiest.press2} Press 2).`, tab: "rechurn" });
  }
  if (b.q.length) insights.push({ tone: (v.avgQuality as number) >= 90 ? "good" : "warn", text: `Inbound quality averages ${v.avgQuality}% over ${b.q.length} audits, ${v.fatal} fatal.`, tab: "quality" });
  if (L.allDispo.length) {
    const blank = skillMix.find((s) => s.label === "(blank)");
    if (blank) insights.push({ tone: "warn", text: `${nf(blank.tickets)} tickets have no skill tag; ${nf(blank.callDrop)} of them are 'Call drop' tickets with no action taken -- they are excluded from the inbound ticket figures.`, tab: "tickets" });
    if (b.d.length) insights.push({ tone: "info", text: `${nf(b.d.length)} inbound-skill tickets: ${v.ticketEsc}% escalated, order-linked FTR ${v.ticketFtr}%.`, tab: "tickets" });
  }

  const notes = [
    `${L.fbDup} exact duplicate feedback row(s) (same unique_id and call time) and ${L.rcDup} duplicate rechurn row(s) were removed.`,
    "CSAT counts the IVR survey only: a caller who did not answer the survey is not in it, so CSAT % is a share of respondents, not of all calls.",
    "The meaning of the rechurn status 'Press 2' is not documented in the upload; it is displayed as uploaded. Whether the re-call was answered is not in the data.",
    "Omitted because the sources have no data for them: agent occupancy / login-hour utilisation (cl_apr's LOB tag is unreliable), staffing plan, and re-call outcome.",
    ...(L.handled === null ? ["The live dialer could not be read, so the survey response rate (responses ÷ agent-handled calls) is unavailable."] : []),
    ...(L.unparseable ? [`${L.unparseable} row(s) across the sources have an unreadable date and are excluded from every date range.`] : []),
    ...qs.notes,
  ];
  const definitions = [
    { term: "CSAT %", meaning: "Satisfied ÷ survey responses (csat_dsat = 1)." },
    { term: "Survey response rate", meaning: "Survey responses ÷ agent-handled calls from the live dialer (Clovia_English + Clovia_Hindi, excluding hold-time drops and calls that never reached an agent)." },
    { term: "Rechurn gap", meaning: "call_date - abandoned_date in minutes: how long after the abandoned attempt the caller rang again." },
    { term: "Weeks", meaning: "W-1 = 1st-7th of the month, W-2 = 8th-14th, W-3 = 15th-21st, W-4 = 22nd-28th, W-5 = 29th onward." },
  ];
  return {
    lob: "inbound", label: "Inbound add-ons", from, to, filters: {}, options: {},
    tabs: [{ key: "csat", label: "CSAT" }, { key: "quality", label: "Quality" }, { key: "rechurn", label: "Rechurn" }, { key: "tickets", label: "Tickets" }],
    coverage: L.coverage, kpis, charts, tables, insights, notes, definitions, metrics: v,
    empty: b.fb.length === 0 && b.rc.length === 0 && b.q.length === 0 && b.d.length === 0, latestDate: L.coverage[0]?.maxDate ?? null,
  };
}

/* ───────────────────────────── week / date columns ───────────────────────────── */

export async function getInboundExtrasPeriods(fromIn: string, toIn: string): Promise<PeriodBreakdown> {
  const { from, to } = resolveRange(fromIn, toIn);
  const L = await load(from, to);
  const { columns, dailyColumnsOmitted } = buildPeriodColumns(from, to);
  const b: InboundBundle = { fb: L.fb, rc: L.rc, q: L.q, d: L.d, handled: L.handled };
  const seen = new Set<string>();
  const defs = [...DEFS.map((d) => ({ key: d.key, label: d.label, fmt: d.fmt })), ...PERIOD_EXTRA].filter((d) => (seen.has(d.key) ? false : (seen.add(d.key), true)));
  // compute() needs the slice's own dates for the handled-call base, so wrap the slice with its bounds.
  const bounds = new WeakMap<object, { from: string; to: string }>();
  const sliceB = (f: string, t: string) => { const s = slice(b, f, t); bounds.set(s, { from: f, to: t }); return s; };
  const compute = (s: InboundBundle) => { const bd = bounds.get(s)!; return computeInbound(s, bd.from, bd.to); };
  const tables: PeriodTable[] = [
    { title: "Inbound add-on metrics", rowsLabel: "Metric", rows: kpiPeriodRows(defs, compute, sliceB, from, to, columns) },
    { title: "Survey responses by language", rowsLabel: "Language", rows: categoryPeriodRows(b.fb, (r) => r.language, columns) },
    { title: "Rechurn calls by status", rowsLabel: "Status", rows: categoryPeriodRows(b.rc, (r) => r.status, columns) },
    { title: "Ticket reasons (inbound skill)", rowsLabel: "Reason", rows: categoryPeriodRows(b.d, (r) => r.reason, columns) },
  ];
  return { from, to, columns, tables, dailyColumnsOmitted };
}

/* ───────────────────────────── drill-down ───────────────────────────── */

const FB_COLS: Column[] = [{ key: "date", label: "Date", align: "left" }, { key: "time", label: "Call time", align: "left" }, { key: "agent", label: "Agent", align: "left" }, { key: "phone", label: "Caller", align: "left" }, { key: "language", label: "Language", align: "left" }, { key: "answer", label: "Answer", align: "left" }];
const RC_COLS: Column[] = [{ key: "date", label: "Date", align: "left" }, { key: "time", label: "Re-call", align: "left" }, { key: "agent", label: "Agent", align: "left" }, { key: "phone", label: "Caller", align: "left" }, { key: "status", label: "Status", align: "left" }, { key: "gap", label: "Gap (min)", fmt: "int" }];

export async function getInboundExtrasDetail(kind: string, key: string, fromIn: string, toIn: string): Promise<DetailPayload | null> {
  if (kind === "mis") {
    // One row of the MIS snapshot (uploaded cl_ib_cdr): its value in every period column.
    const snap = await getCloviaInboundSnapshot();
    const m = snap.metrics.find((x) => x.key === key);
    if (!m) return null;
    return {
      title: m.label, subtitle: `MIS snapshot metric${m.benchmark ? ` · benchmark ${m.benchmark}` : ""}`, badge: { label: `${snap.cdrCoverage.minDate} – ${snap.cdrCoverage.maxDate}`, tone: "slate" },
      sections: [
        { title: "Value by period", type: "table", table: { columns: [{ key: "period", label: "Period", align: "left" }, { key: "value", label: "Value", align: "right" }], rows: snap.periods.map((p) => ({ period: p.label, value: String(m.values[p.key] ?? "—") })) } },
        { title: "Source", type: "text", text: snap.notes.join("\n") },
      ],
    };
  }
  const { from, to } = resolveRange(fromIn, toIn);
  const L = await load(from, to);
  if (kind === "dispo_skill") return dispoDetail(kind, key, L.allDispo);
  if (kind.startsWith("dispo_")) return dispoDetail(kind, key, L.d);
  if (kind.startsWith("quality_")) return qualityDetail(kind, key, L.q);

  if (kind.startsWith("fb_")) {
    let rows: FbRow[]; let title: string;
    if (kind === "fb_day") { rows = L.fb.filter((r) => r.date === key); title = `Survey — ${fmtDdMmYyyy(key)}`; }
    else if (kind === "fb_agent") { rows = L.fb.filter((r) => r.advisor === key); title = agentName(L.dir, key); }
    else if (kind === "fb_lang") { rows = L.fb.filter((r) => r.language === key); title = `Survey — ${key} callers`; }
    else return null;
    const k = computeInbound({ fb: rows, rc: [], q: [], d: [], handled: L.handled }, kind === "fb_day" ? key : from, kind === "fb_day" ? key : to);
    const byDate = groupRows(rows, (r) => r.date);
    const byAgent = groupRows(rows, (r) => r.advisor);
    const sections: DetailPayload["sections"] = [
      { title: "Summary", type: "kpis", kpis: [{ key: "n", label: "Responses", value: k.fbN, fmt: "int", tone: "sky", icon: "MessageSquareHeart" }, { key: "c", label: "CSAT %", value: k.csatPct, fmt: "pct", tone: "emerald", icon: "Smile" }, { key: "d", label: "DSAT %", value: k.dsatPct, fmt: "pct", tone: "red", icon: "Frown" }, { key: "h", label: "Hindi CSAT %", value: k.hiCsat, fmt: "pct", tone: "teal", icon: "Languages" }, { key: "e", label: "English CSAT %", value: k.enCsat, fmt: "pct", tone: "indigo", icon: "Languages" }] },
      { title: "Trend by day", type: "chart", chart: { key: "d", title: "Responses and CSAT %", tab: "", kind: "combo", xKey: "date", xFmt: "date", series: [{ key: "n", label: "Responses", color: "#a5b4fc", type: "bar" }, { key: "csat", label: "CSAT %", color: "#10b981", type: "line", axis: "right", fmt: "pct" }], data: [...byDate.entries()].sort((a, z) => a[0].localeCompare(z[0])).map(([date, rs]) => ({ date, n: rs.length, csat: pct(rs.filter((x) => x.sat).length, rs.length) })) } },
    ];
    if (kind !== "fb_agent") sections.push({ title: "Agents", type: "table", table: { columns: [{ key: "agent", label: "Agent", align: "left" }, { key: "n", label: "Responses", fmt: "int" }, { key: "csat", label: "CSAT %", fmt: "pct" }], rows: [...byAgent.entries()].map(([id, rs]) => ({ agent: agentName(L.dir, id), n: rs.length, csat: pct(rs.filter((x) => x.sat).length, rs.length) })).sort((a, z) => z.n - a.n) }, empty: "No agents." });
    sections.push({ title: `Responses (latest ${Math.min(rows.length, 200)} of ${nf(rows.length)})`, type: "table", table: { columns: FB_COLS, rows: [...rows].sort((a, z) => z.date.localeCompare(a.date) || z.id - a.id).slice(0, 200).map((r) => ({ id: r.id, date: fmtDdMmYyyy(r.date), time: r.hm, agent: r.agent, phone: maskPhone(r.phoneRaw), language: r.language, answer: r.option })), recordType: "feedback", keyField: "id" }, empty: "No responses." });
    return { title, subtitle: `${nf(rows.length)} survey responses`, badge: { label: `${k.csatPct}% CSAT`, tone: (k.csatPct as number) >= 90 ? "green" : "amber" }, sections };
  }

  if (kind.startsWith("rc_")) {
    let rows: RcRow[]; let title: string;
    if (kind === "rc_day") { rows = L.rc.filter((r) => r.date === key); title = `Rechurn — ${fmtDdMmYyyy(key)}`; }
    else if (kind === "rc_agent") { rows = L.rc.filter((r) => r.agentKey === key); title = `Rechurn — ${agentName(L.dir, key)}`; }
    else if (kind === "rc_status") { rows = L.rc.filter((r) => r.status === key); title = `Rechurn — status ${key}`; }
    else if (kind === "rc_delay") { rows = L.rc.filter((r) => r.delayMin !== null && bucketOf(r.delayMin, DELAY_BUCKETS) === key); title = `Rechurn — gap ${key}`; }
    else if (kind === "rc_phone") { const pk = [...new Set(L.rc.filter((r) => r.phoneKey).map((r) => r.phoneKey))].find((p) => custKey(p) === key); if (!pk) return null; rows = L.rc.filter((r) => r.phoneKey === pk); title = `Caller ${maskPhone(rows[0].phoneRaw)}`; }
    else return null;
    const k = computeInbound({ fb: [], rc: rows, q: [], d: [], handled: null }, from, to);
    const byDate = groupRows(rows, (r) => r.date);
    const sections: DetailPayload["sections"] = [
      { title: "Summary", type: "kpis", kpis: [{ key: "n", label: "Rechurn calls", value: k.rcN, fmt: "int", tone: "rose", icon: "PhoneForwarded" }, { key: "u", label: "Unique callers", value: k.rcUnique, fmt: "int", tone: "indigo", icon: "Users" }, { key: "a", label: "Avg gap (min)", value: k.rcAvgDelay, fmt: "dec1", tone: "violet", icon: "Timer" }, { key: "m", label: "Median gap (min)", value: k.rcMedianDelay, fmt: "dec1", tone: "cyan", icon: "Clock3" }, { key: "w", label: "Within 1 hr", value: k.rcWithin60, fmt: "pct", tone: "emerald", icon: "Gauge" }] },
      { title: "Trend by day", type: "chart", chart: { key: "d", title: "Rechurn calls", tab: "", kind: "combo", xKey: "date", xFmt: "date", series: [{ key: "n", label: "Calls", color: "#f43f5e", type: "bar" }], data: [...byDate.entries()].sort((a, z) => a[0].localeCompare(z[0])).map(([date, rs]) => ({ date, n: rs.length })) } },
      { title: `Records (latest ${Math.min(rows.length, 200)} of ${nf(rows.length)})`, type: "table", table: { columns: RC_COLS, rows: [...rows].sort((a, z) => z.date.localeCompare(a.date) || z.id - a.id).slice(0, 200).map((r) => ({ id: r.id, date: fmtDdMmYyyy(r.date), time: r.callHm, agent: r.agent, phone: maskPhone(r.phoneRaw), status: r.status, gap: r.delayMin })), recordType: "rechurn", keyField: "id" }, empty: "No records." },
    ];
    return { title, subtitle: `${nf(rows.length)} rechurn calls`, badge: { label: `${nf(rows.length)} calls`, tone: "blue" }, sections };
  }
  return null;
}
