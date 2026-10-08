import type { InsightAction } from "../../kit";
import type { JsonRecord, MetricResult } from "../../reference-dashboard-model";
import { asNumber } from "../../reference-dashboard-model";

/** Shapes mirror backend/src/modules/dashboards/role-insights/providers/payrollRun.ts (loadRunInsights). */
export type StageState = "done" | "current" | "pending" | "blocked" | "unknown";
export interface PipelineStage { key: string; label: string; state: StageState; detail: string; href: string }
export interface Pipeline {
  stages: PipelineStage[]; stuckAt: string | null; stuckLabel: string | null;
  payDate: string | null; daysToPayDate: number | null; lastActivityDays: number | null;
}
export interface RunTotals {
  employees: number; net: number; deductions: number; contractGross: number; employer: number; payrollCost: number;
  lopDays: number; lopEmployees: number; zeroNet: number; negativeNet: number; inactiveInRun: number;
  incentive: number; arrears: number; overtime: number; tds: number; loanEmi: number; reimbursement: number;
  ptLines: number; ptAmount: number; pfLiability: number; esiLiability: number;
}
export interface Filing { type: string; label: string; dueDate: string | null; status: "filed" | "pending" | "overdue"; amountDue: number | null; daysToDue: number | null }
export interface Headcount {
  activeInScope: number; inRun: number; activeInRun: number; paidInactive: number;
  missingTotal: number; missingNotDue: number; missingNoStructure: number; missingOther: number;
}
export interface RunData {
  totals: RunTotals; previous: RunTotals | null; previousRun: { id: string; month: string } | null;
  headcount: Headcount; drivers: Array<{ key: string; label: string; amount: number; hint: string }>;
  filings: Filing[]; pipeline: Pipeline;
  payslips: { expected: number; generated: number; acknowledged: number; emailed: number } | null;
  disbursement: { status: string | null; amount: number | null; employees: number | null; bankRef: string | null; at: string | null } | null;
  readinessUnits: { units: number; frozen: number } | null;
  branchCost: Array<{ branch: string; employees: number; net: number; deductions: number; cost: number }>;
  abnormal: Array<{ code: string; name: string; net: number; prevNet?: number; reason: string }>;
}

/** Null when the backend could not compute run analytics (it then lists `runInsights` in unavailableSources). */
export function readRunData(payroll: JsonRecord): RunData | null {
  const raw = payroll.runInsights;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<RunData>;
  if (!r.totals || !r.headcount || !r.pipeline) return null;
  return r as RunData;
}

