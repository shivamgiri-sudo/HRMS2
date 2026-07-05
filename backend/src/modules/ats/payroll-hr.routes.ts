import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireWriteAccess, type AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  getPendingCandidates,
  getCandidateForValidation,
  validateAndAssignSalary,
  getValidationRecord,
  notifyBranchHeadForApproval,
  calculateSalaryBreakdown,
  type SalaryValidationInput,
} from './payroll-hr.service.js';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2/promise';

export const payrollHRRouter = Router();

type AsyncHandler = (req: AuthenticatedRequest | Request, res: Response) => Promise<unknown>;

const h = (fn: AsyncHandler) => (req: AuthenticatedRequest | Request, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}

async function resolveEmployeeIdForAuthUser(authUserId: string): Promise<string> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1`,
    [authUserId],
  );
  return rows[0]?.id ? String(rows[0].id) : authUserId;
}

const optionalUuid = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z.string().uuid().optional(),
);

const optionalDate = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'salary_start_date must be YYYY-MM-DD').optional(),
);

const optionalPositiveNumber = z.preprocess(
  (value) => {
    if (value === '' || value === null || value === undefined) return undefined;
    const n = Number(value);
    return n > 0 ? n : undefined;
  },
  z.number().positive().optional(),
);

// All routes require authentication and Payroll HR/HR/Admin role
payrollHRRouter.use(requireAuth);
payrollHRRouter.use(requireRole('admin', 'hr', 'payroll_hr'));

// ── 1. Get pending candidates (BGV verified, onboarding submitted) ────────────
payrollHRRouter.get('/pending-candidates', h(async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const candidates = await getPendingCandidates();
    return res.json({ success: true, data: candidates });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));

payrollHRRouter.get('/validated-candidates', h(async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const candidates = await getPendingCandidates();
    return res.json({ success: true, data: candidates });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));

payrollHRRouter.get('/salary-slabs', h(async (_req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, slab_code, label, range_from, range_to, active_status
       FROM salary_slab_master
      WHERE active_status = 1
      ORDER BY seq_order ASC, range_from ASC`,
  );
  return res.json({ success: true, data: rows });
}));

// ── 2. Get candidate details for validation ───────────────────────────────────
payrollHRRouter.get('/candidate/:candidateId', h(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { candidateId } = req.params;
    const candidate = await getCandidateForValidation(candidateId);
    return res.json({ success: true, data: candidate });
  } catch (error: unknown) {
    return res.status(404).json({ success: false, message: getErrorMessage(error) });
  }
}));

// ── 3. Validate and assign salary (with joining_date and salary_start_date) ───
const salaryValidationSchema = z.object({
  candidate_id: z.string().uuid(),
  employment_type: z.enum(['onroll', 'offrole']),
  company_id: z.string().uuid(),
  designation_id: z.string().uuid(),
  department_id: z.string().uuid(),
  process_id: z.string().uuid(),
  cost_centre_id: z.string().uuid(),
  reporting_manager_id: z.string().uuid(),
  salary_slab_id: z.string().uuid(),
  gross_salary: optionalPositiveNumber,
  requested_gross_salary: optionalPositiveNumber,
  salary_exception_reason: z.string().optional(),
  salary_components: z.any().optional(),
  joining_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'joining_date must be YYYY-MM-DD'),
  salary_start_date: optionalDate,
  shift_id: optionalUuid,
  remarks: z.string().optional(),
});

payrollHRRouter.post('/validate', requireWriteAccess, h(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const input = salaryValidationSchema.parse(req.body) as SalaryValidationInput;
    const payrollHrId = await resolveEmployeeIdForAuthUser(req.authUser!.id);

    const result = await validateAndAssignSalary({
      ...input,
      payroll_hr_id: payrollHrId,
    });

    return res.json(result);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: error.errors,
      });
    }
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));

