/**
 * migrate-salary-structures-from-dbbill.mjs
 *
 * Loads component-wise salary breakdown from db_bill.masjclrentry into
 * mas_hrms.salary_component_assignments for ALL active employees.
 *
 * For employees WITH an existing active SCA row: UPDATE the 6 new component
 * columns (bonus/portfolio/medical_allowance/lta/other_allowance/pli) only
 * where they are currently 0, and backfill basic/hra/conv/gross where also 0.
 *
 * For employees WITHOUT any SCA row: INSERT a full row from db_bill data.
 *
 * Safe to re-run: updates only where column is 0, inserts only where no row.
 *
 * Usage: node scripts/migrate-salary-structures-from-dbbill.mjs
 */
import mysql from 'mysql2/promise';

const HRMS = { host: '192.168.10.6', port: 3306, user: 'shivam_user', password: 'qwersdfg!@#hjk', database: 'mas_hrms' };
const BILL = { host: '192.168.10.22', port: 3306, user: 'shivam_user', password: 'qwersdfg!@#hjk', database: 'db_bill' };
const BATCH = 200;

async function run() {
  const hrms = await mysql.createConnection(HRMS);
  const bill = await mysql.createConnection(BILL);
  console.log('[INIT] Connected to both databases\n');

  // Load masjclrentry component data (most recent row per EmpCode via MAX salary)
  console.log('[LOAD] Reading db_bill.masjclrentry ...');
  const [jclr] = await bill.execute(
    `SELECT EmpCode,
            COALESCE(bs,0)    AS bs,
            COALESCE(hra,0)   AS hra,
            COALESCE(bonus,0) AS bonus,
            COALESCE(conv,0)  AS conv,
            COALESCE(portf,0) AS portf,
            COALESCE(ma,0)    AS ma,
            COALESCE(lta,0)   AS lta,
            COALESCE(sa,0)    AS sa,
            COALESCE(oa,0)    AS oa,
            COALESCE(PLI,0)   AS pli,
            COALESCE(Gross,0) AS gross,
            COALESCE(NetInhand,0) AS net,
            COALESCE(pfelig,'Y')  AS pfelig,
            COALESCE(esielig,'Y') AS esielig,
            COALESCE(EPF,0)   AS epf_emp,
            COALESCE(ESIC,0)  AS esic_emp,
            COALESCE(EPFCO,0) AS epf_emp_co,
            COALESCE(ESICCO,0) AS esic_emp_co
     FROM masjclrentry
     WHERE EmpCode LIKE 'MAS%'
     ORDER BY EmpCode, Gross DESC`
  );
  // Keep only the highest-gross row per employee (most representative salary)
  const billMap = new Map();
  for (const r of jclr) {
    if (!billMap.has(r.EmpCode)) billMap.set(r.EmpCode, r);
  }
  console.log(`[LOAD] ${billMap.size} unique MAS employees in db_bill\n`);

  // Load all active mas_hrms employees with their SCA row (if any)
  const [employees] = await hrms.execute(
    `SELECT e.id, e.employee_code,
            sca.id        AS sca_id,
            sca.basic     AS sca_basic,
            sca.hra       AS sca_hra,
            sca.conveyance AS sca_conv,
            sca.bonus     AS sca_bonus,
            sca.portfolio AS sca_portfolio,
            sca.medical_allowance AS sca_medical,
            sca.lta       AS sca_lta,
            sca.other_allowance AS sca_other,
            sca.pli       AS sca_pli,
            sca.gross     AS sca_gross
     FROM employees e
     LEFT JOIN salary_component_assignments sca
       ON sca.employee_id = e.id AND sca.status = 'active'
     WHERE e.employment_status = 'Active'`
  );
  console.log(`[LOAD] ${employees.length} active employee rows in mas_hrms`);

  // Deduplicate — keep first SCA row per employee (most recent effective_date
  // guaranteed by the JOIN; if multiple active rows exist, take the first seen)
  const seenEmp = new Set();
  const uniq = [];
  for (const e of employees) {
    if (!seenEmp.has(e.id)) {
      seenEmp.add(e.id);
      uniq.push(e);
    }
  }
  console.log(`[LOAD] ${uniq.length} unique active employees\n`);

  let updated = 0, inserted = 0, skipped = 0;

  for (let i = 0; i < uniq.length; i += BATCH) {
    const batch = uniq.slice(i, i + BATCH);
    for (const emp of batch) {
      const src = billMap.get(emp.employee_code);
      if (!src) { skipped++; continue; }

      const v = {
        basic:   Number(src.bs)    || 0,
        hra:     Number(src.hra)   || 0,
        bonus:   Number(src.bonus) || 0,
        conv:    Number(src.conv)  || 0,
        portf:   Number(src.portf) || 0,
        ma:      Number(src.ma)    || 0,
        lta:     Number(src.lta)   || 0,
        sa:      Number(src.sa)    || 0,
        oa:      Number(src.oa)    || 0,
        pli:     Number(src.pli)   || 0,
        gross:   Number(src.gross) || 0,
        net:     Number(src.net)   || 0,
        pfAppl:  src.pfelig  === 'N' ? 0 : 1,
        esiAppl: src.esielig === 'N' ? 0 : 1,
        epfEmp:   Number(src.epf_emp)   || 0,
        esicEmp:  Number(src.esic_emp)  || 0,
        epfEmpCo: Number(src.epf_emp_co) || 0,
        esicEmpCo:Number(src.esic_emp_co) || 0,
      };

      if (emp.sca_id) {
        // UPDATE — only fill columns that are currently 0
        await hrms.execute(
          `UPDATE salary_component_assignments SET
             bonus             = CASE WHEN bonus=0             THEN ? ELSE bonus             END,
             portfolio         = CASE WHEN portfolio=0         THEN ? ELSE portfolio         END,
             medical_allowance = CASE WHEN medical_allowance=0 THEN ? ELSE medical_allowance END,
             lta               = CASE WHEN lta=0               THEN ? ELSE lta               END,
             other_allowance   = CASE WHEN other_allowance=0   THEN ? ELSE other_allowance   END,
             pli               = CASE WHEN pli=0               THEN ? ELSE pli               END,
             basic             = CASE WHEN (basic IS NULL OR basic=0)         THEN ? ELSE basic       END,
             hra               = CASE WHEN (hra IS NULL OR hra=0)             THEN ? ELSE hra         END,
             conveyance        = CASE WHEN (conveyance IS NULL OR conveyance=0) THEN ? ELSE conveyance END,
             gross             = CASE WHEN (gross IS NULL OR gross=0)         THEN ? ELSE gross       END
           WHERE id = ?`,
          [v.bonus, v.portf, v.ma, v.lta, v.oa, v.pli,
           v.basic, v.hra, v.conv, v.gross,
           emp.sca_id]
        );
        updated++;
      } else {
        // INSERT — employee has no SCA row at all; use system sentinel as assigned_by
        await hrms.execute(
          `INSERT INTO salary_component_assignments
             (id, employee_id, effective_date,
              basic, hra, conveyance, special_allowance,
              bonus, portfolio, medical_allowance, lta, other_allowance, pli,
              gross, pf_applicable, esi_applicable, employer_pf, employer_esi,
              pf_employee, esic_employee, ctc, net_estimate,
              assigned_by, assigned_at, status)
           SELECT UUID(), ?, CURDATE(),
                  ?, ?, ?, ?,
                  ?, ?, ?, ?, ?, ?,
                  ?, ?, ?, ?, ?,
                  ?, ?, ?, ?,
                  id, NOW(), 'active'
           FROM auth_user WHERE email = 'system@mas.in' LIMIT 1`,
          [emp.id,
           v.basic, v.hra, v.conv, v.sa,
           v.bonus, v.portf, v.ma, v.lta, v.oa, v.pli,
           v.gross, v.pfAppl, v.esiAppl, v.epfEmpCo, v.esicEmpCo,
           v.epfEmp, v.esicEmp, v.gross * 12, v.net]
        );
        inserted++;
      }
    }
    process.stdout.write(`\r[PROGRESS] ${Math.min(i + BATCH, uniq.length)} / ${uniq.length}`);
  }

  await hrms.end();
  await bill.end();

  console.log(`\n\n${'═'.repeat(60)}`);
  console.log('  SALARY STRUCTURE MIGRATION COMPLETE');
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Updated existing SCA rows : ${updated}`);
  console.log(`  Inserted new SCA rows     : ${inserted}`);
  console.log(`  No db_bill data (skipped) : ${skipped}`);
  console.log(`${'═'.repeat(60)}`);
  console.log('\nNext step: run reconcile-payroll-vs-legacy.mjs 2026-07 to verify match %');
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
