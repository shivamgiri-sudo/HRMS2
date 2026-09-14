/**
 * IJP Service
 * Business logic for Internal Job Posting module
 */

import { randomUUID } from 'crypto';
import { sqlLimitOffset } from "../../db/pagination.js";
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { resolveUserBusinessScope, buildProcessScopeCondition, type EnterpriseUser } from '../../shared/enterpriseScope.js';
import type {
  IjpPosting,
  IjpPostingWithDetails,
  IjpApplication,
  IjpApplicationWithDetails,
  IjpApplicationStatus,
  EligibilityCheckResult,
  CreatePostingInput,
  UpdatePostingInput,
  ApplyInput,
  UpdateApplicationStatusInput,
} from './ijp.types.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return fallback;
}

function generatePostingCode(): string {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `IJP-${year}${month}-${random}`;
}

function calculateTenureMonths(dateOfJoining: Date | string | null): number {
  if (!dateOfJoining) return 0;
  const joinDate = new Date(dateOfJoining);
  if (isNaN(joinDate.getTime())) return 0;
  const now = new Date();
  const diffMs = now.getTime() - joinDate.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30.4375));
}

async function auditLog(
  action: string,
  actorId: string,
  opts: {
    postingId?: string;
    applicationId?: string;
    actorRole?: string;
    oldValue?: Record<string, unknown>;
    newValue?: Record<string, unknown>;
    details?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
  } = {}
): Promise<void> {
  await db.execute(
    `INSERT INTO ijp_audit_log
     (id, posting_id, application_id, action, actor_id, actor_role,
      old_value, new_value, details, ip_address, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      randomUUID(),
      opts.postingId ?? null,
      opts.applicationId ?? null,
      action,
      actorId,
      opts.actorRole ?? null,
      opts.oldValue ? JSON.stringify(opts.oldValue) : null,
      opts.newValue ? JSON.stringify(opts.newValue) : null,
      opts.details ? JSON.stringify(opts.details) : null,
      opts.ipAddress ?? null,
      opts.userAgent ?? null,
    ]
  );
}

// ─── Posting CRUD ───────────────────────────────────────────────────────────

export async function createPosting(
  input: CreatePostingInput,
  createdBy: string,
  opts: { ipAddress?: string; userAgent?: string } = {}
): Promise<IjpPosting> {
  const id = randomUUID();
  const postingCode = generatePostingCode();

  await db.execute(
    `INSERT INTO ijp_posting
     (id, posting_code, job_title, description,
      department_id, process_id, designation_id, branch_id, vacancies,
      min_tenure_months, eligible_employment_status,
      eligible_department_ids, eligible_process_ids, excluded_process_ids,
      eligible_designation_ids, eligible_branch_ids,
      min_performance_rating, require_manager_approval,
      status, posted_by, closes_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, NOW(), NOW())`,
    [
      id,
      postingCode,
      input.job_title,
      input.description ?? null,
      input.department_id ?? null,
      input.process_id ?? null,
      input.designation_id ?? null,
      input.branch_id ?? null,
      input.vacancies ?? 1,
      input.min_tenure_months ?? 12,
      JSON.stringify(input.eligible_employment_status ?? ['Active']),
      input.eligible_department_ids ? JSON.stringify(input.eligible_department_ids) : null,
      input.eligible_process_ids ? JSON.stringify(input.eligible_process_ids) : null,
      input.excluded_process_ids ? JSON.stringify(input.excluded_process_ids) : null,
      input.eligible_designation_ids ? JSON.stringify(input.eligible_designation_ids) : null,
      input.eligible_branch_ids ? JSON.stringify(input.eligible_branch_ids) : null,
      input.min_performance_rating ?? null,
      input.require_manager_approval ? 1 : 0,
      createdBy,
      input.closes_at ?? null,
    ]
  );

  await auditLog('posting_created', createdBy, {
    postingId: id,
    newValue: { posting_code: postingCode, job_title: input.job_title },
    ipAddress: opts.ipAddress,
    userAgent: opts.userAgent,
  });

  return getPostingById(id) as Promise<IjpPosting>;
}

export async function getPostingById(id: string): Promise<IjpPosting | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM ijp_posting WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    ...row,
    eligible_employment_status: parseJson(row.eligible_employment_status, ['Active']),
    eligible_department_ids: parseJson(row.eligible_department_ids, null),
    eligible_process_ids: parseJson(row.eligible_process_ids, null),
    excluded_process_ids: parseJson(row.excluded_process_ids, null),
    eligible_designation_ids: parseJson(row.eligible_designation_ids, null),
    eligible_branch_ids: parseJson(row.eligible_branch_ids, null),
    require_manager_approval: Boolean(row.require_manager_approval),
  } as IjpPosting;
}

export async function listPostings(
  actor: EnterpriseUser,
  filters: {
    status?: string;
    departmentId?: string;
    processId?: string;
    branchId?: string;
    limit?: number;
    offset?: number;
  }
): Promise<{ postings: IjpPostingWithDetails[]; total: number }> {
  // Row scope, not just a role gate. requireRole('branch_head', 'process_manager',
  // 'operations_manager', ...) in ijp.routes.ts only checks role membership — it does not
  // restrict WHICH postings those roles see, so this used to return every posting company-
  // wide to any of them regardless of branch/process. branchId/processId in `filters` are
  // caller-supplied query params (an optional UI convenience filter), not derived from the
  // caller's own identity, so omitting them bypassed nothing — a branch_head could simply
  // not pass branch_id and see every branch. buildProcessScopeCondition returns 1=1 for
  // super_admin/admin/hr/ceo (hr covers hr_admin/recruitment_hr — see resolveUserBusinessScope),
  // so HR keeps its org-wide view; everyone else is restricted to their assigned
  // branch/process/department via user_assignment_scope, the same mechanism
  // job-requisition.service.ts already uses for this exact role set.
  const scope = await resolveUserBusinessScope(actor);
  const scopeCond = buildProcessScopeCondition(scope, {
    processId: 'p.process_id',
    branchId: 'p.branch_id',
    departmentId: 'p.department_id',
  });

  const conditions: string[] = ['1=1', `(${scopeCond.sql})`];
  const params: unknown[] = [...scopeCond.params];

  if (filters.status) {
    conditions.push('p.status = ?');
    params.push(filters.status);
  }
  if (filters.departmentId) {
    conditions.push('p.department_id = ?');
    params.push(filters.departmentId);
  }
  if (filters.processId) {
    conditions.push('p.process_id = ?');
    params.push(filters.processId);
  }
  if (filters.branchId) {
    conditions.push('p.branch_id = ?');
    params.push(filters.branchId);
  }

  const where = conditions.join(' AND ');
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM ijp_posting p WHERE ${where}`,
    params
  );
  const total = Number(countRows[0]?.total ?? 0);

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT p.*,
            dm.dept_name AS department_name,
            pm.process_name AS process_name,
            dsm.designation_name AS designation_name,
            bm.branch_name AS branch_name,
            CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS posted_by_name,
            (SELECT COUNT(*) FROM ijp_application a WHERE a.posting_id = p.id) AS application_count
     FROM ijp_posting p
     LEFT JOIN department_master dm ON dm.id = p.department_id
     LEFT JOIN process_master pm ON pm.id = p.process_id
     LEFT JOIN designation_master dsm ON dsm.id = p.designation_id
     LEFT JOIN branch_master bm ON bm.id = p.branch_id
     LEFT JOIN employees e ON e.id = p.posted_by
     WHERE ${where}
     ORDER BY p.created_at DESC
     ${sqlLimitOffset(limit, offset)}`,
    params
  );

  const postings = rows.map((row) => ({
    ...row,
    eligible_employment_status: parseJson(row.eligible_employment_status, ['Active']),
    eligible_department_ids: parseJson(row.eligible_department_ids, null),
    eligible_process_ids: parseJson(row.eligible_process_ids, null),
    excluded_process_ids: parseJson(row.excluded_process_ids, null),
    eligible_designation_ids: parseJson(row.eligible_designation_ids, null),
    eligible_branch_ids: parseJson(row.eligible_branch_ids, null),
    require_manager_approval: Boolean(row.require_manager_approval),
    application_count: Number(row.application_count ?? 0),
  })) as IjpPostingWithDetails[];

  return { postings, total };
}

export async function updatePosting(
  id: string,
  input: UpdatePostingInput,
  updatedBy: string,
  opts: { ipAddress?: string; userAgent?: string } = {}
): Promise<IjpPosting | null> {
  const existing = await getPostingById(id);
  if (!existing) return null;

  const updates: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [];

  if (input.job_title !== undefined) {
    updates.push('job_title = ?');
    params.push(input.job_title);
  }
  if (input.description !== undefined) {
    updates.push('description = ?');
    params.push(input.description);
  }
  if (input.department_id !== undefined) {
    updates.push('department_id = ?');
    params.push(input.department_id || null);
  }
  if (input.process_id !== undefined) {
    updates.push('process_id = ?');
    params.push(input.process_id || null);
  }
  if (input.designation_id !== undefined) {
    updates.push('designation_id = ?');
    params.push(input.designation_id || null);
  }
  if (input.branch_id !== undefined) {
    updates.push('branch_id = ?');
    params.push(input.branch_id || null);
  }
  if (input.vacancies !== undefined) {
    updates.push('vacancies = ?');
    params.push(input.vacancies);
  }
  if (input.min_tenure_months !== undefined) {
    updates.push('min_tenure_months = ?');
    params.push(input.min_tenure_months);
  }
  if (input.eligible_employment_status !== undefined) {
    updates.push('eligible_employment_status = ?');
    params.push(JSON.stringify(input.eligible_employment_status));
  }
  if (input.eligible_department_ids !== undefined) {
    updates.push('eligible_department_ids = ?');
    params.push(input.eligible_department_ids ? JSON.stringify(input.eligible_department_ids) : null);
  }
  if (input.eligible_process_ids !== undefined) {
    updates.push('eligible_process_ids = ?');
    params.push(input.eligible_process_ids ? JSON.stringify(input.eligible_process_ids) : null);
  }
  if (input.excluded_process_ids !== undefined) {
    updates.push('excluded_process_ids = ?');
    params.push(input.excluded_process_ids ? JSON.stringify(input.excluded_process_ids) : null);
  }
  if (input.eligible_designation_ids !== undefined) {
    updates.push('eligible_designation_ids = ?');
    params.push(input.eligible_designation_ids ? JSON.stringify(input.eligible_designation_ids) : null);
  }
  if (input.eligible_branch_ids !== undefined) {
    updates.push('eligible_branch_ids = ?');
    params.push(input.eligible_branch_ids ? JSON.stringify(input.eligible_branch_ids) : null);
  }
  if (input.min_performance_rating !== undefined) {
    updates.push('min_performance_rating = ?');
    params.push(input.min_performance_rating);
  }
  if (input.require_manager_approval !== undefined) {
    updates.push('require_manager_approval = ?');
    params.push(input.require_manager_approval ? 1 : 0);
  }
  if (input.closes_at !== undefined) {
    updates.push('closes_at = ?');
    params.push(input.closes_at || null);
  }
  if (input.status !== undefined) {
    updates.push('status = ?');
    params.push(input.status);
    if (input.status === 'open' && !existing.posted_at) {
      updates.push('posted_at = NOW()');
    }
    if (['closed', 'filled', 'cancelled'].includes(input.status)) {
      updates.push('closed_at = NOW()');
      if (input.close_reason) {
        updates.push('close_reason = ?');
        params.push(input.close_reason);
      }
    }
  }

  if (updates.length === 1) return existing; // Only updated_at

  params.push(id);
  await db.execute(
    `UPDATE ijp_posting SET ${updates.join(', ')} WHERE id = ?`,
    params
  );

  await auditLog('posting_updated', updatedBy, {
    postingId: id,
    oldValue: { status: existing.status },
    newValue: input as Record<string, unknown>,
    ipAddress: opts.ipAddress,
    userAgent: opts.userAgent,
  });

  return getPostingById(id);
}

export async function publishPosting(
  id: string,
  publishedBy: string,
  opts: { ipAddress?: string; userAgent?: string } = {}
): Promise<IjpPosting | null> {
  return updatePosting(id, { status: 'open' }, publishedBy, opts);
}

export async function closePosting(
  id: string,
  reason: string,
  closedBy: string,
  opts: { ipAddress?: string; userAgent?: string; filled?: boolean } = {}
): Promise<IjpPosting | null> {
  return updatePosting(
    id,
    { status: opts.filled ? 'filled' : 'closed', close_reason: reason },
    closedBy,
    opts
  );
}

// ─── Eligibility ────────────────────────────────────────────────────────────

export async function checkEligibility(
  employeeId: string,
  postingId: string
): Promise<EligibilityCheckResult> {
  const posting = await getPostingById(postingId);
  if (!posting) {
    return { eligible: false, reasons: ['Posting not found'], tenure_months: 0, employment_status: '' };
  }

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.*, dm.dept_name, pm.process_name, dsm.designation_name, bm.branch_name
     FROM employees e
     LEFT JOIN department_master dm ON dm.id = e.department_id
     LEFT JOIN process_master pm ON pm.id = e.process_id
     LEFT JOIN designation_master dsm ON dsm.id = e.designation_id
     LEFT JOIN branch_master bm ON bm.id = e.branch_id
     WHERE e.id = ? LIMIT 1`,
    [employeeId]
  );
  if (!empRows.length) {
    return { eligible: false, reasons: ['Employee not found'], tenure_months: 0, employment_status: '' };
  }
  const emp = empRows[0];

  const reasons: string[] = [];
  const tenureMonths = calculateTenureMonths(emp.date_of_joining);
  const employmentStatus = String(emp.employment_status ?? 'Unknown');

  // Check posting is open
  if (posting.status !== 'open') {
    reasons.push(`This position is not currently open for applications (status: ${posting.status})`);
  }

  // Check deadline
  if (posting.closes_at && new Date(posting.closes_at) < new Date()) {
    reasons.push('Application deadline has passed');
  }

  // Tenure check
  if (tenureMonths < posting.min_tenure_months) {
    reasons.push(`Minimum ${posting.min_tenure_months} months tenure required (you have ${tenureMonths})`);
  }

  // Employment status
  const eligibleStatuses = posting.eligible_employment_status;
  if (!eligibleStatuses.includes(employmentStatus)) {
    reasons.push(`Your employment status (${employmentStatus}) is not eligible`);
  }

  // Process exclusion
  if (posting.excluded_process_ids?.includes(emp.process_id)) {
    reasons.push(`Your process (${emp.process_name ?? 'Unknown'}) is excluded from this posting`);
  }

  // Department filter
  if (posting.eligible_department_ids && !posting.eligible_department_ids.includes(emp.department_id)) {
    reasons.push(`Your department (${emp.dept_name ?? 'Unknown'}) is not eligible`);
  }

  // Process filter
  if (posting.eligible_process_ids && !posting.eligible_process_ids.includes(emp.process_id)) {
    reasons.push(`Your process (${emp.process_name ?? 'Unknown'}) is not eligible`);
  }

  // Designation filter
  if (posting.eligible_designation_ids && !posting.eligible_designation_ids.includes(emp.designation_id)) {
    reasons.push(`Your designation (${emp.designation_name ?? 'Unknown'}) is not eligible`);
  }

  // Branch filter
  if (posting.eligible_branch_ids && !posting.eligible_branch_ids.includes(emp.branch_id)) {
    reasons.push(`Your branch (${emp.branch_name ?? 'Unknown'}) is not eligible`);
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    tenure_months: tenureMonths,
    employment_status: employmentStatus,
  };
}

