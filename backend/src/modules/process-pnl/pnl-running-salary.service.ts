import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { computeRunningSalary } from "../payroll/running-salary.service.js";
import { getCostCentrePeriods } from "./cost-centre-history.service.js";

/**
 * Snapshots each employee's running-month salary so the P&L can show a live Operating Profit %
 * part-way through a month.
 *
 * The figure has to be earned-till-date. Full-month gross would book a whole month's cost on the
 * 3rd and make OP% meaningless until month-end, which is the opposite of what watching it during
 * the month is for.
 *
 * computeRunningSalary() is called per employee rather than reimplemented as aggregate SQL. It is
 * not simple — fixed components versus ctc_annual/12, payable days, eligible week-offs, LWP,
 * statutory overrides — and a second copy would drift, leaving this snapshot and the "Running
 * Month" live-estimate widget (running-salary.routes.ts) disagreeing with each other while both
 * looked authoritative. One source of truth for THAT pair, snapshotted, is the trade: the
 * per-employee cost is paid once per refresh instead of on every statement load.
 *
 * This does NOT extend to salary_prep_line.final_payable_days, the actual locked payslip figure —
 * that is produced by a completely separate calculation in payrollCalculate.service.ts that never
 * calls computeRunningSalary(). The two are expected to diverge for an open (not-yet-run) period;
 * pnl-statement.service.ts already prefers salary_prep_line once payroll has actually run for a
 * period, falling back to this snapshot only while it hasn't. Confirmed live 2026-08: they disagree
 * for ~82% of employees, most of it now traced to a since-fixed bug in this file's own dependency
 * (running-salary.service.ts's holiday resolution) plus a smaller, real modeling difference
 * (payroll's leave-reversal step has no equivalent here) that is a business decision, not a bug.
 */

export type PnlPeopleBucket = "agent_salary" | "dsc_people" | "bmc_people";

export interface SnapshotResult {
  periodCode: string;
  asOfDate: string;
  employeesConsidered: number;
  snapshotted: number;
  skipped: number;
  failed: number;
  totalEarned: number;
  byBucket: Record<PnlPeopleBucket, number>;
}

interface EmployeeRow extends RowDataPacket {
  id: string;
  employee_code: string | null;
  branch_id: string | null;
  process_id: string | null;
  cost_centre_id: string | null;
  department_name: string | null;
  designation_name: string | null;
  rule_bucket: string | null;
}

/**
 * Same support test as bpo-pnl.service.ts's isSupportRole, used only where no classification rule
 * matches. Kept deliberately identical so the fallback cannot disagree between the two surfaces.
 */
function isSupportRole(departmentName: string | null, designationName: string | null): boolean {
  const department = (departmentName ?? "").toLowerCase();
  const designation = (designationName ?? "").toLowerCase();
  const supportDepartment = /(quality|training|learning|wfm|workforce|mis|human resource|\bhr\b|admin|information technology|\bit\b|finance|accounts|recruit|facility|security|maintenance|compliance|payroll)/;
  const supportDesignation = /(team leader|\btl\b|assistant manager|\bam\b|manager|supervisor|trainer|quality|auditor|wfm|mis|hr|recruiter|admin|it support|engineer|accounts|finance|facility|security|coach|sme|subject matter)/;
  return supportDepartment.test(department) || supportDesignation.test(designation);
}

/**
 * Which P&L line this person's cost belongs to.
 *
 * A seeded rule wins outright. Otherwise: no process means the person works across branches and is
 * BMC; with a process, a support role is that process's own support (DSC) and everyone else is an
 * agent. This is why WFM is deliberately left unseeded — a WFM person mapped to a process lands in
 * DSC, and one who is not lands in BMC, which is the rule the business actually uses.
 */
export function resolveBucket(row: {
  process_id: string | null;
  department_name: string | null;
  designation_name: string | null;
  rule_bucket: string | null;
}): PnlPeopleBucket {
  if (row.rule_bucket === "agent_salary" || row.rule_bucket === "dsc_people" || row.rule_bucket === "bmc_people") {
    return row.rule_bucket;
  }
  if (!row.process_id) return "bmc_people";
  return isSupportRole(row.department_name, row.designation_name) ? "dsc_people" : "agent_salary";
}

