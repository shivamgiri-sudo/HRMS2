/**
 * Payroll Readiness — the five categories the governance gate did not cover.
 *
 *   1. Incentive amount readiness      (VARIABLE_PAY)
 *   2. Reimbursement readiness         (VARIABLE_PAY)
 *   3. Recovery / deduction readiness  (RECOVERY)
 *   4. Full & Final readiness          (FULL_AND_FINAL)
 *   5. Payment-file readiness          (PAYMENT_FILE + RECONCILIATION)
 *
 * ⚠️ RELATIONSHIP TO payroll-governance.service.ts — READ BEFORE EXTENDING EITHER
 *   payroll-governance.service.ts is CANONICAL for "may this run be CALCULATED". It carries its
 *   own category taxonomy (PayrollReadinessCategory) covering the same five subject areas in
 *   blocker/warning terms, and it is the gate the calculate endpoint actually enforces. Nothing
 *   here overrides, wraps or re-decides that. `canCalculate` is untouched.
 *
 *   This module is the PAYMENT-READINESS DEPTH LAYER underneath it, and exists because the
 *   governance gate deliberately answers at run level what payment needs answered at employee
 *   level. Concretely it adds, and is the only place that provides:
 *     · per-employee affected populations for every payment-blocking condition;
 *     · SOURCE_MISSING and NOT_APPLICABLE as first-class outcomes, so "no source of truth
 *       exists" is distinguishable from "checked and clean" — a distinction blocker/warning
 *       cannot express;
 *     · `canPay`, a gate separate from `canCalculate`, so a month can be reported as
 *       calculation-available and simultaneously NOT READY FOR PAYMENT;
 *     · payment-file reconciliation (batch total and headcount against eligible payroll),
 *       duplicate instruction, already-paid markers and file reproducibility;
 *     · F&F net_payable reconciliation against its own components.
 *
 *   The two therefore overlap in subject and not in question. That overlap is real and should
 *   not be left indefinitely: consolidating the shared incentive/reimbursement/recovery
 *   predicates into one place is an open architecture decision, recorded here rather than
 *   resolved unilaterally because both were written against live production evidence and each
 *   found defects the other did not.
 *
 * FAIL-CLOSED IS THE POINT
 *   These are payroll governance controls. A dead table, a renamed column or a thrown query
 *   must never read as PASS. Every check runs inside runCheck(), which converts any throw into
 *   CHECK_ERROR, and CHECK_ERROR blocks readiness exactly like FAIL. The distinction matters
 *   only for diagnosis, never for whether the gate opens.
 *
 * NO INVENTED BUSINESS RULES
 *   Where the repository has no authoritative source for a category, the result is
 *   SOURCE_MISSING and the category is reported as an architecture gap — never PASS, and never
 *   a rule made up here. Specifically, as verified against production on 2026-08-13:
 *     · Reimbursement→payroll integration does not exist (see REIMB_SOURCE below).
 *     · There is no F&F calculation engine (see FF_ENGINE below).
 *     · There is no generated-payment-file history table (see PAYFILE_HISTORY below).
 *   Those three report SOURCE_MISSING by design. Making them green would be manufacturing
 *   evidence, which is the failure this module exists to prevent.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

// ─── State + severity vocabulary ─────────────────────────────────────────────

/**
 * PASS            — check ran, condition satisfied.
 * FAIL            — check ran, real readiness defect found.
 * BLOCKED         — cannot be assessed because a prerequisite is unmet (e.g. run not calculated).
 * NOT_APPLICABLE  — the condition genuinely does not apply to this run/population.
 * SOURCE_MISSING  — no authoritative source of truth exists in the repository/schema.
 * CHECK_ERROR     — the check itself threw. Never green, never silently dropped.
 */
export type ReadinessState =
  | "PASS"
  | "FAIL"
  | "BLOCKED"
  | "NOT_APPLICABLE"
  | "SOURCE_MISSING"
  | "CHECK_ERROR";

/** Any state other than these is treated as not-ready. Listed positively so a new state added later fails closed. */
const GREEN_STATES: ReadonlySet<ReadinessState> = new Set<ReadinessState>(["PASS", "NOT_APPLICABLE"]);

export function isGreen(state: ReadinessState): boolean {
  return GREEN_STATES.has(state);
}

/**
 * P0 — could cause incorrect pay, duplicate payment, payment to the wrong account, an unpaid
 *      employee, an incorrect statutory result, or corruption of a finalized run.
 * P1 — material control gap that must close before enterprise go-live, but does not today
 *      prove incorrect money movement.
 * P2 — operational/reporting improvement; does not block correct payroll execution.
 */
export type ReadinessSeverity = "P0" | "P1" | "P2";

/**
 * The layers a payroll month passes through. A month can be green on
 * PAYROLL_CALCULATION and still be red on PAYMENT_FILE — that distinction is the
 * reason this is a list and not a percentage.
 */
export type ReadinessLayer =
  | "SOURCE_DATA"
  | "ATTENDANCE_PAYABLE_DAYS"
  | "EMPLOYEE_MASTER"
  | "BANK"
  | "STATUTORY"
  | "VARIABLE_PAY"
  | "RECOVERY"
  | "FULL_AND_FINAL"
  | "PAYROLL_CALCULATION"
  | "APPROVAL_LOCK"
  | "PAYMENT_FILE"
  | "RECONCILIATION";

export const READINESS_LAYERS: readonly ReadinessLayer[] = [
  "SOURCE_DATA",
  "ATTENDANCE_PAYABLE_DAYS",
  "EMPLOYEE_MASTER",
  "BANK",
  "STATUTORY",
  "VARIABLE_PAY",
  "RECOVERY",
  "FULL_AND_FINAL",
  "PAYROLL_CALCULATION",
  "APPROVAL_LOCK",
  "PAYMENT_FILE",
  "RECONCILIATION",
] as const;

export interface CategoryCheckResult {
  /** Stable identifier. The UI maps it to copy; renaming one orphans stored drill-downs. */
  code: string;
  layer: ReadinessLayer;
  state: ReadinessState;
  severity: ReadinessSeverity;
  /** Employees implicated. 0 for run-level findings that have no per-employee population. */
  affectedEmployees: number;
  message: string;
  /** Non-sensitive supporting numbers. Never bank account, PAN or UAN values. */
  detail?: Record<string, unknown>;
  /** Employee identifiers only — code and name. Masking/RBAC is applied by the route, not here. */
  sample?: Array<Record<string, unknown>>;
}

export interface LayerSummary {
  layer: ReadinessLayer;
  state: ReadinessState;
  checks: number;
  failed: number;
  p0: number;
  p1: number;
  affectedEmployees: number;
}

export interface ReadinessCategoriesResult {
  runId: string;
  runMonth: string;
  /** Bumped whenever a check's meaning changes, so a stored result can be told apart from a fresh one. */
  governanceVersion: string;
  evaluatedAt: string;
  checks: CategoryCheckResult[];
  layers: LayerSummary[];
  summary: {
    p0: number;
    p1: number;
    p2: number;
    failed: number;
    checkErrors: number;
    sourceMissing: number;
  };
  /**
   * Whether the run may proceed to PAYMENT. Deliberately separate from
   * payrollGovernanceService.readiness().canCalculate: a month can be calculable and unpayable.
   */
  canPay: boolean;
  canPayBlockedBy: string[];
}

/** Bump on any change to what a check means. Surfaced in the UI next to the evaluated timestamp. */
// v1.1.0 (2026-08-13): PAYFILE_CALCULATION_INCOMPLETE stopped reading the unmaintained
// calculation_status column, which made it flag 100% of every run, and the real defect it was
// failing to find became its own check, PAYFILE_GROSS_WITHOUT_PAYABLE_DAYS_BASIS. A stored
// v1.0.0 result is not comparable with a v1.1.0 one on those two codes.
export const READINESS_CATEGORIES_VERSION = "categories-v1.1.0";

// ─── Schema probing (fail-closed) ────────────────────────────────────────────

/**
 * mysql2 returns information_schema column aliases in the case the server chooses, and on this
 * estate that has been observed UPPERCASE. Reading only `row.c` silently yields undefined →
 * Number(undefined) → NaN → `> 0` false → "table missing" for a table that exists, which would
 * turn a real FAIL into a SOURCE_MISSING. Both cases are accepted on purpose.
 */
function readCount(row: Record<string, unknown> | undefined): number {
  if (!row) return 0;
  const value = row.c ?? row.C ?? row.count ?? row.COUNT;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const schemaCache = new Map<string, boolean>();

export async function tableExists(table: string): Promise<boolean> {
  const key = `t:${table}`;
  const cached = schemaCache.get(key);
  if (cached !== undefined) return cached;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table],
  );
  const exists = readCount(rows[0] as Record<string, unknown>) > 0;
  schemaCache.set(key, exists);
  return exists;
}

export async function columnExists(table: string, column: string): Promise<boolean> {
  const key = `c:${table}.${column}`;
  const cached = schemaCache.get(key);
  if (cached !== undefined) return cached;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  const exists = readCount(rows[0] as Record<string, unknown>) > 0;
  schemaCache.set(key, exists);
  return exists;
}

/** Test seam: schema probes are cached for the process, so a test that fakes a schema must reset. */
export function __resetSchemaCache(): void {
  schemaCache.clear();
}

// ─── Check plumbing ──────────────────────────────────────────────────────────

interface CheckSpec {
  code: string;
  layer: ReadinessLayer;
  severity: ReadinessSeverity;
}

/**
 * Runs one check and guarantees it never returns green on failure.
 *
 * The catch is the entire reason this wrapper exists. Every one of these checks reads tables
 * that have been renamed, dropped and re-collated during this project's life; a check that
 * throws must report CHECK_ERROR and hold the gate shut, not vanish from the results and leave
 * the category looking clean.
 */
async function runCheck(
  spec: CheckSpec,
  fn: () => Promise<Omit<CategoryCheckResult, "code" | "layer" | "severity">>,
): Promise<CategoryCheckResult> {
  try {
    const result = await fn();
    return { ...spec, ...result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ...spec,
      state: "CHECK_ERROR",
      affectedEmployees: 0,
      message: `Check ${spec.code} could not be evaluated: ${message}. Treated as blocking — missing evidence is not readiness.`,
      detail: { error: message },
    };
  }
}

function pass(message: string, detail?: Record<string, unknown>) {
  return { state: "PASS" as const, affectedEmployees: 0, message, detail };
}

function fail(
  affectedEmployees: number,
  message: string,
  detail?: Record<string, unknown>,
  sample?: Array<Record<string, unknown>>,
) {
  return { state: "FAIL" as const, affectedEmployees, message, detail, sample };
}

function sourceMissing(message: string, detail?: Record<string, unknown>) {
  return { state: "SOURCE_MISSING" as const, affectedEmployees: 0, message, detail };
}

function notApplicable(message: string, detail?: Record<string, unknown>) {
  return { state: "NOT_APPLICABLE" as const, affectedEmployees: 0, message, detail };
}

function blocked(message: string, detail?: Record<string, unknown>) {
  return { state: "BLOCKED" as const, affectedEmployees: 0, message, detail };
}

// ─── Run scope ───────────────────────────────────────────────────────────────

export interface RunScope {
  runId: string;
  runMonth: string;
  status: string;
  monthStart: string;
  monthEnd: string;
  /** SQL fragment over alias `e` (employees) reproducing the governance eligible population. */
  where: string;
  params: unknown[];
}

function monthBounds(runMonth: string) {
  if (!/^\d{4}-\d{2}$/.test(runMonth)) throw new Error(`Invalid run_month format: ${runMonth}`);
  const [year, month] = runMonth.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return { start: `${runMonth}-01`, end: `${runMonth}-${String(lastDay).padStart(2, "0")}` };
}

