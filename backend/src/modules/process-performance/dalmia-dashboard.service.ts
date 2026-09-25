import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getDialerPool } from "../../db/dialerDb.js";
import {
  DALMIA_CAMPAIGNS, BUCKET_KEYS, inboundBuckets, inboundDaily, languageTable, outboundBuckets, outboundDispositions, qrcBuckets,
  qrcDaily, leadsSummary, taggedInboundByDate, weekOfDate, languageDaily, outboundDaily, leadsDaily,
  type BucketKey, type IbCall, type DdRow, type ObRow, type InboundTotals, type DayInbound, type LanguageRow, type OutboundTotals,
  type DispositionRow, type LeadsSummary, type LanguageDay, type OutboundDay, type LeadDay,
} from "./dalmia-dashboard.calc.js";

/**
 * Dalmia Cement "Inbound & Outbound Performance Dashboard".
 *
 * Sources (all read-only here):
 *  - Inbound calls: dialer_db.cdr_in_249, the live CDR for the ten Dalmia_* language campaigns. This is the same data the
 *    workbook's hand-pasted "IB CDR Raw" sheet carried (retracted as a duplicate table on 2026-09-10; the Sep 1 figures
 *    69 offered / 65 answered match the workbook exactly).
 *  - DD (disposition detail) -> Tagging, QRC and Leads:   mas_hrms.dalmia_dd_raw      (uploader "dalmia_daildesk")
 *  - Outbound enquiries:                                   mas_hrms.dalmia_outbound_raw (uploader "Outbound")
 *  - Utilization:                                          db_masmis.dalmia_apr_raw    (uploader "dalmia_apr")
 * Definitions and their workbook provenance are documented in dalmia-dashboard.calc.ts. Until a month's DD / Outbound / APR
 * sheets are uploaded, the sections built on them honestly read zero / "not uploaded" -- nothing is estimated.
 */

const pad2 = (n: number): string => String(n).padStart(2, "0");
const localISO = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface DalmiaBucketInfo { key: BucketKey; label: string; from: string; to: string; days: number }

export interface DalmiaDashboardData {
  month: string; from: string; to: string;
  /** MTD plus every week that has at least one day in [from, to]. */
  buckets: DalmiaBucketInfo[];
  inbound: { daily: DayInbound[]; byBucket: Record<BucketKey, InboundTotals> };
  languages: Record<BucketKey, LanguageRow[]>;
  /** Per date x language -- the language table's date-wise detail. */
  languagesDaily: LanguageDay[];
  outbound: { byBucket: Record<BucketKey, OutboundTotals>; dispositions: Record<BucketKey, DispositionRow[]>; daily: OutboundDay[] };
  qrc: { daily: ReturnType<typeof qrcDaily>; byBucket: ReturnType<typeof qrcBuckets> };
  leads: Record<BucketKey, LeadsSummary>;
  /** Per date x lead source -- the lead-source table's date-wise detail. */
  leadsDaily: LeadDay[];
  /** Average of the APR sheet's own daily Utilization %, per bucket; null when no APR rows are uploaded for it. */
  utilization: Record<BucketKey, number | null>;
  dataStatus: {
    inboundRows: number; ddRows: number; outboundRows: number; aprRows: number | null;
    notes: string[];
  };
}

function monthBounds(month: string): { first: string; last: string } {
  const y = Number(month.slice(0, 4)); const m = Number(month.slice(5, 7));
  const last = new Date(y, m, 0).getDate();
  return { first: `${month}-01`, last: `${month}-${pad2(last)}` };
}

/** "00:00:34" / "00:00:00.00" -> seconds. */
export function hmsToSeconds(raw: unknown): number {
  const m = /^(\d+):(\d{1,2}):(\d{1,2})(?:\.\d+)?$/.exec(String(raw ?? "").trim());
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}
const numOr0 = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

async function loadInbound(from: string, to: string): Promise<IbCall[]> {
  const pool = await getDialerPool();
  const ph = DALMIA_CAMPAIGNS.map(() => "?").join(",");
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(CallDate, '%Y-%m-%d') AS d, AgentId, CampaignName, PhoneNumber, DisconnBy,
            CallDurationSecond, QueueDuration, Acwduration, Call20Sec
       FROM cdr_in_249
      WHERE CampaignName IN (${ph}) AND CallDate BETWEEN ? AND ?`,
    [...DALMIA_CAMPAIGNS, from, to],
  );
  return rows.map((r) => ({
    date: String(r.d), agentId: String(r.AgentId ?? ""), campaign: String(r.CampaignName ?? ""), phone: String(r.PhoneNumber ?? ""),
    disconnBy: String(r.DisconnBy ?? ""), callDurSec: numOr0(r.CallDurationSecond), queueSec: hmsToSeconds(r.QueueDuration),
    acwSec: hmsToSeconds(r.Acwduration), call20: numOr0(r.Call20Sec),
  }));
}

async function loadDd(from: string, to: string): Promise<DdRow[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(report_date, '%Y-%m-%d') AS d, source_of_lead, scenario, sub_scenario_1, sub_scenario_2, sub_scenario_3,
            status, type_of_leads, leads, mt, converted
       FROM dalmia_dd_raw WHERE report_date BETWEEN ? AND ?`,
    [from, to],
  );
  return rows.map((r) => ({
    date: String(r.d), sourceOfLead: r.source_of_lead ?? null, scenario: r.scenario ?? null, sub1: r.sub_scenario_1 ?? null,
    sub2: r.sub_scenario_2 ?? null, sub3: r.sub_scenario_3 ?? null, status: r.status ?? null, typeOfLeads: r.type_of_leads ?? null,
    leads: r.leads ?? null, mt: numOr0(r.mt), converted: numOr0(r.converted),
  }));
}

