/**
 * Rebuilds a whole month of attendance by running the existing per-day sweep concurrently.
 *
 * WHY THIS EXISTS
 *   attendance-sweep-day.ts rebuilds one date and is the production path (same code the
 *   23:00 cron runs). One day takes ~25 minutes from off-LAN, so a month run serially is
 *   ~13 hours — almost all of it per-query latency to the public DB address, not work.
 *   Running several dates at once overlaps that latency.
 *
 * SAFETY
 *   Days are independent: each writes only rows for its own record_date, through the same
 *   ON DUPLICATE KEY upsert with the is_locked = 0 guard, so concurrency introduces no
 *   cross-day contention and no new write path. Concurrency is bounded (default 5) to keep
 *   load on the live database moderate.
 *
 *   Each day runs in its own child process, so one day failing does not stop the rest; the
 *   run summary lists which dates succeeded and which need re-running.
 *
 *   node scripts/attendance-sweep-month.mjs 2026-08              # whole month
 *   node scripts/attendance-sweep-month.mjs 2026-08 --from 2     # skip days already done
 *   node scripts/attendance-sweep-month.mjs 2026-08 --concurrency 3
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const month = process.argv[2];
if (!month || !/^\d{4}-\d{2}$/.test(month)) {
  console.error('usage: node scripts/attendance-sweep-month.mjs YYYY-MM [--from N] [--concurrency N]');
  process.exit(1);
}
const argOf = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt;
};
const fromDay = argOf('--from', 1);
const concurrency = Math.max(1, Math.min(8, argOf('--concurrency', 5)));

const [year, mon] = month.split('-').map(Number);
const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
const dates = [];
for (let d = fromDay; d <= daysInMonth; d++) {
  dates.push(`${month}-${String(d).padStart(2, '0')}`);
}

const logDir = path.resolve('logs', `sweep-${month}`);
mkdirSync(logDir, { recursive: true });

console.log(`Rebuilding ${dates.length} date(s) for ${month}, ${concurrency} at a time.`);
console.log(`Per-day logs: ${logDir}\n`);

const startedAt = Date.now();
const results = [];
let cursor = 0;

function runDate(date) {
  return new Promise((resolve) => {
    const began = Date.now();
    const child = spawn('npx', ['tsx', 'scripts/attendance-sweep-day.ts', date], {
      shell: true, windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (c) => { out += c.toString(); });
    child.stderr.on('data', (c) => { out += c.toString(); });
    child.on('close', (code) => {
      const mins = ((Date.now() - began) / 60000).toFixed(1);
      writeFileSync(path.join(logDir, `${date}.log`), out, 'utf8');
      const ok = code === 0;
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${date}  (${mins} min, exit ${code})`);
      results.push({ date, ok, minutes: Number(mins), exitCode: code });
      resolve();
    });
  });
}

async function worker() {
  while (cursor < dates.length) {
    const date = dates[cursor++];
    await runDate(date);
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));

results.sort((a, b) => a.date.localeCompare(b.date));
const failed = results.filter((r) => !r.ok);
console.log(`\nFinished in ${((Date.now() - startedAt) / 60000).toFixed(1)} min.`);
console.log(`Succeeded: ${results.length - failed.length}/${results.length}`);
if (failed.length) {
  console.log('FAILED - re-run these dates individually:');
  for (const f of failed) console.log(`  npx tsx scripts/attendance-sweep-day.ts ${f.date}`);
  process.exitCode = 1;
}
