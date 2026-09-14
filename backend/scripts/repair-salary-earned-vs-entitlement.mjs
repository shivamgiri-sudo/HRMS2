/**
 * repair-salary-earned-vs-entitlement.mjs
 *
 * Repairs the single mis-mapping that produced the "net <> gross - deductions on
 * 87% of lines" finding: every importer copied db_bill's ENTITLEMENT columns
 * (Basic / HRA / Conv / Gross - the full-month sticker price) into HRMS where the
 * EARNED columns (Basic1 / HRA1 / Conv1 / Gross1 - what the employee actually
 * earned for days worked) belonged. See lib/dbbill-salary-mapping.mjs.
 *
 * What it changes on salary_prep_line, per row, only where the stored value
 * differs from db_bill:
 *   gross_salary        <- Gross1        (was Gross, on 129,696 of 129,696 rows)
 *   basic / hra / special_allowance <- Basic1 / HRA1 / SpecialAllowance1
 *   net_salary          <- NetSalary     (wrong on 351 rows, all 2026-07, all overstated)
 *   total_deductions    <- ESIC+EPF+IncomeTax+AdvPaid+LoanDed+TotalDeduction
 *   attendance_data_source '' -> 'NO_DATA'  (enum value coerced away on write)
 *
 * On salary_prep_line_component it brings every head in COMPONENT_MAP into line
 * with db_bill:
 *   value non-zero, row absent  -> INSERT. SHSH (54,953 rows, Rs 9,01,315),
 *                                  ShortCollection (462, Rs 8,50,876) and PLI (92)
 *                                  were never mapped by any importer, so those
 *                                  deductions have never been itemised on a payslip.
 *   value non-zero, row present -> amount + canonical component_name + source
 *   value zero,     row present -> DELETE. 56,701 such rows exist: a full-month
 *                                  entitlement line item for an employee who
 *                                  earned nothing that month.
 *   source ''                   -> 'snapshot'
 *
 * Deduction and employer-cost AMOUNTS were already exact on every row (PF 70,798/
 * 70,798, ESI 60,719/60,719, PT 7,390/7,390, TDS 1,686/1,686 ...), so for those
 * heads only the name and the two never-imported ones change. Adding SHSH and
 * ShortCollection double-counts nothing: TotalDeduction is exactly the sum of its
 * eight buckets on all 137,278 db_bill rows.
 *
 * PORTFOLIO is renamed "Personal Allowance" - that is what db_bill's own issued
 * payslip (SalarySlipMaster.PersonalAllowance) has always called it. Amount and
 * component_code are unchanged.
 *
 * Then recomputes salary_prep_run.total_employees / total_gross / total_net from
 * the lines, so a header can no longer disagree with its own rows.
 *
 * SAFETY
 *  - Dry run by default. `--apply` is required to write anything.
 *  - `--apply` refuses to start unless the backup tables exist (`--backup` makes them).
 *  - One transaction per month; a failure rolls that month back whole.
 *  - Idempotent: re-running after a successful run reports 0 changes.
 *  - Skips any (EmpCode, month) that db_bill holds more than once - ambiguous.
 *  - Never touches a deduction amount, a statutory figure, or a run's status.
 *
 * Usage:
 *   node backend/scripts/repair-salary-earned-vs-entitlement.mjs                 # dry run, all months
 *   node backend/scripts/repair-salary-earned-vs-entitlement.mjs --month=2026-07
 *   node backend/scripts/repair-salary-earned-vs-entitlement.mjs --backup
 *   node backend/scripts/repair-salary-earned-vs-entitlement.mjs --apply
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  COMPONENT_MAP, EARNED_COLUMN, totalDeductions, earnedGross, num,
} from './lib/dbbill-salary-mapping.mjs';
import { connect } from './lib/db-connect.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fromEnvFile(key) {
  try {
    const env = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8');
    const m = env.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m?.[1]?.replace(/^["']|["']$/g, '').trim() ?? null;
  } catch { return null; }
}
const arg = (name, fb) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fb;

const APPLY       = process.argv.includes('--apply');
const MAKE_BACKUP = process.argv.includes('--backup');
const ONLY_MONTH  = arg('month', null);
// null = let lib/db-connect.mjs try LAN then public. A flag forces one address.
const HRMS_HOST   = arg('hrms-host', null);
const BILL_HOST   = arg('bill-host', null);

const STAMP = '20260829';
const BK_LINE = `salary_prep_line_bk_${STAMP}`;
const BK_COMP = `salary_prep_line_component_bk_${STAMP}`;
const BK_RUN  = `salary_prep_run_bk_${STAMP}`;

const log = m => process.stdout.write(`[${new Date().toLocaleTimeString('en-IN')}] ${m}\n`);
const money = v => Math.round(num(v) * 100) / 100;
const differs = (a, b) => Math.abs(money(a) - money(b)) > 0.005;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const uuid = () => crypto.randomUUID();

/**
 * Long-lived connections to a remote server over a slow/public-IP link die
 * mid-run — proven live: 13 months committed cleanly (2018-01..2019-01), then
 * "Can't add new command when connection is in closed state" on month 14. The
 * network dropped, not the data. Reconnect on any transient error and retry the
 * SAME month from scratch: safe because nothing commits until every step for
 * that month succeeds, and re-diffing an already-fixed month is a cheap no-op
 * (differs() finds nothing to change).
 */
