/**
 * HTTP surface for the joining kit.
 *
 * Two routers, deliberately separate:
 *
 *  - publicJoiningKitRouter  — unauthenticated, reached from the emailed link.
 *    Mounted BEFORE the global requireAuth, like the per-document equivalent.
 *  - joiningKitRouter        — authenticated, so HR can actually send a kit.
 *    Until this existed the dispatcher could only be driven by a script on the
 *    server, which meant the feature was untriggerable from the product.
 */
import { Router, type NextFunction, type Response } from "express";
import fs from "fs";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getPublicKitSession, getPublicKitFile, startKitEsign } from "./joiningKitPublic.service.js";
import { queueJoiningKit, dispatchJoiningKit } from "./joiningKitDispatch.service.js";
import { kitEligibleDocuments } from "./joiningKitAssembly.service.js";

type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

// ── public: the emailed link ────────────────────────────────────────────────
export const publicJoiningKitRouter = Router();

publicJoiningKitRouter.get("/esign/:token", h(async (req, res) => {
  const session = await getPublicKitSession(String(req.params.token));
  return res.json({
    success: true,
    data: {
      session,
      employee_message:
        "These are your joining documents, combined into one file. Please read them, then sign once — your signature is applied to every document.",
    },
  });
}));

publicJoiningKitRouter.get("/esign/:token/download", h(async (req, res) => {
  const file = await getPublicKitFile(String(req.params.token));
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${file.fileName.replace(/"/g, "")}"`);
  fs.createReadStream(file.storagePath).pipe(res);
}));

publicJoiningKitRouter.post("/esign/:token/start", h(async (req, res) => {
  const out = await startKitEsign({
    token: String(req.params.token),
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? null,
  });
  return res.json({ success: true, data: out });
}));

// ── authenticated: HR sends and monitors kits ───────────────────────────────
export const joiningKitRouter = Router();
// payroll_hr has no role alias, so it is named explicitly — requireRole("payroll")
// does not admit a payroll_hr user.
const KIT_ROLES = ["super_admin", "admin", "hr", "hr_manager", "payroll_hr"] as const;
joiningKitRouter.use(requireAuth, requireRole(...KIT_ROLES));

/** What would go into this employee's kit, and is anything in the way. */
joiningKitRouter.get("/:employeeId/joining-kit/preview", h(async (req, res) => {
  const employeeId = String(req.params.employeeId);
  const docs = await kitEligibleDocuments(employeeId);
  const [pending] = await db.execute<RowDataPacket[]>(
    `SELECT document_name FROM employee_joining_document_checklist
      WHERE employee_id = ? AND action_type = 'esign' AND fill_status = 'hr_fill_required'`,
    [employeeId],
  );
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id, status, blocked_reason, document_count, total_pages, sent_at, completed_at
       FROM employee_joining_esign_kit
      WHERE employee_id = ? ORDER BY created_at DESC LIMIT 5`,
    [employeeId],
  );
  return res.json({
    success: true,
    data: {
      documents: docs.map((d) => ({
        code: String(d.document_code),
        name: String(d.document_name ?? d.document_code),
        status: String(d.status ?? ""),
        fillStatus: d.fill_status ? String(d.fill_status) : null,
      })),
      hrFillPending: pending.map((p) => String(p.document_name)),
      kits: existing,
    },
  });
}));

/** Queue + dispatch in one call — HR thinks in terms of "send", not two steps. */
joiningKitRouter.post("/:employeeId/joining-kit/send", h(async (req: AuthenticatedRequest, res) => {
  const employeeId = String(req.params.employeeId);
  const queued = await queueJoiningKit({
    employeeId,
    triggerSource: "hr_manual",
    actorUserId: req.authUser?.id ?? null,
  });
  const outcome = await dispatchJoiningKit(queued.kitId, req.authUser?.id ?? null);
  // A blocked kit is a normal, expected answer — not a server fault. 409 so the
  // UI can show the reason without treating it as an error state.
  const code = outcome.status === "sent" ? 200 : outcome.status === "failed" ? 502 : 409;
  return res.status(code).json({
    success: outcome.status === "sent",
    message: outcome.message,
    data: outcome,
  });
}));

/** Current kit state for a listing screen. */
joiningKitRouter.get("/:employeeId/joining-kit", h(async (req, res) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT k.id, k.status, k.blocked_reason, k.document_count, k.total_pages,
            k.sent_at, k.completed_at, k.created_at,
            (SELECT COUNT(*) FROM employee_joining_esign_kit_item i WHERE i.kit_id = k.id) AS items
       FROM employee_joining_esign_kit k
      WHERE k.employee_id = ? ORDER BY k.created_at DESC`,
    [String(req.params.employeeId)],
  );
  return res.json({ success: true, data: rows });
}));
