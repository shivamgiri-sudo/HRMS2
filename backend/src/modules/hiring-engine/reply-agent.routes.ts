/**
 * HR side of the reply agent, under /api/he: the candidate email replies with the agent's draft (GET /replies), send one as written or
 * edited (POST /replies/:id/send), discard one (POST /replies/:id/discard). A branch-scoped user sees only replies for requisitions of
 * their own branch; unmatched senders are visible to organisation-wide users only. Edited text goes through the same checks as the agent's.
 */
import type { Request, Response, Router } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { emailService } from "../communication/email.service.js";
import { branchScopeOf } from "./he-stream.routes.js";
import { buildFactSheet, denyTerms } from "./reply-agent.service.js";
import { scrub, validateReply } from "./reply-agent.rules.js";

const ID_RE = /^[0-9a-f-]{36}$/i;
const STATUSES = ["draft", "queued", "held", "failed", "sent", "discarded"] as const;
const userOf = (req: Request) => (req as AuthenticatedRequest).authUser?.id ?? null;

export function registerReplyAgentRoutes(r: Router, roles: { view: string[]; write: string[] }): void {
  r.get("/replies", requireAuth, requireRole(...roles.view), async (req: Request, res: Response) => {
    try {
      const want = String(req.query.status ?? "draft,held,queued,failed").split(",").map((s) => s.trim()).filter((s) => (STATUSES as readonly string[]).includes(s));
      const scope = await branchScopeOf(req as AuthenticatedRequest);
      const params: unknown[] = [want.length ? want : ["draft", "held", "queued", "failed"]].flat();
      const inList = (want.length ? want : ["draft", "held", "queued", "failed"]).map(() => "?").join(",");
      let where = `c.status IN (${inList})`;
      if (!scope.all) { where += " AND j.branch_name = ?"; params.push(scope.branchName ?? ""); }
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT c.id, c.mobile10, c.from_email, c.subject, c.inbound_text, c.intent, c.language, c.confidence, c.reply_text, c.status, c.hold_reason, c.engine,
                c.created_at, c.sent_at, j.designation_name, j.branch_name
           FROM candidate_reply c LEFT JOIN job_requisition j ON j.id = c.requisition_id WHERE ${where} ORDER BY c.created_at DESC LIMIT 200`, params);
      res.json({ success: true, data: rows.map((x) => ({
        id: String(x.id), mobile: `xxxxxx${String(x.mobile10 ?? "").slice(-4)}`, fromEmail: x.from_email, subject: x.subject, inbound: x.inbound_text, intent: x.intent, language: x.language,
        confidence: x.confidence != null ? Number(x.confidence) : null, reply: x.reply_text, status: x.status, holdReason: x.hold_reason, engine: x.engine,
        role: x.designation_name ?? null, branch: x.branch_name ?? null, at: String(x.created_at), sentAt: x.sent_at ? String(x.sent_at) : null,
      })) });
    } catch { res.status(500).json({ success: false, message: "Could not load the replies" }); }
  });

  r.post("/replies/:id/send", requireAuth, requireRole(...roles.write), async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!ID_RE.test(id)) return void res.status(400).json({ success: false, message: "Bad id" });
    try {
      const [rows] = await db.execute<RowDataPacket[]>(
        "SELECT id, lead_id, match_id, requisition_id, from_email, subject, reply_text, status FROM candidate_reply WHERE id = ? LIMIT 1", [id]);
      const c = rows[0];
      if (!c) return void res.status(404).json({ success: false, message: "Reply not found" });
      if (c.status === "sent") return void res.status(409).json({ success: false, message: "Already sent" });
      if (!c.from_email) return void res.status(409).json({ success: false, message: "No sender address" });
      const edited = typeof req.body?.text === "string" ? req.body.text : null;
      const deny = await denyTerms();
      const text = scrub(String(edited ?? c.reply_text ?? ""), deny);
      const built = await buildFactSheet({ leadId: c.lead_id ? String(c.lead_id) : null, matchId: c.match_id ? String(c.match_id) : null, requisitionId: c.requisition_id ? String(c.requisition_id) : null }, deny);
      if (!built) return void res.status(409).json({ success: false, message: "No requisition for this person; reply by phone or from the inbox" });
      const v = validateReply({ text, facts: built.facts, deny });
      if (!v.ok) return void res.status(422).json({ success: false, message: `The reply was not sent: ${v.reason.replace(/_/g, " ")}`, code: v.reason });
      const subject = /^re:/i.test(String(c.subject ?? "")) ? String(c.subject) : `Re: ${String(c.subject ?? "") || "Your walk-in interview"}`;
      await emailService.send({ to: String(c.from_email), subject, text, html: text.split("\n").map((l) => (l.trim() ? `<p style="margin:0 0 8px">${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>` : "")).join("") });
      await db.execute("UPDATE candidate_reply SET status = 'sent', sent_at = NOW(), reply_text = ?, handled_by = ? WHERE id = ?", [text, userOf(req), id]);
      res.json({ success: true });
    } catch { res.status(500).json({ success: false, message: "Could not send the reply" }); }
  });

  r.post("/replies/:id/discard", requireAuth, requireRole(...roles.write), async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!ID_RE.test(id)) return void res.status(400).json({ success: false, message: "Bad id" });
    try {
      await db.execute("UPDATE candidate_reply SET status = 'discarded', handled_by = ? WHERE id = ? AND status <> 'sent'", [userOf(req), id]);
      res.json({ success: true });
    } catch { res.status(500).json({ success: false, message: "Could not discard the reply" }); }
  });
}
