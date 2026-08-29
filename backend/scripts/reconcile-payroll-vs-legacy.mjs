/**
 * reconcile-payroll-vs-legacy.mjs
 *
 * Compares db_bill salary register vs mas_hrms salary_prep_line for any month.
 *
 * Usage:
 *   node scripts/reconcile-payroll-vs-legacy.mjs YYYY-MM [RUN_ID]
 *
 * Examples:
 *   node scripts/reconcile-payroll-vs-legacy.mjs 2026-07
 *   node scripts/reconcile-payroll-vs-legacy.mjs 2026-07 93ff8899-5d76-40c8-8144-bace46c378cc
 *
 * Output: ~/Downloads/Payroll_Reconciliation_YYYY-MM.xlsx
 */
import mysql  from 'mysql2/promise';
import ExcelJS from 'exceljs';
import path    from 'path';
import os      from 'os';

const HRMS = { host: '192.168.10.6',  port: 3306, user: 'shivam_user', password: 'qwersdfg!@#hjk', database: 'mas_hrms' };
const BILL = { host: '192.168.10.22', port: 3306, user: 'shivam_user', password: 'qwersdfg!@#hjk', database: 'db_bill'  };

const [,, yearMonth, explicitRunId] = process.argv;
if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
  console.error('Usage: node reconcile-payroll-vs-legacy.mjs YYYY-MM [RUN_ID]');
  process.exit(1);
}
const [year, month] = yearMonth.split('-').map(Number);
const lastDay = new Date(year, month, 0).getDate();
const salDate  = `${yearMonth}-${String(lastDay).padStart(2, '0')}`;

const fmt  = n  => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const d    = (a, b) => Math.round((Number(a || 0) - Number(b || 0)) * 100) / 100;
const BAD  = { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8D7DA' } }, font: { color: { argb: 'FF721C24' }, bold: true } };
const OK   = { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4EDDA' } } };
const HDR  = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }, alignment: { horizontal: 'center' } };