export async function listEligiblePostings(employeeId: string): Promise<{
  postings: Array<IjpPostingWithDetails & { eligibility: EligibilityCheckResult }>;
}> {
  // Deliberately NOT routed through the now-scoped listPostings() above: this is the
  // "jobs I can apply to" browse view, not the HR/manager administration view — every
  // employee company-wide is meant to see every open posting here, with eligibility (tenure,
  // branch, process, employment status) computed per-posting by checkEligibility() below.
  // Scoping this by the CALLER's own branch/process assignment (as listPostings now does for
  // branch_head/process_manager/operations_manager) would be wrong here: an ordinary employee
  // has no user_assignment_scope row at all, so that scoping would resolve to 1=0 and hide
  // every posting from every regular applicant.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT p.*,
            dm.dept_name AS department_name,
            pm.process_name AS process_name,
            dsm.designation_name AS designation_name,
            bm.branch_name AS branch_name,
            CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS posted_by_name,
            (SELECT COUNT(*) FROM ijp_application a WHERE a.posting_id = p.id) AS application_count
     FROM ijp_posting p
     LEFT JOIN department_master dm ON dm.id = p.department_id
     LEFT JOIN process_master pm ON pm.id = p.process_id
     LEFT JOIN designation_master dsm ON dsm.id = p.designation_id
     LEFT JOIN branch_master bm ON bm.id = p.branch_id
     LEFT JOIN employees e ON e.id = p.posted_by
     WHERE p.status = 'open'
     ORDER BY p.created_at DESC
     ${sqlLimitOffset(100, 0)}`
  );
  const postings = rows.map((row) => ({
    ...row,
    eligible_employment_status: parseJson(row.eligible_employment_status, ['Active']),
    eligible_department_ids: parseJson(row.eligible_department_ids, null),
    eligible_process_ids: parseJson(row.eligible_process_ids, null),
    excluded_process_ids: parseJson(row.excluded_process_ids, null),
    eligible_designation_ids: parseJson(row.eligible_designation_ids, null),
    eligible_branch_ids: parseJson(row.eligible_branch_ids, null),
    require_manager_approval: Boolean(row.require_manager_approval),
    application_count: Number(row.application_count ?? 0),
  })) as IjpPostingWithDetails[];

  // Check eligibility for each
  const results: Array<IjpPostingWithDetails & { eligibility: EligibilityCheckResult }> = [];
  for (const posting of postings) {
    const eligibility = await checkEligibility(employeeId, posting.id);
    results.push({ ...posting, eligibility });
  }

  // Sort: eligible first, then by posted_at desc
  results.sort((a, b) => {
    if (a.eligibility.eligible && !b.eligibility.eligible) return -1;
    if (!a.eligibility.eligible && b.eligibility.eligible) return 1;
    return new Date(b.posted_at ?? b.created_at).getTime() - new Date(a.posted_at ?? a.created_at).getTime();
  });

  return { postings: results };
}

// ─── Applications ───────────────────────────────────────────────────────────

export async function applyToPosting(
  postingId: string,
  employeeId: string,
  input: ApplyInput,
  opts: { ipAddress?: string; userAgent?: string } = {}
): Promise<{ application: IjpApplication; eligibility: EligibilityCheckResult }> {
  // Check eligibility first
  const eligibility = await checkEligibility(employeeId, postingId);
  if (!eligibility.eligible) {
    throw Object.assign(new Error('You are not eligible for this position'), {
      code: 'NOT_ELIGIBLE',
      reasons: eligibility.reasons,
    });
  }

  // Check for existing application
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id, status FROM ijp_application WHERE posting_id = ? AND employee_id = ? LIMIT 1`,
    [postingId, employeeId]
  );
  if (existing.length) {
    throw Object.assign(new Error('You have already applied to this position'), {
      code: 'ALREADY_APPLIED',
      applicationId: existing[0].id,
      status: existing[0].status,
    });
  }

  const posting = await getPostingById(postingId);
  if (!posting) throw new Error('Posting not found');

  // Get employee current position
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT department_id, process_id, designation_id, branch_id, reporting_manager_id
     FROM employees WHERE id = ? LIMIT 1`,
    [employeeId]
  );
  const emp = empRows[0];

  const id = randomUUID();
  const initialStatus: IjpApplicationStatus = posting.require_manager_approval ? 'pending_manager' : 'submitted';

  await db.execute(
    `INSERT INTO ijp_application
     (id, posting_id, employee_id, application_note,
      current_department_id, current_process_id, current_designation_id, current_branch_id,
      tenure_months, status, manager_id, applied_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      id,
      postingId,
      employeeId,
      input.application_note ?? null,
      emp?.department_id ?? null,
      emp?.process_id ?? null,
      emp?.designation_id ?? null,
      emp?.branch_id ?? null,
      eligibility.tenure_months,
      initialStatus,
      posting.require_manager_approval ? (emp?.reporting_manager_id ?? null) : null,
    ]
  );

  await auditLog('application_submitted', employeeId, {
    postingId,
    applicationId: id,
    newValue: { status: initialStatus, application_note: input.application_note },
    ipAddress: opts.ipAddress,
    userAgent: opts.userAgent,
  });

  const application = await getApplicationById(id);
  return { application: application!, eligibility };
}

