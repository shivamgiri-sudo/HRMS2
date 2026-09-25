/**
 * Dalmia Cement "Inbound & Outbound Performance Dashboard" -- pure calculations.
 *
 * Every definition below is read off the formulas in the business's own workbook ("Dalmia MIS Dashboard Sep'26.xlsx":
 * sheets Inbound View, Language wise, Outbound View, QRC, leads Snap / Snap.2, APR-Utilization Raw) and was checked
 * against that workbook's own numbers (all 217 daily inbound metrics reproduce exactly). No database access here, so
 * the same functions can be fed the workbook's raw rows or the live tables' rows.
 *
 * INBOUND (per call row of the IB CDR):
 *   Offered          every row.
 *   Answered         DisconnBy is CALLER / AGENT / NONE   (HOLDTIME / ABANDON / QUEUETIMEOUT = not answered).
 *   Unique / Repeat  within one date, the first call from a phone number is Unique, later ones Repeat.
 *   AL %             Answered / Offered.        Abn calls = Offered - Answered.       Abn % = Abn / Offered.
 *   Ans in Threshold sum of the CDR's "Call 20 Sec (SL)" flag over answered rows whose agent is not the VDCL auto-dialer.
 *   Abn in Threshold unanswered rows (HOLDTIME / ABANDON / QUEUETIMEOUT) whose queue time is <= 20s. The workbook flags these as
 *                    "call duration 0"; in the workbook's data that is exactly the unanswered set, but the live dialer stores an
 *                    abandoned call's queue wait as its duration, so "not answered" is the definition that holds for both.
 *   SL %             Ans in Threshold / (Offered - Abn in Threshold).
 *   ACHT             (total talk + total dispo (ACW)) / Answered; talk and ACW count answered calls only (an abandoned call has none).
 *   Tagging          DD (disposition-detail) rows whose Source of Lead is "Inbound" that date; Tagging % = Tagging / Answered.
 *   Language table   per campaign: Abandon (DisconnBy ABANDON), Caller (DisconnBy CALLER), Grand Total, Answered
 *                    (agent not VDCL), AL % = Answered / Total, Threshold (queue <= 20s), Abn % = Abandon / Total.
 *                    (The workbook labels that last column "SL"; it is the abandon share, so it is called Abn % here.)
 * OUTBOUND ("Outbound" enquiry sheet, dated by Calling Date):
 *   Overall calls = rows; Unique = distinct mobile per date; Connect = Status "Contact"; Con % = Connect / Overall;
 *   Connected disposition = the Remarks of the Contact rows.
 * QRC: DD rows by SUB SCENARIO 1 in {Query, Complain, Request}, per call date.
 * LEADS (DD rows): Data Received = rows per Source of Lead; Connected = SCENARIO "Connected"; Qualified = the Leads
 *   mapping of SUB SCENARIO 3 is "Qualified Leads"; Type Of Leads from the same mapping ("IS" = SUB SCENARIO 2 is
 *   "Institutional Sales"); Open / Closed = Status; MT / Converted = the sheet's own numeric columns.
 * Weeks: W-1 = days 1-7, W-2 = 8-14, W-3 = 15-21, W-4 = 22-28, W-5 = 29+ of the month.
 */

export const DALMIA_CAMPAIGNS = [
  "Dalmia_Assamese", "Dalmia_Bengoli", "Dalmia_English", "Dalmia_Hindi", "Dalmia_Kannada",
  "Dalmia_Malayalam", "Dalmia_Marathi", "Dalmia_Odiya", "Dalmia_Tamil", "Dalmia_Telugu",
] as const;

/** Display name for a campaign ("Dalmia_Bengoli" is the dialer's own spelling of Bengali). */
export const languageName = (campaign: string): string => {
  const n = campaign.replace(/^Dalmia_/i, "");
  return n.toLowerCase() === "bengoli" ? "Bengali" : n;
};

export const THRESHOLD_SECONDS = 20;

export interface IbCall {
  date: string; agentId: string; campaign: string; phone: string; disconnBy: string;
  callDurSec: number; queueSec: number; acwSec: number; call20: number;
}
export interface DdRow {
  date: string; sourceOfLead: string | null; scenario: string | null; sub1: string | null; sub2: string | null;
  sub3: string | null; status: string | null; typeOfLeads: string | null; leads: string | null; mt: number; converted: number;
}
export interface ObRow { date: string; mobile: string | null; status: string | null; remarks: string | null }

