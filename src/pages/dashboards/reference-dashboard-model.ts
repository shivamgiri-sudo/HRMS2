import type { RoleDashboardVariant } from "./roleDashboardAccess";
import type {
  DashboardMetric,
  DashboardSummaryContract,
} from "../../../backend/src/shared/dashboardMetricContract";

export type JsonRecord = Record<string, unknown>;
export type Tone = "blue" | "green" | "amber" | "red" | "violet" | "slate";

export type MetricResult = DashboardMetric;
export type DashboardSummary = DashboardSummaryContract;

export interface EmployeeDashboardData {
  attendance: JsonRecord;
  balances: JsonRecord[];
  onboarding: JsonRecord;
  lms: JsonRecord;
  engagement: JsonRecord;
  sourceErrors?: string[];
  sourceFreshness?: Record<string, string | null>;
}

export interface ReferenceDashboardData {
  variant: RoleDashboardVariant;
  summary: DashboardSummary;
  metrics: Record<string, MetricResult>;
  /**
   * Returns the props that make a metric tile open the drill-down drawer, or `{}` when
   * the metric has no usable drilldown route. Spread onto a ReferenceMetric:
   *   { label: "Headcount", value: hc, ...data.drilldownFor("hc") }
   * The drawer itself is owned once by ReferenceRoleDashboard.
   *
   * `filters` narrows the drawer's own query (sent as query-string params on the
   * drilldown request) for a metric whose backing table has more than one tile pointed
   * at it — e.g. "Onboarding Pending" and "Onboarding Stuck" both key on "onb" but
   * should each open a drawer scoped to their own status bucket, not an identical
   * everything-included breakdown. Metrics with only one tile can omit it.
   */
  drilldownFor?: (metricKey: string, filters?: Record<string, string>) => { onDrilldown?: () => void };
  employee: EmployeeDashboardData;
  ats: JsonRecord;
  system: JsonRecord;
  workforce: JsonRecord;
  pnl: JsonRecord;
  payroll: JsonRecord;
  payrollRuns?: JsonRecord[];
  selectedPayrollRunId?: string;
  onPayrollRunChange?: (runId: string) => void;
  biometric: JsonRecord;
  devices: JsonRecord;
  opsPulse: JsonRecord;
  managerLeaves: JsonRecord[];
  managerInsights: JsonRecord;
  managerAccountability: JsonRecord[];
  quality: JsonRecord;
  orgKpi: JsonRecord;
  itProvisioning?: JsonRecord;
  itProvisioningAvailable?: boolean;
  itDashboard?: JsonRecord;
  loading: boolean;
  refreshing: boolean;
  generatedAt?: string;
}

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export function asArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

export function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function asString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

export function read(record: JsonRecord, ...path: string[]): unknown {
  let current: unknown = record;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as JsonRecord)[key];
  }
  return current;
}

export function numberAt(record: JsonRecord, ...path: string[]): number | null {
  return asNumber(read(record, ...path));
}

export function stringAt(record: JsonRecord, ...path: string[]): string | null {
  return asString(read(record, ...path));
}

export function arrayAt(record: JsonRecord, ...path: string[]): JsonRecord[] {
  return asArray(read(record, ...path));
}

export function metricValue(metrics: Record<string, MetricResult>, key: string): number | null {
  return asNumber(metrics[key]?.value);
}

export function metricDetail(
  metrics: Record<string, MetricResult>,
  key: string,
  detailKey: string,
): number | null {
  return asNumber(metrics[key]?.detail?.[detailKey]);
}

/**
 * The date a metric actually describes, when that is not "now".
 *
 * Attendance is anchored on the last substantially-processed day — two days back
 * today — because today is partial and reads as ~0%. A tile that shows that figure
 * without saying which day it is presents stale data as current, and a low reading
 * then looks like a fault rather than an old number.
 */