async function loadOutbound(from: string, to: string): Promise<ObRow[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(report_date, '%Y-%m-%d') AS d, mobile, status, remarks FROM dalmia_outbound_raw WHERE report_date BETWEEN ? AND ?`,
    [from, to],
  );
  return rows.map((r) => ({ date: String(r.d), mobile: r.mobile ?? null, status: r.status ?? null, remarks: r.remarks ?? null }));
}

/** db_masmis.dalmia_apr_raw is created by sql/1894 -- absent until that migration is applied, which must not break the dashboard. */
async function loadUtilization(from: string, to: string): Promise<Array<{ date: string; pct: number }> | null> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(report_date, '%Y-%m-%d') AS d, utilization_pct FROM db_masmis.dalmia_apr_raw
        WHERE report_date BETWEEN ? AND ? AND utilization_pct IS NOT NULL`,
      [from, to],
    );
    return rows.map((r) => ({ date: String(r.d), pct: numOr0(r.utilization_pct) }));
  } catch {
    return null;
  }
}

export async function getDalmiaDashboard(monthInput?: string, fromInput?: string, toInput?: string): Promise<DalmiaDashboardData> {
  const now = new Date();
  const month = monthInput && MONTH_RE.test(monthInput) ? monthInput : `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  const { first, last } = monthBounds(month);
  const today = localISO(now);
  let from = fromInput && DATE_RE.test(fromInput) ? fromInput : first;
  let to = toInput && DATE_RE.test(toInput) ? toInput : (last > today ? today : last);
  // Everything is scoped to the chosen month (the workbook is one month per file).
  if (from < first) from = first;
  if (to > last) to = last;
  if (to < from) to = from;

  const [ib, dd, ob, apr] = await Promise.all([loadInbound(from, to), loadDd(from, to), loadOutbound(from, to), loadUtilization(from, to)]);
  const tagged = taggedInboundByDate(dd);

  const buckets: DalmiaBucketInfo[] = BUCKET_KEYS.flatMap((key) => {
    const days: string[] = [];
    for (let d = new Date(`${from}T00:00:00`); localISO(d) <= to; d.setDate(d.getDate() + 1)) {
      const iso = localISO(d);
      if (key === "MTD" || weekOfDate(iso) === key) days.push(iso);
    }
    if (days.length === 0) return [];
    const label = key === "MTD" ? "MTD" : key;
    return [{ key, label, from: days[0], to: days[days.length - 1], days: days.length }];
  });

  const languages = {} as Record<BucketKey, LanguageRow[]>;
  const dispositions = {} as Record<BucketKey, DispositionRow[]>;
  const leads = {} as Record<BucketKey, LeadsSummary>;
  const utilization = {} as Record<BucketKey, number | null>;
  for (const key of BUCKET_KEYS) {
    languages[key] = languageTable(ib, key);
    dispositions[key] = outboundDispositions(ob, key);
    leads[key] = leadsSummary(dd, key);
    const inKey = (apr ?? []).filter((r) => key === "MTD" || weekOfDate(r.date) === key);
    utilization[key] = inKey.length > 0 ? Math.round((inKey.reduce((n, r) => n + r.pct, 0) / inKey.length) * 10) / 10 : null;
  }

  const notes: string[] = [];
  if (ib.length === 0) notes.push("No inbound CDR rows for this period in the dialer (dialer_db.cdr_in_249, Dalmia_* campaigns).");
  else {
    // Sundays are the weekly off; any other day between the first and last day with calls that has none is a gap in the dialer feed.
    const withCalls = new Set(ib.map((c) => c.date));
    const lastCall = [...withCalls].sort().at(-1) as string;
    const gaps: string[] = [];
    for (let d = new Date(`${from}T00:00:00`); localISO(d) <= lastCall; d.setDate(d.getDate() + 1)) {
      const iso = localISO(d);
      if (d.getDay() !== 0 && !withCalls.has(iso)) gaps.push(`${Number(iso.slice(8, 10))} ${d.toLocaleDateString("en-IN", { month: "short" })}`);
    }
    if (gaps.length > 0) notes.push(`The dialer (dialer_db.cdr_in_249) has no Dalmia inbound calls for ${gaps.join(", ")} -- those days are missing from every inbound figure, so totals can sit below the business's own MIS if it counted them.`);
  }
  if (dd.length === 0) notes.push("No DD (dalmia_daildesk) rows are uploaded for this period, so Tagging, QRC and Leads read zero until that sheet is uploaded.");
  if (ob.length === 0) notes.push("No Outbound rows are uploaded for this period, so the Outbound section reads zero until that sheet is uploaded.");
  if (apr === null) notes.push("The dalmia_apr table does not exist yet (migration sql/1894 not applied), so Utilization is unavailable.");
  else if (apr.length === 0) notes.push("No dalmia_apr rows are uploaded for this period, so Utilization is unavailable.");

  return {
    month, from, to, buckets,
    inbound: { daily: inboundDaily(ib, tagged), byBucket: inboundBuckets(ib, tagged) },
    languages, languagesDaily: languageDaily(ib),
    outbound: { byBucket: outboundBuckets(ob), dispositions, daily: outboundDaily(ob) },
    qrc: { daily: qrcDaily(dd), byBucket: qrcBuckets(dd) },
    leads, leadsDaily: leadsDaily(dd), utilization,
    dataStatus: { inboundRows: ib.length, ddRows: dd.length, outboundRows: ob.length, aprRows: apr === null ? null : apr.length, notes },
  };
}