const TRANSIENT_CODES = new Set([
  'PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED',
  'EPIPE', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH',
  // Live proof (2026-08-30, month 2018-11): a connection killed mid-transaction
  // does not always release its row locks immediately server-side. The very next
  // attempt, on a fresh connection, hit ER_LOCK_WAIT_TIMEOUT on the same table
  // this session had just been writing when it died. Retrying (with the existing
  // backoff) is correct here — the lock is transient, not a real conflict; two
  // concurrent runs of this script never touch the same month, and no other
  // writer in the codebase updates salary_prep_line_component within a
  // transaction spanning more than a few rows.
  'ER_LOCK_WAIT_TIMEOUT', 'ER_LOCK_DEADLOCK',
]);
function isTransient(e) {
  return TRANSIENT_CODES.has(e.code)
    || /closed state|connection lost|read ECONNRESET|lock wait timeout|deadlock/i.test(e.message || '');
}

async function ensureBackups(hrms) {
  for (const [src, dst] of [['salary_prep_line', BK_LINE],
                            ['salary_prep_line_component', BK_COMP],
                            ['salary_prep_run', BK_RUN]]) {
    const [[{ n }]] = await hrms.query(
      `SELECT COUNT(*) n FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [dst]);
    if (n) { log(`  backup ${dst} already exists — left as is`); continue; }
    log(`  creating ${dst} from ${src} ...`);
    await hrms.query(`CREATE TABLE \`${dst}\` LIKE \`${src}\``);
    await hrms.query(`INSERT INTO \`${dst}\` SELECT * FROM \`${src}\``);
    const [[{ c }]] = await hrms.query(`SELECT COUNT(*) c FROM \`${dst}\``);
    log(`  ${dst}: ${c} rows`);
  }
}