/** Percent change, null when there is no usable previous value. */
export function pctChange(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current === null || current === undefined || previous === null || previous === undefined || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export function stageProgress(stages: PipelineStage[]): { done: number; total: number } {
  const counted = stages.filter((s) => s.state !== "unknown");
  return { done: counted.filter((s) => s.state === "done").length, total: counted.length };
}

/**
 * Composite 0-100 health for the hero ring: the mean of whichever of these can be measured (needs two or more),
 * so a missing source lowers confidence rather than dragging the score to zero.
 *   readiness - active employees holding a payable bank account AND a usable PAN (30/60-day joining grace)
 *   coverage  - active employees (excluding future joiners) that have a line in this run
 *   pipeline  - run stages completed
 *   filings   - statutory filings filed (PF/ESI/TDS/LWF)
 */
export function payrollHealth(input: { readinessPct: number | null; run: RunData | null }): { value: number; basis: string } | null {
  const parts: Array<[string, number]> = [];
  if (input.readinessPct !== null) parts.push(["bank+PAN readiness", input.readinessPct]);
  const h = input.run?.headcount;
  if (h) {
    const due = h.activeInScope - h.missingNotDue;
    if (due > 0) parts.push(["run coverage", Math.min(100, (h.activeInRun / due) * 100)]);
  }
  if (input.run) {
    const p = stageProgress(input.run.pipeline.stages);
    if (p.total > 0) parts.push(["pipeline progress", (p.done / p.total) * 100]);
    if (input.run.filings.length) parts.push(["filings filed", (input.run.filings.filter((f) => f.status === "filed").length / input.run.filings.length) * 100]);
  }
  if (parts.length < 2) return null;
  const value = Math.round(parts.reduce((s, [, v]) => s + v, 0) / parts.length);
  return { value, basis: `Mean of ${parts.map(([n, v]) => `${n} ${Math.round(v)}%`).join(", ")}` };
}

const sev = (count: number | null, high: number, critical: number): InsightAction["severity"] =>
  count === null || count <= 0 ? "info" : count >= critical ? "critical" : count >= high ? "high" : "normal";

export interface LocalActionInput {
  run: RunData | null;
  missingBank: number | null;
  missingPan: number | null;
  invalidPan: number | null;
  missingUan: number | null;
  attendanceBlockers: number | null;
}

/**
 * Queues derivable from the summary payload itself, shown immediately while the slower insights feed loads.
 * Every href is a mounted route (src/config/routes/payroll.routes.tsx).
 */
export function buildLocalActions(i: LocalActionInput): InsightAction[] {
  const out: InsightAction[] = [];
  const add = (a: InsightAction) => out.push(a);
  if (i.run) {
    const p = i.run.pipeline;
    const stuck = p.stages.find((s) => s.key === p.stuckAt);
    if (stuck) {
      const late = p.daysToPayDate !== null && p.daysToPayDate < 0;
      add({
        id: "run-stuck", label: `Run is waiting at: ${stuck.label}`, count: 1, href: stuck.href,
        severity: stuck.state === "blocked" || late ? "critical" : "high", group: "Run",
        oldestDays: p.lastActivityDays, overdue: late ? 1 : 0, hint: stuck.detail,
      });
    }
    const missing = i.run.headcount.missingNoStructure;
    add({ id: "no-structure", label: "Active employees with no salary structure", count: missing, href: "/payroll/package-admin", severity: sev(missing, 1, 10), group: "Run", hint: "Cannot be calculated until a package is assigned" });
    const zero = i.run.totals.zeroNet + i.run.totals.negativeNet;
    add({ id: "zero-net", label: "Zero or negative net lines in this run", count: zero, href: "/payroll/attendance-control-tower", severity: sev(zero, 1, 50), group: "Run", hint: "Usually missing attendance, or unpaid leave" });
  }
  add({ id: "bank", label: "Employees without a payable bank account", count: i.missingBank, href: "/payroll/payment-center?tab=bank", severity: sev(i.missingBank, 1, 50), group: "Disbursal", hint: "Past the 30-day joining grace; cannot be paid by NEFT" });
  const pan = (i.missingPan ?? 0) + (i.invalidPan ?? 0);
  add({ id: "pan", label: "Employees with a missing or invalid PAN", count: i.missingPan === null && i.invalidPan === null ? null : pan, href: "/employees", severity: sev(pan, 1, 100), group: "Statutory", hint: "Blocks TDS computation" });
  add({ id: "uan", label: "Employees without a UAN", count: i.missingUan, href: "/payroll/pf-management", severity: sev(i.missingUan, 1, 200), group: "Statutory", hint: "Blocks PF filing; 60-day grace applied" });
  add({ id: "att-blockers", label: "Attendance exceptions blocking payroll", count: i.attendanceBlockers, href: "/payroll/attendance-control-tower", severity: sev(i.attendanceBlockers, 1, 100), group: "Attendance" });
  return out;
}

export function asRunRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

export function metricStatusTone(metrics: Record<string, MetricResult>, key: string): "red" | "amber" | "green" | "slate" {
  const status = (metrics[key] as { status?: string } | undefined)?.status;
  return status === "critical" ? "red" : status === "warn" ? "amber" : status === "ok" ? "green" : "slate";
}

export const nz = (v: unknown): number | null => asNumber(v);

export function formatPayDate(date: string | null): string {
  if (!date) return "—";
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
