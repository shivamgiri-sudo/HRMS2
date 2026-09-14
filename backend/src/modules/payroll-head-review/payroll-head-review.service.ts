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
 *
 * Hardened in migration 1542 after a full end-to-end rethink post-1541:
 *   - assign/accept no longer take two independent dates. Only assign takes one
 *     (the date salary_component_assignments.effective_date is written with,
 *     which is the ONLY date payroll actually reads); accept just confirms it.
 *   - approve/reject/resubmit/reopen are atomic (UPDATE ... WHERE status = ?,
 *     checked via affectedRows) instead of check-then-act, so two concurrent
 *     actions on the same employee can no longer silently race.
 *   - rejecting for a 'salary' reason resets the package/acceptance state, so
 *     re-approving after resubmit cannot happen with the same wrong package
 *     still marked accepted.
 *   - every transition is written to employee_payroll_head_review_history, not
 *     just held in the single mutable review row (which only ever remembered
 *     the latest rejection).
 *   - rejection notifies the employee too, and falls back to notifying every
 *     payroll_head-role user (plus flags itself in the response) if the normal
 *     targets both resolve to nobody — a rejection must never vanish silently.
 *   - 'approved' is no longer fully terminal: reopen() provides a correction
 *     path, itself gated and audited.
 */
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { getEmployeeBgvStatus } from "../employees/employee-bgv.service.js";
import { buildBankReadinessReport } from "../payroll/bank-payment-readiness.service.js";
import { createPackage, getPackageById } from "../payroll-masters/payrollMasters.service.js";
import { inboxService } from "../inbox/inbox.service.js";
import { buildScopeWhereClause, hasAnyRole } from "../../shared/scopeAccess.js";

// GET /queue and /branches are open to all of these (see routes.ts) — payroll_hr/branch_head
// are branch/process-scoped via buildScopeWhereClause below, payroll_head/admin/super_admin see
// everything (allowAdminBypass covers admin; super_admin always sees everything regardless).
const VIEWER_ROLES = ["payroll_head", "payroll_hr", "branch_head", "hr", "admin", "super_admin"] as const;

export type ReviewStatus = "pending_review" | "approved" | "rejected";
export type ReasonCategory = "salary" | "documents" | "bgv" | "bank" | "other";

function httpError(message: string, statusCode: number, code?: string): Error {
  return Object.assign(new Error(message), { statusCode, code });
}

/**
 * Penny-drop verification for a set of employees, keyed by employee_id.
 *
 * Bank readiness on this page is built by classifyBankReadiness, which reaches
 * READY only when db_bill shows a confirmed prior salary credit. That is correct
 * for the standing payroll bank-exceptions queue, but it can never be satisfied
 * by the people in THIS queue: a new hire has no payroll history by definition,
 * so every one of them lands on BLOCKED / no_payment_history_to_verify_against
 * no matter how their penny drop went. Reviewers saw "not verified" for accounts
 * that had in fact been penny-drop confirmed -- 16 of the 23 employees in the
 * live queue.
 *
 * This is read alongside that classification and never folded into it. The
 * readiness_class and its `payable` flag still govern the payment file
 * (payroll.routes.ts filters on readiness_class === "READY"), and a penny drop
 * must not put a new hire into a payment run; it only tells the reviewer the
 * account itself was confirmed against the bank.
 *
 * Joined on employee_code rather than employees.candidate_id: that column is
 * populated on 2 of 58,929 employee rows and is NULL for every employee in this
 * queue, so it resolves nothing. employee_code matches 22 of 23.
 */
async function fetchPennyDropByEmployee(employeeIds: string[]): Promise<Map<string, {
  verified: boolean;
  status: string | null;
  method: string | null;
  verified_at: string | null;
  account_holder_name: string | null;
  name_match_score: number | null;
}>> {
  const out = new Map<string, {
    verified: boolean; status: string | null; method: string | null;
    verified_at: string | null; account_holder_name: string | null; name_match_score: number | null;
  }>();
  if (!employeeIds.length) return out;
  const placeholders = employeeIds.map(() => "?").join(",");
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.id AS employee_id, cbv.verification_status, cbv.verification_method,
              cbv.verified_at, cbv.provider_account_holder_name, cbv.name_match_score
         FROM employees e
         JOIN ats_candidate ac ON ac.employee_code = e.employee_code
         JOIN candidate_bank_verification cbv ON cbv.candidate_id = ac.id
        WHERE e.id IN (${placeholders})
          AND cbv.id = (
            SELECT c2.id FROM candidate_bank_verification c2
             WHERE c2.candidate_id = ac.id
             ORDER BY (c2.verification_status = 'verified') DESC, c2.verified_at DESC, c2.created_at DESC
             LIMIT 1
          )`,
      employeeIds,
    );
    for (const r of rows) {
      out.set(String(r.employee_id), {
        // Only a real penny drop counts. 'mock' is the local provider stub and
        // 4 rows carry verification_status='verified' against it; treating those
        // as confirmed would show a green chip for an account nobody checked.
        verified: r.verification_status === "verified" && r.verification_method === "penny_drop",
        status: r.verification_status ?? null,
        method: r.verification_method ?? null,
        verified_at: r.verified_at ? String(r.verified_at) : null,
        account_holder_name: r.provider_account_holder_name ?? null,
        name_match_score: r.name_match_score == null ? null : Number(r.name_match_score),
      });
    }
  } catch {
    // Non-fatal: this is an informational overlay on top of the real
    // classification, so a failure here must not take the queue down with it.
    return out;
  }
  return out;
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

async function writeHistory(params: {
  employeeId: string;
  reviewId: string;
  action: "approved" | "rejected" | "resubmitted" | "reopened" | "salary_start_date_updated";
  actorUserId: string;
  rejectionCategory?: ReasonCategory | null;
  rejectionReasonCode?: string | null;
  rejectionRemarks?: string | null;
  reopenReason?: string | null;
  notifiedPayrollHrUserId?: string | null;
  notifiedBranchHeadUserId?: string | null;
  notifiedEmployee?: boolean;
}) {
  await db.execute(
    `INSERT INTO employee_payroll_head_review_history
       (id, employee_id, review_id, action, actor_user_id,
        rejection_category, rejection_reason_code, rejection_remarks, reopen_reason,
        notified_payroll_hr_user_id, notified_branch_head_user_id, notified_employee)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.employeeId, params.reviewId, params.action, params.actorUserId,
      params.rejectionCategory ?? null, params.rejectionReasonCode ?? null, params.rejectionRemarks ?? null,
      params.reopenReason ?? null,
      params.notifiedPayrollHrUserId ?? null, params.notifiedBranchHeadUserId ?? null,
      params.notifiedEmployee ? 1 : 0,
    ]
  ).catch((e) => console.warn("[payroll-head-review] history write failed:", e));
}

