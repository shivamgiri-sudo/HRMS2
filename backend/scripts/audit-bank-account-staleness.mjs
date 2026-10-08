/**
 * audit-bank-account-staleness.mjs   READ-ONLY. Writes nothing, anywhere.
 *
 * Finds employees whose HRMS payment account disagrees with the most recently updated
 * evidence in db_bill — i.e. where paying from employee_bank_detail would send salary to
 * an account the employee has moved off.
 *
 * WHY THIS IS NEEDED
 * ------------------
 * Every payment path (/neft-export, /payment-file) pays from employee_bank_detail, and it is
 * the only table the application maintains — so it is the right default. But "actively
 * maintained" is not "correct": it can still be stale, and nothing detects that today.
 *
 * MAS62701, found 2026-08-30:
 *   db_bill salary_data   2026-04/05 -> ***4622     2026-06/07 -> ***8424  (both confirmed YES)
 *   db_bill masjclrentry  ***8424 KOTAK, AcValidationDate 2026-07-05, lastUpdated 2026-07-27
 *   HRMS employee_bank_detail  ***4622 INDUSIND, still primary
 * The employee changed bank in June. db_bill followed and validated it. HRMS did not. Paying
 * from employee_bank_detail would credit the account they left.
 *
 * THE RULE: LATEST UPDATED WINS
 * ----------------------------
 * Evidence is ranked by how recently it was updated, not by which table it came from:
 *   1. db_bill.salary_data      - the account a CONFIRMED credit actually reached, newest month
 *   2. db_bill.masjclrentry     - the live employee master, ordered by lastUpdated DESC
 *                                 (33,249 rows / 31,660 accounts, updated to 2026-08-29)
 * employee_master is deliberately NOT consulted: its lastUpdated is 0000-00-00 on every row,
 * so nothing can be resolved "latest" against it, and it holds an account for none of the
 * current gap population.
 *
 * A disagreement is REPORTED, never auto-applied. Correcting an account is a money-movement
 * change and needs a human plus the production FIELD_ENCRYPTION_KEY — off the production host
 * the loaded key cannot read existing ciphertext and any write would be unreadable forever.
 *
 * Usage:
 *   node backend/scripts/audit-bank-account-staleness.mjs
 *   node backend/scripts/audit-bank-account-staleness.mjs --run-month=2026-07
 */
import { connect } from './lib/db-connect.mjs';

const arg = (n, fb) => process.argv.find(a => a.startsWith(`--${n}=`))?.split('=')[1] ?? fb;
const RUN_MONTH = arg('run-month', null);
const HRMS_HOST = arg('hrms-host', null);
const BILL_HOST = arg('bill-host', null);
const norm = (v) => String(v ?? '').trim().replace(/\s+/g, '');
const mask = (v) => (v ? `***${String(v).slice(-4)}` : '(none)');
const log = (m) => process.stdout.write(m + '\n');

