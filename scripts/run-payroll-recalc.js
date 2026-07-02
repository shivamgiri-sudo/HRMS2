const mysql = require('mysql2/promise');

const db = mysql.createPool({
  host: '192.168.10.6',
  user: 'shivam_user',
  password: 'qwersdfg!@#hjk',
  database: 'mas_hrms',
  timezone: 'Z',
  waitForConnections: true,
  connectionLimit: 5,
});

// ── Inline payroll calculator (mirrors payrollCalculate.service.ts logic) ──────

function calculateTds(annualTaxableIncome, statConfig) {
  const stdDeduction = statConfig['tds_standard_deduction'] ?? 75000;
  const rebateLimit  = statConfig['tds_rebate_87a_limit']   ?? 700000;
  const taxableIncome = Math.max(0, annualTaxableIncome - stdDeduction);
  const slabs = [
    { from: 0,       to: 300000,  rate: (statConfig['tds_slab_0_300000']        ?? 0)  / 100 },
    { from: 300001,  to: 700000,  rate: (statConfig['tds_slab_300001_700000']   ?? 5)  / 100 },
    { from: 700001,  to: 1000000, rate: (statConfig['tds_slab_700001_1000000']  ?? 10) / 100 },
    { from: 1000001, to: 1200000, rate: (statConfig['tds_slab_1000001_1200000'] ?? 15) / 100 },
    { from: 1200001, to: 1500000, rate: (statConfig['tds_slab_1200001_1500000'] ?? 20) / 100 },
    { from: 1500001, to: Infinity, rate: (statConfig['tds_slab_1500001_above']  ?? 30) / 100 },
  ];
  let tax = 0;
  for (const slab of slabs) {
    if (taxableIncome <= slab.from - 1) break;
    const slabMax = slab.to === Infinity ? taxableIncome : Math.min(taxableIncome, slab.to);
    tax += (slabMax - (slab.from - 1)) * slab.rate;
  }
  if (annualTaxableIncome <= rebateLimit) tax = 0;
  return { tds_monthly: Math.round((tax / 12) * 100) / 100 };
}

function calcNet({ grossMonthlyCTC, workingDays, lwpDays, pfEmployeePct, esicEmployeePct,
                   esicWageLimit, pfWageLimit, professionalTax, tds, basicPct, hraPct }) {
  const gross = grossMonthlyCTC;
  const basic = Math.round(gross * (basicPct / 100) * 100) / 100;
  const hra   = Math.round(gross * (hraPct / 100) * 100) / 100;
  const special = Math.max(0, Math.round((gross - basic - hra) * 100) / 100);

  const pfWage = Math.min(gross, pfWageLimit);
  const pf_employee = Math.round(pfWage * (pfEmployeePct / 100) * 100) / 100;
  const pf_employer = pf_employee;

  const esicWage = gross <= esicWageLimit ? gross : 0;
  const esic_employee = Math.round(esicWage * (esicEmployeePct / 100) * 100) / 100;
  const esic_employer = Math.round(esicWage * 0.0325 * 100) / 100;

  const total_deductions = pf_employee + esic_employee + professionalTax + tds;
  const net_salary = Math.max(0, Math.round((gross - total_deductions) * 100) / 100);

  return { gross_salary: gross, basic, hra, special_allowance: special,
           pf_employee, pf_employer, esic_employee, esic_employer,
           professional_tax: professionalTax, total_deductions, net_salary };
}