// ── Queue ────────────────────────────────────────────────────────────────────

/**
 * How many queue rows get the (per-row) BGV + bank enrichment that feeds the readiness tiles.
 * 120 covers every live tab today (23 rows total across all three) with headroom; beyond it
 * the tiles read "Not evaluated" instead of the request taking one BGV round-trip per row.
 */
const ENRICH_ROW_CAP = 120;

export async function getQueue(
  filters: { status?: string; q?: string; branch?: string },
  callerUserId: string
) {
  const status = filters.status || "pending_review";
  const conds: string[] = ["r.status = ?"];
  const params: unknown[] = [status];
  if (filters.q) {
    conds.push("(e.full_name LIKE ? OR e.employee_code LIKE ?)");
    params.push(`%${filters.q}%`, `%${filters.q}%`);
  }
  if (filters.branch) {
    conds.push("b.branch_name = ?");
    params.push(filters.branch);
  }
  // payroll_head/admin/super_admin see the whole queue as before — bypassed explicitly rather
  // than relying on buildScopeWhereClause resolving them to an 'all' scope row (both live
  // payroll_head users happen to have one today, but that's data, not a guarantee for the next
  // one). payroll_hr/branch_head — newly allowed onto this route — are branch/process-scoped,
  // the same helper every other row-scoped query in this codebase uses.
  const isFullAccess = await hasAnyRole(callerUserId, "payroll_head", "admin", "super_admin");
  if (!isFullAccess) {
    const scope = await buildScopeWhereClause(
      callerUserId,
      [...VIEWER_ROLES],
      { branchId: "e.branch_id", processId: "e.process_id" }
    );
    conds.push(scope.sql);
    params.push(...scope.params);
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT r.id AS review_id, r.employee_id, r.status, r.package_accepted,
            r.rejection_category, r.rejection_reason_code, r.rejection_remarks,
            r.resubmit_count, r.reopen_count, r.created_at, r.reviewed_at,
            TIMESTAMPDIFF(HOUR, r.created_at, NOW()) AS pending_hours,
            e.employee_code, e.full_name, dm.designation_name, b.branch_name,
            cc.cost_centre_name, pm.process_name, e.emp_type,
            -- Correlated, not a JOIN — salary_component_assignments/ats_employment_offer can
            -- each have more than one matching row; a JOIN here would multiply queue rows.
            -- ctc_annual was never selected before this, so the "monthly CTC" column on this
            -- page always rendered "—"; final_ctc/offered_ctc now feed it a real value.
            (SELECT sca.ctc FROM salary_component_assignments sca
              WHERE sca.employee_id = r.employee_id AND sca.status = 'active'
              ORDER BY sca.effective_date DESC LIMIT 1) AS final_ctc,
            (SELECT o.status FROM ats_employment_offer o
              WHERE o.candidate_id = r.candidate_id
              ORDER BY o.created_at DESC LIMIT 1) AS offer_status,
            (SELECT o.offered_ctc FROM ats_employment_offer o
              WHERE o.candidate_id = r.candidate_id
              ORDER BY o.created_at DESC LIMIT 1) AS offered_ctc,
            -- Approval chain: the two stages that ran BEFORE this review row existed.
            -- Both are joined on a PRIMARY KEY matched by a scalar subquery rather than on
            -- candidate_id directly, so a second validation/approval row for the same
            -- candidate can never multiply a queue row.
            v.validation_status AS phr_status,
            -- Payroll HR is the person who RAISED the offer, read off ats_employment_offer.
            -- NOT ats_payroll_hr_validation.payroll_hr_id: three separate writers reset that
            -- column to whoever last touched the row (payroll_hr_id = VALUES(payroll_hr_id)
            -- in payroll-hr.service, payroll_hr_id = ? in joining-control-room.service), so
            -- on 22 of 23 live records it holds the BRANCH HEAD who approved, and the row
            -- would name the same person twice. offer.created_by is written once at offer
            -- creation and never rewritten by the approval.
            COALESCE(o.submitted_at, o.created_at) AS phr_at,
            COALESCE(ocr.full_name, oau.email)     AS phr_by,
            ocr.id                                 AS phr_by_employee_id,
            bha.approval_status AS bh_status,
            bha.approved_at     AS bh_at,
            bhe.full_name       AS bh_by,
            bha.branch_head_id  AS bh_by_employee_id,
            bha.remarks         AS bh_remarks,
            TIMESTAMPDIFF(MINUTE, COALESCE(o.submitted_at, o.created_at), bha.approved_at) AS stage1_minutes,
            TIMESTAMPDIFF(MINUTE, bha.approved_at, COALESCE(r.reviewed_at, NOW())) AS stage2_minutes,
            -- Correlated, NOT a join: 7 user_ids map to more than one employees row, so
            -- "LEFT JOIN employees ON user_id = r.reviewed_by" would duplicate queue rows.
            (SELECT COALESCE(phe.full_name, rau.email)
               FROM auth_user rau
               LEFT JOIN employees phe ON phe.user_id = rau.id
              WHERE rau.id = r.reviewed_by LIMIT 1) AS ph_by
       FROM employee_payroll_head_review r
       JOIN employees e ON e.id = r.employee_id
       -- Payroll HR validation, and the Branch Head approval that hangs off it.
       -- ats_branch_head_approval.candidate_id is populated on only 3 of 31 rows, so the
       -- link that actually holds is payroll_validation_id -> ats_payroll_hr_validation.id.
       -- branch_head_id holds an employees.id (NOT a user_id); offer.created_by holds a
       -- user_id, hence the two different employees joins below. employees.user_id is not
       -- unique (7 user_ids map to more than one row), so the offer creator is resolved
       -- through a LIMIT 1 subquery rather than a join that could duplicate queue rows.
       LEFT JOIN ats_payroll_hr_validation v
              ON v.id = (SELECT v2.id FROM ats_payroll_hr_validation v2
                          WHERE v2.candidate_id = r.candidate_id
                          ORDER BY v2.created_at DESC LIMIT 1)
       LEFT JOIN ats_employment_offer o
              ON o.id = (SELECT o2.id FROM ats_employment_offer o2
                          WHERE o2.candidate_id = r.candidate_id
                          ORDER BY o2.created_at DESC LIMIT 1)
       LEFT JOIN auth_user oau ON oau.id = o.created_by
       LEFT JOIN employees ocr ON ocr.id = (SELECT e2.id FROM employees e2
                                             WHERE e2.user_id = o.created_by LIMIT 1)
       LEFT JOIN ats_branch_head_approval bha
              ON bha.id = (SELECT b2.id FROM ats_branch_head_approval b2
                            WHERE b2.payroll_validation_id = v.id
                            ORDER BY b2.created_at DESC LIMIT 1)
       LEFT JOIN employees bhe ON bhe.id = bha.branch_head_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN designation_master dm ON dm.id = e.designation_id
       LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
       LEFT JOIN process_master pm ON pm.id = e.process_id
      WHERE ${conds.join(" AND ")}
      ORDER BY r.created_at ASC
      LIMIT 500`,
    params
  );

  // BGV/bank enrichment used to be Pending-Review-only, which left the BGV and Bank tiles on
  // the Approved/Rejected tabs with nothing to draw. It now runs for every tab but is BOUNDED
  // to the first ENRICH_ROW_CAP rows — BGV costs one resolver call per row, and Approved holds
  // years of history. Rows past the cap simply carry no `summary`, and the UI renders them as
  // "Not evaluated" rather than inventing a state. This also caps the Pending path, which was
  // previously unbounded up to the 500-row LIMIT.
  // BGV reuses the real per-employee resolver as-is (candidate_id, with the
  // ats_onboarding_bridge fallback) rather than a second, drift-prone implementation. Bank calls
  // the org-wide report exactly ONCE for the whole batch, not once per row.
  const enrichRows = rows.slice(0, ENRICH_ROW_CAP);
  if (enrichRows.length > 0) {
    const [bgvResults, bankReport, pennyDrop] = await Promise.all([
      Promise.all(enrichRows.map((r) =>
        getEmployeeBgvStatus(r.employee_id as string).catch((e: unknown) => ({
          error: e instanceof Error ? e.message : String(e),
        }))
      )),
      buildBankReadinessReport(null).catch((e: unknown) => ({
        error: e instanceof Error ? e.message : String(e),
      })),
      fetchPennyDropByEmployee(enrichRows.map((r) => r.employee_id as string)),
    ]);
    const bankByEmployee = new Map<string, unknown>();
    if ("rows" in bankReport) {
      for (const b of bankReport.rows as Array<{ employee_id: string }>) {
        bankByEmployee.set(b.employee_id, b);
      }
    }
    enrichRows.forEach((r, i) => {
      r.summary = {
        offered: { status: r.offer_status ?? null, ctc: r.offered_ctc ?? null },
        final: { accepted: !!r.package_accepted, assigned: !!r.final_ctc, ctc: r.final_ctc ?? null },
        bgv: bgvResults[i],
        bank: (() => {
          const b = bankByEmployee.get(r.employee_id as string)
            ?? (("error" in bankReport) ? bankReport : null);
          const pd = pennyDrop.get(r.employee_id as string) ?? null;
          return b && typeof b === "object" ? { ...(b as object), penny_drop: pd } : b;
        })(),
      };
    });
  }

  return rows;
}

export async function listQueueBranches(callerUserId: string) {
  const conds = ["b.branch_name IS NOT NULL"];
  const params: unknown[] = [];
  const isFullAccess = await hasAnyRole(callerUserId, "payroll_head", "admin", "super_admin");
  if (!isFullAccess) {
    const scope = await buildScopeWhereClause(
      callerUserId,
      [...VIEWER_ROLES],
      { branchId: "e.branch_id", processId: "e.process_id" }
    );
    conds.push(scope.sql);
    params.push(...scope.params);
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT b.branch_name
       FROM employee_payroll_head_review r
       JOIN employees e ON e.id = r.employee_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
      WHERE ${conds.join(" AND ")}
      ORDER BY b.branch_name`,
    params
  );
  return rows.map((r) => r.branch_name as string);
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
    history,
    offeredSalaryRows,
    payrollHrValidationRows,
    exceptionProposalRows,
  ] = await Promise.all([
    db.execute<RowDataPacket[]>(
      `SELECT e.*, b.branch_name, b.state AS branch_state, dm.designation_name,
              cc.cost_centre_name, pm.process_name
         FROM employees e
         LEFT JOIN branch_master b ON b.id = e.branch_id
         LEFT JOIN designation_master dm ON dm.id = e.designation_id
         LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
         LEFT JOIN process_master pm ON pm.id = e.process_id
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
    // net_estimate is the stored column name; net_in_hand alias keeps the frontend
    // field consistent with salary_package_master which uses net_in_hand.
    // pf_employee/esic_employee (migration 445) are the real per-row source now;
    // COALESCE falls back to the pm join for pre-migration rows where they're
    // still NULL — sca.* is listed first so the COALESCE aliases below override
    // the raw (possibly-NULL) sca.pf_employee/sca.esic_employee columns in the
    // final result object, matching what the frontend reads (sc.pf_employee /
    // sc.esic_employee).
    // pf_employee_amt/esic_employee_amt are kept alongside pf_employee/esic_employee —
    // PayrollHeadSalaryReviewQueue.tsx's FinalSalarySection reads the "_amt" names on
    // this same salary_components object, so both must be populated additively.
    db.execute<RowDataPacket[]>(
      `SELECT sca.*, sca.net_estimate AS net_in_hand,
              COALESCE(sca.pf_employee, pm.epf_employee) AS pf_employee,
              COALESCE(sca.esic_employee, pm.esic_employee) AS esic_employee,
              COALESCE(sca.pf_employee, pm.epf_employee) AS pf_employee_amt,
              COALESCE(sca.esic_employee, pm.esic_employee) AS esic_employee_amt,
              -- The rest of the package. salary_component_assignments stores only
              -- basic/hra/conveyance/special_allowance/gross/pf/esi/ctc, so every other
              -- component the package actually carries was invisible on the review screen —
              -- most importantly BONUS, which 229 of the 230 populated packages carry at
              -- 8.33% of basic INSIDE gross. A reviewer validating a package could not see
              -- a component that is part of the CTC they were signing off.
              -- No column collision: none of these exist on sca, so the sca.* expansion
              -- above cannot shadow them.
              pm.bonus, pm.lta, pm.portfolio, pm.medical, pm.pli,
              pm.other_allowance, pm.professional_tax, pm.admin_charges,
              pm.package_amount AS pkg_package_amount,
              pm.band_code      AS pkg_band_code
         FROM salary_component_assignments sca
         LEFT JOIN salary_package_master pm ON pm.id = sca.package_id
        WHERE sca.employee_id = ? AND sca.status = 'active'
        ORDER BY sca.effective_date DESC LIMIT 1`,
      [employeeId]
    ).then(([r]) => r as RowDataPacket[]),
    db.execute<RowDataPacket[]>(
      `SELECT * FROM employee_payroll_head_review_history WHERE employee_id = ? ORDER BY created_at DESC`,
      [employeeId]
    ).then(([r]) => r as RowDataPacket[]).catch(() => []),
    // Fetch the SUGGESTED salary from ats_employment_offer via the review's candidate_id.
    // This is the package Branch Payroll HR assigned during offer creation.
    review.candidate_id ? db.execute<RowDataPacket[]>(
      `SELECT eo.id, eo.candidate_id, eo.offered_ctc, eo.basic, eo.hra, eo.conveyance, eo.da,
              eo.special_allowance, eo.other_allowance, eo.bonus, eo.gross, eo.pf_employee,
              eo.pf_employer, eo.esic_employee, eo.esic_employer, eo.professional_tax,
              eo.gratuity, eo.admin_charges, eo.net_in_hand, eo.pf_eligible, eo.esi_eligible,
              eo.pf_opt_out, eo.esic_opt_out, eo.salary_band, eo.status AS offer_status,
              eo.created_by, eo.created_at,
              COALESCE(creator.full_name, au.email) AS created_by_name
         FROM ats_employment_offer eo
         LEFT JOIN auth_user au ON au.id = eo.created_by
         LEFT JOIN employees creator ON creator.user_id = eo.created_by
        WHERE eo.candidate_id = ?
        ORDER BY eo.created_at DESC LIMIT 1`,
      [review.candidate_id]
    ).then(([r]) => r as RowDataPacket[]).catch(() => []) : Promise.resolve([]),
    // remarks/joining_remarks: Branch Payroll HR's own notes entered while validating this
    // candidate's salary/onboarding — previously fetched only for salary_start_date, so these
    // never reached Payroll Head at all despite Branch HR routinely writing them.
    review.candidate_id ? db.execute<RowDataPacket[]>(
      `SELECT v.salary_start_date, v.remarks, v.joining_remarks,
              COALESCE(hr.full_name, au.email) AS validated_by_name, v.validated_at
         FROM ats_payroll_hr_validation v
         LEFT JOIN auth_user au ON au.id = v.validated_by
         LEFT JOIN employees hr ON hr.user_id = v.validated_by
        WHERE v.candidate_id = ? ORDER BY v.created_at DESC LIMIT 1`,
      [review.candidate_id]
    ).then(([r]) => r as RowDataPacket[]).catch(() => []) : Promise.resolve([]),
    // Exception package proposal — if Branch Payroll HR created an above-band salary
    // the Payroll Head needs to see the justification reason and approval status.
    review.candidate_id ? db.execute<RowDataPacket[]>(
      `SELECT sep.proposed_gross_salary, sep.proposal_reason, sep.status,
              sep.difference_amount, sep.difference_percent, sep.created_at,
              COALESCE(e.full_name, au.email) AS proposed_by_name
         FROM salary_exception_proposal sep
         LEFT JOIN auth_user au ON au.id = sep.proposed_by
         LEFT JOIN employees e ON e.user_id = sep.proposed_by
        WHERE sep.candidate_id = ? LIMIT 1`,
      [review.candidate_id]
    ).then(([r]) => r as RowDataPacket[]).catch(() => []) : Promise.resolve([]),
  ]);

  const employee = employeeRows[0] ?? null;
  const bankRow = "rows" in bankReport
    ? (bankReport.rows as Array<{ employee_id: string }>).find((r) => r.employee_id === employeeId) ?? null
    : null;

  const journeyPennyDrop = await fetchPennyDropByEmployee([employeeId]);

  return {
    review,
    employee,
    bgv,
    bank: (() => {
      const b = bankRow ?? (("error" in bankReport) ? bankReport : null);
      // Same overlay as the queue: informational only, never merged into
      // readiness_class or `payable`. See fetchPennyDropByEmployee.
      return b && typeof b === "object"
        ? { ...(b as object), penny_drop: journeyPennyDrop.get(employeeId) ?? null }
        : b;
    })(),
    documents,
    joining_kit: kitRows[0] ?? null,
    joining_checklist: checklistRows,
    salary_assignment: salaryAssignmentRows[0] ?? null,
    salary_components: componentRows[0] ?? null,
    offered_salary: offeredSalaryRows[0] ?? null,
    payroll_hr_validation: payrollHrValidationRows[0]
      ? {
          salary_start_date: (payrollHrValidationRows[0].salary_start_date as string) || null,
          remarks: (payrollHrValidationRows[0].remarks as string) || null,
          joining_remarks: (payrollHrValidationRows[0].joining_remarks as string) || null,
          validated_by_name: (payrollHrValidationRows[0].validated_by_name as string) || null,
          validated_at: (payrollHrValidationRows[0].validated_at as string) || null,
        }
      : null,
    exception_proposal: exceptionProposalRows[0] ?? null,
    history,
  };
}

export async function updateSalaryStartDate(
  employeeId: string,
  newDate: string,
  actorUserId: string
): Promise<{ salary_start_date: string }> {
  const review = await getReviewRow(employeeId);
  if (!review) throw httpError("No payroll-head review record for this employee.", 404, "NOT_FOUND");

  if (!review.candidate_id) {
    throw httpError("No candidate linked to this employee — cannot update salary start date.", 400, "NO_CANDIDATE");
  }

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT date_of_joining FROM employees WHERE id = ? LIMIT 1`,
    [employeeId]
  );
  const doj = empRows[0]?.date_of_joining as string | null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate) || isNaN(Date.parse(newDate))) {
    throw httpError("salary_start_date must be a valid YYYY-MM-DD date.", 400, "INVALID_DATE");
  }
  if (doj && new Date(newDate) < new Date(doj)) {
    throw httpError("Salary start date cannot be before date of joining.", 400, "INVALID_DATE");
  }

  const [latestRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, salary_start_date FROM ats_payroll_hr_validation
      WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1`,
    [review.candidate_id]
  );
  if (!latestRows[0]) {
    throw httpError("No payroll_hr_validation row found for this candidate.", 404, "NOT_FOUND");
  }
  const oldDate = (latestRows[0].salary_start_date as string) || null;

  await db.execute(
    `UPDATE ats_payroll_hr_validation SET salary_start_date = ? WHERE id = ?`,
    [newDate, latestRows[0].id]
  );

  await writeHistory({
    employeeId,
    reviewId: review.id as string,
    action: "salary_start_date_updated",
    actorUserId,
    rejectionRemarks: JSON.stringify({ old_date: oldDate, new_date: newDate }),
  });

  return { salary_start_date: newDate };
}

export async function updateAssignmentEffectiveDate(
  employeeId: string,
  newDate: string,
  actorUserId: string,
  reason: string
): Promise<{ effective_from: string }> {
  if (!reason || reason.trim().length < 5) {
    throw httpError("Reason is required (min 5 characters).", 400, "REASON_REQUIRED");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate) || isNaN(Date.parse(newDate))) {
    throw httpError("effective_date must be a valid YYYY-MM-DD date.", 400, "INVALID_DATE");
  }

  const review = await getReviewRow(employeeId);
  if (!review) throw httpError("No payroll-head review record for this employee.", 404, "NOT_FOUND");

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT date_of_joining FROM employees WHERE id = ? LIMIT 1`,
    [employeeId]
  );
  const doj = empRows[0]?.date_of_joining as string | null;
  if (doj && new Date(newDate) < new Date(doj)) {
    throw httpError("Effective date cannot be before date of joining.", 400, "INVALID_DATE");
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Lock the active assignment row immediately — prevents two concurrent requests
    // from both reading the same row outside the transaction and each inserting a
    // duplicate active assignment (TOCTOU race).
    const [lockedRows] = await connection.execute<RowDataPacket[]>(
      `SELECT id, effective_from FROM employee_salary_assignment
        WHERE employee_id = ? AND active_status = 1
        ORDER BY effective_from DESC LIMIT 1
        FOR UPDATE`,
      [employeeId]
    );
    if (!lockedRows.length) {
      await connection.rollback();
      throw httpError("No active salary assignment found. Use the ATS salary-start-date path instead.", 404, "NO_ASSIGNMENT");
    }
    const oldDate = lockedRows[0].effective_from as string;
    const assignmentId = lockedRows[0].id as string;

    if (oldDate === newDate) {
      await connection.rollback();
      return { effective_from: newDate };
    }

    // Stamp effective_to on the current assignment.
    // Guard against effective_to inversion when backdating: if newDate is before
    // the row's own effective_from, collapse the period to a single day
    // (effective_from = effective_to) rather than producing an inverted range.
    await connection.execute(
      `UPDATE employee_salary_assignment
          SET active_status = 0,
              effective_to = CASE
                WHEN DATE(?) < DATE(effective_from) THEN DATE(effective_from)
                ELSE DATE_SUB(?, INTERVAL 1 DAY)
              END
        WHERE id = ?`,
      [newDate, newDate, assignmentId]
    );

    // Copy current assignment with the new effective_from
    const [copyRows] = await connection.execute<RowDataPacket[]>(
      `SELECT * FROM employee_salary_assignment WHERE id = ? LIMIT 1`,
      [assignmentId]
    );
    const old = copyRows[0];

    await connection.execute(
      `INSERT INTO employee_salary_assignment
         (employee_id, structure_id, ctc_annual, effective_from, active_status, assigned_by)
       VALUES (?, ?, ?, ?, 1, ?)`,
      [employeeId, old.structure_id, old.ctc_annual, newDate, actorUserId]
    );

    // Keep ats_payroll_hr_validation.salary_start_date in sync when a candidate
    // link exists. Non-fatal: a missing candidate link is valid for direct hires.
    if (review.candidate_id) {
      await connection.execute(
        `UPDATE ats_payroll_hr_validation SET salary_start_date = ?
          WHERE candidate_id = ? AND id = (
            SELECT id FROM (
              SELECT id FROM ats_payroll_hr_validation
               WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1
            ) sub
          )`,
        [newDate, review.candidate_id, review.candidate_id]
      ).catch(() => {}); // non-fatal
    }

    // Audit
    await connection.execute(
      `INSERT INTO employee_payroll_head_review_history
         (id, employee_id, review_id, action, actor_user_id, rejection_remarks, notified_employee)
       VALUES (UUID(), ?, ?, 'assignment_effective_date_updated', ?, ?, 0)`,
      [
        employeeId,
        review.id as string,
        actorUserId,
        JSON.stringify({ old_date: oldDate, new_date: newDate, reason: reason.trim() }),
      ]
    );

    await connection.commit();
  } catch (e) {
    await connection.rollback();
    throw e;
  } finally {
    connection.release();
  }

  return { effective_from: newDate };
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
       (id, employee_id, effective_date, package_id,
        basic, hra, conveyance, special_allowance,
        bonus, portfolio, medical_allowance, lta, other_allowance, pli,
        gross, pf_applicable, esi_applicable, employer_pf,
        employer_esi, pf_employee, esic_employee, ctc, net_estimate, assigned_by,
        assigned_at, approval_reference, status)
     VALUES (UUID(), ?, ?, ?,  ?, ?, ?, ?,  ?, ?, ?, ?, ?, ?,  ?, ?, ?, ?,  ?, ?, ?, ?, ?, ?, NOW(), ?, 'active')`,
    [
      employeeId, effectiveDate, pkg.id,
      pkg.basic, pkg.hra, pkg.conveyance, pkg.special_allowance ?? 0,
      pkg.bonus ?? 0, pkg.portfolio ?? 0, pkg.medical ?? 0, pkg.lta ?? 0,
      pkg.other_allowance ?? 0, pkg.pli ?? 0,
      pkg.gross,
      Number(pkg.epf_employee) > 0 ? 1 : 0, Number(pkg.esic_employee) > 0 ? 1 : 0,
      pkg.epf_employer, pkg.esic_employer, pkg.epf_employee, pkg.esic_employee,
      pkg.ctc, pkg.net_in_hand,
      actorUserId, approvalReference,
    ]
  );
  // package_effective_from is set here too, from the SAME date — accept() no
  // longer takes its own independent date. Before 1542 these were two
  // separately-entered dates that could disagree; only this one was ever
  // actually read by payroll, so the other was pure display drift waiting to
  // happen.
  await db.execute(
    `UPDATE employee_payroll_head_review SET salary_package_id = ?, package_accepted = 0,
            package_accepted_by = NULL, package_accepted_at = NULL, package_effective_from = ?
      WHERE employee_id = ?`,
    [pkg.id, effectiveDate, employeeId]
  );

  // Keep employee_salary_assignment.ctc_annual in sync with the package CTC so
  // salary slips and CTC reports show the Payroll Head's confirmed figure, not
  // the original offer CTC. Payroll calculation uses salary_component_assignments
  // (gross) directly, so this does not affect the payable amount — it only
  // corrects the display field. Only updates when a row already exists; a missing
  // ESA row is a creation-orchestrator gap, not something to write here silently.
  await db.execute(
    `UPDATE employee_salary_assignment
        SET ctc_annual = ?, effective_from = ?, updated_at = NOW()
      WHERE employee_id = ? AND active_status = 1
      LIMIT 1`,
    [Number(pkg.package_amount ?? (pkg.ctc ?? 0)) * 12, effectiveDate, employeeId]
  ).catch((e) => console.warn('[payroll-head-review] could not sync ESA ctc_annual:', e));
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
  await audit(actorUserId, "PAYROLL_HEAD_PACKAGE_ASSIGNED", employeeId, { package_id: packageId, effective_date: effectiveDate });
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
  await audit(actorUserId, "PAYROLL_HEAD_PACKAGE_CREATED_AND_ASSIGNED", employeeId, { package_id: (pkg as RowDataPacket).id, effective_date: effectiveDate });
  return { review: await getReviewRow(employeeId) };
}

export async function acceptPackage(employeeId: string, actorUserId: string) {
  const review = await getReviewRow(employeeId);
  if (!review) throw httpError("No payroll-head review record for this employee.", 404, "NOT_FOUND");
  if (!review.salary_package_id) {
    throw httpError("No salary package assigned yet — nothing to accept.", 400, "NO_PACKAGE");
  }
  // No date param here on purpose — package_effective_from was already set,
  // from the same effective_date used at assign, by writeComponentAssignment.
  // Accepting only confirms it; it cannot introduce a second, disagreeing date.
  await db.execute(
    `UPDATE employee_payroll_head_review
        SET package_accepted = 1, package_accepted_by = ?, package_accepted_at = NOW()
      WHERE employee_id = ?`,
    [actorUserId, employeeId]
  );
  await audit(actorUserId, "PAYROLL_HEAD_PACKAGE_ACCEPTED", employeeId, { effective_from: review.package_effective_from });
  return { review: await getReviewRow(employeeId) };
}

/**
 * One-click approval: copies the offered salary from ats_employment_offer directly
 * to salary_component_assignments without creating a new package in the catalog.
 * This is the fast-path when Payroll Head accepts the Branch HR's suggested package as-is.
 */
export async function approveOfferedPackage(employeeId: string, effectiveDate: string, actorUserId: string) {
  const review = await getReviewRow(employeeId);
  if (!review) throw httpError("No payroll-head review record for this employee.", 404, "NOT_FOUND");
  if (review.status !== "pending_review") {
    throw httpError("Package can only be assigned while the review is pending.", 409, "NOT_PENDING");
  }
  if (!review.candidate_id) {
    throw httpError("No candidate link found — cannot retrieve offered salary.", 400, "NO_CANDIDATE_LINK");
  }

  const [offerRows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM ats_employment_offer WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1`,
    [review.candidate_id]
  );
  const offer = offerRows[0];
  if (!offer) {
    throw httpError("No employment offer found for this candidate.", 404, "NO_OFFER");
  }

  // Write directly to salary_component_assignments from offer values (no catalog package)
  await db.execute(
    `INSERT INTO salary_component_assignments
       (id, employee_id, effective_date, package_id,
        basic, hra, conveyance, special_allowance,
        bonus, portfolio, medical_allowance, lta, other_allowance, pli,
        gross, pf_applicable, esi_applicable, employer_pf,
        employer_esi, pf_employee, esic_employee, ctc, net_estimate, assigned_by,
        assigned_at, approval_reference, status)
     VALUES (UUID(), ?, ?, NULL,  ?, ?, ?, ?,  ?, ?, ?, ?, ?, ?,  ?, ?, ?, ?,  ?, ?, ?, ?, ?, ?, NOW(), ?, 'active')`,
    [
      employeeId, effectiveDate,
      offer.basic ?? 0, offer.hra ?? 0, offer.conveyance ?? 0, offer.special_allowance ?? 0,
      offer.bonus ?? 0, offer.portfolio ?? 0, offer.medical ?? 0, offer.lta ?? 0,
      offer.other_allowance ?? 0, offer.pli ?? 0,
      offer.gross ?? 0,
      Number(offer.pf_employee) > 0 ? 1 : 0, Number(offer.esic_employee) > 0 ? 1 : 0,
      offer.pf_employer ?? 0, offer.esic_employer ?? 0, offer.pf_employee ?? 0, offer.esic_employee ?? 0,
      offer.offered_ctc ?? 0, offer.net_in_hand ?? 0,
      actorUserId, review.id,
    ]
  );

  // Mark review as having an accepted package (skip the assign+accept two-step)
  await db.execute(
    `UPDATE employee_payroll_head_review
        SET salary_package_id = NULL, package_accepted = 1, package_accepted_by = ?,
            package_accepted_at = NOW(), package_effective_from = ?
      WHERE employee_id = ?`,
    [actorUserId, effectiveDate, employeeId]
  );

  // Sync employee_salary_assignment.ctc_annual
  await db.execute(
    `UPDATE employee_salary_assignment
        SET ctc_annual = ?, effective_from = ?, updated_at = NOW()
      WHERE employee_id = ? AND active_status = 1
      LIMIT 1`,
    [Number(offer.offered_ctc ?? 0) * 12, effectiveDate, employeeId]
  ).catch((e) => console.warn('[payroll-head-review] could not sync ESA ctc_annual:', e));

  await audit(actorUserId, "PAYROLL_HEAD_OFFERED_PACKAGE_APPROVED", employeeId, {
    offer_id: offer.id,
    effective_date: effectiveDate,
    ctc: offer.offered_ctc,
    gross: offer.gross,
    net_in_hand: offer.net_in_hand,
  });

  return { review: await getReviewRow(employeeId) };
}

