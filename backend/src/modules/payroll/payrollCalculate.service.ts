import { randomUUID } from "crypto";
import sql from "mssql";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getNcosecPool } from "../../db/ncosecDb.js";
import { payrollService } from "./payroll.service.js";
import type { SalaryPrepRun } from "./payroll.types.js";
import { maternityService } from "../compliance/maternity.service.js";
import { isOperationsExecutive, classifyCosecMinutes } from "../wfm/attendance-engine.service.js";
import { type PunchGroup, mergeNightShiftRollover } from "../wfm/cosec-sync.service.js";
import { resolveHolidaysForEmployee } from "./holiday-work.service.js";

interface TaxDeclarationRow {
  declared_hra: number;
  declared_80c: number;
  declared_80d: number;
  regime: string;
}

const LOCKED_STATUSES = new Set(["locked", "disbursed"]);

// ─── Gratuity ─────────────────────────────────────────────────────────────────

export interface GratuityResult {
  eligible: boolean;
  amount: number;
  years: number;
}

/**
 * Calculate gratuity for an employee using the Payment of Gratuity Act formula:
 * amount = (lastBasicMonthly / 26) * 15 * completedYears
 * Eligibility: >= 60 months (5 years) of continuous service.
 */
export async function calculateGratuity(
  employeeId: string,
  lastBasicMonthly: number
): Promise<GratuityResult> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT date_of_joining FROM employees WHERE id = ? LIMIT 1",
    [employeeId]
  );
  const emp = (rows as Array<{ date_of_joining: string }>)[0];
  if (!emp?.date_of_joining) {
    return { eligible: false, amount: 0, years: 0 };
  }

  const joinDate = new Date(emp.date_of_joining);
  const today = new Date();
  const diffMs = today.getTime() - joinDate.getTime();
  const totalMonths = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30.4375));
  const completedYears = Math.floor(totalMonths / 12);

  if (totalMonths < 60) {
    return { eligible: false, amount: 0, years: completedYears };
  }

  const amount = Math.round(((lastBasicMonthly / 26) * 15 * completedYears) * 100) / 100;
  return { eligible: true, amount, years: completedYears };
}

// ─── TDS ──────────────────────────────────────────────────────────────────────

export interface TdsResult {
  tds_annual: number;
  tds_monthly: number;
  effective_rate: number;
}

interface StatutoryConfigMap {
  [key: string]: number;
}

/**
 * Calculate TDS under New Regime (Section 115BAC) FY 2025-26.
 * Applies standard deduction and 87A rebate from statutory_config.
 */
export function calculateTds(
  annualTaxableIncome: number,
  statutoryConfig: StatutoryConfigMap
): TdsResult {
  const stdDeduction = statutoryConfig["tds_standard_deduction"] ?? 75000;
  const rebateLimit  = statutoryConfig["tds_rebate_87a_limit"]   ?? 700000;

  const taxableIncome = Math.max(0, annualTaxableIncome - stdDeduction);

  // New regime slabs FY 2025-26
  const slabs: Array<{ from: number; to: number; rate: number }> = [
    { from: 0,       to: 300000,  rate: (statutoryConfig["tds_slab_0_300000"]        ?? 0)  / 100 },
    { from: 300001,  to: 700000,  rate: (statutoryConfig["tds_slab_300001_700000"]   ?? 5)  / 100 },
    { from: 700001,  to: 1000000, rate: (statutoryConfig["tds_slab_700001_1000000"]  ?? 10) / 100 },
    { from: 1000001, to: 1200000, rate: (statutoryConfig["tds_slab_1000001_1200000"] ?? 15) / 100 },
    { from: 1200001, to: 1500000, rate: (statutoryConfig["tds_slab_1200001_1500000"] ?? 20) / 100 },
    { from: 1500001, to: Infinity, rate: (statutoryConfig["tds_slab_1500001_above"]  ?? 30) / 100 },
  ];

  let tax = 0;
  for (const slab of slabs) {
    if (taxableIncome <= slab.from - 1) break;
    const slabMax = slab.to === Infinity ? taxableIncome : Math.min(taxableIncome, slab.to);
    const slabMin = slab.from - 1;
    tax += (slabMax - slabMin) * slab.rate;
  }

  // Section 87A rebate: nil tax if total income <= rebateLimit
  if (annualTaxableIncome <= rebateLimit) {
    tax = 0;
  }

  const tds_annual  = Math.round(tax * 100) / 100;
  const tds_monthly = Math.round((tds_annual / 12) * 100) / 100;
  const effective_rate = annualTaxableIncome > 0
    ? Math.round((tds_annual / annualTaxableIncome) * 10000) / 100
    : 0;

  return { tds_annual, tds_monthly, effective_rate };
}

// ─── Professional Tax from Slab ───────────────────────────────────────────────

/**
 * Look up PT amount for a given state and monthly income from pt_slab_master.
 * Falls back to 200 if no matching slab is found.
 */