/**
 * Everyone whose cost belongs to this period.
 *
 * Active headcount alone is wrong, and gets more wrong the older the period. April 2026 paid
 * 1,085 people; 317 of them had left by August, so filtering on active_status captured 693 and
 * reported Rs 140.04 lakh of gross against Rs 211.57 lakh actually paid — a third of the cost
 * missing, which lands directly in operating profit as if it were margin. July's snapshot had
 * the same hole: 1,000 rows against 1,464 people paid.
 *
 * A leaver's salary is still that month's cost. So the set is: currently active, OR paid in
 * the period being snapshotted. The first half keeps a new joiner with no payroll line yet
 * visible (they snapshot as zero rather than vanishing); the second recovers the leavers.
 */
async function loadEmployees(
  periodCode: string,
  branchId?: string,
  employeeId?: string,
): Promise<EmployeeRow[]> {
  const params: unknown[] = [];
  let branchClause = "";
  if (branchId) {
    branchClause = "AND e.branch_id = ?";
    params.push(branchId);
  }
  // Single-employee scope. A discard changes one person's attendance, and
  // refreshing their snapshot row costs ~1.4s — refreshing their whole branch
  // would cost minutes for no benefit.
  if (employeeId) {
    branchClause += " AND e.id = ?";
    params.push(employeeId);
  }
  const [rows] = await db.execute<EmployeeRow[]>(
    `SELECT e.id, e.employee_code, e.branch_id, e.process_id, e.cost_centre_id,
            dep.dept_name AS department_name,
            des.designation_name AS designation_name,
            (SELECT r.pnl_bucket
               FROM pnl_cost_classification_rule r
              WHERE r.active_status = 1
                AND r.scope_type = 'department'
                AND UPPER(TRIM(r.scope_key)) = UPPER(TRIM(dep.dept_name))
                AND (r.process_id IS NULL OR r.process_id = e.process_id)
                AND (r.branch_id IS NULL OR r.branch_id = e.branch_id)
              ORDER BY r.priority ASC
              LIMIT 1) AS rule_bucket
       FROM employees e
       LEFT JOIN department_master dep ON dep.id = e.department_id
       LEFT JOIN designation_master des ON des.id = e.designation_id
      WHERE (e.active_status = 1
             OR EXISTS (SELECT 1
                          FROM salary_prep_line spl
                          JOIN salary_prep_run spr ON spr.id = spl.run_id
                         WHERE spl.employee_id = e.id AND spr.run_month = ?))
        ${branchClause}`,
    [periodCode, ...params]
  );
  return rows;
}

/**
 * computeRunningSalary() costs ~1.4s per employee against the production host, so a 362-person
 * branch takes over eight minutes run one at a time — long enough that the first refresh attempt
 * never returned an HTTP response at all. The work is I/O-bound round-trips, not CPU, so running a
 * few employees at once removes almost all of that wall-clock.
 *
 * Six, not more: DB_POOL_MAX is 10, and the refresh must leave connections for the rest of the
 * application. A pool starved by a background snapshot would take the whole backend down with it,
 * which is a far worse failure than a slow refresh.
 */
const REFRESH_CONCURRENCY = 6;

/** Rows per INSERT. The upsert is cheap next to the salary computation; this just avoids 362 round-trips. */
const INSERT_BATCH_SIZE = 50;

interface SnapshotRow {
  employee: EmployeeRow;
  bucket: PnlPeopleBucket;
  earned: number;
  grossMonthly: number;
  earnedDays: number;
  totalDays: number;
}

async function flushRows(rows: SnapshotRow[], periodCode: string, asOfDate: string): Promise<void> {
  if (rows.length === 0) return;
  const placeholders = rows.map(() => "(UUID(),?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())").join(",");
  const params: unknown[] = [];
  for (const row of rows) {
    params.push(
      periodCode,
      row.employee.id,
      row.employee.employee_code ?? null,
      row.employee.branch_id ?? null,
      row.employee.process_id ?? null,
      row.employee.cost_centre_id ?? null,
      row.employee.department_name ?? null,
      row.employee.designation_name ?? null,
      row.bucket,
      row.earned,
      row.grossMonthly,
      row.earnedDays,
      row.totalDays,
      asOfDate
    );
  }
  await db.query(
    `INSERT INTO pnl_running_salary_snapshot
       (id, period_code, employee_id, employee_code, branch_id, process_id, cost_centre_id,
        department_name, designation_name, pnl_bucket, earned_salary_till_date, gross_monthly,
        earned_payable_days, total_payable_days, as_of_date, computed_at)
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE
       employee_code = VALUES(employee_code),
       branch_id = VALUES(branch_id),
       process_id = VALUES(process_id),
       cost_centre_id = VALUES(cost_centre_id),
       department_name = VALUES(department_name),
       designation_name = VALUES(designation_name),
       pnl_bucket = VALUES(pnl_bucket),
       earned_salary_till_date = VALUES(earned_salary_till_date),
       gross_monthly = VALUES(gross_monthly),
       earned_payable_days = VALUES(earned_payable_days),
       total_payable_days = VALUES(total_payable_days),
       as_of_date = VALUES(as_of_date),
       computed_at = NOW()`,
    params
  );
}

