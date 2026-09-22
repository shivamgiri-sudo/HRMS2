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
import { queueJoiningKit, dispatchJoiningKit, resendKitEsignLink, redispatchDeadKit, kitEsignSessionIsAlive } from "./joiningKitDispatch.service.js";
import { syncKitEsignStatus } from "./joiningKitSync.service.js";
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

/** Queue + dispatch in one call — HR thinks in terms of "send", not two steps.
 *
 * Respond immediately after queueing so the HTTP handler never holds a DB
 * connection open while waiting on the external eSign provider. The provider
 * call runs in the background; the UI polls GET /:employeeId/joining-kit for
 * the resulting status (sent / failed / blocked).
 */
joiningKitRouter.post("/:employeeId/joining-kit/send", h(async (req: AuthenticatedRequest, res) => {
  const employeeId = String(req.params.employeeId);
  const actorUserId = req.authUser?.id ?? null;

  const queued = await queueJoiningKit({
    employeeId,
    triggerSource: "hr_manual",
    actorUserId,
  });

  // If the kit is already signed/sent, surface that immediately — no need to
  // re-dispatch.
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT status FROM employee_joining_esign_kit WHERE id = ? LIMIT 1`,
    [queued.kitId],
  );
  const currentStatus = String((existing as RowDataPacket[])[0]?.status ?? "queued");
  if (currentStatus === "sent" || currentStatus === "signed") {
    return res.status(409).json({
      success: false,
      message: `This kit is already ${currentStatus}.`,
      data: { kitId: queued.kitId, status: currentStatus },
    });
  }

  // Respond before touching the provider — the provider call cannot stall the
  // connection pool from this point on.
  res.json({
    success: true,
    message: "Kit is being assembled and sent. Check status via GET joining-kit.",
    data: { kitId: queued.kitId, status: "queued" },
  });

  // Fire-and-forget. Errors are logged; kit status moves to "failed" inside
  // dispatchJoiningKit on any unhandled throw.
  dispatchJoiningKit(queued.kitId, actorUserId).catch((err: unknown) => {
    console.error(
      "[joining-kit] background dispatch error:",
      err instanceof Error ? err.message : err,
    );
  });
}));

/** Re-send the signing email for an already-sent kit without touching the provider. */
joiningKitRouter.post("/:employeeId/joining-kit/:kitId/resend", h(async (req: AuthenticatedRequest, res) => {
  const result = await resendKitEsignLink(
    String(req.params.kitId),
    req.authUser?.id ?? null,
  );
  return res.json({ success: true, ...result });
}));

/**
 * Recovery for a kit whose provider session is genuinely dead (expired/cancelled —
 * kitEsignSessionIsAlive says so). Abandons the stuck kit and dispatches a brand-new
 * one from scratch. This was previously only reachable pre-conversion, from the ATS
 * candidate control room (joining-control-room.service.ts's redispatchDeadEsignKit) —
 * an employee whose kit died after conversion had no UI path to this at all.
 * redispatchDeadKit itself refuses (409) if the current kit's session is still alive,
 * so this cannot be used to bail on a kit someone could still complete.
 */
/**
 * Force-pull the current eSign status from the provider for a sent kit.
 * The reconciliation worker does this automatically (every 5 min, with backoff),
 * but HR often needs the answer immediately — especially if the employee just
 * finished signing and the page still shows "pending".
 */
joiningKitRouter.post("/:employeeId/joining-kit/:kitId/sync", h(async (req: AuthenticatedRequest, res) => {
  const result = await syncKitEsignStatus(
    String(req.params.kitId),
    String(req.params.employeeId),
    req.authUser?.id ?? null,
  );
  return res.json({ success: true, ...result });
}));

joiningKitRouter.post("/:employeeId/joining-kit/redispatch", h(async (req: AuthenticatedRequest, res) => {
  const result = await redispatchDeadKit(
    String(req.params.employeeId),
    req.authUser?.id ?? null,
  );
  return res.json({ success: true, data: result });
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
  // Only the open ("sent") kit's liveness is worth telling HR about — a "redispatch"
  // action only makes sense against that one, and checking every historical kit here
  // would mean one extra query per row for no reason.
  const withLiveness = await Promise.all(rows.map(async (row) => {
    if (String(row.status) !== "sent") return row;
    return { ...row, sessionAlive: await kitEsignSessionIsAlive(String(row.id)) };
  }));
  return res.json({ success: true, data: withLiveness });
}));

/**
 * The kit's own file — signed copy once complete, otherwise the unsigned draft that
 * was sent for signing. Before this route existed, HR had no way to see the complete
 * merged document at all from this page: each checklist item's own preview happens to
 * resolve to the same underlying kit file (see latestChecklistFile's FIELD() order),
 * but nothing said so, and a kit with no member items yet (still 'queued') had no
 * preview path whatsoever.
 */
joiningKitRouter.get("/:employeeId/joining-kit/:kitId/file", h(async (req, res) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT f.storage_path, f.original_filename, f.mime_type
       FROM employee_joining_esign_kit k
       JOIN employee_joining_document_file f ON f.id = COALESCE(k.signed_file_id, k.kit_file_id)
      WHERE k.id = ? AND k.employee_id = ? AND f.deleted_at IS NULL
      LIMIT 1`,
    [String(req.params.kitId), String(req.params.employeeId)],
  );
  const file = rows[0];
  if (!file || !file.storage_path || !fs.existsSync(String(file.storage_path))) {
    return res.status(404).json({ success: false, message: "This kit has no document file yet." });
  }
  res.setHeader("Content-Type", String(file.mime_type ?? "application/pdf"));
  res.setHeader("Content-Disposition", `inline; filename="${String(file.original_filename ?? "joining-kit.pdf").replace(/"/g, "")}"`);
  fs.createReadStream(String(file.storage_path)).pipe(res);
}));
