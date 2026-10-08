/**
 * Birlanu MIS -- pure aggregation over the lead rows of the reference workbook's
 * "Data" sheet (db_masmis.birlanu_sale). No database access here, so the very
 * same functions can be run against the workbook's own rows to prove they
 * reproduce its cached numbers (see scripts/verify-birlanu-mis.ts).
 *
 * Every builder mirrors one workbook sheet's COUNTIFS / SUMIFS logic; the
 * column letter of the source field is noted next to each Fact field.
 *
 *   Performance Dashboard      -> buildPerformance
 *   Business Dashboard         -> buildBusiness
 *   Channel Wise Disposition   -> buildDisposition
 *   Lead TAT                   -> buildLeadTat
 *   Enquiry Count - Channels   -> buildEnquiry
 *   Product Wise&Source-Revenue-> buildProductWise
 */

export interface Fact {
  regMonth: string;        // D  LeadRegisterMonth  "Apr'26"
  regKey: string;          //    "2026-04" sortable; "" when regMonth is unreadable
  regDate: string | null;  // E  register date (ISO)
  week: string;            // B  "Wk-1"
  source: string;          // L  Enquiry Source, canonicalised
  brand: string;           // AD Brand
  organicPaid: string;     // BQ "Organic" | "Paid" | "-"
  callType: string;        // P  "Inbound" | "Outbound"
  calling: string;         // Q  "Connect" | "Not Connect"
  interested: string;      // R
  sub: string;             // S  Sub Calling Status
  subSub: string;          // T  Sub Sub Calling Status (lower-cased)
  closer: string;          // AU Lead Closer Status (lower-cased)
  closerMonth: string;     // BP Lead Closer Month "Apr'26"
  closerKey: string;       //    "2026-04"
  seller: string;          // AS Seller email (closer identity)
  mt: number;              // BE Sale MT
  inr: number;             // BF Sale INR
  bucket: string;          // BY TAT bucket text
  frtHours: number | null; // BW first-response time, hours
}

export interface MisFilters {
  month?: string; week?: string; channel?: string; brand?: string;
  bau1?: string; bau2?: string; status?: string; closureMonth?: string;
}

/* ------------------------------ helpers ------------------------------ */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const low = (s: unknown) => String(s ?? "").trim().toLowerCase();
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);