/**
 * Eligible-employee scope for a run.
 *
 * Kept deliberately identical in shape to payroll-governance.service.ts's runEmployeeScopeSql.
 * If the two ever disagree, this module would report a population the governance gate does not
 * recognise, and every count in the two reports would be quietly incomparable.
 */
export async function loadRunScope(runId: string): Promise<RunScope> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, run_month, status, branch_id, process_id, branch_filter, process_filter
       FROM salary_prep_run WHERE id = ? LIMIT 1`,
    [runId],
  );
  const run = rows[0] as
    | {
        id: string;
        run_month: string;
        status: string;
        branch_id: string | null;
        process_id: string | null;
        branch_filter: string | null;
        process_filter: string | null;
      }
    | undefined;
  if (!run) throw new Error("Payroll run not found");

  const { start, end } = monthBounds(run.run_month);
  const clauses = [
    "e.active_status = 1",
    "LOWER(COALESCE(e.employment_status, 'active')) = 'active'",
    "(COALESCE(e.salary_start_date, e.date_of_joining) IS NULL OR COALESCE(e.salary_start_date, e.date_of_joining) <= ?)",
    "(COALESCE(e.date_of_exit, e.date_of_leaving, e.resignation_date) IS NULL OR COALESCE(e.date_of_exit, e.date_of_leaving, e.resignation_date) >= ?)",
  ];
  const params: unknown[] = [end, start];

  if (run.branch_id) {
    clauses.push("e.branch_id = ?");
    params.push(run.branch_id);
  }
  if (run.process_id) {
    clauses.push("e.process_id = ?");
    params.push(run.process_id);
  }
  if (run.branch_filter) {
    clauses.push("e.branch_id IN (SELECT id FROM branch_master WHERE branch_name = ?)");
    params.push(run.branch_filter);
  }
  if (run.process_filter) {
    clauses.push("e.process_id IN (SELECT id FROM process_master WHERE process_name = ?)");
    params.push(run.process_filter);
  }

  return {
    runId: run.id,
    runMonth: run.run_month,
    status: String(run.status ?? ""),
    monthStart: start,
    monthEnd: end,
    where: clauses.join(" AND "),
    params,
  };
}

/**
 * Counts and samples one population.
 *
 * Uses db.query (text protocol) rather than db.execute for the same reason
 * payroll-governance.service.ts does: these statements put ? placeholders inside subqueries,
 * which the binary prepared-statement protocol rejects with "Incorrect arguments to
 * mysqld_stmt_execute".
 */
async function population(
  sql: string,
  params: unknown[],
): Promise<{ count: number; sample: Array<Record<string, unknown>> }> {
  const [countRows] = (await (db as unknown as {
    query: (s: string, p: unknown[]) => Promise<[RowDataPacket[], unknown]>;
  }).query(`SELECT COUNT(*) AS c FROM (${sql}) issue_rows`, params)) as [RowDataPacket[], unknown];
  const count = readCount(countRows[0] as Record<string, unknown>);
  if (count === 0) return { count: 0, sample: [] };
  const [sampleRows] = (await (db as unknown as {
    query: (s: string, p: unknown[]) => Promise<[RowDataPacket[], unknown]>;
  }).query(`${sql} LIMIT 10`, params)) as [RowDataPacket[], unknown];
  return { count, sample: sampleRows as Array<Record<string, unknown>> };
}

/** Employee identity columns exposed in samples. Deliberately excludes bank, PAN and UAN values. */
const EMP_IDENTITY = `e.id AS employee_id, e.employee_code,
  COALESCE(NULLIF(e.full_name, ''), CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS employee_name`;

// ═════════════════════════════════════════════════════════════════════════════
// 1. INCENTIVE AMOUNT READINESS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Authoritative source, established from the schema and from both consuming code paths:
 *
 *   incentive_master        — configuration (code, name, taxable/pf/esic flags)
 *   incentive_upload_batch  — one batch per (incentive type, pay_month), carries the approval
 *                             state: draft → pending_approval → approved → applied / rejected
 *   incentive_upload_line   — per-employee amount, validation_status ok|error
 *   salary_prep_line.incentive_total + salary_prep_line_component(source='incentive')
 *                           — the payroll-consumed value
 *
 * The batch status is the approval of record; incentive_approval_step and
 * incentive_payroll_register exist but are empty and are written by nothing, so they are not
 * treated as authoritative here.
 *
 * TWO CONSUMERS DISAGREE, WHICH IS ITSELF A FINDING.
 *   payrollCalculate.service.ts reads incentive_upload_batch.status = 'approved'.
 *   incentives.service.ts applyToRun() moves batches to 'applied' once consumed.
 *   So a recalculation after an apply sees no 'approved' batch and writes incentive_total = 0.
 *   INCENTIVE_APPROVED_NOT_IN_PAYROLL catches the resulting silent drop.
 */
async function incentiveChecks(scope: RunScope): Promise<CategoryCheckResult[]> {
  const haveBatch = await tableExists("incentive_upload_batch");
  const haveLine = await tableExists("incentive_upload_line");

  if (!haveBatch || !haveLine) {
    return [
      await runCheck(
        { code: "INCENTIVE_SOURCE_OF_TRUTH", layer: "VARIABLE_PAY", severity: "P1" },
        async () =>
          sourceMissing(
            "No incentive source of truth: incentive_upload_batch / incentive_upload_line are absent. " +
              "Any incentive amount in payroll would be unattributable.",
            { incentive_upload_batch: haveBatch, incentive_upload_line: haveLine },
          ),
      ),
    ];
  }

  const { runId, runMonth, where, params } = scope;

  return Promise.all([
    // Approved incentive exists for the month but no payroll line carries it.
    runCheck({ code: "INCENTIVE_APPROVED_NOT_IN_PAYROLL", layer: "VARIABLE_PAY", severity: "P0" }, async () => {
      const sql = `
        SELECT ${EMP_IDENTITY},
               ROUND(SUM(iul.amount), 2) AS approved_amount,
               ROUND(COALESCE(MAX(spl.incentive_total), 0), 2) AS payroll_amount
          FROM incentive_upload_line iul
          JOIN incentive_upload_batch iub ON iub.id = iul.batch_id
          JOIN employees e ON e.id = iul.employee_id
          LEFT JOIN salary_prep_line spl ON spl.run_id = ? AND spl.employee_id = e.id
         WHERE iub.pay_month = ?
           AND LOWER(iub.status) IN ('approved', 'applied')
           AND iul.validation_status = 'ok'
           AND iul.amount > 0
           AND ${where}
         GROUP BY e.id, e.employee_code, employee_name
        HAVING approved_amount > COALESCE(MAX(spl.incentive_total), 0) + 0.01`;
      const { count, sample } = await population(sql, [runId, runMonth, ...params]);
      return count === 0
        ? pass("Every approved incentive for this month is reflected in payroll.")
        : fail(
            count,
            `${count} employees have an approved incentive for ${runMonth} that payroll has not picked up (or has picked up short). ` +
              "Approved variable pay silently omitted from a run underpays the employee.",
            { pay_month: runMonth },
            sample,
          );
    }),

    // Payroll carries an incentive that no approved batch line justifies.
    runCheck({ code: "INCENTIVE_IN_PAYROLL_WITHOUT_APPROVAL", layer: "VARIABLE_PAY", severity: "P0" }, async () => {
      const sql = `
        SELECT ${EMP_IDENTITY},
               ROUND(spl.incentive_total, 2) AS payroll_amount,
               ROUND(COALESCE((
                 SELECT SUM(iul.amount) FROM incentive_upload_line iul
                   JOIN incentive_upload_batch iub ON iub.id = iul.batch_id
                  WHERE iul.employee_id = e.id AND iub.pay_month = ?
                    AND LOWER(iub.status) IN ('approved','applied')
                    AND iul.validation_status = 'ok'), 0), 2) AS approved_amount
          FROM salary_prep_line spl
          JOIN employees e ON e.id = spl.employee_id
         WHERE spl.run_id = ?
           AND spl.incentive_total > 0
           AND spl.incentive_total > COALESCE((
                 SELECT SUM(iul.amount) FROM incentive_upload_line iul
                   JOIN incentive_upload_batch iub ON iub.id = iul.batch_id
                  WHERE iul.employee_id = e.id AND iub.pay_month = ?
                    AND LOWER(iub.status) IN ('approved','applied')
                    AND iul.validation_status = 'ok'), 0) + 0.01`;
      const { count, sample } = await population(sql, [runMonth, runId, runMonth]);
      return count === 0
        ? pass("No payroll incentive exceeds its approved source amount.")
        : fail(
            count,
            `${count} payroll lines carry an incentive larger than any approved incentive line for ${runMonth}. ` +
              "Money is being paid that no approval authorises.",
            { pay_month: runMonth },
            sample,
          );
    }),

    // Pending / rejected batch amounts must not be in payroll.
    runCheck({ code: "INCENTIVE_UNAPPROVED_BATCH_CONSUMED", layer: "VARIABLE_PAY", severity: "P0" }, async () => {
      const sql = `
        SELECT ${EMP_IDENTITY}, iub.status AS batch_status, ROUND(SUM(iul.amount), 2) AS unapproved_amount
          FROM incentive_upload_line iul
          JOIN incentive_upload_batch iub ON iub.id = iul.batch_id
          JOIN employees e ON e.id = iul.employee_id
          JOIN salary_prep_line spl ON spl.run_id = ? AND spl.employee_id = e.id AND spl.incentive_total > 0
         WHERE iub.pay_month = ?
           AND LOWER(iub.status) NOT IN ('approved', 'applied')
         GROUP BY e.id, e.employee_code, employee_name, iub.status`;
      const { count, sample } = await population(sql, [runId, runMonth]);
      return count === 0
        ? pass("No draft, pending or rejected incentive batch is reflected in payroll.")
        : fail(
            count,
            `${count} employees have incentive amounts in a non-approved batch (draft/pending/rejected) while also carrying incentive in payroll. Verify the payroll figure does not include the unapproved amount.`,
            { pay_month: runMonth },
            sample,
          );
    }),

    // Same employee appearing twice for the same incentive type and month.
    runCheck({ code: "INCENTIVE_DUPLICATE_FOR_PERIOD", layer: "VARIABLE_PAY", severity: "P0" }, async () => {
      const sql = `
        SELECT ${EMP_IDENTITY}, iub.incentive_id, COUNT(*) AS line_count, ROUND(SUM(iul.amount), 2) AS total_amount
          FROM incentive_upload_line iul
          JOIN incentive_upload_batch iub ON iub.id = iul.batch_id
          JOIN employees e ON e.id = iul.employee_id
         WHERE iub.pay_month = ?
           AND LOWER(iub.status) IN ('approved', 'applied')
           AND iul.validation_status = 'ok'
         GROUP BY e.id, e.employee_code, employee_name, iub.incentive_id
        HAVING COUNT(*) > 1`;
      const { count, sample } = await population(sql, [runMonth]);
      return count === 0
        ? pass("No employee has more than one approved line for the same incentive type this month.")
        : fail(
            count,
            `${count} employee/incentive-type pairs have more than one approved line for ${runMonth}. Both amounts are summed into payroll, so a duplicated upload is paid twice.`,
            { pay_month: runMonth },
            sample,
          );
    }),

    // Approved amount for someone not eligible in this period.
    runCheck({ code: "INCENTIVE_EMPLOYEE_NOT_ELIGIBLE_FOR_PERIOD", layer: "VARIABLE_PAY", severity: "P1" }, async () => {
      const sql = `
        SELECT ${EMP_IDENTITY}, ROUND(SUM(iul.amount), 2) AS approved_amount,
               DATE_FORMAT(COALESCE(e.date_of_exit, e.date_of_leaving, e.resignation_date), '%Y-%m-%d') AS exit_date,
               e.active_status, e.employment_status
          FROM incentive_upload_line iul
          JOIN incentive_upload_batch iub ON iub.id = iul.batch_id
          JOIN employees e ON e.id = iul.employee_id
         WHERE iub.pay_month = ?
           AND LOWER(iub.status) IN ('approved', 'applied')
           AND iul.validation_status = 'ok'
           AND NOT (${where})
         GROUP BY e.id, e.employee_code, employee_name, exit_date, e.active_status, e.employment_status`;
      const { count, sample } = await population(sql, [runMonth, ...params]);
      return count === 0
        ? pass("Every approved incentive belongs to an employee eligible for this payroll period.")
        : fail(
            count,
            `${count} employees hold an approved incentive for ${runMonth} but are outside the eligible payroll population for that month (inactive, or exited before/after the period).`,
            { pay_month: runMonth },
            sample,
          );
    }),

    // Amounts that are not usable numbers, or that carry a validation error but were approved anyway.
    runCheck({ code: "INCENTIVE_AMOUNT_NOT_USABLE", layer: "VARIABLE_PAY", severity: "P1" }, async () => {
      const sql = `
        SELECT iul.employee_code, iul.amount, iul.validation_status, iul.validation_msg, iub.status AS batch_status
          FROM incentive_upload_line iul
          JOIN incentive_upload_batch iub ON iub.id = iul.batch_id
         WHERE iub.pay_month = ?
           AND LOWER(iub.status) IN ('approved', 'applied')
           AND (iul.amount IS NULL OR iul.amount <= 0 OR iul.validation_status <> 'ok')`;
      const { count, sample } = await population(sql, [runMonth]);
      return count === 0
        ? pass("All approved incentive lines carry a usable positive amount.")
        : fail(
            count,
            `${count} lines inside an approved incentive batch for ${runMonth} have a non-positive amount or a failed validation status. An approved batch should not contain unusable lines.`,
            { pay_month: runMonth },
            sample,
          );
    }),

    // Traceability: an incentive in payroll with no component row cannot be explained on a payslip.
    runCheck({ code: "INCENTIVE_NOT_TRACEABLE_TO_COMPONENT", layer: "VARIABLE_PAY", severity: "P1" }, async () => {
      if (!(await tableExists("salary_prep_line_component"))) {
        return sourceMissing(
          "salary_prep_line_component is absent, so no incentive paid through payroll can be traced to its source type.",
        );
      }
      const sql = `
        SELECT ${EMP_IDENTITY}, ROUND(spl.incentive_total, 2) AS payroll_amount
          FROM salary_prep_line spl
          JOIN employees e ON e.id = spl.employee_id
         WHERE spl.run_id = ?
           AND spl.incentive_total > 0
           AND NOT EXISTS (
             SELECT 1 FROM salary_prep_line_component c
              WHERE c.line_id = spl.id AND c.source = 'incentive')`;
      const { count, sample } = await population(sql, [runId]);
      return count === 0
        ? pass("Every payroll incentive amount has a matching traceable component row.")
        : fail(
            count,
            `${count} payroll lines carry an incentive with no salary_prep_line_component row, so the amount cannot be broken down on a payslip or traced to an incentive type.`,
            undefined,
            sample,
          );
    }),
  ]);
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. REIMBURSEMENT READINESS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * REIMB_SOURCE — established 2026-08-13 against the live schema and both code paths.
 *
 * Three candidate stores exist and none of them reaches payroll:
 *
 *   employee_reimbursement_claim — the payroll-module table. Has the right shape for payroll
 *       (claim_month, amount_approved, payroll_run_id, status draft→submitted→approved→
 *       rejected→processed). It is the only defensible source. It holds ZERO rows.
 *   reimbursement_claim          — an older, unrelated table with no payroll linkage at all
 *       (no month, no approved amount, no run id). 1 row, rejected. Not a payroll source.
 *   expense_claim                — 5,634 rows, but this is the vendor/imprest expense system,
 *       not employee salary reimbursement, and settles outside payroll. Correctly classified
 *       as NOT_APPLICABLE to payroll rather than forced into it.
 *
 * THE INTEGRATION IS BROKEN, NOT MERELY UNUSED. payrollCalculate.service.ts §5g reads
 *   SELECT SUM(COALESCE(claim_amount, 0)) FROM employee_reimbursement_claim ...
 * and employee_reimbursement_claim has no `claim_amount` column — the columns are
 * amount_claimed and amount_approved. The query therefore raises ER_BAD_FIELD_ERROR on every
 * single employee, and the surrounding bare `catch {}` swallows it, leaving
 * approvedReimbursements = 0. PATCH /reimbursements/:id/process likewise stamps payroll_run_id
 * but never adds the amount to salary_prep_line.reimbursement_total.
 *
 * So: approved reimbursements can never reach payroll by any path. That is reported as
 * SOURCE_MISSING for the integration, plus a FAIL for any approved claim left unsettled —
 * not as PASS, and not by inventing a settlement rule.
 */
async function reimbursementChecks(scope: RunScope): Promise<CategoryCheckResult[]> {
  const haveClaim = await tableExists("employee_reimbursement_claim");
  const { runId, runMonth } = scope;

  const integration = await runCheck(
    { code: "REIMBURSEMENT_PAYROLL_INTEGRATION", layer: "VARIABLE_PAY", severity: "P1" },
    async () => {
      if (!haveClaim) {
        return sourceMissing(
          "employee_reimbursement_claim does not exist. There is no source of truth for employee reimbursement in payroll.",
        );
      }
      // The read path payroll actually uses names a column that does not exist. Probe it rather
      // than asserting from source, so this reports the truth if either side is ever changed.
      const readColumnPresent = await columnExists("employee_reimbursement_claim", "claim_amount");
      const approvedColumnPresent = await columnExists("employee_reimbursement_claim", "amount_approved");
      if (!readColumnPresent) {
        return sourceMissing(
          "Reimbursement→payroll integration is not implemented. payrollCalculate.service.ts reads " +
            "employee_reimbursement_claim.claim_amount, which does not exist on the table (the real columns are " +
            "amount_claimed / amount_approved), and the failure is swallowed by a bare catch — so approved " +
            "reimbursements are always read as zero. No other path writes salary_prep_line.reimbursement_total. " +
            "Reimbursement cannot currently be paid through payroll at all.",
          { reads_column: "claim_amount", column_exists: false, amount_approved_exists: approvedColumnPresent },
        );
      }
      return pass("Payroll reads a reimbursement column that exists on the claim table.");
    },
  );

  const checks = await Promise.all([
    // Approved and unsettled for this month.
    runCheck({ code: "REIMBURSEMENT_APPROVED_NOT_SETTLED", layer: "VARIABLE_PAY", severity: "P1" }, async () => {
      if (!haveClaim) return sourceMissing("employee_reimbursement_claim does not exist.");
      const sql = `
        SELECT ${EMP_IDENTITY}, erc.claim_type, erc.claim_month,
               ROUND(COALESCE(erc.amount_approved, erc.amount_claimed), 2) AS approved_amount,
               erc.status
          FROM employee_reimbursement_claim erc
          JOIN employees e ON e.id = erc.employee_id
         WHERE erc.claim_month = ? AND erc.status = 'approved'`;
      const { count, sample } = await population(sql, [runMonth]);
      return count === 0
        ? pass(`No approved reimbursement claim for ${runMonth} is awaiting settlement.`)
        : fail(
            count,
            `${count} reimbursement claims for ${runMonth} are approved but not settled. Because the payroll integration is broken (see REIMBURSEMENT_PAYROLL_INTEGRATION), they cannot reach payroll and must be settled by an explicit finance decision.`,
            { claim_month: runMonth },
            sample,
          );
    }),

    // Payroll carries a reimbursement amount that no approved claim supports.
    runCheck({ code: "REIMBURSEMENT_IN_PAYROLL_WITHOUT_APPROVAL", layer: "VARIABLE_PAY", severity: "P0" }, async () => {
      const approvedExpr = haveClaim
        ? `COALESCE((SELECT SUM(COALESCE(erc.amount_approved, erc.amount_claimed))
                       FROM employee_reimbursement_claim erc
                      WHERE erc.employee_id = e.id AND erc.claim_month = ?
                        AND erc.status IN ('approved','processed')), 0)`
        : `0`;
      const sql = `
        SELECT ${EMP_IDENTITY}, ROUND(spl.reimbursement_total, 2) AS payroll_amount,
               ROUND(${approvedExpr}, 2) AS approved_amount
          FROM salary_prep_line spl
          JOIN employees e ON e.id = spl.employee_id
         WHERE spl.run_id = ?
           AND spl.reimbursement_total > 0
           AND spl.reimbursement_total > ${approvedExpr} + 0.01`;
      const p = haveClaim ? [runMonth, runId, runMonth] : [runId];
      const { count, sample } = await population(sql, p);
      return count === 0
        ? pass("No payroll reimbursement exceeds an approved claim amount.")
        : fail(
            count,
            `${count} payroll lines carry a reimbursement larger than any approved claim for ${runMonth}.`,
            { claim_month: runMonth },
            sample,
          );
    }),

    // Rejected or cancelled claims must not be settled.
    runCheck({ code: "REIMBURSEMENT_REJECTED_SETTLED", layer: "VARIABLE_PAY", severity: "P0" }, async () => {
      if (!haveClaim) return sourceMissing("employee_reimbursement_claim does not exist.");
      const sql = `
        SELECT ${EMP_IDENTITY}, erc.claim_type, erc.status,
               ROUND(COALESCE(erc.amount_approved, erc.amount_claimed), 2) AS amount
          FROM employee_reimbursement_claim erc
          JOIN employees e ON e.id = erc.employee_id
         WHERE erc.claim_month = ? AND erc.status = 'rejected'
           AND (erc.payroll_run_id IS NOT NULL OR erc.processed_at IS NOT NULL)`;
      const { count, sample } = await population(sql, [runMonth]);
      return count === 0
        ? pass("No rejected reimbursement claim has been attached to a payroll run.")
        : fail(count, `${count} rejected reimbursement claims for ${runMonth} carry a payroll run or a processed timestamp.`, undefined, sample);
    }),

    // Same claim type, same month, same employee, more than once.
    runCheck({ code: "REIMBURSEMENT_DUPLICATE_FOR_PERIOD", layer: "VARIABLE_PAY", severity: "P1" }, async () => {
      if (!haveClaim) return sourceMissing("employee_reimbursement_claim does not exist.");
      const sql = `
        SELECT ${EMP_IDENTITY}, erc.claim_type, erc.claim_month, COUNT(*) AS claim_count,
               ROUND(SUM(COALESCE(erc.amount_approved, erc.amount_claimed)), 2) AS total_amount
          FROM employee_reimbursement_claim erc
          JOIN employees e ON e.id = erc.employee_id
         WHERE erc.claim_month = ? AND erc.status IN ('approved','processed')
         GROUP BY e.id, e.employee_code, employee_name, erc.claim_type, erc.claim_month
        HAVING COUNT(*) > 1`;
      const { count, sample } = await population(sql, [runMonth]);
      return count === 0
        ? pass("No duplicate approved reimbursement for the same type and month.")
        : fail(count, `${count} employee/claim-type pairs have more than one approved reimbursement for ${runMonth}.`, undefined, sample);
    }),

    // Approved without the mandatory evidence reference.
    runCheck({ code: "REIMBURSEMENT_MISSING_EVIDENCE", layer: "VARIABLE_PAY", severity: "P2" }, async () => {
      if (!haveClaim) return sourceMissing("employee_reimbursement_claim does not exist.");
      const sql = `
        SELECT ${EMP_IDENTITY}, erc.claim_type, erc.status
          FROM employee_reimbursement_claim erc
          JOIN employees e ON e.id = erc.employee_id
         WHERE erc.claim_month = ? AND erc.status IN ('approved','processed')
           AND COALESCE(NULLIF(TRIM(erc.documents_url), ''), NULLIF(TRIM(erc.description), '')) IS NULL`;
      const { count, sample } = await population(sql, [runMonth]);
      return count === 0
        ? pass("Every approved reimbursement carries a document reference or description.")
        : fail(count, `${count} approved reimbursement claims for ${runMonth} have neither a document reference nor a description.`, undefined, sample);
    }),

    // The expense system settles outside payroll — say so explicitly rather than silently ignoring it.
    runCheck({ code: "REIMBURSEMENT_EXPENSE_CLAIM_SCOPE", layer: "VARIABLE_PAY", severity: "P2" }, async () => {
      if (!(await tableExists("expense_claim"))) {
        return notApplicable("expense_claim does not exist; there is no non-payroll expense system to classify.");
      }
      return notApplicable(
        "expense_claim is the vendor/imprest expense system and settles outside payroll — it is correctly excluded " +
          "from payroll reimbursement readiness rather than folded into it. Confirm with Finance that no employee " +
          "salary reimbursement is being routed through it.",
      );
    }),
  ]);

  return [integration, ...checks];
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. RECOVERY / DEDUCTION READINESS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Implemented recovery sources, verified against the live schema — not assumed:
 *
 *   employee_loans           — loans and advances. amount, installments, deduction_per_month,
 *                              deducted_amount, pending_amount, start_date, end_date, status.
 *                              Consumed by payrollCalculate §5e into salary_prep_line.loan_emi.
 *   salary_advance_log       — salary advances with recovery_months / recovered_amount.
 *                              Consumed by §5d into advance_recovery. Empty in production.
 *   employee_deduction_entries — ad-hoc deductions (canteen, uniform…) with a deduction type.
 *                              Consumed by the custom-deduction block into other_deductions.
 *                              Empty in production.
 *   employee_deductions_log  — a LEGACY monthly import (mobile/asset/short-collection). NOT read
 *                              by any calculation path. Reported as an unreconciled source rather
 *                              than treated as authoritative, because promoting it would start
 *                              deducting money from a table nothing has validated.
 *
 * Notice-period and asset recovery have no standalone workflow table; they exist only as
 * columns on full_final_calculation and are therefore covered by the F&F category.
 */
async function recoveryChecks(scope: RunScope): Promise<CategoryCheckResult[]> {
  const { runId, runMonth, monthStart } = scope;
  const haveLoans = await tableExists("employee_loans");
  const haveAdvance = await tableExists("salary_advance_log");
  const haveEntries = await tableExists("employee_deduction_entries");
  const haveLegacyLog = await tableExists("employee_deductions_log");

  if (!haveLoans && !haveAdvance && !haveEntries) {
    return [
      await runCheck({ code: "RECOVERY_SOURCE_OF_TRUTH", layer: "RECOVERY", severity: "P1" }, async () =>
        sourceMissing("No recovery source of truth exists: employee_loans, salary_advance_log and employee_deduction_entries are all absent."),
      ),
    ];
  }

  return Promise.all([
    // The big one: a loan whose schedule has run out while money is still owed.
    runCheck({ code: "RECOVERY_OUTSTANDING_NOT_BEING_RECOVERED", layer: "RECOVERY", severity: "P1" }, async () => {
      if (!haveLoans) return sourceMissing("employee_loans does not exist.");
      const sql = `
        SELECT ${EMP_IDENTITY}, l.loan_type,
               ROUND(l.amount, 2) AS loan_amount,
               ROUND(l.pending_amount, 2) AS outstanding,
               ROUND(l.deduction_per_month, 2) AS scheduled_emi,
               DATE_FORMAT(l.end_date, '%Y-%m-%d') AS schedule_end
          FROM employee_loans l
          JOIN employees e ON e.id = l.employee_id
         WHERE l.status = 'active'
           AND l.pending_amount > 0
           AND l.end_date IS NOT NULL
           AND l.end_date < ?`;
      const { count, sample } = await population(sql, [monthStart]);
      return count === 0
        ? pass("No active loan has an expired schedule with an outstanding balance.")
        : fail(
            count,
            `${count} active loans have an end_date before ${monthStart} while still showing an outstanding balance. ` +
              "payrollCalculate only recovers inside the start_date…end_date window, so recovery has silently stopped " +
              "on these while the debt stands. This is a recovery-omission gap, not proof of wrong pay — the balances " +
              "may be stale legacy imports, which is exactly what needs a Finance decision.",
            { month_start: monthStart },
            sample,
          );
    }),

    // Deduction applied with no authoritative source behind it.
    runCheck({ code: "RECOVERY_DEDUCTION_WITHOUT_SOURCE", layer: "RECOVERY", severity: "P0" }, async () => {
      if (!haveLoans) return sourceMissing("employee_loans does not exist, so loan_emi in payroll cannot be attributed.");
      const sql = `
        SELECT ${EMP_IDENTITY}, ROUND(spl.loan_emi, 2) AS deducted_emi
          FROM salary_prep_line spl
          JOIN employees e ON e.id = spl.employee_id
         WHERE spl.run_id = ?
           AND spl.loan_emi > 0
           AND NOT EXISTS (
             SELECT 1 FROM employee_loans l
              WHERE l.employee_id = e.id AND l.status = 'active'
                AND l.start_date <= ? AND (l.end_date IS NULL OR l.end_date >= ?))`;
      const { count, sample } = await population(sql, [runId, monthStart, monthStart]);
      return count === 0
        ? pass("Every loan EMI deducted in payroll maps to an active loan covering this month.")
        : fail(count, `${count} payroll lines deduct a loan EMI with no active loan covering ${runMonth}. Money is being recovered against no authorised obligation.`, undefined, sample);
    }),

    // Amount mismatch between the obligation and the deduction.
    runCheck({ code: "RECOVERY_AMOUNT_MISMATCH", layer: "RECOVERY", severity: "P0" }, async () => {
      if (!haveLoans) return sourceMissing("employee_loans does not exist.");
      const sql = `
        SELECT ${EMP_IDENTITY},
               ROUND(spl.loan_emi, 2) AS deducted_emi,
               ROUND(src.expected_emi, 2) AS expected_emi
          FROM salary_prep_line spl
          JOIN employees e ON e.id = spl.employee_id
          JOIN (
            SELECT employee_id, SUM(deduction_per_month) AS expected_emi
              FROM employee_loans
             WHERE status = 'active' AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)
             GROUP BY employee_id
          ) src ON src.employee_id = e.id
         WHERE spl.run_id = ?
           AND ABS(spl.loan_emi - src.expected_emi) > 0.01`;
      const { count, sample } = await population(sql, [monthStart, monthStart, runId]);
      return count === 0
        ? pass("Every loan EMI deducted equals the scheduled obligation for the month.")
        : fail(count, `${count} payroll lines deduct a loan EMI that differs from the scheduled obligation for ${runMonth}.`, undefined, sample);
    }),

    // Recovery beyond the remaining outstanding balance.
    runCheck({ code: "RECOVERY_EXCEEDS_OUTSTANDING", layer: "RECOVERY", severity: "P0" }, async () => {
      if (!haveLoans) return sourceMissing("employee_loans does not exist.");
      const sql = `
        SELECT ${EMP_IDENTITY}, ROUND(spl.loan_emi, 2) AS deducted_emi, ROUND(src.outstanding, 2) AS outstanding
          FROM salary_prep_line spl
          JOIN employees e ON e.id = spl.employee_id
          JOIN (
            SELECT employee_id, SUM(pending_amount) AS outstanding
              FROM employee_loans
             WHERE status = 'active' AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)
             GROUP BY employee_id
          ) src ON src.employee_id = e.id
         WHERE spl.run_id = ?
           AND spl.loan_emi > src.outstanding + 0.01`;
      const { count, sample } = await population(sql, [monthStart, monthStart, runId]);
      return count === 0
        ? pass("No recovery exceeds the remaining outstanding balance.")
        : fail(count, `${count} payroll lines recover more than the remaining outstanding balance on the underlying loan.`, undefined, sample);
    }),

    // Already-settled obligation being deducted again.
    runCheck({ code: "RECOVERY_SETTLED_DEDUCTED_AGAIN", layer: "RECOVERY", severity: "P0" }, async () => {
      if (!haveLoans) return sourceMissing("employee_loans does not exist.");
      const sql = `
        SELECT ${EMP_IDENTITY}, ROUND(spl.loan_emi, 2) AS deducted_emi, l.status AS loan_status,
               ROUND(l.pending_amount, 2) AS outstanding
          FROM salary_prep_line spl
          JOIN employees e ON e.id = spl.employee_id
          JOIN employee_loans l ON l.employee_id = e.id
         WHERE spl.run_id = ?
           AND spl.loan_emi > 0
           AND (LOWER(l.status) IN ('completed', 'closed', 'recovered') OR l.pending_amount <= 0)
           AND NOT EXISTS (
             SELECT 1 FROM employee_loans l2
              WHERE l2.employee_id = e.id AND l2.status = 'active' AND l2.pending_amount > 0)`;
      const { count, sample } = await population(sql, [runId]);
      return count === 0
        ? pass("No settled or fully-recovered obligation is being deducted again.")
        : fail(count, `${count} payroll lines deduct against an obligation that is already settled or fully recovered.`, undefined, sample);
    }),

    // Advance recovery beyond what remains.
    runCheck({ code: "RECOVERY_ADVANCE_OVER_RECOVERED", layer: "RECOVERY", severity: "P0" }, async () => {
      if (!haveAdvance) return sourceMissing("salary_advance_log does not exist.");
      const sql = `
        SELECT ${EMP_IDENTITY}, ROUND(a.amount, 2) AS advance_amount,
               ROUND(COALESCE(a.recovered_amount, 0), 2) AS recovered, a.status
          FROM salary_advance_log a
          JOIN employees e ON e.id = a.employee_id
         WHERE COALESCE(a.recovered_amount, 0) > a.amount + 0.01`;
      const { count, sample } = await population(sql, []);
      return count === 0
        ? pass("No salary advance has been recovered beyond its principal.")
        : fail(count, `${count} salary advances show a recovered amount greater than the advance itself.`, undefined, sample);
    }),

    // Custom deduction targeting the wrong month.
    runCheck({ code: "RECOVERY_WRONG_PAYROLL_MONTH", layer: "RECOVERY", severity: "P1" }, async () => {
      if (!haveEntries) return sourceMissing("employee_deduction_entries does not exist.");
      const sql = `
        SELECT ${EMP_IDENTITY}, ede.deduction_type_code, ROUND(ede.amount, 2) AS amount, ede.run_month, ede.status
          FROM employee_deduction_entries ede
          JOIN employees e ON e.id = ede.employee_id
          JOIN salary_prep_line spl ON spl.run_id = ? AND spl.employee_id = e.id AND spl.other_deductions > 0
         WHERE ede.status = 'active'
           AND ede.run_month IS NOT NULL
           AND ede.run_month <> ?`;
      const { count, sample } = await population(sql, [runId, runMonth]);
      return count === 0
        ? pass("No custom deduction targets a different payroll month than the one being deducted.")
        : fail(count, `${count} active custom deductions are stamped for a different month than ${runMonth} while that employee carries other_deductions in this run.`, undefined, sample);
    }),

    // A legacy recovery store nothing reads.
    runCheck({ code: "RECOVERY_UNRECONCILED_LEGACY_SOURCE", layer: "RECOVERY", severity: "P2" }, async () => {
      if (!haveLegacyLog) return notApplicable("employee_deductions_log does not exist; there is no legacy recovery store to reconcile.");
      const sql = `
        SELECT edl.employee_code, edl.salary_month, ROUND(edl.total_deduction, 2) AS total_deduction
          FROM employee_deductions_log edl
         WHERE edl.salary_month = ? AND edl.total_deduction > 0`;
      const { count, sample } = await population(sql, [runMonth]);
      return count === 0
        ? notApplicable(
            `employee_deductions_log holds no rows for ${runMonth}. It is a legacy import that no calculation path reads; ` +
              "it is reported for completeness rather than treated as an authoritative recovery source.",
          )
        : fail(
            count,
            `${count} legacy deduction rows exist for ${runMonth} in employee_deductions_log, which no payroll calculation path reads. ` +
              "Either these recoveries are being missed or the table is dead data — Finance must decide which.",
            undefined,
            sample,
          );
    }),
  ]);
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. FULL & FINAL READINESS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * FF_ENGINE — there is no F&F calculation engine in this repository.
 *
 * full_final_calculation exists and ffService.createFF() writes it, but every monetary field —
 * notice_recovery, earned_leave_encashment, gratuity_amount, salary_hold, advances_recovery and
 * net_payable itself — arrives as caller-supplied input on FfInput. Nothing derives them from
 * attendance through the last working day, the leave balance, the outstanding recovery ledger,
 * unpaid salary or arrears, and nothing checks that net_payable equals the sum of its own
 * components. The single computed piece is gratuity, via calculateGratuity, and even that must
 * be passed in by the caller.
 *
 * So F&F is a data-entry form with a gratuity helper attached. This module reports
 * F&F CALCULATION ENGINE NOT IMPLEMENTED rather than manufacturing readiness out of exit
 * status, which would assert that a settlement had been calculated when no calculation exists.
 */
async function fullFinalChecks(scope: RunScope): Promise<CategoryCheckResult[]> {
  const { runId, monthStart, monthEnd } = scope;
  const haveFf = await tableExists("full_final_calculation");
  const haveExit = await tableExists("exit_request");

  const engine = await runCheck({ code: "FF_CALCULATION_ENGINE", layer: "FULL_AND_FINAL", severity: "P1" }, async () => {
    if (!haveFf) {
      return sourceMissing("full_final_calculation does not exist. F&F CALCULATION ENGINE NOT IMPLEMENTED.");
    }
    return sourceMissing(
      "F&F CALCULATION ENGINE NOT IMPLEMENTED. full_final_calculation stores a settlement, but every monetary field " +
        "(notice recovery, leave encashment, gratuity, salary hold, advances recovery and net_payable) is supplied by " +
        "the caller — nothing derives them from attendance through the last working day, leave balance, the recovery " +
        "ledger, unpaid salary or arrears, and net_payable is never checked against its own components. Readiness for " +
        "the F&F population cannot be asserted until a calculation exists to be ready.",
      { table_present: true, derives_components: false, validates_net_payable: false },
    );
  });

  const checks = await Promise.all([
    // Someone who has exited but is still being paid ordinary monthly payroll.
    runCheck({ code: "FF_EXITED_EMPLOYEE_IN_ORDINARY_PAYROLL", layer: "FULL_AND_FINAL", severity: "P0" }, async () => {
      const sql = `
        SELECT ${EMP_IDENTITY},
               DATE_FORMAT(COALESCE(e.date_of_exit, e.date_of_leaving, e.resignation_date), '%Y-%m-%d') AS exit_date,
               ROUND(spl.gross_salary, 2) AS gross_salary,
               ROUND(spl.net_salary, 2) AS net_salary,
               spl.status AS line_status
          FROM salary_prep_line spl
          JOIN employees e ON e.id = spl.employee_id
         WHERE spl.run_id = ?
           AND spl.net_salary > 0
           AND COALESCE(e.date_of_exit, e.date_of_leaving, e.resignation_date) < ?
           AND LOWER(COALESCE(spl.status, '')) NOT IN ('excluded', 'blocked')`;
      const { count, sample } = await population(sql, [runId, monthStart]);
      return count === 0
        ? pass("No employee who exited before this payroll month carries positive net pay in the run.")
        : fail(
            count,
            `${count} employees whose last working day precedes ${monthStart} carry positive net pay in this run. ` +
              "Ordinary payroll is paying people who should be settled through F&F.",
            { month_start: monthStart },
            sample,
          );
    }),

    // Exits during/before this month with no settlement record at all.
    runCheck({ code: "FF_MISSING_FOR_EXITED_EMPLOYEE", layer: "FULL_AND_FINAL", severity: "P1" }, async () => {
      if (!haveExit || !haveFf) return sourceMissing("exit_request or full_final_calculation is absent.");
      const sql = `
        SELECT ${EMP_IDENTITY}, x.status AS exit_status,
               DATE_FORMAT(COALESCE(x.last_working_day_confirmed, x.last_working_day_proposed), '%Y-%m-%d') AS last_working_day
          FROM exit_request x
          JOIN employees e ON e.id = x.employee_id
         WHERE COALESCE(x.last_working_day_confirmed, x.last_working_day_proposed) <= ?
           AND NOT EXISTS (SELECT 1 FROM full_final_calculation f WHERE f.exit_request_id = x.id)`;
      const { count, sample } = await population(sql, [monthEnd]);
      return count === 0
        ? pass("Every exit with a last working day on or before this month has a settlement record.")
        : fail(count, `${count} exits with a last working day on or before ${monthEnd} have no full_final_calculation record at all.`, undefined, sample);
    }),

    // A settlement whose net does not equal its own components.
    runCheck({ code: "FF_NET_PAYABLE_NOT_RECONCILED", layer: "FULL_AND_FINAL", severity: "P0" }, async () => {
      if (!haveFf) return sourceMissing("full_final_calculation does not exist.");
      const sql = `
        SELECT ${EMP_IDENTITY}, f.status,
               ROUND(f.earned_leave_encashment, 2) AS leave_encashment,
               ROUND(f.gratuity_amount, 2) AS gratuity,
               ROUND(f.salary_hold, 2) AS salary_hold,
               ROUND(f.notice_recovery, 2) AS notice_recovery,
               ROUND(f.advances_recovery, 2) AS advances_recovery,
               ROUND(f.net_payable, 2) AS net_payable,
               ROUND(f.earned_leave_encashment + f.gratuity_amount + f.salary_hold
                     - f.notice_recovery - f.advances_recovery, 2) AS component_sum
          FROM full_final_calculation f
          JOIN employees e ON e.id = f.employee_id
         WHERE ABS(f.net_payable
                   - (f.earned_leave_encashment + f.gratuity_amount + f.salary_hold
                      - f.notice_recovery - f.advances_recovery)) > 0.01`;
      const { count, sample } = await population(sql, []);
      return count === 0
        ? pass("Every settlement's net payable equals the sum of its recorded components.")
        : fail(
            count,
            `${count} settlements have a net_payable that does not equal their own components ` +
              "(encashment + gratuity + salary hold − notice recovery − advances recovery). " +
              "Nothing in the codebase enforces this, so the stored net is an unvalidated hand-keyed figure.",
            undefined,
            sample,
          );
    }),

    // Provisional settlement awaiting the statutory verification override.
    runCheck({ code: "FF_PENDING_APPROVAL", layer: "FULL_AND_FINAL", severity: "P1" }, async () => {
      if (!haveFf) return sourceMissing("full_final_calculation does not exist.");
      const sql = `
        SELECT ${EMP_IDENTITY}, f.status, f.is_ff_provisional,
               ROUND(f.net_payable, 2) AS net_payable,
               DATE_FORMAT(f.calculation_date, '%Y-%m-%d') AS calculation_date
          FROM full_final_calculation f
          JOIN employees e ON e.id = f.employee_id
         WHERE f.calculation_date <= ?
           AND (f.status IN ('draft', 'verified') OR f.is_ff_provisional = 1)`;
      const { count, sample } = await population(sql, [monthEnd]);
      return count === 0
        ? pass("No settlement dated on or before this month is still provisional or unapproved.")
        : fail(count, `${count} settlements dated on or before ${monthEnd} are still draft/provisional and cannot be approved until statutory values are verified.`, undefined, sample);
    }),

    // Unresolved recovery at settlement time.
    runCheck({ code: "FF_UNRESOLVED_RECOVERY", layer: "FULL_AND_FINAL", severity: "P0" }, async () => {
      if (!haveFf || !(await tableExists("employee_loans"))) {
        return sourceMissing("full_final_calculation or employee_loans is absent, so settlement-time recovery cannot be reconciled.");
      }
      const sql = `
        SELECT ${EMP_IDENTITY}, f.status,
               ROUND(f.advances_recovery, 2) AS recovered_in_ff,
               ROUND(SUM(l.pending_amount), 2) AS outstanding_at_settlement
          FROM full_final_calculation f
          JOIN employees e ON e.id = f.employee_id
          JOIN employee_loans l ON l.employee_id = e.id AND l.status = 'active' AND l.pending_amount > 0
         WHERE f.status IN ('approved', 'paid')
         GROUP BY e.id, e.employee_code, employee_name, f.status, f.advances_recovery
        HAVING SUM(l.pending_amount) > f.advances_recovery + 0.01`;
      const { count, sample } = await population(sql, []);
      return count === 0
        ? pass("No approved or paid settlement leaves an outstanding recovery behind.")
        : fail(count, `${count} approved/paid settlements leave an outstanding loan balance larger than the advances recovered in the settlement.`, undefined, sample);
    }),

    // Settled and then reactivated — a conflicting state.
    runCheck({ code: "FF_PAID_BUT_EMPLOYEE_ACTIVE", layer: "FULL_AND_FINAL", severity: "P0" }, async () => {
      if (!haveFf) return sourceMissing("full_final_calculation does not exist.");
      const sql = `
        SELECT ${EMP_IDENTITY}, f.status, ROUND(f.net_payable, 2) AS net_payable, e.active_status, e.employment_status
          FROM full_final_calculation f
          JOIN employees e ON e.id = f.employee_id
         WHERE f.status = 'paid'
           AND e.active_status = 1
           AND LOWER(COALESCE(e.employment_status, 'active')) = 'active'`;
      const { count, sample } = await population(sql, []);
      if (count > 0) {
        return fail(count, `${count} employees are active with a settlement already marked paid — a conflicting state that risks a second settlement or duplicate salary.`, undefined, sample);
      }
      // Zero rows here does NOT mean the control is satisfied — it may mean the control
      // cannot run at all. full_final_calculation.status is enum('draft','verified',
      // 'approved','paid'), but no code path in this repo ever writes 'paid' or 'verified':
      // ff.service.ts's only status write is `SET status = 'approved'` (line ~330). So this
      // P0 check queries a state the application cannot produce, finds nothing, and reports
      // a clean pass — a structurally guaranteed green that says nothing about reality.
      // Verified live 2026-08-15: full_final_calculation holds 1 row, status 'draft'; zero
      // rows have ever been 'paid'.
      //
      // Distinguish the two cases rather than passing blindly. If a settlement has genuinely
      // reached 'paid', a zero count is a real pass. If none ever has, say so — an honest
      // "cannot evaluate" beats a false green, and it surfaces the actual gap: the paid
      // transition is missing, so nothing records that a settlement was ever disbursed.
      // (Restoring that transition is a money-path workflow decision — who may mark paid and
      // on what evidence — not something to infer here.)
      const [paidRows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS paid_ever FROM full_final_calculation WHERE status = 'paid'`,
      );
      const paidEver = Number((paidRows[0] as Record<string, unknown>)?.paid_ever ?? 0);
      return paidEver === 0
        ? sourceMissing(
            "No settlement has ever reached status 'paid' — nothing in the application writes that state, so this check cannot detect the condition it exists for. It is not passing; it is unevaluable until the F&F paid transition exists.",
          )
        : pass("No employee is active again after their settlement was paid.");
    }),

    // Attendance through the last working day.
    runCheck({ code: "FF_ATTENDANCE_INCOMPLETE_TO_LWD", layer: "FULL_AND_FINAL", severity: "P1" }, async () => {
      if (!haveExit || !(await tableExists("attendance_daily_record"))) {
        return sourceMissing("exit_request or attendance_daily_record is absent.");
      }
      const sql = `
        SELECT ${EMP_IDENTITY},
               DATE_FORMAT(COALESCE(x.last_working_day_confirmed, x.last_working_day_proposed), '%Y-%m-%d') AS last_working_day
          FROM exit_request x
          JOIN employees e ON e.id = x.employee_id
         WHERE COALESCE(x.last_working_day_confirmed, x.last_working_day_proposed) BETWEEN ? AND ?
           AND NOT EXISTS (
             SELECT 1 FROM attendance_daily_record adr
              WHERE adr.employee_id = e.id
                AND adr.record_date = COALESCE(x.last_working_day_confirmed, x.last_working_day_proposed))`;
      const { count, sample } = await population(sql, [monthStart, monthEnd]);
      return count === 0
        ? pass("Every exit in this month has attendance recorded on its last working day.")
        : fail(count, `${count} employees exiting in ${monthStart}…${monthEnd} have no attendance record on their last working day, so payable days through LWD cannot be established.`, undefined, sample);
    }),
  ]);

  return [engine, ...checks];
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. PAYMENT-FILE READINESS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * "Payroll calculated" is not "payroll can safely be paid". This category answers only the
 * second question.
 *
 * The payment mechanism, verified against the live schema:
 *   payroll_disbursement    — run-level batch header (total_amount, employee_count, status,
 *                             bank_ref). 12 rows. This is the payment batch of record.
 *   salary_run_disbursal    — per-employee payment instruction, UNIQUE(run_id, employee_id),
 *                             which is a real structural duplicate-payment guard. 0 rows.
 *   salary_prep_line.bank_transfer_initiated / _at — the per-line already-paid marker.
 *
 * PAYFILE_HISTORY — there is no generated-file history table anywhere: nothing records a file
 * name, hash, generation timestamp or generating user, so a regenerated export cannot be shown
 * to be identical to the one already sent to the bank. That is reported as SOURCE_MISSING.
 *
 * BOUNDARY WITH bank-payment-readiness.service.ts
 *   A parallel module classifies individual employees into READY / MISSING / INVALID /
 *   CONFLICT / PENDING_APPROVAL / BLOCKED using db_bill credit confirmation. This module does
 *   NOT duplicate that per-employee classification. It checks only the run-level payment-file
 *   properties — calculation completeness, lock/approval state, payable amounts, count and
 *   total reconciliation, duplicate instructions and already-paid markers — and defers bank
 *   verification depth to that module. Two independent bank verdicts would be worse than one.
 */
