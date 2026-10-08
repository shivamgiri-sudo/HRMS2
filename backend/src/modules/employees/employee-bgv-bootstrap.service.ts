/**
 * A manually-onboarded employee (HR "Add Employee" form) has no ats_candidate row, so
 * employees.candidate_id is null and every BGV surface — NativeEmployeeBGVStatus.tsx,
 * BGVReportTab.tsx, /bgv-report-view/:candidateId — reports "no_bgv_record" forever,
 * because nothing initiates a check for them (see employee-bgv.service.ts).
 *
 * This creates the minimal ats_candidate + candidate_bgv_consent an employee needs to
 * enter the existing BGV pipeline, and links it via employees.candidate_id, so the
 * pipeline itself (candidate_bgv_check inserts, vendor dispatch, manual review, waive)
 * stays exactly as-is — this only bootstraps the row it operates on. Never called
 * silently: the caller must have already recorded explicit consent in the UI.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

export async function bootstrapCandidateForEmployee(
  employeeId: string,
  actorUserId: string
): Promise<{ candidateId: string; alreadyLinked: boolean }> {
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code, candidate_id, first_name, last_name, mobile, email,
            branch_id, process_id
       FROM employees WHERE id = ? LIMIT 1`,
    [employeeId]
  );
  const emp = empRows[0];
  if (!emp) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });

  if (emp.candidate_id) {
    return { candidateId: emp.candidate_id, alreadyLinked: true };
  }

  if (!emp.mobile) {
    // ats_candidate.mobile is NOT NULL — a manually-onboarded employee without a
    // mobile number on file can't be bootstrapped until one is added.
    throw Object.assign(new Error("Employee has no mobile number on file; add one before starting BGV"), { statusCode: 400 });
  }

  const fullName = [emp.first_name, emp.last_name].filter(Boolean).join(" ").trim() || emp.employee_code;
  const [branchRows] = await db.execute<RowDataPacket[]>(
    "SELECT branch_name FROM branch_master WHERE id = ? LIMIT 1", [emp.branch_id]
  );
  const [processRows] = await db.execute<RowDataPacket[]>(
    "SELECT process_name FROM process_master WHERE id = ? LIMIT 1", [emp.process_id]
  );

  await db.execute(
    `INSERT INTO ats_candidate
       (candidate_code, full_name, mobile, email, current_stage, applied_for_process,
        applied_for_branch, sourcing_channel, remarks)
     VALUES (?, ?, ?, ?, 'Employed', ?, ?, 'manual_hr_onboarding', ?)`,
    [
      `EMP-${emp.employee_code}`,
      fullName,
      emp.mobile,
      emp.email ?? null,
      processRows[0]?.process_name ?? null,
      branchRows[0]?.branch_name ?? null,
      `Synthesized for BGV: employee ${emp.employee_code} was onboarded directly by HR, not through the ATS candidate pipeline.`,
    ]
  );

  // ats_candidate.id defaults to UUID() server-side — read it back rather than trust
  // the driver's insertId (which is for AUTO_INCREMENT keys, not UUID PKs).
  const [[created]] = await db.execute<RowDataPacket[]>(
    "SELECT id FROM ats_candidate WHERE candidate_code = ? ORDER BY created_at DESC LIMIT 1",
    [`EMP-${emp.employee_code}`]
  ) as unknown as [RowDataPacket[]];
  const newCandidateId = created?.id;
  if (!newCandidateId) throw new Error("Failed to read back synthesized candidate id");

  await db.execute(
    `INSERT INTO candidate_bgv_consent (candidate_id, consent_version, purpose_json, consent_status)
     VALUES (?, 'BGV-DPDP-v1', ?, 'granted')`,
    [newCandidateId, JSON.stringify(["bgv", "employment"])]
  );

  await db.execute("UPDATE employees SET candidate_id = ? WHERE id = ?", [newCandidateId, employeeId]);

  void logSensitiveAction({
    actor_user_id: actorUserId,
    action_type: "BGV_BOOTSTRAP_FOR_EMPLOYEE",
    module_key: "employees",
    entity_type: "employee",
    entity_id: employeeId,
    change_summary: { candidate_id: newCandidateId },
  });

  return { candidateId: newCandidateId, alreadyLinked: false };
}
