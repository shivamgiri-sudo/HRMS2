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
  host:'122.184.128.90',port:3306,user:'shivam_user',
  password:process.env.DB_PASSWORD,database:'mas_hrms',connectTimeout:20000
});
const q=async(sql,p=[])=>{const[r]=await conn.query(sql,p);return r;};
const P=['2026-08','2026-07','2026-06'];

// SOURCE-B provision (bill_source_id join — avoids collation mismatch)
for(const per of P){
  const r=await q(`SELECT COALESCE(pm.process_name,'[UNMAP]') AS process,
    ROUND(SUM(bp.provision_amt)/100000,2) AS prov_lakh, COUNT(*) AS n
   FROM billing_provision_snapshot bp
   LEFT JOIN cost_centre_master ccm ON ccm.bill_source_id=bp.bill_source_id
   LEFT JOIN process_master pm ON pm.id=ccm.process_id
   WHERE bp.period_code=?
     AND bp.bill_source_id NOT IN (SELECT DISTINCT cost_centre_source_id FROM billing_invoice_particular_snapshot WHERE period_code=?)
   GROUP BY pm.process_name ORDER BY prov_lakh DESC`,[per,per]);
  console.log(`\n=== SOURCE-B prov-only — ${per} ===`);console.table(r);
}

// Revenue by CC Jul
const ccR=await q(`SELECT bip.cost_centre_code AS cc,
  COALESCE(ccm.cost_centre_name,'') AS cc_name,
  COALESCE(pm.process_name,'[UNMAP]') AS process,
  ROUND(SUM(bip.amount)/100000,2) AS inv_lakh
 FROM billing_invoice_particular_snapshot bip
 LEFT JOIN cost_centre_master ccm ON ccm.bill_source_id=bip.cost_centre_source_id
 LEFT JOIN process_master pm ON pm.id=ccm.process_id
 WHERE bip.period_code='2026-07'
 GROUP BY bip.cost_centre_code,ccm.cost_centre_name,pm.process_name
 ORDER BY inv_lakh DESC LIMIT 80`);
console.log('\n=== REVENUE by CC — 2026-07 ===');console.table(ccR);

// GRN net vs gross by process
for(const per of P){
  const r=await q(`SELECT COALESCE(pm.process_name,'[UNMAP]') AS process,
    ROUND(SUM(l.amount)/100000,2) AS net_lakh,
    ROUND(SUM(l.tax)/100000,2) AS tax_lakh,
    ROUND(SUM(l.total)/100000,2) AS gross_lakh,
    ROUND(SUM(l.tax)/NULLIF(SUM(l.amount),0)*100,1) AS tax_pct,
    COUNT(*) AS n
   FROM grn_entry_line_snapshot l
   JOIN grn_entry_snapshot g ON g.bill_source_id=l.grn_source_id
   LEFT JOIN cost_centre_master ccm ON ccm.bill_source_id=l.cost_centre_source_id
   LEFT JOIN process_master pm ON pm.id=ccm.process_id
   WHERE g.period_code=?
   GROUP BY pm.process_name ORDER BY net_lakh DESC`,[per]);
  console.log(`\n=== GRN net vs gross — ${per} ===`);console.table(r);
}

// GRN drill-down lines Jul top-60
const gd=await q(`SELECT l.cost_centre_code AS cc,
  COALESCE(pm.process_name,'[UNMAP]') AS process,
  g.vendor, g.grn_no,
  ROUND(l.amount,2) AS net, ROUND(l.tax,2) AS tax, ROUND(l.total,2) AS gross,
  SUBSTRING(l.particular,1,60) AS particular
 FROM grn_entry_line_snapshot l
 JOIN grn_entry_snapshot g ON g.bill_source_id=l.grn_source_id
 LEFT JOIN cost_centre_master ccm ON ccm.bill_source_id=l.cost_centre_source_id
 LEFT JOIN process_master pm ON pm.id=ccm.process_id
 WHERE g.period_code='2026-07'
 ORDER BY l.amount DESC LIMIT 60`);
console.log('\n=== GRN DRILL-DOWN lines — 2026-07 ===');console.table(gd);

// GRN by CC Jul
const ccg=await q(`SELECT l.cost_centre_code AS cc,
  COALESCE(ccm.cost_centre_name,'') AS cc_name,
  COALESCE(pm.process_name,'[UNMAP]') AS process,
  ROUND(SUM(l.amount)/100000,2) AS net_lakh,
  ROUND(SUM(l.tax)/100000,2) AS tax_lakh, COUNT(*) AS n
 FROM grn_entry_line_snapshot l
 JOIN grn_entry_snapshot g ON g.bill_source_id=l.grn_source_id
 LEFT JOIN cost_centre_master ccm ON ccm.bill_source_id=l.cost_centre_source_id
 LEFT JOIN process_master pm ON pm.id=ccm.process_id
 WHERE g.period_code='2026-07'
 GROUP BY l.cost_centre_code,ccm.cost_centre_name,pm.process_name
 ORDER BY net_lakh DESC LIMIT 80`);
console.log('\n=== GRN by CC — 2026-07 ===');console.table(ccg);

