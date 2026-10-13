/**
 * GET /api/he/person-history?mobile=<10 digits>: the fresh/repeat approach history of one person (person-attempts.service.ts): every
 * requisition tried, contacts and connections per requisition, times connected. Branch-scoped users only see the part of the history that
 * belongs to requisitions of their own branch (an organisation-wide user sees all). Read-only; the mobile is the search key and is
 * returned masked.
 */
import type { Request, Response, Router } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { branchScopeOf } from "./he-stream.routes.js";
import { attemptLabel, loadAttemptEvents, summariseAttempts, type AttemptEvent } from "./person-attempts.service.js";

const MOBILE_RE = /^\d{10}$/;

export function registerPersonHistoryRoutes(r: Router, roles: { view: string[] }): void {
  r.get("/person-history", requireAuth, requireRole(...roles.view), async (req: Request, res: Response) => {
    const raw = String(req.query.mobile ?? "").replace(/\D/g, "");
    const mobile = raw.length > 10 ? raw.slice(-10) : raw;
    if (!MOBILE_RE.test(mobile)) return void res.status(400).json({ success: false, message: "Enter a 10 digit mobile number" });
    try {
      const scope = await branchScopeOf(req as AuthenticatedRequest);
      let events: AttemptEvent[] = (await loadAttemptEvents([mobile])).get(mobile) ?? [];
      if (!scope.all) {
        const ids = [...new Set(events.map((e) => e.requisitionId).filter((x): x is string => !!x))];
        const own = new Set<string>();
        if (ids.length && scope.branchName) {
          const [rows] = await db.execute<RowDataPacket[]>(
            `SELECT id FROM job_requisition WHERE id IN (${ids.map(() => "?").join(",")}) AND branch_name = ?`, [...ids, scope.branchName]);
          for (const x of rows) own.add(String(x.id));
        }
        events = events.filter((e) => e.requisitionId != null && own.has(e.requisitionId));
      }
      const a = summariseAttempts(mobile, events, {});
      res.json({ success: true, data: {
        mobile: `xxxxxx${mobile.slice(-4)}`, type: a.type, approachNo: a.approachNo, priorContacts: a.priorContacts, timesConnected: a.timesConnected,
        requisitions: a.priorRequisitions, label: attemptLabel(a), scoped: !scope.all,
      } });
    } catch {
      res.status(500).json({ success: false, message: "Could not load the person history" });
    }
  });
}
