import { db } from '../../db/mysql.js';
import { resolveBranchHeadScope, buildCandidateBranchPredicate } from './branch-head-scope.js';
import { getUserAssignmentScopes } from '../../shared/scopeAccess.js';
import { RowDataPacket } from 'mysql2/promise';
import { sendSelectedEmail, sendRejectedEmail } from './ats.email.service.js';
import { approveOffer, rejectOffer } from './ats.onboarding.service.js';
import { inboxService } from '../inbox/inbox.service.js';

/**
 * Branch Head Approval Service
 * Handles approval workflow for selected candidates before final offer
 */

export interface PendingApproval {
  id: string;
  candidate_id: string;
  candidate_code: string;
  candidate_name: string;
  mobile: string;
  email: string;
  applied_for_role: string;
  applied_for_branch: string;
  branch_display_name: string;
  employment_type: 'onroll' | 'offrole';
  gross_salary: number;
  joining_date: string;
  salary_start_date: string;
  basic_salary: number;
  hra: number;
  conveyance: number;
  special_allowance: number;
  pf_amount: number;
  esic_amount: number;
  submitted_by: string;
  submitted_at: string;
  approval_status: 'pending' | 'approved' | 'rejected';
}

export interface ApprovalInput {
  approval_id: string;
  branch_head_id: string;
  branch_head_user_id?: string;
  approval_status: 'approved' | 'rejected';
  remarks?: string;
}

export interface EmployeeCodeGeneration {
  company_prefix: 'MAS' | 'IDC';
  is_offrole: boolean;
}

interface BranchRow extends RowDataPacket {
  branch_name: string;
}

interface ApprovalHistoryRow extends RowDataPacket {
  id: string;
  approval_status: 'pending' | 'approved' | 'rejected';
  employee_code_generated?: number | null;
  remarks?: string | null;
  approved_at?: string | null;
  branch_head_name?: string | null;
  branch_head_code?: string | null;
}

/**
 * Resolve all branch names and IDs a branch head is allowed to see.
 *
 * Source A: branch_head_assignments (legacy, keyed by employees.id)
 * Source B: user_assignment_scope   (modern, keyed by auth_user.id)
 *
 * Both are unioned so a branch head assigned via either path works.
 * authUserId is optional for backward-compat callers that only have employees.id.
 */
async function resolveBranchScope(
  branchHeadId: string,
  authUserId?: string,
): Promise<{ branchNames: string[]; branchIds: string[] }> {
  const [legacyRows] = await db.execute<BranchRow[]>(
    `SELECT DISTINCT branch_name FROM branch_head_assignments
      WHERE branch_head_id = ? AND is_active = TRUE`,
    [branchHeadId],
  ).catch(() => [[]] as unknown as [BranchRow[]]);

  const branchNames = legacyRows.map((r) => r.branch_name).filter(Boolean);

  let branchIds: string[] = [];
  if (authUserId) {
    const scopes = await getUserAssignmentScopes(authUserId, ['branch_head']).catch(() => []);
    branchIds = scopes.map((s) => String(s.branch_id ?? '')).filter(Boolean);
  }

  return { branchNames, branchIds };
}

/**
 * Get pending approvals for branch head
 */