// People cost by process
for(const per of P){
  const r=await q(`SELECT COALESCE(pm.process_name,'[UNMAP/BMC]') AS process,
    COUNT(DISTINCT e.id) AS headcount,
    ROUND(SUM(COALESCE(spl.gross_salary,0)+COALESCE(spl.pf_employer,0)+
      COALESCE(spl.esic_employer,0)+COALESCE(spl.gratuity,COALESCE(spl.basic,0)*0.0481))/100000,2) AS loaded_lakh
   FROM salary_prep_line spl
   JOIN employees e ON e.id=spl.employee_id
   LEFT JOIN cost_centre_master ccm ON ccm.id=e.cost_centre_id
   LEFT JOIN process_master pm ON pm.id=COALESCE(e.process_id,ccm.process_id)
   JOIN salary_prep_run pr ON pr.id=spl.run_id
   WHERE pr.run_month=? AND LOWER(pr.status) IN ('approved','paid','disbursed','finalized','final','completed')
   GROUP BY pm.process_name ORDER BY loaded_lakh DESC`,[per]);
  console.log(`\n=== PEOPLE COST by process — ${per} ===`);console.table(r);
}

// People by CC Jul
const ccp=await q(`SELECT ccm.cost_centre_code AS cc,
  COALESCE(ccm.cost_centre_name,'') AS cc_name,
  COALESCE(pm.process_name,'[UNMAP/BMC]') AS process,
  COUNT(DISTINCT e.id) AS hc,
  ROUND(SUM(COALESCE(spl.gross_salary,0)+COALESCE(spl.pf_employer,0)+
    COALESCE(spl.esic_employer,0)+COALESCE(spl.gratuity,COALESCE(spl.basic,0)*0.0481))/100000,2) AS loaded_lakh
 FROM salary_prep_line spl
 JOIN employees e ON e.id=spl.employee_id
 LEFT JOIN cost_centre_master ccm ON ccm.id=e.cost_centre_id
 LEFT JOIN process_master pm ON pm.id=COALESCE(e.process_id,ccm.process_id)
 JOIN salary_prep_run pr ON pr.id=spl.run_id
 WHERE pr.run_month='2026-07' AND LOWER(pr.status) IN ('approved','paid','disbursed','finalized','final','completed')
 GROUP BY ccm.id,ccm.cost_centre_code,ccm.cost_centre_name,pm.process_name
 ORDER BY pm.process_name,loaded_lakh DESC LIMIT 100`);
console.log('\n=== PEOPLE by CC — 2026-07 ===');console.table(ccp);

// NULL process_id employees
const np=await q(`SELECT ccm.cost_centre_code,COALESCE(ccm.cost_centre_name,'?') AS cc_name,
  COALESCE(pm.process_name,'[NO CCM PROC]') AS resolved_process, COUNT(e.id) AS cnt
 FROM employees e
 LEFT JOIN cost_centre_master ccm ON ccm.id=e.cost_centre_id
 LEFT JOIN process_master pm ON pm.id=ccm.process_id
 WHERE e.process_id IS NULL AND e.status='active'
 GROUP BY ccm.id,pm.id ORDER BY cnt DESC LIMIT 30`);
console.log('\n=== Active employees NULL process_id ===');console.table(np);

const nocc=await q(`SELECT COUNT(*) AS no_cc FROM employees WHERE cost_centre_id IS NULL AND status='active'`);
console.log('\n=== Active employees with NO cost_centre_id ===');console.table(nocc);

// Waterfall
for(const per of P){
  const w=await q(`SELECT ? AS period,
    ROUND((SELECT SUM(amount) FROM billing_invoice_particular_snapshot WHERE period_code=?)/100000,2) AS A_lakh,
    ROUND((SELECT SUM(provision_amt) FROM billing_provision_snapshot WHERE period_code=?
           AND bill_source_id NOT IN (SELECT DISTINCT cost_centre_source_id FROM billing_invoice_particular_snapshot WHERE period_code=?)
          )/100000,2) AS B_lakh,
    ROUND((SELECT SUM(l.amount) FROM grn_entry_line_snapshot l JOIN grn_entry_snapshot g ON g.bill_source_id=l.grn_source_id WHERE g.period_code=?)/100000,2) AS grn_net,
    ROUND((SELECT SUM(l.tax)    FROM grn_entry_line_snapshot l JOIN grn_entry_snapshot g ON g.bill_source_id=l.grn_source_id WHERE g.period_code=?)/100000,2) AS grn_tax,
    ROUND((SELECT SUM(l.total)  FROM grn_entry_line_snapshot l JOIN grn_entry_snapshot g ON g.bill_source_id=l.grn_source_id WHERE g.period_code=?)/100000,2) AS grn_gross`,[per,per,per,per,per,per,per]);
  console.log(`\n=== WATERFALL — ${per} ===`);console.table(w);
}

// People vs revenue
const rat=await q(`SELECT pa.period,
  ROUND(pa.ppl,2) AS people_lakh, ROUND(ra.rev,2) AS revenue_lakh,
  ROUND(pa.ppl/NULLIF(ra.rev,0)*100,1) AS people_pct
 FROM (SELECT pr.run_month AS period,
   SUM(COALESCE(spl.gross_salary,0)+COALESCE(spl.pf_employer,0)+
       COALESCE(spl.esic_employer,0)+COALESCE(spl.gratuity,COALESCE(spl.basic,0)*0.0481))/100000 AS ppl
  FROM salary_prep_line spl JOIN salary_prep_run pr ON pr.id=spl.run_id
  WHERE LOWER(pr.status) IN ('approved','paid','disbursed','finalized','final','completed')
    AND pr.run_month IN ('2026-08','2026-07','2026-06') GROUP BY pr.run_month) pa
 JOIN (SELECT period_code AS period, SUM(amount)/100000 AS rev
  FROM billing_invoice_particular_snapshot WHERE period_code IN ('2026-08','2026-07','2026-06')
  GROUP BY period_code) ra ON ra.period=pa.period ORDER BY pa.period DESC`);
console.log('\n=== PEOPLE vs REVENUE ===');console.table(rat);

await conn.end();
console.log('\n✅ DONE');