export async function getApplicationById(id: string): Promise<IjpApplication | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM ijp_application WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!rows.length) return null;
  return {
    ...rows[0],
    offer_details: parseJson(rows[0].offer_details, null),
  } as IjpApplication;
}

export async function listApplicationsForPosting(
  actor: EnterpriseUser,
  postingId: string,
  filters: { status?: string; limit?: number; offset?: number } = {}
): Promise<{ applications: IjpApplicationWithDetails[]; total: number }> {
  // Same row-scope gap as listPostings above: requireRole only gated who could reach this
  // endpoint, not which applicants they could see — any branch_head/process_manager/
  // operations_manager handed (or guessing) a posting UUID could pull every applicant's
  // name/email/mobile/employee_code company-wide. Scoped against the posting's own
  // branch_id/process_id, the same columns listPostings scopes on.
  const scope = await resolveUserBusinessScope(actor);
  const scopeCond = buildProcessScopeCondition(scope, {
    processId: 'p.process_id',
    branchId: 'p.branch_id',
    departmentId: 'p.department_id',
  });

  const conditions: string[] = ['a.posting_id = ?', `(${scopeCond.sql})`];
  const params: unknown[] = [postingId, ...scopeCond.params];

  if (filters.status) {
    conditions.push('a.status = ?');
    params.push(filters.status);
  }

  const where = conditions.join(' AND ');
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  // JOINs ijp_posting here too (the count previously didn't need to) because the scope
  // condition above reads p.branch_id/p.process_id.
  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM ijp_application a JOIN ijp_posting p ON p.id = a.posting_id WHERE ${where}`,
    params
  );
  const total = Number(countRows[0]?.total ?? 0);

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT a.*,
            e.employee_code, CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
            e.email AS employee_email, e.mobile AS employee_mobile,
            dm.dept_name AS current_department_name,
            pm.process_name AS current_process_name,
            dsm.designation_name AS current_designation_name,
            bm.branch_name AS current_branch_name,
            CONCAT(mgr.first_name, ' ', COALESCE(mgr.last_name, '')) AS manager_name,
            CONCAT(rev.first_name, ' ', COALESCE(rev.last_name, '')) AS reviewer_name,
            p.posting_code, p.job_title
     FROM ijp_application a
     JOIN employees e ON e.id = a.employee_id
     LEFT JOIN department_master dm ON dm.id = a.current_department_id
     LEFT JOIN process_master pm ON pm.id = a.current_process_id
     LEFT JOIN designation_master dsm ON dsm.id = a.current_designation_id
     LEFT JOIN branch_master bm ON bm.id = a.current_branch_id
     LEFT JOIN employees mgr ON mgr.id = a.manager_id
     LEFT JOIN employees rev ON rev.id = a.reviewed_by
     JOIN ijp_posting p ON p.id = a.posting_id
     WHERE ${where}
     ORDER BY a.applied_at DESC
     ${sqlLimitOffset(limit, offset)}`,
    params
  );

  return {
    applications: rows.map((row) => ({
      ...row,
      offer_details: parseJson(row.offer_details, null),
    })) as IjpApplicationWithDetails[],
    total,
  };
}

