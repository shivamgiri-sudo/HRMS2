/**
 * FULL DATA RECONCILIATION AUDIT
 * Verifies DB numbers vs what the P&L service computes, per branch, per cost centre,
 * for all months Apr–Jul 2026. Drill-down on every major line item.
 */
import mysql from './node_modules/mysql2/promise.js';

const db = await mysql.createConnection({
  host: '122.184.128.90', port: 3306,
  user: 'shivam_user', password: 'qwersdfg!@#hjk',
  database: 'mas_hrms', multipleStatements: false
});

const MONTHS = ['2026-04','2026-05','2026-06','2026-07'];
const fmt = n => {
  const v = Number(n ?? 0);
  if (Math.abs(v) >= 100000) return `₹${(v/100000).toFixed(2)}L`;
  return `₹${v.toFixed(0)}`;
};
const sep = (label) => console.log(`\n${'═'.repeat(80)}\n  ${label}\n${'═'.repeat(80)}`);
const sub = (label) => console.log(`\n  ── ${label} ──`);

// ── 1. BRANCHES ──────────────────────────────────────────────────────────────
sep('1. BRANCH MASTER');
const [branches] = await db.execute(`SELECT id, branch_name FROM branch_master ORDER BY branch_name`);
console.log(`Total branches: ${branches.length}`);
branches.forEach(b => console.log(`  [${b.id}] ${b.branch_name}`));

// ── 2. REVENUE SUMMARY: ALL MONTHS × ALL BRANCHES ────────────────────────────
sep('2. REVENUE BY BRANCH × MONTH (DB SOURCE)');
console.log('\n  SOURCE A — Invoice lines (billing_invoice_particular_snapshot)');
const [invByBranchMonth] = await db.execute(`
  SELECT p.period_code, ccm.branch_id, bm.branch_name,
         COUNT(DISTINCT p.cost_centre_code) cc_cnt,
         COUNT(*) line_cnt,
         SUM(p.amount) total_amount
  FROM billing_invoice_particular_snapshot p
  LEFT JOIN cost_centre_master ccm
         ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci = p.cost_centre_code COLLATE utf8mb4_unicode_ci
  LEFT JOIN branch_master bm ON bm.id = ccm.branch_id
  WHERE p.period_code IN ('2026-04','2026-05','2026-06','2026-07')
    AND REPLACE(REPLACE(REPLACE(LOWER(COALESCE(ccm.company_name,'')),'.',''),' ',''),',','') LIKE '%mascallnet%'
  GROUP BY p.period_code, ccm.branch_id, bm.branch_name
  ORDER BY p.period_code, bm.branch_name
`);
let prevMonth = '';
for (const r of invByBranchMonth) {
  if (r.period_code !== prevMonth) { console.log(`\n  ${r.period_code}`); prevMonth = r.period_code; }
  console.log(`    ${String(r.branch_name ?? 'NULL-branch').padEnd(30)} CCs:${String(r.cc_cnt).padStart(4)}  Lines:${String(r.line_cnt).padStart(5)}  Revenue: ${fmt(r.total_amount)}`);
}