export async function getPtFromSlab(
  stateCode: string,
  monthlyIncome: number
): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT pt_amount FROM pt_slab_master
      WHERE state_code = ?
        AND is_active = 1
        AND income_from <= ?
        AND (income_to IS NULL OR income_to >= ?)
      ORDER BY income_from DESC
      LIMIT 1`,
    [stateCode, monthlyIncome, monthlyIncome]
  );
  const row = (rows as Array<{ pt_amount: number }>)[0];
  return row ? Number(row.pt_amount) : 200;
}

export interface CalculateResult {
  run_id: string;
  status: string;
  employees_processed: number;
  total_gross: number;
  total_deductions: number;
  total_net: number;
}

interface EmployeeRow {
  employee_id: string;
  employee_code: string;
  ctc_annual: number;
  basic_pct: number;
  hra_pct: number;
  state_code: string | null;
  salary_start_date: string | null;
  dept_name: string;
  designation_name: string;
}

interface AttendanceRow {
  employee_id: string;
  working_days: number;
  present_days: number;
  leave_days: number;
  lwp_days: number;
  late_marks: number;
  dialer_hours: number | null;
}

interface StatutoryRow {
  pf_employee_pct: number;
  esic_employee_pct: number;
  esic_wage_limit: number;
  pf_wage_limit: number;
  professional_tax: number;
}

// ─── NCOSEC Payroll Pre-sync ───────────────────────────────────────────────────

/**
 * Sync attendance directly from NCOSEC Mx_DATDTrn into attendance_daily_record
 * before payroll runs. This ensures payroll always reads the freshest NCOSEC data
 * rather than waiting for the 5-minute cosec-sync pipeline.
 *
 * - Skips APR/Operations Executive employees (they use dialler data)
 * - Skips records already locked (is_locked=1 — already regularized/finalized)
 * - Applies night-shift merge (same logic as cosec-sync)
 * - Applies leave/holiday overrides before upserting
 * - Wrapped in try/catch at call site — NCOSEC failure does not block payroll
 */
async function syncAttendanceFromNcosecForPayroll(
  employees: EmployeeRow[],
  monthStart: string,
  monthEnd: string,
): Promise<void> {
  // Step 1: Filter to non-APR employees
  const ncosecEmployees = employees.filter(
    e => !isOperationsExecutive(e.dept_name, e.designation_name),
  );
  if (ncosecEmployees.length === 0) return;

  const empIds = ncosecEmployees.map(e => e.employee_id);
  const ph = empIds.map(() => '?').join(', ');

  // Step 2: Fetch COSEC UserID for each employee
  const [mappingRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id AS employee_id,
            COALESCE(em.external_id, e.employee_code) AS cosec_user_id
     FROM employees e
     LEFT JOIN employee_external_mapping em
       ON em.employee_id = e.id AND em.system_name = 'ncosec' AND em.is_active = 1
     WHERE e.id IN (${ph})`,
    empIds,
  );
  const cosecToEmpId = new Map<string, string>();
  const empIdToCosec = new Map<string, string>();
  for (const row of mappingRows as any[]) {
    cosecToEmpId.set(row.cosec_user_id, row.employee_id);
    empIdToCosec.set(row.employee_id, row.cosec_user_id);
  }
  const cosecUserIds = [...cosecToEmpId.keys()];
  if (cosecUserIds.length === 0) return;

  // Step 3: Fetch already-locked records to skip them
  const [lockedRows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id, DATE_FORMAT(record_date, '%Y-%m-%d') AS record_date
     FROM attendance_daily_record
     WHERE employee_id IN (${ph})
       AND record_date BETWEEN ? AND ?
       AND is_locked = 1`,
    [...empIds, monthStart, monthEnd],
  );
  const locked = new Set<string>(
    (lockedRows as any[]).map(r => `${r.employee_id}:${r.record_date}`),
  );

  // Step 4: Fetch approved leaves for leave_approved override
  const [leaveRows] = await db.execute<RowDataPacket[]>(
    `WITH RECURSIVE cal AS (
       SELECT employee_id, from_date AS d, to_date
       FROM leave_request
       WHERE employee_id IN (${ph})
         AND status = 'approved'
         AND from_date <= ? AND to_date >= ?
       UNION ALL
       SELECT employee_id, DATE_ADD(d, INTERVAL 1 DAY), to_date
       FROM cal WHERE d < to_date
     )
     SELECT employee_id, DATE_FORMAT(d, '%Y-%m-%d') AS d
     FROM cal WHERE d BETWEEN ? AND ?`,
    [...empIds, monthEnd, monthStart, monthStart, monthEnd],
  );
  const leaveApproved = new Set<string>(
    (leaveRows as any[]).map(r => `${r.employee_id}:${r.d}`),
  );

  // Fetch holidays
  const [holidayRows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT e.id AS employee_id, DATE_FORMAT(lhm.holiday_date, '%Y-%m-%d') AS d
     FROM leave_holiday_master lhm
     JOIN employees e ON e.id IN (${ph})
       AND (lhm.branch_id IS NULL OR lhm.branch_id = e.branch_id)
     WHERE lhm.holiday_date BETWEEN ? AND ? AND lhm.active_status = 1`,
    [...empIds, monthStart, monthEnd],
  );
  const holidays = new Set<string>(
    (holidayRows as any[]).map(r => `${r.employee_id}:${r.d}`),
  );

  // Step 5: Query NCOSEC Mx_DATDTrn for the pay month
  const pool = await getNcosecPool();
  const request = pool.request();
  request.input('fromDate', sql.Date, monthStart);
  request.input('toDate', sql.Date, monthEnd);
  for (let i = 0; i < cosecUserIds.length; i++) {
    request.input(`u${i}`, sql.NVarChar(100), cosecUserIds[i]);
  }
  const userConditions = cosecUserIds.map((_, i) => `@u${i}`).join(', ');
  const dailyTable = process.env.NCOSEC_DAILY_TABLE || 'dbo.Mx_DATDTrn';

  const result = await request.query(`
    SELECT
      CAST([UserID] AS NVARCHAR(100))       AS user_id,
      CONVERT(CHAR(10), [PDate], 23)        AS attendance_date,
      CONVERT(CHAR(19), [Punch1], 120)      AS first_punch,
      CONVERT(CHAR(19), [OutPunch], 120)    AS last_punch,
      ISNULL([WorkTime], 0)                 AS working_minutes
    FROM ${dailyTable}
    WHERE [PDate] >= @fromDate
      AND [PDate] < DATEADD(DAY, 1, @toDate)
      AND [PDate] < CAST(GETDATE() AS DATE)
      AND [UserID] IN (${userConditions})
      AND [Punch1] IS NOT NULL
      AND [OutPunch] IS NOT NULL
      AND [WorkTime] IS NOT NULL
    ORDER BY [UserID], [PDate]
  `);

  // Map to PunchGroup for night-shift merge
  const rawGroups: PunchGroup[] = result.recordset
    .map((row: any) => ({
      cosecUserId: String(row.user_id ?? '').trim(),
      punchDate: String(row.attendance_date ?? '').trim(),
      firstPunch: String(row.first_punch ?? '').trim(),
      lastPunch: String(row.last_punch ?? '').trim(),
      totalPunches: 2,
      workingMinutes: Math.max(0, Number(row.working_minutes ?? 0)),
      sourceSystem: 'ncosec_direct',
      sourceTable: dailyTable,
    }))
    .filter((g: PunchGroup) =>
      g.cosecUserId &&
      /^\d{4}-\d{2}-\d{2}$/.test(g.punchDate) &&
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(g.firstPunch) &&
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(g.lastPunch),
    );

  // Step 6: Apply night-shift merge
  const merged = mergeNightShiftRollover(rawGroups);

  // Step 7: Classify and upsert
  for (const group of merged) {
    const employeeId = cosecToEmpId.get(group.cosecUserId);
    if (!employeeId) continue;

    const lockKey = `${employeeId}:${group.punchDate}`;
    if (locked.has(lockKey)) continue; // already regularized — never overwrite

    // Apply leave/holiday override for payroll classification
    let status: string;
    let lwpValue: number;
    if (leaveApproved.has(lockKey)) {
      status = 'leave_approved'; lwpValue = 0;
    } else if (holidays.has(lockKey)) {
      status = 'holiday'; lwpValue = 0;
    } else {
      const cls = classifyCosecMinutes(group.workingMinutes);
      status = cls.status; lwpValue = cls.lwpValue;
    }

    // firstPunch/lastPunch are "YYYY-MM-DD HH:mm:ss" strings — store directly in DATETIME
    await db.execute(
      `INSERT INTO attendance_daily_record
         (id, employee_id, record_date, attendance_source, source_system,
          biometric_minutes, raw_minutes, attendance_status, lwp_value,
          late_mark, late_by_minutes, clock_in_time, clock_out_time,
          processed_at, created_by)
       VALUES (UUID(), ?, ?, 'biometric', 'ncosec_direct', ?, ?, ?, ?, 0, 0, ?, ?, NOW(), 'payroll_presync')
       ON DUPLICATE KEY UPDATE
         attendance_source = IF(is_locked=0, 'biometric',        attendance_source),
         source_system     = IF(is_locked=0, 'ncosec_direct',    source_system),
         biometric_minutes = IF(is_locked=0, VALUES(biometric_minutes), biometric_minutes),
         raw_minutes       = IF(is_locked=0, VALUES(raw_minutes),       raw_minutes),
         attendance_status = IF(is_locked=0, VALUES(attendance_status), attendance_status),
         lwp_value         = IF(is_locked=0, VALUES(lwp_value),         lwp_value),
         clock_in_time     = IF(is_locked=0, VALUES(clock_in_time),     clock_in_time),
         clock_out_time    = IF(is_locked=0, VALUES(clock_out_time),    clock_out_time),
         processed_at      = IF(is_locked=0, NOW(),                     processed_at)`,
      [
        employeeId, group.punchDate,
        group.workingMinutes, group.workingMinutes,
        status, lwpValue,
        group.firstPunch, group.lastPunch,
      ],
    );
  }

  console.log(`[payroll-presync] Synced ${merged.length} NCOSEC records for ${monthStart}–${monthEnd}`);
}

