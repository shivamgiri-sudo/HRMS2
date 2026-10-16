// P&L Full Breakup Apr-Sep 2026 — MAS Callnet only
import mysql from 'mysql2/promise';

const MAS = 'Mas Callnet India Pvt Ltd';

async function main() {
  const db = await mysql.createConnection({
    host: '122.184.128.90',
    user: 'shivam_user',
    password: 'qwersdfg!@#hjk',
    database: 'mas_hrms',
    connectTimeout: 10000,
  });

  // 1. Build CC → branch mapping (MAS Callnet only)
  const [ccRows] = await db.query(
    `SELECT id, bill_source_branch FROM cost_centre_master WHERE company_name = ?`,
    [MAS]
  );
  const ccToBranch = {};
  for (const r of ccRows) ccToBranch[r.id] = r.bill_source_branch;

  // 2. Salary buckets from snapshot (all CCs, filter by known MAS CCs)
  const [salRows] = await db.query(`
    SELECT cost_centre_id, period_code, pnl_bucket,
           COUNT(*) hc, SUM(gross_monthly) gross
    FROM pnl_running_salary_snapshot
    WHERE period_code BETWEEN '2026-04' AND '2026-09'
    GROUP BY cost_centre_id, period_code, pnl_bucket
  `);

  // 3. Revenue from client_invoice (approved, MAS Callnet CCs)
  // Use month_label (service period like 'Apr-26') not invoice_date, because
  // invoices for a given month may be raised weeks later in a different calendar month.
  const MONTH_LABELS = ['Apr-26','May-26','Jun-26','Jul-26','Aug-26','Sep-26'];
  const MONTH_LABEL_TO_PERIOD = {
    'Apr-26':'2026-04','May-26':'2026-05','Jun-26':'2026-06',
    'Jul-26':'2026-07','Aug-26':'2026-08','Sep-26':'2026-09',
  };
  const [revRows] = await db.query(`
    SELECT ci.cost_centre_id,
           ci.month_label,
           SUM(ci.total_amount) revenue
    FROM client_invoice ci
    WHERE ci.invoice_status = 'approved'
      AND ci.month_label IN (${MONTH_LABELS.map(() => '?').join(',')})
    GROUP BY ci.cost_centre_id, ci.month_label
  `, MONTH_LABELS);

  // Pivot into branch × period
  const data = {}; // key = branch|period
  const ensure = (branch, period) => {
    const k = `${branch}|${period}`;
    if (!data[k]) data[k] = { branch, period, revenue: 0, agent_salary: 0, dsc_people: 0, bmc_people: 0 };
    return data[k];
  };

  for (const r of salRows) {
    const branch = ccToBranch[r.cost_centre_id];
    if (!branch) continue; // skip non-MAS CCs
    const row = ensure(branch, r.period_code);
    row[r.pnl_bucket] = (row[r.pnl_bucket] || 0) + Number(r.gross);
  }

  for (const r of revRows) {
    const branch = ccToBranch[r.cost_centre_id];
    if (!branch) continue;
    const period = MONTH_LABEL_TO_PERIOD[r.month_label];
    if (!period) continue;
    ensure(branch, period).revenue += Number(r.revenue);
  }

  await db.end();

  // Sort and print
  const L = v => (Math.round(v / 1000) / 100).toFixed(2); // paise → lakhs
  const periods = ['2026-04','2026-05','2026-06','2026-07','2026-08','2026-09'];
  const branches = [...new Set(Object.values(data).map(r => r.branch))].sort();

  // Branch × period table
  console.log('\n=== P&L BREAKUP — MAS CALLNET — APR to SEP 2026 (₹ Lakhs) ===\n');
  console.log('Branch'.padEnd(28), periods.map(p => p.slice(5)).join('      '));
  console.log('─'.repeat(28 + 8 * 6));

  const totals = { revenue:{}, agent_salary:{}, dsc_people:{}, bmc_people:{}, contribution:{} };
  periods.forEach(p => { totals.revenue[p]=0; totals.agent_salary[p]=0; totals.dsc_people[p]=0; totals.bmc_people[p]=0; totals.contribution[p]=0; });

  for (const branch of branches) {
    const revLine = periods.map(p => {
      const r = data[`${branch}|${p}`];
      if (!r) return '    -   ';
      totals.revenue[p] += r.revenue;
      totals.agent_salary[p] += r.agent_salary;
      totals.dsc_people[p] += r.dsc_people;
      totals.bmc_people[p] += r.bmc_people;
      const contrib = r.revenue - r.agent_salary - r.dsc_people;
      totals.contribution[p] += contrib;
      return L(r.revenue).padStart(7);
    }).join(' ');

    console.log('\n' + branch);
    const row = p => data[`${branch}|${p}`] || {};
    console.log('  Revenue:      ' + periods.map(p => L(row(p).revenue||0).padStart(7)).join(' '));
    console.log('  Agent Salary: ' + periods.map(p => L(row(p).agent_salary||0).padStart(7)).join(' '));
    console.log('  DSC People:   ' + periods.map(p => L(row(p).dsc_people||0).padStart(7)).join(' '));
    console.log('  BMC People:   ' + periods.map(p => L(row(p).bmc_people||0).padStart(7)).join(' '));
    console.log('  Contribution: ' + periods.map(p => {
      const r = row(p);
      return L((r.revenue||0)-(r.agent_salary||0)-(r.dsc_people||0)).padStart(7);
    }).join(' '));
  }

  console.log('\n' + '═'.repeat(80));
  console.log('TOTAL (MAS Callnet)');
  console.log('  Revenue:      ' + periods.map(p => L(totals.revenue[p]).padStart(7)).join(' '));
  console.log('  Agent Salary: ' + periods.map(p => L(totals.agent_salary[p]).padStart(7)).join(' '));
  console.log('  DSC People:   ' + periods.map(p => L(totals.dsc_people[p]).padStart(7)).join(' '));
  console.log('  BMC People:   ' + periods.map(p => L(totals.bmc_people[p]).padStart(7)).join(' '));
  console.log('  Contribution: ' + periods.map(p => L(totals.contribution[p]).padStart(7)).join(' '));
}

main().catch(e => { console.error(e.message); process.exit(1); });