/** "Apr'26" -> "2026-04" (sortable); "" when it is not a month label. */
export function monthKey(label: unknown): string {
  const m = String(label ?? "").trim().match(/^([A-Za-z]{3})'(\d{2})$/);
  if (!m) return "";
  const i = MONTHS.indexOf(m[1].toLowerCase());
  return i < 0 ? "" : `20${m[2]}-${String(i + 1).padStart(2, "0")}`;
}
export function keyToLabel(key: string): string {
  const [y, mo] = key.split("-").map(Number);
  const name = MONTHS[mo - 1];
  return `${name[0].toUpperCase()}${name.slice(1)}'${String(y).slice(2)}`;
}
const addMonths = (key: string, n: number) => {
  const [y, mo] = key.split("-").map(Number);
  const t = y * 12 + (mo - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
/** April-March financial year that contains `key`: the 12 month keys. */
export function fyKeys(key: string): string[] {
  const [y, mo] = key.split("-").map(Number);
  const startYear = mo >= 4 ? y : y - 1;
  return Array.from({ length: 12 }, (_, i) => addMonths(`${startYear}-04`, i));
}

const SOURCE_CANON: Record<string, string> = {
  indiamart: "IndiaMART", website: "WebSite", chatbot: "ChatBot", getdistributor: "GetDistributor", tradeindia: "TradeIndia",
  inbound: "Inbound", mail: "Mail", meta: "Meta", project: "Project", plantix: "Plantix", exhibition: "Exhibition", other: "Other",
  webscraping: "WebScraping", topline: "topline", social: "Social", website_google_ads: "Website_Google_Ads",
};
/** Excel's COUNTIFS is case-insensitive, so "IndiaMart" and "IndiaMART" are one source. */
export function canonSource(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (s === "" || s === "-") return "";
  return SOURCE_CANON[s.toLowerCase()] ?? s;
}

const CONVERTED = new Set(["closed_with_order", "closed_with_dealership"]);
const isConverted = (f: Fact) => CONVERTED.has(f.closer);
const isLas = (f: Fact) => f.subSub === "lead assign to sales team";
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

export function applyFilters(facts: Fact[], f: MisFilters): Fact[] {
  const bau = [f.bau1, f.bau2].map((b) => low(b)).filter((b) => b && b !== "overall" && b !== "all");
  const uniqBau = [...new Set(bau)];
  return facts.filter((x) => {
    if (f.month && x.regMonth !== f.month) return false;
    if (f.week && x.week !== f.week) return false;
    if (f.channel && x.source !== f.channel) return false;
    if (f.brand && low(x.brand) !== low(f.brand)) return false;
    if (uniqBau.length > 0 && !uniqBau.includes(low(x.brand))) return false;
    if (f.status && low(x.calling) !== low(f.status)) return false;
    if (f.closureMonth && x.closerMonth !== f.closureMonth) return false;
    return true;
  });
}

export interface Scope { fyMonths: string[]; latestKey: string; prevKey: string; monthLabels: string[] }
/** Month rows shown on every slide: the April-March year of the newest register month, up to the newest month that has rows. */
export function scopeOf(facts: Fact[]): Scope {
  const keys = facts.map((f) => f.regKey).filter(Boolean).sort();
  const latestKey = keys[keys.length - 1] ?? "";
  if (!latestKey) return { fyMonths: [], latestKey: "", prevKey: "", monthLabels: [] };
  const fy = fyKeys(latestKey).filter((k) => k <= latestKey);
  return { fyMonths: fy, latestKey, prevKey: fy.length > 1 ? fy[fy.length - 2] : "", monthLabels: fy.map(keyToLabel) };
}

/* ------------------------- row -> Fact (DB shape) ------------------------- */

/** One birlanu_sale row (or the workbook Data row rendered in the same text shape). */
export interface RawRow {
  weeks?: unknown; lead_register_month?: unknown; lead_register_date?: unknown; call_type?: unknown; calling_status?: unknown;
  interested_status?: unknown; sub_calling_status?: unknown; sub_sub_calling_status?: unknown; enquiry_source?: unknown; brand?: unknown;
  organic_paid?: unknown; lead_closer_status?: unknown; lead_closer_month?: unknown; seller_email_id?: unknown;
  sale_mt?: unknown; sale_inr?: unknown; bucket?: unknown; frt?: unknown;
}
const parseNum = (raw: unknown): number => {
  const s = String(raw ?? '').trim();
  if (!s || s === '-' || s.toUpperCase() === 'NA') return 0;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
/** "31-Oct-25" -> "2025-10-31" */
const parseDmyShort = (raw: unknown): string | null => {
  const m = String(raw ?? "").trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
  if (!m) return null;
  const i = MONTHS.indexOf(m[2].toLowerCase());
  return i < 0 ? null : `20${m[3]}-${String(i + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
};
/** "2236:46:12" (h:mm:ss, hours may exceed 24) -> hours; "-" / blank -> null. */
const parseHms = (raw: unknown): number | null => {
  const m = String(raw ?? "").trim().match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
  return m ? Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600 : null;
};
const dash = (v: unknown) => { const s = String(v ?? '').trim(); return s === '-' ? '' : s; };
export function rowToFact(r: RawRow): Fact {
  const regMonth = dash(r.lead_register_month);
  const closerMonth = dash(r.lead_closer_month);
  return {
    regMonth, regKey: monthKey(regMonth), regDate: parseDmyShort(r.lead_register_date), week: dash(r.weeks),
    source: canonSource(r.enquiry_source), brand: dash(r.brand), organicPaid: dash(r.organic_paid), callType: dash(r.call_type),
    calling: dash(r.calling_status), interested: dash(r.interested_status), sub: dash(r.sub_calling_status), subSub: low(dash(r.sub_sub_calling_status)),
    closer: low(dash(r.lead_closer_status)), closerMonth, closerKey: monthKey(closerMonth), seller: dash(r.seller_email_id),
    mt: parseNum(r.sale_mt), inr: parseNum(r.sale_inr), bucket: dash(r.bucket), frtHours: parseHms(r.frt),
  };
}

/* ---------------------------- Performance ---------------------------- */

export interface PerfMonth {
  month: string; enquiries: number; connected: number; connectPct: number;
  validated: number; elvaPct: number; qualified: number; elqPct: number;
  converted: number; elcoPct: number; volMt: number; valueLacs: number;
  lcCloser: number; elcoCloserPct: number; volMtCloser: number; valueLacsCloser: number;
}
function perfRow(month: string, cohort: Fact[], byCloser: Fact[]): PerfMonth {
  const conv = cohort.filter(isConverted);
  const convC = byCloser.filter(isConverted);
  const enq = cohort.length;
  return {
    month, enquiries: enq,
    connected: cohort.filter((f) => low(f.calling) === "connect").length,
    connectPct: r1(pct(cohort.filter((f) => low(f.calling) === "connect").length, enq)),
    validated: cohort.filter((f) => low(f.interested) === "interested").length,
    elvaPct: r2(pct(cohort.filter((f) => low(f.interested) === "interested").length, enq)),
    qualified: cohort.filter(isLas).length,
    elqPct: r2(pct(cohort.filter(isLas).length, enq)),
    converted: conv.length, elcoPct: r2(pct(conv.length, enq)),
    volMt: sum(conv.map((f) => f.mt)), valueLacs: sum(conv.map((f) => f.inr)) / 1e5,
    lcCloser: convC.length, elcoCloserPct: r2(pct(convC.length, enq)),
    volMtCloser: sum(convC.map((f) => f.mt)), valueLacsCloser: sum(convC.map((f) => f.inr)) / 1e5,
  };
}
const emailName = (e: string) => {
  const local = e.split("@")[0].replace(/[._-]+/g, " ").trim();
  return local ? local.replace(/\b\w/g, (c) => c.toUpperCase()) : "";
};

export function buildPerformance(facts: Fact[], scope: Scope) {
  const months = scope.fyMonths.map((k) => perfRow(
    keyToLabel(k), facts.filter((f) => f.regKey === k), facts.filter((f) => f.closerKey === k),
  ));
  // Grand total: sums of the month rows, exactly like the sheet's SUM(C5:C16); ratios from the summed counts.
  const t = (k: keyof PerfMonth) => sum(months.map((m) => Number(m[k])));
  const enq = t("enquiries");
  const total: PerfMonth = {
    month: "Grand Total", enquiries: enq, connected: t("connected"), connectPct: r1(pct(t("connected"), enq)),
    validated: t("validated"), elvaPct: r2(pct(t("validated"), enq)), qualified: t("qualified"), elqPct: r2(pct(t("qualified"), enq)),
    converted: t("converted"), elcoPct: r2(pct(t("converted"), enq)), volMt: t("volMt"), valueLacs: t("valueLacs"),
    lcCloser: t("lcCloser"), elcoCloserPct: r2(pct(t("lcCloser"), enq)), volMtCloser: t("volMtCloser"), valueLacsCloser: t("valueLacsCloser"),
  };
  const inScope = facts.filter((f) => scope.fyMonths.includes(f.regKey));
  const callingSplit = {
    connected: inScope.filter((f) => low(f.calling) === "connect").length,
    notConnected: inScope.filter((f) => low(f.calling) === "not connect").length,
  };
  // Lead-closer table: conversions credited to the seller who closed them, in the newest closer month.
  const closerKey = scope.latestKey;
  const bySeller = new Map<string, Fact[]>();
  for (const f of facts) if (f.closerKey === closerKey && isConverted(f) && f.seller) bySeller.set(f.seller, [...(bySeller.get(f.seller) ?? []), f]);
  const closers = [...bySeller.entries()].map(([seller, rs]) => ({
    closer: emailName(seller) || "Unknown", lc: rs.length, volMt: sum(rs.map((f) => f.mt)), valueLacs: sum(rs.map((f) => f.inr)) / 1e5,
  })).sort((a, b) => b.valueLacs - a.valueLacs);
  return { months, total, callingSplit, closers, closerMonth: closerKey ? keyToLabel(closerKey) : "" };
}

/* ----------------------------- Business ------------------------------ */

const STATUS_ROWS = [
  "closed_with_order", "closed_with_dealership", "closed_without_order", "closed_without_dealership", "closed_with_solution",
  "underprocess", "followup", "pending", "no_response_from_sales_team", "no_response_from_customer", "no_response",
  "invalid_close", "dropped", "attempted_4", "attempted_3", "attempted_2", "attempted_1", "-",
];

export function buildBusiness(facts: Fact[], scope: Scope) {
  const las = facts.filter(isLas);
  const perMonth = scope.fyMonths.map((k) => {
    const reg = las.filter((f) => f.regKey === k);
    const clo = las.filter((f) => f.closerKey === k);
    const sold = clo.filter(isConverted);
    const validated = reg.length;
    const organicV = reg.filter((f) => low(f.organicPaid) === "organic").length;
    const conv = sold.length;
    const convOrganic = sold.filter((f) => low(f.organicPaid) === "organic").length;
    const convPaid = sold.filter((f) => low(f.organicPaid) === "paid").length;
    const revOrder = (rs: Fact[]) => sum(rs.filter((f) => f.closer === "closed_with_order").map((f) => f.inr)) / 1e5;
    const revenue = revOrder(clo);
    const revenueOrganic = revOrder(clo.filter((f) => low(f.organicPaid) === "organic"));
    const firstBilling = sum(clo.filter((f) => f.closer === "closed_with_dealership").map((f) => f.inr)) / 1e5;
    return {
      month: keyToLabel(k), validated, organicV, organicSharePct: r2(pct(organicV, validated)),
      conv, convOrganic, convPaid,
      convPct: r2(pct(conv, validated)), convOrganicPct: r2(pct(convOrganic, organicV)),
      // Workbook D14: paid conversions / (validated - organic validated). Kept as-is (see the findings list).
      convPaidPct: r2(pct(convPaid, validated - organicV)),
      revenue, revenueOrganic, revenueOrganicPct: r2(pct(revenueOrganic, revenue)), firstBilling,
    };
  });
  const s = (k: keyof (typeof perMonth)[number]) => sum(perMonth.map((m) => Number(m[k])));
  const ytd = {
    validated: s("validated"), organicV: s("organicV"), conv: s("conv"), convOrganic: s("convOrganic"), convPaid: s("convPaid"),
    revenue: s("revenue"), revenueOrganic: s("revenueOrganic"), firstBilling: s("firstBilling"),
    organicSharePct: r2(pct(s("organicV"), s("validated"))), convPct: r2(pct(s("conv"), s("validated"))),
    convOrganicPct: r2(pct(s("convOrganic"), s("organicV"))), convPaidPct: r2(pct(s("convPaid"), s("validated") - s("organicV"))),
    revenueOrganicPct: r2(pct(s("revenueOrganic"), s("revenue"))),
  };
  // Closure status rows: a,b are by closer month, c..r by register month (as the sheet does -- see findings).
  const status = STATUS_ROWS.map((st, i) => {
    const byCloserMonth = i < 2;
    const count = las.filter((f) => f.closer === st && scope.fyMonths.includes(byCloserMonth ? f.closerKey : f.regKey)).length;
    return { status: st, count };
  });
  const totalStatus = sum(status.map((x) => x.count));
  const grp = (from: number, to: number) => sum(status.slice(from, to + 1).map((x) => x.count));
  return {
    perMonth, ytd,
    closureBreakup: status.filter((x) => x.count > 0 || ["closed_with_order", "followup", "dropped"].includes(x.status)).map((x) => ({ ...x, pct: r1(pct(x.count, totalStatus)) })),
    closureTotal: totalStatus,
    groups: { closed: grp(0, 4), followUp: grp(5, 7), dropped: status[12].count },
  };
}

/* --------------------------- Disposition ----------------------------- */

export const CONNECT_STATUSES = [
  "closed_with_order", "closed_with_dealership", "closed_without_order", "closed_without_dealership", "closed_with_solution",
  "underprocess", "followup", "pending", "no_response_from_sales_team", "no_response_from_customer", "invalid_close", "dropped",
];
export const NOT_CONNECT_STATUSES = ["no_response", "attempted_4", "attempted_3", "attempted_2", "attempted_1"];
const SOURCE_ORDER = ["Meta", "IndiaMART", "Inbound", "ChatBot", "GetDistributor", "Mail", "Other", "Plantix", "TradeIndia", "Exhibition", "Project", "Website_Google_Ads", "WebSite"];

export function buildDisposition(facts: Fact[], scope: Scope) {
  // The sheet only counts rows registered on/after 1-Apr of the financial year (Channel Wise Disposition!C1).
  const fyStart = scope.fyMonths.length ? `${scope.fyMonths[0]}-01` : "";
  const rows = facts.filter((f) => f.regDate !== null && f.regDate >= fyStart);
  const seen = new Set(rows.map((f) => f.source).filter(Boolean));
  const sources = [...SOURCE_ORDER.filter((s) => seen.has(s) || ["Meta", "IndiaMART", "Inbound", "ChatBot", "GetDistributor", "Mail", "WebSite"].includes(s)), ...[...seen].filter((s) => !SOURCE_ORDER.includes(s))];
  const cell = (st: string, src?: string, subset: Fact[] = rows) => subset.filter((f) => f.closer === st && (src === undefined || f.source === src)).length;
  const matrix = (list: string[]) => list.map((st) => {
    const by: Record<string, number> = {};
    for (const s of sources) by[s] = cell(st, s);
    return { status: st, by, total: cell(st) };
  });
  const connect = matrix(CONNECT_STATUSES);
  const notConnect = matrix(NOT_CONNECT_STATUSES);
  const colTotal = (m: ReturnType<typeof matrix>) => Object.fromEntries(sources.map((s) => [s, sum(m.map((r) => r.by[s]))]));
  const connectTotal = sum(connect.map((r) => r.total));
  const notConnectTotal = sum(notConnect.map((r) => r.total));
  const grand = connectTotal + notConnectTotal;
  const bySourceTotal = Object.fromEntries(sources.map((s) => [s, sum(connect.map((r) => r.by[s])) + sum(notConnect.map((r) => r.by[s]))]));
  const monthly = scope.fyMonths.map((k) => {
    const rs = rows.filter((f) => f.regKey === k);
    const c = rs.filter((f) => CONNECT_STATUSES.includes(f.closer)).length;
    const n = rs.filter((f) => NOT_CONNECT_STATUSES.includes(f.closer)).length;
    const by: Record<string, number> = {};
    for (const s of sources) by[s] = rs.filter((f) => f.source === s && (CONNECT_STATUSES.includes(f.closer) || NOT_CONNECT_STATUSES.includes(f.closer))).length;
    return { month: keyToLabel(k), total: c + n, connected: c, notConnected: n, by };
  });
  return {
    fyStart, sources, connect, notConnect,
    connectTotals: { by: colTotal(connect), total: connectTotal }, notConnectTotals: { by: colTotal(notConnect), total: notConnectTotal },
    grand, connectRatePct: r1(pct(connectTotal, grand)), bySourceTotal, monthly,
  };
}

/* ------------------------------ Lead TAT ----------------------------- */

export const TAT_BUCKETS = [
  "0-30 Min", "30 Min-2hrs", "2hr-4hrs", "4hrs-6hrs", "6hrs-8hrs", "8hrs-10hrs", "10hrs-12hrs",
  "12hrs-14hrs", "14hrs-16hrs", "16hrs-18hrs", "18hrs-20hrs", "20hrs-22hrs", "22hrs-24hrs", "More Than 24 Hrs",
];
const BUCKET_LOW = TAT_BUCKETS.map((b) => b.toLowerCase());

export function buildLeadTat(allFacts: Fact[], filtered: Fact[], scope: Scope, selMonth: string | undefined, selWeek: string | undefined) {
  const monthLabel = selMonth || (scope.latestKey ? keyToLabel(scope.latestKey) : "");
  const isTat = (f: Fact) => low(f.callType) === "outbound" && BUCKET_LOW.includes(low(f.bucket));
  const bucketIdx = (f: Fact) => BUCKET_LOW.indexOf(low(f.bucket));
  const pool = filtered.filter((f) => isTat(f) && f.regMonth === monthLabel && (!selWeek || f.week === selWeek));
  const sources = [...new Set(pool.map((f) => f.source).filter(Boolean))].sort((a, b) => SOURCE_ORDER.indexOf(a) - SOURCE_ORDER.indexOf(b));
  const mk = (rs: Fact[]) => {
    const counts = TAT_BUCKETS.map((_, i) => rs.filter((f) => bucketIdx(f) === i).length);
    // Within TAT = first two buckets (<= 2 hrs) -- Lead TAT!P = SUM(B:C); Out of TAT = SUM(D:O).
    const within = counts[0] + counts[1];
    const out = sum(counts.slice(2));
    return { counts, within, out, total: within + out, withinPct: r1(pct(within, within + out)) };
  };
  const bySource = sources.map((s) => ({ source: s, ...mk(pool.filter((f) => f.source === s)) }));
  const totals = mk(pool);
  const hours = pool.map((f) => f.frtHours).filter((h): h is number => h !== null && h >= 0).sort((a, b) => a - b);
  const median = hours.length ? (hours.length % 2 ? hours[(hours.length - 1) / 2] : (hours[hours.length / 2 - 1] + hours[hours.length / 2]) / 2) : null;
  const under24 = hours.filter((h) => h < 24);
  const monthly = scope.fyMonths.map((k) => {
    const rs = filtered.filter((f) => isTat(f) && f.regKey === k);
    return { month: keyToLabel(k), ...mk(rs) };
  });
  // Monthly source performance: Enquiry / Connected / LAS by register month (Lead TAT rows 22-38).
  const srcList = [...new Set(filtered.map((f) => f.source).filter(Boolean))].sort((a, b) => SOURCE_ORDER.indexOf(a) - SOURCE_ORDER.indexOf(b));
  const sourcePerformance = srcList.map((s) => ({
    source: s,
    months: scope.fyMonths.map((k) => {
      const rs = filtered.filter((f) => f.source === s && f.regKey === k);
      const connected = rs.filter((f) => low(f.calling) === "connect");
      const las = connected.filter(isLas).length;
      return { month: keyToLabel(k), enquiry: rs.length, connected: connected.length, las, contPct: r1(pct(connected.length, rs.length)), lasPct: r1(pct(las, connected.length)) };
    }),
  }));
  const weeks = [...new Set(allFacts.filter((f) => f.regMonth === monthLabel).map((f) => f.week).filter(Boolean))].sort();
  return {
    month: monthLabel, week: selWeek ?? "", weeks, buckets: TAT_BUCKETS, bySource, totals,
    medianHours: median, avgHoursUnder24: under24.length ? sum(under24) / under24.length : null,
    monthly, sourcePerformance,
  };
}

/* ------------------------------ Enquiry ------------------------------ */

export function buildEnquiry(facts: Fact[], scope: Scope) {
  const inScope = facts.filter((f) => scope.fyMonths.includes(f.regKey));
  const sourceTotals = new Map<string, number>();
  for (const f of inScope) if (f.source) sourceTotals.set(f.source, (sourceTotals.get(f.source) ?? 0) + 1);
  const sources = [...sourceTotals.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  let prev = 0;
  const months = scope.fyMonths.map((k, i) => {
    const rs = inScope.filter((f) => f.regKey === k);
    const by: Record<string, number> = {};
    for (const s of sources) by[s] = rs.filter((f) => f.source === s).length;
    const total = rs.length;
    const row = { month: keyToLabel(k), total, momPct: i === 0 || prev === 0 ? null : r1(((total - prev) / prev) * 100), by };
    prev = total;
    return row;
  });
  const grand = sum(months.map((m) => m.total));
  const brandMap = new Map<string, number>();
  for (const f of inScope) if (f.brand) brandMap.set(f.brand, (brandMap.get(f.brand) ?? 0) + 1);
  const brands = [...brandMap.entries()].sort((a, b) => b[1] - a[1]).map(([brand, count]) => ({ brand, count, pct: r1(pct(count, grand)) }));
  return {
    sources, months, grand,
    sourceTotals: sources.map((s) => ({ source: s, count: sourceTotals.get(s) ?? 0, pct: r1(pct(sourceTotals.get(s) ?? 0, grand)) })),
    brands,
  };
}

/* ---------------------------- Product wise --------------------------- */

export function buildProductWise(facts: Fact[], scope: Scope) {
  const brandMap = new Map<string, number>();
  for (const f of facts) if (f.brand && scope.fyMonths.includes(f.regKey)) brandMap.set(f.brand, (brandMap.get(f.brand) ?? 0) + 1);
  const brands = [...brandMap.entries()].sort((a, b) => b[1] - a[1]).map(([b]) => b);
  const cellOf = (brand: string, k: string, byCloser: boolean) => {
    const own = facts.filter((f) => f.brand === brand);
    const reg = own.filter((f) => f.regKey === k);
    // Leads (LAS) = Sub Calling Status "Valid" AND Sub Sub Calling Status "Lead assign to Sales team".
    const leads = reg.filter((f) => low(f.sub) === "valid" && isLas(f)).length;
    const conv = (byCloser ? own.filter((f) => f.closerKey === k) : reg).filter(isConverted);
    const revenue = sum(conv.map((f) => f.inr));
    return { enquiries: reg.length, leads, conversions: conv.length, convPct: r1(pct(conv.length, leads)), revenue };
  };
  const table = (byCloser: boolean) => {
    const rows = brands.map((brand) => {
      const months = scope.fyMonths.map((k) => cellOf(brand, k, byCloser));
      const enq = sum(months.map((m) => m.enquiries)), leads = sum(months.map((m) => m.leads)), conv = sum(months.map((m) => m.conversions));
      return { brand, overall: { enquiries: enq, leads, conversions: conv, convPct: r1(pct(conv, leads)), revenue: sum(months.map((m) => m.revenue)) }, months };
    });
    const totalMonths = scope.fyMonths.map((_, i) => {
      const enq = sum(rows.map((r) => r.months[i].enquiries)), leads = sum(rows.map((r) => r.months[i].leads)), conv = sum(rows.map((r) => r.months[i].conversions));
      return { enquiries: enq, leads, conversions: conv, convPct: r1(pct(conv, leads)), revenue: sum(rows.map((r) => r.months[i].revenue)) };
    });
    const oEnq = sum(rows.map((r) => r.overall.enquiries)), oLeads = sum(rows.map((r) => r.overall.leads)), oConv = sum(rows.map((r) => r.overall.conversions));
    return { rows, total: { overall: { enquiries: oEnq, leads: oLeads, conversions: oConv, convPct: r1(pct(oConv, oLeads)), revenue: sum(rows.map((r) => r.overall.revenue)) }, months: totalMonths } };
  };
  return { brands, months: scope.monthLabels, byRegister: table(false), byCloser: table(true) };
}

/* ------------------------------- all --------------------------------- */

export function filterOptions(facts: Fact[]) {
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];
  const monthSort = (a: string, b: string) => monthKey(a).localeCompare(monthKey(b));
  return {
    months: uniq(facts.map((f) => f.regMonth)).filter((m) => monthKey(m)).sort(monthSort),
    closureMonths: uniq(facts.map((f) => f.closerMonth)).filter((m) => monthKey(m)).sort(monthSort),
    channels: uniq(facts.map((f) => f.source)).sort((a, b) => SOURCE_ORDER.indexOf(a) - SOURCE_ORDER.indexOf(b)),
    brands: uniq(facts.map((f) => f.brand)).sort(),
    statuses: ["Connect", "Not Connect"],
  };
}

export function buildMis(all: Fact[], filters: MisFilters) {
  const facts = applyFilters(all, filters);
  const scope = scopeOf(facts.length ? facts : all);
  return {
    filters, options: filterOptions(all), scope: { months: scope.monthLabels, latest: scope.latestKey ? keyToLabel(scope.latestKey) : "", previous: scope.prevKey ? keyToLabel(scope.prevKey) : "" },
    asOf: facts.map((f) => f.regDate).filter((d): d is string => !!d).sort().pop() ?? null,
    rowCount: facts.length, totalRows: all.length,
    performance: buildPerformance(facts, scope),
    business: buildBusiness(facts, scope),
    disposition: buildDisposition(facts, scope),
    leadTat: buildLeadTat(all, facts, scope, filters.month, filters.week),
    enquiry: buildEnquiry(facts, scope),
    productWise: buildProductWise(facts, scope),
  };
}
export type BirlanuMis = ReturnType<typeof buildMis>;