export async function listMyApplications(
  employeeId: string,
  filters: { limit?: number; offset?: number } = {}
): Promise<{ applications: IjpApplicationWithDetails[]; total: number }> {
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM ijp_application WHERE employee_id = ?`,
    [employeeId]
  );
  const total = Number(countRows[0]?.total ?? 0);

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT a.*,
            e.employee_code, CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
            e.email AS employee_email, e.mobile AS employee_mobile,
            dm.dept_name AS current_department_name,
            pm.process_name AS current_process_name,
            dsm.designation_name AS current_designation_name,
            bm.branch_name AS current_branch_name,
            CONCAT(mgr.first_name, ' ', COALESCE(mgr.last_name, '')) AS manager_name,
            CONCAT(rev.first_name, ' ', COALESCE(rev.last_name, '')) AS reviewer_name,
            p.posting_code, p.job_title
     FROM ijp_application a
     JOIN employees e ON e.id = a.employee_id
     LEFT JOIN department_master dm ON dm.id = a.current_department_id
     LEFT JOIN process_master pm ON pm.id = a.current_process_id
     LEFT JOIN designation_master dsm ON dsm.id = a.current_designation_id
     LEFT JOIN branch_master bm ON bm.id = a.current_branch_id
     LEFT JOIN employees mgr ON mgr.id = a.manager_id
     LEFT JOIN employees rev ON rev.id = a.reviewed_by
     JOIN ijp_posting p ON p.id = a.posting_id
     WHERE a.employee_id = ?
     ORDER BY a.applied_at DESC
     ${sqlLimitOffset(limit, offset)}`,
    [employeeId]
  );

  return {
    applications: rows.map((row) => ({
      ...row,
      offer_details: parseJson(row.offer_details, null),
    })) as IjpApplicationWithDetails[],
    total,
  };
}

