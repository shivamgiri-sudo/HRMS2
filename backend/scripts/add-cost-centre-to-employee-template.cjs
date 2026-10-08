/**
 * Add cost_centre_code to the EMPLOYEE_MASTER bulk-upload template.
 *
 * The importer now resolves cost_centre_code (and process_code / lob_code, which it had
 * always advertised and always ignored), but the template's optional_columns list never
 * offered cost_centre_code — so the column an operator would need to fill did not appear in
 * the sheet they download. Code alone would leave the feature unreachable.
 *
 * Additive and idempotent: it appends the column only if absent, adds a sample value, and
 * leaves required_columns untouched so no existing upload becomes invalid.
 *
 * Usage:
 *   node scripts/add-cost-centre-to-employee-template.cjs            # dry run
 *   node scripts/add-cost-centre-to-employee-template.cjs --apply
 */
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');

function envFile() {
  const p = path.resolve(__dirname, '..', '.env');
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const E = envFile();
const pick = (k, d) => process.env[k] || E[k] || d;

(async () => {
  console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN ===');
  let conn;
  for (const host of [pick('DB_HOST', '192.168.10.6'), '122.184.128.90']) {
    try {
      conn = await mysql.createConnection({
        host, user: pick('DB_USER'), password: pick('DB_PASSWORD'),
        database: pick('DB_NAME', 'mas_hrms'), connectTimeout: 20000,
      });
      console.log(`  connected via ${host}`);
      break;
    } catch (e) { console.log(`  ${host} -> ${e.code}`); }
  }
  if (!conn) throw new Error('mas_hrms unreachable');

  const [rows] = await conn.query(
    `SELECT id, optional_columns, sample_row FROM upload_template_master
      WHERE upload_type_code = 'EMPLOYEE_MASTER' LIMIT 1`);
  if (rows.length === 0) { console.log('EMPLOYEE_MASTER template not found'); await conn.end(); return; }

  const asObj = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
  const optional = asObj(rows[0].optional_columns) || [];
  const sample = asObj(rows[0].sample_row) || {};

  if (optional.includes('cost_centre_code')) {
    console.log('  cost_centre_code already present - nothing to do');
    await conn.end();
    return;
  }

  // Placed next to the other org codes rather than appended, so the downloaded sheet groups
  // the posting fields together.
  const idx = optional.indexOf('designation_code');
  const next = optional.slice();
  next.splice(idx >= 0 ? idx + 1 : next.length, 0, 'cost_centre_code');
  const nextSample = { ...sample, cost_centre_code: 'BSS/BO/NOIDA-2/576' };

  console.log(`  optional_columns: ${optional.length} -> ${next.length}`);
  console.log(`  inserted after  : ${idx >= 0 ? 'designation_code' : '(end)'}`);
  console.log(`  sample value    : ${nextSample.cost_centre_code}`);

  if (!APPLY) { console.log('\nDry run only. Re-run with --apply to write.'); await conn.end(); return; }

  const [res] = await conn.execute(
    `UPDATE upload_template_master
        SET optional_columns = ?, sample_row = ?, updated_at = NOW()
      WHERE upload_type_code = 'EMPLOYEE_MASTER'`,
    [JSON.stringify(next), JSON.stringify(nextSample)]);
  console.log(`  rows updated: ${res.affectedRows}`);

  const [after] = await conn.query(
    `SELECT optional_columns FROM upload_template_master WHERE upload_type_code = 'EMPLOYEE_MASTER'`);
  const check = asObj(after[0].optional_columns) || [];
  console.log(`  verified: cost_centre_code present = ${check.includes('cost_centre_code')}`);
  await conn.end();
})().catch(e => { console.error('FAILED: ' + e.message); process.exit(1); });
