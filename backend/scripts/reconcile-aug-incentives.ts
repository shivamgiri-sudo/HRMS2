/**
 * Reconcile August 2026 incentives between db_bill and HRMS.
 *
 * WHY
 *   db_bill.upload_incentive_breakup (Aug 2026, ApproveStatus='Approve') is what the legacy payroll
 *   paid. HRMS incentive_upload_batch (pay_month 2026-08) disagrees in two ways:
 *     1. AHMEDABAD-JALDARSHAN is in HRMS TWICE - BATCH-DBBILL-AHMJD-2026-08 (a db_bill-derived
 *        copy) and the native typed batches (CPI, WO_ADJ, ATT_INC ...). The engine sums every
 *        approved batch, so recalculating the run would pay those incentives twice.
 *     2. NOIDA, NOIDA-2, NOIDA-DIALDESK and HEAD OFFICE rows uploaded in db_bill were never loaded
 *        into HRMS at all.
 *
 * WHAT IT DOES (with --apply)
 *   a. Marks BATCH-DBBILL-AHMJD-2026-08 'rejected' (superseded by the native batches). Lines are
 *      kept, only the batch status changes, so it is reversible.
 *   b. For every employee and incentive type, compares db_bill's Aug total with the HRMS native
 *      approved total and inserts ONE approved top-up line for any positive shortfall, grouped
 *      into one batch per (employee branch, incentive type).
 *   After this, an employee's HRMS August incentive equals db_bill's. It never reduces an
 *   amount: where HRMS already holds MORE than db_bill it only reports it.
 *
 * SAFETY
 *   Dry run by default: reads only, prints the plan, writes nothing. --apply does everything in ONE
 *   transaction and re-reads the totals before committing, rolling back if any employee does not
 *   end up equal to db_bill. An IncentiveType with no incentive_master match is reported and
 *   skipped, never guessed. Re-running is a no-op (top-up batches are looked up by batch_ref).
 *
 *   Needs db_bill access, so run it where BILL_DB_HOST / BILL_DB_PORT / BILL_DB_USER /
 *   BILL_DB_PASSWORD / BILL_DB_NAME are set, from the backend directory:
 *     npx tsx scripts/reconcile-aug-incentives.ts            # dry run
 *     npx tsx scripts/reconcile-aug-incentives.ts --apply    # write
 *   Recalculate the 2026-08 payroll run afterwards to pick the incentives up.
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";

const APPLY = process.argv.includes("--apply");
const MONTH = "2026-08";
const DUP_BATCH = "BATCH-DBBILL-AHMJD-2026-08";
const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
const key = (code: string) => String(code ?? "").trim().toUpperCase();
const money = (n: number) => Math.round(n * 100) / 100;

async function main() {
  // ── masters ────────────────────────────────────────────────────────────────────────────────
  const [masters] = await db.execute<RowDataPacket[]>(
    `SELECT id, incentive_code, incentive_name FROM incentive_master`,
  );
  const byName = new Map<string, { id: string; code: string }>();
  for (const m of masters as any[]) byName.set(norm(m.incentive_name), { id: m.id, code: m.incentive_code });
  const codeToId = new Map<string, string>((masters as any[]).map((m) => [m.incentive_code, m.id]));
  // db_bill spellings that differ from incentive_master. 'OT Incentive' is the master's
  // 'Overtime Incentive' (OT): the Aug upload holds 155 rows / ₹1,78,000 in both systems.
  for (const [alias, code] of [["OT Incentive", "OT"]] as const) {
    const id = codeToId.get(code);
    if (id) byName.set(norm(alias), { id, code });
  }

  // ── db_bill: approved Aug uploads, per employee + type ─────────────────────────────────────
  const bill = (await billQuery(
    `SELECT EmpCode, IncentiveType, SUM(Amount) AS amt
       FROM upload_incentive_breakup
      WHERE SalaryMonth >= '${MONTH}-01' AND SalaryMonth < DATE_ADD('${MONTH}-01', INTERVAL 1 MONTH)
        AND ApproveStatus = 'Approve' AND EmpCode IS NOT NULL AND TRIM(EmpCode) <> ''
      GROUP BY EmpCode, IncentiveType`,
  )) as Array<{ EmpCode: string; IncentiveType: string; amt: number }>;

  // ── HRMS: approved native Aug lines (everything except the duplicate batch) ────────────────
  const [hr] = await db.execute<RowDataPacket[]>(
    `SELECT l.employee_code AS code, l.incentive_code AS icode, SUM(l.amount) AS amt
       FROM incentive_upload_line l JOIN incentive_upload_batch b ON b.id = l.batch_id
      WHERE b.pay_month = ? AND b.status IN ('approved','applied') AND b.batch_ref <> ?
        AND b.batch_ref NOT LIKE 'BATCH-DBBILL-TOPUP-%'
      GROUP BY l.employee_code, l.incentive_code`,
    [MONTH, DUP_BATCH],
  );
  const have = new Map<string, number>(); // "CODE|ICODE" -> amount
  for (const r of hr as any[]) have.set(`${key(r.code)}|${r.icode}`, Number(r.amt));
  // Top-ups from an earlier run of this script are real HRMS rows too - count them, so a re-run is a no-op.
  const [tu] = await db.execute<RowDataPacket[]>(
    `SELECT l.employee_code AS code, l.incentive_code AS icode, SUM(l.amount) AS amt
       FROM incentive_upload_line l JOIN incentive_upload_batch b ON b.id = l.batch_id
      WHERE b.pay_month = ? AND b.status IN ('approved','applied') AND b.batch_ref LIKE 'BATCH-DBBILL-TOPUP-%'
      GROUP BY l.employee_code, l.incentive_code`,
    [MONTH],
  );
  for (const r of tu as any[]) {
    const k = `${key(r.code)}|${r.icode}`;
    have.set(k, (have.get(k) ?? 0) + Number(r.amt));
  }

  // ── employees ───────────────────────────────────────────────────────────────────────────────
  // Plain `employee_code IN (...)` so the index is used; codes are compared upper-cased in JS.
  const rawCodes = [...new Set(bill.map((b) => String(b.EmpCode).trim()))];
  const codes = [...new Set(rawCodes.map(key))];
  const emp = new Map<string, any>();
  for (let i = 0; i < rawCodes.length; i += 300) {
    const chunk = rawCodes.slice(i, i + 300);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.id, e.employee_code, e.branch_id, e.cost_centre_id, bm.branch_name
         FROM employees e LEFT JOIN branch_master bm ON bm.id = e.branch_id
        WHERE e.employee_code IN (${chunk.map(() => "?").join(",")})`,
      chunk,
    );
    for (const r of rows as any[]) emp.set(key(r.employee_code), r);
  }
  console.log(`loaded: db_bill ${bill.length} rows, HRMS lines ${have.size}, employees ${emp.size}/${codes.length}`);

  // ── plan ────────────────────────────────────────────────────────────────────────────────────
  type Line = { empId: string; code: string; icode: string; amount: number; branchId: string | null; ccId: string | null; branchName: string };
  const lines: Line[] = [];
  const unmappedTypes = new Map<string, number>();
  const noEmployee: string[] = [];
  const higher: Array<{ code: string; icode: string; hrms: number; bill: number }> = [];
  const billTotals = new Map<string, number>();

  for (const b of bill) {
    const code = key(b.EmpCode);
    const m = byName.get(norm(b.IncentiveType));
    const amt = money(Number(b.amt));
    billTotals.set(code, money((billTotals.get(code) ?? 0) + amt));
    if (!m) { unmappedTypes.set(b.IncentiveType, (unmappedTypes.get(b.IncentiveType) ?? 0) + amt); continue; }
    const e = emp.get(code);
    if (!e) { if (!noEmployee.includes(code)) noEmployee.push(code); continue; }
    const hv = have.get(`${code}|${m.code}`) ?? 0;
    const gap = money(amt - hv);
    if (gap > 0.009) lines.push({ empId: e.id, code, icode: m.code, amount: gap, branchId: e.branch_id, ccId: e.cost_centre_id, branchName: e.branch_name ?? "?" });
    else if (gap < -0.009) higher.push({ code, icode: m.code, hrms: hv, bill: amt });
  }

  const [dup] = await db.execute<RowDataPacket[]>(
    `SELECT id, status, (SELECT COUNT(*) FROM incentive_upload_line l WHERE l.batch_id = b.id) AS n,
            (SELECT COALESCE(SUM(l.amount),0) FROM incentive_upload_line l WHERE l.batch_id = b.id) AS amt
       FROM incentive_upload_batch b WHERE batch_ref = ?`, [DUP_BATCH]);
  const dupRow = (dup as any[])[0];

  console.log(`\n=== ${APPLY ? "APPLY" : "DRY RUN (nothing is written)"} - August 2026 incentives ===`);
  console.log(`db_bill approved upload: ${codes.length} employees, ₹${[...billTotals.values()].reduce((a, b) => a + b, 0).toLocaleString("en-IN")}`);
  console.log(dupRow
    ? `Duplicate batch ${DUP_BATCH}: status=${dupRow.status}, ${dupRow.n} lines, ₹${Number(dupRow.amt).toLocaleString("en-IN")} -> ${dupRow.status === "approved" ? "will be marked 'rejected'" : "already not approved, nothing to do"}`
    : `Duplicate batch ${DUP_BATCH}: not found`);
  const grp = new Map<string, { n: number; amt: number }>();
  for (const l of lines) { const k = `${l.branchName} | ${l.icode}`; const g = grp.get(k) ?? { n: 0, amt: 0 }; g.n++; g.amt += l.amount; grp.set(k, g); }
  console.log(`\nTop-up lines to insert: ${lines.length}, ₹${lines.reduce((a, l) => a + l.amount, 0).toLocaleString("en-IN")}`);
  console.table([...grp].sort().map(([k, v]) => ({ "branch | type": k, lines: v.n, amount: money(v.amt) })));
  if (unmappedTypes.size) { console.log("SKIPPED - IncentiveType has no incentive_master match (fix the master, then re-run):"); console.table([...unmappedTypes].map(([t, a]) => ({ type: t, amount: a }))); }
  if (noEmployee.length) console.log(`SKIPPED - employee code not in HRMS (${noEmployee.length}): ${noEmployee.slice(0, 20).join(", ")}`);
  if (higher.length) { console.log(`REPORT ONLY - HRMS already holds more than db_bill (${higher.length}); never reduced:`); console.table(higher.slice(0, 20)); }

  if (!APPLY) { console.log("\nDry run complete. Re-run with --apply to write."); return; }

  // ── apply, one transaction ──────────────────────────────────────────────────────────────────
  const [tpl] = await db.execute<RowDataPacket[]>(
    `SELECT uploaded_by, approval_chain, current_approval_step FROM incentive_upload_batch WHERE batch_ref = ? LIMIT 1`, [DUP_BATCH]);
  const t = (tpl as any[])[0] ?? { uploaded_by: null, approval_chain: null, current_approval_step: 0 };
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    if (dupRow?.status === "approved") {
      await conn.execute(
        `UPDATE incentive_upload_batch SET status = 'rejected',
                remarks = CONCAT(COALESCE(remarks,''), ' [superseded by native Aug batches - duplicate incentives, set rejected by reconcile-aug-incentives]')
          WHERE id = ? AND status = 'approved'`, [dupRow.id]);
    }
    const batches = new Map<string, string>();
    for (const l of lines) {
      const bk = `${l.branchId ?? "none"}|${l.icode}`;
      let bid = batches.get(bk);
      if (!bid) {
        const ref = `BATCH-DBBILL-TOPUP-${MONTH}-${l.icode}-${String(l.branchId ?? "NONE").slice(0, 8)}`;
        const [ex] = await conn.execute<RowDataPacket[]>(`SELECT id FROM incentive_upload_batch WHERE batch_ref = ?`, [ref]);
        if ((ex as any[]).length) bid = (ex as any[])[0].id;
        else {
          bid = randomUUID();
          await conn.execute(
            `INSERT INTO incentive_upload_batch
               (id, incentive_id, batch_ref, salary_month, uploaded_by, branch_id, total_employees, total_amount,
                status, approval_chain, current_approval_step, pay_month, remarks, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'approved', ?, ?, ?, ?, NOW(), NOW())`,
            [bid, codeToId.get(l.icode), ref, MONTH, t.uploaded_by, l.branchId,
             t.approval_chain == null ? null : (typeof t.approval_chain === "string" ? t.approval_chain : JSON.stringify(t.approval_chain)),
             t.current_approval_step ?? 0, MONTH,
             "Top-up from db_bill upload_incentive_breakup (Aug 2026), by reconcile-aug-incentives"]);
        }
        batches.set(bk, bid!);
      }
      await conn.execute(
        `INSERT INTO incentive_upload_line
           (id, batch_id, employee_id, employee_code, incentive_code, amount, remarks, validation_status, branch_id, cost_centre_id, created_at)
         VALUES (UUID(), ?, ?, ?, ?, ?, 'db_bill Aug 2026 top-up', 'ok', ?, ?, NOW())`,
        [bid, l.empId, l.code, l.icode, l.amount, l.branchId, l.ccId]);
    }
    for (const bid of new Set(batches.values())) {
      await conn.execute(
        `UPDATE incentive_upload_batch b SET
            total_employees = (SELECT COUNT(DISTINCT employee_id) FROM incentive_upload_line WHERE batch_id = b.id),
            total_amount    = (SELECT COALESCE(SUM(amount),0) FROM incentive_upload_line WHERE batch_id = b.id)
          WHERE b.id = ?`, [bid]);
    }

    // verify: every employee's approved HRMS total must now equal db_bill's (or exceed it, reported above)
    const [after] = await conn.execute<RowDataPacket[]>(
      `SELECT UPPER(TRIM(l.employee_code)) AS code, SUM(l.amount) AS amt
         FROM incentive_upload_line l JOIN incentive_upload_batch b ON b.id = l.batch_id
        WHERE b.pay_month = ? AND b.status IN ('approved','applied') GROUP BY 1`, [MONTH]);
    const A = new Map((after as any[]).map((r) => [r.code as string, Number(r.amt)]));
    const bad = [...billTotals].filter(([c, v]) => emp.has(c) && (A.get(c) ?? 0) + 0.01 < v);
    if (bad.length) throw new Error(`verification failed for ${bad.length} employees, e.g. ${bad.slice(0, 5).map(([c, v]) => `${c} bill ${v} hrms ${A.get(c) ?? 0}`).join("; ")}`);
    await conn.commit();
    console.log(`\nCOMMITTED: ${lines.length} top-up lines in ${new Set(batches.values()).size} batches; ${dupRow?.status === "approved" ? "duplicate batch rejected" : "no duplicate to reject"}.`);
  } catch (e) {
    await conn.rollback();
    console.error("ROLLED BACK:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    conn.release();
  }
}

main().then(async () => { await closeBillPool(); await db.end?.(); }).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end?.(); } catch { } process.exit(1); });
