import { Router, type Response, type NextFunction } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  createExitPass,
  submitExitPass,
  cancelExitPass,
  branchHeadDecision,
  adminDecision,
  getExitPass,
  listExitPasses,
  listPendingBranchHead,
  listPendingAdmin,
  findPassForVerification,
  findPassForVerificationByQrToken,
  verifyExit,
  verifyReturn,
  searchEmployeesForCarrier,
  resolveRequestingEmployee,
  getActorRoles,
  listBranchHeadAssignments,
  upsertBranchHeadAssignment,
  deactivateBranchHeadAssignment,
  ExitPassError,
  type CreateExitPassInput,
} from './exit-pass.service.js';

export const exitPassRouter = Router();

type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

function fail(res: Response, error: unknown): Response {
  if (error instanceof ExitPassError) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }
  // eslint-disable-next-line no-console
  console.error('[exit-pass]', error);
  return res.status(500).json({ success: false, message: 'Unexpected error' });
}

// Phase 1: raise -> Branch Head approve -> Admin approve -> print.
// Phase 2: security exit verification (verify/lookup below).
// Roles here are a superset of ASSET_EXIT_PASS's role_page_access grants
// (migration 1538) plus the security roles Visitor Management already uses
// (no dedicated 'security' role_key exists live) — a role missing from either
// list opens a page/link that 403s on every call, the exact bug
// branch-head-approval.routes.ts calls out.
exitPassRouter.use(requireAuth);
exitPassRouter.use(
  requireRole('super_admin', 'admin', 'it_head', 'it', 'branch_admin', 'branch_head', 'employee', 'security_head', 'visitor_security', 'wfm'),
);

exitPassRouter.post('/', h(async (req, res) => {
  try {
    const requester = await resolveRequestingEmployee(req.authUser!.id);
    const input = req.body as CreateExitPassInput;
    const result = await createExitPass(input, requester);
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    return fail(res, error);
  }
}));

exitPassRouter.get('/', h(async (req, res) => {
  try {
    const requester = await resolveRequestingEmployee(req.authUser!.id);
    const roles = await getActorRoles(req.authUser!.id);
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const offset = Number(req.query.offset ?? 0) || 0;
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const data = await listExitPasses(requester, roles, { status, limit, offset });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error);
  }
}));

exitPassRouter.get('/pending/branch-head', h(async (req, res) => {
  try {
    const requester = await resolveRequestingEmployee(req.authUser!.id);
    const roles = await getActorRoles(req.authUser!.id);
    const data = await listPendingBranchHead(requester, roles);
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error);
  }
}));

exitPassRouter.get('/pending/admin', h(async (req, res) => {
  try {
    const requester = await resolveRequestingEmployee(req.authUser!.id);
    const roles = await getActorRoles(req.authUser!.id);
    const data = await listPendingAdmin(requester, roles);
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error);
  }
}));

// ─── Branch Head Assignment admin (Super Admin / Admin / IT Head only) ─────────
// Registered before /:id so Express doesn't swallow '/admin/branch-head-assignments'.
exitPassRouter.get('/admin/branch-head-assignments', h(async (req, res) => {
  try {
    const roles = await getActorRoles(req.authUser!.id);
    if (!roles.some((r) => ['super_admin', 'admin', 'it_head'].includes(r))) {
      return res.status(403).json({ success: false, message: 'Super Admin or Admin required.' });
    }
    const data = await listBranchHeadAssignments();
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error);
  }
}));

exitPassRouter.post('/admin/branch-head-assignments', h(async (req, res) => {
  try {
    const roles = await getActorRoles(req.authUser!.id);
    if (!roles.some((r) => ['super_admin', 'admin'].includes(r))) {
      return res.status(403).json({ success: false, message: 'Super Admin or Admin required.' });
    }
    const requester = await resolveRequestingEmployee(req.authUser!.id);
    const { branch_name, branch_head_id } = req.body as { branch_name: string; branch_head_id: string };
    if (!branch_name?.trim() || !branch_head_id?.trim()) {
      return res.status(400).json({ success: false, message: 'branch_name and branch_head_id are required.' });
    }
    const result = await upsertBranchHeadAssignment(branch_name.trim(), branch_head_id.trim(), requester.employeeId);
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    return fail(res, error);
  }
}));

exitPassRouter.patch('/admin/branch-head-assignments/:id/deactivate', h(async (req, res) => {
  try {
    const roles = await getActorRoles(req.authUser!.id);
    if (!roles.some((r) => ['super_admin', 'admin'].includes(r))) {
      return res.status(403).json({ success: false, message: 'Super Admin or Admin required.' });
    }
    await deactivateBranchHeadAssignment(req.params.id);
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error);
  }
}));