console.log('\n  SOURCE B — Provision shortfall (CCs with NO invoice this period)');
const [provShortfall] = await db.execute(`
  SELECT ps.period_code, ccm.branch_id, bm.branch_name,
         COUNT(DISTINCT ps.cost_centre_code) cc_cnt,
         SUM(CASE WHEN ps.billing_amt > 0 THEN ps.billing_amt ELSE ps.provision_amt END) prov_amount
  FROM billing_provision_snapshot ps
  LEFT JOIN cost_centre_master ccm
         ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci = ps.cost_centre_code COLLATE utf8mb4_unicode_ci
  LEFT JOIN branch_master bm ON bm.id = ccm.branch_id
  WHERE ps.period_code IN ('2026-04','2026-05','2026-06','2026-07')
    AND ps.revenue_active = 1
    AND REPLACE(REPLACE(REPLACE(LOWER(COALESCE(ccm.company_name,'')),'.',''),' ',''),',','') LIKE '%mascallnet%'
    AND ps.cost_centre_code COLLATE utf8mb4_unicode_ci NOT IN (
      SELECT p2.cost_centre_code COLLATE utf8mb4_unicode_ci
      FROM billing_invoice_particular_snapshot p2
      WHERE p2.period_code = ps.period_code COLLATE utf8mb4_unicode_ci
    )
  GROUP BY ps.period_code, ccm.branch_id, bm.branch_name
  ORDER BY ps.period_code, bm.branch_name
`);
prevMonth = '';
for (const r of provShortfall) {
  if (r.period_code !== prevMonth) { console.log(`\n  ${r.period_code}`); prevMonth = r.period_code; }
  console.log(`    ${String(r.branch_name ?? 'NULL-branch').padEnd(30)} CCs:${String(r.cc_cnt).padStart(4)}  Provision: ${fmt(r.prov_amount)}`);
}

console.log('\n  SOURCE C — Credit notes');
const [credits] = await db.execute(`
  SELECT cn.period_code, ccm.branch_id, bm.branch_name,
         COUNT(*) cnt, SUM(cn.total_amt) total_credit
  FROM billing_credit_note_snapshot cn
  LEFT JOIN cost_centre_master ccm
         ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci = cn.cost_centre_code COLLATE utf8mb4_unicode_ci
  LEFT JOIN branch_master bm ON bm.id = ccm.branch_id
  WHERE cn.period_code IN ('2026-04','2026-05','2026-06','2026-07') AND cn.is_approved = 1
    AND REPLACE(REPLACE(REPLACE(LOWER(COALESCE(ccm.company_name,'')),'.',''),' ',''),',','') LIKE '%mascallnet%'
  GROUP BY cn.period_code, ccm.branch_id, bm.branch_name
  ORDER BY cn.period_code, bm.branch_name
`);
prevMonth = '';
for (const r of credits) {
  if (r.period_code !== prevMonth) { console.log(`\n  ${r.period_code}`); prevMonth = r.period_code; }
  console.log(`    ${String(r.branch_name ?? 'NULL-branch').padEnd(30)} Notes:${String(r.cnt).padStart(4)}  Credit: ${fmt(r.total_credit)}`);
}

// ── 3. REVENUE GRAND TOTALS PER MONTH ────────────────────────────────────────
sep('3. REVENUE GRAND TOTALS BY MONTH (Net = Invoice + Provision - Credits)');
const invTotals = {}, provTotals = {}, creditTotals = {};
for (const r of invByBranchMonth) invTotals[r.period_code] = (invTotals[r.period_code]||0) + Number(r.total_amount||0);
for (const r of provShortfall) provTotals[r.period_code] = (provTotals[r.period_code]||0) + Number(r.prov_amount||0);
for (const r of credits) creditTotals[r.period_code] = (creditTotals[r.period_code]||0) + Number(r.total_credit||0);
for (const m of MONTHS) {
  const inv = invTotals[m]||0, prov = provTotals[m]||0, cred = creditTotals[m]||0;
  console.log(`  ${m}  Invoice: ${fmt(inv).padStart(12)}  +Provision: ${fmt(prov).padStart(12)}  -Credits: ${fmt(cred).padStart(10)}  = NET: ${fmt(inv+prov-cred).padStart(12)}`);
}

