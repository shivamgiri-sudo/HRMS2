import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getDialerPool } from "../../db/dialerDb.js";
import {
  DALMIA_CAMPAIGNS,
  BUCKET_KEYS,
  inboundBuckets,
  inboundDaily,
  languageTable,
  outboundBuckets,
  outboundDispositions,
  qrcBuckets,
  qrcDaily,
  leadsSummary,
  taggedInboundByDate,
  weekOfDate,
  languageDaily,
  outboundDaily,
  leadsDaily,
  type BucketKey,
  type IbCall,
  type DdRow,
  type ObRow,
  type InboundTotals,
  type DayInbound,
  type LanguageRow,
  type OutboundTotals,
  type DispositionRow,
  type LeadsSummary,
  type LanguageDay,
  type OutboundDay,
  type LeadDay,
} from "./dalmia-dashboard.calc.js";

/**
 * Dalmia Cement "Inbound & Outbound Performance Dashboard".
 *
 * Sources (all read-only here):
 *  - Inbound calls: dialer_db.cdr_in_249, the live CDR for the ten Dalmia_* language campaigns. This is the same data the
 *    workbook's hand-pasted "IB CDR Raw" sheet carried (retracted as a duplicate table on 2026-09-10; the Sep 1 figures
 *    69 offered / 65 answered match the workbook exactly).
 *  - DD (disposition detail) -> Tagging, QRC and Leads: as of 2026-10-01, read LIVE from dialer_db.data_master_in
 *    (WHERE ClientId = 417) instead of the staged mas_hrms.dalmia_dd_raw (uploader "dalmia_daildesk") -- same
 *    live-read pattern used for Satya Retail's Calls tab (satya-retail-report.service.ts). Field mapping, verified
 *    by content (field_master_in_12 has no metadata row for ClientId 417):
 *      Category1 -> SCENARIO ("Connected"/"Not Connected"/"Not Contact" -- calc.ts's leadsSummary/leadsDaily check
 *        scenario === "connected", which only makes sense against this field, not a business sub-category).
 *      Category2 -> SUB SCENARIO 1 (real values: Query/Request/Complain/Wrong No/... -- this is what actually
 *        drives QRC; an earlier version of this mapping put Category2 in SCENARIO and Category3 in SUB SCENARIO 1,
 *        which left QRC and the scenario="connected" check reading zero forever, since neither Category2 nor
 *        Category3 ever equals "Connected"/"Query"/"Complain"/"Request" under that shift. Fixed 2026-10-01.)
 *      Category3 -> SUB SCENARIO 2 (General Enquiry/Dealership Request/Institutional Sales/... -- also the field
 *        calc.ts's "IS" override checks via norm(sub2) === "institutional sales").
 *      Field10 -> Source of Lead (Inbound/Inbound After Hours/Inbound Call Back/Website/WhatsApp/Outbound/Off-Call
 *        -- exactly dalmia-dashboard.calc.ts's own LEAD_SOURCES list, confirmed by exact content match. An earlier
 *        version of this mapping treated Source of Lead as unavailable and left it NULL, which is why Tagging and
 *        the Leads tab's per-source breakdown read zero -- fixed 2026-10-01 alongside the Category shift above.)
 *      Field8 -> Status.
 *      Type Of Leads / Leads are computed straight from Category4 in SQL (the same mapping LEADS_MAP already encodes
 *      in dalmia-dashboard.calc.ts, keyed there on SUB SCENARIO 3 -- which has no live data at all, Category5 is
 *      always NULL for this client), so leadInfo()'s "row's own value wins over the map" rule picks these up directly.
 *    mas_hrms.dalmia_dd_raw itself is untouched and still fed by the manual Excel upload -- only this dashboard
 *    stopped reading it.
 *  - Outbound enquiries:                                   mas_hrms.dalmia_outbound_raw (uploader "Outbound")
 *  - Utilization:                                          db_masmis.dalmia_apr_raw    (uploader "dalmia_apr")
 * Definitions and their workbook provenance are documented in dalmia-dashboard.calc.ts. Until a month's Outbound / APR
 * sheets are uploaded, the sections built on them honestly read zero / "not uploaded" -- nothing is estimated.
 */