async function calculatePayrollRun(runId) {
  const [[run]] = await db.execute('SELECT * FROM salary_prep_run WHERE id = ? LIMIT 1', [runId]);
  if (!run) throw new Error('Run not found: ' + runId);
  if (['locked', 'disbursed'].includes(run.status)) throw new Error(`Cannot recalculate a ${run.status} run`);

  // Load statutory config
  const [statRows] = await db.execute('SELECT config_key, config_value FROM statutory_config');
  const statConfig = {};
  for (const r of statRows) statConfig[r.config_key.toLowerCase()] = Number(r.config_value);
  const stat = {
    pf_employee_pct:   statConfig['pf_employee_pct']  ?? 12,
    esic_employee_pct: statConfig['esic_employee_pct'] ?? 0.75,
    esic_wage_limit:   statConfig['esic_wage_limit']   ?? 21000,
    pf_wage_limit:     statConfig['pf_wage_limit']     ?? 15000,
    professional_tax:  statConfig['professional_tax']  ?? 200,
  };

  // Fetch eligible employees
  const empConds = ['esa.active_status = 1'];
  const empParams = [];
  if (run.process_filter) {
    empConds.push('(pm.process_name = ? OR e.process_id IN (SELECT id FROM process_master WHERE process_name = ?))');
    empParams.push(run.process_filter, run.process_filter);
  }
  if (run.branch_filter) {
    empConds.push('e.branch_id IN (SELECT id FROM branch_master WHERE branch_name = ?)');
    empParams.push(run.branch_filter);
  }

  const [employees] = await db.execute(
    `SELECT e.id AS employee_id, e.employee_code,
            esa.ctc_annual, ss.basic_pct, ss.hra_pct,
            bm.state AS state_code,
            COALESCE(e.salary_start_date, e.date_of_joining) AS salary_start_date
       FROM employees e
       JOIN employee_salary_assignment esa ON esa.employee_id = e.id
       JOIN salary_structure_master ss      ON ss.id = esa.structure_id
       LEFT JOIN process_master pm          ON pm.id = e.process_id
       LEFT JOIN branch_master bm           ON bm.id = e.branch_id
      WHERE LOWER(e.employment_status) = 'active' AND ${empConds.join(' AND ')}`,
    empParams
  );

  const [year, month] = run.run_month.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const defaultWorkingDays = 26;
  const fyStartYear = month >= 4 ? year : year - 1;
  const financialYear = `${fyStartYear}-${String(fyStartYear + 1).slice(2)}`;

  let totalGross = 0, totalDed = 0, totalNet = 0;
  let processed = 0, skipped = 0;

  for (const emp of employees) {
    const monthStart = `${run.run_month}-01`;
    const monthEnd   = `${run.run_month}-${String(daysInMonth).padStart(2, '0')}`;

    if (emp.salary_start_date && new Date(emp.salary_start_date) > new Date(monthEnd)) {
      skipped++;
      continue;
    }

    let proRataMultiplier = 1;
    if (emp.salary_start_date) {
      const ssd = new Date(emp.salary_start_date);
      if (ssd > new Date(monthStart)) {
        const paidDays = daysInMonth - ssd.getDate() + 1;
        proRataMultiplier = Math.max(0, Math.min(1, paidDays / daysInMonth));
      }
    }

    // Attendance
    const [[adrCount]] = await db.execute(
      'SELECT COUNT(*) AS cnt FROM attendance_daily_record WHERE employee_id = ? AND record_date BETWEEN ? AND ?',
      [emp.employee_id, monthStart, monthEnd]
    );

    let att;
    if (Number(adrCount.cnt) > 0) {
      const [[attRow]] = await db.execute(
        `SELECT
           (SELECT COUNT(*) FROM attendance_daily_record
            WHERE employee_id = ? AND record_date BETWEEN ? AND ?
              AND attendance_status NOT IN ('week_off','holiday')) AS working_days,
           COUNT(CASE WHEN adr.attendance_status = 'present' THEN 1 END) AS present_days,
           COUNT(CASE WHEN adr.attendance_status IN ('leave_approved','half_day') THEN 1 END) AS leave_days,
           COALESCE(SUM(adr.lwp_value), 0) AS lwp_days,
           COALESCE(SUM(adr.late_mark), 0) AS late_marks,
           COALESCE(SUM(CASE WHEN adr.attendance_source = 'dialler' THEN adr.raw_minutes / 60.0 END), NULL) AS dialer_hours
         FROM attendance_daily_record adr
         WHERE adr.employee_id = ? AND adr.record_date BETWEEN ? AND ?`,
        [emp.employee_id, monthStart, monthEnd, emp.employee_id, monthStart, monthEnd]
      );
      att = attRow;
    } else {
      const [[attRow]] = await db.execute(
        `SELECT ? AS working_days,
                COUNT(CASE WHEN s.current_status IN ('Logged Out','Logged In') THEN 1 END) AS present_days,
                0 AS leave_days,
                (? - COUNT(CASE WHEN s.current_status IN ('Logged Out','Logged In') THEN 1 END)) AS lwp_days,
                0 AS late_marks, NULL AS dialer_hours
           FROM wfm_attendance_session s
          WHERE s.employee_id = ? AND s.session_date BETWEEN ? AND ?`,
        [defaultWorkingDays, defaultWorkingDays, emp.employee_id, monthStart, monthEnd]
      );
      att = attRow;
    }

    const grossMonthly = (emp.ctc_annual / 12) * proRataMultiplier;
    const workingDays  = Number(att.working_days) || defaultWorkingDays;
    const lwpDays      = Number(att.lwp_days) || 0;
    const lwpDeduction = lwpDays > 0 ? Math.round((grossMonthly / workingDays) * lwpDays * 100) / 100 : 0;
    const grossAfterLwp = Math.max(0, grossMonthly - lwpDeduction);

    const [[declRow]] = await db.execute(
      'SELECT declared_hra, declared_80c, declared_80d FROM tax_declaration WHERE employee_id = ? AND financial_year = ? LIMIT 1',
      [emp.employee_id, financialYear]
    );
    const decl = declRow || {};
    const taxableIncome = Math.max(0, grossAfterLwp * 12 - (Number(decl.declared_hra)||0) - (Number(decl.declared_80c)||0) - (Number(decl.declared_80d)||0));
    const { tds_monthly } = calculateTds(taxableIncome, statConfig);

    const [[advRow]] = await db.execute(
      `SELECT COALESCE(SUM(ROUND(amount / recovery_months, 2)), 0) AS monthly_recovery
         FROM salary_advance_log WHERE employee_id = ? AND status = 'active'`,
      [emp.employee_id]
    );
    const advanceRecovery = Number(advRow.monthly_recovery || 0);

    // PT from slab
    let professionalTax = stat.professional_tax;
    if (emp.state_code) {
      const [[ptRow]] = await db.execute(
        `SELECT pt_amount FROM pt_slab_master WHERE state_code = ? AND is_active = 1
           AND income_from <= ? AND (income_to IS NULL OR income_to >= ?)
           ORDER BY income_from DESC LIMIT 1`,
        [emp.state_code, grossAfterLwp, grossAfterLwp]
      );
      if (ptRow) professionalTax = Number(ptRow.pt_amount);
    }

    const calc = calcNet({
      grossMonthlyCTC: grossAfterLwp, workingDays, lwpDays: 0,
      pfEmployeePct: stat.pf_employee_pct,
      esicEmployeePct: stat.esic_employee_pct,
      esicWageLimit: stat.esic_wage_limit,
      pfWageLimit: stat.pf_wage_limit,
      professionalTax, tds: tds_monthly,
      basicPct: emp.basic_pct ?? 40, hraPct: emp.hra_pct ?? 20,
    });

    const netPayFinal  = Math.max(0, calc.net_salary - advanceRecovery);
    const totalDedFinal = calc.total_deductions + advanceRecovery;

    await db.execute(
      `INSERT INTO salary_prep_line
         (id, run_id, employee_id, employee_code,
          working_days, present_days, leave_days, lwp_days, late_marks, dialer_hours,
          gross_salary, gross_before_lwp, total_deductions, net_salary,
          basic, hra, special_allowance,
          pf_employee, pf_employer, esic_employee, esic_employer,
          professional_tax, tds, tds_amount, lwp_deduction, advance_recovery, status)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'calculated')
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
         status = 'calculated'`,
      [
        runId, emp.employee_id, emp.employee_code,
        att.working_days, att.present_days, att.leave_days, att.lwp_days, att.late_marks, att.dialer_hours,
        calc.gross_salary, grossMonthly, totalDedFinal, netPayFinal,
        calc.basic, calc.hra, calc.special_allowance,
        calc.pf_employee, calc.pf_employer, calc.esic_employee, calc.esic_employer,
        calc.professional_tax, tds_monthly, tds_monthly, lwpDeduction, advanceRecovery,
      ]
    );

    totalGross += calc.gross_salary;
    totalDed   += totalDedFinal;
    totalNet   += netPayFinal;
    processed++;
    process.stdout.write(`\r  Processed ${processed} employees...`);
  }

  await db.execute(
    `UPDATE salary_prep_run SET status = 'processing', total_employees = ?,
            total_gross = ?, total_deductions = ?, total_net = ? WHERE id = ?`,
    [processed, totalGross, totalDed, totalNet, runId]
  );

  return { processed, skipped, totalGross, totalDed, totalNet };
}