// ── 4. GRN INDIRECT COST BY BRANCH × MONTH ───────────────────────────────────
sep('4. GRN INDIRECT COST BY BRANCH × MONTH (l.amount = net of GST)');
const [grnByBranch] = await db.execute(`
  SELECT g.period_code, ccm.branch_id, bm.branch_name,
         COUNT(DISTINCT l.cost_centre_code) cc_cnt,
         COUNT(*) line_cnt,
         SUM(l.amount) net_amount,
         SUM(l.tax) tax_amount,
         SUM(l.total) total_with_gst
  FROM grn_entry_line_snapshot l
  JOIN grn_entry_snapshot g ON g.bill_source_id = l.grn_source_id
  LEFT JOIN cost_centre_master ccm
         ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci = l.cost_centre_code COLLATE utf8mb4_unicode_ci
  LEFT JOIN branch_master bm ON bm.id = ccm.branch_id
  WHERE g.period_code IN ('2026-04','2026-05','2026-06','2026-07') AND g.is_rejected = 0
    AND REPLACE(REPLACE(REPLACE(LOWER(COALESCE(ccm.company_name,'')),'.',''),' ',''),',','') LIKE '%mascallnet%'
  GROUP BY g.period_code, ccm.branch_id, bm.branch_name
  ORDER BY g.period_code, bm.branch_name
`);
prevMonth = '';
for (const r of grnByBranch) {
  if (r.period_code !== prevMonth) { console.log(`\n  ${r.period_code}`); prevMonth = r.period_code; }
  const overstate = Number(r.total_with_gst||0) - Number(r.net_amount||0);
  console.log(`    ${String(r.branch_name ?? 'NULL-branch').padEnd(30)} CCs:${String(r.cc_cnt).padStart(4)}  Net(ex-GST): ${fmt(r.net_amount).padStart(12)}  GST: ${fmt(r.tax_amount).padStart(10)}  (old total would overstate by ${fmt(overstate)})`);
}

console.log('\n  GRN Grand Totals:');
const grnTotals = {};
for (const r of grnByBranch) {
  if (!grnTotals[r.period_code]) grnTotals[r.period_code] = {net:0, tax:0, total:0};
  grnTotals[r.period_code].net += Number(r.net_amount||0);
  grnTotals[r.period_code].tax += Number(r.tax_amount||0);
  grnTotals[r.period_code].total += Number(r.total_with_gst||0);
}
for (const m of MONTHS) {
  const g = grnTotals[m] || {net:0,tax:0,total:0};
  console.log(`  ${m}  Net(correct): ${fmt(g.net).padStart(12)}  GST: ${fmt(g.tax).padStart(10)}  Old(wrong): ${fmt(g.total).padStart(12)}  Overstatement fixed: ${fmt(g.total-g.net)}`);
}

// ── 5. PEOPLE COST BY BRANCH × MONTH ─────────────────────────────────────────
sep('5. PEOPLE COST (SALARY) BY BRANCH × MONTH');
const [peopleByBranch] = await db.execute(`
  SELECT r.run_month, bm.id branch_id, bm.branch_name, r.status run_status,
         COUNT(DISTINCT l.employee_id) headcount,
         SUM(l.gross_salary) gross,
         SUM(COALESCE(l.pf_employer,0)) pf_er,
         SUM(COALESCE(l.esic_employer,0)) esic_er,
         SUM(COALESCE(l.gratuity,0)) gratuity,
         SUM(l.gross_salary + COALESCE(l.pf_employer,0) + COALESCE(l.esic_employer,0) + COALESCE(l.gratuity,0)) total_loaded
  FROM salary_prep_line l
  JOIN salary_prep_run r ON r.id = l.run_id
  JOIN employees e ON e.id = l.employee_id
  LEFT JOIN branch_master bm ON bm.id = e.branch_id
  WHERE r.run_month IN ('2026-04','2026-05','2026-06','2026-07')
  GROUP BY r.run_month, bm.id, bm.branch_name, r.status
  ORDER BY r.run_month, bm.branch_name
`);
prevMonth = '';
for (const r of peopleByBranch) {
  if (r.run_month !== prevMonth) { console.log(`\n  ${r.run_month}`); prevMonth = r.run_month; }
  console.log(`    ${String(r.branch_name ?? 'NULL-branch').padEnd(30)} HC:${String(r.headcount).padStart(5)}  Gross:${fmt(r.gross).padStart(12)}  PF-er:${fmt(r.pf_er).padStart(10)}  ESIC:${fmt(r.esic_er).padStart(10)}  Loaded:${fmt(r.total_loaded).padStart(12)}  [${r.run_status}]`);
}

