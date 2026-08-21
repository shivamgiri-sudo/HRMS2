/**
 * Payroll Head mandatory salary/journey review gate.
 *
 * One row per employee in employee_payroll_head_review (migration 1541), created by
 * employee-creation-orchestrator.service.ts the instant an employee is created. Until
 * a payroll_head user approves that row, payrollCalculate.service.ts excludes the
 * employee from every payroll run (see the NOT EXISTS clause added to empConds there).
 *
 * This module composes existing per-domain services rather than re-querying their
 * tables — the journey view should show exactly what those services already
 * consider true, not a second opinion that can drift from theirs.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getEmployeeBgvStatus } from "../employees/employee-bgv.service.js";
import { buildBankReadinessReport } from "../payroll/bank-payment-readiness.service.js";
import { createPackage, getPackageById } from "../payroll-masters/payrollMasters.service.js";
import { inboxService } from "../inbox/inbox.service.js";

export type ReviewStatus = "pending_review" | "approved" | "rejected";
export type ReasonCategory = "salary" | "documents" | "bgv" | "bank" | "other";

function httpError(message: string, statusCode: number, code?: string): Error {
  return Object.assign(new Error(message), { statusCode, code });
}

async function getReviewRow(employeeId: string): Promise<RowDataPacket | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM employee_payroll_head_review WHERE employee_id = ? LIMIT 1`,
    [employeeId]
  );
  return rows[0] ?? null;
}

async function audit(actorUserId: string, actionType: string, employeeId: string, detail: unknown) {
  await db.execute(
    `INSERT INTO sensitive_action_log
       (id, actor_user_id, action_type, module_key, entity_type, entity_id, change_summary, acted_at)
     VALUES (UUID(), ?, ?, 'payroll', 'employee', ?, ?, NOW())`,
    [actorUserId, actionType, employeeId, JSON.stringify(detail ?? {})]
  ).catch(() => {});
}

// ── Queue ────────────────────────────────────────────────────────────────────

export async function getQueue(filters: { status?: string; q?: string }) {
  const status = filters.status || "pending_review";
  const conds: string[] = ["r.status = ?"];
  const params: unknown[] = [status];
  if (filters.q) {
    conds.push("(e.full_name LIKE ? OR e.employee_code LIKE ?)");
    params.push(`%${filters.q}%`, `%${filters.q}%`);
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT r.id AS review_id, r.employee_id, r.status, r.package_accepted,
            r.rejection_category, r.rejection_reason_code, r.rejection_remarks,
            r.resubmit_count, r.created_at, r.reviewed_at,
            e.employee_code, e.full_name, dm.designation_name, b.branch_name
       FROM employee_payroll_head_review r
       JOIN employees e ON e.id = r.employee_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN designation_master dm ON dm.id = e.designation_id
      WHERE ${conds.join(" AND ")}
      ORDER BY r.created_at ASC
      LIMIT 500`,
    params
  );
  return rows;
}

// ── Single-employee journey aggregation ─────────────────────────────────────

export async function getEmployeeJourney(employeeId: string) {
  const review = await getReviewRow(employeeId);
  if (!review) throw httpError("No payroll-head review record for this employee.", 404, "NOT_FOUND");

  const [
    employeeRows,
    bgv,
    bankReport,
    documents,
    kitRows,
    checklistRows,
    salaryAssignmentRows,
    componentRows,
  ] = await Promise.all([
    db.execute<RowDataPacket[]>(
      `SELECT e.*, b.branch_name, dm.designation_name FROM employees e
         LEFT JOIN branch_master b ON b.id = e.branch_id
         LEFT JOIN designation_master dm ON dm.id = e.designation_id
        WHERE e.id = ? LIMIT 1`,
      [employeeId]
    ).then(([r]) => r as RowDataPacket[]),
    getEmployeeBgvStatus(employeeId).catch((e: unknown) => ({
      error: e instanceof Error ? e.message : String(e),
    })),
    // Org-wide report, filtered to this employee — reuses the real classifier
    // rather than duplicating its input-assembly logic for a single row.
    buildBankReadinessReport(null).catch((e: unknown) => ({
      error: e instanceof Error ? e.message : String(e),
    })),
    db.execute<RowDataPacket[]>(
      `SELECT id, doc_type, doc_category, doc_name, file_url, verified, uploaded_by,
              created_at, expiry_date, verified_by, verification_date, verification_remarks
         FROM employee_documents WHERE employee_id = ? ORDER BY created_at DESC`,
      [employeeId]
    ).then(([r]) => r as RowDataPacket[]),
    db.execute<RowDataPacket[]>(
      `SELECT * FROM employee_joining_esign_kit WHERE employee_id = ? ORDER BY created_at DESC`,
      [employeeId]
    ).then(([r]) => r as RowDataPacket[]),
    db.execute<RowDataPacket[]>(
      `SELECT id, document_code, document_name, status, fill_status, mandatory,
              completed_at, verified_by, verified_at, verification_status, verification_remarks
         FROM employee_joining_document_checklist WHERE employee_id = ? ORDER BY created_at DESC`,
      [employeeId]
    ).then(([r]) => r as RowDataPacket[]),
    db.execute<RowDataPacket[]>(
      `SELECT esa.*, ss.basic_pct, ss.hra_pct FROM employee_salary_assignment esa
         LEFT JOIN salary_structure_master ss ON ss.id = esa.structure_id
        WHERE esa.employee_id = ? AND esa.active_status = 1
        ORDER BY esa.effective_from DESC LIMIT 1`,
      [employeeId]
    ).then(([r]) => r as RowDataPacket[]),
    // Same query shape payrollCalculate.service.ts runs, so the reviewer sees
    // exactly what payroll will read once this employee is approved.
    db.execute<RowDataPacket[]>(
      `SELECT * FROM salary_component_assignments
        WHERE employee_id = ? AND status = 'active'
        ORDER BY effective_date DESC LIMIT 1`,
      [employeeId]
    ).then(([r]) => r as RowDataPacket[]),
  ]);

  const employee = employeeRows[0] ?? null;
  const bankRow = "rows" in bankReport
    ? (bankReport.rows as Array<{ employee_id: string }>).find((r) => r.employee_id === employeeId) ?? null
    : null;

  return {
    review,
    employee,
    bgv,
    bank: bankRow ?? (("error" in bankReport) ? bankReport : null),
    documents,
    joining_kit: kitRows[0] ?? null,
    joining_checklist: checklistRows,
    salary_assignment: salaryAssignmentRows[0] ?? null,
    salary_components: componentRows[0] ?? null,
  };
}

// ── Salary package actions ──────────────────────────────────────────────────

async function writeComponentAssignment(
  employeeId: string,
  pkg: RowDataPacket,
  effectiveDate: string,
  actorUserId: string,
  approvalReference: string
) {
  await db.execute(
    `INSERT INTO salary_component_assignments
       (id, employee_id, effective_date, package_id, basic, hra, conveyance,
        special_allowance, gross, pf_applicable, esi_applicable, employer_pf,
        employer_esi, ctc, net_estimate, assigned_by, assigned_at, approval_reference, status)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, 'active')`,
    [
      employeeId, effectiveDate, pkg.id,
      pkg.basic, pkg.hra, pkg.conveyance, pkg.special_allowance, pkg.gross,
      Number(pkg.epf_employee) > 0 ? 1 : 0, Number(pkg.esic_employee) > 0 ? 1 : 0,
      pkg.epf_employer, pkg.esic_employer, pkg.ctc, pkg.net_in_hand,
      actorUserId, approvalReference,
    ]
  );
  await db.execute(
    `UPDATE employee_payroll_head_review SET salary_package_id = ?, package_accepted = 0,
            package_accepted_by = NULL, package_accepted_at = NULL, package_effective_from = NULL
      WHERE employee_id = ?`,
    [pkg.id, employeeId]
  );
}

export async function assignPackage(
  employeeId: string, packageId: string, effectiveDate: string, actorUserId: string
) {
  const review = await getReviewRow(employeeId);
  if (!review) throw httpError("No payroll-head review record for this employee.", 404, "NOT_FOUND");
  if (review.status !== "pending_review") {
    throw httpError("Package can only be assigned while the review is pending.", 409, "NOT_PENDING");
  }
  const pkg = await getPackageById(packageId);
  if (!pkg) throw httpError("Salary package not found.", 404, "PACKAGE_NOT_FOUND");
  await writeComponentAssignment(employeeId, pkg as RowDataPacket, effectiveDate, actorUserId, review.id);
  await audit(actorUserId, "PAYROLL_HEAD_PACKAGE_ASSIGNED", employeeId, { package_id: packageId });
  // Lightweight on purpose: every caller of these mutating actions (including
  // this repo's own frontend) re-fetches the full journey separately right
  // after anyway. Returning getEmployeeJourney() here recomputed the
  // expensive org-wide bank readiness report a second time per click, for a
  // response nothing actually reads.
  return { review: await getReviewRow(employeeId) };
}

export async function createAndAssignPackage(
  employeeId: string, packageData: Record<string, unknown>, effectiveDate: string, actorUserId: string
) {
  const review = await getReviewRow(employeeId);
  if (!review) throw httpError("No payroll-head review record for this employee.", 404, "NOT_FOUND");
  if (review.status !== "pending_review") {
    throw httpError("Package can only be assigned while the review is pending.", 409, "NOT_PENDING");
  }
  // createPackage() is reused UNCHANGED — new packages always land in the shared
  // reusable catalog (salary_package_master), never as a one-off row, per the
  // explicit decision that package assignment stays catalog-only.
  const pkg = await createPackage(packageData, actorUserId);
  await writeComponentAssignment(employeeId, pkg as RowDataPacket, effectiveDate, actorUserId, review.id);
  await audit(actorUserId, "PAYROLL_HEAD_PACKAGE_CREATED_AND_ASSIGNED", employeeId, { package_id: (pkg as RowDataPacket).id });
  // Lightweight on purpose: every caller of these mutating actions (including
  // this repo's own frontend) re-fetches the full journey separately right
  // after anyway. Returning getEmployeeJourney() here recomputed the
  // expensive org-wide bank readiness report a second time per click, for a
  // response nothing actually reads.
  return { review: await getReviewRow(employeeId) };
}

export async function acceptPackage(employeeId: string, effectiveFrom: string, actorUserId: string) {
  const review = await getReviewRow(employeeId);
  if (!review) throw httpError("No payroll-head review record for this employee.", 404, "NOT_FOUND");
  if (!review.salary_package_id) {
    throw httpError("No salary package assigned yet — nothing to accept.", 400, "NO_PACKAGE");
  }
  await db.execute(
    `UPDATE employee_payroll_head_review
        SET package_accepted = 1, package_accepted_by = ?, package_accepted_at = NOW(),
            package_effective_from = ?
      WHERE employee_id = ?`,
    [actorUserId, effectiveFrom, employeeId]
  );
  await audit(actorUserId, "PAYROLL_HEAD_PACKAGE_ACCEPTED", employeeId, { effective_from: effectiveFrom });
  // Lightweight on purpose: every caller of these mutating actions (including
  // this repo's own frontend) re-fetches the full journey separately right
  // after anyway. Returning getEmployeeJourney() here recomputed the
  // expensive org-wide bank readiness report a second time per click, for a
  // response nothing actually reads.
  return { review: await getReviewRow(employeeId) };
}

// ── Overall decision ─────────────────────────────────────────────────────────

export async function approve(employeeId: string, actorUserId: string) {
  const review = await getReviewRow(employeeId);
  if (!review) throw httpError("No payroll-head review record for this employee.", 404, "NOT_FOUND");
  if (review.status !== "pending_review") {
    throw httpError(`Cannot approve a review with status "${review.status}".`, 409, "NOT_PENDING");
  }
  if (!review.package_accepted) {
    throw httpError("Salary package must be accepted before approval.", 409, "PACKAGE_NOT_ACCEPTED");
  }
  await db.execute(
    `UPDATE employee_payroll_head_review SET status = 'approved', reviewed_by = ?, reviewed_at = NOW()
      WHERE employee_id = ?`,
    [actorUserId, employeeId]
  );
  await audit(actorUserId, "PAYROLL_HEAD_REVIEW_APPROVED", employeeId, {});
  // Lightweight on purpose: every caller of these mutating actions (including
  // this repo's own frontend) re-fetches the full journey separately right
  // after anyway. Returning getEmployeeJourney() here recomputed the
  // expensive org-wide bank readiness report a second time per click, for a
  // response nothing actually reads.
  return { review: await getReviewRow(employeeId) };
}

/**
 * Resolve who should be notified when a review is rejected: the Payroll HR user
 * who validated this candidate's salary, and the Branch Head who approved the
 * offer. Scalar subqueries, not joins — ats_employment_offer/ats_payroll_hr_validation
 * /ats_branch_head_approval can each hold more than one historical row for a
 * candidate (retries, re-submissions), and a join across three 1:many tables would
 * fan out silently. Either target can resolve to null; the caller must handle that.
 */
