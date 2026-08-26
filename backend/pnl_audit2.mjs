import mysql from 'mysql2/promise';

// The database password is read from the environment, never written here. This file was one
// of 13 that had it as a source literal; the repository is public and the same value
// authenticates mas_hrms, dialer_db, db_bill and mcn_lms. Pasting it back is exactly what
// backend/src/db/__tests__/no-hardcoded-credentials.contract.test.ts exists to catch.
// Run: node --env-file=backend/.env <this script>
if (!process.env.DB_PASSWORD) {
  throw new Error('DB_PASSWORD is not set. Run with: node --env-file=backend/.env <script>');
}

const conn = await mysql.createConnection({
  host: '122.184.128.90', port: 3306,
  user: 'shivam_user', password: process.env.DB_PASSWORD,
  database: 'mas_hrms', connectTimeout: 15000
});
const q = async (sql, p=[]) => { const [r] = await conn.query(sql, p); return r; };

// ── 0. Check salary_prep_run run_month format + statuses ────────────────
const runInfo = await q(
  `SELECT run_month, status, COUNT(*) cnt
   FROM salary_prep_run
   GROUP BY run_month, status
   ORDER BY run_month DESC LIMIT 20`
);
console.log('\n=== SALARY_PREP_RUN months & statuses ===');
console.table(runInfo);

// ── 1. Available periods in billing snapshots ────────────────────────────
const invPeriods = await q(
  `SELECT period_code, COUNT(*) lines, COUNT(DISTINCT cost_centre_source_id) ccs
   FROM billing_invoice_particular_snapshot
   GROUP BY period_code ORDER BY period_code DESC LIMIT 12`
);
console.log('\n=== SOURCE-A invoice periods ===');
console.table(invPeriods);

const provPeriods = await q(
  `SELECT period_code, COUNT(*) lines, COUNT(DISTINCT cost_centre_code) ccs
   FROM billing_provision_snapshot
   GROUP BY period_code ORDER BY period_code DESC LIMIT 12`
);
console.log('\n=== SOURCE-B provision periods ===');
console.table(provPeriods);

const creditPeriods = await q(
  `SELECT period_code, ROUND(SUM(amount)/100000,2) credit_lakh, COUNT(*) lines
   FROM billing_credit_note_snapshot
   GROUP BY period_code ORDER BY period_code DESC LIMIT 12`
).catch(() => []);
console.log('\n=== SOURCE-C credit notes ===');
console.table(creditPeriods);

// ── pick top-3 invoice periods ────────────────────────────────────────────
const top3 = invPeriods.slice(0,3).map(r => r.period_code);
console.log('\nAuditing periods:', top3);

// ── 2. Revenue by process ────────────────────────────────────────────────
for (const per of top3) {
  // SOURCE-A: invoice
  const invRev = await q(
    `SELECT pm.name AS process,
            ROUND(SUM(bip.amount)/100000,2) AS invoice_lakh,
            COUNT(DISTINCT bip.cost_centre_source_id) AS cc_count,
            COUNT(*) AS lines
     FROM billing_invoice_particular_snapshot bip
     LEFT JOIN cost_centre_master ccm ON ccm.bill_source_id = bip.cost_centre_source_id
     LEFT JOIN process_master pm ON pm.id = ccm.process_id
     WHERE bip.period_code = ?
     GROUP BY pm.name ORDER BY invoice_lakh DESC`, [per]);
  console.log(`\n=== SOURCE-A invoice by process — ${per} ===`);
  console.table(invRev);

  // SOURCE-B: provision for CCs NOT in invoice
  const provRev = await q(
    `SELECT pm.name AS process,
            ROUND(SUM(bp.provision_amt)/100000,2) AS provision_lakh,
            COUNT(*) AS lines
     FROM billing_provision_snapshot bp
     LEFT JOIN cost_centre_master ccm ON ccm.cost_centre_code = bp.cost_centre_code
     LEFT JOIN process_master pm ON pm.id = ccm.process_id
     WHERE bp.period_code = ?
       AND bp.cost_centre_code NOT IN (
         SELECT DISTINCT cost_centre_code
         FROM billing_invoice_particular_snapshot
         WHERE period_code = ?)
     GROUP BY pm.name ORDER BY provision_lakh DESC`, [per, per]);
  console.log(`\n=== SOURCE-B provision (non-invoiced CCs) — ${per} ===`);
  console.table(provRev);
}