/** The workbook's hidden "Leads" sheet: SUB SCENARIO 3 -> Type Of Leads + Qualified flag. */
export const LEADS_MAP: Record<string, { type: string; leads: "Qualified Leads" | "Not Qualified Leads" }> = {
  "account settlement complain": { type: "Complaint", leads: "Qualified Leads" },
  "cement lead": { type: "Retail", leads: "Qualified Leads" },
  "cement quality complain": { type: "Complaint", leads: "Qualified Leads" },
  "cement quality issue": { type: "Complaint", leads: "Qualified Leads" },
  "cement quality request": { type: "Complaint", leads: "Qualified Leads" },
  "cement rate query": { type: "Query", leads: "Qualified Leads" },
  "cement rate request": { type: "Query", leads: "Qualified Leads" },
  "dealership request": { type: "Dealership", leads: "Qualified Leads" },
  "logistic related complain": { type: "Complaint", leads: "Qualified Leads" },
  "logistic related query": { type: "Query", leads: "Qualified Leads" },
  "other": { type: "Query", leads: "Not Qualified Leads" },
  "quotation requested": { type: "Query", leads: "Qualified Leads" },
  "tech visit request": { type: "Complaint", leads: "Qualified Leads" },
  "request for aso number": { type: "Request", leads: "Qualified Leads" },
  "points and gifts related issue": { type: "Complaint", leads: "Qualified Leads" },
  "vehicle empanelment": { type: "Query", leads: "Not Qualified Leads" },
  "points & gifts related issue": { type: "Complaint", leads: "Qualified Leads" },
  "institutional sales": { type: "Request", leads: "Qualified Leads" },
  "request for tse number": { type: "Request", leads: "Qualified Leads" },
  "dealer code cancellation": { type: "Complaint", leads: "Qualified Leads" },
  "general enquiry": { type: "Query", leads: "Not Qualified Leads" },
  "marketing": { type: "Request", leads: "Qualified Leads" },
  "career query": { type: "Query", leads: "Not Qualified Leads" },
  "not related dalmia": { type: "Query", leads: "Not Qualified Leads" },
};

export const OUTBOUND_DISPOSITIONS = [
  "Assigned call back", "Call Disconnected after Opening", "Career Query Portal", "Ringing not answering",
  "Customer asked to Call Back later", "Irrelevant Query", "Transportation Tender Request",
  "Already Assigned call back", "Service Not Available", "Langauge barrier Assami",
] as const;

export const LEAD_SOURCES = ["Inbound", "Inbound After Hours", "Inbound Call Back", "Website", "WhatsApp"] as const;
export const LEAD_TYPES = ["Retail", "Dealership", "IS", "Query", "Complaint"] as const;

const norm = (v: string | null | undefined): string => (v ?? "").trim().toLowerCase();
const ratio = (num: number, den: number): number => (den > 0 ? num / den : 0);
const round1 = (v: number): number => Math.round(v * 10) / 10;

/* ------------------------------ buckets (MTD, W-1..W-5) ------------------------------ */

export type BucketKey = "MTD" | "W-1" | "W-2" | "W-3" | "W-4" | "W-5";
export const BUCKET_KEYS: BucketKey[] = ["MTD", "W-1", "W-2", "W-3", "W-4", "W-5"];

export function weekOfDate(iso: string): BucketKey {
  const day = Number(iso.slice(8, 10));
  return (day <= 7 ? "W-1" : day <= 14 ? "W-2" : day <= 21 ? "W-3" : day <= 28 ? "W-4" : "W-5") as BucketKey;
}
const inBucket = (date: string, key: BucketKey): boolean => key === "MTD" || weekOfDate(date) === key;

/* ---------------------------------- inbound ---------------------------------- */

export interface InboundTotals {
  offered: number; answered: number; unique: number; repeat: number; abandoned: number;
  ansInThreshold: number; abnInThreshold: number; talkSec: number; dispoSec: number; tagged: number;
  repeatPct: number; alPct: number; abnPct: number; slPct: number; achtSec: number; taggingPct: number;
}

interface InboundAcc {
  offered: number; answered: number; unique: number; ansInThreshold: number; abnInThreshold: number; talkSec: number; dispoSec: number;
}
const emptyAcc = (): InboundAcc => ({ offered: 0, answered: 0, unique: 0, ansInThreshold: 0, abnInThreshold: 0, talkSec: 0, dispoSec: 0 });