export async function getPendingApprovals(branchHeadId: string, authUserId?: string): Promise<PendingApproval[]> {
  const { branchNames, branchIds } = await resolveBranchScope(branchHeadId, authUserId);

  if (branchNames.length === 0 && branchIds.length === 0) {
    return [];
  }

  // Build WHERE clause covering both name-based and id-based branch matches.
  const whereClauses: string[] = [];
  const branchMatchParams: unknown[] = [];

  if (branchNames.length > 0) {
    const ph = branchNames.map(() => '?').join(',');
    whereClauses.push(
      `c.applied_for_branch IN (${ph})`,
      `c.branch_display_name IN (${ph})`,
      `cb.branch_name IN (${ph})`,
      `cb.branch_code IN (${ph})`,
    );
    branchMatchParams.push(...branchNames, ...branchNames, ...branchNames, ...branchNames);
  }

  if (branchIds.length > 0) {
    const ph = branchIds.map(() => '?').join(',');
    whereClauses.push(`c.applied_for_branch IN (${ph})`, `cb.id IN (${ph})`);
    branchMatchParams.push(...branchIds, ...branchIds);
  }

  // Get pending approvals for these branches
  const [approvals] = await db.execute<RowDataPacket[]>(
    `SELECT
      phv.id,
      phv.candidate_id,
      c.candidate_code,
      c.full_name as candidate_name,
      c.mobile,
      c.email,
      COALESCE(c.role_applied, c.applied_for_process) AS applied_for_role,
      c.applied_for_branch,
      c.branch_display_name,
      phv.employment_type,
      phv.gross_salary,
      phv.joining_date,
      phv.salary_start_date,
      JSON_UNQUOTE(JSON_EXTRACT(phv.salary_components, '$.basic')) as basic_salary,
      JSON_UNQUOTE(JSON_EXTRACT(phv.salary_components, '$.hra')) as hra,
      JSON_UNQUOTE(JSON_EXTRACT(phv.salary_components, '$.conveyance')) as conveyance,
      JSON_UNQUOTE(JSON_EXTRACT(phv.salary_components, '$.specialAllowance')) as special_allowance,
      0 as pf_amount,
      0 as esic_amount,
      e.full_name as submitted_by,
      phv.validated_at as submitted_at,
      bha.approval_status
    FROM ats_payroll_hr_validation phv
    INNER JOIN ats_candidate c ON c.id = phv.candidate_id
    INNER JOIN ats_branch_head_approval bha ON bha.payroll_validation_id = phv.id
    LEFT JOIN employees e ON e.id = phv.payroll_hr_id
    LEFT JOIN branch_master cb
      ON cb.id = c.applied_for_branch
      OR cb.branch_name = c.applied_for_branch
      OR cb.branch_code = c.applied_for_branch
    WHERE phv.validation_status = 'validated'
      AND bha.approval_status = 'pending'
      AND (${whereClauses.join(' OR ')})
      AND c.current_stage = 'payroll_validated'
    ORDER BY phv.validated_at DESC`,
    branchMatchParams
  );

  return approvals as PendingApproval[];
}

/**
 * Process branch head approval
 */