async function resolveRejectionNotifyTargets(employeeId: string): Promise<{
  payrollHrUserId: string | null;
  branchHeadUserId: string | null;
}> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       (SELECT eo.created_by FROM ats_employment_offer eo
          JOIN ats_onboarding_bridge b2 ON b2.candidate_id = eo.candidate_id
         WHERE b2.employee_id = ob.employee_id
         ORDER BY eo.created_at DESC LIMIT 1) AS offer_creator_id,
       (SELECT phv.payroll_hr_id FROM ats_payroll_hr_validation phv
          JOIN ats_onboarding_bridge b3 ON b3.candidate_id = phv.candidate_id
         WHERE b3.employee_id = ob.employee_id
         ORDER BY phv.validated_at DESC, phv.created_at DESC LIMIT 1) AS payroll_hr_validator_id,
       (SELECT bha.branch_head_id FROM ats_branch_head_approval bha
          JOIN ats_onboarding_bridge b4 ON b4.candidate_id = bha.candidate_id
         WHERE b4.employee_id = ob.employee_id AND bha.approval_status = 'approved'
         ORDER BY bha.approved_at DESC LIMIT 1) AS branch_head_approver_id
     FROM ats_onboarding_bridge ob
     WHERE ob.employee_id = ?
     LIMIT 1`,
    [employeeId]
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  const row = rows[0];
  if (!row) return { payrollHrUserId: null, branchHeadUserId: null };
  return {
    payrollHrUserId: row.payroll_hr_validator_id ?? row.offer_creator_id ?? null,
    branchHeadUserId: row.branch_head_approver_id ?? null,
  };
}

export async function reject(
  employeeId: string,
  category: ReasonCategory,
  reasonCode: string,
  remarks: string,
  actorUserId: string
) {
  const review = await getReviewRow(employeeId);
  if (!review) throw httpError("No payroll-head review record for this employee.", 404, "NOT_FOUND");
  if (review.status !== "pending_review") {
    throw httpError(`Cannot reject a review with status "${review.status}".`, 409, "NOT_PENDING");
  }
  if (!remarks || !remarks.trim()) {
    throw httpError("Remarks are required when rejecting.", 400, "REMARKS_REQUIRED");
  }
  const [reasonRows] = await db.execute<RowDataPacket[]>(
    `SELECT code FROM payroll_head_review_reason_master WHERE code = ? AND category = ? AND active = 1 LIMIT 1`,
    [reasonCode, category]
  );
  if (!reasonRows.length) {
    throw httpError(`"${reasonCode}" is not a valid reason for category "${category}".`, 400, "INVALID_REASON");
  }

  await db.execute(
    `UPDATE employee_payroll_head_review
        SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW(),
            rejection_category = ?, rejection_reason_code = ?, rejection_remarks = ?
      WHERE employee_id = ?`,
    [actorUserId, category, reasonCode, remarks.trim(), employeeId]
  );
  await audit(actorUserId, "PAYROLL_HEAD_REVIEW_REJECTED", employeeId, { category, reasonCode, remarks });

  const targets = await resolveRejectionNotifyTargets(employeeId);
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT full_name, employee_code FROM employees WHERE id = ? LIMIT 1`, [employeeId]
  );
  const empName = empRows[0]?.full_name ?? "the employee";
  const title = `Salary review rejected: ${empName}`;
  const description = `Category: ${category} — ${reasonCode}. ${remarks.trim()}`;
  const actionUrl = `/payroll/salary-review/${employeeId}`;
  await Promise.allSettled(
    [targets.payrollHrUserId, targets.branchHeadUserId]
      .filter((id): id is string => !!id)
      .map((userId) =>
        inboxService.createItem({
          user_id: userId,
          type: "payroll_head_review_rejected",
          title,
          description,
          entity_type: "employee",
          entity_id: employeeId,
          action_url: actionUrl,
          priority: "high",
        })
      )
  );
  // Lightweight on purpose: every caller of these mutating actions (including
  // this repo's own frontend) re-fetches the full journey separately right
  // after anyway. Returning getEmployeeJourney() here recomputed the
  // expensive org-wide bank readiness report a second time per click, for a
  // response nothing actually reads.
  return { review: await getReviewRow(employeeId) };
}

export async function resubmit(employeeId: string, actorUserId: string) {
  const review = await getReviewRow(employeeId);
  if (!review) throw httpError("No payroll-head review record for this employee.", 404, "NOT_FOUND");
  if (review.status !== "rejected") {
    throw httpError(`Cannot resubmit a review with status "${review.status}".`, 409, "NOT_REJECTED");
  }
  await db.execute(
    `UPDATE employee_payroll_head_review
        SET status = 'pending_review', resubmitted_at = NOW(), resubmit_count = resubmit_count + 1
      WHERE employee_id = ?`,
    [employeeId]
  );
  await audit(actorUserId, "PAYROLL_HEAD_REVIEW_RESUBMITTED", employeeId, {});
  // Lightweight on purpose: every caller of these mutating actions (including
  // this repo's own frontend) re-fetches the full journey separately right
  // after anyway. Returning getEmployeeJourney() here recomputed the
  // expensive org-wide bank readiness report a second time per click, for a
  // response nothing actually reads.
  return { review: await getReviewRow(employeeId) };
}

export async function listReasons() {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT code, category, label FROM payroll_head_review_reason_master WHERE active = 1 ORDER BY category, label`
  );
  return rows;
}
