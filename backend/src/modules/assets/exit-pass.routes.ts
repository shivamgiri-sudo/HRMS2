import { Router, type Response, type NextFunction } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  createExitPass,
  submitExitPass,
  branchHeadDecision,
  adminDecision,
  getExitPass,
  listExitPasses,
  listPendingBranchHead,
  listPendingAdmin,
  findPassForVerification,
  verifyExit,
  resolveRequestingEmployee,
  getActorRoles,
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
  requireRole('super_admin', 'admin', 'it_head', 'it', 'branch_admin', 'branch_head', 'employee', 'security_head', 'visitor_security'),
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

// Phase 2 — security exit verification. Registered before the generic
// GET '/:id' below: Express matches routes in order, and '/:id' would
// otherwise swallow '/verify/GP-...' with id literally equal to "verify".
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
    const { gate, method, remarks } = req.body as { gate: string; method: 'qr' | 'manual'; remarks?: string };
    if (!['qr', 'manual'].includes(method)) {
      return res.status(400).json({ success: false, message: 'method must be qr or manual' });
    }
    await verifyExit(req.params.passNumber, requester, roles, { gate, method, remarks: remarks ?? null });
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
