/**
 * Client Process KPI registry — the targets from the client-facing "Process
 * KPI's" sheet (Billing Name / Project Name / LOB / SLA Target / Target),
 * mapped to whichever real `kpi_metric_master.metric_code` (if any) already
 * measures that concept anywhere in the system.
 *
 * This is data, not a query. `kpiMetricCode: null` means no registered metric
 * captures this concept ANYWHERE in mas_hrms today — the scorecard service
 * returns availability:'not_tracked' for those without attempting a query.
 * Where a code exists, the service queries kpi_daily_actual for real; verified
 * live (2026-09-06) that none of it has rows yet for these 4 processes, but the
 * query is genuine, so a metric lights up the moment a feed populates it —
 * no code change required. See the build plan for the full verification.
 *
 * process_master models each Billing Name/Project as ONE row — the sheet's
 * "LOB" column (ABC/Inbound/Upgrade under BBB, Email/MO/ABC/RTO under
 * Reginald) is a finer subdivision the schema has no column for, so it is
 * carried here purely as a display grouping (`lobLabel`), never as a query
 * filter. Scoring/filtering happens at process grain, which is what actually
 * exists.
 */

export type KpiFamily = "rate" | "volume" | "duration" | "roi";
export type KpiUnit = "percent" | "count" | "currency" | "seconds" | "ratio";
export type KpiDirection = "higher_is_better" | "lower_is_better";

/**
 * A second real data source, alongside kpi_daily_actual: a live call-center
 * campaign in dialer_db.cdr_in_* (verified live 2026-09-06 for BLA_BLI_BLU's
 * Inbound LOB — see kpi-cdr-source.ts for the query and the verification
 * notes). Only set on a metric when kpiMetricCode is null but a real CDR feed
 * covers the concept instead.
 */
export interface KpiCdrSource {
  table: string;
  campaigns: string[];
  pattern: "A" | "B";
  field: "al_pct" | "sl_pct" | "abn_pct" | "repeat_pct" | "acht_sec";
}

export interface KpiMetricDef {
  metricKey: string;
  label: string;
  family: KpiFamily;
  unit: KpiUnit;
  target: number;
  direction: KpiDirection;
  lobLabel: string;
  /** Real metric_code in kpi_metric_master, or null if nothing measures this yet. */
  kpiMetricCode: string | null;
  /** Why kpiMetricCode is null, shown in place of a fabricated number. */
  notTrackedNote?: string;
  /** Set only when a real dialer_db campaign covers this concept instead of kpi_daily_actual. */
  cdrSource?: KpiCdrSource;
  /**
   * Set when this metric's number can only come from the client: entered by
   * hand, uploaded, or pulled from their own database into
   * process_metric_actual. Distinct from kpiMetricCode/cdrSource, which are
   * measured by a pipeline HRMS runs itself.
   *
   * Its presence is what moves a metric from "not_tracked" (nothing anywhere
   * can measure this) to "no_data" (somewhere to supply it now exists, nothing
   * has been supplied yet) — a real change in meaning, not a cosmetic one.
   */
  processSource?: {
    grain: "process";
    /**
     * The kpi_metric_master.metric_code a KPI Studio process-grain definition
     * writes under, when one feeds this metric.
     *
     * process_metric_actual.metric_key holds the registry's own metricKey for a
     * hand-entered figure, but Studio knows its metric by metric_code — two
     * namespaces for the same idea. Naming the code here lets the resolver match
     * either, so a metric reads the same whether somebody typed the number in or
     * Studio computed it, with no second storage path and no rename.
     */
    metricCode?: string;
  };
}

export interface ProcessKpiSet {
  processCode: string;
  billingName: string;
  projectName: string;
  /** A note worth surfacing on the card grid, same spirit as the sheet's "Remarks". */
  note?: string;
  metrics: KpiMetricDef[];
}

const NO_METRIC_CODE = "No metric in kpi_metric_master captures this yet — needs a data-source decision before it can be measured, not a dashboard change.";

/**
 * BLA_BLI_BLU's Inbound LOB, live in dialer_db as CampaignName='Blabliblu_IN'
 * on cdr_in_10_4 — verified live 2026-09-06 (40,560 rows, through today).
 * Pattern A: this table's AgentId carries the same 'VDCL' queue/no-agent
 * sentinel the 7 already-onboarded Pattern-A clients use; DisconnBy never
 * contains 'HOLDTIME' here (0/40,560 rows), so that exclusion is a no-op on
 * this campaign, not a mismatch — Pattern A is a verified fit, not a guess.
 */
const BLABLIBLU_INBOUND_CDR = { table: "cdr_in_10_4", campaigns: ["Blabliblu_IN"], pattern: "A" as const };