async function paymentFileChecks(scope: RunScope): Promise<CategoryCheckResult[]> {
  const { runId, status } = scope;
  const haveDisbursement = await tableExists("payroll_disbursement");
  const haveInstruction = await tableExists("salary_run_disbursal");

  const runIsCalculated = ["calculated", "approved", "locked", "finalized", "processing", "disbursed"].includes(
    status.toLowerCase(),
  );

  return Promise.all([
    // Nothing may be paid before the calculation is complete for every line.
    //
    // CORRECTED 2026-08-13. This first read salary_prep_line.calculation_status against an
    // allowlist of ('calculated','complete','completed'). Two things were wrong with that:
    // NOTHING in backend/src writes calculation_status — the only reference to it in the whole
    // codebase was this check — so it is an unmaintained column carrying values left by
    // out-of-band scripts ('system_calculated', 'db_bill_sync', 'v2'), none of which were in the
    // allowlist. The check therefore flagged 100% of every run's lines, including the 1,414 July
    // lines the engine had calculated perfectly well. An always-red check is not a gate; it is
    // noise that trains people to ignore the page.
    //
    // `status` is the column the engine actually maintains — calculatePayrollRun's INSERT ends
    // `status = 'calculated'` — so it is what this now reads, together with needs_recalculation.
    runCheck({ code: "PAYFILE_CALCULATION_INCOMPLETE", layer: "PAYROLL_CALCULATION", severity: "P0" }, async () => {
      const sql = `
        SELECT ${EMP_IDENTITY}, spl.status AS line_status, spl.needs_recalculation
          FROM salary_prep_line spl
          JOIN employees e ON e.id = spl.employee_id
         WHERE spl.run_id = ?
           AND (LOWER(COALESCE(spl.status, '')) NOT IN ('calculated', 'approved', 'excluded', 'blocked')
                OR COALESCE(spl.needs_recalculation, 0) = 1)`;
      const { count, sample } = await population(sql, [runId]);
      return count === 0
        ? pass("Every line in the run is in a calculated or approved state and none is flagged for recalculation.")
        : fail(count, `${count} payroll lines are not in a calculated/approved state or are flagged as needing recalculation. A payment file built now would pay stale figures.`, undefined, sample);
    }),

    // Gross with no payable-days basis.
    //
    // This is the check the one above was failing to be. A line carrying money whose
    // final_payable_days is zero was not produced by the payroll engine — the engine derives
    // gross FROM payable days, so the two cannot disagree in that direction. It means the figure
    // arrived by some other route (a db_bill mirror, a seed, a manual load) and nothing about it
    // can be recomputed, explained to the employee, or defended in an audit.
    //
    // Measured live 2026-08-13, which is also why this is a separate check rather than folded in
    // above: July 1 line, June 1,215, May 1,148. It discriminates, where the old check did not.
    runCheck({ code: "PAYFILE_GROSS_WITHOUT_PAYABLE_DAYS_BASIS", layer: "PAYROLL_CALCULATION", severity: "P0" }, async () => {
      const sql = `
        SELECT ${EMP_IDENTITY}, ROUND(spl.gross_salary, 2) AS gross_salary,
               ROUND(spl.net_salary, 2) AS net_salary,
               spl.final_payable_days, spl.paid_working_days, spl.status AS line_status
          FROM salary_prep_line spl
          JOIN employees e ON e.id = spl.employee_id
         WHERE spl.run_id = ?
           AND spl.gross_salary > 0
           AND COALESCE(spl.final_payable_days, 0) = 0`;
      const { count, sample } = await population(sql, [runId]);
      return count === 0
        ? pass("Every line carrying gross pay has a payable-days basis behind it.")
        : fail(
            count,
            `${count} payroll lines carry gross pay while final_payable_days is 0. The payroll engine derives gross from payable days, so these figures did not come from it — they cannot be recomputed, explained on a payslip, or defended in an audit. Do not resolve this by recalculating the run; establish where the figures came from first.`,
            undefined,
            sample,
          );
    }),

    // Approval / lock state.
    runCheck({ code: "PAYFILE_RUN_NOT_APPROVED_OR_LOCKED", layer: "APPROVAL_LOCK", severity: "P0" }, async () => {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT status, approved_by, finance_approved_by, finance_approved_at,
                validation_status, validated_by, attendance_snapshot_locked
           FROM salary_prep_run WHERE id = ? LIMIT 1`,
        [runId],
      );
      const run = rows[0] as Record<string, unknown> | undefined;
      if (!run) return blocked("Run disappeared while the check was running.");
      const approved = Boolean(run.approved_by) || Boolean(run.finance_approved_by);
      const locked = Number(run.attendance_snapshot_locked ?? 0) === 1;
      if (approved && locked) {
        return pass("Run carries an approver and a locked attendance snapshot.");
      }
      return fail(
        0,
        "Run is not approved and locked for payment: " +
          `approver=${approved ? "present" : "absent"}, attendance_snapshot_locked=${locked ? "1" : "0"}, status='${String(run.status ?? "")}'. ` +
          "A payment file must not be generated from an unapproved, unlocked run.",
        {
          status: run.status,
          approved_by_present: Boolean(run.approved_by),
          finance_approved_by_present: Boolean(run.finance_approved_by),
          attendance_snapshot_locked: locked,
          validation_status: run.validation_status,
        },
      );
    }),

    // No maker-checker separation exists across create/approve/finance-approve/
    // CEO-acknowledge/validate — role sets overlap (finance and super_admin can
    // do all of them; live-checked 2026-08-14: user_roles has only 1
    // payroll_head and 2 finance total, and the one payroll_head also holds
    // finance_head), so a hard "must be a different person" block would lock
    // out real, currently-working approval capability for the smallest of
    // those role pools rather than close a gap anyone has hit. All 12 runs
    // currently carrying status='approved' are pre-HRMS2 imports with a
    // synthetic created_by and a NULL approved_by, not genuine self-approval —
    // so there is no live incident to protect against retroactively, only a
    // structural gap to make visible before one occurs. This check does that:
    // it flags, at P1, the same actor appearing on both sides of any one
    // approval relationship for a run, without blocking anything. Whether to
    // additionally hard-block is a business/RBAC-policy decision — given the
    // 1-person payroll_head pool, forcing it today would make certain runs
    // structurally impossible to validate at all until a second person is
    // granted the role, which is not this audit's call to make unilaterally.
    runCheck({ code: "APPROVAL_MAKER_CHECKER_GAP", layer: "APPROVAL_LOCK", severity: "P1" }, async () => {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT created_by, approved_by, finance_approved_by, ceo_acknowledged_by, validated_by
           FROM salary_prep_run WHERE id = ? LIMIT 1`,
        [runId],
      );
      const run = rows[0] as Record<string, unknown> | undefined;
      if (!run) return blocked("Run disappeared while the check was running.");
      const creator = run.created_by ? String(run.created_by) : null;
      const sameActorOn: string[] = [];
      if (creator) {
        if (run.approved_by && String(run.approved_by) === creator) sameActorOn.push("status-approved");
        if (run.finance_approved_by && String(run.finance_approved_by) === creator) sameActorOn.push("finance-approved");
        if (run.ceo_acknowledged_by && String(run.ceo_acknowledged_by) === creator) sameActorOn.push("CEO-acknowledged");
        if (run.validated_by && String(run.validated_by) === creator) sameActorOn.push("Head-Payroll-validated");
      }
      return sameActorOn.length === 0
        ? pass("No approval-side action on this run was taken by the same user who created it.")
        : fail(
            0,
            `The user who created this run also ${sameActorOn.join(", ")} it — no maker-checker separation exists in the ` +
              "approval workflow to prevent this (finance/super_admin roles can create, calculate and approve the same " +
              "run). Not evidence the figures are wrong; a control gap, not a defect finding.",
            { sameActorOn },
          );
    }),

    // Employees expected to be paid but with no payable amount.
    runCheck({ code: "PAYFILE_NO_PAYABLE_AMOUNT", layer: "PAYMENT_FILE", severity: "P1" }, async () => {
      const sql = `
        SELECT ${EMP_IDENTITY}, ROUND(spl.gross_salary, 2) AS gross_salary, ROUND(spl.net_salary, 2) AS net_salary,
               spl.final_payable_days
          FROM salary_prep_line spl
          JOIN employees e ON e.id = spl.employee_id
         WHERE spl.run_id = ?
           AND spl.net_salary <= 0
           AND spl.final_payable_days > 0
           AND LOWER(COALESCE(spl.status, '')) NOT IN ('excluded', 'blocked')`;
      const { count, sample } = await population(sql, [runId]);
      return count === 0
        ? pass("Every employee with payable days has a positive net amount.")
        : fail(count, `${count} employees have payable days in this run but a net amount of zero or below, so they would be silently left out of the payment file.`, undefined, sample);
    }),

    // Negative net pay can never be sent to a bank.
    runCheck({ code: "PAYFILE_NEGATIVE_NET", layer: "PAYMENT_FILE", severity: "P0" }, async () => {
      const sql = `
        SELECT ${EMP_IDENTITY}, ROUND(spl.net_salary, 2) AS net_salary, ROUND(spl.total_deductions, 2) AS total_deductions
          FROM salary_prep_line spl
          JOIN employees e ON e.id = spl.employee_id
         WHERE spl.run_id = ? AND spl.net_salary < 0`;
      const { count, sample } = await population(sql, [runId]);
      return count === 0
        ? pass("No line has a negative net amount.")
        : fail(count, `${count} payroll lines have a negative net amount, which cannot be represented in a bank payment file.`, undefined, sample);
    }),

    // Bank account presence and IFSC validity for anyone who would be paid.
    // Depth of bank verification belongs to bank-payment-readiness.service.ts; this is the
    // minimum a payment file cannot be built without.
    runCheck({ code: "PAYFILE_BANK_DETAIL_UNUSABLE", layer: "BANK", severity: "P0" }, async () => {
      if (!(await tableExists("employee_bank_detail"))) {
        return sourceMissing("employee_bank_detail does not exist; no payment file can be built.");
      }
      const sql = `
        SELECT ${EMP_IDENTITY}, ROUND(spl.net_salary, 2) AS net_salary,
               CASE
                 WHEN b.employee_id IS NULL THEN 'no_primary_active_bank_record'
                 WHEN COALESCE(NULLIF(TRIM(b.account_number), ''), NULLIF(TRIM(b.account_number_enc), '')) IS NULL
                      THEN 'account_number_blank'
                 WHEN NULLIF(TRIM(b.ifsc_code), '') IS NULL THEN 'ifsc_blank'
                 ELSE 'ifsc_invalid_format'
               END AS reason
          FROM salary_prep_line spl
          JOIN employees e ON e.id = spl.employee_id
          LEFT JOIN employee_bank_detail b
                 ON b.employee_id = e.id AND b.active_status = 1 AND b.is_primary = 1
         WHERE spl.run_id = ?
           AND spl.net_salary > 0
           AND (b.employee_id IS NULL
                OR COALESCE(NULLIF(TRIM(b.account_number), ''), NULLIF(TRIM(b.account_number_enc), '')) IS NULL
                OR NULLIF(TRIM(b.ifsc_code), '') IS NULL
                OR b.ifsc_code NOT REGEXP '^[A-Z]{4}0[A-Z0-9]{6}$')`;
      const { count, sample } = await population(sql, [runId]);
      return count === 0
        ? pass("Every payable employee has a usable primary bank account and a valid IFSC.")
        : fail(
            count,
            `${count} employees with a positive net amount cannot be paid: no primary active bank record, a blank account number, or an IFSC that fails the RBI format. ` +
              "Account numbers are deliberately not returned by this check.",
            undefined,
            sample,
          );
    }),

    // More than one active primary account = ambiguous beneficiary.
    runCheck({ code: "PAYFILE_AMBIGUOUS_BENEFICIARY", layer: "BANK", severity: "P0" }, async () => {
      if (!(await tableExists("employee_bank_detail"))) return sourceMissing("employee_bank_detail does not exist.");
      const sql = `
        SELECT ${EMP_IDENTITY}, COUNT(*) AS primary_account_rows
          FROM salary_prep_line spl
          JOIN employees e ON e.id = spl.employee_id
          JOIN employee_bank_detail b ON b.employee_id = e.id AND b.active_status = 1 AND b.is_primary = 1
         WHERE spl.run_id = ? AND spl.net_salary > 0
         GROUP BY e.id, e.employee_code, employee_name
        HAVING COUNT(*) > 1`;
      const { count, sample } = await population(sql, [runId]);
      return count === 0
        ? pass("No payable employee has more than one active primary bank account.")
        : fail(count, `${count} payable employees have more than one active primary bank account, so the payment file cannot determine a single beneficiary.`, undefined, sample);
    }),

    // Duplicate payment instruction.
    runCheck({ code: "PAYFILE_DUPLICATE_INSTRUCTION", layer: "PAYMENT_FILE", severity: "P0" }, async () => {
      if (!haveInstruction) {
        return sourceMissing(
          "salary_run_disbursal does not exist, so per-employee payment instructions cannot be checked for duplication.",
        );
      }
      const sql = `
        SELECT d.employee_code, COUNT(*) AS instruction_count
          FROM salary_run_disbursal d
         WHERE d.run_id = ?
         GROUP BY d.employee_code
        HAVING COUNT(*) > 1`;
      const { count, sample } = await population(sql, [runId]);
      return count === 0
        ? pass("No employee has more than one payment instruction for this run.")
        : fail(count, `${count} employees have more than one payment instruction recorded against this run.`, undefined, sample);
    }),

    // Already marked paid for this same run.
    runCheck({ code: "PAYFILE_ALREADY_PAID", layer: "PAYMENT_FILE", severity: "P0" }, async () => {
      const sql = `
        SELECT ${EMP_IDENTITY}, ROUND(spl.net_salary, 2) AS net_salary,
               DATE_FORMAT(spl.bank_transfer_initiated_at, '%Y-%m-%d %H:%i') AS transfer_initiated_at
          FROM salary_prep_line spl
          JOIN employees e ON e.id = spl.employee_id
         WHERE spl.run_id = ? AND COALESCE(spl.bank_transfer_initiated, 0) = 1`;
      const { count, sample } = await population(sql, [runId]);
      return count === 0
        ? pass("No line in this run is already marked as bank-transfer-initiated.")
        : fail(
            count,
            `${count} lines in this run are already marked bank-transfer-initiated. Regenerating a payment file that includes them risks paying the same salary twice.`,
            undefined,
            sample,
          );
    }),

    // Batch total and count must reconcile to eligible payroll.
    runCheck({ code: "PAYFILE_BATCH_TOTAL_MISMATCH", layer: "RECONCILIATION", severity: "P0" }, async () => {
      if (!haveDisbursement) {
        return sourceMissing("payroll_disbursement does not exist, so no payment batch total can be reconciled to payroll.");
      }
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT pd.id, pd.status, pd.employee_count, pd.total_amount,
                (SELECT COUNT(*) FROM salary_prep_line l
                  WHERE l.run_id = pd.run_id AND l.net_salary > 0
                    AND LOWER(COALESCE(l.status,'')) NOT IN ('excluded','blocked')) AS payable_employees,
                (SELECT ROUND(COALESCE(SUM(l.net_salary), 0), 2) FROM salary_prep_line l
                  WHERE l.run_id = pd.run_id AND l.net_salary > 0
                    AND LOWER(COALESCE(l.status,'')) NOT IN ('excluded','blocked')) AS payable_net_total
           FROM payroll_disbursement pd
          WHERE pd.run_id = ?`,
        [runId],
      );
      const batches = rows as Array<Record<string, unknown>>;
      if (batches.length === 0) {
        return runIsCalculated
          ? blocked("No payment batch exists for this run yet, so the payment file cannot be reconciled to payroll. Not a defect — it means the file has not been produced.")
          : blocked(`Run status is '${status}'; no payment batch is expected yet.`);
      }
      const mismatched = batches.filter(
        (b) =>
          Number(b.employee_count) !== Number(b.payable_employees) ||
          Math.abs(Number(b.total_amount) - Number(b.payable_net_total)) > 0.01,
      );
      return mismatched.length === 0
        ? pass("Every payment batch reconciles to the eligible payroll net total and employee count.", {
            batches: batches.length,
          })
        : fail(
            mismatched.length,
            `${mismatched.length} payment batches do not reconcile to payroll: the batch employee count or total amount differs from the eligible payable population.`,
            { batches: batches.length },
            mismatched,
          );
    }),

    // Payment-file history, and whether a regeneration changed the file.
    //
    // Upgraded 2026-08-14 from a permanent SOURCE_MISSING. The history now exists:
    // payroll_register_export_log carries file_name, content_sha256, total_amount and the
    // excluded count/amount for every bank export, written by /neft-export before the file is
    // handed over (migration 1215).
    //
    // The condition worth failing on is NOT "the file was generated twice" — regenerating is
    // legitimate and common. It is "the file was generated twice AND the content changed", which
    // means whoever holds the earlier copy is holding a different set of payment instructions
    // from whoever holds the later one. That is the duplicate-payment hazard, and distinct
    // hashes for one run are exactly its fingerprint.
    runCheck({ code: "PAYFILE_GENERATION_NOT_REPRODUCIBLE", layer: "PAYMENT_FILE", severity: "P1" }, async () => {
      if (!(await tableExists("payroll_register_export_log"))) {
        return sourceMissing(
          "payroll_register_export_log does not exist, so no bank export can be recorded and a regenerated file " +
            "cannot be proven identical to the one already submitted.",
        );
      }
      if (!(await columnExists("payroll_register_export_log", "content_sha256"))) {
        return sourceMissing(
          "payroll_register_export_log exists but has no content_sha256 column (migration 1215 not applied), so a " +
            "recorded export cannot be compared byte-for-byte against a regeneration.",
          { migration: "1215_payment_file_reproducibility.sql" },
        );
      }

      const sql = `
        SELECT run_id,
               COUNT(*)                          AS generations,
               COUNT(DISTINCT content_sha256)    AS distinct_versions,
               MAX(file_name)                    AS latest_file_name
          FROM payroll_register_export_log
         WHERE run_id = ? AND register_type = 'bank_register' AND content_sha256 IS NOT NULL
         GROUP BY run_id
        HAVING COUNT(DISTINCT content_sha256) > 1`;
      const { count, sample } = await population(sql, [runId]);
      if (count > 0) {
        return fail(
          0,
          "This run's bank payment file has been generated more than once with DIFFERENT contents. Whoever holds an " +
            "earlier copy is holding different payment instructions from whoever holds the latest. Establish which " +
            "version was submitted to the bank before generating or submitting another.",
          undefined,
          sample,
        );
      }

      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM payroll_register_export_log
          WHERE run_id = ? AND register_type = 'bank_register' AND content_sha256 IS NOT NULL`,
        [runId],
      );
      const generations = readCount(rows[0] as Record<string, unknown>);
      return generations === 0
        ? notApplicable(
            "No bank payment file has been generated for this run yet, so there is nothing to reproduce. " +
              "The history exists and will record the first one.",
          )
        : pass(
            `The bank payment file has been generated ${generations} time(s) and every version hashes identically, so it is reproducible.`,
            { generations },
          );
    }),

    // PAYSLIP_COMPONENT_TOTAL_MISMATCH — root-caused 2026-08-13, fixed 2026-08-14
    // in payrollCalculate.service.ts's buildPayslipEarningComponents(). Two
    // now-fixed defects left the itemized salary_prep_line_component
    // breakdown disagreeing with the authoritative gross_salary by real
    // rupees, not paise, on 848 of 1,595 lines in the July 2026 run alone:
    // leftover structure-template components (Portfolio, Bonus) surviving
    // into an employee-assignment-priced line, and a stale stored
    // special_allowance used instead of the actual computed residual. The
    // fix is forward-looking only — this check is what surfaces the same
    // defect in ANY line calculated before the fix, or by any future
    // component-generation change that reintroduces it. Deliberately a
    // SUPERSET of INCENTIVE_NOT_TRACEABLE_TO_COMPONENT above: any positive
    // gross a line's own earning components cannot reconstruct is a
    // traceability failure regardless of which component type is missing.
    //
    // Requires at least one earning component row to exist — a line with
    // ZERO component rows despite positive gross is a different, unrelated
    // and lower-severity condition (PAYSLIP_COMPONENTS_NOT_GENERATED,
    // below): salary_prep_line's own basic/hra/special_allowance columns
    // already reconcile to gross for that population (confirmed live,
    // 2026-08-14 — 11 such lines in the July run, all new joiners on a
    // pct_of_ctc structure whose component-insert step never fired), so it
    // is not proof of incorrect money, only of a missing itemization.
    runCheck({ code: "PAYSLIP_COMPONENT_TOTAL_MISMATCH", layer: "PAYROLL_CALCULATION", severity: "P1" }, async () => {
      if (!(await tableExists("salary_prep_line_component"))) {
        return sourceMissing("salary_prep_line_component does not exist, so payslip component totals cannot be reconciled to gross.");
      }
      const sql = `
        SELECT ${EMP_IDENTITY}, ROUND(spl.gross_salary, 2) AS gross_salary,
               ROUND(comp.earning_sum, 2) AS component_sum,
               ROUND(spl.gross_salary - comp.earning_sum, 2) AS variance
          FROM salary_prep_line spl
          JOIN employees e ON e.id = spl.employee_id
          JOIN (
            SELECT line_id, SUM(amount) AS earning_sum
              FROM salary_prep_line_component
             WHERE component_type = 'earning'
             GROUP BY line_id
          ) comp ON comp.line_id = spl.id
         WHERE spl.run_id = ?
           AND spl.gross_salary > 0
           AND ABS(spl.gross_salary - comp.earning_sum) > 1.00`;
      const { count, sample } = await population(sql, [runId]);
      return count === 0
        ? pass("Every positive-gross line's earning components reconcile to gross_salary within tolerance.")
        : fail(
            count,
            `${count} positive-gross lines have an earning-component breakdown that does not sum to gross_salary (off by more than ₹1). A payslip built from these components would misstate the employee's own earnings breakdown even though gross/net themselves may be correct — see this line's component rows for the specific over/under-counted item.`,
            undefined,
            sample,
          );
    }),

    // See PAYSLIP_COMPONENT_TOTAL_MISMATCH immediately above for why this is
    // reported separately rather than folded into it.
    runCheck({ code: "PAYSLIP_COMPONENTS_NOT_GENERATED", layer: "PAYROLL_CALCULATION", severity: "P2" }, async () => {
      if (!(await tableExists("salary_prep_line_component"))) {
        return sourceMissing("salary_prep_line_component does not exist.");
      }
      const sql = `
        SELECT ${EMP_IDENTITY}, ROUND(spl.gross_salary, 2) AS gross_salary,
               ROUND(COALESCE(spl.basic,0) + COALESCE(spl.hra,0) + COALESCE(spl.special_allowance,0), 2) AS stored_breakdown_sum
          FROM salary_prep_line spl
          JOIN employees e ON e.id = spl.employee_id
         WHERE spl.run_id = ?
           AND spl.gross_salary > 0
           AND NOT EXISTS (
             SELECT 1 FROM salary_prep_line_component c
              WHERE c.line_id = spl.id AND c.component_type = 'earning'
           )`;
      const { count, sample } = await population(sql, [runId]);
      return count === 0
        ? pass("Every positive-gross line has at least one earning component row.")
        : fail(
            count,
            `${count} positive-gross lines have no earning component rows at all, so a payslip cannot itemize them — ` +
              "not a money defect (salary_prep_line's own basic/hra/special_allowance columns already reconcile to gross for these), " +
              "but the component-insert step did not run for them. Trace why before assuming this is the same root cause as PAYSLIP_COMPONENT_TOTAL_MISMATCH.",
            undefined,
            sample,
          );
    }),

    // Held / excluded employees must be named, not silently dropped.
    runCheck({ code: "PAYFILE_EXCLUDED_NOT_IDENTIFIED", layer: "PAYMENT_FILE", severity: "P2" }, async () => {
      const sql = `
        SELECT ${EMP_IDENTITY}, spl.status AS line_status, ROUND(spl.net_salary, 2) AS net_salary
          FROM salary_prep_line spl
          JOIN employees e ON e.id = spl.employee_id
         WHERE spl.run_id = ?
           AND LOWER(COALESCE(spl.status, '')) IN ('excluded', 'blocked', 'hold', 'on_hold')
           AND COALESCE(NULLIF(TRIM(spl.remarks), ''), '') = ''`;
      const { count, sample } = await population(sql, [runId]);
      return count === 0
        ? pass("Every excluded or held employee carries a recorded reason.")
        : fail(count, `${count} employees are excluded or held from this run with no recorded reason, so their omission from the payment file is unexplained.`, undefined, sample);
    }),
  ]);
}

