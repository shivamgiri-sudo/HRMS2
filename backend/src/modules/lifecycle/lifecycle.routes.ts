import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { selfOrAdminHr } from "../../shared/accessGuard.js";
import { lifecycleService } from "./lifecycle.service.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// GET /probation-due — employees due for confirmation
router.get("/probation-due", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const days = req.query.days ? parseInt(req.query.days as string, 10) : 90;
  const data = await lifecycleService.getProbationDue(days);
  res.json({ success: true, data, total: data.length });
}));

// POST /employees/:id/confirm — confirm an employee
router.post("/employees/:id/confirm", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  await lifecycleService.confirmEmployee(req.params.id, req.authUser!.id, req.body.remarks, req);
  res.json({ success: true });
}));

// Admin/HR see any employee; employee sees own
router.get("/employees/:id/lifecycle", selfOrAdminHr("id"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await lifecycleService.listEvents(req.params.id) });
}));

router.post("/employees/:id/lifecycle", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const event = await lifecycleService.createEvent(
    { ...req.body, employee_id: req.params.id, initiated_by: req.authUser!.id },
    req
  );
  res.status(201).json({ data: event });
}));

// Admin/HR see any employee's documents; employee sees own
router.get("/employees/:id/documents", selfOrAdminHr("id"), h(async (req: AuthenticatedRequest, res: Response) => {
  await lifecycleService.logDocumentAccess(`list:${req.params.id}`, req.authUser!.id, "view", req.ip);
  res.json({ data: await lifecycleService.listDocuments(req.params.id) });
}));

router.post("/documents/:id/verify", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  await lifecycleService.verifyDocument(req.params.id, req.authUser!.id, req.body.remarks, req);
  res.json({ ok: true });
}));

router.get("/documents/expiring", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;
  res.json({ data: await lifecycleService.getExpiredOrExpiringDocuments(days) });
}));

router.get("/documents/unverified", requireRole("admin", "hr"), h(async (_req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ed.id,
            ed.employee_id,
            ed.doc_type AS document_type,
            ed.doc_name AS document_name,
            ed.doc_category,
            ed.file_url,
            ed.verified,
            ed.created_at,
            e.first_name,
            e.last_name,
            e.employee_code
       FROM employee_documents ed
       LEFT JOIN employees e ON e.id = ed.employee_id
      WHERE ed.verified = 0
      ORDER BY ed.created_at DESC
      LIMIT 200`
  );
  res.json({ data: rows });
}));

router.get("/documents/:id/access-log", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT dal.*,
            dal.access_type AS action_type,
            e.first_name,
            e.last_name
       FROM employee_document_access_log dal
       LEFT JOIN employees e ON e.user_id = dal.accessed_by
      WHERE dal.document_id = ?
      ORDER BY dal.accessed_at DESC
      LIMIT 100`,
    [req.params.id]
  );
  res.json({ data: rows });
}));

export { router as lifecycleRouter };