// ── Notification helpers ─────────────────────────────────────────────────────

/** Every active user holding the payroll_head role — the fallback audience when
 * a rejection's normal targets (offer's Payroll HR / Branch Head) both resolve
 * to nobody. A rejection must never notify zero people. */
async function payrollHeadRoleUserIds(): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT ur.user_id FROM user_roles ur
      WHERE ur.active_status = 1 AND ur.role_key = 'payroll_head'`
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  return rows.map((r) => String(r.user_id));
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
  // Atomic: the WHERE clause re-checks status at the moment of the write, not
  // just at the SELECT above. Two concurrent actions on the same employee
  // (e.g. one approve, one reject, both reading pending_review a moment
  // apart) can now only ever have ONE of them actually take effect — the
  // loser's UPDATE affects 0 rows and gets a clear 409, not a silent overwrite.
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE employee_payroll_head_review SET status = 'approved', reviewed_by = ?, reviewed_at = NOW()
      WHERE employee_id = ? AND status = 'pending_review'`,
    [actorUserId, employeeId]
  );
  if (result.affectedRows === 0) {
    throw httpError("This review's status just changed — please refresh and try again.", 409, "CONFLICT");
  }
  await audit(actorUserId, "PAYROLL_HEAD_REVIEW_APPROVED", employeeId, {});
  await writeHistory({ employeeId, reviewId: review.id, action: "approved", actorUserId });

  // Notify the Branch Head / Payroll HR who originally set up the offer (audit trail only,
  // no action required — Payroll Head is the FINAL salary approver, they don't re-approve),
  // AND the employee themselves — previously the employee was never notified at all, and
  // everyone only saw "Monthly CTC: ₹X", not the actual breakup.
  const targets = await resolveRejectionNotifyTargets(employeeId).catch(() => ({
    payrollHrUserId: null, branchHeadUserId: null,
  }));

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.full_name, e.employee_code, e.user_id, phr.salary_package_id,
            sa.ctc_annual,
            sca.basic, sca.hra, sca.conveyance, sca.special_allowance, sca.gross,
            sca.pf_applicable, sca.employer_pf AS pf_employee_note, sca.esi_applicable,
            sca.ctc, sca.net_estimate AS net_in_hand
       FROM employees e
       JOIN employee_payroll_head_review phr ON phr.employee_id = e.id
       LEFT JOIN employee_salary_assignment sa ON sa.employee_id = e.id
       LEFT JOIN salary_component_assignments sca
              ON sca.employee_id = e.id AND sca.status = 'active'
       WHERE e.id = ?
       ORDER BY sca.effective_date DESC LIMIT 1`,
    [employeeId]
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  const emp = empRows[0];
  const name = emp?.full_name ?? 'employee';
  const code = emp?.employee_code ?? '';
  const empUserId = emp?.user_id ? String(emp.user_id) : null;
  const ctcMonthly = emp?.ctc_annual ? Math.round(Number(emp.ctc_annual) / 12).toLocaleString('en-IN') : '—';

  const inr = (n: unknown) => n == null ? null : `₹${Math.round(Number(n)).toLocaleString('en-IN')}`;
  const breakupLine = (label: string, v: unknown) => { const f = inr(v); return f ? `${label}: ${f}` : null; };
  const breakup = emp ? [
    breakupLine('Basic', emp.basic), breakupLine('HRA', emp.hra), breakupLine('Conveyance', emp.conveyance),
    breakupLine('Special Allowance', emp.special_allowance), breakupLine('Gross', emp.gross),
    breakupLine('Net in Hand', emp.net_in_hand), breakupLine('CTC (monthly)', emp.ctc),
  ].filter(Boolean).join(' · ') : '';

  const notifyTargets = [targets.branchHeadUserId, targets.payrollHrUserId].filter(Boolean) as string[];
  await Promise.allSettled([
    ...notifyTargets.map((userId) =>
      inboxService.createItem({
        user_id: userId,
        type: 'payroll_head_review_approved',
        title: `Salary approved for ${name} (${code})`,
        description: breakup
          ? `Payroll Head has reviewed and approved the salary for ${name}. ${breakup}. This employee is now payroll-eligible. No action required — this is for your records.`
          : `Payroll Head has reviewed and approved the salary for ${name}. Monthly CTC: ₹${ctcMonthly}. This employee is now payroll-eligible. No action required — this is for your records.`,
        entity_type: 'employee',
        entity_id: employeeId,
        action_url: `/payroll/salary-review/${employeeId}`,
        priority: 'low',
      }).catch((e) => console.warn('[payroll-head-review] approve notify failed:', e))
    ),
    ...(empUserId ? [inboxService.createItem({
      user_id: empUserId,
      type: 'payroll_head_review_approved_employee',
      title: 'Your salary has been assigned',
      description: breakup
        ? `Your salary has been reviewed and approved. ${breakup}.`
        : `Your salary has been reviewed and approved. Monthly CTC: ₹${ctcMonthly}.`,
      entity_type: 'employee',
      entity_id: employeeId,
      priority: 'normal',
    }).catch((e) => console.warn('[payroll-head-review] approve notify employee failed:', e))] : []),
  ]);

  // Release the joining kit this approval was blocking (2026-08-27).
  //
  // dispatchJoiningKit refuses to send while employee_payroll_head_review.status is not
  // 'approved' — deliberately, because the contract appendix prints the final remuneration
  // and must not be signed before salary is settled. But nothing ever re-ran dispatch once
  // that gate opened. All three dispatch call sites (ats.convert, the creation orchestrator,
  // and the manual send route) fire at or before employee creation, and no cron retries a
  // blocked kit — so every kit blocked with 'payroll_head_not_approved' sat there
  // permanently, and releasing it meant HR pressing "Send for eSign" once per employee.
  // Approving a batch of salaries therefore appeared to dispatch nothing at all.
  //
  // Fire-and-forget and non-fatal, matching employee-creation-orchestrator's own call: an
  // approval that is already committed above must not fail because an email provider is
  // down. queueJoiningKit reuses the employee's existing open kit rather than opening a
  // second one, so this cannot duplicate a kit or regenerate drafts on one already in
  // flight. Every other block (hr_fill_pending, per_document_flow_active, no_documents)
  // still applies — this only removes the one that approval itself just cleared.
  //
  // Imported dynamically to keep the employees module out of this file's static graph,
  // matching employeeJoiningDocuments.service.ts's own late import of the same module.
  void (async () => {
    try {
      const { queueJoiningKit, dispatchJoiningKit } =
        await import("../employees/joiningKitDispatch.service.js");
      const { kitId } = await queueJoiningKit({
        employeeId,
        candidateId: null,
        actorUserId,
        triggerSource: 'payroll_head_approved',
      });
      const outcome = await dispatchJoiningKit(kitId, actorUserId);
      console.log('[payroll-head-review] joining kit after approval:', {
        employeeId,
        status: outcome.status,
        blockedReason: outcome.blockedReason ?? null,
      });
    } catch (e) {
      console.error('[payroll-head-review] joining kit after approval failed:', {
        employeeId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  })();


  return { review: await getReviewRow(employeeId) };
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

  // A 'salary' rejection resets the package/acceptance state — otherwise the
  // reviewer could resubmit and re-approve with the SAME wrong package still
  // marked accepted, having fixed nothing. Every other category leaves the
  // package alone: a documents/BGV/bank issue doesn't mean the salary was wrong.
  const salaryClause = category === "salary"
    ? `, salary_package_id = NULL, package_accepted = 0, package_accepted_by = NULL,
        package_accepted_at = NULL, package_effective_from = NULL`
    : "";
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE employee_payroll_head_review
        SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW(),
            rejection_category = ?, rejection_reason_code = ?, rejection_remarks = ?
            ${salaryClause}
      WHERE employee_id = ? AND status = 'pending_review'`,
    [actorUserId, category, reasonCode, remarks.trim(), employeeId]
  );

  // The clause above detaches the review's own pointer, but that alone left the
  // actual salary_component_assignments row sitting at status='active' forever
  // — with no salary_package_id to re-attach to, "Accept Package" could never
  // reappear on resubmission, and payrollCalculate.service.ts reads this table
  // by status alone, with no idea the review that produced the row was
  // rejected. A rejected salary review must not leave a payable-looking row
  // behind. Rejected, not deleted: the record of what was proposed and
  // rejected stays for audit.
  if (category === "salary" && result.affectedRows > 0) {
    await db.execute(
      `UPDATE salary_component_assignments SET status = 'rejected'
        WHERE employee_id = ? AND status = 'active'`,
      [employeeId]
    ).catch(() => undefined);
  }

  if (result.affectedRows === 0) {
    throw httpError("This review's status just changed — please refresh and try again.", 409, "CONFLICT");
  }
  await audit(actorUserId, "PAYROLL_HEAD_REVIEW_REJECTED", employeeId, { category, reasonCode, remarks });

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT full_name, employee_code, user_id FROM employees WHERE id = ? LIMIT 1`, [employeeId]
  );
  const empName = empRows[0]?.full_name ?? "the employee";
  const empUserId = empRows[0]?.user_id ? String(empRows[0].user_id) : null;

  let targets = await resolveRejectionNotifyTargets(employeeId);
  let usedFallback = false;
  let fallbackUserIds: string[] = [];
  if (!targets.payrollHrUserId && !targets.branchHeadUserId) {
    // Never let a rejection notify nobody — fall back to every payroll_head
    // user, since they're the ones who saw it happen and can chase it up.
    usedFallback = true;
    fallbackUserIds = await payrollHeadRoleUserIds();
  }

  const actionUrl = `/payroll/salary-review/${employeeId}`;
  const reviewerDescription = `Category: ${category} — ${reasonCode}. ${remarks.trim()}`;
  const employeeDescription = `Your salary setup needs attention: ${remarks.trim()}. HR/your manager has been notified.`;

  const notifyResults = await Promise.allSettled([
    ...[targets.payrollHrUserId, targets.branchHeadUserId, ...fallbackUserIds]
      .filter((id): id is string => !!id)
      .map((userId) =>
        inboxService.createItem({
          user_id: userId,
          type: "payroll_head_review_rejected",
          title: `Salary review rejected: ${empName}`,
          description: usedFallback
            ? `No offer/approval history found to route this to the right person automatically. ${reviewerDescription}`
            : reviewerDescription,
          entity_type: "employee",
          entity_id: employeeId,
          action_url: actionUrl,
          priority: "high",
        })
      ),
    ...(empUserId ? [inboxService.createItem({
      user_id: empUserId,
      type: "payroll_head_review_rejected_employee",
      title: "Your salary setup needs attention",
      description: employeeDescription,
      entity_type: "employee",
      entity_id: employeeId,
      priority: "normal",
    })] : []),
  ]);
  const anyNotified = notifyResults.some((r) => r.status === "fulfilled");

  await writeHistory({
    employeeId, reviewId: review.id, action: "rejected", actorUserId,
    rejectionCategory: category, rejectionReasonCode: reasonCode, rejectionRemarks: remarks.trim(),
    notifiedPayrollHrUserId: targets.payrollHrUserId,
    notifiedBranchHeadUserId: targets.branchHeadUserId,
    notifiedEmployee: !!empUserId,
  });

  return {
    review: await getReviewRow(employeeId),
    notification: {
      notified: anyNotified,
      usedFallback,
      employeeNotified: !!empUserId,
    },
  };
}

export async function resubmit(employeeId: string, actorUserId: string) {
  const review = await getReviewRow(employeeId);
  if (!review) throw httpError("No payroll-head review record for this employee.", 404, "NOT_FOUND");
  if (review.status !== "rejected") {
    throw httpError(`Cannot resubmit a review with status "${review.status}".`, 409, "NOT_REJECTED");
  }
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE employee_payroll_head_review
        SET status = 'pending_review', resubmitted_at = NOW(), resubmit_count = resubmit_count + 1
      WHERE employee_id = ? AND status = 'rejected'`,
    [employeeId]
  );
  if (result.affectedRows === 0) {
    throw httpError("This review's status just changed — please refresh and try again.", 409, "CONFLICT");
  }
  await audit(actorUserId, "PAYROLL_HEAD_REVIEW_RESUBMITTED", employeeId, {});
  await writeHistory({ employeeId, reviewId: review.id, action: "resubmitted", actorUserId });
  return { review: await getReviewRow(employeeId) };
}

