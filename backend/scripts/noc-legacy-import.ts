/**
 * Bring NOC clearances recorded in the old system (db_bill) into HRMS.
 *
 * A leaver whose db_bill record carries a NOC validation (NocValidateDate / By / Remarks) must not show
 * as pending in HRMS. For each such person who is no longer active in HRMS:
 *   - no NOC case yet      -> insert one, status 'completed', completed_at = the validation date
 *   - open NOC case        -> complete it, and mark its still-pending stages cleared by the old system
 *   - already completed    -> untouched
 * Every row keeps its origin in legacy_source / legacy_validated_by / _at / _remarks.
 *
 * Skipped and counted, never guessed: validation dates before year 2000 (db_bill holds year-0 values),
 * employees not found in HRMS, employees still active in HRMS.
 *
 * DRY RUN BY DEFAULT: reads only and prints what it would do. It writes nothing unless NOC_IMPORT_APPLY=true
 * and NOC_IMPORT_CONFIRM=noc-legacy-import. Writes run in batches, each in one transaction. Idempotent:
 * a re-run finds those people already completed and does nothing. db_bill is read through SELECT only.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const APPLY = process.env.NOC_IMPORT_APPLY === "true" && process.env.NOC_IMPORT_CONFIRM === "noc-legacy-import";
const BATCH = 200;
const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} is not set`); return v; };

const bill = await mysql.createConnection({
  host: need("BILL_DB_HOST"), port: Number(process.env.BILL_DB_PORT || 3306),
  user: need("BILL_DB_USER"), password: need("BILL_DB_PASSWORD"), database: need("BILL_DB_NAME"), connectTimeout: 20000,
});
const [billRows] = await bill.query(
  `SELECT EmpCode AS code, NocValidateDate AS vdate, NocValidateBy AS vby, NocValidateRemarks AS vrem
     FROM masjclrentry WHERE TRIM(CAST(Status AS CHAR)) = '0' AND NocValidateDate IS NOT NULL`,
) as unknown as [Array<{ code: string; vdate: Date | string; vby: string | null; vrem: string | null }>];
await bill.end();

const counts = { billValidated: billRows.length, badDate: 0, notInHrms: 0, stillActive: 0, alreadyCompleted: 0, wouldInsert: 0, wouldCompleteOpen: 0 };
type Plan = { employeeId: string; code: string; vdate: string; vby: string; vrem: string; caseId: string | null };
const plan: Plan[] = [];

for (let i = 0; i < billRows.length; i += 500) {
  const chunk = billRows.slice(i, i + 500);
  const codes = chunk.map((r) => String(r.code).trim());
  const [emps] = await db.query<RowDataPacket[]>(
    `SELECT e.id, UPPER(e.employee_code) AS code, LOWER(COALESCE(e.employment_status,'')) AS st,
            (SELECT nc.id FROM noc_case nc WHERE nc.employee_id = e.id LIMIT 1) AS case_id,
            (SELECT nc.status FROM noc_case nc WHERE nc.employee_id = e.id LIMIT 1) AS case_status
       FROM employees e WHERE e.employee_code IN (?)`, [codes],
  );
  const byCode = new Map(emps.map((e) => [String(e.code), e]));
  for (const r of chunk) {
    const d = new Date(r.vdate as string);
    if (!Number.isFinite(d.getTime()) || d.getFullYear() < 2000) { counts.badDate++; continue; }
    const e = byCode.get(String(r.code).trim().toUpperCase());
    if (!e) { counts.notInHrms++; continue; }
    if (e.st === "active") { counts.stillActive++; continue; }
    if (e.case_status === "completed") { counts.alreadyCompleted++; continue; }
    if (e.case_id) counts.wouldCompleteOpen++; else counts.wouldInsert++;
    plan.push({
      employeeId: String(e.id), code: String(e.code),
      vdate: d.toISOString().slice(0, 19).replace("T", " "),
      vby: String(r.vby ?? "").trim().slice(0, 120), vrem: String(r.vrem ?? "").trim().slice(0, 500),
      caseId: e.case_id ? String(e.case_id) : null,
    });
  }
}
console.log(`mode: ${APPLY ? "APPLY" : "DRY RUN (nothing written)"}`);
console.log(JSON.stringify(counts));
console.log(`validated years in plan: ${JSON.stringify(plan.reduce((a: Record<string, number>, p) => { const y = p.vdate.slice(0, 4); a[y] = (a[y] ?? 0) + 1; return a; }, {}))}`);

if (!APPLY) { console.log("Re-run with NOC_IMPORT_APPLY=true and NOC_IMPORT_CONFIRM=noc-legacy-import to write."); await db.end?.(); process.exit(0); }

let inserted = 0, completed = 0, failed = 0;
for (let i = 0; i < plan.length; i += BATCH) {
  const batch = plan.slice(i, i + BATCH);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const p of batch) {
      if (p.caseId) {
        await conn.execute(
          `UPDATE noc_case SET status = 'completed', completed_at = ?, legacy_source = 'db_bill',
                  legacy_validated_by = ?, legacy_validated_at = ?, legacy_remarks = ?
            WHERE id = ? AND status <> 'completed'`,
          [p.vdate, p.vby, p.vdate, p.vrem, p.caseId],
        );
        await conn.execute(
          `UPDATE noc_signatory SET status = 'acknowledged', acted_by_user_id = 'legacy:db_bill',
                  acted_by_name = 'Cleared in old system', acted_by_role = 'system', acted_at = ?,
                  remarks = ? WHERE noc_case_id = ? AND status = 'pending'`,
          [p.vdate, `Cleared in old system by ${p.vby || "unknown"}`.slice(0, 500), p.caseId],
        );
        completed++;
      } else {
        const [info] = await conn.query<RowDataPacket[]>(
          `SELECT e.branch_id, e.process_id, e.full_name, b.branch_name, pm.process_name, d.designation_name,
                  (SELECT er.id FROM exit_request er WHERE er.employee_id = e.id ORDER BY er.created_at DESC LIMIT 1) AS exit_id,
                  (SELECT COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed) FROM exit_request er
                    WHERE er.employee_id = e.id ORDER BY er.created_at DESC LIMIT 1) AS lwd
             FROM employees e
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master pm ON pm.id = e.process_id
             LEFT JOIN designation_master d ON d.id = e.designation_id
            WHERE e.id = ? LIMIT 1`, [p.employeeId],
        );
        const x = info[0] ?? {};
        await conn.execute(
          `INSERT INTO noc_case (id, employee_id, exit_request_id, branch_id, process_id, employee_code, employee_name,
              location, portfolio, designation, initiator_role, initiated_at, last_working_day, status, completed_at,
              legacy_source, legacy_validated_by, legacy_validated_at, legacy_remarks)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'system', ?, ?, 'completed', ?, 'db_bill', ?, ?, ?)`,
          [randomUUID(), p.employeeId, x.exit_id ?? null, x.branch_id ?? null, x.process_id ?? null, p.code,
           x.full_name ?? null, x.branch_name ?? null, x.process_name ?? null, x.designation_name ?? null,
           p.vdate, x.lwd ?? null, p.vdate, p.vby, p.vdate, p.vrem],
        );
        inserted++;
      }
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    failed += batch.length;
    console.error(`batch at ${i} rolled back:`, (err as Error).message);
  } finally { conn.release(); }
}
console.log(JSON.stringify({ inserted, completedOpenCases: completed, failedInRolledBackBatches: failed }));
await db.end?.();
