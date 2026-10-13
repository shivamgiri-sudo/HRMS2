/**
 * GS1 consolidated dashboard — pure aggregation over rows already read from the three
 * GS1 tables. No DB access here, so every figure on the dashboard is unit-testable.
 *
 * Units (one source row = one work item in every LOB):
 *   Email      = tickets  (gs1_email_daily_actual.mail_received, per analyst per work date)
 *   Data Card  = tasks    (gs1_datakart_daily_actual.task_count, per analyst per task date)
 *   Approval   = audited products (gs1_approval_audit_raw rows, one per GTIN)
 * The consolidated "work items" total is only ever a sum of these like units. GTIN / SKU
 * volumes are shown per LOB and never added across LOBs.
 */

import {
  type CountMap, countMapToRows, isUnknownName, mergeCounts, perAnalystDay, pickExtreme,
  reconRow, reconcileTotal, round2, safePct, sortBuckets, summariseStatuses, weightedMean,
  type ReconciliationRow,
} from "./gs1-metrics.js";

export type LobKey = "email" | "dataCard" | "approval";
export const LOB_LABEL: Record<LobKey, string> = { email: "Email", dataCard: "Data Card", approval: "Approval" };
export const LOB_UNIT: Record<LobKey, string> = { email: "tickets", dataCard: "tasks", approval: "audited products" };

export interface EmailRow {
  date: string; analyst: string | null; received: number; gtin: number; images: number;
  slaPct: number | null; statusCounts: CountMap | null; slaBuckets: CountMap | null;
  queryTypes: CountMap | null; avgDurationMin: number | null; durationKnown: number | null; noProcess: boolean;
}
export interface DataCardRow {
  date: string; analyst: string | null; tasks: number; gtin: number;
  withinTat: number | null; tatKnown: number | null; completed: number | null;
  categories: CountMap | null; avgDurationMin: number | null; durationKnown: number | null; noProcess: boolean;
}
export interface ApprovalRow {
  date: string; analyst: string | null; result: string; errorFlag: number;
  errorCategory: string | null; items: number; sku: number; noProcess: boolean;
}

export interface LobSummary {
  lob: LobKey; label: string; unit: string; hasData: boolean;
  received: number; processed: number | null; pending: number | null; rejected: number | null;
  closurePct: number | null; closureLabel: string;
  avgTatMin: number | null; withinSlaPct: number | null; slaLabel: string;
  productivity: number | null; analysts: number; analystDays: number; activeDays: number;
  gtin: number | null;
}
export interface Labelled { label: string; count: number }
export interface AnalystStat {
  analyst: string; items: number; processed: number | null; days: number; perDay: number | null;
  gtin: number | null; slaPct: number | null; errorPct: number | null;
}

export interface EmailDetail {
  summary: LobSummary; images: number; statusCoverage: number;
  daily: Array<{ date: string; received: number; closed: number | null; gtin: number; slaPct: number | null }>;
  statusMix: Labelled[]; statusLabels: Labelled[]; slaBuckets: Labelled[]; queryTypes: Labelled[];
  byAnalyst: AnalystStat[];
}
export interface DataCardDetail {
  summary: LobSummary; completionCoverage: number; tatCoverage: number; avgGtinPerTask: number | null;
  daily: Array<{ date: string; received: number; completed: number | null; gtin: number }>;
  statusMix: Labelled[]; categories: Labelled[]; byAnalyst: AnalystStat[];
}
export interface ApprovalDetail {
  summary: LobSummary; approved: number; approvalPct: number | null; rejectionPct: number | null;
  errors: number; errorPct: number | null; sku: number;
  daily: Array<{ date: string; received: number; approved: number; rejected: number; pending: number; errors: number }>;
  statusMix: Labelled[]; reasons: Labelled[]; byAnalyst: AnalystStat[];
}

export interface DataQualityRow { lob: string; check: string; count: number; severity: "ok" | "info" | "warn" | "error"; note: string }

const nz = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? 0 : v);
const nameOf = (a: string | null) => (isUnknownName(a) ? "(unknown)" : String(a).trim());