export const isAnswered = (c: IbCall): boolean => ["CALLER", "AGENT", "NONE"].includes(c.disconnBy.trim().toUpperCase());
const isVdcl = (c: IbCall): boolean => c.agentId.trim() === "VDCL";

/** Per-date inbound accumulators. Unique = distinct phones that date; Repeat = the remaining calls. */
export function inboundByDate(calls: IbCall[]): Map<string, InboundAcc> {
  const byDate = new Map<string, InboundAcc>();
  const phones = new Map<string, Set<string>>();
  for (const c of calls) {
    const a = byDate.get(c.date) ?? emptyAcc();
    a.offered++;
    const answered = isAnswered(c);
    if (answered) a.answered++;
    const seen = phones.get(c.date) ?? new Set<string>();
    if (!seen.has(c.phone)) { seen.add(c.phone); a.unique++; }
    phones.set(c.date, seen);
    if (answered && !isVdcl(c)) a.ansInThreshold += c.call20;
    if (!answered && c.queueSec <= THRESHOLD_SECONDS) a.abnInThreshold++;
    if (answered) { a.talkSec += c.callDurSec; a.dispoSec += c.acwSec; }
    byDate.set(c.date, a);
  }
  return byDate;
}

export interface DayInbound extends InboundTotals { date: string }

export function finishInbound(a: InboundAcc, tagged: number): InboundTotals {
  const repeat = a.offered - a.unique;
  const abandoned = a.offered - a.answered;
  return {
    offered: a.offered, answered: a.answered, unique: a.unique, repeat, abandoned,
    ansInThreshold: a.ansInThreshold, abnInThreshold: a.abnInThreshold, talkSec: a.talkSec, dispoSec: a.dispoSec, tagged,
    repeatPct: ratio(repeat, a.unique + repeat),
    alPct: ratio(a.answered, a.offered),
    abnPct: ratio(abandoned, a.offered),
    slPct: ratio(a.ansInThreshold, a.offered - a.abnInThreshold),
    achtSec: ratio(a.talkSec + a.dispoSec, a.answered),
    taggingPct: ratio(tagged, a.answered),
  };
}

/** Days with calls, oldest first, each with its own derived metrics. */
export function inboundDaily(calls: IbCall[], taggedByDate: Map<string, number>): DayInbound[] {
  return [...inboundByDate(calls).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, acc]) => ({ date, ...finishInbound(acc, taggedByDate.get(date) ?? 0) }));
}

/** MTD / W-1..W-5 totals: raw sums first, ratios derived from the sums (never averaged across days). */
export function inboundBuckets(calls: IbCall[], taggedByDate: Map<string, number>): Record<BucketKey, InboundTotals> {
  const perDate = inboundByDate(calls);
  const out = {} as Record<BucketKey, InboundTotals>;
  for (const key of BUCKET_KEYS) {
    const acc = emptyAcc();
    let tagged = 0;
    for (const [date, a] of perDate) {
      if (!inBucket(date, key)) continue;
      acc.offered += a.offered; acc.answered += a.answered; acc.unique += a.unique; acc.ansInThreshold += a.ansInThreshold;
      acc.abnInThreshold += a.abnInThreshold; acc.talkSec += a.talkSec; acc.dispoSec += a.dispoSec;
    }
    for (const [date, n] of taggedByDate) if (inBucket(date, key)) tagged += n;
    out[key] = finishInbound(acc, tagged);
  }
  return out;
}

export interface LanguageRow {
  campaign: string; language: string; abandon: number; caller: number; total: number;
  answered: number; threshold: number; alPct: number; abnPct: number;
}

export function languageTable(calls: IbCall[], key: BucketKey): LanguageRow[] {
  const rows = new Map<string, LanguageRow>();
  for (const c of DALMIA_CAMPAIGNS) {
    rows.set(c, { campaign: c, language: languageName(c), abandon: 0, caller: 0, total: 0, answered: 0, threshold: 0, alPct: 0, abnPct: 0 });
  }
  for (const c of calls) {
    if (!inBucket(c.date, key)) continue;
    const r = rows.get(c.campaign);
    if (!r) continue;
    r.total++;
    const d = c.disconnBy.trim().toUpperCase();
    if (d === "ABANDON") r.abandon++;
    if (d === "CALLER") r.caller++;
    if (!isVdcl(c)) r.answered++;
    if (c.queueSec <= THRESHOLD_SECONDS) r.threshold++;
  }
  return [...rows.values()].map((r) => ({ ...r, alPct: ratio(r.answered, r.total), abnPct: ratio(r.abandon, r.total) }));
}