console.log('\n  People Cost Grand Totals:');
const peopleTotals = {};
for (const r of peopleByBranch) {
  if (!peopleTotals[r.run_month]) peopleTotals[r.run_month] = {hc:0, loaded:0, status: r.run_status};
  peopleTotals[r.run_month].hc += Number(r.headcount||0);
  peopleTotals[r.run_month].loaded += Number(r.total_loaded||0);
}
for (const m of MONTHS) {
  const p = peopleTotals[m] || {hc:0, loaded:0, status:'NO RUN'};
  console.log(`  ${m}  Headcount: ${String(p.hc).padStart(6)}  Loaded Cost: ${fmt(p.loaded).padStart(12)}  Status: ${p.status}`);
}

// ── 6. PER-COST-CENTRE DRILL-DOWN FOR JULY 2026 ───────────────────────────────
sep('6. COST CENTRE DRILL-DOWN — JULY 2026 (top 30 by revenue)');
const [ccDrillRev] = await db.execute(`
  SELECT p.cost_centre_code, ccm.cost_centre_name, ccm.branch_id, bm.branch_name,
         SUM(p.amount) revenue
  FROM billing_invoice_particular_snapshot p
  LEFT JOIN cost_centre_master ccm ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci = p.cost_centre_code COLLATE utf8mb4_unicode_ci
  LEFT JOIN branch_master bm ON bm.id = ccm.branch_id
  WHERE p.period_code = '2026-07'
    AND REPLACE(REPLACE(REPLACE(LOWER(COALESCE(ccm.company_name,'')),'.',''),' ',''),',','') LIKE '%mascallnet%'
  GROUP BY p.cost_centre_code, ccm.cost_centre_name, ccm.branch_id, bm.branch_name
  ORDER BY revenue DESC
  LIMIT 30
`);
console.log(`\n  ${'CC Code'.padEnd(20)} ${'CC Name'.padEnd(35)} ${'Branch'.padEnd(25)} Revenue`);
console.log(`  ${'-'.repeat(100)}`);
for (const r of ccDrillRev) {
  console.log(`  ${String(r.cost_centre_code||'').padEnd(20)} ${String(r.cost_centre_name||'').padEnd(35)} ${String(r.branch_name||'NULL').padEnd(25)} ${fmt(r.revenue)}`);
}