payrollHRRouter.post('/validate-slab', h(async (req: Request, res: Response) => {
  const { salary_slab_id, employment_type = 'onroll' } = req.body;
  const employmentType = employment_type === 'offrole' ? 'offrole' : 'onroll';
  if (!salary_slab_id) return res.status(400).json({ success: false, message: 'salary_slab_id required' });
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, slab_code, label, range_from, range_to, active_status
       FROM salary_slab_master
      WHERE id = ? AND active_status = 1 LIMIT 1`,
    [salary_slab_id],
  );
  const slab = rows[0];
  if (!slab) return res.status(404).json({ success: false, message: 'salary slab not found' });
  return res.json({ success: true, data: { slab, breakdown: calculateSalaryBreakdown(Number(slab.range_to), employmentType) } });
}));

payrollHRRouter.post('/salary-proposal', h(async (req: AuthenticatedRequest, res: Response) => {
  const { candidate_id, salary_slab_id, proposed_gross_salary, proposal_reason } = req.body;
  if (!candidate_id || !salary_slab_id || !proposed_gross_salary || !String(proposal_reason ?? '').trim()) {
    return res.status(400).json({ success: false, message: 'candidate_id, salary_slab_id, proposed_gross_salary, and proposal_reason are required' });
  }
  await db.execute(
    `INSERT INTO salary_exception_proposal
       (id, candidate_id, salary_slab_id, proposed_gross_salary, proposal_reason, proposed_by, status)
     VALUES (UUID(), ?, ?, ?, ?, ?, 'pending')
     ON DUPLICATE KEY UPDATE
       salary_slab_id = VALUES(salary_slab_id),
       proposed_gross_salary = VALUES(proposed_gross_salary),
       proposal_reason = VALUES(proposal_reason),
       proposed_by = VALUES(proposed_by),
       status = 'pending',
       updated_at = NOW()`,
    [candidate_id, salary_slab_id, proposed_gross_salary, proposal_reason, req.authUser!.id],
  );
  return res.status(201).json({ success: true });
}));

payrollHRRouter.post('/submit-offer', h(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const input = salaryValidationSchema.parse(req.body) as SalaryValidationInput;
    const payrollHrId = await resolveEmployeeIdForAuthUser(req.authUser!.id);
    const result = await validateAndAssignSalary({ ...input, payroll_hr_id: payrollHrId });
    return res.json(result);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: 'Validation failed', errors: error.errors });
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));

// ── 4. Get validation record for a candidate ──────────────────────────────────
payrollHRRouter.get('/validation/:candidateId', h(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { candidateId } = req.params;
    const record = await getValidationRecord(candidateId);

    if (!record) {
      return res.status(404).json({
        success: false,
        message: 'Validation record not found',
      });
    }

    return res.json({ success: true, data: record });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));

// ── 5. Notify branch head for approval ────────────────────────────────────────
const notifyBranchHeadSchema = z.object({
  candidate_id: z.string().uuid(),
  branch_head_id: z.string().uuid(),
});

payrollHRRouter.post('/notify-branch-head', h(async (req: Request, res: Response) => {
  try {
    const { candidate_id, branch_head_id } = notifyBranchHeadSchema.parse(req.body);

    const result = await notifyBranchHeadForApproval(candidate_id, branch_head_id);

    return res.json(result);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: error.errors,
      });
    }
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));

// ── 6. Calculate salary breakdown (helper) ────────────────────────────────────
const salaryBreakdownSchema = z.object({
  gross_salary: z.number().positive(),
  employment_type: z.enum(['onroll', 'offrole']),
});

payrollHRRouter.post('/calculate-breakdown', h(async (req: Request, res: Response) => {
  try {
    const { gross_salary, employment_type } = salaryBreakdownSchema.parse(req.body);

    const breakdown = calculateSalaryBreakdown(gross_salary, employment_type);

    return res.json({ success: true, data: breakdown });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: error.errors,
      });
    }
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));