async function main() {
  const hrms = await connect('mas_hrms', { host: HRMS_HOST, log: () => {} });
  const bill = await connect('db_bill',  { host: BILL_HOST, log: () => {} });

  // HRMS side: the account each payment path would actually use.
  const scope = RUN_MONTH
    ? `JOIN salary_prep_line spl ON spl.employee_id = e.id
       JOIN salary_prep_run spr ON spr.id = spl.run_id AND spr.run_month = ${hrms.escape(RUN_MONTH)}`
    : '';
  const [hRows] = await hrms.query(`
    SELECT DISTINCT TRIM(e.employee_code) AS code,
           CONVERT(ebd.account_number USING utf8mb4) AS acc,
           ebd.ifsc_code, ebd.updated_at
      FROM employees e ${scope}
      JOIN employee_bank_detail ebd
        ON ebd.employee_id = e.id AND ebd.is_primary = 1 AND ebd.active_status = 1
     WHERE e.active_status = 1
       AND ebd.account_number IS NOT NULL AND LENGTH(ebd.account_number) > 0`);
  log(`HRMS active employees with a primary account: ${hRows.length}`);

  // db_bill evidence 1: newest CONFIRMED credit per employee.
  const [credits] = await bill.query(`
    SELECT UPPER(TRIM(s.EmpCode)) c, s.AcNo, DATE_FORMAT(s.SalayDate,'%Y-%m') mon
      FROM salary_data s
      JOIN (SELECT UPPER(TRIM(EmpCode)) c, MAX(SalayDate) mx
              FROM salary_data
             WHERE SalaryReceiveStatus = 'YES' AND AcNo IS NOT NULL AND TRIM(AcNo) <> ''
             GROUP BY UPPER(TRIM(EmpCode))) l
        ON l.c = UPPER(TRIM(s.EmpCode)) AND l.mx = s.SalayDate
     WHERE s.SalaryReceiveStatus = 'YES'`);
  const creditMap = new Map();
  for (const r of credits) if (!creditMap.has(r.c)) creditMap.set(r.c, r);

  // db_bill evidence 2: live master, latest updated first.
  const [jclr] = await bill.query(`
    SELECT UPPER(TRIM(EmpCode)) c, AcNo, IFSCCode, AcBank, AccountFlag, AcValidationDate, lastUpdated
      FROM masjclrentry
     WHERE EmpCode IS NOT NULL AND TRIM(EmpCode) <> '' AND AcNo IS NOT NULL AND TRIM(AcNo) <> ''
     ORDER BY lastUpdated DESC`);
  const jclrMap = new Map();
  for (const r of jclr) if (!jclrMap.has(r.c)) jclrMap.set(r.c, r);

  const stale = [];
  let agree = 0, noEvidence = 0, ciphertext = 0;
  for (const h of hRows) {
    const code = norm(h.code).toUpperCase();
    const acc = norm(h.acc);
    // Encrypted rows cannot be compared without the production key. Counted, not guessed at.
    if (!/^[0-9]{6,20}$/.test(acc)) { ciphertext++; continue; }

    const cr = creditMap.get(code);
    const jc = jclrMap.get(code);
    const evidence = [];
    if (cr) evidence.push({ src: `salary_data ${cr.mon}`, acc: norm(cr.AcNo), when: cr.mon });
    if (jc) evidence.push({ src: `masjclrentry ${String(jc.lastUpdated ?? '').slice(0, 10)}`, acc: norm(jc.AcNo), when: String(jc.lastUpdated ?? '') });
    if (!evidence.length) { noEvidence++; continue; }

    if (evidence.some((e) => e.acc === acc)) { agree++; continue; }
    stale.push({ code, hrms: acc, hrmsIfsc: h.ifsc_code, hrmsUpdated: h.updated_at, evidence, jc });
  }

  log('');
  log(`  agrees with db_bill evidence .......... ${agree}`);
  log(`  NO db_bill evidence (new hire) ........ ${noEvidence}`);
  log(`  account encrypted, not comparable ..... ${ciphertext}`);
  log(`  STALE — disagrees with latest evidence . ${stale.length}`);
  if (stale.length) {
    log('');
    log('  CODE          HRMS PAYS   db_bill LATEST EVIDENCE');
    for (const s of stale) {
      const best = s.evidence[0];
      log(`  ${s.code.padEnd(13)} ${mask(s.hrms).padEnd(11)} ${mask(best.acc)} via ${best.src}` +
          (s.jc?.AcValidationDate ? `  [validated ${String(s.jc.AcValidationDate).slice(0, 10)}]` : ''));
    }
    log('');
    log('  ACTION: each line above is a possible wrong-account payment. Confirm with the employee,');
    log('  then correct employee_bank_detail ON THE PRODUCTION HOST (the local FIELD_ENCRYPTION_KEY');
    log('  cannot read existing ciphertext — writes made off-host are permanently unreadable).');
  }
  await hrms.end(); await bill.end();
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