// ── 7. COST CENTRES WITH NULL PROCESS_ID (revenue unallocated to any process) ─
sep('7. REVENUE UNALLOCATED TO PROCESS (NULL process_id in cost_centre_master) — JULY 2026');
const [nullProcCCs] = await db.execute(`
  SELECT p.cost_centre_code, ccm.cost_centre_name, bm.branch_name,
         SUM(p.amount) revenue
  FROM billing_invoice_particular_snapshot p
  LEFT JOIN cost_centre_master ccm ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci = p.cost_centre_code COLLATE utf8mb4_unicode_ci
  LEFT JOIN branch_master bm ON bm.id = ccm.branch_id
  WHERE p.period_code = '2026-07'
    AND ccm.process_id IS NULL
    AND REPLACE(REPLACE(REPLACE(LOWER(COALESCE(ccm.company_name,'')),'.',''),' ',''),',','') LIKE '%mascallnet%'
  GROUP BY p.cost_centre_code, ccm.cost_centre_name, bm.branch_name
  ORDER BY revenue DESC
`);
let nullTotal = 0;
for (const r of nullProcCCs) nullTotal += Number(r.revenue||0);
const [allRevJul] = await db.execute(`SELECT SUM(p.amount) tot FROM billing_invoice_particular_snapshot p LEFT JOIN cost_centre_master ccm ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci = p.cost_centre_code COLLATE utf8mb4_unicode_ci WHERE p.period_code='2026-07' AND REPLACE(REPLACE(REPLACE(LOWER(COALESCE(ccm.company_name,'')),'.',''),' ',''),',','') LIKE '%mascallnet%'`);
const totalRevJul = Number(allRevJul[0]?.tot||0);
console.log(`\n  Total Jul revenue: ${fmt(totalRevJul)}   Unallocated to process: ${fmt(nullTotal)} (${(nullTotal/totalRevJul*100).toFixed(1)}%)`);
console.log(`  These cost centres have invoice revenue but ccm.process_id IS NULL — P&L process rows get ₹0 revenue for them.\n`);
console.log(`  ${'CC Code'.padEnd(20)} ${'CC Name'.padEnd(35)} ${'Branch'.padEnd(25)} Revenue`);
console.log(`  ${'-'.repeat(100)}`);
for (const r of nullProcCCs) {
  console.log(`  ${String(r.cost_centre_code||'').padEnd(20)} ${String(r.cost_centre_name||'').padEnd(35)} ${String(r.branch_name||'NULL').padEnd(25)} ${fmt(r.revenue)}`);
}

// ── 8. GRN DRILL-DOWN — TOP 20 LINES JULY 2026 ───────────────────────────────
sep('8. GRN LINE DRILL-DOWN — TOP 20 LINES JULY 2026');
const [grnLines] = await db.execute(`
  SELECT l.particular, l.entry_type, l.cost_centre_code, ccm.cost_centre_name,
         bm.branch_name, l.amount net_amount, l.tax, l.total total_with_gst
  FROM grn_entry_line_snapshot l
  JOIN grn_entry_snapshot g ON g.bill_source_id = l.grn_source_id
  LEFT JOIN cost_centre_master ccm ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci = l.cost_centre_code COLLATE utf8mb4_unicode_ci
  LEFT JOIN branch_master bm ON bm.id = ccm.branch_id
  WHERE g.period_code = '2026-07' AND g.is_rejected = 0
    AND REPLACE(REPLACE(REPLACE(LOWER(COALESCE(ccm.company_name,'')),'.',''),' ',''),',','') LIKE '%mascallnet%'
  ORDER BY l.amount DESC
  LIMIT 20
`);
console.log(`  ${'Particular'.padEnd(35)} ${'Type'.padEnd(15)} ${'Branch'.padEnd(25)} Net(ex-GST)  GST        Total`);
console.log(`  ${'-'.repeat(110)}`);
for (const r of grnLines) {
  console.log(`  ${String(r.particular||'').substring(0,35).padEnd(35)} ${String(r.entry_type||'').padEnd(15)} ${String(r.branch_name||'NULL').padEnd(25)} ${fmt(r.net_amount).padStart(11)} ${fmt(r.tax).padStart(10)} ${fmt(r.total_with_gst).padStart(10)}`);
}

