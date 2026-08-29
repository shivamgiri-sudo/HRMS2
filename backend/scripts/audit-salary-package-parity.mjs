/**
 * audit-salary-package-parity.mjs
 *
 * Read-only. Is the salary PACKAGE master in mas_hrms complete against db_bill?
 *
 * db_bill holds the package catalogue — one row per branch + cost centre + band
 * giving the full component split (Basic, Conveyance, Portfolio, Medical,
 * Special, OtherAllow, HRA, Bonus, PLI, Gross, EPF, ESIC, Professional,
 * NetInHand, EPFCO, ESICCO, Admin, CTC). mas_hrms.salary_package_master has the
 * same shape plus source_db / source_id, so every db_bill row should appear once.
 *
 *   db_bill.mas_packagemaster             -> mas_hrms.salary_package_master
 *   db_bill.mas_packagemaster_state_wise  -> mas_hrms.salary_package_state_wise
 *   db_bill.Band_Master                   -> mas_hrms.salary_band_master
 *
 * Reports rows missing, rows present but numerically divergent, and per-column
 * divergence so a partial migration is visible head by head.
 */
import { connect } from './lib/db-connect.mjs';
import { num } from './lib/dbbill-salary-mapping.mjs';

const arg = (n, fb) => process.argv.find(a => a.startsWith(`--${n}=`))?.split('=')[1] ?? fb;
const log = m => process.stdout.write(m + '\n');
const money = v => Math.round(num(v) * 100) / 100;

/** db_bill column -> mas_hrms column. */
const FIELDS = [
  ['Basic', 'basic'], ['HRA', 'hra'], ['Conveyance', 'conveyance'],
  ['Portfolio', 'portfolio'], ['Medical', 'medical'], ['Special', 'special_allowance'],
  ['OtherAllow', 'other_allowance'], ['Bonus', 'bonus'], ['PLI', 'pli'],
  ['Gross', 'gross'], ['EPF', 'epf_employee'], ['ESIC', 'esic_employee'],
  ['Professional', 'professional_tax'], ['NetInHand', 'net_in_hand'],
  ['EPFCO', 'epf_employer'], ['ESICCO', 'esic_employer'], ['Admin', 'admin_charges'],
  ['CTC', 'ctc'], ['PackageAmount', 'package_amount'],
];