/**
 * Recompute the snapshot for a period. Safe to re-run: rows are upserted on
 * (period_code, employee_id), so a refresh replaces rather than accumulates.
 *
 * One employee failing does not abandon the rest — a single bad salary configuration should cost
 * that person's row, not the whole branch's P&L. The count comes back so a caller can see it.
 */
export async function refreshRunningSalarySnapshot(
  periodCode: string,
  options: { branchId?: string; asOfDate?: string; employeeId?: string } = {}
): Promise<SnapshotResult> {
  if (!/^\d{4}-\d{2}$/.test(periodCode)) {
    throw new Error("A valid period (YYYY-MM) is required");
  }
  const runMonth = `${periodCode}-01`;
  // Default to today in IST, matching how running-salary.service.ts resolves month boundaries.
  const asOfDate = options.asOfDate
    ?? new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const employees = await loadEmployees(periodCode, options.branchId, options.employeeId);
  const byBucket: Record<PnlPeopleBucket, number> = {
    agent_salary: 0,
    dsc_people: 0,
    bmc_people: 0,
  };
  let snapshotted = 0;
  let skipped = 0;
  let failed = 0;
  let totalEarned = 0;

  let pending: SnapshotRow[] = [];
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= employees.length) return;
      const employee = employees[index];

      let running: Awaited<ReturnType<typeof computeRunningSalary>>;
      try {
        running = await computeRunningSalary(employee.id, runMonth, asOfDate);
      } catch {
        failed += 1;
        continue;
      }
      const earned = Number(running.earned_salary_till_date ?? 0);
      if (!Number.isFinite(earned) || earned <= 0) {
        skipped += 1;
        continue;
      }
      const bucket = resolveBucket(employee);
      const grossMonthly = Number(running.gross_monthly ?? 0);
      const earnedDays = Number(running.earned_payable_days ?? 0);
      const totalDays = Number(running.projected_payable_days ?? 0);

      // Check for mid-month cost centre transfer
      const monthStart = `${periodCode}-01`;
      // monthEnd: last day of periodCode month
      const [yr, mo] = periodCode.split("-").map(Number);
      const monthEnd = new Date(yr, mo, 0).toISOString().slice(0, 10); // last day of month

      const ccPeriods = await getCostCentrePeriods(employee.id, monthStart, monthEnd);

      if (ccPeriods.length > 1) {
        // Mid-month transfer: apportion earned salary by days
        const totalPeriodDays = ccPeriods.reduce((s, p) => s + p.days, 0);
        for (const period of ccPeriods) {
          const ratio = period.days / totalPeriodDays;
          const apportionedEarned = Math.round(earned * ratio * 100) / 100;
          const apportionedGross = Math.round(grossMonthly * ratio * 100) / 100;
          const apportionedEarnedDays = Math.round(earnedDays * ratio * 100) / 100;
          const apportionedTotalDays = Math.round(totalDays * ratio * 100) / 100;

          // Override employee's cost_centre_id for this snapshot row
          const employeeForPeriod = { ...employee, cost_centre_id: period.costCentreId };
          pending.push({
            employee: employeeForPeriod as typeof employee,
            bucket,
            earned: apportionedEarned,
            grossMonthly: apportionedGross,
            earnedDays: apportionedEarnedDays,
            totalDays: apportionedTotalDays,
          });
          byBucket[bucket] += apportionedEarned;
          totalEarned += apportionedEarned;
          snapshotted += 1;
        }
      } else {
        // No mid-month transfer: single row as before
        pending.push({
          employee,
          bucket,
          earned,
          grossMonthly,
          earnedDays,
          totalDays,
        });
        byBucket[bucket] += earned;
        totalEarned += earned;
        snapshotted += 1;
      }

      if (pending.length >= INSERT_BATCH_SIZE) {
        // Hand the batch off before awaiting, so a concurrent worker cannot append to the array
        // being written and have its row flushed twice.
        const batch = pending;
        pending = [];
        await flushRows(batch, periodCode, asOfDate);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(REFRESH_CONCURRENCY, employees.length) }, () => worker())
  );
  await flushRows(pending, periodCode, asOfDate);

  return {
    periodCode,
    asOfDate,
    employeesConsidered: employees.length,
    snapshotted,
    skipped,
    failed,
    totalEarned: Math.round(totalEarned * 100) / 100,
    byBucket,
  };
}

