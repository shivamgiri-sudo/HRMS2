#!/usr/bin/env node
/**
 * backfill-roster-assignment-process-lob.mjs
 *
 * Fills the NULL wfm_roster_assignment.process_id / lob_id columns added by migration 1849 for
 * rows that existed before the columns did. The migration deliberately does NOT backfill (413k+
 * rows, live table); this is the throttled, resumable way to do it.
 *
 * Resolution, per row, first match wins, NEVER overwriting a non-NULL value:
 *   process_id  1. wfm_roster_plan.process_id       via plan_id
 *               2. wfm_shift_template.process_id     via shift_template_id
 *               3. employees.process_id              via employee_id
 *   lob_id         employees.lob_id                  via employee_id
 *
 * SAFETY (see memory hrms2-bulk-backfill-scripts-need-throttling)
 *  - DRY RUN BY DEFAULT: without --apply it only counts what it would change.
 *  - Keyset batches on the primary key (id > cursor ORDER BY id LIMIT --batch), each UPDATE bounded
 *    to that id range so row locks stay small; one statement per step per batch, autocommit.
 *  - innodb_lock_wait_timeout is lowered for the session, and a pause runs between batches.
 *  - A lock-wait timeout on one step skips that step for that batch (it is picked up on a re-run)
 *    instead of aborting; --max-failures consecutive failed batches abort the run.
 *  - Resumable: the last finished id is written to a cursor file; --resume continues from it.
 *  - Idempotent: a second run finds nothing left to fill.
 *
 *   node scripts/backfill-roster-assignment-process-lob.mjs                 # dry run (counts only)
 *   node scripts/backfill-roster-assignment-process-lob.mjs --apply         # write, 2000 rows/batch
 *   node scripts/backfill-roster-assignment-process-lob.mjs --apply --resume
 *   options: --batch 2000  --sleep-ms 1500  --lock-wait 5  --max-failures 5  --cursor-file <path>
 *            --health-url http://127.0.0.1:5055/api/health   (aborts if it stops answering)
 *
 * Connection comes from backend/.env (DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME).
 */
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import mysql from "mysql2/promise";

const DEFAULTS = {
  apply: false, resume: false, batch: 2000, sleepMs: 1500, lockWait: 5, maxFailures: 5,
  cursorFile: join(tmpdir(), "roster-assignment-process-lob.cursor"), healthUrl: null,
};