async function main() {
  const hrms = await connect('mas_hrms', { host: arg('hrms-host', null), log });
  const bill = await connect('db_bill', { host: arg('bill-host', null), log });

  const [bp] = await bill.query('SELECT * FROM mas_packagemaster');
  const [hp] = await hrms.query(
    `SELECT * FROM salary_package_master WHERE source_db = 'db_bill'`);

  log(`\n=== PACKAGE MASTER ===`);
  log(`  db_bill.mas_packagemaster        ${bp.length}`);
  log(`  mas_hrms.salary_package_master   ${hp.length} (source_db='db_bill')`);

  const H = new Map(hp.map(r => [String(r.source_id), r]));
  const missing = [], divergent = [];
  const perField = Object.fromEntries(FIELDS.map(([b]) => [b, 0]));

  for (const b of bp) {
    const h = H.get(String(b.id));
    if (!h) { missing.push(b); continue; }
    const bad = [];
    for (const [bc, hc] of FIELDS) {
      if (Math.abs(money(b[bc]) - money(h[hc])) > 0.005) { bad.push(bc); perField[bc]++; }
    }
    if (bad.length) divergent.push({ id: b.id, branch: b.BranchName, band: b.Band, fields: bad });
  }

  log(`  missing in mas_hrms              ${missing.length}`);
  log(`  present but divergent            ${divergent.length}`);

  if (missing.length) {
    log('\n  MISSING PACKAGES (db_bill id / branch / band / CTC):');
    for (const b of missing.slice(0, 40)) {
      log(`    ${String(b.id).padStart(4)}  ${String(b.BranchName || '').padEnd(28)} ${String(b.Band || '').padEnd(4)} CTC ${money(b.CTC)}`);
    }
    if (missing.length > 40) log(`    ... and ${missing.length - 40} more`);
    const zero = missing.filter(b => money(b.CTC) === 0 && money(b.Gross) === 0).length;
    log(`    of these, ${zero} carry CTC 0 and Gross 0 (empty placeholder rows)`);
  }

  if (divergent.length) {
    log('\n  DIVERGENT PACKAGES:');
    for (const d of divergent.slice(0, 20)) {
      log(`    ${String(d.id).padStart(4)}  ${String(d.branch || '').padEnd(28)} ${String(d.band || '').padEnd(4)} -> ${d.fields.join(', ')}`);
    }
    log('\n  divergence count per column:');
    for (const [f, n] of Object.entries(perField)) if (n) log(`    ${f.padEnd(16)} ${n}`);
  }

  // source_id alone is not the identity. The migration expanded one db_bill row
  // across several cost centres and, in places, wrote the same (branch, cost
  // centre, band) more than once — source_id 60 exists five times in mas_hrms with
  // three distinct cost centres, two of them written twice with identical amounts.
  // So compare on the natural key as well, which is what a package lookup uses.
  const key = (branch, cc, band) =>
    `${String(branch ?? '').trim().toUpperCase()}|${String(cc ?? '').trim().toUpperCase()}|${String(band ?? '').trim().toUpperCase()}`;

  const hByKey = new Map();
  for (const h of hp) {
    const k = key(h.branch_name, h.cost_centre_code, h.band_code);
    hByKey.set(k, (hByKey.get(k) ?? 0) + 1);
  }
  const bKeys = new Set(bp.map(b => key(b.BranchName, b.CostCenter, b.Band)));

  const missingByKey = [...bKeys].filter(k => !hByKey.has(k));
  const dupKeys = [...hByKey.entries()].filter(([, n]) => n > 1);
  const orphanKeys = [...hByKey.keys()].filter(k => !bKeys.has(k));

  log('\n=== NATURAL KEY (branch | cost centre | band) ===');
  log(`  distinct keys in db_bill         ${bKeys.size}   (of ${bp.length} rows)`);
  log(`  distinct keys in mas_hrms        ${hByKey.size}   (of ${hp.length} rows)`);
  log(`  db_bill keys absent from mas_hrms ${missingByKey.length}`);
  log(`  mas_hrms keys not in db_bill      ${orphanKeys.length}`);
  log(`  keys duplicated in mas_hrms       ${dupKeys.length}  (${dupKeys.reduce((s, [, n]) => s + n - 1, 0)} surplus rows)`);
  if (dupKeys.length) {
    log('\n  DUPLICATED KEYS — a package lookup on these has no single answer:');
    for (const [k, n] of dupKeys.slice(0, 15)) log(`    x${n}  ${k}`);
    if (dupKeys.length > 15) log(`    ... and ${dupKeys.length - 15} more`);
  }
  if (missingByKey.length) {
    log('\n  KEYS PRESENT IN db_bill, ABSENT IN mas_hrms:');
    for (const k of missingByKey.slice(0, 15)) log(`    ${k}`);
    if (missingByKey.length > 15) log(`    ... and ${missingByKey.length - 15} more`);
  }

  // Companion tables
  log('\n=== COMPANION TABLES ===');
  for (const [bt, ht] of [['mas_packagemaster_state_wise', 'salary_package_state_wise'],
                          ['Band_Master', 'salary_band_master'],
                          ['mas_band', null]]) {
    const [[b]] = await bill.query(`SELECT COUNT(*) c FROM \`${bt}\``);
    if (!ht) { log(`  db_bill.${bt.padEnd(30)} ${String(b.c).padStart(5)}   (no mas_hrms counterpart identified)`); continue; }
    const [[h]] = await hrms.query(`SELECT COUNT(*) c FROM \`${ht}\``);
    const flag = Number(h.c) === 0 && Number(b.c) > 0 ? '   <-- NOT MIGRATED' :
                 Number(h.c) < Number(b.c) ? '   <-- short' : '';
    log(`  db_bill.${bt.padEnd(30)} ${String(b.c).padStart(5)}  ->  mas_hrms.${ht.padEnd(26)} ${String(h.c).padStart(5)}${flag}`);
  }

  await hrms.end(); await bill.end();
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