export const PROCESS_KPI_REGISTRY: ProcessKpiSet[] = [
  {
    processCode: "BLA_BLI_BLU",
    billingName: "BLABLIBLU",
    projectName: "BBB",
    note: "Sale Target × AOV Target ≈ Gross Revenue Target (3,248 × ₹600 = ₹19.49L) for ABC; the two targets are derived, not independent.",
    metrics: [
      { metricKey: "abc_conversion_pct", label: "Conversion Target %", family: "rate", unit: "percent", target: 13.5, direction: "higher_is_better", lobLabel: "ABC", kpiMetricCode: "CONVERSION_RATE" },
      { metricKey: "abc_sale_target", label: "Sale Target", family: "volume", unit: "count", target: 3248, direction: "higher_is_better", lobLabel: "ABC", kpiMetricCode: "SALES_COUNT" },
      { metricKey: "abc_gross_revenue", label: "Gross Revenue Target", family: "volume", unit: "currency", target: 1949063, direction: "higher_is_better", lobLabel: "ABC", kpiMetricCode: "REVENUE" },
      { metricKey: "abc_prepaid_pct", label: "Prepaid Target %", family: "rate", unit: "percent", target: 85, direction: "higher_is_better", lobLabel: "ABC", kpiMetricCode: null, processSource: { grain: "process" }, notTrackedNote: NO_METRIC_CODE + " (COD_SHARE is tracked; prepaid = 100 − COD_SHARE is not computed anywhere)." },
      { metricKey: "abc_rto_pct", label: "RTO Target %", family: "rate", unit: "percent", target: 5, direction: "lower_is_better", lobLabel: "ABC", kpiMetricCode: "RTO_RATE" },
      { metricKey: "abc_aov_target", label: "AOV Target", family: "volume", unit: "currency", target: 600, direction: "higher_is_better", lobLabel: "ABC", kpiMetricCode: "AOV" },
      { metricKey: "abc_net_revenue", label: "Net Revenue", family: "volume", unit: "currency", target: 1651748, direction: "higher_is_better", lobLabel: "ABC", kpiMetricCode: null, processSource: { grain: "process" }, notTrackedNote: NO_METRIC_CODE },
      { metricKey: "abc_roi", label: "ROI", family: "roi", unit: "ratio", target: 5, direction: "higher_is_better", lobLabel: "ABC", kpiMetricCode: null, processSource: { grain: "process" }, notTrackedNote: NO_METRIC_CODE + " (no cost-vs-revenue figure exists per process; process_lob_monthly_plan, the table meant to carry this, has zero rows)." },

      { metricKey: "inbound_al_pct", label: "AL %", family: "rate", unit: "percent", target: 95, direction: "higher_is_better", lobLabel: "Inbound", kpiMetricCode: null, cdrSource: { ...BLABLIBLU_INBOUND_CDR, field: "al_pct" } },
      { metricKey: "inbound_abn_pct", label: "Abn %", family: "rate", unit: "percent", target: 5, direction: "lower_is_better", lobLabel: "Inbound", kpiMetricCode: null, cdrSource: { ...BLABLIBLU_INBOUND_CDR, field: "abn_pct" } },
      { metricKey: "inbound_sl_pct", label: "SL %", family: "rate", unit: "percent", target: 90, direction: "higher_is_better", lobLabel: "Inbound", kpiMetricCode: null, cdrSource: { ...BLABLIBLU_INBOUND_CDR, field: "sl_pct" } },
      { metricKey: "inbound_acht_sec", label: "ACHT (In Sec)", family: "duration", unit: "seconds", target: 240, direction: "lower_is_better", lobLabel: "Inbound", kpiMetricCode: "AHT" },
      { metricKey: "inbound_repeat_pct", label: "Repeat Calls", family: "rate", unit: "percent", target: 10, direction: "lower_is_better", lobLabel: "Inbound", kpiMetricCode: null, cdrSource: { ...BLABLIBLU_INBOUND_CDR, field: "repeat_pct" } },

      { metricKey: "upgrade_conversion_pct", label: "Conversion Target %", family: "rate", unit: "percent", target: 12, direction: "higher_is_better", lobLabel: "Upgrade", kpiMetricCode: "CONVERSION_RATE" },
      { metricKey: "upgrade_sale_target", label: "Sale Target", family: "volume", unit: "count", target: 647.22, direction: "higher_is_better", lobLabel: "Upgrade", kpiMetricCode: "SALES_COUNT" },
      { metricKey: "upgrade_gross_revenue", label: "Gross Revenue Target", family: "volume", unit: "currency", target: 388332, direction: "higher_is_better", lobLabel: "Upgrade", kpiMetricCode: "REVENUE" },
      { metricKey: "upgrade_prepaid_pct", label: "Prepaid Target %", family: "rate", unit: "percent", target: 85, direction: "higher_is_better", lobLabel: "Upgrade", kpiMetricCode: null, processSource: { grain: "process" }, notTrackedNote: NO_METRIC_CODE },
      { metricKey: "upgrade_rto_pct", label: "RTO Target %", family: "rate", unit: "percent", target: 5, direction: "lower_is_better", lobLabel: "Upgrade", kpiMetricCode: "RTO_RATE" },
      { metricKey: "upgrade_aov_target", label: "AOV Target", family: "volume", unit: "currency", target: 600, direction: "higher_is_better", lobLabel: "Upgrade", kpiMetricCode: "AOV" },
      { metricKey: "upgrade_net_revenue", label: "Net Revenue", family: "volume", unit: "currency", target: 329095, direction: "higher_is_better", lobLabel: "Upgrade", kpiMetricCode: null, processSource: { grain: "process" }, notTrackedNote: NO_METRIC_CODE },
      { metricKey: "upgrade_roi", label: "ROI", family: "roi", unit: "ratio", target: 5, direction: "higher_is_better", lobLabel: "Upgrade", kpiMetricCode: null, processSource: { grain: "process" }, notTrackedNote: NO_METRIC_CODE },
    ],
  },
  {
    processCode: "REGINALD",
    billingName: "Reginald",
    projectName: "Reginald",
    metrics: [
      { metricKey: "email_closure_hr", label: "Email Closure", family: "duration", unit: "seconds", target: 48 * 3600, direction: "lower_is_better", lobLabel: "Email", kpiMetricCode: null, processSource: { grain: "process" }, notTrackedNote: NO_METRIC_CODE + " (no email-ticketing TAT metric exists in kpi_metric_master)." },
      { metricKey: "mo_email_closure_hr", label: "Email Closure", family: "duration", unit: "seconds", target: 48 * 3600, direction: "lower_is_better", lobLabel: "MO", kpiMetricCode: null, processSource: { grain: "process" }, notTrackedNote: NO_METRIC_CODE },
      { metricKey: "abc_sale_target", label: "Sale Target", family: "volume", unit: "count", target: 1440, direction: "higher_is_better", lobLabel: "ABC", kpiMetricCode: "SALES_COUNT" },
      { metricKey: "abc_revenue_target", label: "Revenue Target", family: "volume", unit: "currency", target: 2450000, direction: "higher_is_better", lobLabel: "ABC", kpiMetricCode: "REVENUE" },
      { metricKey: "abc_roi", label: "ROI", family: "roi", unit: "ratio", target: 11.67, direction: "higher_is_better", lobLabel: "ABC", kpiMetricCode: null, processSource: { grain: "process" }, notTrackedNote: NO_METRIC_CODE },
      { metricKey: "reshipment_sec", label: "Reshipment", family: "duration", unit: "seconds", target: 3600, direction: "lower_is_better", lobLabel: "RTO", kpiMetricCode: null, processSource: { grain: "process" }, notTrackedNote: NO_METRIC_CODE + " (no returns/reshipment TAT metric exists in kpi_metric_master)." },
    ],
  },
  {
    processCode: "FINNABLE",
    billingName: "Finnable-Loan",
    projectName: "Finnable",
    metrics: [
      { metricKey: "pan_submission_count", label: "PAN Submission", family: "volume", unit: "count", target: 100, direction: "higher_is_better", lobLabel: "Finnable", kpiMetricCode: null, processSource: { grain: "process" }, notTrackedNote: NO_METRIC_CODE + " (no document-intake throughput metric exists; this process does have real ATTENDANCE_PCT and CONVERSION_RATE data, just not for PAN submissions)." },
    ],
  },
  {
    processCode: "GS1",
    billingName: "GS1",
    projectName: "GS1",
    metrics: [
      { metricKey: "gs1_email_tat_sec", label: "Email — response w/ resolution", family: "duration", unit: "seconds", target: 3600, direction: "lower_is_better", lobLabel: "Email", kpiMetricCode: null, processSource: { grain: "process" }, notTrackedNote: NO_METRIC_CODE + " (no email TAT metric exists)." },
      { metricKey: "gs1_datacart_tat_sec", label: "Data Cart — download & update", family: "duration", unit: "seconds", target: 3600, direction: "lower_is_better", lobLabel: "Data Cart", kpiMetricCode: null, processSource: { grain: "process" }, notTrackedNote: NO_METRIC_CODE },
      { metricKey: "gs1_approval_tat_sec", label: "Approval — verify product data", family: "duration", unit: "seconds", target: 4 * 3600, direction: "lower_is_better", lobLabel: "Approval", kpiMetricCode: null, processSource: { grain: "process" }, notTrackedNote: NO_METRIC_CODE },
    ],
  },
];

export function findProcessKpiSet(processCode: string): ProcessKpiSet | undefined {
  return PROCESS_KPI_REGISTRY.find((p) => p.processCode === processCode);
}

export function findMetricDef(processCode: string, metricKey: string): KpiMetricDef | undefined {
  return findProcessKpiSet(processCode)?.metrics.find((m) => m.metricKey === metricKey);
}
