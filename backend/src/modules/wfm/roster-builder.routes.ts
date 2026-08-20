import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getRosterGrid } from "./roster-builder.service.js";
import { rosterService } from "./roster.service.js";

const WFM_ROLES = ["wfm", "admin", "super_admin"];

export const rosterBuilderRouter = Router();
rosterBuilderRouter.use(requireAuth);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

rosterBuilderRouter.get(
  "/grid",
  requireRole(...WFM_ROLES),
  h(async (req, res) => {
    const cycleId = String(req.query.cycleId ?? "").trim();
    if (!cycleId) {
      res.status(400).json({ error: "cycleId is required" });
      return;
    }
    const branchId = req.query.branchId ? String(req.query.branchId) : undefined;
    const employeeSearch = req.query.employeeSearch ? String(req.query.employeeSearch) : undefined;
    const rows = await getRosterGrid({ cycleId, branchId, employeeSearch });
    res.json({ rows });
  })
);

// Note on shift-id resolution (2026-08-20): the request body's `shiftTemplateId`
// is threaded into AssignInput.shiftTemplateId, NOT AssignInput.shiftId.
// Verified against the live DB: wfm_shift_template (23 UUID-keyed rows) and
// wfm_shift_master (3 string-keyed rows, e.g. "shift-eve-001") share ZERO ids,
// so passing a shift_template_id value through the legacy shiftId param would
// silently write a bogus/no-op shift_id. roster.service.ts's assignEmployee
// (Task 3) now accepts shiftTemplateId as its own additive, backward-compatible
// field and writes it to wfm_roster_assignment.shift_template_id — the same
// column Task 5's grid reads back.
rosterBuilderRouter.post(
  "/assign",
  requireRole(...WFM_ROLES),
  h(async (req, res) => {
    const { employeeId, rosterDate, cycleId, shiftTemplateId } = req.body as {
      employeeId?: string; rosterDate?: string; cycleId?: string; shiftTemplateId?: string | null;
    };
    if (!employeeId || !rosterDate || !cycleId) {
      res.status(400).json({ error: "employeeId, rosterDate, and cycleId are required" });
      return;
    }
    const data = await rosterService.assignEmployee(
      { employeeId, rosterDate, cycleId, shiftTemplateId: shiftTemplateId ?? null },
      req.authUser!.id
    );
    res.status(201).json({ success: true, data });
  })
);
