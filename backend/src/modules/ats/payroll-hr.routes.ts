import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/authMiddleware.js';
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

// All routes require authentication and Payroll HR/HR/Admin role
payrollHRRouter.use(requireAuth);
payrollHRRouter.use(requireRole('admin', 'hr', 'payroll_hr'));

// ── 1. Get pending candidates (BGV verified, onboarding submitted) ────────────
payrollHRRouter.get('/pending-candidates', async (_req, res) => {
  try {
    const candidates = await getPendingCandidates();
    return res.json({ success: true, data: candidates });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

payrollHRRouter.get('/validated-candidates', async (_req, res) => {
  try {
    const candidates = await getPendingCandidates();
    return res.json({ success: true, data: candidates });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

payrollHRRouter.get('/salary-slabs', async (_req, res) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, slab_code, label, range_from, range_to, active_status
       FROM salary_slab_master
      WHERE active_status = 1
      ORDER BY seq_order ASC, range_from ASC`,
  );
  return res.json({ success: true, data: rows });
});

// ── 2. Get candidate details for validation ───────────────────────────────────
payrollHRRouter.get('/candidate/:candidateId', async (req, res) => {
  try {
    const { candidateId } = req.params;
    const candidate = await getCandidateForValidation(candidateId);
    return res.json({ success: true, data: candidate });
  } catch (error: any) {
    return res.status(404).json({ success: false, message: error.message });
  }
});

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
  gross_salary: z.number().positive().optional(),
  requested_gross_salary: z.number().positive().optional(),
  salary_exception_reason: z.string().optional(),
  salary_components: z.any().optional(),
  joining_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'joining_date must be YYYY-MM-DD'),
  salary_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'salary_start_date must be YYYY-MM-DD').optional(),
  shift_id: z.string().uuid().optional(),
  remarks: z.string().optional(),
});

payrollHRRouter.post('/validate', async (req: any, res) => {
  try {
    const input = salaryValidationSchema.parse(req.body) as SalaryValidationInput;

    const result = await validateAndAssignSalary({
      ...input,
      payroll_hr_id: req.authUser.id,
    });

    return res.json(result);
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: error.errors,
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
});

payrollHRRouter.post('/validate-slab', async (req, res) => {
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
});

payrollHRRouter.post('/salary-proposal', async (req: any, res) => {
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
    [candidate_id, salary_slab_id, proposed_gross_salary, proposal_reason, req.authUser.id],
  );
  return res.status(201).json({ success: true });
});

payrollHRRouter.post('/submit-offer', async (req: any, res) => {
  try {
    const input = salaryValidationSchema.parse(req.body) as SalaryValidationInput;
    const result = await validateAndAssignSalary({ ...input, payroll_hr_id: req.authUser.id });
    return res.json(result);
  } catch (error: any) {
    if (error.name === 'ZodError') return res.status(400).json({ success: false, message: 'Validation failed', errors: error.errors });
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 4. Get validation record for a candidate ──────────────────────────────────
payrollHRRouter.get('/validation/:candidateId', async (req, res) => {
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
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 5. Notify branch head for approval ────────────────────────────────────────
const notifyBranchHeadSchema = z.object({
  candidate_id: z.string().uuid(),
  branch_head_id: z.string().uuid(),
});

payrollHRRouter.post('/notify-branch-head', async (req, res) => {
  try {
    const { candidate_id, branch_head_id } = notifyBranchHeadSchema.parse(req.body);

    const result = await notifyBranchHeadForApproval(candidate_id, branch_head_id);

    return res.json(result);
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: error.errors,
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 6. Calculate salary breakdown (helper) ────────────────────────────────────
const salaryBreakdownSchema = z.object({
  gross_salary: z.number().positive(),
  employment_type: z.enum(['onroll', 'offrole']),
});

payrollHRRouter.post('/calculate-breakdown', async (req, res) => {
  try {
    const { gross_salary, employment_type } = salaryBreakdownSchema.parse(req.body);

    const breakdown = calculateSalaryBreakdown(gross_salary, employment_type);

    return res.json({ success: true, data: breakdown });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: error.errors,
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
});