// ── 3. GRN net vs gross by process ──────────────────────────────────────
for (const per of top3) {
  const grn = await q(
    `SELECT pm.name AS process,
            ROUND(SUM(l.amount)/100000,2) AS net_lakh,
            ROUND(SUM(l.tax)/100000,2)    AS tax_lakh,
            ROUND(SUM(l.total)/100000,2)  AS gross_lakh,
            ROUND(SUM(l.tax)/NULLIF(SUM(l.amount),0)*100,1) AS tax_pct,
            COUNT(*) AS lines
     FROM grn_entry_line_snapshot l
     JOIN grn_entry_snapshot g ON g.bill_source_id = l.grn_source_id
     LEFT JOIN cost_centre_master ccm ON ccm.bill_source_id = l.cost_centre_source_id
     LEFT JOIN process_master pm ON pm.id = ccm.process_id
     WHERE g.period_code = ?
     GROUP BY pm.name ORDER BY net_lakh DESC`, [per]);
  console.log(`\n=== GRN net vs gross by process — ${per} ===`);
  console.table(grn);
}

// ── 4. GRN drill-down lines (latest period) ──────────────────────────────
const grnLines = await q(
  `SELECT l.cost_centre_code AS cc_code,
          pm.name AS process,
          g.vendor AS vendor,
          g.grn_no,
          ROUND(l.amount,2) AS net,
          ROUND(l.tax,2) AS tax,
          ROUND(l.total,2) AS gross,
          SUBSTRING(l.particular,1,60) AS particular
   FROM grn_entry_line_snapshot l
   JOIN grn_entry_snapshot g ON g.bill_source_id = l.grn_source_id
   LEFT JOIN cost_centre_master ccm ON ccm.bill_source_id = l.cost_centre_source_id
   LEFT JOIN process_master pm ON pm.id = ccm.process_id
   WHERE g.period_code = ?
   ORDER BY l.amount DESC LIMIT 60`, [top3[0]]
);
console.log(`\n=== GRN DRILL-DOWN lines — ${top3[0]} ===`);
console.table(grnLines);

// ── 5. People cost by process (COALESCE fix) ─────────────────────────────
for (const per of top3) {
  const ppl = await q(
    `SELECT pm.name AS process,
            COUNT(DISTINCT e.id) AS headcount,
            ROUND(SUM(
              COALESCE(spl.gross_salary,0)+COALESCE(spl.pf_employer,0)+
              COALESCE(spl.esic_employer,0)+COALESCE(spl.gratuity,COALESCE(spl.basic,0)*0.0481)
            )/100000,2) AS loaded_lakh
     FROM salary_prep_line spl
     JOIN employees e ON e.id = spl.employee_id
     LEFT JOIN cost_centre_master ccm ON ccm.id = e.cost_centre_id
     LEFT JOIN process_master pm ON pm.id = COALESCE(e.process_id, ccm.process_id)
     JOIN salary_prep_run pr ON pr.id = spl.run_id
     WHERE DATE_FORMAT(pr.run_month,'%Y-%m') = ?
       AND pr.status IN ('approved','paid','disbursed','finalized','final','completed')
     GROUP BY pm.name ORDER BY loaded_lakh DESC`, [per]);
  console.log(`\n=== PEOPLE COST by process — ${per} ===`);
  console.table(ppl);
}

// ── 6. People cost by cost centre (latest, variance view) ────────────────
const ccPpl = await q(
  `SELECT ccm.cost_centre_code AS cc_code,
          ccm.cost_centre_name AS cc_name,
          pm.name AS process,
          COUNT(DISTINCT e.id) AS headcount,
          ROUND(SUM(
            COALESCE(spl.gross_salary,0)+COALESCE(spl.pf_employer,0)+
            COALESCE(spl.esic_employer,0)+COALESCE(spl.gratuity,COALESCE(spl.basic,0)*0.0481)
          )/100000,2) AS loaded_lakh
   FROM salary_prep_line spl
   JOIN employees e ON e.id = spl.employee_id
   LEFT JOIN cost_centre_master ccm ON ccm.id = e.cost_centre_id
   LEFT JOIN process_master pm ON pm.id = COALESCE(e.process_id, ccm.process_id)
   JOIN salary_prep_run pr ON pr.id = spl.run_id
   WHERE DATE_FORMAT(pr.run_month,'%Y-%m') = ?
     AND pr.status IN ('approved','paid','disbursed','finalized','final','completed')
   GROUP BY ccm.id, ccm.cost_centre_code, ccm.cost_centre_name, pm.name
   ORDER BY pm.name, loaded_lakh DESC LIMIT 100`, [top3[0]]
);
console.log(`\n=== PEOPLE by cost centre — ${top3[0]} ===`);
console.table(ccPpl);