const DALMIA_CLIENT_ID = 417;

/**
 * Category4 -> Type Of Leads / Leads qualification, mirroring dalmia-dashboard.calc.ts's own LEADS_MAP exactly
 * (that map is keyed on SUB SCENARIO 3, which has no live data for this client -- so the mapping is reproduced here
 * in SQL instead, against the live Category4 values that carry the same information).
 */
const TYPE_OF_LEADS_CASE = `CASE
  WHEN Category4 = 'Account Settlement Complain' THEN 'Complaint'
  WHEN Category4 = 'Cement Lead' THEN 'Retail'
  WHEN Category4 = 'Cement Quality Complain' THEN 'Complaint'
  WHEN Category4 = 'Cement Quality Issue' THEN 'Complaint'
  WHEN Category4 = 'Cement Quality Request' THEN 'Complaint'
  WHEN Category4 = 'Cement Rate Query' THEN 'Query'
  WHEN Category4 = 'CEMENT RATE REQUEST' THEN 'Query'
  WHEN Category4 = 'Dealership Request' THEN 'Dealership'
  WHEN Category4 = 'Logistic Related Complain' THEN 'Complaint'
  WHEN Category4 = 'Logistic Related query' THEN 'Query'
  WHEN Category4 = 'Other' THEN 'Query'
  WHEN Category4 = 'Quotation Requested' THEN 'Query'
  WHEN Category4 = 'Tech visit Request' THEN 'Complaint'
  WHEN Category4 = 'Request for ASO Number' THEN 'Request'
  WHEN Category4 = 'Points and Gifts Related Issue' THEN 'Complaint'
  WHEN Category4 = 'Vehicle Empanelment' THEN 'Query'
  WHEN Category4 = 'Points & Gifts related Issue' THEN 'Complaint'
  WHEN Category4 = 'Institutional Sales' THEN 'Request'
  WHEN Category4 = 'Request for TSE Number' THEN 'Request'
  WHEN Category4 = 'Dealer Code Cancellation' THEN 'Complaint'
  WHEN Category4 = 'General Enquiry' THEN 'Query'
  WHEN Category4 = 'Marketing' THEN 'Request'
  WHEN Category4 = 'Career Query' THEN 'Query'
  WHEN Category4 = 'Not Related Dalmia' THEN 'Query'
  ELSE NULL
END`;
const LEADS_QUALIFIED_CASE = `CASE
  WHEN Category4 IN (
    'Account Settlement Complain','Cement Lead','Cement Quality Complain','Cement Quality Issue','Cement Quality Request',
    'Cement Rate Query','CEMENT RATE REQUEST','Dealership Request','Logistic Related Complain','Logistic Related query',
    'Quotation Requested','Tech visit Request','Request for ASO Number','Points and Gifts Related Issue',
    'Points & Gifts related Issue','Institutional Sales','Request for TSE Number','Dealer Code Cancellation','Marketing'
  ) THEN 'Qualified Leads'
  WHEN Category4 IN ('Other','Vehicle Empanelment','General Enquiry','Career Query','Not Related Dalmia') THEN 'Not Qualified Leads'
  ELSE NULL
END`;

const pad2 = (n: number): string => String(n).padStart(2, "0");
const localISO = (d: Date): string =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface DalmiaBucketInfo {
  key: BucketKey;
  label: string;
  from: string;
  to: string;
  days: number;
}

