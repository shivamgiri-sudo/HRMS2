/**
 * Raise innodb_buffer_pool_size on mas_hrms, and prove it helped.
 *
 * WHY
 * ---
 * The pool was 128 MB — the MySQL factory default, never tuned — against 19.55 GB of data
 * on the server and 3.63 GB in mas_hrms alone. Two individual tables are larger than the
 * whole cache (attendance_daily_record 294 MB, employees 284 MB), so a single scan evicts
 * everything and is re-read from disk on the next query. Measured symptoms before the
 * change, on 110 days of uptime:
 *
 *   Innodb_buffer_pool_wait_free   50,057,667   (a healthy server sits at ~0)
 *   buffer pool hit rate               95.35%   (should exceed 99.9%)
 *   pool pages free                         0   (permanently full, thrashing)
 *   Created_tmp_tables             18,023,127
 *   Slow_queries                      835,435
 *
 * That is why a 131,906-row aggregate takes 86s and aon-bucket-shrinkage 504s at 120s.
 *
 * SIZING
 * ------
 * 1 GB, deliberately conservative rather than optimal. The server's physical RAM could not
 * be read from here, and a pool larger than available memory gets mysqld OOM-killed — an
 * outage far worse than slow reports. 1 GB is safe on any machine plausibly hosting this
 * workload, is 8x the current value, and comfortably holds both hot tables. Once RAM is
 * confirmed, 4-8 GB is the right target and this script can simply be re-run with a new
 * TARGET_BYTES.
 *
 * SAFETY
 * ------
 * innodb_buffer_pool_size is DYNAMIC in MySQL 8, so there is no restart and no downtime.
 * The resize is online and reversible in one statement. The value must be a multiple of
 * innodb_buffer_pool_chunk_size x innodb_buffer_pool_instances (128 MB x 1 here); 1 GB is
 * 8 chunks exactly. This script refuses to run if that does not hold.
 *
 * NOT changed here, because neither is dynamic and both need a restart window:
 *   innodb_buffer_pool_instances  1     -> 8 once the pool is multi-GB
 *   innodb_io_capacity            200   -> 2000+ if the volume is SSD
 * The new size must also be written to my.cnf or it reverts on the next restart.
 *
 * Usage:
 *   node scripts/tune-innodb-buffer-pool.cjs            # report only, changes nothing
 *   node scripts/tune-innodb-buffer-pool.cjs --apply
 */
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const TARGET_BYTES = Number(process.env.TARGET_BYTES || 1073741824); // 1 GB

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
const mb = (n) => (Number(n) / 1024 / 1024).toFixed(0) + ' MB';

(async () => {
  console.log(APPLY ? '=== APPLY ===' : '=== REPORT ONLY (pass --apply to change) ===');
  let c;
  for (const host of [pick('DB_HOST', '192.168.10.6'), '122.184.128.90']) {
    try {
      c = await mysql.createConnection({ host, user: pick('DB_USER'), password: pick('DB_PASSWORD'), database: 'mas_hrms', connectTimeout: 20000 });
      console.log(`connected via ${host}`);
      break;
    } catch (e) { console.log(`${host} -> ${e.code}`); }
  }
  if (!c) throw new Error('mas_hrms unreachable');

  const v = async (n) => { const [r] = await c.query('SHOW VARIABLES LIKE ?', [n]); return r[0] ? r[0].Value : null; };
  const s = async (n) => { const [r] = await c.query('SHOW GLOBAL STATUS LIKE ?', [n]); return r[0] ? r[0].Value : null; };

  const before = Number(await v('innodb_buffer_pool_size'));
  const chunk = Number(await v('innodb_buffer_pool_chunk_size'));
  const inst = Number(await v('innodb_buffer_pool_instances'));
  console.log(`  current pool      ${mb(before)}`);
  console.log(`  chunk x instances ${mb(chunk)} x ${inst}`);
  console.log(`  target            ${mb(TARGET_BYTES)}`);

  const unit = chunk * inst;
  if (TARGET_BYTES % unit !== 0) {
    throw new Error(`target ${TARGET_BYTES} is not a multiple of chunk x instances (${unit}) — MySQL would silently round it`);
  }
  if (TARGET_BYTES <= before) {
    console.log('  target is not larger than the current value; nothing to do.');
    await c.end(); return;
  }

  // Timing probe: the same shape of aggregate that has been timing out.
  const probe = async (label) => {
    const t = Date.now();
    await c.query(`
      SELECT COUNT(*) n
        FROM attendance_daily_record adr
        JOIN employees e ON e.id = adr.employee_id
       WHERE adr.record_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`);
    console.log(`  ${label}: ${Date.now() - t}ms`);
  };
  await probe('probe before');

  if (!APPLY) { console.log('\nReport only. Re-run with --apply.'); await c.end(); return; }

  console.log('\n  resizing (online, no restart)...');
  await c.query(`SET GLOBAL innodb_buffer_pool_size = ${TARGET_BYTES}`);

  // The resize is asynchronous; wait for MySQL to report it complete.
  for (let i = 0; i < 60; i++) {
    const st = await s('Innodb_buffer_pool_resize_status');
    const now = Number(await v('innodb_buffer_pool_size'));
    if (now >= TARGET_BYTES && (!st || /completed/i.test(st) || st === '')) {
      console.log(`  resize complete: ${mb(now)}`);
      break;
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  const after = Number(await v('innodb_buffer_pool_size'));
  console.log(`\n  pool ${mb(before)} -> ${mb(after)}`);
  console.log(`  pages free now: ${await s('Innodb_buffer_pool_pages_free')}`);
  console.log(`  threads running: ${await s('Threads_running')}`);
  await probe('probe after ');

  console.log('\n  NOTE: this is a runtime value. Add to my.cnf under [mysqld] to survive a restart:');
  console.log(`        innodb_buffer_pool_size = ${Math.round(TARGET_BYTES / 1024 / 1024)}M`);
  await c.end();
})().catch(e => { console.error('FAILED: ' + e.message); process.exit(1); });