export function parseArgs(argv) {
  const opts = { ...DEFAULTS };
  const num = (v, name) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${name} needs a non-negative number`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") opts.apply = true;
    else if (a === "--dry-run") opts.apply = false;
    else if (a === "--resume") opts.resume = true;
    else if (a === "--batch") opts.batch = Math.max(1, Math.min(num(argv[++i], a), 5000));
    else if (a === "--sleep-ms") opts.sleepMs = num(argv[++i], a);
    else if (a === "--lock-wait") opts.lockWait = Math.max(1, num(argv[++i], a));
    else if (a === "--max-failures") opts.maxFailures = Math.max(1, num(argv[++i], a));
    else if (a === "--cursor-file") opts.cursorFile = String(argv[++i]);
    else if (a === "--health-url") opts.healthUrl = String(argv[++i]);
    else throw new Error(`Unknown option ${a}`);
  }
  return opts;
}

const RANGE = "wra.id > ? AND wra.id <= ?";

/** The fill steps, in precedence order. `where` is the extra predicate; every step is NULL-only. */
export const STEPS = [
  {
    name: "process_id from plan",
    from: "wfm_roster_assignment wra JOIN wfm_roster_plan src ON src.id = wra.plan_id",
    set: "wra.process_id = src.process_id",
    where: `${RANGE} AND wra.process_id IS NULL AND src.process_id IS NOT NULL`,
  },
  {
    name: "process_id from shift template",
    from: "wfm_roster_assignment wra JOIN wfm_shift_template src ON src.id = wra.shift_template_id",
    set: "wra.process_id = src.process_id",
    where: `${RANGE} AND wra.process_id IS NULL AND src.process_id IS NOT NULL`,
  },
  {
    name: "process_id from employee",
    from: "wfm_roster_assignment wra JOIN employees src ON src.id = wra.employee_id",
    set: "wra.process_id = src.process_id",
    where: `${RANGE} AND wra.process_id IS NULL AND src.process_id IS NOT NULL`,
  },
  {
    name: "lob_id from employee",
    from: "wfm_roster_assignment wra JOIN employees src ON src.id = wra.employee_id",
    set: "wra.lob_id = src.lob_id",
    where: `${RANGE} AND wra.lob_id IS NULL AND src.lob_id IS NOT NULL`,
  },
];

export const updateSql = (step) => `UPDATE ${step.from} SET ${step.set} WHERE ${step.where}`;
export const countSql = (step) => `SELECT COUNT(*) AS c FROM ${step.from} WHERE ${step.where}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function healthy(url) {
  if (!url) return true;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function assertColumns(conn) {
  const [cols] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment' AND COLUMN_NAME IN ('process_id','lob_id')`,
  );
  if (cols.length !== 2) throw new Error("wfm_roster_assignment.process_id / lob_id are missing: apply migration 1849 first.");
}

/** Next id boundary: the id `batch` rows after the cursor among rows that still need filling. */
async function nextBoundary(conn, cursor, batch) {
  const [rows] = await conn.query(
    `SELECT id FROM wfm_roster_assignment
      WHERE id > ? AND (process_id IS NULL OR lob_id IS NULL)
      ORDER BY id LIMIT ?, 1`,
    [cursor, batch - 1],
  );
  if (rows.length) return { upper: rows[0].id, last: false };
  const [tail] = await conn.query(
    `SELECT MAX(id) AS id FROM wfm_roster_assignment WHERE id > ? AND (process_id IS NULL OR lob_id IS NULL)`, [cursor],
  );
  return tail[0]?.id ? { upper: tail[0].id, last: true } : null;
}

export async function run(opts, connFactory = () => mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
}), log = console.log) {
  const conn = await connFactory();
  const totals = Object.fromEntries(STEPS.map((s) => [s.name, 0]));
  let batches = 0, failedInARow = 0, failedSteps = 0;
  try {
    await assertColumns(conn);
    await conn.query(`SET SESSION innodb_lock_wait_timeout = ${Math.trunc(opts.lockWait)}`);
    let cursor = "";
    if (opts.resume && existsSync(opts.cursorFile)) cursor = readFileSync(opts.cursorFile, "utf8").trim();
    log(`${opts.apply ? "APPLY" : "DRY RUN"} batch=${opts.batch} sleep=${opts.sleepMs}ms cursor="${cursor}"`);
    for (;;) {
      const b = await nextBoundary(conn, cursor, opts.batch);
      if (!b) break;
      batches++;
      let batchFailed = false;
      for (const step of STEPS) {
        try {
          if (opts.apply) {
            const [res] = await conn.query(updateSql(step), [cursor, b.upper]);
            totals[step.name] += Number(res.affectedRows ?? 0);
          } else {
            const [rows] = await conn.query(countSql(step), [cursor, b.upper]);
            totals[step.name] += Number(rows[0]?.c ?? 0);
          }
        } catch (err) {
          batchFailed = true;
          failedSteps++;
          log(`  ! batch ${batches} (${step.name}) skipped: ${err.code ?? ""} ${err.message}`);
        }
      }
      failedInARow = batchFailed ? failedInARow + 1 : 0;
      if (failedInARow >= opts.maxFailures) throw new Error(`${failedInARow} consecutive failed batches - aborting (cursor kept at "${cursor}")`);
      cursor = b.upper;
      if (opts.apply) writeFileSync(opts.cursorFile, cursor);
      if (batches % 10 === 0) log(`  ... ${batches} batches, cursor ${cursor}`);
      if (b.last) break;
      if (opts.apply) {
        if (!(await healthy(opts.healthUrl))) throw new Error(`health check failed - aborting (cursor kept at "${cursor}")`);
        await sleep(opts.sleepMs);
      }
    }
    log(`${opts.apply ? "Updated" : "Would update"} (per step, rows): ${JSON.stringify(totals)}`);
    log(`batches=${batches} failedSteps=${failedSteps}${failedSteps ? " (re-run to pick up skipped steps)" : ""}`);
    return { totals, batches, failedSteps };
  } finally {
    await conn.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run(parseArgs(process.argv.slice(2))).catch((err) => {
    console.error(`FAILED: ${err.message}`);
    process.exit(1);
  });
}