// ─── Per-branch payroll config helpers ───────────────────────────────────────

async function getPayrollConfigFlag(
  key: string,
  branchId?: string | null,
  processId?: string | null,
): Promise<string> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT config_value FROM payroll_config_flags
     WHERE config_key = ?
       AND (branch_id = ? OR branch_id IS NULL)
       AND (process_id = ? OR process_id IS NULL)
     ORDER BY (branch_id IS NOT NULL) DESC, (process_id IS NOT NULL) DESC
     LIMIT 1`,
    [key, branchId ?? null, processId ?? null],
  );
  return (rows[0] as any)?.config_value ?? "";
}

/**
 * Compute the active calendar days for a given employee/month,
 * accounting for mid-month joins and exits.
 */
async function computeActiveCalendarDays(
  employeeId: string,
  monthStart: string,
  monthEnd: string,
  daysInMonth: number,
  salaryStartDate: string | null,
): Promise<number> {
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT date_of_leaving FROM employees WHERE id = ? LIMIT 1`,
    [employeeId],
  );
  const dateOfLeaving = (empRows[0] as any)?.date_of_leaving ?? null;

  const effectiveStart = salaryStartDate && salaryStartDate > monthStart
    ? salaryStartDate
    : monthStart;
  const effectiveEnd = dateOfLeaving && dateOfLeaving < monthEnd
    ? dateOfLeaving
    : monthEnd;

  const start = new Date(effectiveStart);
  const end = new Date(effectiveEnd);
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  return Math.max(1, Math.min(days, daysInMonth));
}