async function backupsPresent(hrms) {
  const [rows] = await hrms.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?, ?)`,
    [BK_LINE, BK_COMP, BK_RUN]);
  return rows.length === 3;
}

async function main() {
  log(`mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  // LAN first, public second — see lib/db-connect.mjs. Which address works flips
  // with the network the machine is on, sometimes mid-run. `let` because a
  // reconnect replaces the connection object outright.
  let hrms = await connect('mas_hrms', { host: HRMS_HOST, log });
  let bill = await connect('db_bill', { host: BILL_HOST, log });
  const reconnect = async () => {
    try { await hrms.end(); } catch {}
    try { await bill.end(); } catch {}
    // A transient full-network drop (both LAN and public unreachable at once,
    // seen live: EHOSTUNREACH on both) used to crash reconnect() itself, taking
    // the whole run down on the very error this function exists to survive. Give
    // the network a chance to come back rather than dying on the first attempt.
    const RECONNECT_ATTEMPTS = 6;
    for (let i = 1; i <= RECONNECT_ATTEMPTS; i++) {
      try {
        log(`  reconnecting both connections (attempt ${i}/${RECONNECT_ATTEMPTS})...`);
        hrms = await connect('mas_hrms', { host: HRMS_HOST, log });
        bill = await connect('db_bill', { host: BILL_HOST, log });
        return;
      } catch (e) {
        if (i === RECONNECT_ATTEMPTS) throw e;
        log(`  reconnect attempt ${i} failed (${e.code || e.message}), waiting before retry...`);
        await sleep(5000 * i);
      }
    }
  };

  if (MAKE_BACKUP) { log('Backups:'); await ensureBackups(hrms); }
  if (APPLY && !await backupsPresent(hrms)) {
    log('REFUSING: --apply needs the backup tables. Run with --backup first.');
    await hrms.end(); await bill.end(); process.exit(2);
  }

  const [months] = await hrms.query('SELECT DISTINCT run_month m FROM salary_prep_run ORDER BY m');
  const T = { months: 0, lines: 0, unmatched: 0, ambiguous: 0,
              lineUpd: 0, grossFix: 0, netFix: 0, dedFix: 0, srcFix: 0, compIns: 0,
              compUpd: 0, compDel: 0, compSrcFix: 0, runUpd: 0, netFixAmt: 0 };

  const MAX_ATTEMPTS = 5;

  monthLoop:
  for (const { m } of months) {
    if (ONLY_MONTH && m !== ONLY_MONTH) continue;

  attemptLoop:
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {

    const [hr] = await hrms.query(
      `SELECT l.id, l.run_id, l.employee_id, e.employee_code ec,
              l.gross_salary, l.net_salary, l.total_deductions,
              l.basic, l.hra, l.special_allowance, l.attendance_data_source ads
         FROM salary_prep_line l
         JOIN employees e ON e.id = l.employee_id
        WHERE l.run_id IN (SELECT id FROM salary_prep_run WHERE run_month = ?)`, [m]);
    if (!hr.length) continue monthLoop;

    // SELECT * because COMPONENT_MAP reads 27 different columns and a column
    // missing from an explicit list would silently repair that head to zero.
    const [bl] = await bill.query(
      `SELECT * FROM salary_data WHERE DATE_FORMAT(SalDate, '%Y-%m') = ?`, [m]);

    const B = new Map(), dupes = new Set();
    for (const r of bl) {
      const k = String(r.EmpCode || '').trim();
      if (!k) continue;
      if (B.has(k)) dupes.add(k); else B.set(k, r);
    }

    const lineUpdates = [];   // [gross, basic, hra, sa, net, ded, ads, id]
    const compUpdates = [];   // [amount, name, line_id, code]
    const compInserts = [];   // full row
    const compDeletes = [];   // [line_id, code]

    // Which component heads each line already has, so a missing head can be
    // inserted rather than silently skipped.
    const [existing] = await hrms.query(
      `SELECT line_id, component_code FROM salary_prep_line_component
        WHERE run_id IN (SELECT id FROM salary_prep_run WHERE run_month = ?)`, [m]);
    const held = new Map();
    for (const c of existing) {
      if (!held.has(c.line_id)) held.set(c.line_id, new Set());
      held.get(c.line_id).add(c.component_code);
    }

    for (const r of hr) {
      T.lines++;
      const key = String(r.ec || '').trim();
      if (dupes.has(key)) { T.ambiguous++; continue; }
      const s = B.get(key);
      if (!s) { T.unmatched++; continue; }

      const gross = earnedGross(s);
      const net   = money(s.NetSalary);
      const ded   = money(totalDeductions(s));
      const basic = money(s[EARNED_COLUMN.Basic]);
      const hra   = money(s[EARNED_COLUMN.HRA]);
      const sa    = money(s[EARNED_COLUMN.SpecialAllowance]);
      const ads   = (r.ads === '' || r.ads === null) ? 'NO_DATA' : r.ads;

      const gFix = differs(r.gross_salary, gross);
      const nFix = differs(r.net_salary, net);
      const dFix = differs(r.total_deductions, ded);
      const sFix = ads !== r.ads;

      if (gFix || nFix || dFix || sFix
          || differs(r.basic, basic) || differs(r.hra, hra)
          || differs(r.special_allowance, sa)) {
        lineUpdates.push([gross, basic, hra, sa, net, ded, ads, r.id]);
        T.lineUpd++;
        if (gFix) T.grossFix++;
        if (nFix) { T.netFix++; T.netFixAmt += Math.abs(money(r.net_salary) - net); }
        if (dFix) T.dedFix++;
        if (sFix) T.srcFix++;
      }

      // Every head db_bill knows about, not just the pro-ratable earnings:
      //  - value non-zero, row absent  -> insert (SHSH, SHORT_COLL, PLI were never imported)
      //  - value non-zero, row present -> set amount + canonical name
      //  - value zero,     row present -> delete (a full-entitlement line item for
      //                                   someone who earned nothing that month)
      const has = held.get(r.id) ?? new Set();
      for (const [code, name, ctype, col] of COMPONENT_MAP) {
        const want = money(s[col]);
        if (want === 0) { if (has.has(code)) compDeletes.push([r.id, code]); continue; }
        if (has.has(code)) compUpdates.push([want, name, r.id, code]);
        else compInserts.push([uuid(), r.run_id, r.id, r.employee_id,
                               code, name, ctype, want, 'snapshot']);
      }
    }

    if (!APPLY) {
      // Count what would happen so the dry run reports the same shape as --apply.
      // compUpd is an upper bound here: the UPDATE is a no-op where the row
      // already holds the right amount and name.
      T.compUpd += compUpdates.length;
      T.compIns += compInserts.length;
      T.compDel += compDeletes.length;
      T.runUpd  += 1;
      log(`  ${m}: ${hr.length} lines — ${lineUpdates.length} lines, `
        + `${compInserts.length} comp inserts, ${compDeletes.length} comp deletes`
        + `${dupes.size ? `, ${dupes.size} ambiguous db_bill codes skipped` : ''}`);
      T.months++;
      continue monthLoop;
    }

    await hrms.beginTransaction();
    try {
      for (const u of lineUpdates) {
        await hrms.execute(
          `UPDATE salary_prep_line
              SET gross_salary = ?, basic = ?, hra = ?, special_allowance = ?,
                  net_salary = ?, total_deductions = ?, attendance_data_source = ?
            WHERE id = ?`, u);
      }
      for (const [amt, name, lineId, code] of compUpdates) {
        const [res] = await hrms.execute(
          `UPDATE salary_prep_line_component
              SET amount = ?, component_name = ?, source = 'snapshot'
            WHERE line_id = ? AND component_code = ?
              AND (amount <> ? OR component_name <> ? OR source = '')`,
          [amt, name, lineId, code, amt, name]);
        T.compUpd += res.affectedRows;
      }
      for (let i = 0; i < compInserts.length; i += 200) {
        const chunk = compInserts.slice(i, i + 200);
        const ph = chunk.map(() => '(?,?,?,?,?,?,?,?,?)').join(',');
        const [res] = await hrms.execute(
          `INSERT INTO salary_prep_line_component
             (id, run_id, line_id, employee_id, component_code, component_name,
              component_type, amount, source)
           VALUES ${ph}`, chunk.flat());
        T.compIns += res.affectedRows;
      }
      for (const [lineId, code] of compDeletes) {
        const [res] = await hrms.execute(
          `DELETE FROM salary_prep_line_component WHERE line_id = ? AND component_code = ?`,
          [lineId, code]);
        T.compDel += res.affectedRows;
      }
      // Remaining '' provenance on this run's untouched components.
      const [sres] = await hrms.execute(
        `UPDATE salary_prep_line_component SET source = 'snapshot'
          WHERE source = '' AND run_id IN (SELECT id FROM salary_prep_run WHERE run_month = ?)`, [m]);
      T.compSrcFix += sres.affectedRows;

      // Header derived from the lines it owns.
      const [rres] = await hrms.execute(
        `UPDATE salary_prep_run r
            SET r.total_employees = (SELECT COUNT(*)              FROM salary_prep_line l WHERE l.run_id = r.id),
                r.total_gross     = (SELECT COALESCE(SUM(l.gross_salary),0) FROM salary_prep_line l WHERE l.run_id = r.id),
                r.total_net       = (SELECT COALESCE(SUM(l.net_salary),0)   FROM salary_prep_line l WHERE l.run_id = r.id)
          WHERE r.run_month = ?`, [m]);
      T.runUpd += rres.affectedRows;

      await hrms.commit();
      log(`  ${m}: ${lineUpdates.length} lines updated, run header recomputed`);
      T.months++;
    } catch (e) {
      // A dead connection makes rollback() itself throw. That used to crash the
      // whole process on a network blip — guard it so the ORIGINAL error still
      // reaches the retry handler below, not a second, more confusing one.
      try { await hrms.rollback(); }
      catch (rollbackErr) {
        log(`  ${m}: rollback itself failed (${rollbackErr.code || rollbackErr.message}) — connection is dead, not the data`);
      }
      log(`  ${m}: ROLLED BACK — ${e.code || ''} ${e.message}`);
      throw e;
    }

    break attemptLoop; // this month is fully committed (or was a clean dry-run pass)

    } catch (monthErr) {
      if (!isTransient(monthErr) || attempt === MAX_ATTEMPTS) throw monthErr;
      log(`  ${m}: transient error (${monthErr.code || monthErr.message}) — `
        + `attempt ${attempt}/${MAX_ATTEMPTS}, reconnecting and retrying this month...`);
      await reconnect();
      // A dead connection's locks aren't always released the instant it drops.
      // Give the server time to finish that cleanup before retrying the same
      // rows, or the retry can walk straight into ER_LOCK_WAIT_TIMEOUT.
      await sleep(8000 * attempt);
    }
  } // attemptLoop
  }

  T.netFixAmt = Math.round(T.netFixAmt);
  log('Summary: ' + JSON.stringify(T));
  if (!APPLY) log('DRY RUN — nothing was written. Re-run with --backup then --apply.');
  await hrms.end(); await bill.end();
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