async function main() {
  try {
    // Find all open runs for current month
    const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000); // IST
    const runMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    console.log(`\nPayroll Nightly Recalc — Manual Run`);
    console.log(`Run Month: ${runMonth}`);
    console.log('='.repeat(50));

    const [runs] = await db.execute(
      `SELECT id, run_month, status, total_gross, total_net, total_employees, updated_at
         FROM salary_prep_run
        WHERE run_month = ? AND status IN ('draft', 'processing')
        ORDER BY created_at ASC`,
      [runMonth]
    );

    if (!runs.length) {
      console.log(`\nNo open runs found for ${runMonth}.`);
      console.log('Checking if any run exists at all for this month...');
      const [allRuns] = await db.execute(
        `SELECT id, run_month, status, total_gross, total_net, total_employees, updated_at
           FROM salary_prep_run WHERE run_month = ? ORDER BY created_at DESC LIMIT 5`,
        [runMonth]
      );
      if (allRuns.length) {
        console.log('\nExisting runs (non-recalculable status):');
        allRuns.forEach(r => console.log(`  ID: ${r.id}  Status: ${r.status}  Gross: ${r.total_gross}  Net: ${r.total_net}  Updated: ${r.updated_at}`));
      } else {
        console.log('No runs found for this month at all. Please create a payroll run first via the HRMS UI.');
      }
      return;
    }

    for (const run of runs) {
      console.log(`\nRun ID:   ${run.id}`);
      console.log(`Status:   ${run.status}`);
      console.log(`Previous: gross=${run.total_gross}  net=${run.total_net}  employees=${run.total_employees}`);
      console.log(`Last updated: ${run.updated_at}`);
      console.log('\nRecalculating...');

      const result = await calculatePayrollRun(run.id);
      console.log(`\n\n✅ Done!`);
      console.log(`  Employees processed: ${result.processed}`);
      console.log(`  Skipped (salary not started): ${result.skipped}`);
      console.log(`  Total Gross:       ₹${result.totalGross.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
      console.log(`  Total Deductions:  ₹${result.totalDed.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
      console.log(`  Total Net:         ₹${result.totalNet.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
    }

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    if (err.sql) console.error('SQL:', err.sql);
  } finally {
    await db.end();
  }
}

main();