export async function updateApplicationStatus(
  applicationId: string,
  input: UpdateApplicationStatusInput,
  updatedBy: string,
  opts: { ipAddress?: string; userAgent?: string; isManager?: boolean } = {}
): Promise<IjpApplication | null> {
  const existing = await getApplicationById(applicationId);
  if (!existing) return null;

  const updates: string[] = ['status = ?', 'updated_at = NOW()'];
  const params: unknown[] = [input.status];

  // Handle manager approval flow
  if (opts.isManager && ['manager_approved', 'manager_rejected'].includes(input.status)) {
    updates.push('manager_action_at = NOW()');
    if (input.remarks) {
      updates.push('manager_remarks = ?');
      params.push(input.remarks);
    }
    // Auto-advance to under_review if approved
    if (input.status === 'manager_approved') {
      updates[0] = 'status = ?';
      params[0] = 'under_review';
    }
  } else {
    // HR review flow
    if (['under_review', 'shortlisted', 'rejected'].includes(input.status)) {
      updates.push('reviewed_by = ?', 'reviewed_at = NOW()');
      params.push(updatedBy);
      if (input.remarks) {
        updates.push('review_remarks = ?');
        params.push(input.remarks);
      }
    }
    if (input.status === 'interview_scheduled' && input.interview_scheduled_at) {
      updates.push('interview_scheduled_at = ?');
      params.push(input.interview_scheduled_at);
      if (input.remarks) {
        updates.push('interview_remarks = ?');
        params.push(input.remarks);
      }
    }
    if (input.status === 'selected') {
      updates.push('selected_at = NOW()');
      if (input.remarks) {
        updates.push('selection_remarks = ?');
        params.push(input.remarks);
      }
      if (input.offer_details) {
        updates.push('offer_details = ?');
        params.push(JSON.stringify(input.offer_details));
      }
    }
  }

  params.push(applicationId);
  await db.execute(
    `UPDATE ijp_application SET ${updates.join(', ')} WHERE id = ?`,
    params
  );

  await auditLog('application_status_changed', updatedBy, {
    postingId: existing.posting_id,
    applicationId,
    oldValue: { status: existing.status },
    newValue: { status: input.status, remarks: input.remarks },
    ipAddress: opts.ipAddress,
    userAgent: opts.userAgent,
  });

  return getApplicationById(applicationId);
}

