// P&L Full Breakup Apr-Sep 2026 — MAS Callnet only
import mysql from 'mysql2/promise';

const MAS = 'Mas Callnet India Pvt Ltd';
const MONTH_LABELS = ['Apr-26','May-26','Jun-26','Jul-26','Aug-26','Sep-26'];
const MONTH_LABEL_TO_PERIOD = {
  'Apr-26':'2026-04','May-26':'2026-05','Jun-26':'2026-06',
  'Jul-26':'2026-07','Aug-26':'2026-08','Sep-26':'2026-09',
};
const PERIOD_TO_LABEL = Object.fromEntries(Object.entries(MONTH_LABEL_TO_PERIOD).map(([k,v])=>[v,k]));

async function main() {
  const db = await mysql.createConnection({
    host: '122.184.128.90',
    user: 'shivam_user',
    password: 'qwersdfg!@#hjk',
    database: 'mas_hrms',
    connectTimeout: 30000,
  });

  // 1. Build CC → branch mapping (MAS Callnet only)
  const [ccRows] = await db.query(
    `SELECT id, bill_source_branch FROM cost_centre_master WHERE company_name = ?`,
    [MAS]
  );
  const ccToBranch = {};
  for (const r of ccRows) ccToBranch[r.id] = r.bill_source_branch;
  const masCallnetCCIds = Object.keys(ccToBranch);

  // 2. ACTUAL PAYROLL salary (approved/finalized runs only)
  //    Use salary_prep_line joined to employee's current cost_centre_id for CC classification.
  //    This captures ALL employees paid in that period — including those who have since left.
  const [salRows] = await db.query(`
    SELECT
      spr.run_month                                  AS period_code,
      e.cost_centre_id,
      SUM(COALESCE(spl.net_salary, spl.gross_salary)
          + COALESCE(spl.pf_employer, 0)
          + COALESCE(spl.esic_employer, 0)
          + COALESCE(spl.gratuity, 0)
          + COALESCE(spl.incentive_total, 0))        AS total_cost
    FROM salary_prep_line spl
    JOIN salary_prep_run  spr ON spr.id = spl.run_id
    JOIN employees        e   ON e.id   = spl.employee_id
    WHERE spr.run_month   BETWEEN '2026-04' AND '2026-09'
      AND spr.status      IN ('finalized','FINALIZED','approved','disbursed','locked','draft')
      AND e.cost_centre_id IN (?)
    GROUP BY spr.run_month, e.cost_centre_id
  `, [masCallnetCCIds]);

  // 3. Revenue from client_invoice (approved, MAS Callnet CCs)
  //    Use month_label (service period) not invoice_date.
  //    Exclude is_duplicate=1 entries (billing errors confirmed in db_bill).
  const [revRows] = await db.query(`
    SELECT ci.cost_centre_id,
           ci.month_label,
           SUM(ci.total_amount) revenue
    FROM client_invoice ci
    WHERE ci.invoice_status = 'approved'
      AND ci.is_duplicate   = 0
      AND ci.month_label IN (${MONTH_LABELS.map(() => '?').join(',')})
    GROUP BY ci.cost_centre_id, ci.month_label
  `, MONTH_LABELS);

  // 4. GRN costs by branch and period (MAS Callnet branches only)
  //    grn_entry_snapshot uses branch_name directly (not cost_centre_id).
  //    NEELAKANTH branch closed and is now exclusively MAS Callnet (Oct 2026).
  const MAS_GRN_BRANCHES = ['NOIDA','NOIDA-2','HEAD OFFICE','AHMEDABAD-JALDARSHAN','AHMEDABAD-NEELAKANTH'];
  const [grnData] = await db.query(`
    SELECT
      ges.branch_name    AS branch,
      ges.period_code,
      SUM(ges.amount)    AS grn_cost
    FROM grn_entry_snapshot ges
    WHERE ges.period_code BETWEEN '2026-04' AND '2026-09'
      AND ges.is_rejected = 0
      AND ges.branch_name IN (${MAS_GRN_BRANCHES.map(() => '?').join(',')})
    GROUP BY ges.branch_name, ges.period_code
  `, MAS_GRN_BRANCHES);

  // Pivot into branch × period
  const data = {};
  const ensure = (branch, period) => {
    const k = `${branch}|${period}`;
    if (!data[k]) data[k] = { branch, period, revenue: 0, people_cost: 0, grn_cost: 0 };
    return data[k];
  };

  for (const r of salRows) {
    const branch = ccToBranch[r.cost_centre_id];
    if (!branch) continue;
    ensure(branch, r.period_code).people_cost += Number(r.total_cost);
  }

  for (const r of revRows) {
    const branch = ccToBranch[r.cost_centre_id];
    if (!branch) continue;
    const period = MONTH_LABEL_TO_PERIOD[r.month_label];
    if (!period) continue;
    ensure(branch, period).revenue += Number(r.revenue);
  }

  for (const r of grnData) {
    ensure(r.branch, r.period_code).grn_cost += Number(r.grn_cost);
  }

  await db.end();

  // Sort and print
  const L = v => (Math.round(v / 1000) / 100).toFixed(2);
  const periods = ['2026-04','2026-05','2026-06','2026-07','2026-08','2026-09'];
  const labels  = periods.map(p => PERIOD_TO_LABEL[p]);
  const branches = [...new Set(Object.values(data).map(r => r.branch))].sort();

  console.log('\n=== P&L BREAKUP — MAS CALLNET — APR to SEP 2026 (₹ Lakhs) ===\n');
  console.log('NOTE: Salary = actual payroll (gross + employer PF/ESIC/gratuity + incentives)');
  console.log('NOTE: Revenue = approved client invoices by service month (duplicates excluded)\n');
  console.log('Branch'.padEnd(28), labels.join('     '));
  console.log('─'.repeat(28 + 8 * 6));

  const totals = {};
  periods.forEach(p => { totals[p] = { revenue:0, people_cost:0, grn_cost:0 }; });

  for (const branch of branches) {
    const row = p => data[`${branch}|${p}`] || {};
    console.log('\n' + branch);
    console.log('  Revenue:      ' + periods.map(p => L(row(p).revenue   ||0).padStart(7)).join(' '));
    console.log('  People Cost:  ' + periods.map(p => L(row(p).people_cost||0).padStart(7)).join(' '));
    console.log('  GRN Cost:     ' + periods.map(p => L(row(p).grn_cost  ||0).padStart(7)).join(' '));
    console.log('  Contribution: ' + periods.map(p => {
      const r = row(p);
      return L((r.revenue||0)-(r.people_cost||0)-(r.grn_cost||0)).padStart(7);
    }).join(' '));
    periods.forEach(p => {
      const r = row(p)||{};
      totals[p].revenue     += (r.revenue     ||0);
      totals[p].people_cost += (r.people_cost ||0);
      totals[p].grn_cost    += (r.grn_cost    ||0);
    });
  }

  console.log('\n' + '═'.repeat(80));
  console.log('TOTAL (MAS Callnet)');
  console.log('  Revenue:      ' + periods.map(p => L(totals[p].revenue).padStart(7)).join(' '));
  console.log('  People Cost:  ' + periods.map(p => L(totals[p].people_cost).padStart(7)).join(' '));
  console.log('  GRN Cost:     ' + periods.map(p => L(totals[p].grn_cost).padStart(7)).join(' '));
  console.log('  EBITDA:       ' + periods.map(p => {
    const t = totals[p];
    return L(t.revenue - t.people_cost - t.grn_cost).padStart(7);
  }).join(' '));

  console.log('\n=== GOOGLE SHEET REFERENCE ===');
  const sheetRev = [298.09, 292.75, 294.53, 292.62, 288.19, 276.47];
  const sheetSal = [216.71, 211.74, 214.94, 209.44, 201.45, 198.05];
  const sheetEBIT= [2.43, 2.90, -3.03, 8.19, 11.41, 5.40];
  console.log('  Revenue:      ' + sheetRev.map(v => v.toFixed(2).padStart(7)).join(' '));
  console.log('  Salary:       ' + sheetSal.map(v => v.toFixed(2).padStart(7)).join(' '));
  console.log('  EBITDA:       ' + sheetEBIT.map(v => v.toFixed(2).padStart(7)).join(' '));
  console.log('\n  GRN (sheet):  ' + periods.map((_,i) => {
    const grn = sheetRev[i] - sheetSal[i] - sheetEBIT[i];
    return grn.toFixed(2).padStart(7);
  }).join(' '));

  console.log('\n=== VARIANCE (HRMS − SHEET) ===');
  console.log('  Revenue:      ' + periods.map((p,i) => (totals[p].revenue/1e5 - sheetRev[i]).toFixed(2).padStart(7)).join(' '));
  console.log('  People Cost:  ' + periods.map((p,i) => (totals[p].people_cost/1e5 - sheetSal[i]).toFixed(2).padStart(7)).join(' '));
  console.log('  EBITDA:       ' + periods.map((p,i) => {
    const hrmsEBIT = (totals[p].revenue - totals[p].people_cost - totals[p].grn_cost)/1e5;
    return (hrmsEBIT - sheetEBIT[i]).toFixed(2).padStart(7);
  }).join(' '));
}

main().catch(e => { console.error(e.message); process.exit(1); });