// ── 7. Revenue by cost centre (latest period) ────────────────────────────
const ccRev = await q(
  `SELECT bip.cost_centre_code,
          ccm.cost_centre_name AS cc_name,
          pm.name AS process,
          ROUND(SUM(bip.amount)/100000,2) AS invoice_lakh,
          COUNT(*) AS lines
   FROM billing_invoice_particular_snapshot bip
   LEFT JOIN cost_centre_master ccm ON ccm.bill_source_id = bip.cost_centre_source_id
   LEFT JOIN process_master pm ON pm.id = ccm.process_id
   WHERE bip.period_code = ?
   GROUP BY bip.cost_centre_code, ccm.cost_centre_name, pm.name
   ORDER BY invoice_lakh DESC LIMIT 80`, [top3[0]]
);
console.log(`\n=== REVENUE by cost centre — ${top3[0]} ===`);
console.table(ccRev);

// ── 8. Employees with NULL process_id resolved via CCM ───────────────────
const nullProc = await q(
  `SELECT ccm.cost_centre_code,
          ccm.cost_centre_name AS cc_name,
          pm.name AS resolved_process,
          COUNT(e.id) AS emp_count
   FROM employees e
   LEFT JOIN cost_centre_master ccm ON ccm.id = e.cost_centre_id
   LEFT JOIN process_master pm ON pm.id = ccm.process_id
   WHERE e.process_id IS NULL AND e.status='active'
   GROUP BY ccm.id, pm.id
   ORDER BY emp_count DESC LIMIT 30`
);
console.log('\n=== NULL process_id employees resolved via CCM ===');
console.table(nullProc);

// ── 9. P&L waterfall summary (top-3 periods) ─────────────────────────────
for (const per of top3) {
  const wf = await q(
    `SELECT
       ? AS period,
       ROUND((SELECT SUM(amount) FROM billing_invoice_particular_snapshot WHERE period_code=?)/100000,2) AS A_invoice_lakh,
       ROUND((SELECT SUM(provision_amt) FROM billing_provision_snapshot bp
              WHERE bp.period_code=?
              AND bp.cost_centre_code NOT IN (
                SELECT DISTINCT cost_centre_code FROM billing_invoice_particular_snapshot WHERE period_code=?)
             )/100000,2) AS B_provision_only_lakh,
       ROUND((SELECT SUM(l.amount) FROM grn_entry_line_snapshot l
              JOIN grn_entry_snapshot g ON g.bill_source_id=l.grn_source_id
              WHERE g.period_code=?)/100000,2) AS grn_net_lakh,
       ROUND((SELECT SUM(l.tax) FROM grn_entry_line_snapshot l
              JOIN grn_entry_snapshot g ON g.bill_source_id=l.grn_source_id
              WHERE g.period_code=?)/100000,2) AS grn_tax_lakh,
       ROUND((SELECT SUM(l.total) FROM grn_entry_line_snapshot l
              JOIN grn_entry_snapshot g ON g.bill_source_id=l.grn_source_id
              WHERE g.period_code=?)/100000,2) AS grn_gross_lakh`,
    [per, per, per, per, per, per, per]
  );
  console.log(`\n=== P&L WATERFALL — ${per} ===`);
  console.table(wf);
}

// ── 10. People cost vs revenue % (latest 3 periods) ─────────────────────
const ratios = await q(
  `SELECT
     pr_agg.period,
     ROUND(pr_agg.people_lakh,2) AS people_lakh,
     ROUND(rev_agg.revenue_lakh,2) AS revenue_lakh,
     ROUND(pr_agg.people_lakh / NULLIF(rev_agg.revenue_lakh,0) * 100,1) AS people_pct
   FROM (
     SELECT DATE_FORMAT(pr.run_month,'%Y-%m') AS period,
            SUM(COALESCE(spl.gross_salary,0)+COALESCE(spl.pf_employer,0)+
                COALESCE(spl.esic_employer,0)+COALESCE(spl.gratuity,COALESCE(spl.basic,0)*0.0481)
               )/100000 AS people_lakh
     FROM salary_prep_line spl
     JOIN salary_prep_run pr ON pr.id = spl.run_id
     WHERE pr.status IN ('approved','paid','disbursed','finalized','final','completed')
       AND DATE_FORMAT(pr.run_month,'%Y-%m') IN (?,?,?)
     GROUP BY period
   ) pr_agg
   JOIN (
     SELECT period_code AS period, SUM(amount)/100000 AS revenue_lakh
     FROM billing_invoice_particular_snapshot
     WHERE period_code IN (?,?,?)
     GROUP BY period_code
   ) rev_agg ON rev_agg.period = pr_agg.period
   ORDER BY pr_agg.period DESC`,
  [...top3, ...top3]
);
console.log('\n=== PEOPLE COST vs REVENUE ratio ===');
console.table(ratios);

await conn.end();
console.log('\n✅ AUDIT COMPLETE');