function analystDays<T extends { date: string; analyst: string | null }>(rows: T[], weight: (r: T) => number) {
  const days = new Set<string>(); const pairs = new Set<string>(); const people = new Set<string>();
  for (const r of rows) {
    if (weight(r) <= 0) continue;
    days.add(r.date); pairs.add(`${r.date}|${nameOf(r.analyst)}`); people.add(nameOf(r.analyst));
  }
  return { activeDays: days.size, analystDays: pairs.size, analysts: people.size };
}

function byDate<T extends { date: string }, A>(rows: T[], init: (d: string) => A, add: (acc: A, r: T) => void): A[] {
  const m = new Map<string, A>();
  for (const r of rows) { let a = m.get(r.date); if (!a) { a = init(r.date); m.set(r.date, a); } add(a, r); }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(e => e[1]);
}

// ── Email ────────────────────────────────────────────────────────────────────
export function aggregateEmail(rows: EmailRow[]): EmailDetail {
  const received = rows.reduce((s, r) => s + r.received, 0);
  const statusRows = rows.filter(r => r.statusCounts && Object.keys(r.statusCounts).length > 0);
  const statusCoverage = statusRows.reduce((s, r) => s + r.received, 0);
  const statusMap: CountMap = {};
  const slaMap: CountMap = {};
  const qtMap: CountMap = {};
  for (const r of rows) { mergeCounts(statusMap, r.statusCounts); mergeCounts(slaMap, r.slaBuckets); mergeCounts(qtMap, r.queryTypes); }
  const cls = summariseStatuses(statusMap);
  const classified = cls.closed + cls.pending + cls.rejected;
  const hasStatus = statusCoverage > 0 && classified > 0;
  const ad = analystDays(rows, r => r.received);

  const summary: LobSummary = {
    lob: "email", label: LOB_LABEL.email, unit: LOB_UNIT.email, hasData: received > 0,
    received,
    processed: hasStatus ? cls.closed : null,
    pending: hasStatus ? cls.pending : null,
    rejected: hasStatus ? cls.rejected : null,
    closurePct: hasStatus ? safePct(cls.closed, statusCoverage) : null,
    closureLabel: "Closure % = closed / received (tickets with status captured)",
    avgTatMin: weightedMean(rows.map(r => ({ value: r.avgDurationMin, weight: nz(r.durationKnown) }))),
    withinSlaPct: weightedMean(rows.map(r => ({ value: r.slaPct, weight: r.received }))),
    slaLabel: "Within 15-min SLA %, ticket-weighted",
    productivity: perAnalystDay(received, ad.analystDays),
    ...ad,
    gtin: rows.reduce((s, r) => s + r.gtin, 0),
  };

  const analystMap = new Map<string, { rows: EmailRow[] }>();
  for (const r of rows) { const k = nameOf(r.analyst); (analystMap.get(k) ?? analystMap.set(k, { rows: [] }).get(k)!).rows.push(r); }
  const byAnalyst: AnalystStat[] = [...analystMap.entries()].map(([analyst, { rows: rs }]) => {
    const items = rs.reduce((s, r) => s + r.received, 0);
    const sm: CountMap = {}; rs.forEach(r => mergeCounts(sm, r.statusCounts));
    const c = summariseStatuses(sm);
    const days = new Set(rs.filter(r => r.received > 0).map(r => r.date)).size;
    return {
      analyst, items, processed: c.closed + c.pending + c.rejected > 0 ? c.closed : null, days,
      perDay: perAnalystDay(items, days), gtin: rs.reduce((s, r) => s + r.gtin, 0),
      slaPct: weightedMean(rs.map(r => ({ value: r.slaPct, weight: r.received }))), errorPct: null,
    };
  }).sort((a, b) => b.items - a.items);

  const daily = byDate(rows, d => ({ date: d, received: 0, closed: null as number | null, gtin: 0, slaW: [] as Array<{ value: number | null; weight: number }>, slaPct: null as number | null }), (a, r) => {
    a.received += r.received; a.gtin += r.gtin; a.slaW.push({ value: r.slaPct, weight: r.received });
    if (r.statusCounts && Object.keys(r.statusCounts).length) a.closed = nz(a.closed) + summariseStatuses(r.statusCounts).closed;
  }).map(({ slaW, ...a }) => ({ ...a, slaPct: weightedMean(slaW) }));

  return {
    summary, images: rows.reduce((s, r) => s + r.images, 0), statusCoverage, daily,
    statusMix: hasStatus || cls.other > 0
      ? [{ label: "Closed", count: cls.closed }, { label: "Pending", count: cls.pending }, { label: "Rejected", count: cls.rejected }, { label: "Other / unmapped", count: cls.other }].filter(x => x.count > 0)
      : [],
    statusLabels: countMapToRows(statusMap),
    slaBuckets: sortBuckets(countMapToRows(slaMap, 12)),
    queryTypes: countMapToRows(qtMap, 12),
    byAnalyst,
  };
}

