import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: '122.184.128.90', port: 3306,
  user: 'shivam_user', password: 'qwersdfg!@#hjk',
  database: 'mas_hrms', connectTimeout: 20000
});
const q = async (sql, p=[]) => { const [r] = await conn.query(sql, p); return r; };

// ── Periods (cap at 2026-08 = current, exclude future test data) ─────────
const invP = await q(
  `SELECT period_code, COUNT(*) AS row_cnt, COUNT(DISTINCT cost_centre_source_id) AS cc_cnt
   FROM billing_invoice_particular_snapshot
   WHERE period_code <= '2026-08'
   GROUP BY period_code ORDER BY period_code DESC LIMIT 8`);
console.log('\n=== SOURCE-A invoice periods (real) ==='); console.table(invP);

const top3 = invP.slice(0,3).map(r=>r.period_code);
console.log('Top-3 real periods:', top3);

// ── 1. Revenue by process (SOURCE-A) ────────────────────────────────────
for (const per of top3) {
  const r = await q(
    `SELECT COALESCE(pm.process_name,'[UNMAP]') AS process,
            ROUND(SUM(bip.amount)/100000,2) AS invoice_lakh,
            COUNT(DISTINCT bip.cost_centre_source_id) AS cc_cnt,
            COUNT(*) AS row_cnt
     FROM billing_invoice_particular_snapshot bip
     LEFT JOIN cost_centre_master ccm ON ccm.bill_source_id = bip.cost_centre_source_id
     LEFT JOIN process_master pm ON pm.id = ccm.process_id
     WHERE bip.period_code = ?
     GROUP BY pm.process_name ORDER BY invoice_lakh DESC`, [per]);
  console.log(`\n=== SOURCE-A REVENUE by process — ${per} ===`); console.table(r);
}

// ── 2. Provision SOURCE-B (CCs not in invoice) ───────────────────────────
for (const per of top3) {
  const r = await q(
    `SELECT COALESCE(pm.process_name,'[UNMAP]') AS process,
            ROUND(SUM(bp.provision_amt)/100000,2) AS prov_lakh,
            COUNT(*) AS row_cnt
     FROM billing_provision_snapshot bp
     LEFT JOIN cost_centre_master ccm ON ccm.cost_centre_code = bp.cost_centre_code
     LEFT JOIN process_master pm ON pm.id = ccm.process_id
     WHERE bp.period_code = ?
       AND bp.cost_centre_code NOT IN (
           SELECT DISTINCT cost_centre_code
           FROM billing_invoice_particular_snapshot WHERE period_code=?)
     GROUP BY pm.process_name ORDER BY prov_lakh DESC`, [per, per]);
  console.log(`\n=== SOURCE-B provision-only (non-invoiced CCs) — ${per} ===`); console.table(r);
}

// ── 3. Revenue by cost centre (latest) ───────────────────────────────────
const ccRev = await q(
  `SELECT bip.cost_centre_code,
          COALESCE(ccm.cost_centre_name,'') AS cc_name,
          COALESCE(pm.process_name,'[UNMAP]') AS process,
          ROUND(SUM(bip.amount)/100000,2) AS invoice_lakh,
          COUNT(*) AS row_cnt
   FROM billing_invoice_particular_snapshot bip
   LEFT JOIN cost_centre_master ccm ON ccm.bill_source_id = bip.cost_centre_source_id
   LEFT JOIN process_master pm ON pm.id = ccm.process_id
   WHERE bip.period_code = ?
   GROUP BY bip.cost_centre_code, ccm.cost_centre_name, pm.process_name
   ORDER BY invoice_lakh DESC LIMIT 80`, [top3[0]]);
console.log(`\n=== REVENUE by cost centre — ${top3[0]} ===`); console.table(ccRev);