// ═════════════════════════════════════════════════════════════════════════════
// Aggregation
// ═════════════════════════════════════════════════════════════════════════════

/**
 * UAN, scoped by what payroll actually does rather than by a flag nothing maintains.
 *
 * WHY NOT employee_statutory_info.pf_eligible, WHICH IS THE OBVIOUS SOURCE
 *   Because it does not describe this workforce. Reconciled live 2026-08-13 against the July run:
 *
 *     July-eligible employees ................................. 1,239
 *     PF actually deducted (salary_prep_line.pf_employee > 0) .. 1,111
 *     employee_statutory_info.pf_eligible = 1 ..................    53
 *     PF deducted while the flag says NOT eligible ............. 1,100
 *     flagged eligible but no PF deducted ......................    42
 *     PF deducted and no UAN in any store ......................   656
 *
 *   The flag disagrees with payroll for 1,100 of 1,111 people — 99%. Scoping the UAN requirement
 *   to it returns zero gaps, and a gate that cannot go red is not a gate: it would certify as
 *   clean a workforce where 656 people have PF taken from their pay with no member account to
 *   credit it to.
 *
 * WHY NOT employee_uan EITHER
 *   That table holds ZERO rows, total — which is the whole reason the original governance check
 *   read as "100% missing UAN" for everybody. The real, partial store is employees.uan_number
 *   (464 populated, all valid 12-digit), with employee_statutory_info.uan_number secondary. All
 *   three are accepted as evidence here.
 *
 * ⚠️ payroll-governance.service.ts's MISSING_UAN uses the pf_eligible scope and reports 1.
 *   This reports 656. They measure different populations rather than disagreeing about data.
 *   Which is authoritative is a Payroll ruling and is on the sign-off list; this check exists so
 *   the larger, defensible figure is visible while that ruling is outstanding, instead of the
 *   comfortable one being the only number on the page.
 */