export interface PeopleCoverage {
  /** Active employees attributed to this branch/process. */
  activeEmployees: number;
  /** How many of them produced a running salary. */
  coveredEmployees: number;
}

export interface PeopleCostByKey {
  byBranch: Map<string, Record<PnlPeopleBucket, number>>;
  byProcess: Map<string, Record<PnlPeopleBucket, number>>;
  /**
   * How much of the headcount the people cost actually accounts for.
   *
   * This is not diagnostics — it is a correctness guard. An employee earns nothing when the month's
   * attendance carries no present days or no salary is assigned, and whole branches are currently in
   * that state (KARNAL and MOHALI have zero present days in July 2026). Such a branch reports no
   * people cost at all, so Operating Profit comes out at very nearly 100% of revenue: a number that
   * looks entirely plausible on a finance screen and is completely wrong.
   *
   * Publishing coverage alongside the money lets the statement mark a column as under-covered rather
   * than present a fabricated profit as fact.
   */
  coverageByBranch: Map<string, PeopleCoverage>;
  coverageByProcess: Map<string, PeopleCoverage>;
  asOfDate: string | null;
}

const emptyBuckets = (): Record<PnlPeopleBucket, number> =>
  ({ agent_salary: 0, dsc_people: 0, bmc_people: 0 });

/** Read the snapshot for a period, grouped the way the statement needs it. */
export async function getRunningPeopleCost(periodCode: string): Promise<PeopleCostByKey> {
  const out: PeopleCostByKey = {
    byBranch: new Map(),
    byProcess: new Map(),
    coverageByBranch: new Map(),
    coverageByProcess: new Map(),
    asOfDate: null,
  };
  if (!/^\d{4}-\d{2}$/.test(periodCode)) return out;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_id, process_id, pnl_bucket,
            SUM(earned_salary_till_date) AS amount,
            MAX(as_of_date) AS as_of_date
       FROM pnl_running_salary_snapshot
      WHERE period_code = ?
      GROUP BY branch_id, process_id, pnl_bucket`,
    [periodCode]
  );

  for (const row of rows) {
    const amount = Number(row.amount ?? 0);
    const bucket = String(row.pnl_bucket) as PnlPeopleBucket;
    if (!amount) continue;
    if (row.as_of_date) {
      const seen = String(row.as_of_date).slice(0, 10);
      if (!out.asOfDate || seen > out.asOfDate) out.asOfDate = seen;
    }
    if (row.branch_id) {
      const key = String(row.branch_id);
      const current = out.byBranch.get(key) ?? emptyBuckets();
      current[bucket] += amount;
      out.byBranch.set(key, current);
    }
    if (row.process_id) {
      const key = String(row.process_id);
      const current = out.byProcess.get(key) ?? emptyBuckets();
      current[bucket] += amount;
      out.byProcess.set(key, current);
    }
  }

  // Counted from `employees` rather than from the snapshot, because the employees MISSING from the
  // snapshot are exactly what makes a column untrustworthy — a snapshot-only count can never see them.
  const [coverage] = await db.execute<RowDataPacket[]>(
    `SELECT e.branch_id, e.process_id,
            COUNT(*) AS active_employees,
            COUNT(s.id) AS covered_employees
       FROM employees e
       LEFT JOIN pnl_running_salary_snapshot s
              ON s.employee_id = e.id AND s.period_code = ?
      WHERE e.active_status = 1
      GROUP BY e.branch_id, e.process_id`,
    [periodCode]
  );

  const addCoverage = (map: Map<string, PeopleCoverage>, key: string, active: number, covered: number) => {
    const current = map.get(key) ?? { activeEmployees: 0, coveredEmployees: 0 };
    current.activeEmployees += active;
    current.coveredEmployees += covered;
    map.set(key, current);
  };

  for (const row of coverage) {
    const active = Number(row.active_employees ?? 0);
    const covered = Number(row.covered_employees ?? 0);
    if (row.branch_id) addCoverage(out.coverageByBranch, String(row.branch_id), active, covered);
    if (row.process_id) addCoverage(out.coverageByProcess, String(row.process_id), active, covered);
  }
  return out;
}

export const pnlRunningSalaryService = { refreshRunningSalarySnapshot, getRunningPeopleCost, resolveBucket };