// Phase 2 — security exit verification. Registered before the generic
// GET '/:id' below: Express matches routes in order, and '/:id' would
// otherwise swallow '/verify/GP-...' with id literally equal to "verify".
exitPassRouter.get('/employees/search', h(async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    if (q.trim().length < 2) {
      return res.json({ success: true, data: [] });
    }
    const data = await searchEmployeesForCarrier(q);
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error);
  }
}));

// Phase 4 — QR token lookup. MUST stay above '/verify/:passNumber': that
// pattern is two segments and this is three, so Express does not actually
// confuse them today, but '/verify/token/exit' would match
// '/verify/:passNumber/exit' with passNumber="token" if this were ever
// shortened. Ordering it first makes that impossible to reintroduce.
//
// Still fully authenticated and role-gated by the router-level requireAuth /
// requireRole above — the token identifies WHICH pass, it never authorises.
exitPassRouter.get('/verify/token/:token', h(async (req, res) => {
  try {
    const data = await findPassForVerificationByQrToken(req.params.token);
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error);
  }
}));

exitPassRouter.get('/verify/:passNumber', h(async (req, res) => {
  try {
    const data = await findPassForVerification(req.params.passNumber);
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error);
  }
}));

exitPassRouter.post('/verify/:passNumber/exit', h(async (req, res) => {
  try {
    const requester = await resolveRequestingEmployee(req.authUser!.id);
    const roles = await getActorRoles(req.authUser!.id);
    const { gate, method, remarks, qr_token } = req.body as {
      gate: string; method: 'qr' | 'manual'; remarks?: string; qr_token?: string;
    };
    if (!['qr', 'manual'].includes(method)) {
      return res.status(400).json({ success: false, message: 'method must be qr or manual' });
    }
    // qr_token is validated against this pass's stored hash in verifyExit —
    // method:'qr' without a matching token is rejected there, not downgraded.
    await verifyExit(req.params.passNumber, requester, roles, {
      gate, method, remarks: remarks ?? null, qr_token: qr_token ?? null,
    });
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error);
  }
}));

exitPassRouter.post('/verify/:passNumber/return', h(async (req, res) => {
  try {
    const requester = await resolveRequestingEmployee(req.authUser!.id);
    const roles = await getActorRoles(req.authUser!.id);
    const { items, remarks } = req.body as {
      items: Array<{ id: string; condition_in: string; has_damage: boolean; missing: boolean }>;
      remarks?: string;
    };
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'items is required' });
    }
    await verifyReturn(req.params.passNumber, requester, roles, { items, remarks: remarks ?? null });
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error);
  }
}));

exitPassRouter.get('/:id', h(async (req, res) => {
  try {
    const requester = await resolveRequestingEmployee(req.authUser!.id);
    const roles = await getActorRoles(req.authUser!.id);
    const data = await getExitPass(req.params.id, requester, roles);
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error);
  }
}));

exitPassRouter.patch('/:id/cancel', h(async (req, res) => {
  try {
    const requester = await resolveRequestingEmployee(req.authUser!.id);
    await cancelExitPass(req.params.id, requester);
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error);
  }
}));

exitPassRouter.post('/:id/submit', h(async (req, res) => {
  try {
    const requester = await resolveRequestingEmployee(req.authUser!.id);
    await submitExitPass(req.params.id, requester);
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error);
  }
}));

exitPassRouter.post('/:id/branch-head/decision', h(async (req, res) => {
  try {
    const requester = await resolveRequestingEmployee(req.authUser!.id);
    const roles = await getActorRoles(req.authUser!.id);
    const { decision, remarks } = req.body as { decision: 'approved' | 'rejected' | 'returned'; remarks?: string };
    if (!['approved', 'rejected', 'returned'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'decision must be approved, rejected, or returned' });
    }
    await branchHeadDecision(req.params.id, requester, roles, decision, remarks ?? null);
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error);
  }
}));

exitPassRouter.post('/:id/admin/decision', h(async (req, res) => {
  try {
    const requester = await resolveRequestingEmployee(req.authUser!.id);
    const roles = await getActorRoles(req.authUser!.id);
    const { decision, remarks } = req.body as { decision: 'approved' | 'rejected'; remarks?: string };
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'decision must be approved or rejected' });
    }
    const result = await adminDecision(req.params.id, requester, roles, decision, remarks ?? null);
    return res.json({ success: true, data: result });
  } catch (error) {
    return fail(res, error);
  }
}));