async function statutoryChecks(scope: RunScope): Promise<CategoryCheckResult[]> {
  const { runId, where, params } = scope;

  return Promise.all([
    runCheck({ code: "STATUTORY_UAN_MISSING_FOR_PF_DEDUCTED", layer: "STATUTORY", severity: "P1" }, async () => {
      if (!(await tableExists("employee_statutory_info"))) {
        return sourceMissing("employee_statutory_info is absent, so UAN cannot be resolved from either store.");
      }
      const sql = `
        SELECT ${EMP_IDENTITY}, ROUND(spl.pf_employee, 2) AS pf_deducted
          FROM employees e
          JOIN salary_prep_line spl ON spl.run_id = ? AND spl.employee_id = e.id
         WHERE ${where}
           AND spl.pf_employee > 0
           AND COALESCE(NULLIF(TRIM(e.uan_number), ''), '') = ''
           AND NOT EXISTS (
             SELECT 1 FROM employee_statutory_info si
              WHERE si.employee_id = e.id
                AND COALESCE(NULLIF(TRIM(si.uan_number), ''), '') <> '')
           AND NOT EXISTS (
             SELECT 1 FROM employee_uan eu WHERE eu.employee_id = e.id AND eu.is_active = 1)`;
      const { count, sample } = await population(sql, [runId, ...params]);
      return count === 0
        ? pass("Every employee PF is deducted from has a UAN in at least one of the three stores.")
        : fail(
            count,
            `${count} employees have PF deducted in this run but no UAN in employees.uan_number, ` +
              "employee_statutory_info.uan_number or employee_uan, so their contribution has no member account to be credited to. " +
              "Scoped to PF actually deducted rather than to employee_statutory_info.pf_eligible, which is set on 53 of 1,239 and disagrees with payroll for 99% of them.",
            undefined,
            sample,
          );
    }),

    // The flag itself is the deeper problem. Said once, at P2, rather than repeated.
    runCheck({ code: "STATUTORY_PF_ELIGIBLE_FLAG_UNRELIABLE", layer: "STATUTORY", severity: "P2" }, async () => {
      if (!(await tableExists("employee_statutory_info"))) {
        return notApplicable("employee_statutory_info is absent.");
      }
      const sql = `
        SELECT ${EMP_IDENTITY}, ROUND(spl.pf_employee, 2) AS pf_deducted
          FROM employees e
          JOIN salary_prep_line spl ON spl.run_id = ? AND spl.employee_id = e.id
         WHERE ${where}
           AND spl.pf_employee > 0
           AND COALESCE((SELECT MAX(si.pf_eligible) FROM employee_statutory_info si
                          WHERE si.employee_id = e.id), 0) = 0`;
      const { count, sample } = await population(sql, [runId, ...params]);
      return count === 0
        ? pass("employee_statutory_info.pf_eligible agrees with what payroll deducts.")
        : fail(
            count,
            `${count} employees have PF deducted while employee_statutory_info.pf_eligible says they are not PF-eligible. ` +
              "Any statutory check scoped to that flag silently excludes them, so it must not be used as an eligibility source until it is reconciled against payroll.",
            undefined,
            sample,
          );
    }),
  ]);
}