// ── 4. GRN: net vs gross by process ─────────────────────────────────────
for (const per of top3) {
  const r = await q(
    `SELECT COALESCE(pm.process_name,'[UNMAP]') AS process,
            ROUND(SUM(l.amount)/100000,2)  AS net_lakh,
            ROUND(SUM(l.tax)/100000,2)     AS tax_lakh,
            ROUND(SUM(l.total)/100000,2)   AS gross_lakh,
            ROUND(SUM(l.tax)/NULLIF(SUM(l.amount),0)*100,1) AS tax_pct,
            COUNT(*) AS row_cnt
     FROM grn_entry_line_snapshot l
     JOIN grn_entry_snapshot g ON g.bill_source_id = l.grn_source_id
     LEFT JOIN cost_centre_master ccm ON ccm.bill_source_id = l.cost_centre_source_id
     LEFT JOIN process_master pm ON pm.id = ccm.process_id
     WHERE g.period_code = ?
     GROUP BY pm.process_name ORDER BY net_lakh DESC`, [per]);
  console.log(`\n=== GRN net vs gross by process — ${per} ===`); console.table(r);
}

// ── 5. GRN drill-down: every line (latest, top-60 by value) ─────────────
const grnDrill = await q(
  `SELECT l.cost_centre_code AS cc_code,
          COALESCE(pm.process_name,'[UNMAP]') AS process,
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
   ORDER BY l.amount DESC LIMIT 60`, [top3[0]]);
console.log(`\n=== GRN DRILL-DOWN all lines — ${top3[0]} ===`); console.table(grnDrill);

// ── 6. GRN by cost centre ────────────────────────────────────────────────
const ccGrn = await q(
  `SELECT l.cost_centre_code AS cc_code,
          COALESCE(ccm.cost_centre_name,'') AS cc_name,
          COALESCE(pm.process_name,'[UNMAP]') AS process,
          ROUND(SUM(l.amount)/100000,2)  AS net_lakh,
          ROUND(SUM(l.tax)/100000,2)     AS tax_lakh,
          COUNT(*) AS row_cnt
   FROM grn_entry_line_snapshot l
   JOIN grn_entry_snapshot g ON g.bill_source_id = l.grn_source_id
   LEFT JOIN cost_centre_master ccm ON ccm.bill_source_id = l.cost_centre_source_id
   LEFT JOIN process_master pm ON pm.id = ccm.process_id
   WHERE g.period_code = ?
   GROUP BY l.cost_centre_code, ccm.cost_centre_name, pm.process_name
   ORDER BY net_lakh DESC LIMIT 80`, [top3[0]]);
console.log(`\n=== GRN by cost centre — ${top3[0]} ===`); console.table(ccGrn);

// ── 7. People cost by process (COALESCE process fix) ────────────────────
for (const per of top3) {
  const r = await q(
    `SELECT COALESCE(pm.process_name,'[UNMAP/BMC]') AS process,
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
     WHERE pr.run_month = ?
       AND LOWER(pr.status) IN ('approved','paid','disbursed','finalized','final','completed')
     GROUP BY pm.process_name ORDER BY loaded_lakh DESC`, [per]);
  console.log(`\n=== PEOPLE COST by process — ${per} ===`); console.table(r);
}

// ── 8. People cost by cost centre (latest) ──────────────────────────────
const ccPpl = await q(
  `SELECT ccm.cost_centre_code,
          COALESCE(ccm.cost_centre_name,'') AS cc_name,
          COALESCE(pm.process_name,'[UNMAP/BMC]') AS process,
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
   WHERE pr.run_month = ?
     AND LOWER(pr.status) IN ('approved','paid','disbursed','finalized','final','completed')
   GROUP BY ccm.id, ccm.cost_centre_code, ccm.cost_centre_name, pm.process_name
   ORDER BY pm.process_name, loaded_lakh DESC LIMIT 100`, [top3[0]]);
console.log(`\n=== PEOPLE by cost centre — ${top3[0]} ===`); console.table(ccPpl);