// ── 9. SALARY DRILL-DOWN — TOP 20 EMPLOYEES BY LOADED COST JULY 2026 ─────────
sep('9. SALARY DRILL-DOWN — TOP 20 EMPLOYEES BY LOADED COST JULY 2026');
const [salLines] = await db.execute(`
  SELECT e.employee_code, e.full_name, e.cost_center_code, bm.branch_name,
         pm.process_name,
         l.gross_salary, COALESCE(l.pf_employer,0) pf_er, COALESCE(l.esic_employer,0) esic_er,
         (l.gross_salary + COALESCE(l.pf_employer,0) + COALESCE(l.esic_employer,0)) loaded
  FROM salary_prep_line l
  JOIN salary_prep_run r ON r.id = l.run_id
  JOIN employees e ON e.id = l.employee_id
  LEFT JOIN branch_master bm ON bm.id = e.branch_id
  LEFT JOIN process_master pm ON pm.id = e.process_id
  WHERE r.run_month = '2026-07'
  ORDER BY loaded DESC
  LIMIT 20
`);
console.log(`  ${'Code'.padEnd(12)} ${'Name'.padEnd(30)} ${'Branch'.padEnd(20)} ${'Process'.padEnd(20)} Gross       PF-er     ESIC      Loaded`);
console.log(`  ${'-'.repeat(125)}`);
for (const r of salLines) {
  console.log(`  ${String(r.employee_code||'').padEnd(12)} ${String(r.full_name||'').substring(0,30).padEnd(30)} ${String(r.branch_name||'').padEnd(20)} ${String(r.process_name||'NULL').substring(0,20).padEnd(20)} ${fmt(r.gross_salary).padStart(10)} ${fmt(r.pf_er).padStart(9)} ${fmt(r.esic_er).padStart(9)} ${fmt(r.loaded).padStart(10)}`);
}

// ── 10. MONTH-OVER-MONTH SUMMARY (P&L WATERFALL) ─────────────────────────────
sep('10. MONTH-OVER-MONTH P&L WATERFALL SUMMARY');
console.log(`  ${'Month'.padEnd(10)} ${'Revenue'.padStart(14)} ${'People Cost'.padStart(14)} ${'GRN Cost'.padStart(12)} ${'Gross Profit'.padStart(14)} ${'GP%'.padStart(7)} ${'Payroll Status'}`);
console.log(`  ${'-'.repeat(95)}`);
for (const m of MONTHS) {
  const rev = (invTotals[m]||0) + (provTotals[m]||0) - (creditTotals[m]||0);
  const grn = grnTotals[m]?.net || 0;
  const ppl = peopleTotals[m]?.loaded || 0;
  const gp = rev - ppl - grn;
  const gpPct = rev > 0 ? (gp/rev*100).toFixed(1) : 'N/A';
  const status = peopleTotals[m]?.status || 'NO RUN';
  console.log(`  ${m.padEnd(10)} ${fmt(rev).padStart(14)} ${fmt(ppl).padStart(14)} ${fmt(grn).padStart(12)} ${fmt(gp).padStart(14)} ${String(gpPct+'%').padStart(7)} ${status}`);
}

// ── 11. DATA QUALITY: EMPLOYEES WITHOUT COST CENTRE OR PROCESS ───────────────
sep('11. DATA QUALITY GAPS');
const [empGaps] = await db.execute(`
  SELECT
    SUM(CASE WHEN cost_centre_id IS NULL THEN 1 ELSE 0 END) no_cc,
    SUM(CASE WHEN process_id IS NULL THEN 1 ELSE 0 END) no_proc,
    SUM(CASE WHEN cost_centre_id IS NULL AND process_id IS NULL THEN 1 ELSE 0 END) neither,
    COUNT(*) total
  FROM employees WHERE employment_status = 'active'
`);
const eg = empGaps[0];
console.log(`\n  Active employees: ${eg.total}`);
console.log(`  Without cost_centre_id: ${eg.no_cc} (${(eg.no_cc/eg.total*100).toFixed(1)}%) — people cost may not map to correct CC`);
console.log(`  Without process_id: ${eg.no_proc} (${(eg.no_proc/eg.total*100).toFixed(1)}%) — will rely on CCM join for process attribution`);
console.log(`  Without either: ${eg.neither} (${(eg.neither/eg.total*100).toFixed(1)}%)`);

const [ccNullProc] = await db.execute(`SELECT COUNT(*) cnt FROM cost_centre_master WHERE process_id IS NULL AND active_status = 1`);
console.log(`\n  Active cost centres with NULL process_id: ${ccNullProc[0].cnt} — revenue on these CCs is unallocated to any process row`);

await db.end();
console.log('\n\nAUDIT COMPLETE.\n');