/**
 * Count branch-level working days (total calendar days - holidays - sundays/roster-offs).
 * Used as the denominator for LWP calculation.
 * Falls back to 26 if holiday data is unavailable.
 */
async function computeBranchWorkingDays(
  branchId: string | null,
  monthStart: string,
  monthEnd: string,
  daysInMonth: number,
): Promise<number> {
  if (!branchId) return 26;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM leave_holiday_master
     WHERE holiday_date BETWEEN ? AND ?
       AND active_status = 1
       AND (branch_id IS NULL OR branch_id = ?)`,
    [monthStart, monthEnd, branchId],
  );
  const holidayCount = Number((rows[0] as any)?.cnt ?? 0);
  // Standard 6-day week BPO: daysInMonth - sundays - holidays
  // Count Sundays in the month
  let sundays = 0;
  const d = new Date(monthStart);
  const mEnd = new Date(monthEnd);
  while (d <= mEnd) {
    if (d.getDay() === 0) sundays++;
    d.setDate(d.getDate() + 1);
  }
  const workingDays = daysInMonth - sundays - holidayCount;
  return Math.max(20, Math.min(workingDays, 27)); // sanity clamp 20–27
}

export async function calculatePayrollRun(runId: string, userId: string, singleEmployeeId?: string): Promise<CalculateResult> {
  // 1. Load run
  const [runRows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM salary_prep_run WHERE id = ? LIMIT 1", [runId]
  );
  const run = (runRows as SalaryPrepRun[])[0];
  if (!run) throw new Error("Run not found");
  if (LOCKED_STATUSES.has(run.status)) {
    throw new Error(`Cannot recalculate a ${run.status} run`);
  }
  // TDS mode: 'manual' = skip auto-TDS projection; Payroll HO uploads amounts separately.
  const tdsMode: 'auto' | 'manual' = (run as any).tds_mode ?? 'manual';

  // 2a. Load statutory config as flat key→value map (for TDS slab lookups)
  const [statKvRows] = await db.execute<RowDataPacket[]>(
    "SELECT config_key, config_value FROM statutory_config"
  );
  const statConfig: StatutoryConfigMap = {};
  for (const r of statKvRows as Array<{ config_key: string; config_value: number }>) {
    // Normalise keys to lowercase so calculateTds() lookups work
    statConfig[r.config_key.toLowerCase()] = Number(r.config_value);
  }

  // 2b. Legacy flat-row fallback (PF / ESIC / PT values)
  const stat: StatutoryRow = {
    pf_employee_pct:  statConfig["pf_employee_pct"]  ?? statConfig["pf_employee_pct"]  ?? 12,
    esic_employee_pct: statConfig["esic_employee_pct"] ?? 0.75,
    esic_wage_limit:  statConfig["esic_wage_limit"]  ?? 21000,
    pf_wage_limit:    statConfig["pf_wage_limit"]    ?? 15000,
    professional_tax: statConfig["professional_tax"] ?? 200,
  };

  // 3. Fetch eligible employees (scoped to run's process/branch filters, or single employee)
  const empConds: string[] = ["esa.active_status = 1"];
  const empParams: unknown[] = [];
  if (singleEmployeeId) {
    // Recalculation queue: only re-process this one employee
    empConds.push("e.id = ?");
    empParams.push(singleEmployeeId);
  } else {
    if (run.process_filter) {
      empConds.push("(pm.process_name = ? OR e.process_id IN (SELECT id FROM process_master WHERE process_name = ?))");
      empParams.push(run.process_filter, run.process_filter);
    }
    if (run.branch_filter) {
      empConds.push("e.branch_id IN (SELECT id FROM branch_master WHERE branch_name = ?)");
      empParams.push(run.branch_filter);
    }
  }

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id AS employee_id, e.employee_code,
            esa.ctc_annual, ss.basic_pct, ss.hra_pct,
            bm.state AS state_code, e.branch_id, e.process_id,
            COALESCE(e.salary_start_date, e.date_of_joining) AS salary_start_date,
            LOWER(COALESCE(dm.dept_name, '')) AS dept_name,
            LOWER(COALESCE(desig.designation_name, '')) AS designation_name
       FROM employees e
       JOIN employee_salary_assignment esa ON esa.employee_id = e.id
       JOIN salary_structure_master ss      ON ss.id = esa.structure_id
       LEFT JOIN process_master pm          ON pm.id = e.process_id
       LEFT JOIN branch_master bm           ON bm.id = e.branch_id
       LEFT JOIN department_master dm       ON dm.id = e.department_id
       LEFT JOIN designation_master desig   ON desig.id = e.designation_id
      WHERE LOWER(e.employment_status) = 'active' AND ${empConds.join(" AND ")}`,
    empParams
  );
  const employees = empRows as (EmployeeRow & { branch_id: string; process_id: string })[];

  // 4. Derive calendar info from run_month
  const [year, month] = run.run_month.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();

  // Derive financial year string e.g. "2025-26" for months April–March
  const fyStartYear = month >= 4 ? year : year - 1;
  const financialYear = `${fyStartYear}-${String(fyStartYear + 1).slice(2)}`;

  let totalGross = 0;
  let totalDed = 0;
  let totalNet = 0;

  // Fetch employees on approved/active maternity leave covering this pay month.
  // Per MBA 1961 s.5(1) these employees receive full pay — no LWP deduction.
  const maternityExemptIds = await maternityService.getActiveEmployeeIdsForMonth(run.run_month);

  // Hoist month boundary (used by presync and by per-emp loop)
  const monthStart = `${run.run_month}-01`;
  const monthEnd   = `${run.run_month}-${String(daysInMonth).padStart(2, "0")}`;

  // Pre-sync attendance from NCOSEC directly before payroll calculation.
  // This ensures payroll reads the freshest NCOSEC data, not the 5-min sync cache.
  // Wrapped in try/catch — if NCOSEC is unreachable, payroll falls through to cached data.
  try {
    await syncAttendanceFromNcosecForPayroll(employees, monthStart, monthEnd);
  } catch (err) {
    console.error('[payroll-presync] NCOSEC sync failed, proceeding with cached attendance data:',
      err instanceof Error ? err.message : String(err));
  }

  for (const emp of employees) {

    // salary_start_date gate: skip employees whose salary hasn't started yet this month
    if (emp.salary_start_date) {
      const ssd = new Date(emp.salary_start_date);
      const monthEndDate = new Date(monthEnd);
      if (ssd > monthEndDate) {
        // Still in unpaid training — no payroll entry this month
        continue;
      }
    }

    // Active calendar days (handles mid-month join/exit for correct pro-rata)
    const activeCalDays = await computeActiveCalendarDays(
      emp.employee_id, monthStart, monthEnd, daysInMonth, emp.salary_start_date,
    );

    // Branch-aware working days denominator (replaces hardcoded 26)
    const branchWorkingDays = await computeBranchWorkingDays(
      emp.branch_id ?? null, monthStart, monthEnd, daysInMonth,
    );

    // Per-employee payroll config flags
    const weekoffEarningRequired =
      (await getPayrollConfigFlag("weekoff_earning_required", emp.branch_id, emp.process_id)) !== "false";
    const workingDaysPerWeekoff =
      parseInt(await getPayrollConfigFlag("working_days_required_for_one_weekoff", emp.branch_id, emp.process_id) || "6", 10);

    // Pro-rata multiplier: if salary starts mid-month, pay only from that date
    let proRataMultiplier = activeCalDays / daysInMonth;
    if (proRataMultiplier > 1) proRataMultiplier = 1;

    // 5. Fetch attendance summary for this employee for run_month

    // Check if attendance_daily_record has been populated for this employee+month
    const [adrCountRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM attendance_daily_record
       WHERE employee_id = ? AND record_date BETWEEN ? AND ?`,
      [emp.employee_id, monthStart, monthEnd]
    );
    const hasEngineData = Number((adrCountRows[0] as any).cnt ?? 0) > 0;

    let att: AttendanceRow;

    if (hasEngineData) {
      // Use attendance_daily_record — role-aware (dialler/biometric) with half-days, leaves, holidays
      const [attRows] = await db.execute<RowDataPacket[]>(
        `SELECT
           ? AS employee_id,
           (SELECT COUNT(*) FROM attendance_daily_record
            WHERE employee_id = ? AND record_date BETWEEN ? AND ?
              AND attendance_status NOT IN ('week_off','holiday')) AS working_days,
           COUNT(CASE WHEN adr.attendance_status = 'present'        THEN 1 END) AS present_days,
           COUNT(CASE WHEN adr.attendance_status IN ('leave_approved','half_day') THEN 1 END) AS leave_days,
           COALESCE(SUM(adr.lwp_value), 0)                                       AS lwp_days,
           COALESCE(SUM(adr.late_mark), 0)                                       AS late_marks,
           COALESCE(SUM(CASE WHEN adr.attendance_source = 'dialler'
                              THEN adr.raw_minutes / 60.0 END), NULL)            AS dialer_hours
         FROM attendance_daily_record adr
         WHERE adr.employee_id = ? AND adr.record_date BETWEEN ? AND ?`,
        [emp.employee_id, emp.employee_id, monthStart, monthEnd, emp.employee_id, monthStart, monthEnd]
      );
      att = (attRows as AttendanceRow[])[0] ?? {
        employee_id: emp.employee_id,
        working_days: branchWorkingDays,
        present_days: branchWorkingDays,
        leave_days: 0,
        lwp_days: 0,
        late_marks: 0,
        dialer_hours: null,
      };
    } else {
      // Fallback: legacy session-count query (no attendance engine data yet)
      const [attRows] = await db.execute<RowDataPacket[]>(
        `SELECT
           ? AS employee_id,
           ? AS working_days,
           COUNT(CASE WHEN s.current_status IN ('Logged Out','Logged In') THEN 1 END) AS present_days,
           0 AS leave_days,
           (? - COUNT(CASE WHEN s.current_status IN ('Logged Out','Logged In') THEN 1 END)) AS lwp_days,
           0 AS late_marks,
           NULL AS dialer_hours
         FROM wfm_attendance_session s
         WHERE s.employee_id = ? AND s.session_date BETWEEN ? AND ?`,
        [emp.employee_id, branchWorkingDays, branchWorkingDays, emp.employee_id, monthStart, monthEnd]
      );
      att = (attRows as AttendanceRow[])[0] ?? {
        employee_id: emp.employee_id,
        working_days: branchWorkingDays,
        present_days: branchWorkingDays,
        leave_days: 0,
        lwp_days: 0,
        late_marks: 0,
        dialer_hours: null,
      };
    }

    // ─── Week-off and holiday eligibility ─────────────────────────────────────

    // Count rostered week-off days this month from attendance_daily_record
    const [woRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM attendance_daily_record
       WHERE employee_id = ? AND record_date BETWEEN ? AND ?
         AND attendance_status = 'week_off'`,
      [emp.employee_id, monthStart, monthEnd],
    );
    const rosteredWeekoffs = Number((woRows[0] as any)?.cnt ?? 0);

    // Paid working days (present + approved leave) for week-off earning
    const presentDays = Number(att.present_days) || 0;
    const leaveDays   = Number(att.leave_days)   || 0;
    const paidWorkingDays = presentDays + leaveDays;

    // Eligible week-offs earned this month
    let eligibleWeekoffs: number;
    if (weekoffEarningRequired) {
      const earned = Math.floor(paidWorkingDays / workingDaysPerWeekoff);
      eligibleWeekoffs = Math.min(rosteredWeekoffs, earned);
    } else {
      eligibleWeekoffs = rosteredWeekoffs;
    }

    // Eligible holidays via cost-centre / designation resolution
    let eligibleHolidays = 0;
    const dateIter = new Date(monthStart);
    const monthEndDate = new Date(monthEnd);
    while (dateIter <= monthEndDate) {
      const dateStr = dateIter.toISOString().slice(0, 10);
      try {
        const hols = await resolveHolidaysForEmployee(emp.employee_id, dateStr);
        if (hols.length > 0) eligibleHolidays++;
      } catch (_) { /* non-blocking */ }
      dateIter.setDate(dateIter.getDate() + 1);
    }

    // Payable days = present + paid leave + eligible week-offs + eligible holidays - LWP
    const lwpDays = Number(att.lwp_days) || 0;
    const rawPayableDays = paidWorkingDays + eligibleWeekoffs + eligibleHolidays - lwpDays;
    // Hard cap: payable days must never exceed active calendar days (MAS policy)
    const finalPayableDays = Math.min(Math.max(0, rawPayableDays), activeCalDays);

    const grossMonthly = (emp.ctc_annual / 12) * proRataMultiplier;

    // 5c. LWP deduction — skip for employees on maternity leave (MBA 1961 s.5(1))
    // Use finalPayableDays as effective paid days; deduction = gross * (lwp / activeCalDays)
    const workingDays = att.working_days || branchWorkingDays;
    const isOnMaternityLeave = maternityExemptIds.has(emp.employee_id);
    const lwpDeduction = (!isOnMaternityLeave && lwpDays > 0)
      ? Math.round((grossMonthly / activeCalDays) * lwpDays * 100) / 100
      : 0;
    // Gross based on finalPayableDays (includes eligible week-offs and holidays)
    const grossAfterLwp = Math.max(0, (emp.ctc_annual / 12) * (finalPayableDays / activeCalDays));

    // 5a. Fetch tax declaration for this employee / financial year
    const [declRows] = await db.execute<RowDataPacket[]>(
      "SELECT declared_hra, declared_80c, declared_80d, regime FROM tax_declaration WHERE employee_id = ? AND financial_year = ? LIMIT 1",
      [emp.employee_id, financialYear]
    );
    const decl = (declRows as TaxDeclarationRow[])[0] ?? null;

    // 5b. TDS: skip auto-projection when run is in manual TDS mode.
    // In manual mode, Payroll HO uploads per-employee TDS via POST /runs/:id/manual-tds.
    // Those amounts are applied in a post-calculation pass (see applyManualTds below).
    let tdsMonthly = 0;
    if (tdsMode === 'auto') {
      const annualGross = grossAfterLwp * 12;
      const declHra  = decl ? Number(decl.declared_hra)  : 0;
      const decl80c  = decl ? Number(decl.declared_80c)  : 0;
      const decl80d  = decl ? Number(decl.declared_80d)  : 0;
      const taxableIncome = Math.max(0, annualGross - declHra - decl80c - decl80d);
      tdsMonthly = calculateTds(taxableIncome, statConfig).tds_monthly;
    }

    // 5d. Salary advance monthly recovery
    const [advRows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(ROUND(amount / recovery_months, 2)), 0) AS monthly_recovery
         FROM salary_advance_log
        WHERE employee_id = ? AND status = 'active'`,
      [emp.employee_id]
    );
    const advanceRecovery = Number((advRows as Array<{ monthly_recovery: number }>)[0]?.monthly_recovery ?? 0);

    // Resolve PT from slab when employee has a state_code, else fall back to config value
    const professionalTax = emp.state_code
      ? await getPtFromSlab(emp.state_code, grossAfterLwp)
      : stat.professional_tax;

    // Check for approved PF / ESI opt-outs (employee voluntary declaration approved by Payroll HO)
    const [overrideRows] = await db.execute<RowDataPacket[]>(
      `SELECT override_type FROM employee_statutory_override
       WHERE employee_id = ? AND status = 'approved'
         AND (effective_from_month IS NULL OR effective_from_month <= ?)`,
      [emp.employee_id, run.run_month]
    );
    const pfOptOut   = (overrideRows as Array<{ override_type: string }>).some(r => r.override_type === 'pf_opt_out');
    const esicOptOut = (overrideRows as Array<{ override_type: string }>).some(r => r.override_type === 'esic_opt_out');

    const calc = payrollService.calculateNetSalary({
      grossMonthlyCTC: grossAfterLwp,
      workingDays,
      lwpDays: 0, // LWP already applied above; pass 0 to avoid double-deduction
      pfEmployeePct: stat.pf_employee_pct,
      esicEmployeePct: stat.esic_employee_pct,
      esicWageLimit: stat.esic_wage_limit,
      pfWageLimit: stat.pf_wage_limit,
      professionalTax,
      tds: tdsMonthly,
      basicPct: emp.basic_pct ?? 40,
      hraPct: emp.hra_pct ?? 20,
      pfOptOut,
      esicOptOut,
    });

    // Net pay = payrollService net + advance recovery deducted on top
    // Note: lwpDeduction is already reflected in grossAfterLwp passed to calculateNetSalary,
    // so calc.gross_salary is post-LWP. We do NOT add lwpDeduction into totalDedFinal again
    // to avoid double-counting it (the LWP reduction is visible via gross_before_lwp vs gross_salary).
    const netPayFinal = Math.max(0, calc.net_salary - advanceRecovery);
    const totalDedFinal = calc.total_deductions + advanceRecovery;

    // 6. Upsert prep line (includes extended columns from migration 331)
    await db.execute(
      `INSERT INTO salary_prep_line
         (id, run_id, employee_id, employee_code,
          working_days, present_days, leave_days, lwp_days, late_marks, dialer_hours,
          gross_salary, gross_before_lwp, total_deductions, net_salary,
          basic, hra, special_allowance,
          pf_employee, pf_employer, esic_employee, esic_employer,
          professional_tax, tds, tds_amount, lwp_deduction, advance_recovery,
          paid_working_days, eligible_weekoff_days, eligible_holiday_days, final_payable_days,
          active_calendar_days, salary_start_date,
          base_gross_pay, base_net_pay, needs_recalculation,
          status)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?, ?, ?, 0,
               'calculated')
       ON DUPLICATE KEY UPDATE
         working_days = VALUES(working_days), present_days = VALUES(present_days),
         lwp_days = VALUES(lwp_days), gross_salary = VALUES(gross_salary),
         gross_before_lwp = VALUES(gross_before_lwp),
         total_deductions = VALUES(total_deductions), net_salary = VALUES(net_salary),
         basic = VALUES(basic), hra = VALUES(hra), special_allowance = VALUES(special_allowance),
         pf_employee = VALUES(pf_employee), pf_employer = VALUES(pf_employer),
         esic_employee = VALUES(esic_employee), esic_employer = VALUES(esic_employer),
         professional_tax = VALUES(professional_tax),
         tds = VALUES(tds), tds_amount = VALUES(tds_amount),
         lwp_deduction = VALUES(lwp_deduction), advance_recovery = VALUES(advance_recovery),
         paid_working_days = VALUES(paid_working_days),
         eligible_weekoff_days = VALUES(eligible_weekoff_days),
         eligible_holiday_days = VALUES(eligible_holiday_days),
         final_payable_days = VALUES(final_payable_days),
         active_calendar_days = VALUES(active_calendar_days),
         salary_start_date = VALUES(salary_start_date),
         base_gross_pay = VALUES(base_gross_pay),
         base_net_pay = VALUES(base_net_pay),
         needs_recalculation = 0,
         status = 'calculated'`,
      [
        runId, emp.employee_id, emp.employee_code,
        att.working_days, att.present_days, att.leave_days, att.lwp_days, att.late_marks, att.dialer_hours,
        calc.gross_salary, grossMonthly, totalDedFinal, netPayFinal,
        calc.basic, calc.hra, calc.special_allowance,
        calc.pf_employee, calc.pf_employer, calc.esic_employee, calc.esic_employer,
        calc.professional_tax, tdsMonthly, tdsMonthly, lwpDeduction, advanceRecovery,
        paidWorkingDays, eligibleWeekoffs, eligibleHolidays, finalPayableDays,
        activeCalDays, emp.salary_start_date ?? null,
        grossMonthly, calc.net_salary,
      ]
    );

    totalGross += calc.gross_salary;
    totalDed   += totalDedFinal;
    totalNet   += netPayFinal;
  }

  // 7a. Apply manual TDS entries (only when tds_mode = 'manual')
  // For each row in salary_run_manual_tds, update the salary_prep_line TDS fields
  // and recalculate net_salary / total_deductions in-place.
  if (tdsMode === 'manual') {
    const [manualTdsRows] = await db.execute<RowDataPacket[]>(
      `SELECT employee_id, tds_amount FROM salary_run_manual_tds WHERE run_id = ?`,
      [runId]
    );
    for (const row of manualTdsRows as Array<{ employee_id: string; tds_amount: number }>) {
      const tdsAmt = Number(row.tds_amount) || 0;
      await db.execute(
        `UPDATE salary_prep_line
            SET tds = ?, tds_amount = ?,
                total_deductions = total_deductions + ?,
                net_salary = GREATEST(0, net_salary - ?)
          WHERE run_id = ? AND employee_id = ?`,
        [tdsAmt, tdsAmt, tdsAmt, tdsAmt, runId, row.employee_id]
      );
    }
    // Recalculate run totals after TDS application
    const [sumRows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(gross_salary),0) AS tg,
              COALESCE(SUM(total_deductions),0) AS td,
              COALESCE(SUM(net_salary),0) AS tn
       FROM salary_prep_line WHERE run_id = ?`,
      [runId]
    );
    const sums = (sumRows[0] as any);
    totalGross = Number(sums.tg);
    totalDed   = Number(sums.td);
    totalNet   = Number(sums.tn);
  }

  // 7. Update run totals + status
  await db.execute(
    `UPDATE salary_prep_run
        SET status = 'processing', total_employees = ?,
            total_gross = ?, total_deductions = ?, total_net = ?
      WHERE id = ?`,
    [employees.length, totalGross, totalDed, totalNet, runId]
  );

  const [updated] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM salary_prep_run WHERE id = ? LIMIT 1", [runId]
  );

  return {
    run_id: runId,
    status: (updated as SalaryPrepRun[])[0]?.status ?? "processing",
    employees_processed: employees.length,
    total_gross: totalGross,
    total_deductions: totalDed,
    total_net: totalNet,
  };
}
