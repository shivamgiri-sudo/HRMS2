import { db } from "../../db/mysql.js";

/**
 * Birlanu's lead-to-sale CRM dashboard, built directly from the real
 * db_masmis.birlanu_sale (~85 columns: lead intake, calling/qualification,
 * business/brand/product, geography, sale conversion, TAT/FRT SLA) and
 * db_masmis.birlanu_apr (agent productivity roster) uploaded via Uploader
 * -> Sale / APR. Confirmed live 2026-09-16: 15 real rows in each table (a
 * small real upload, not a full production feed yet -- every KPI below
 * will scale automatically as more is uploaded).
 *
 * birlanu_apr's own metric columns (total_calls, login_time, talk_time,
 * etc.) are NULL for all 15 current rows -- checked against
 * birlanu-apr-bulk.service.ts's column mapping, which looks correct (real
 * header aliases, not a guess), so this reads as the source file for this
 * particular batch genuinely not carrying productivity figures yet, not an
 * import bug. The Productivity section below reports that honestly rather
 * than fabricating numbers.
 */

const MONTH_ABBR: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function parseShortDate(raw: unknown): string | null {
  const m = String(raw ?? "").trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
  if (!m) return null;
  const month = MONTH_ABBR[m[2].toLowerCase()];
  if (!month) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `20${m[3]}-${pad(month)}-${pad(Number(m[1]))}`;
}

/** sale_inr/order_value arrive as either a plain number, a comma-formatted
 * Indian number ("2,32,000"), or the placeholder "-" for not-applicable. */