export interface DalmiaDashboardData {
  month: string;
  from: string;
  to: string;
  /** MTD plus every week that has at least one day in [from, to]. */
  buckets: DalmiaBucketInfo[];
  inbound: { daily: DayInbound[]; byBucket: Record<BucketKey, InboundTotals> };
  languages: Record<BucketKey, LanguageRow[]>;
  /** Per date x language -- the language table's date-wise detail. */
  languagesDaily: LanguageDay[];
  outbound: {
    byBucket: Record<BucketKey, OutboundTotals>;
    dispositions: Record<BucketKey, DispositionRow[]>;
    daily: OutboundDay[];
  };
  qrc: {
    daily: ReturnType<typeof qrcDaily>;
    byBucket: ReturnType<typeof qrcBuckets>;
  };
  leads: Record<BucketKey, LeadsSummary>;
  /** Per date x lead source -- the lead-source table's date-wise detail. */
  leadsDaily: LeadDay[];
  /** Average of the APR sheet's own daily Utilization %, per bucket; null when no APR rows are uploaded for it. */
  utilization: Record<BucketKey, number | null>;
  dataStatus: {
    inboundRows: number;
    ddRows: number;
    outboundRows: number;
    aprRows: number | null;
    notes: string[];
  };
}

function monthBounds(month: string): { first: string; last: string } {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const last = new Date(y, m, 0).getDate();
  return { first: `${month}-01`, last: `${month}-${pad2(last)}` };
}

/** "00:00:34" / "00:00:00.00" -> seconds. */
export function hmsToSeconds(raw: unknown): number {
  const m = /^(\d+):(\d{1,2}):(\d{1,2})(?:\.\d+)?$/.exec(
    String(raw ?? "").trim(),
  );
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}
const numOr0 = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

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
    date: String(r.d),
    agentId: String(r.AgentId ?? ""),
    campaign: String(r.CampaignName ?? ""),
    phone: String(r.PhoneNumber ?? ""),
    disconnBy: String(r.DisconnBy ?? ""),
    callDurSec: numOr0(r.CallDurationSecond),
    queueSec: hmsToSeconds(r.QueueDuration),
    acwSec: hmsToSeconds(r.Acwduration),
    call20: numOr0(r.Call20Sec),
  }));
}

async function loadDd(from: string, to: string): Promise<DdRow[]> {
  const pool = await getDialerPool();
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(CallDate, '%Y-%m-%d') AS d, Field10 AS source_of_lead, Category1 AS scenario,
            Category2 AS sub1, Category3 AS sub2, Field8 AS status,
            ${TYPE_OF_LEADS_CASE} AS type_of_leads, ${LEADS_QUALIFIED_CASE} AS leads
       FROM dialer_db.data_master_in
      WHERE ClientId = ? AND CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)`,
    [DALMIA_CLIENT_ID, from, to],
  );
  return rows.map((r) => ({
    date: String(r.d), sourceOfLead: r.source_of_lead ?? null, scenario: r.scenario ?? null, sub1: r.sub1 ?? null,
    sub2: r.sub2 ?? null, sub3: null, status: r.status ?? null, typeOfLeads: r.type_of_leads ?? null,
    leads: r.leads ?? null, mt: 0, converted: 0,
  }));
}

async function loadOutbound(from: string, to: string): Promise<ObRow[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(report_date, '%Y-%m-%d') AS d, mobile, status, remarks FROM dalmia_outbound_raw WHERE report_date BETWEEN ? AND ?`,
    [from, to],
  );
  return rows.map((r) => ({
    date: String(r.d),
    mobile: r.mobile ?? null,
    status: r.status ?? null,
    remarks: r.remarks ?? null,
  }));
}