/* ---------------------------------- outbound ---------------------------------- */

export interface OutboundTotals { overall: number; unique: number; connected: number; conPct: number; uniquePct: number }

export function outboundBuckets(rows: ObRow[]): Record<BucketKey, OutboundTotals> {
  const out = {} as Record<BucketKey, OutboundTotals>;
  for (const key of BUCKET_KEYS) {
    const mobiles = new Map<string, Set<string>>();
    let overall = 0, connected = 0;
    for (const r of rows) {
      if (!inBucket(r.date, key)) continue;
      overall++;
      if (norm(r.status) === "contact") connected++;
      const set = mobiles.get(r.date) ?? new Set<string>();
      set.add(r.mobile ?? `__row${overall}`);
      mobiles.set(r.date, set);
    }
    const unique = [...mobiles.values()].reduce((n, s) => n + s.size, 0);
    out[key] = { overall, unique, connected, conPct: ratio(connected, overall), uniquePct: ratio(unique, overall) };
  }
  return out;
}

export interface DispositionRow { name: string; count: number }

/** Remarks of the "Contact" rows; anything outside the workbook's ten named dispositions is grouped as "Other" so the total is the connected count. */
export function outboundDispositions(rows: ObRow[], key: BucketKey): DispositionRow[] {
  const counts = new Map<string, number>(OUTBOUND_DISPOSITIONS.map((d) => [norm(d), 0]));
  let other = 0;
  for (const r of rows) {
    if (!inBucket(r.date, key) || norm(r.status) !== "contact") continue;
    const k = norm(r.remarks);
    if (counts.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1); else other++;
  }
  const named = OUTBOUND_DISPOSITIONS.map((name) => ({ name, count: counts.get(norm(name)) ?? 0 }));
  return other > 0 ? [...named, { name: "Other remarks", count: other }] : named;
}

/* ------------------------------------- QRC ------------------------------------- */

export type QrcKey = "Query" | "Complain" | "Request";
export const QRC_KEYS: QrcKey[] = ["Query", "Complain", "Request"];

export function qrcDaily(rows: DdRow[]): Array<{ date: string } & Record<QrcKey, number>> {
  const by = new Map<string, Record<QrcKey, number>>();
  for (const r of rows) {
    const k = QRC_KEYS.find((q) => norm(r.sub1) === norm(q));
    if (!k) continue;
    const cur = by.get(r.date) ?? { Query: 0, Complain: 0, Request: 0 };
    cur[k]++;
    by.set(r.date, cur);
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v }));
}

export function qrcBuckets(rows: DdRow[]): Record<BucketKey, Record<QrcKey, number> & { total: number }> {
  const out = {} as Record<BucketKey, Record<QrcKey, number> & { total: number }>;
  for (const key of BUCKET_KEYS) {
    const v = { Query: 0, Complain: 0, Request: 0, total: 0 };
    for (const r of rows) {
      if (!inBucket(r.date, key)) continue;
      const k = QRC_KEYS.find((q) => norm(r.sub1) === norm(q));
      if (k) { v[k]++; v.total++; }
    }
    out[key] = v;
  }
  return out;
}

/* ------------------------------------ leads ------------------------------------ */

/** Type Of Leads + Qualified flag for a DD row: the row's own values if the sheet carried them, else the Leads mapping of SUB SCENARIO 3. */
export function leadInfo(r: DdRow): { type: string | null; qualified: boolean } {
  const mapped = LEADS_MAP[norm(r.sub3)];
  const type = (r.typeOfLeads ?? "").trim() || mapped?.type || null;
  const leads = (r.leads ?? "").trim() || mapped?.leads || "";
  return { type, qualified: norm(leads) === "qualified leads" };
}

export interface LeadSourceRow { source: string; dataReceived: number; connected: number; qualified: number }
export interface LeadsSummary {
  sources: LeadSourceRow[];
  total: { dataReceived: number; connected: number; qualified: number };
  byType: Array<{ type: string; count: number }>;
  status: { open: number; closed: number; converted: number; mt: number };
}