async function run() {
  const hrms = await mysql.createConnection(HRMS);
  const bill = await mysql.createConnection(BILL);

  // Find the payroll run
  let runId = explicitRunId;
  if (!runId) {
    const [[run]] = await hrms.execute(
      `SELECT id, status FROM salary_prep_run
       WHERE YEAR(pay_period_start) = ? AND MONTH(pay_period_start) = ?
         AND status IN ('approved', 'finalized', 'draft')
       ORDER BY FIELD(status, 'finalized', 'approved', 'draft'), created_at DESC
       LIMIT 1`,
      [year, month]
    );
    if (!run) { console.error(`No payroll run found for ${yearMonth}`); process.exit(1); }
    runId = run.id;
    console.log(`[RUN]  Auto-detected run_id ${runId} (${run.status})`);
  } else {
    console.log(`[RUN]  Using explicit run_id ${runId}`);
  }

  // Load HRMS salary lines with component pivot
  console.log('[HRMS] Loading salary_prep_line + components ...');
  const [hrmsLines] = await hrms.execute(
    `SELECT spl.employee_code,
            spl.gross_salary, spl.net_salary,
            spl.pf_employee, spl.esic_employee, spl.tds, spl.professional_tax,
            spl.incentive_total, spl.other_deductions, spl.total_deductions,
            spl.working_days, spl.final_payable_days,
            COALESCE(MAX(CASE WHEN c.component_code='BASIC'       THEN c.amount END), 0) AS basic,
            COALESCE(MAX(CASE WHEN c.component_code='HRA'         THEN c.amount END), 0) AS hra,
            COALESCE(MAX(CASE WHEN c.component_code='BONUS'       THEN c.amount END), 0) AS bonus,
            COALESCE(MAX(CASE WHEN c.component_code='CONV'        THEN c.amount END), 0) AS conv,
            COALESCE(MAX(CASE WHEN c.component_code='PORTFOLIO'   THEN c.amount END), 0) AS portfolio,
            COALESCE(MAX(CASE WHEN c.component_code='MEDICAL'     THEN c.amount END), 0) AS medical,
            COALESCE(MAX(CASE WHEN c.component_code='LTA'         THEN c.amount END), 0) AS lta,
            COALESCE(MAX(CASE WHEN c.component_code='SPECIAL'     THEN c.amount END), 0) AS special,
            COALESCE(MAX(CASE WHEN c.component_code='OTHER_ALLOW' THEN c.amount END), 0) AS other_allow,
            COALESCE(MAX(CASE WHEN c.component_code='PLI'         THEN c.amount END), 0) AS pli,
            COALESCE(MAX(CASE WHEN c.component_code='INCENTIVE'   THEN c.amount END), 0) AS incentive
     FROM salary_prep_line spl
     LEFT JOIN salary_prep_line_component c ON c.line_id = spl.id
     WHERE spl.run_id = ?
     GROUP BY spl.id`,
    [runId]
  );
  const hrmsMap = new Map(hrmsLines.map(r => [r.employee_code, r]));
  console.log(`[HRMS] ${hrmsLines.length} employee lines loaded`);

  // Load db_bill salary data
  console.log('[BILL] Loading salary_data ...');
  const [billLines] = await bill.execute(
    `SELECT EmpCode AS employee_code,
            COALESCE(Basic,0)             AS basic,
            COALESCE(HRA,0)               AS hra,
            COALESCE(Bonus,0)             AS bonus,
            COALESCE(Conv,0)              AS conv,
            COALESCE(Portfolio,0)         AS portfolio,
            COALESCE(MedicalAllowance,0)  AS medical,
            COALESCE(LTA,0)               AS lta,
            COALESCE(SpecialAllowance,0)  AS special,
            COALESCE(OtherAllowance,0)    AS other_allow,
            COALESCE(PLI,0)               AS pli,
            COALESCE(Gross,0)             AS gross,
            COALESCE(ESIC,0)              AS esic,
            COALESCE(EPF,0)               AS pf,
            COALESCE(IncomeTax,0)         AS tds,
            COALESCE(ProTaxDeduction,0)   AS pt,
            COALESCE(Incentive,0)         AS incentive,
            COALESCE(NetSalary,0)         AS net,
            COALESCE(TotalDeduction,0)    AS total_ded,
            COALESCE(WorkingDays,0)       AS working_days,
            COALESCE(EarnedDays,0)        AS earned_days
     FROM salary_data WHERE SalayDate = ?`,
    [salDate]
  );
  console.log(`[BILL] ${billLines.length} employee lines from db_bill for ${salDate}\n`);

  // Build Excel workbook
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HRMS2 Reconciliation';

  // ── Sheet 1: Row-by-row comparison ──────────────────────────────────────
  const ws = wb.addWorksheet('Reconciliation');
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.columns = [
    { header: 'Emp Code',            key: 'code',         width: 12 },
    { header: 'Gross (HRMS)',        key: 'h_gross',      width: 14 },
    { header: 'Gross (Legacy)',      key: 'b_gross',      width: 14 },
    { header: 'Δ Gross',             key: 'd_gross',      width: 10 },
    { header: 'Basic (HRMS)',        key: 'h_basic',      width: 12 },
    { header: 'Basic (Legacy)',      key: 'b_basic',      width: 12 },
    { header: 'Δ Basic',             key: 'd_basic',      width: 10 },
    { header: 'HRA (HRMS)',          key: 'h_hra',        width: 12 },
    { header: 'HRA (Legacy)',        key: 'b_hra',        width: 12 },
    { header: 'Δ HRA',               key: 'd_hra',        width: 10 },
    { header: 'Bonus (HRMS)',        key: 'h_bonus',      width: 12 },
    { header: 'Bonus (Legacy)',      key: 'b_bonus',      width: 12 },
    { header: 'Δ Bonus',             key: 'd_bonus',      width: 10 },
    { header: 'Portfolio (HRMS)',    key: 'h_port',       width: 14 },
    { header: 'Portfolio (Legacy)',  key: 'b_port',       width: 14 },
    { header: 'Δ Portfolio',         key: 'd_port',       width: 10 },
    { header: 'Medical (HRMS)',      key: 'h_med',        width: 12 },
    { header: 'Medical (Legacy)',    key: 'b_med',        width: 12 },
    { header: 'Δ Medical',           key: 'd_med',        width: 10 },
    { header: 'LTA (HRMS)',          key: 'h_lta',        width: 10 },
    { header: 'LTA (Legacy)',        key: 'b_lta',        width: 10 },
    { header: 'Δ LTA',               key: 'd_lta',        width: 10 },
    { header: 'Other Allow (HRMS)',  key: 'h_oth',        width: 14 },
    { header: 'Other Allow (Legacy)',key: 'b_oth',        width: 14 },
    { header: 'Δ Other',             key: 'd_oth',        width: 10 },
    { header: 'PF (HRMS)',           key: 'h_pf',         width: 12 },
    { header: 'PF (Legacy)',         key: 'b_pf',         width: 12 },
    { header: 'Δ PF',                key: 'd_pf',         width: 10 },
    { header: 'ESIC (HRMS)',         key: 'h_esic',       width: 12 },
    { header: 'ESIC (Legacy)',       key: 'b_esic',       width: 12 },
    { header: 'Δ ESIC',              key: 'd_esic',       width: 10 },
    { header: 'Net (HRMS)',          key: 'h_net',        width: 12 },
    { header: 'Net (Legacy)',        key: 'b_net',        width: 12 },
    { header: 'Δ Net',               key: 'd_net',        width: 10 },
    { header: 'Status',              key: 'status',       width: 12 },
  ];
  ws.getRow(1).eachCell(c => Object.assign(c, HDR));
  ws.getRow(1).height = 22;

  let perfectMatch = 0, mismatches = 0, onlyHrms = 0, onlyLegacy = 0;
  const allCodes = new Set([...hrmsMap.keys(), ...billLines.map(r => r.employee_code)]);

  for (const code of allCodes) {
    const h = hrmsMap.get(code);
    const b = billLines.find(r => r.employee_code === code);
    if (!h && b)  { onlyLegacy++; continue; }
    if (h  && !b) { onlyHrms++;   continue; }

    const dGross = d(h.gross_salary, b.gross);
    const dBasic = d(h.basic,        b.basic);
    const dHra   = d(h.hra,          b.hra);
    const dBonus = d(h.bonus,        b.bonus);
    const dPort  = d(h.portfolio,    b.portfolio);
    const dMed   = d(h.medical,      b.medical);
    const dLta   = d(h.lta,         b.lta);
    const dOth   = d(h.other_allow,  b.other_allow);
    const dPf    = d(h.pf_employee,  b.pf);
    const dEsic  = d(h.esic_employee,b.esic);
    const dNet   = d(h.net_salary,   b.net);
    const anyMis = [dGross,dBasic,dHra,dBonus,dPort,dMed,dLta,dOth,dPf,dEsic,dNet]
      .some(v => Math.abs(v) > 0.5);

    if (anyMis) mismatches++; else perfectMatch++;

    const row = ws.addRow({
      code,
      h_gross: fmt(h.gross_salary), b_gross: fmt(b.gross), d_gross: dGross,
      h_basic: fmt(h.basic),        b_basic: fmt(b.basic), d_basic: dBasic,
      h_hra:   fmt(h.hra),          b_hra:   fmt(b.hra),   d_hra:   dHra,
      h_bonus: fmt(h.bonus),        b_bonus: fmt(b.bonus), d_bonus: dBonus,
      h_port:  fmt(h.portfolio),    b_port:  fmt(b.portfolio), d_port: dPort,
      h_med:   fmt(h.medical),      b_med:   fmt(b.medical),   d_med:  dMed,
      h_lta:   fmt(h.lta),          b_lta:   fmt(b.lta),   d_lta:  dLta,
      h_oth:   fmt(h.other_allow),  b_oth:   fmt(b.other_allow), d_oth: dOth,
      h_pf:    fmt(h.pf_employee),  b_pf:    fmt(b.pf),    d_pf:   dPf,
      h_esic:  fmt(h.esic_employee),b_esic:  fmt(b.esic),  d_esic: dEsic,
      h_net:   fmt(h.net_salary),   b_net:   fmt(b.net),   d_net:  dNet,
      status:  anyMis ? 'MISMATCH' : 'MATCH',
    });

    if (anyMis) {
      row.getCell('status').style = BAD;
      for (const key of ['d_gross','d_basic','d_hra','d_bonus','d_port','d_med','d_lta','d_oth','d_pf','d_esic','d_net']) {
        const cell = row.getCell(key);
        if (Math.abs(Number(cell.value)) > 0.5) cell.style = BAD;
      }
    } else {
      row.getCell('status').style = OK;
    }
  }

  // ── Sheet 2: Summary ─────────────────────────────────────────────────────
  const sum = wb.addWorksheet('Summary');
  sum.columns = [{ width: 28 }, { width: 22 }];
  const rows = [
    ['Month',              yearMonth],
    ['Run ID',             runId],
    ['HRMS employees',     hrmsMap.size],
    ['Legacy employees',   billLines.length],
    ['Perfect match',      perfectMatch],
    ['Mismatches',         mismatches],
    ['Only in HRMS',       onlyHrms],
    ['Only in Legacy',     onlyLegacy],
    ['Match %',            hrmsMap.size > 0 ? (perfectMatch / hrmsMap.size * 100).toFixed(1) + '%' : '-'],
  ];
  for (const r of rows) {
    const row = sum.addRow(r);
    row.getCell(1).font = { bold: true };
    if (r[0] === 'Mismatches' && Number(r[1]) > 0) row.getCell(2).style = BAD;
    if (r[0] === 'Match %')   row.getCell(2).font = { bold: true, size: 14 };
  }

  const OUT = path.join(os.homedir(), 'Downloads', `Payroll_Reconciliation_${yearMonth}.xlsx`);
  await wb.xlsx.writeFile(OUT);
  await hrms.end();
  await bill.end();

  console.log(`${'═'.repeat(60)}`);
  console.log(`  RECONCILIATION — ${yearMonth}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Perfect match  : ${perfectMatch}  (${hrmsMap.size > 0 ? (perfectMatch/hrmsMap.size*100).toFixed(1) : 0}%)`);
  console.log(`  Mismatches     : ${mismatches}`);
  console.log(`  Only in HRMS   : ${onlyHrms}`);
  console.log(`  Only in Legacy : ${onlyLegacy}`);
  console.log(`  Saved: ${OUT}`);
  console.log(`${'═'.repeat(60)}`);
  if (mismatches > 0) {
    console.log('\nOpen the Excel file and filter Status=MISMATCH to see remaining gaps.');
    console.log('Common causes:');
    console.log('  • Attendance proration difference (HRMS vs db_bill working days)');
    console.log('  • Deduction in db_bill not yet in HRMS (short_collection, asset_recovery)');
    console.log('  • Employee only paid F&F in db_bill, not in HRMS payroll run');
  }
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