function summariseLayers(checks: CategoryCheckResult[]): LayerSummary[] {
  const present = READINESS_LAYERS.filter((layer) => checks.some((c) => c.layer === layer));
  return present.map((layer) => {
    const inLayer = checks.filter((c) => c.layer === layer);
    const notGreen = inLayer.filter((c) => !isGreen(c.state));
    // The layer takes the worst state of its checks; "worst" is ordered so a check that could
    // not run outranks one that merely found a defect it could describe.
    const order: ReadinessState[] = ["CHECK_ERROR", "SOURCE_MISSING", "FAIL", "BLOCKED", "PASS", "NOT_APPLICABLE"];
    const state =
      order.find((s) => inLayer.some((c) => c.state === s)) ??
      ("NOT_APPLICABLE" as ReadinessState);
    return {
      layer,
      state,
      checks: inLayer.length,
      failed: notGreen.length,
      p0: notGreen.filter((c) => c.severity === "P0").length,
      p1: notGreen.filter((c) => c.severity === "P1").length,
      affectedEmployees: notGreen.reduce((sum, c) => sum + c.affectedEmployees, 0),
    };
  });
}

/**
 * Evaluates all five categories for a run.
 *
 * Never throws for a check-level problem: a failing check becomes CHECK_ERROR inside the
 * result. It throws only when the run itself cannot be loaded, because there is then nothing
 * to report on.
 */