export function metricAsOf(
  metrics: Record<string, MetricResult>,
  key: string,
): string | null {
  const value = (metrics[key] as { asOf?: unknown } | undefined)?.asOf;
  // The contract carries asOf as a full ISO datetime (so it validates as one field for
  // every metric), but what a tile wants to say is which DAY the figure describes — a
  // trailing "T00:00:00.000Z" printed inline in prose reads as broken, not precise.
  return typeof value === "string" && value ? value.slice(0, 10) : null;
}

/**
 * Metrics whose query actually failed. A source that simply holds no rows is NOT
 * included — it reports `available: true` with errorCode NO_DATA_IN_SOURCE, because
 * listing empty tables next to genuine failures is what made real breakage invisible.
 */
export function unavailableMetricCodes(metrics: Record<string, MetricResult>): string[] {
  return Object.entries(metrics)
    .filter(([, metric]) => metric.available === false)
    .map(([code, metric]) => metric.errorCode || code);
}

/** Metric keys whose source exists and is reachable but currently holds no records. */
export function emptySourceMetricKeys(metrics: Record<string, MetricResult>): string[] {
  return Object.entries(metrics)
    .filter(([, metric]) => metric.available !== false && metric.errorCode === "NO_DATA_IN_SOURCE")
    .map(([key]) => key);
}

/**
 * The exact string metricUnavailableReason returns for an empty-but-reachable source, as
 * opposed to a genuine failure. Exported so a renderer can tell "nothing has happened
 * yet" apart from "this is broken" without re-deriving the distinction from errorCode
 * itself or, worse, guessing from the reason text.
 */
export const METRIC_NO_DATA_REASON = "No data recorded yet";

/**
 * Why a metric has nothing to show, phrased for a dashboard tile — or null when the
 * metric carries a real measurement (including a real zero).
 */
export function metricUnavailableReason(
  metrics: Record<string, MetricResult>,
  key: string,
): string | null {
  const metric = metrics[key];
  if (!metric) return null;
  if (metric.available === false) {
    return metric.errorCode === "QUERY_FAILED"
      ? "Source query failed"
      : "Source unavailable";
  }
  if (metric.errorCode === "NO_DATA_IN_SOURCE") return METRIC_NO_DATA_REASON;
  return null;
}

export function percent(part: number | null, total: number | null): number | null {
  if (part === null || total === null || total <= 0) return null;
  return Math.round((part / total) * 1000) / 10;
}

export function formatValue(value: unknown, suffix = ""): string {
  if (value === null || value === undefined || value === "") return "—";
  const number = asNumber(value);
  if (number !== null) {
    return `${number.toLocaleString("en-IN", { maximumFractionDigits: 1 })}${suffix}`;
  }
  return `${String(value)}${suffix}`;
}

export function formatCurrency(value: number | null): string {
  if (value === null) return "—";
  if (Math.abs(value) >= 10_000_000) return `₹ ${(value / 10_000_000).toFixed(2)} Cr`;
  if (Math.abs(value) >= 100_000) return `₹ ${(value / 100_000).toFixed(2)} L`;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function statusCount(rows: JsonRecord[], status: string): number {
  const normalized = status.toLowerCase();
  return rows.filter((row) => String(row.status ?? "").toLowerCase() === normalized).length;
}

export function countEmployeesOnLeaveOnDate(rows: JsonRecord[], date: string): number {
  const employeeIds = new Set<string>();

  for (const row of rows) {
    if (String(row.status ?? "").toLowerCase() !== "approved") continue;
    const start = String(row.start_date ?? row.from_date ?? row.leave_date ?? "").slice(0, 10);
    const end = String(row.end_date ?? row.to_date ?? row.leave_date ?? "").slice(0, 10);
    if (!start || !end || date < start || date > end) continue;

    const employeeId = row.employee_id ?? row.employeeId;
    if (employeeId !== null && employeeId !== undefined && employeeId !== "") {
      employeeIds.add(String(employeeId));
    }
  }

  return employeeIds.size;
}