/** db_masmis.dalmia_apr_raw is created by sql/1894 -- absent until that migration is applied, which must not break the dashboard. */
async function loadUtilization(
  from: string,
  to: string,
): Promise<Array<{ date: string; pct: number }> | null> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(report_date, '%Y-%m-%d') AS d, utilization_pct FROM db_masmis.dalmia_apr_raw
        WHERE report_date BETWEEN ? AND ? AND utilization_pct IS NOT NULL`,
      [from, to],
    );
    return rows.map((r) => ({
      date: String(r.d),
      pct: numOr0(r.utilization_pct),
    }));
  } catch {
    return null;
  }
}

export async function getDalmiaDashboard(
  monthInput?: string,
  fromInput?: string,
  toInput?: string,
): Promise<DalmiaDashboardData> {
  const now = new Date();
  const month =
    monthInput && MONTH_RE.test(monthInput)
      ? monthInput
      : `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  const { first, last } = monthBounds(month);
  const today = localISO(now);
  let from = fromInput && DATE_RE.test(fromInput) ? fromInput : first;
  let to =
    toInput && DATE_RE.test(toInput) ? toInput : last > today ? today : last;
  // Everything is scoped to the chosen month (the workbook is one month per file).
  if (from < first) from = first;
  if (to > last) to = last;
  if (to < from) to = from;

  const [ib, dd, ob, apr] = await Promise.all([
    loadInbound(from, to),
    loadDd(from, to),
    loadOutbound(from, to),
    loadUtilization(from, to),
  ]);
  const tagged = taggedInboundByDate(dd);

  const buckets: DalmiaBucketInfo[] = BUCKET_KEYS.flatMap((key) => {
    const days: string[] = [];
    for (
      let d = new Date(`${from}T00:00:00`);
      localISO(d) <= to;
      d.setDate(d.getDate() + 1)
    ) {
      const iso = localISO(d);
      if (key === "MTD" || weekOfDate(iso) === key) days.push(iso);
    }
    if (days.length === 0) return [];
    const label = key === "MTD" ? "MTD" : key;
    return [
      {
        key,
        label,
        from: days[0],
        to: days[days.length - 1],
        days: days.length,
      },
    ];
  });

  const languages = {} as Record<BucketKey, LanguageRow[]>;
  const dispositions = {} as Record<BucketKey, DispositionRow[]>;
  const leads = {} as Record<BucketKey, LeadsSummary>;
  const utilization = {} as Record<BucketKey, number | null>;
  for (const key of BUCKET_KEYS) {
    languages[key] = languageTable(ib, key);
    dispositions[key] = outboundDispositions(ob, key);
    leads[key] = leadsSummary(dd, key);
    const inKey = (apr ?? []).filter(
      (r) => key === "MTD" || weekOfDate(r.date) === key,
    );
    utilization[key] =
      inKey.length > 0
        ? Math.round(
            (inKey.reduce((n, r) => n + r.pct, 0) / inKey.length) * 10,
          ) / 10
        : null;
  }

  const notes: string[] = [];
  if (ib.length === 0)
    notes.push(
      "No inbound CDR rows for this period in the dialer (dialer_db.cdr_in_249, Dalmia_* campaigns).",
    );
  else {
    // Sundays are the weekly off; any other day between the first and last day with calls that has none is a gap in the dialer feed.
    const withCalls = new Set(ib.map((c) => c.date));
    const lastCall = [...withCalls].sort().at(-1) as string;
    const gaps: string[] = [];
    for (
      let d = new Date(`${from}T00:00:00`);
      localISO(d) <= lastCall;
      d.setDate(d.getDate() + 1)
    ) {
      const iso = localISO(d);
      if (d.getDay() !== 0 && !withCalls.has(iso))
        gaps.push(
          `${Number(iso.slice(8, 10))} ${d.toLocaleDateString("en-IN", { month: "short" })}`,
        );
    }
    if (gaps.length > 0)
      notes.push(
        `The dialer (dialer_db.cdr_in_249) has no Dalmia inbound calls for ${gaps.join(", ")} -- those days are missing from every inbound figure, so totals can sit below the business's own MIS if it counted them.`,
      );
  }
  if (dd.length === 0) notes.push("No dial-desk disposition rows for this period in the dialer (dialer_db.data_master_in, ClientId 417), so Tagging, QRC and Leads read zero.");
  else notes.push("Lead status MT and Converted read zero: the live dial-desk data (dialer_db.data_master_in) carries neither field.");
  if (ob.length === 0) notes.push("No Outbound rows are uploaded for this period, so the Outbound section reads zero until that sheet is uploaded.");
  if (apr === null) notes.push("The dalmia_apr table does not exist yet (migration sql/1894 not applied), so Utilization is unavailable.");
  else if (apr.length === 0) notes.push("No dalmia_apr rows are uploaded for this period, so Utilization is unavailable.");

  return {
    month,
    from,
    to,
    buckets,
    inbound: {
      daily: inboundDaily(ib, tagged),
      byBucket: inboundBuckets(ib, tagged),
    },
    languages,
    languagesDaily: languageDaily(ib),
    outbound: {
      byBucket: outboundBuckets(ob),
      dispositions,
      daily: outboundDaily(ob),
    },
    qrc: { daily: qrcDaily(dd), byBucket: qrcBuckets(dd) },
    leads,
    leadsDaily: leadsDaily(dd),
    utilization,
    dataStatus: {
      inboundRows: ib.length,
      ddRows: dd.length,
      outboundRows: ob.length,
      aprRows: apr === null ? null : apr.length,
      notes,
    },
  };
}

