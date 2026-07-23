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
  quality: JsonRecord;
  orgKpi: JsonRecord;
  itProvisioning?: JsonRecord;
  itProvisioningAvailable?: boolean;
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

export function unavailableMetricCodes(metrics: Record<string, MetricResult>): string[] {
  return Object.entries(metrics)
    .filter(([, metric]) => metric.available === false)
    .map(([code, metric]) => metric.errorCode || code);
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