export async function processBranchHeadApproval(input: ApprovalInput): Promise<{
  success: boolean;
  message: string;
  employee_code?: string;
}> {
  const { approval_id, branch_head_id, approval_status, remarks } = input;
  const actorUserId = input.branch_head_user_id ?? branch_head_id;

  // Get approval details
  const [approvals] = await db.execute<RowDataPacket[]>(
    `SELECT
      phv.candidate_id,
      phv.employment_type,
      c.candidate_code,
      c.full_name,
      c.email,
      c.applied_for_branch,
      o.id AS offer_id
    FROM ats_payroll_hr_validation phv
    LEFT JOIN ats_onboarding_request r ON r.candidate_id = phv.candidate_id
    LEFT JOIN ats_employment_offer o ON o.onboarding_request_id = r.id AND o.status = 'submitted'
    INNER JOIN ats_candidate c ON c.id = phv.candidate_id
    WHERE phv.id = ?
    ORDER BY o.submitted_at DESC
    LIMIT 1`,
    [approval_id]
  );

  if (approvals.length === 0) {
    return {
      success: false,
      message: 'Approval record not found',
    };
  }

  const approval = approvals[0];

  // Start transaction
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    if (approval_status === 'approved') {
      await connection.execute(
        `UPDATE salary_exception_proposal
            SET status = 'approved', approved_by = ?, approved_at = NOW(), updated_at = NOW()
          WHERE candidate_id = ? AND status = 'pending'`,
        [branch_head_id, approval.candidate_id]
      );

      await connection.execute(
        `UPDATE ats_branch_head_approval
            SET branch_head_id = ?, approval_status = 'approved', remarks = ?, approved_at = NOW(), updated_at = NOW()
          WHERE payroll_validation_id = ? AND approval_status = 'pending'`,
        [branch_head_id, remarks || null, approval_id]
      );

      await connection.execute(
        `UPDATE ats_candidate
        SET current_stage = 'offer_approved',
            updated_at = NOW()
        WHERE id = ?`,
        [approval.candidate_id]
      );

      await connection.execute(
        `INSERT INTO ats_candidate_stage_log
           (id, candidate_id, from_stage, to_stage, remarks, updated_by)
         VALUES (UUID(), ?, 'payroll_validated', 'offer_approved', ?, ?)`,
        [approval.candidate_id, remarks || 'Branch Head approved final offer', branch_head_id]
      );

      await connection.commit();

      const conversion = approval.offer_id
        ? await approveOffer(String(approval.offer_id), actorUserId, remarks)
        : null;

      // Fire-and-forget: send approval email after transaction commits
      if (!approval.offer_id && approval.email) {
        sendSelectedEmail({
          candidateId: approval.candidate_id,
          to: approval.email,
          candidateName: approval.full_name,
          branchName: approval.applied_for_branch,
          hrName: 'MAS Callnet HR',
          hrPhone: '',
        }).catch((err: unknown) => console.error('[branch-head] approval email failed:', err));
      }

      // Notify the submitting HR/recruiter that the offer was approved
      void (async () => {
        try {
          const [submitterRows] = await db.execute<RowDataPacket[]>(
            `SELECT phv.payroll_hr_id, e.user_id AS user_id
             FROM ats_payroll_hr_validation phv
             LEFT JOIN employees e ON e.id = phv.payroll_hr_id
             WHERE phv.id = ? LIMIT 1`,
            [approval_id]
          );
          const userId = submitterRows[0]?.user_id as string | null;
          if (userId) {
            await inboxService.createItem({
              user_id: userId,
              type: 'offer_approved',
              title: `Offer Approved: ${approval.full_name ?? 'Candidate'}`,
              description: `${approval.full_name ?? 'Candidate'}'s offer has been approved by Branch Head${remarks ? `: "${remarks}"` : ''}. Proceed to employee conversion.`,
              entity_type: 'ats_candidate',
              entity_id: approval.candidate_id as string,
              action_url: '/ats/onboarding-requests',
              priority: 'high',
            });
          }
        } catch (e) {
          console.warn('[branch-head] offer approval inbox notification failed:', e);
        }
      })();

      return {
        success: true,
        message: approval.offer_id
          ? 'Approval successful. Employee conversion completed through canonical offer approval.'
          : 'Approval recorded. Submit an employment offer to complete canonical employee conversion.',
        employee_code: conversion?.employeeCode ?? undefined,
      };
    } else {
      await connection.execute(
        `UPDATE ats_branch_head_approval
            SET branch_head_id = ?, approval_status = 'rejected', remarks = ?, approved_at = NOW(), updated_at = NOW()
          WHERE payroll_validation_id = ? AND approval_status = 'pending'`,
        [branch_head_id, remarks || null, approval_id]
      );

      // Update candidate stage
      await connection.execute(
        `UPDATE ats_candidate
        SET current_stage = 'payroll_validated', updated_at = NOW()
        WHERE id = ?`,
        [approval.candidate_id]
      );

      await connection.execute(
        `UPDATE ats_payroll_hr_validation
            SET validation_status = 'correction_requested', remarks = ?, updated_at = NOW()
          WHERE id = ?`,
        [remarks || 'Rejected by Branch Head', approval_id]
      );

      await connection.execute(
        `UPDATE salary_exception_proposal
            SET status = 'rejected', rejection_reason = ?, approved_by = ?, approved_at = NOW(), updated_at = NOW()
          WHERE candidate_id = ? AND status = 'pending'`,
        [remarks || 'Rejected by Branch Head', branch_head_id, approval.candidate_id]
      );

      await connection.execute(
        `INSERT INTO ats_candidate_stage_log
           (id, candidate_id, from_stage, to_stage, remarks, updated_by)
         VALUES (UUID(), ?, 'payroll_validated', 'payroll_correction_requested', ?, ?)`,
        [approval.candidate_id, remarks || 'Branch Head rejected offer; returned to Payroll HR', branch_head_id]
      );

      await connection.commit();

      if (approval.offer_id && remarks) {
        await rejectOffer(String(approval.offer_id), actorUserId, remarks);
      }

      // Fire-and-forget: send rejection email after transaction commits
      if (!approval.offer_id && approval.email) {
        sendRejectedEmail({
          candidateId: approval.candidate_id,
          to: approval.email,
          candidateName: approval.full_name,
          branchName: approval.applied_for_branch,
        }).catch((err: unknown) => console.error('[branch-head] rejection email failed:', err));
      }

      return {
        success: true,
        message: 'Rejection recorded and candidate notified.',
      };
    }
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Get approval history for a candidate
 */
export async function getApprovalHistory(candidateId: string): Promise<ApprovalHistoryRow[]> {
  const [history] = await db.execute<ApprovalHistoryRow[]>(
    `SELECT
      bha.id,
      bha.approval_status,
      bha.employee_code_generated,
      bha.remarks,
      bha.approved_at,
      bha.created_at,
      bha.updated_at,
      e.full_name as branch_head_name,
      e.employee_code as branch_head_code
    FROM ats_branch_head_approval bha
    INNER JOIN ats_payroll_hr_validation phv ON phv.id = bha.payroll_validation_id
    LEFT JOIN employees e ON e.id = bha.branch_head_id
    WHERE phv.candidate_id = ?
    -- approved_at is NULL on a pending row (migration 1055 made it nullable so a
    -- freshly raised request stops claiming an approval time), so ordering on it
    -- alone sorted pending rows arbitrarily.
    ORDER BY COALESCE(bha.approved_at, bha.updated_at, bha.created_at) DESC`,
    [candidateId]
  );

  return history;
}

/**
 * Get branch head statistics
 */
export async function getBranchHeadStats(branchHeadId: string, authUserId?: string): Promise<{
  total_pending: number;
  total_approved: number;
  total_rejected: number;
  this_month_approved: number;
}> {
  const { branchNames, branchIds } = await resolveBranchScope(branchHeadId, authUserId);

  let pendingCount = 0;
  if (branchNames.length > 0 || branchIds.length > 0) {
    const whereClauses: string[] = [];
    const params: unknown[] = [];
    if (branchNames.length > 0) {
      const ph = branchNames.map(() => '?').join(',');
      whereClauses.push(
        `c.applied_for_branch IN (${ph})`,
        `c.branch_display_name IN (${ph})`,
        `cb.branch_name IN (${ph})`,
        `cb.branch_code IN (${ph})`,
      );
      params.push(...branchNames, ...branchNames, ...branchNames, ...branchNames);
    }
    if (branchIds.length > 0) {
      const ph = branchIds.map(() => '?').join(',');
      whereClauses.push(`c.applied_for_branch IN (${ph})`, `cb.id IN (${ph})`);
      params.push(...branchIds, ...branchIds);
    }

    const [stats] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as total_pending
       FROM ats_payroll_hr_validation phv
       INNER JOIN ats_candidate c ON c.id = phv.candidate_id
       INNER JOIN ats_branch_head_approval approval ON approval.payroll_validation_id = phv.id
       LEFT JOIN branch_master cb
         ON cb.id = c.applied_for_branch
         OR cb.branch_name = c.applied_for_branch
         OR cb.branch_code = c.applied_for_branch
       WHERE phv.validation_status = 'validated'
         AND approval.approval_status = 'pending'
         AND c.current_stage = 'payroll_validated'
         AND (${whereClauses.join(' OR ')})`,
      params,
    );
    pendingCount = Number(stats[0]?.total_pending ?? 0);
  }

  const [stats] = [[ { total_pending: pendingCount } ]];

  const [approved] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as total_approved
    FROM ats_branch_head_approval bha
    WHERE bha.branch_head_id = ? AND bha.approval_status = 'approved'`,
    [branchHeadId]
  );

  const [rejected] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as total_rejected
    FROM ats_branch_head_approval bha
    WHERE bha.branch_head_id = ? AND bha.approval_status = 'rejected'`,
    [branchHeadId]
  );

  const [thisMonth] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as this_month_approved
    FROM ats_branch_head_approval bha
    WHERE bha.branch_head_id = ?
      AND bha.approval_status = 'approved'
      AND MONTH(bha.approved_at) = MONTH(CURRENT_DATE())
      AND YEAR(bha.approved_at) = YEAR(CURRENT_DATE())`,
    [branchHeadId]
  );

  return {
    total_pending: stats[0]?.total_pending || 0,
    total_approved: approved[0]?.total_approved || 0,
    total_rejected: rejected[0]?.total_rejected || 0,
    this_month_approved: thisMonth[0]?.this_month_approved || 0,
  };
}