export async function withdrawApplication(
  applicationId: string,
  employeeId: string,
  opts: { ipAddress?: string; userAgent?: string } = {}
): Promise<IjpApplication | null> {
  const existing = await getApplicationById(applicationId);
  if (!existing) return null;
  if (existing.employee_id !== employeeId) {
    throw Object.assign(new Error('Cannot withdraw another employee\'s application'), {
      code: 'FORBIDDEN',
    });
  }
  if (['selected', 'offer_accepted', 'withdrawn'].includes(existing.status)) {
    throw Object.assign(new Error('Cannot withdraw application in current status'), {
      code: 'INVALID_STATUS',
      status: existing.status,
    });
  }

  return updateApplicationStatus(applicationId, { status: 'withdrawn' }, employeeId, opts);
}

// ─── Dashboard Stats ────────────────────────────────────────────────────────

export async function getIjpStats(): Promise<{
  total_postings: number;
  open_postings: number;
  total_applications: number;
  pending_review: number;
  selected_this_month: number;
}> {
  const [rows] = await db.execute<RowDataPacket[]>(`
    SELECT
      (SELECT COUNT(*) FROM ijp_posting) AS total_postings,
      (SELECT COUNT(*) FROM ijp_posting WHERE status = 'open') AS open_postings,
      (SELECT COUNT(*) FROM ijp_application) AS total_applications,
      (SELECT COUNT(*) FROM ijp_application WHERE status IN ('submitted', 'pending_manager', 'under_review')) AS pending_review,
      (SELECT COUNT(*) FROM ijp_application WHERE status = 'selected' AND selected_at >= DATE_FORMAT(NOW(), '%Y-%m-01')) AS selected_this_month
  `);
  return rows[0] as {
    total_postings: number;
    open_postings: number;
    total_applications: number;
    pending_review: number;
    selected_this_month: number;
  };
}
