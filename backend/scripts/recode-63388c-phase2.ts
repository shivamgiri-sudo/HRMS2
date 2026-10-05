/**
 * 63388C code clash, PHASE 2 - give the db_bill person (Tina, now employees.employee_code = 63388C) the salary
 * package and attendance that db_bill holds. dry-run (default) prints every row it would write; --apply writes.
 *
 *   --step=salary      employee_salary_assignment + salary_component_assignments (basic/gross/PF/ESI as db_bill)
 *   --step=attendance  attendance_daily_record, one row per db_bill Attandence day (P/A/HD), never overwriting a row
 *   --step=statutory   REPORT ONLY: which of UAN / passport / qualification db_bill holds (presence, never values)
 *   (no --step)        all three; only salary and attendance write
 *
 * Not here: Talabhai's post-exit attendance rows (reported, not moved), the August payroll line (recalculate after
 * these two steps), COSEC enrollment. Refuses to run unless HRMS 63388C is Tina (name check).
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";

const CODE = "63388C";
const APPLY = process.argv.includes("--apply");
const STEP = (process.argv.find((a) => a.startsWith("--step="))?.split("=")[1] ?? "all").toLowerCase();
const want = (s: string) => STEP === "all" || STEP === s;
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];
const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const local = (v: unknown) => (v instanceof Date ? v.toLocaleDateString("en-CA") : String(v).slice(0, 10));

// db_bill Attandence.Status -> [HRMS attendance_status, lwp_value]. Anything else stops the run.
const STATUS_MAP: Record<string, [string, number]> = { P: ["present", 0], A: ["absent", 1], HD: ["half_day", 0.5] };

async function main() {
  console.log(`${APPLY ? "MODE: APPLY" : "MODE: DRY-RUN (no writes)"}  step=${STEP}`);
  const [tina] = await q(`SELECT id, first_name, last_name FROM employees WHERE employee_code = ?`, [CODE]);
  const [bill] = await billQuery<RowDataPacket>(
    `SELECT EmpName, DOJ, CTC, Gross, bs, hra, conv, da, portf, ma, lta, mob, sa, oa, PFELig, ESIElig, UAN, PassportNo, Qualification
       FROM masjclrentry WHERE UPPER(TRIM(EmpCode)) = ? LIMIT 1`, [CODE]);
  if (!tina || `${tina.first_name} ${tina.last_name ?? ""}`.trim().toUpperCase() !== "TINA DIPAKBHAI VALERA") {
    console.error("PRECONDITION FAILED: HRMS 63388C is not Tina"); process.exitCode = 2; return;
  }
  if (!bill || String(bill.EmpName).trim().toUpperCase() !== "TINA DIPAKBHAI VALERA") {
    console.error("PRECONDITION FAILED: db_bill 63388C is not Tina"); process.exitCode = 2; return;
  }
  const empId = String(tina.id);
  const doj = local(bill.DOJ);
  console.log(`Tina id=${empId}, DOJ=${doj}`);

  if (want("statutory")) {
    console.log("\n== statutory (report only) ==");
    for (const k of ["UAN", "PassportNo", "Qualification"]) {
      console.log(`  ${k}: ${String(bill[k] ?? "").trim() ? "present in db_bill" : "blank in db_bill"}`);
    }
  }

  if (want("salary")) {
    console.log("\n== salary ==");
    const pkg = {
      basic: num(bill.bs), hra: num(bill.hra), conveyance: num(bill.conv), portfolio: num(bill.portf),
      medical_allowance: num(bill.ma), lta: num(bill.lta), special_allowance: num(bill.sa), other_allowance: num(bill.oa),
    };
    const gross = num(bill.Gross);
    const sum = Object.values(pkg).reduce((a, b) => a + b, 0) + num(bill.da) + num(bill.mob);
    console.log("  package:", JSON.stringify(pkg), "gross:", gross, "components sum (incl. da/mob):", sum);
    if (gross <= 0) throw new Error("db_bill Gross is 0 - never copied");
    if (Math.abs(sum - gross) > 1) throw new Error(`components (${sum}) do not add up to Gross (${gross})`);
    if (num(bill.da) || num(bill.mob)) throw new Error("db_bill has da/mob amounts that HRMS has no column for - decide first");
    const pf = String(bill.PFELig ?? "").trim().toUpperCase() === "YES" ? 1 : 0;
    const esi = String(bill.ESIElig ?? "").trim().toUpperCase() === "YES" ? 1 : 0;
    console.log(`  PF applicable=${pf}, ESI applicable=${esi}, effective ${doj}, ctc_annual=${num(bill.CTC) * 12}`);
    const scaCols = new Set(
      (await q(`SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_component_assignments'`))
        .map((r) => String(r.c)));
    const hasPf = scaCols.has("pf_applicable") && scaCols.has("esi_applicable");
    console.log(`  salary_component_assignments has pf/esi flags: ${hasPf}`);
    const sca = await q(`SELECT id FROM salary_component_assignments WHERE employee_id = ?`, [empId]);
    const esa = await q(`SELECT id FROM employee_salary_assignment WHERE employee_id = ?`, [empId]);
    console.log(`  existing for Tina: sca rows=${sca.length}, esa rows=${esa.length}`);
    const alreadyDone = sca.length === 1 && esa.length === 1;
    if ((sca.length || esa.length) && !alreadyDone) throw new Error("Tina has a partial/unexpected set of salary rows - refusing to add more");
    if (alreadyDone) console.log("  salary already applied (1 sca + 1 esa) - skipping");
    if (APPLY && !alreadyDone) {
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        await conn.execute(
          `INSERT INTO employee_salary_assignment (id, employee_id, structure_id, ctc_annual, effective_from, active_status) VALUES (?, ?, NULL, ?, ?, 1)`,
          [randomUUID(), empId, num(bill.CTC) * 12, doj]);
        const f = hasPf ? ", pf_applicable, esi_applicable" : "";
        const v = hasPf ? ", ?, ?" : "";
        await conn.execute(
          `INSERT INTO salary_component_assignments
             (id, employee_id, effective_date, basic, hra, bonus, conveyance, portfolio, medical_allowance, lta, special_allowance,
              other_allowance, pli, gross, status, approval_reference${f})
           VALUES (?,?,?,?,?,0,?,?,?,?,?,?,0,?,'active','db_bill 63388C mirror'${v})`,
          [randomUUID(), empId, doj, pkg.basic, pkg.hra, pkg.conveyance, pkg.portfolio, pkg.medical_allowance, pkg.lta,
           pkg.special_allowance, pkg.other_allowance, gross, ...(hasPf ? [pf, esi] : [])]);
        await conn.commit();
        console.log("  SALARY written");
      } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
    }
  }

  if (want("attendance")) {
    console.log("\n== attendance ==");
    const days = await billQuery<RowDataPacket>(
      `SELECT AttandDate, Status FROM Attandence WHERE UPPER(TRIM(EmpCode)) = ? ORDER BY AttandDate`, [CODE]);
    const bad = days.filter((d) => !STATUS_MAP[String(d.Status).trim().toUpperCase()]);
    if (bad.length) throw new Error(`unmapped db_bill statuses: ${[...new Set(bad.map((d) => d.Status))].join(",")}`);
    const rows = days.map((d) => ({ date: local(d.AttandDate), st: STATUS_MAP[String(d.Status).trim().toUpperCase()] }));
    const tally: Record<string, number> = {};
    for (const r of rows) tally[r.st[0]] = (tally[r.st[0]] ?? 0) + 1;
    console.log(`  db_bill days: ${rows.length}, ${rows[0]?.date} .. ${rows[rows.length - 1]?.date}`, JSON.stringify(tally));
    const dist = await q(
      `SELECT attendance_status s, lwp_value l, COUNT(*) n FROM attendance_daily_record WHERE record_date >= '2026-09-01' GROUP BY s, l ORDER BY n DESC LIMIT 12`);
    console.log("  HRMS convention check (status, lwp_value, count, Sept on):", JSON.stringify(dist));
    const existing = await q(
      `SELECT DATE_FORMAT(record_date,'%Y-%m-%d') d, attendance_status s, lwp_value l, status_change_reason r FROM attendance_daily_record WHERE employee_id = ? ORDER BY record_date`, [empId]);
    const have = new Set(existing.map((r) => String(r.d)));
    const billByDate = new Map(rows.map((r) => [r.date, r.st]));
    console.log(`  already in HRMS for Tina: ${existing.length} (never overwritten here):`);
    for (const e of existing) {
      const b = billByDate.get(String(e.d));
      const verdict = !b ? "no db_bill row for this date" : b[0] === e.s ? "matches db_bill" : `DIFFERS from db_bill (${b[0]})`;
      console.log(`   ${e.d} ${e.s} lwp=${e.l} reason=${e.r ?? "-"} -> ${verdict}`);
    }
    const preDoj = rows.filter((r) => r.date < doj);
    if (preDoj.length) console.log(`  skipping ${preDoj.length} db_bill day(s) before DOJ ${doj}: ${preDoj.map((r) => `${r.date} ${r.st[0]}`).join(", ")}`);
    const todo = rows.filter((r) => !have.has(r.date) && r.date >= doj);
    // Pipeline placeholders (missing_punch, unlocked) that db_bill resolved to a real status are brought in line.
    const fixes = existing
      .map((e) => ({ d: String(e.d), cur: String(e.s), b: billByDate.get(String(e.d)) }))
      .filter((x) => x.b && x.cur === "missing_punch" && x.b[0] !== x.cur);
    console.log(`  to update (missing_punch -> db_bill status): ${fixes.length}`);
    for (const f of fixes) console.log(`   ${f.d} missing_punch -> ${f.b![0]} lwp=${f.b![1]}`);
    console.log(`  to insert: ${todo.length}`);
    for (const r of todo) console.log(`   ${r.date} ${r.st[0]} lwp=${r.st[1]}`);
    if (APPLY && fixes.length) {
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        for (const f of fixes) {
          const [u] = await conn.execute<any>(
            `UPDATE attendance_daily_record SET attendance_status = ?, lwp_value = ?, status_change_reason = 'db_bill 63388C mirror'
              WHERE employee_id = ? AND record_date = ? AND attendance_status = 'missing_punch' AND is_locked = 0`,
            [f.b![0], f.b![1], empId, f.d]);
          if (u.affectedRows !== 1) throw new Error(`update of ${f.d} affected ${u.affectedRows} rows`);
        }
        await conn.commit();
        console.log(`  ATTENDANCE updated: ${fixes.length} rows`);
      } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
    }
    if (APPLY && todo.length) {
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        for (const r of todo) {
          await conn.execute(
            `INSERT INTO attendance_daily_record (id, employee_id, record_date, attendance_status, lwp_value, status_change_reason, created_by)
             VALUES (?, ?, ?, ?, ?, 'db_bill 63388C mirror', 'db_bill_63388c_mirror')`,
            [randomUUID(), empId, r.date, r.st[0], r.st[1]]);
        }
        await conn.commit();
        console.log(`  ATTENDANCE written: ${todo.length} rows`);
      } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
    }
    const [t] = await q(`SELECT id FROM employees WHERE employee_code = '63388C-OLD'`);
    if (t) {
      const post = await q(
        `SELECT attendance_status s, COUNT(*) n FROM attendance_daily_record WHERE employee_id = ? AND record_date > '2026-08-24' GROUP BY s`, [t.id]);
      console.log("  REPORT: Talabhai (63388C-OLD) rows after his 2026-08-24 exit, left untouched:", JSON.stringify(post));
    }
  }
  if (!APPLY) console.log("\nDry-run only. Nothing written.");
}
main().catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await closeBillPool().catch(() => {}); process.exit(process.exitCode ?? 0); });
