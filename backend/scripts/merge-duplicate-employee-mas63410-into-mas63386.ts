/**
 * One-off merge: MAS63410 (DAVE UJJAWAL) -> MAS63386 (UJJAWAL SAMIR DAVE).
 *
 * Same person, entered twice 2 days apart (created_at 2026-08-20 and 2026-08-22, identical
 * mobile/personal_email). db_bill (source of truth, per owner ruling 2026-08-26) only knows this
 * person as MAS63386 — MAS63410 exists nowhere in db_bill. But MAS63410 is the one that already
 * has an APPROVED payroll_head_review and real operational history (attendance, joining
 * documents, IT provisioning, etc. — 22 tables, ~490 rows total, verified live 2026-08-26).
 * A plain DELETE on MAS63410 would cascade-destroy all of that (180 FK constraints reference
 * `employees`, most CASCADE). A plain re-point would fail outright on the tables below that
 * already have MAS63386's own row for the same day.
 *
 * So: re-point every real row from MAS63410's employee_id to MAS63386's, EXCEPT the confirmed
 * exact duplicates (same date, both sides already recorded it) which are left on MAS63410 to be
 * deleted with it once merged — no information is lost by dropping a row that duplicates one
 * already on the surviving record.
 *
 * Confirmed exact duplicates (verified live 2026-08-26, both sides carry the same day):
 *   - attendance_daily_record: all 4 of MAS63410's rows (Aug 20-23) already exist for MAS63386 too
 *   - employee_performance_daily_snapshot: 2026-08-24, both sides
 *   - attendance_reconciliation_issue: missing_adr on 08-17/08-18/08-22, both sides (employee_code
 *     column is a denormalized snapshot, not part of identity — matched on issue_date+issue_type)
 *
 * employee_code column on attendance_reconciliation_issue is also stale in places: some rows
 * carry employee_code='MAS63389', a still-earlier code for this same employee_id, from before it
 * became MAS63410. Every re-pointed row's employee_code is corrected to 'MAS63386' so the
 * denormalized column stops disagreeing with the FK.
 *
 * Usage:
 *   npx tsx scripts/merge-duplicate-employee-mas63410-into-mas63386.ts            # dry run
 *   npx tsx scripts/merge-duplicate-employee-mas63410-into-mas63386.ts --apply
 *
 * After a successful --apply, the MAS63410 employees row carries only the confirmed-duplicate
 * rows above (attendance/snapshot/reconciliation for the overlapping days) and can be safely hard
 * -deleted — CASCADE on those specific leftover rows is now deleting only confirmed duplicates of
 * data already safely on MAS63386, not the original real history. That final DELETE is intentionally
 * a separate manual step after this script's output is reviewed, not automated here.
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { logSensitiveAction } from "../src/shared/auditLog.js";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

const APPLY = process.argv.includes("--apply");

const DUP_CODE = "MAS63410";
const SURVIVOR_CODE = "MAS63386";

// Tables with no conflicting row on the survivor side (verified live 2026-08-26) — simple re-point.
const SIMPLE_TABLES = [
  "ats_onboarding_bridge",
  "cosec_user_sync_queue",
  "employee_emergency_contact",
  "employee_joining_document_audit_log",
  "employee_joining_document_checklist",
  "employee_joining_document_field_value",
  "employee_joining_document_file",
  "employee_joining_esign_kit",
  "employee_journey_log",
  "employee_lifecycle_event",
  "employee_payroll_head_review",
  "employee_payroll_head_review_history",
  "employee_salary_assignment",
  "employee_salary_snapshot",
  "employee_statutory_info",
  "it_provisioning_request",
  "leave_balance_ledger",
  "lms_employee_mapping",
  "salary_component_assignments",
  "sensitive_action_log",
];

async function main(): Promise<void> {
  console.log(`[merge] mode: ${APPLY ? "APPLY (will write)" : "DRY RUN (writes nothing)"}`);

  const [dupRows] = await db.query<RowDataPacket[]>(
    `SELECT id, full_name, active_status FROM employees WHERE employee_code = ?`, [DUP_CODE],
  );
  const [survivorRows] = await db.query<RowDataPacket[]>(
    `SELECT id, full_name, active_status FROM employees WHERE employee_code = ?`, [SURVIVOR_CODE],
  );
  const dup = dupRows[0];
  const survivor = survivorRows[0];
  if (!dup || !survivor) {
    console.error(`[merge] could not find both employees (dup=${!!dup}, survivor=${!!survivor}). Aborting.`);
    process.exitCode = 1;
    return;
  }
  console.log(`[merge] duplicate:  ${DUP_CODE} (${dup.full_name}) id=${dup.id}`);
  console.log(`[merge] survivor:   ${SURVIVOR_CODE} (${survivor.full_name}) id=${survivor.id}`);

  const plan: Array<{ table: string; action: string; count: number }> = [];

  for (const table of SIMPLE_TABLES) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM \`${table}\` WHERE employee_id = ?`, [dup.id],
    );
    const n = rows[0].n as number;
    if (n > 0) plan.push({ table, action: "re-point employee_id", count: n });
  }

  // attendance_daily_record: re-point only dates the survivor doesn't already have.
  const [attRows] = await db.query<RowDataPacket[]>(
    `SELECT id, record_date FROM attendance_daily_record WHERE employee_id = ?`, [dup.id],
  );
  const [survAttDates] = await db.query<RowDataPacket[]>(
    `SELECT record_date FROM attendance_daily_record WHERE employee_id = ?`, [survivor.id],
  );
  const survDateSet = new Set(survAttDates.map((r) => String(r.record_date)));
  const attToMove = (attRows as RowDataPacket[]).filter((r) => !survDateSet.has(String(r.record_date)));
  const attDuplicate = attRows.length - attToMove.length;
  if (attToMove.length) plan.push({ table: "attendance_daily_record", action: "re-point (non-overlapping dates)", count: attToMove.length });
  if (attDuplicate) plan.push({ table: "attendance_daily_record", action: "leave as duplicate (survivor already has that date)", count: attDuplicate });

  // employee_performance_daily_snapshot: same pattern.
  const [perfRows] = await db.query<RowDataPacket[]>(
    `SELECT id, snapshot_date FROM employee_performance_daily_snapshot WHERE employee_id = ?`, [dup.id],
  );
  const [survPerfDates] = await db.query<RowDataPacket[]>(
    `SELECT snapshot_date FROM employee_performance_daily_snapshot WHERE employee_id = ?`, [survivor.id],
  );
  const survPerfSet = new Set(survPerfDates.map((r) => String(r.snapshot_date)));
  const perfToMove = (perfRows as RowDataPacket[]).filter((r) => !survPerfSet.has(String(r.snapshot_date)));
  const perfDuplicate = perfRows.length - perfToMove.length;
  if (perfToMove.length) plan.push({ table: "employee_performance_daily_snapshot", action: "re-point (non-overlapping dates)", count: perfToMove.length });
  if (perfDuplicate) plan.push({ table: "employee_performance_daily_snapshot", action: "leave as duplicate", count: perfDuplicate });

  // attendance_reconciliation_issue: unique key is (issue_date, issue_type, employee_id,
  // employee_code, cosec_user_id). Re-pointing employee_id AND correcting employee_code to the
  // survivor's code together would collide with a row the survivor already has for the same
  // (issue_date, issue_type) — those are left as duplicates. Everything else is moved and its
  // employee_code corrected in the same statement, so the denormalized column stops disagreeing.
  const [reconRows] = await db.query<RowDataPacket[]>(
    `SELECT id, issue_date, issue_type FROM attendance_reconciliation_issue WHERE employee_id = ?`, [dup.id],
  );
  const [survReconKeys] = await db.query<RowDataPacket[]>(
    `SELECT issue_date, issue_type FROM attendance_reconciliation_issue WHERE employee_id = ?`, [survivor.id],
  );
  const survReconSet = new Set(survReconKeys.map((r) => `${r.issue_date}|${r.issue_type}`));
  const reconToMove = (reconRows as RowDataPacket[]).filter((r) => !survReconSet.has(`${r.issue_date}|${r.issue_type}`));
  const reconDuplicate = reconRows.length - reconToMove.length;
  if (reconToMove.length) plan.push({ table: "attendance_reconciliation_issue", action: "re-point + correct employee_code (non-overlapping)", count: reconToMove.length });
  if (reconDuplicate) plan.push({ table: "attendance_reconciliation_issue", action: "leave as duplicate", count: reconDuplicate });

  console.log(`\n[merge] plan:`);
  for (const p of plan) console.log(`    ${p.table.padEnd(38)} ${p.action.padEnd(48)} ${p.count}`);

  if (!APPLY) {
    console.log(`\n[merge] DRY RUN — nothing written. Re-run with --apply to execute this plan.`);
    return;
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    for (const table of SIMPLE_TABLES) {
      await conn.execute(`UPDATE \`${table}\` SET employee_id = ? WHERE employee_id = ?`, [survivor.id, dup.id]);
    }

    for (const row of attToMove) {
      await conn.execute(`UPDATE attendance_daily_record SET employee_id = ? WHERE id = ?`, [survivor.id, row.id]);
    }
    for (const row of perfToMove) {
      await conn.execute(`UPDATE employee_performance_daily_snapshot SET employee_id = ? WHERE id = ?`, [survivor.id, row.id]);
    }
    for (const row of reconToMove) {
      await conn.execute(
        `UPDATE attendance_reconciliation_issue SET employee_id = ?, employee_code = ? WHERE id = ?`,
        [survivor.id, SURVIVOR_CODE, row.id],
      );
    }

    await conn.commit();
    console.log(`\n[merge] committed.`);
  } catch (err) {
    await conn.rollback();
    console.error(`[merge] FAILED, rolled back:`, err);
    process.exitCode = 1;
    return;
  } finally {
    conn.release();
  }

  await logSensitiveAction({
    actor_user_id: "system:merge-duplicate-employee",
    action_type: "EMPLOYEE_DUPLICATE_MERGE",
    module_key: "employees",
    entity_type: "employees",
    change_summary: {
      duplicate_code: DUP_CODE,
      duplicate_id: dup.id,
      survivor_code: SURVIVOR_CODE,
      survivor_id: survivor.id,
      plan,
    },
  });
  console.log(`[merge] audit row written. ${DUP_CODE} now carries only confirmed-duplicate rows and is safe to remove.`);
}

main()
  .catch((err) => {
    console.error(`[merge] FATAL`, err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await (db as unknown as { end?: () => Promise<void> }).end?.().catch(() => {});
  });