// ── Data Card ────────────────────────────────────────────────────────────────
/** Rows written before tat_known_count existed carry within_tat = 0 for "no signal". */
export function dataCardTatWeight(r: DataCardRow): number {
  if (r.withinTat === null) return 0;
  if (r.tatKnown !== null) return r.tatKnown;
  return r.withinTat > 0 ? r.tasks : 0;
}

export function aggregateDataCard(rows: DataCardRow[]): DataCardDetail {
  const received = rows.reduce((s, r) => s + r.tasks, 0);
  const compRows = rows.filter(r => r.completed !== null);
  const completionCoverage = compRows.reduce((s, r) => s + r.tasks, 0);
  const completed = compRows.reduce((s, r) => s + nz(r.completed), 0);
  const hasComp = completionCoverage > 0;
  const tatCoverage = rows.reduce((s, r) => s + dataCardTatWeight(r), 0);
  const ad = analystDays(rows, r => r.tasks);
  const gtin = rows.reduce((s, r) => s + r.gtin, 0);
  const catMap: CountMap = {}; rows.forEach(r => mergeCounts(catMap, r.categories));

  const summary: LobSummary = {
    lob: "dataCard", label: LOB_LABEL.dataCard, unit: LOB_UNIT.dataCard, hasData: received > 0,
    received,
    processed: hasComp ? completed : null,
    pending: hasComp ? completionCoverage - completed : null,
    rejected: null,
    closurePct: hasComp ? safePct(completed, completionCoverage) : null,
    closureLabel: "Completion % = completed / received (tasks with completion captured)",
    avgTatMin: weightedMean(rows.map(r => ({ value: r.avgDurationMin, weight: nz(r.durationKnown) }))),
    withinSlaPct: weightedMean(rows.map(r => ({ value: r.withinTat, weight: dataCardTatWeight(r) }))),
    slaLabel: "Within TAT %, task-weighted (only tasks whose source TAT is filled)",
    productivity: perAnalystDay(received, ad.analystDays),
    ...ad,
    gtin,
  };

  const groups = new Map<string, DataCardRow[]>();
  for (const r of rows) { const k = nameOf(r.analyst); groups.set(k, [...(groups.get(k) ?? []), r]); }
  const byAnalyst: AnalystStat[] = [...groups.entries()].map(([analyst, rs]) => {
    const items = rs.reduce((s, r) => s + r.tasks, 0);
    const cr = rs.filter(r => r.completed !== null);
    const days = new Set(rs.filter(r => r.tasks > 0).map(r => r.date)).size;
    return {
      analyst, items, processed: cr.length ? cr.reduce((s, r) => s + nz(r.completed), 0) : null, days,
      perDay: perAnalystDay(items, days), gtin: rs.reduce((s, r) => s + r.gtin, 0),
      slaPct: weightedMean(rs.map(r => ({ value: r.withinTat, weight: dataCardTatWeight(r) }))), errorPct: null,
    };
  }).sort((a, b) => b.items - a.items);

  const daily = byDate(rows, d => ({ date: d, received: 0, completed: null as number | null, gtin: 0 }), (a, r) => {
    a.received += r.tasks; a.gtin += r.gtin;
    if (r.completed !== null) a.completed = nz(a.completed) + r.completed;
  });

  return {
    summary, completionCoverage, tatCoverage, avgGtinPerTask: received > 0 ? round2(gtin / received) : null, daily,
    statusMix: hasComp ? [{ label: "Completed", count: completed }, { label: "Pending", count: completionCoverage - completed }].filter(x => x.count > 0) : [],
    categories: countMapToRows(catMap, 12),
    byAnalyst,
  };
}