export async function evaluateReadinessCategories(runId: string): Promise<ReadinessCategoriesResult> {
  const scope = await loadRunScope(runId);

  const groups = await Promise.all([
    incentiveChecks(scope),
    reimbursementChecks(scope),
    recoveryChecks(scope),
    fullFinalChecks(scope),
    paymentFileChecks(scope),
    statutoryChecks(scope),
  ]);
  const checks = groups.flat();

  const notGreen = checks.filter((c) => !isGreen(c.state));

  // canPay is fail-closed: any P0 or P1 that is not green holds it shut, and so does any
  // CHECK_ERROR at any severity — a control that could not run has not been satisfied.
  const blockers = notGreen.filter(
    (c) => c.severity === "P0" || c.severity === "P1" || c.state === "CHECK_ERROR",
  );

  return {
    runId: scope.runId,
    runMonth: scope.runMonth,
    governanceVersion: READINESS_CATEGORIES_VERSION,
    evaluatedAt: new Date().toISOString(),
    checks,
    layers: summariseLayers(checks),
    summary: {
      p0: notGreen.filter((c) => c.severity === "P0").length,
      p1: notGreen.filter((c) => c.severity === "P1").length,
      p2: notGreen.filter((c) => c.severity === "P2").length,
      failed: notGreen.length,
      checkErrors: checks.filter((c) => c.state === "CHECK_ERROR").length,
      sourceMissing: checks.filter((c) => c.state === "SOURCE_MISSING").length,
    },
    canPay: blockers.length === 0,
    canPayBlockedBy: blockers.map((c) => c.code),
  };
}

/** Exposed for tests so each category can be exercised in isolation. */
export const __categoryCheckers = {
  incentiveChecks,
  reimbursementChecks,
  recoveryChecks,
  fullFinalChecks,
  paymentFileChecks,
  summariseLayers,
};