export type BranchHeadDecisionRow = {
  offer_id: string | null;
  candidate_id: string;
  candidate_code: string | null;
  candidate_name: string | null;
  branch_name: string | null;
  decision: string;
  decided_at: string | null;
  decided_by_name: string | null;
  decided_by_code: string | null;
  remarks: string | null;
  employee_code: string | null;
  gross: string | null;
  date_of_joining: string | null;
  source: string;
};

/**
 * Past approvals and rejections, scoped to the caller's branches.
 *
 * Primary source is the OFFERS trail — ats_employment_offer joined to
 * ats_offer_approval. Production holds 14 rows there against 3 in
 * ats_branch_head_approval, because /ats/offer-approvals (the screen in the nav
 * menu) has always written to the offer tables and never to the approval table.
 * Reading the approval table as primary would show a branch head almost none of
 * their own history.
 *
 * ats_branch_head_approval is LEFT JOINed so decisions taken through the legacy
 * screen still appear, reached via ats_payroll_hr_validation.candidate_id —
 * never bha.candidate_id, which production's migration 141 does not have.
 */
export async function listBranchHeadDecisions(
  authUserId: string,
  opts: { status: 'approved' | 'rejected' | 'all'; search?: string | null; limit: number; offset: number },
): Promise<{ data: BranchHeadDecisionRow[]; total: number; scopeEmpty: boolean }> {
  const scope = await resolveBranchHeadScope(authUserId);
  const pred = buildCandidateBranchPredicate(scope, { candidate: 'c', branch: 'b' });

  // Distinguish "nothing decided yet" from "you have no branches assigned" —
  // the caller renders a different empty state for each.
  const scopeEmpty = !scope.unrestricted
    && scope.branchNames.length === 0 && scope.branchIds.length === 0;
  if (scopeEmpty) return { data: [], total: 0, scopeEmpty: true };

  const statusSql =
    opts.status === 'approved' ? `o.status = 'bh_approved'`
    : opts.status === 'rejected' ? `o.status = 'bh_rejected'`
    : `o.status IN ('bh_approved','bh_rejected')`;

  const params: unknown[] = [];
  let searchSql = '';
  if (opts.search && opts.search.trim()) {
    searchSql = ` AND (c.full_name LIKE ? OR c.candidate_code LIKE ?)`;
    const like = `%${opts.search.trim()}%`;
    params.push(like, like);
  }

  const base = `
     FROM ats_employment_offer o
     JOIN ats_candidate c ON c.id = o.candidate_id
     LEFT JOIN branch_master b
            ON b.id = c.applied_for_branch
            OR b.branch_name = c.applied_for_branch
            OR b.branch_code = c.applied_for_branch
     LEFT JOIN ats_offer_approval oa
            ON oa.offer_id = o.id
           AND oa.id = (SELECT x.id FROM ats_offer_approval x
                         WHERE x.offer_id = o.id ORDER BY x.action_at DESC LIMIT 1)
     LEFT JOIN employees dec_by ON dec_by.id = oa.approver_id OR dec_by.user_id = oa.approver_id
     -- Pick ONE row from each of these, not every match. A candidate can hold
     -- several validations and several bridge rows, and a plain LEFT JOIN
     -- multiplies the result: production returned 13 rows for 7 rejections,
     -- listing the same candidate two and three times.
     LEFT JOIN ats_payroll_hr_validation phv
            ON phv.id = (SELECT x.id FROM ats_payroll_hr_validation x
                          WHERE x.candidate_id = c.id
                          ORDER BY COALESCE(x.validated_at, x.created_at) DESC LIMIT 1)
     LEFT JOIN ats_branch_head_approval bha ON bha.payroll_validation_id = phv.id
     LEFT JOIN ats_onboarding_bridge ob
            ON ob.id = (SELECT y.id FROM ats_onboarding_bridge y
                         WHERE y.candidate_id = c.id
                         ORDER BY y.created_at DESC LIMIT 1)
     LEFT JOIN employees emp ON emp.id = ob.employee_id
    WHERE ${statusSql} AND ${pred.sql}${searchSql}`;

  const whereParams = [...pred.params, ...params];

  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT o.id) AS n ${base}`, whereParams,
  ).catch(() => [[{ n: 0 }]] as unknown as [RowDataPacket[]]);

  // GROUP BY o.id, not SELECT DISTINCT.
  //
  // Several joins here are one-to-many no matter how the subqueries are
  // written: branch_master is matched on id OR name OR code, and employees on
  // id OR user_id, so either can return more than one row. DISTINCT does not
  // help, because the duplicate rows differ in exactly the column that fanned
  // out. Production returned 13 rows for 7 rejections that way. Grouping on the
  // offer guarantees one row per decision regardless of how any join behaves.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
        o.id AS offer_id,
        MIN(c.id) AS candidate_id,
        MIN(c.candidate_code) AS candidate_code,
        MIN(c.full_name) AS candidate_name,
        COALESCE(MIN(b.branch_name), MIN(c.applied_for_branch)) AS branch_name,
        CASE WHEN MIN(o.status) = 'bh_approved' THEN 'approved' ELSE 'rejected' END AS decision,
        COALESCE(MIN(oa.action_at), MIN(bha.approved_at), MIN(o.updated_at)) AS decided_at,
        MIN(dec_by.full_name) AS decided_by_name,
        MIN(dec_by.employee_code) AS decided_by_code,
        COALESCE(MIN(oa.remarks), MIN(bha.remarks)) AS remarks,
        COALESCE(MIN(emp.employee_code), MIN(ob.employee_code)) AS employee_code,
        MIN(o.gross) AS gross,
        MIN(o.date_of_joining) AS date_of_joining,
        CASE WHEN MIN(oa.id) IS NOT NULL THEN 'offer' ELSE 'legacy' END AS source
      ${base}
      GROUP BY o.id
      ORDER BY decided_at DESC
      LIMIT ${Number(opts.limit) || 100} OFFSET ${Number(opts.offset) || 0}`,
    whereParams,
  );

  return {
    data: rows as unknown as BranchHeadDecisionRow[],
    total: Number(countRows[0]?.n ?? 0),
    scopeEmpty: false,
  };
}