// ── Approval ─────────────────────────────────────────────────────────────────
export function normalizeResult(r: string): "PASS" | "FAIL" | "PENDING" {
  const v = String(r ?? "").trim().toUpperCase();
  return v === "PASS" ? "PASS" : v === "FAIL" ? "FAIL" : "PENDING";
}

export function aggregateApproval(rows: ApprovalRow[]): ApprovalDetail {
  let approved = 0, rejected = 0, pending = 0, errors = 0, sku = 0;
  const reasonMap: CountMap = {};
  for (const r of rows) {
    const res = normalizeResult(r.result);
    sku += r.sku;
    if (res === "PASS") approved += r.items;
    else if (res === "FAIL") rejected += r.items;
    else { pending += r.items; continue; }
    // Errors and reasons are measured over processed items only; pending is never processed.
    if (r.errorFlag) errors += r.items;
    if (res === "FAIL" || r.errorFlag) {
      const k = String(r.errorCategory ?? "").trim() || "(not specified)";
      reasonMap[k] = (reasonMap[k] ?? 0) + r.items;
    }
  }
  const received = approved + rejected + pending;
  const processed = approved + rejected;
  const ad = analystDays(rows, r => r.items);

  const summary: LobSummary = {
    lob: "approval", label: LOB_LABEL.approval, unit: LOB_UNIT.approval, hasData: received > 0,
    received, processed, pending, rejected,
    closurePct: safePct(processed, received),
    closureLabel: "Processed % = (approved + rejected) / received",
    avgTatMin: null, withinSlaPct: null,
    slaLabel: "Not available: the approval upload has no received / completed timestamps",
    productivity: perAnalystDay(received, ad.analystDays),
    ...ad,
    gtin: null,
  };

  const groups = new Map<string, ApprovalRow[]>();
  for (const r of rows) { const k = nameOf(r.analyst); groups.set(k, [...(groups.get(k) ?? []), r]); }
  const byAnalyst: AnalystStat[] = [...groups.entries()].map(([analyst, rs]) => {
    const items = rs.reduce((s, r) => s + r.items, 0);
    const proc = rs.filter(r => normalizeResult(r.result) !== "PENDING");
    const p = proc.reduce((s, r) => s + r.items, 0);
    const e = proc.filter(r => r.errorFlag).reduce((s, r) => s + r.items, 0);
    const days = new Set(rs.filter(r => r.items > 0).map(r => r.date)).size;
    return { analyst, items, processed: p, days, perDay: perAnalystDay(items, days), gtin: null, slaPct: null, errorPct: safePct(e, p) };
  }).sort((a, b) => b.items - a.items);

  const daily = byDate(rows, d => ({ date: d, received: 0, approved: 0, rejected: 0, pending: 0, errors: 0 }), (a, r) => {
    const res = normalizeResult(r.result);
    a.received += r.items;
    if (res === "PASS") a.approved += r.items; else if (res === "FAIL") a.rejected += r.items; else a.pending += r.items;
    if (res !== "PENDING" && r.errorFlag) a.errors += r.items;
  });

  return {
    summary, approved, approvalPct: safePct(approved, processed), rejectionPct: safePct(rejected, processed),
    errors, errorPct: safePct(errors, processed), sku, daily,
    statusMix: [{ label: "Approved", count: approved }, { label: "Rejected", count: rejected }, { label: "Pending", count: pending }].filter(x => x.count > 0),
    reasons: countMapToRows(reasonMap, 12),
    byAnalyst,
  };
}