export function leadsSummary(rows: DdRow[], key: BucketKey): LeadsSummary {
  const sources = new Map<string, LeadSourceRow>(LEAD_SOURCES.map((s) => [norm(s), { source: s, dataReceived: 0, connected: 0, qualified: 0 }]));
  const types = new Map<string, number>(LEAD_TYPES.map((t) => [t, 0]));
  const status = { open: 0, closed: 0, converted: 0, mt: 0 };
  for (const r of rows) {
    if (!inBucket(r.date, key)) continue;
    const src = sources.get(norm(r.sourceOfLead));
    const info = leadInfo(r);
    if (src) {
      src.dataReceived++;
      if (norm(r.scenario) === "connected") src.connected++;
      if (info.qualified) src.qualified++;
    }
    if (!info.qualified) continue;
    const t = norm(r.sub2) === "institutional sales" ? "IS" : info.type;
    if (t && types.has(t)) types.set(t, (types.get(t) ?? 0) + 1);
    const st = norm(r.status);
    if (st === "open") status.open++;
    if (st === "closed") status.closed++;
    status.converted += r.converted;
    status.mt += r.mt;
  }
  const list = [...sources.values()];
  return {
    sources: list,
    total: {
      dataReceived: list.reduce((n, s) => n + s.dataReceived, 0),
      connected: list.reduce((n, s) => n + s.connected, 0),
      qualified: list.reduce((n, s) => n + s.qualified, 0),
    },
    byType: LEAD_TYPES.map((type) => ({ type, count: types.get(type) ?? 0 })),
    status: { ...status, mt: round1(status.mt) },
  };
}

/* ---------------------------------- DD taggging ---------------------------------- */

/** DD rows whose Source of Lead is "Inbound", per call date -- the workbook's Tagging row. */
export function taggedInboundByDate(rows: DdRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) if (norm(r.sourceOfLead) === "inbound") m.set(r.date, (m.get(r.date) ?? 0) + 1);
  return m;
}

/* ------------------- per-date detail sets (feed the dashboard's row drill-downs) ------------------- */

export interface LanguageDay { date: string; campaign: string; total: number; answered: number; abandon: number; caller: number }

/** Per date x campaign: the language table's own counts, so a language row can show its date-wise / week-wise detail. */
export function languageDaily(calls: IbCall[]): LanguageDay[] {
  const m = new Map<string, LanguageDay>();
  for (const c of calls) {
    const key = `${c.date}|${c.campaign}`;
    const r = m.get(key) ?? { date: c.date, campaign: c.campaign, total: 0, answered: 0, abandon: 0, caller: 0 };
    r.total++;
    const d = c.disconnBy.trim().toUpperCase();
    if (d === "ABANDON") r.abandon++;
    if (d === "CALLER") r.caller++;
    if (!isVdcl(c)) r.answered++;
    m.set(key, r);
  }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date) || a.campaign.localeCompare(b.campaign));
}

export interface OutboundDay { date: string; overall: number; unique: number; connected: number }

export function outboundDaily(rows: ObRow[]): OutboundDay[] {
  const by = new Map<string, { overall: number; connected: number; mobiles: Set<string> }>();
  let seq = 0;
  for (const r of rows) {
    const cur = by.get(r.date) ?? { overall: 0, connected: 0, mobiles: new Set<string>() };
    cur.overall++;
    if (norm(r.status) === "contact") cur.connected++;
    cur.mobiles.add(r.mobile ?? `__row${seq++}`);
    by.set(r.date, cur);
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, overall: v.overall, unique: v.mobiles.size, connected: v.connected }));
}

export interface LeadDay { date: string; source: string; dataReceived: number; connected: number; qualified: number }

export function leadsDaily(rows: DdRow[]): LeadDay[] {
  const m = new Map<string, LeadDay>();
  for (const r of rows) {
    const src = LEAD_SOURCES.find((s) => norm(s) === norm(r.sourceOfLead));
    if (!src) continue;
    const key = `${r.date}|${src}`;
    const cur = m.get(key) ?? { date: r.date, source: src, dataReceived: 0, connected: 0, qualified: 0 };
    cur.dataReceived++;
    if (norm(r.scenario) === "connected") cur.connected++;
    if (leadInfo(r).qualified) cur.qualified++;
    m.set(key, cur);
  }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source));
}