/**
 * Correction path for a mistake caught after approval. Deliberately does NOT
 * touch any already-run payroll calculation or payment — it only re-gates
 * FUTURE runs by moving the review back to pending_review. A reason is
 * mandatory and the whole thing is heavily audited (sensitive_action_log +
 * history), since un-terminal-ing an approval is exactly the kind of action
 * that needs a clear trail.
 */
export async function reopen(employeeId: string, reason: string, actorUserId: string) {
  const review = await getReviewRow(employeeId);
  if (!review) throw httpError("No payroll-head review record for this employee.", 404, "NOT_FOUND");
  if (review.status !== "approved") {
    throw httpError(`Cannot reopen a review with status "${review.status}".`, 409, "NOT_APPROVED");
  }
  if (!reason || !reason.trim()) {
    throw httpError("A reason is required to reopen an approved review.", 400, "REASON_REQUIRED");
  }
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE employee_payroll_head_review
        SET status = 'pending_review', reopened_at = NOW(), reopened_by = ?,
            reopen_reason = ?, reopen_count = reopen_count + 1
      WHERE employee_id = ? AND status = 'approved'`,
    [actorUserId, reason.trim(), employeeId]
  );
  if (result.affectedRows === 0) {
    throw httpError("This review's status just changed — please refresh and try again.", 409, "CONFLICT");
  }
  await audit(actorUserId, "PAYROLL_HEAD_REVIEW_REOPENED", employeeId, { reason: reason.trim() });
  await writeHistory({ employeeId, reviewId: review.id, action: "reopened", actorUserId, reopenReason: reason.trim() });
  return { review: await getReviewRow(employeeId) };
}

export async function listReasons() {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT code, category, label FROM payroll_head_review_reason_master WHERE active = 1 ORDER BY category, label`
  );
  return rows;
}