// ── Overall, comparison, reconciliation, data quality ───────────────────────
export interface Gs1LobSet { email: EmailDetail | null; dataCard: DataCardDetail | null; approval: ApprovalDetail | null }

export function summaries(lobs: Gs1LobSet): LobSummary[] {
  return [lobs.email?.summary, lobs.dataCard?.summary, lobs.approval?.summary].filter((s): s is LobSummary => !!s);
}

export function buildOverall(lobs: Gs1LobSet) {
  const s = summaries(lobs);
  const withProcessed = s.filter(x => x.processed !== null);
  const recvOfProcessed = withProcessed.reduce((t, x) => {
    if (x.lob === "email") return t + (lobs.email?.statusCoverage ?? 0);
    if (x.lob === "dataCard") return t + (lobs.dataCard?.completionCoverage ?? 0);
    return t + x.received;
  }, 0);
  const processed = withProcessed.length ? withProcessed.reduce((t, x) => t + nz(x.processed), 0) : null;
  const pending = s.some(x => x.pending !== null) ? s.reduce((t, x) => t + nz(x.pending), 0) : null;
  const received = s.reduce((t, x) => t + x.received, 0);
  return {
    unit: "work items",
    unitNote: "1 work item = 1 source row: an email ticket, a data card task or an audited approval product. GTIN/SKU volumes are not added across LOBs.",
    received, processed, pending,
    closurePct: processed === null ? null : safePct(processed, recvOfProcessed),
    closureBasis: `Over ${withProcessed.map(x => x.label).join(", ") || "no LOB"} (LOBs with status data)`,
    analysts: new Set([...(lobs.email?.byAnalyst ?? []), ...(lobs.dataCard?.byAnalyst ?? []), ...(lobs.approval?.byAnalyst ?? [])].map(a => a.analyst)).size,
    lobsWithData: s.filter(x => x.hasData).length,
    hasData: received > 0,
  };
}

export function buildComparison(lobs: Gs1LobSet) {
  const rows = summaries(lobs).map(x => ({
    lob: x.lob, label: x.label, unit: x.unit, received: x.received, processed: x.processed, pending: x.pending,
    closurePct: x.closurePct, avgTatMin: x.avgTatMin, withinSlaPct: x.withinSlaPct, productivity: x.productivity,
  }));
  const name = (r: { label: string } | null) => r?.label ?? null;
  return {
    rows,
    highlights: {
      highestInflow: name(pickExtreme(rows, r => (r.received > 0 ? r.received : null), "max")),
      highestBacklog: name(pickExtreme(rows, r => (r.pending && r.pending > 0 ? r.pending : null), "max")),
      lowestClosure: name(pickExtreme(rows, r => r.closurePct, "min")),
      worstSla: name(pickExtreme(rows, r => r.withinSlaPct, "min")),
      slowestTat: name(pickExtreme(rows, r => r.avgTatMin, "max")),
    },
  };
}

/**
 * Reconciliation: the overall total read independently from the database must equal the
 * sum of the LOB totals, and each LOB's day-wise and analyst-wise breakdowns must add back
 * to its own total (an unknown analyst is a visible row, never dropped).
 */
export function buildReconciliation(lobs: Gs1LobSet, independentTotals: Partial<Record<LobKey, number>>): ReconciliationRow[] {
  const s = summaries(lobs);
  const out: ReconciliationRow[] = [];
  const overallDb = s.reduce((t, x) => t + nz(independentTotals[x.lob]), 0);
  out.push(reconcileTotal(s.map(x => ({ lob: x.label, value: x.received })), overallDb));
  for (const x of s) {
    out.push(reconRow(`${x.label}: dashboard total = database total`, nz(independentTotals[x.lob]), x.received));
    const detail = lobs[x.lob]!;
    const dailySum = (detail.daily as Array<{ received: number }>).reduce((t, d) => t + d.received, 0);
    const analystSum = (detail.byAnalyst as AnalystStat[]).reduce((t, a) => t + a.items, 0);
    out.push(reconRow(`${x.label}: day-wise sum = total`, x.received, dailySum));
    out.push(reconRow(`${x.label}: analyst-wise sum = total`, x.received, analystSum));
  }
  return out;
}