export interface DalmiaAgentRow {
  empId: string; empName: string; lob: string | null;
  callsChats: number; loginSec: number; talkSec: number; dispoSec: number; breakSec: number;
  avgAchtSec: number | null; avgUtilizationPct: number | null; attendanceDays: number; daysReported: number;
}
export interface DalmiaAgentWiseData { from: string; to: string; agents: DalmiaAgentRow[] }

interface DalmiaAprAgentRow extends RowDataPacket {
  emp_id: string;
  emp_name: string | null;
  lob: string | null;
  calls_chats: string | null;
  login_time_sec: string | null;
  talk_sec: string | null;
  dispo_sec: string | null;
  total_break_sec: string | null;
  avg_acht_sec: string | null;
  avg_utilization_pct: string | null;
  attendance_days: string | null;
  days_reported: number;
}

/**
 * Agent-wise Performance, built entirely from db_masmis.dalmia_apr_raw
 * (uploader "dalmia_apr") -- the only Dalmia table with agent-level
 * granularity (emp_id/emp_name/lob per report_date row). Confirmed live
 * 2026-09-27: 172 rows across 9 agents for 2026-08-01..2026-09-22 -- real
 * but only as current as the last APR sheet upload, same honesty as the
 * dashboard's own Utilization figure (loadUtilization above).
 */
export async function getDalmiaAgentWise(fromInput: string, toInput: string): Promise<DalmiaAgentWiseData> {
  const now = new Date();
  const fallbackFrom = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`;
  const fallbackTo = localISO(now);
  const from = fromInput && DATE_RE.test(fromInput) ? fromInput : fallbackFrom;
  const to = toInput && DATE_RE.test(toInput) ? toInput : fallbackTo;

  const [rows] = await db.execute<DalmiaAprAgentRow[]>(
    `SELECT emp_id, MAX(emp_name) AS emp_name, MAX(lob) AS lob,
       SUM(calls_chats) AS calls_chats, SUM(login_time_sec) AS login_time_sec, SUM(talk_sec) AS talk_sec,
       SUM(dispo_sec) AS dispo_sec, SUM(total_break_sec) AS total_break_sec,
       AVG(acht_sec) AS avg_acht_sec, AVG(utilization_pct) AS avg_utilization_pct,
       SUM(attendance_days) AS attendance_days, COUNT(*) AS days_reported
     FROM db_masmis.dalmia_apr_raw
     WHERE report_date >= ? AND report_date < DATE_ADD(?, INTERVAL 1 DAY) AND emp_id IS NOT NULL AND emp_id != ''
     GROUP BY emp_id
     ORDER BY talk_sec DESC`,
    [from, to],
  );

  return {
    from, to,
    agents: rows.map((r) => ({
      empId: r.emp_id, empName: r.emp_name || r.emp_id, lob: r.lob,
      callsChats: numOr0(r.calls_chats), loginSec: numOr0(r.login_time_sec), talkSec: numOr0(r.talk_sec),
      dispoSec: numOr0(r.dispo_sec), breakSec: numOr0(r.total_break_sec),
      avgAchtSec: r.avg_acht_sec === null ? null : Math.round(numOr0(r.avg_acht_sec)),
      avgUtilizationPct: r.avg_utilization_pct === null ? null : Math.round(numOr0(r.avg_utilization_pct) * 10) / 10,
      attendanceDays: Math.round(numOr0(r.attendance_days) * 100) / 100, daysReported: r.days_reported,
    })),
  };
}