// ── 9. Employees NULL process_id resolved via CCM ───────────────────────
const nullP = await q(
  `SELECT ccm.cost_centre_code,
          COALESCE(ccm.cost_centre_name,'?') AS cc_name,
          COALESCE(pm.process_name,'[NO CCM PROCESS]') AS resolved_process,
          COUNT(e.id) AS emp_count
   FROM employees e
   LEFT JOIN cost_centre_master ccm ON ccm.id = e.cost_centre_id
   LEFT JOIN process_master pm ON pm.id = ccm.process_id
   WHERE e.process_id IS NULL AND e.status='active'
   GROUP BY ccm.id, pm.id ORDER BY emp_count DESC LIMIT 30`);
console.log('\n=== ACTIVE employees with NULL process_id (resolved via CCM) ==='); console.table(nullP);

// ── 10. Employees with NO cost_centre_id (truly unresolvable) ────────────
const noCC = await q(
  `SELECT COUNT(*) AS emp_count_no_cc
   FROM employees WHERE cost_centre_id IS NULL AND status='active'`);
console.log('\n=== Active employees with NO cost_centre_id (unresolvable) ==='); console.table(noCC);

// ── 11. Full waterfall summary (top-3 periods) ───────────────────────────
for (const per of top3) {
  const w = await q(
    `SELECT
       ? AS period,
       ROUND((SELECT SUM(amount) FROM billing_invoice_particular_snapshot WHERE period_code=?)/100000,2) AS A_revenue_lakh,
       ROUND((SELECT SUM(provision_amt) FROM billing_provision_snapshot
              WHERE period_code=? AND cost_centre_code NOT IN (
                SELECT DISTINCT cost_centre_code FROM billing_invoice_particular_snapshot WHERE period_code=?)
             )/100000,2) AS B_provision_only_lakh,
       ROUND((SELECT SUM(l.amount) FROM grn_entry_line_snapshot l
              JOIN grn_entry_snapshot g ON g.bill_source_id=l.grn_source_id WHERE g.period_code=?)/100000,2) AS grn_NET_lakh,
       ROUND((SELECT SUM(l.tax) FROM grn_entry_line_snapshot l
              JOIN grn_entry_snapshot g ON g.bill_source_id=l.grn_source_id WHERE g.period_code=?)/100000,2) AS grn_TAX_lakh,
       ROUND((SELECT SUM(l.total) FROM grn_entry_line_snapshot l
              JOIN grn_entry_snapshot g ON g.bill_source_id=l.grn_source_id WHERE g.period_code=?)/100000,2) AS grn_GROSS_lakh`,
    [per,per,per,per,per,per,per]);
  console.log(`\n=== WATERFALL SUMMARY — ${per} ===`); console.table(w);
}

// ── 12. People cost vs Revenue % ────────────────────────────────────────
const ratios = await q(
  `SELECT pr_agg.period,
          ROUND(pr_agg.ppl_lakh,2) AS people_lakh,
          ROUND(rev_agg.rev_lakh,2) AS revenue_lakh,
          ROUND(pr_agg.ppl_lakh/NULLIF(rev_agg.rev_lakh,0)*100,1) AS people_pct
   FROM (
     SELECT pr.run_month AS period,
            SUM(COALESCE(spl.gross_salary,0)+COALESCE(spl.pf_employer,0)+
                COALESCE(spl.esic_employer,0)+COALESCE(spl.gratuity,COALESCE(spl.basic,0)*0.0481))/100000 AS ppl_lakh
     FROM salary_prep_line spl JOIN salary_prep_run pr ON pr.id=spl.run_id
     WHERE LOWER(pr.status) IN ('approved','paid','disbursed','finalized','final','completed')
       AND pr.run_month IN (?,?,?)
     GROUP BY pr.run_month
   ) pr_agg
   JOIN (
     SELECT period_code AS period, SUM(amount)/100000 AS rev_lakh
     FROM billing_invoice_particular_snapshot WHERE period_code IN (?,?,?)
     GROUP BY period_code
   ) rev_agg ON rev_agg.period = pr_agg.period
   ORDER BY pr_agg.period DESC`, [...top3, ...top3]);
console.log('\n=== PEOPLE vs REVENUE % ==='); console.table(ratios);

await conn.end();
console.log('\n✅ AUDIT COMPLETE');