export function buildDataQuality(
  input: { email: EmailRow[] | null; dataCard: DataCardRow[] | null; approval: ApprovalRow[] | null },
  lobs: Gs1LobSet,
  extra: { approvalBlankAuditor?: number } = {},
): DataQualityRow[] {
  const out: DataQualityRow[] = [];
  out.push({ lob: "All", check: "Rows without a LOB", count: 0, severity: "ok", note: "LOB is fixed by the upload type (one table per LOB), so every row has exactly one LOB." });
  const unknown = <T extends { analyst: string | null }>(rows: T[], w: (r: T) => number) => rows.filter(r => isUnknownName(r.analyst)).reduce((t, r) => t + w(r), 0);
  const noProc = <T extends { noProcess: boolean }>(rows: T[], w: (r: T) => number) => rows.filter(r => r.noProcess).reduce((t, r) => t + w(r), 0);
  const push = (lob: string, check: string, count: number, bad: DataQualityRow["severity"], note: string) =>
    out.push({ lob, check, count, severity: count > 0 ? bad : "ok", note });

  if (input.email) {
    push("Email", "Tickets with blank / unknown analyst", unknown(input.email, r => r.received), "error", "Shown as (unknown) in analyst charts.");
    push("Email", "Tickets not linked to the GS1 process", noProc(input.email, r => r.received), "warn", "process_id is empty on these rows.");
    const e = lobs.email!;
    push("Email", "Tickets without status captured", e.summary.received - e.statusCoverage, "info", "Uploaded before status capture was added; re-upload the period to fill closure / pending.");
    const other = e.statusMix.find(x => x.label === "Other / unmapped")?.count ?? 0;
    push("Email", "Tickets with unrecognised status", other, "warn", "Status label is not mapped to closed / pending / rejected; see the status label table.");
  }
  if (input.dataCard) {
    push("Data Card", "Tasks with blank / unknown analyst", unknown(input.dataCard, r => r.tasks), "error", "Shown as (unknown) in analyst charts.");
    push("Data Card", "Tasks not linked to the GS1 process", noProc(input.dataCard, r => r.tasks), "warn", "process_id is empty on these rows.");
    const d = lobs.dataCard!;
    push("Data Card", "Tasks with no TAT value in the source", d.summary.received - d.tatCoverage, "info", "The source SLA / TAT columns are blank, so Within TAT % is N/A, not 0%.");
    push("Data Card", "Tasks without completion captured", d.summary.received - d.completionCoverage, "info", "Uploaded before completion capture was added; re-upload to fill completion %.");
  }
  if (input.approval) {
    push("Approval", "Audits with blank / unknown auditee", unknown(input.approval, r => r.items), "error", "Shown as (unknown) in analyst charts.");
    push("Approval", "Audits not linked to the GS1 process", noProc(input.approval, r => r.items), "warn", "process_id is empty on these rows.");
    const noReason = lobs.approval!.reasons.find(x => x.label === "(not specified)")?.count ?? 0;
    push("Approval", "Rejected / error audits without an error category", noReason, "warn", "Reason chart shows them as (not specified).");
    if (extra.approvalBlankAuditor !== undefined) push("Approval", "Audits with blank auditor", extra.approvalBlankAuditor, "warn", "Approver is missing on these rows.");
  }
  return out;
}

export const TAT_BUCKET_NOTE =
  "TAT buckets (0-24h, 24-48h, 48-72h, over 72h) and open-item ageing need item-level received and closed timestamps. " +
  "The GS1 uploads are stored as daily per-analyst totals (Email, Data Card) or carry no timestamps (Approval), " +
  "so these charts are not drawn. Email shows the source's own SLA bucket labels instead.";