function parseInr(raw: unknown): number {
  const s = String(raw ?? "").trim();
  if (!s || s === "-" || s.toUpperCase() === "NA") return 0;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function clean(raw: unknown): string {
  const s = String(raw ?? "").trim();
  return s === "-" || s === "" ? "" : s;
}

const CONVERTED_STATUSES = new Set(["closed_with_order", "closed_with_dealership"]);
/** Reference workbook's "Leads Qualified" stage = Data!T (Sub Sub Calling
 * Status) = "Lead assign to Sales team" -- verified against Performance
 * Dashboard's H5 formula: COUNTIFS(Data!T:T,"lead assign to sales team", ...). */
const QUALIFIED_TEXT = "lead assign to sales team";

/** "Oct'25" / "Jan'26" -> {key: "2025-10", label: "Oct'25"} for chronological
 * sort + display, matching lead_register_month / lead_closer_month values. */
function parseMonthLabel(raw: unknown): { key: string; label: string } | null {
  const s = String(raw ?? "").trim();
  const m = s.match(/^([A-Za-z]{3})'(\d{2})$/);
  if (!m) return null;
  const month = MONTH_ABBR[m[1].toLowerCase()];
  if (!month) return null;
  const year = 2000 + Number(m[2]);
  return { key: `${year}-${String(month).padStart(2, "0")}`, label: s };
}

/** Fixed TAT bucket order matching the reference workbook's Lead TAT sheet
 * (0-30 Min through More Than 24 Hrs); any bucket text not in this list is
 * appended alphabetically rather than dropped, so a new bucket label never
 * silently disappears. */
const TAT_BUCKET_ORDER = [
  "0-30 Min", "30 Min-2hrs", "2hr-4hrs", "4hrs-6hrs", "6hrs-8hrs", "8hrs-10hrs",
  "10hrs-12hrs", "12hrs-14hrs", "14hrs-16hrs", "16hrs-18hrs", "18hrs-20hrs",
  "20hrs-22hrs", "22hrs-24hrs", "More Than 24 Hrs",
];

export interface BirlanuMonthlyFunnelRow {
  monthKey: string;
  month: string;
  enquiriesReceived: number;
  connected: number;
  connectedPct: number;
  validated: number;
  elvaPct: number;
  qualified: number;
  elqPct: number;
  converted: number;
  elcoPct: number;
  volMt: number;
  valueInr: number;
}

export interface BirlanuGroupRow {
  label: string;
  leads: number;
  connected: number;
  connectedPct: number;
  converted: number;
  conversionPct: number;
  saleValue: number;
}

export interface BirlanuDashboardData {
  headline: {
    totalLeads: number;
    connected: number;
    connectedPct: number;
    interested: number;
    interestedPct: number;
    converted: number;
    conversionPct: number;
    totalSaleValue: number;
    avgOrderValue: number;
    tatTracked: number;
    tatWithin: number;
    tatCompliancePct: number;
    /** Reference "Leads Qualified" stage (sub_sub_calling_status = "Lead
     * assign to Sales team") -- was not tracked anywhere in this dashboard
     * before; the column has been present in birlanu_sale since the first
     * upload. */
    qualified: number;
    qualifiedPct: number;
    /** Reference "Vol (in MT)" -- sum of sale_mt for converted leads. Was
     * not surfaced anywhere before, though the column exists on every row. */
    totalVolumeMt: number;
  };
  byLeadCloserStatus: { status: string; count: number; saleValue: number }[];
  byBusiness: BirlanuGroupRow[];
  byBrand: BirlanuGroupRow[];
  byEnquirySource: BirlanuGroupRow[];
  byOrganicPaid: BirlanuGroupRow[];
  byZone: BirlanuGroupRow[];
  byAgent: BirlanuGroupRow[];
  dailyTrend: { date: string; leads: number; saleValue: number }[];
  /** Performance Dashboard's core "Contact Center Flow" funnel, cohorted by
   * LeadRegisterMonth (Data!D) exactly as the reference workbook does --
   * previously this dashboard had no monthly/cohort view at all. */
  monthlyFunnel: BirlanuMonthlyFunnelRow[];
  /** Lead TAT sheet's bucket distribution (Data!BY / birlanu_sale.bucket)
   * -- previously only a single aggregate TAT-compliance % was shown. */
  tatBucketDistribution: { bucket: string; count: number }[];
  productivity: {
    agentsInRoster: number;
    agentsWithMetrics: number;
    note: string;
  };
}

interface SaleRow {
  report_date: unknown;
  calling_status: unknown;
  interested_status: unknown;
  sub_sub_calling_status: unknown;
  lead_closer_status: unknown;
  select_business: unknown;
  brand: unknown;
  enquiry_source: unknown;
  organic_paid: unknown;
  zone: unknown;
  agent_name: unknown;
  sale_mt: unknown;
  sale_inr: unknown;
  within_tat: unknown;
  bucket: unknown;
  lead_register_month: unknown;
}

function buildGroup(rows: SaleRow[], keyField: keyof SaleRow, fallback = "Unassigned"): BirlanuGroupRow[] {
  const map = new Map<string, { leads: number; connected: number; converted: number; saleValue: number }>();
  for (const r of rows) {
    const key = clean(r[keyField]) || fallback;
    const cur = map.get(key) ?? { leads: 0, connected: 0, converted: 0, saleValue: 0 };
    cur.leads += 1;
    if (String(r.calling_status).trim() === "Connect") cur.connected += 1;
    if (CONVERTED_STATUSES.has(String(r.lead_closer_status).trim())) cur.converted += 1;
    cur.saleValue += parseInr(r.sale_inr);
    map.set(key, cur);
  }
  return [...map.entries()]
    .map(([label, v]) => ({
      label,
      leads: v.leads,
      connected: v.connected,
      connectedPct: v.leads ? Math.round((v.connected / v.leads) * 10000) / 100 : 0,
      converted: v.converted,
      conversionPct: v.leads ? Math.round((v.converted / v.leads) * 10000) / 100 : 0,
      saleValue: v.saleValue,
    }))
    .sort((a, b) => b.saleValue - a.saleValue || b.leads - a.leads);
}

export async function getBirlanuDashboard(): Promise<BirlanuDashboardData> {
  const [saleRows] = await db.execute<any[]>(
    `SELECT report_date, calling_status, interested_status, sub_sub_calling_status, lead_closer_status,
            select_business, brand, enquiry_source, organic_paid, zone, agent_name, sale_mt, sale_inr,
            within_tat, bucket, lead_register_month
     FROM db_masmis.birlanu_sale`,
  );
  const rows = saleRows as SaleRow[];

  const totalLeads = rows.length;
  const connected = rows.filter((r) => String(r.calling_status).trim() === "Connect").length;
  const interested = rows.filter((r) => String(r.interested_status).trim() === "Interested").length;
  const isQualified = (r: SaleRow) => String(r.sub_sub_calling_status).trim().toLowerCase() === QUALIFIED_TEXT;
  const qualified = rows.filter(isQualified).length;
  const converted = rows.filter((r) => CONVERTED_STATUSES.has(String(r.lead_closer_status).trim())).length;
  const totalSaleValue = rows.reduce((s, r) => s + parseInr(r.sale_inr), 0);
  const totalVolumeMt = rows
    .filter((r) => CONVERTED_STATUSES.has(String(r.lead_closer_status).trim()))
    .reduce((s, r) => s + parseInr(r.sale_mt), 0);

  const tatRows = rows.filter((r) => clean(r.within_tat) !== "");
  const tatWithin = tatRows.filter((r) => String(r.within_tat).trim() !== "Out Of TAT").length;

  const tatBucketMap = new Map<string, number>();
  for (const r of rows) {
    const b = clean(r.bucket);
    if (!b) continue;
    tatBucketMap.set(b, (tatBucketMap.get(b) ?? 0) + 1);
  }
  const tatBucketDistribution = [...tatBucketMap.entries()]
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => {
      const ai = TAT_BUCKET_ORDER.indexOf(a.bucket);
      const bi = TAT_BUCKET_ORDER.indexOf(b.bucket);
      if (ai === -1 && bi === -1) return a.bucket.localeCompare(b.bucket);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

  const funnelMap = new Map<string, { label: string; rows: SaleRow[] }>();
  for (const r of rows) {
    const parsed = parseMonthLabel(r.lead_register_month);
    if (!parsed) continue;
    const cur = funnelMap.get(parsed.key) ?? { label: parsed.label, rows: [] };
    cur.rows.push(r);
    funnelMap.set(parsed.key, cur);
  }
  const monthlyFunnel: BirlanuMonthlyFunnelRow[] = [...funnelMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, { label, rows: mRows }]) => {
      const enquiriesReceived = mRows.length;
      const mConnected = mRows.filter((r) => String(r.calling_status).trim() === "Connect").length;
      const validated = mRows.filter((r) => String(r.interested_status).trim() === "Interested").length;
      const mQualified = mRows.filter(isQualified).length;
      const convertedRows = mRows.filter((r) => CONVERTED_STATUSES.has(String(r.lead_closer_status).trim()));
      const mConverted = convertedRows.length;
      const pct = (n: number) => (enquiriesReceived ? Math.round((n / enquiriesReceived) * 10000) / 100 : 0);
      return {
        monthKey,
        month: label,
        enquiriesReceived,
        connected: mConnected,
        connectedPct: pct(mConnected),
        validated,
        elvaPct: pct(validated),
        qualified: mQualified,
        elqPct: pct(mQualified),
        converted: mConverted,
        elcoPct: pct(mConverted),
        volMt: convertedRows.reduce((s, r) => s + parseInr(r.sale_mt), 0),
        valueInr: convertedRows.reduce((s, r) => s + parseInr(r.sale_inr), 0),
      };
    });

  const leadCloserMap = new Map<string, { count: number; saleValue: number }>();
  for (const r of rows) {
    const key = clean(r.lead_closer_status) || "Open / Pending";
    const cur = leadCloserMap.get(key) ?? { count: 0, saleValue: 0 };
    cur.count += 1;
    cur.saleValue += parseInr(r.sale_inr);
    leadCloserMap.set(key, cur);
  }

  const dailyMap = new Map<string, { leads: number; saleValue: number }>();
  for (const r of rows) {
    const d = parseShortDate(r.report_date);
    if (!d) continue;
    const cur = dailyMap.get(d) ?? { leads: 0, saleValue: 0 };
    cur.leads += 1;
    cur.saleValue += parseInr(r.sale_inr);
    dailyMap.set(d, cur);
  }

  const [aprRows] = await db.execute<any[]>(`SELECT agent_name, total_calls, login_time FROM db_masmis.birlanu_apr`);
  const agentsInRoster = new Set((aprRows as any[]).map((r) => String(r.agent_name).trim()).filter(Boolean)).size;
  const agentsWithMetrics = (aprRows as any[]).filter((r) => r.total_calls !== null || r.login_time !== null).length;

  return {
    headline: {
      totalLeads,
      connected,
      connectedPct: totalLeads ? Math.round((connected / totalLeads) * 10000) / 100 : 0,
      interested,
      interestedPct: totalLeads ? Math.round((interested / totalLeads) * 10000) / 100 : 0,
      converted,
      conversionPct: totalLeads ? Math.round((converted / totalLeads) * 10000) / 100 : 0,
      totalSaleValue,
      avgOrderValue: converted ? Math.round(totalSaleValue / converted) : 0,
      tatTracked: tatRows.length,
      tatWithin,
      tatCompliancePct: tatRows.length ? Math.round((tatWithin / tatRows.length) * 10000) / 100 : 0,
      qualified,
      qualifiedPct: totalLeads ? Math.round((qualified / totalLeads) * 10000) / 100 : 0,
      totalVolumeMt,
    },
    byLeadCloserStatus: [...leadCloserMap.entries()]
      .map(([status, v]) => ({ status, count: v.count, saleValue: v.saleValue }))
      .sort((a, b) => b.count - a.count),
    byBusiness: buildGroup(rows, "select_business"),
    byBrand: buildGroup(rows, "brand"),
    byEnquirySource: buildGroup(rows, "enquiry_source"),
    byOrganicPaid: buildGroup(rows, "organic_paid"),
    byZone: buildGroup(rows, "zone"),
    byAgent: buildGroup(rows, "agent_name"),
    dailyTrend: [...dailyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, leads: v.leads, saleValue: v.saleValue })),
    monthlyFunnel,
    tatBucketDistribution,
    productivity: {
      agentsInRoster,
      agentsWithMetrics,
      note: agentsWithMetrics === 0
        ? "Agent roster uploaded, but this batch's APR file did not carry call/login/talk-time figures -- productivity metrics will appear once an APR upload includes them."
        : `${agentsWithMetrics} of ${agentsInRoster} agents have productivity metrics in the latest upload.`,
    },
  };
}
