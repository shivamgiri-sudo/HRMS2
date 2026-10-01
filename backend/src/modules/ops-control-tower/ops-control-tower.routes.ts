// Ops Control Tower API — mounted at /api/ops-control-tower.
import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { logger } from "../../logger.js";
import {
  DashboardScopeConfigurationError,
  resolveDashboardScopeForRequest,
} from "../../shared/dashboardScope.js";
import { scopeSummaryToBranches } from "./ops-control-tower.logic.js";
import {
  getOpsControlTowerSummary,
  getAttendanceMismatchDetail,
  getFnfPendingDetail,
  getNocPendingDetail,
  getDigilockerPendingDetail,
  getEsignPendingDetail,
  getAppointmentLetterDetail,
  getPennyDropMissingDetail,
  getAccountDetailsMissingDetail,
  getBgvPendingDetail,
  getItProvisioningPendingDetail,
  getAdminProvisioningPendingDetail,
  getWfmProvisioningPendingDetail,
} from "./ops-control-tower.service.js";
import {
  employeeBranchId,
  enrichDetailRows,
  nudgeBranchPending,
  nudgeEmployee,
  whatsappConfigured,
} from "./ops-nudge.service.js";
import { isNudgeableIssue } from "./ops-nudge.logic.js";

const VIEW_ROLES = [
  "super_admin",
  "admin",
  "hr",
  "hr_admin",
  "ceo",
  "branch_head",
  "operations_manager",
  "wfm",
  "payroll_head",
];
// Sending a WhatsApp to a joiner is outward-facing: narrower than the view list (wfm / ceo view only).
const NUDGE_ROLES = [
  "super_admin",
  "admin",
  "hr",
  "hr_admin",
  "branch_head",
  "operations_manager",
  "payroll_head",
];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ID_PATTERN = /^[0-9a-fA-F-]{36}$/;

export const opsControlTowerRouter = Router();
opsControlTowerRouter.use(requireAuth);

function todayIST(): string {
  // Host-local is treated as IST elsewhere in this codebase (attendance-engine.cron.ts and
  // roster-upload-tracker.logic.ts both note the same assumption) — matched here rather than
  // introducing a second convention.
  return new Date().toISOString().slice(0, 10);
}

/**
 * Branch ids the caller may see; null = org-wide. Only ORG_ALL and branch / process level scopes
 * carry a branch list - team / self scopes and unconfigured accounts get an empty set (fail closed).
 */
async function allowedBranchIds(req: import("express").Request): Promise<Set<string> | null> {
  try {
    const scope = await resolveDashboardScopeForRequest((req as any).authUser, "");
    if (scope.level === "ORG_ALL") return null;
    if (scope.level === "BRANCH_ALL" || scope.level === "PROCESS_ALL" || scope.level === "CUSTOM_SCOPE") {
      return new Set(scope.branchIds);
    }
    return new Set();
  } catch (err) {
    if (err instanceof DashboardScopeConfigurationError) return new Set();
    throw err;
  }
}

function fail(
  res: import("express").Response,
  err: unknown,
  what: string,
): void {
  logger.error(
    { err: (err as Error).message },
    `[ops-control-tower] ${what} failed`,
  );
  res.status(500).json({ error: `Could not ${what}` });
}

// GET /api/ops-control-tower?date=YYYY-MM-DD — the 8-block summary, one row per branch each.
opsControlTowerRouter.get("/", requireRole(...VIEW_ROLES), async (req, res) => {
  try {
    const dateParam =
      typeof req.query.date === "string" ? req.query.date : undefined;
    if (dateParam && !DATE_PATTERN.test(dateParam)) {
      res.status(400).json({ error: "date must be YYYY-MM-DD" });
      return;
    }
    const allowed = await allowedBranchIds(req);
    res.json(scopeSummaryToBranches(await getOpsControlTowerSummary(dateParam ?? todayIST()), allowed));
  } catch (err) {
    fail(res, err, "load the ops control tower");
  }
});

type Detail = (branchId: string) => Promise<unknown[]>;
const DETAIL_BY_BLOCK: Record<string, Detail> = {
  "attendance-mismatch": getAttendanceMismatchDetail,
  "fnf-pending": getFnfPendingDetail,
  "noc-pending": getNocPendingDetail,
  "digilocker-pending": getDigilockerPendingDetail,
  "esign-pending": getEsignPendingDetail,
  "appointment-letter": getAppointmentLetterDetail,
  "penny-drop-missing": getPennyDropMissingDetail,
  "account-details-missing": getAccountDetailsMissingDetail,
  "bgv-pending": getBgvPendingDetail,
  "it-provisioning-pending": getItProvisioningPendingDetail,
  "admin-provisioning-pending": getAdminProvisioningPendingDetail,
  "wfm-provisioning-pending": getWfmProvisioningPendingDetail,
};

// GET /api/ops-control-tower/:block/:branchId — the record list behind one cell.
// Roster and Joining are date rollups with no single "pending list" of their own — Roster's
// detail already lives on the Roster Upload Tracker, and Joining's on the Employee Master.
opsControlTowerRouter.get(
  "/:block/:branchId",
  requireRole(...VIEW_ROLES),
  async (req, res) => {
    try {
      const { block, branchId } = req.params;
      if (!ID_PATTERN.test(branchId)) {
        res.status(400).json({ error: "branchId must be a valid id" });
        return;
      }
      const loader = DETAIL_BY_BLOCK[block];
      if (!loader) {
        res.status(404).json({ error: `Unknown block "${block}"` });
        return;
      }
      // The branchId comes from the URL, so it is only a request: it must sit inside the caller's scope.
      const allowed = await allowedBranchIds(req);
      if (allowed !== null && !allowed.has(branchId)) {
        res.status(403).json({ error: "Forbidden: this branch is outside your branch / assigned scope" });
        return;
      }
      const rows = await enrichDetailRows(block, (await loader(branchId)) as Array<Record<string, unknown> & { employeeId: string }>);
      res.json({
        rows,
        nudge: { supported: isNudgeableIssue(block), whatsappConfigured: isNudgeableIssue(block) ? whatsappConfigured() : false },
      });
    } catch (err) {
      fail(res, err, "load the detail list");
    }
  },
);

// POST /api/ops-control-tower/nudge { employeeId, issue } — "Notify" one joiner on WhatsApp.
opsControlTowerRouter.post("/nudge", requireRole(...NUDGE_ROLES), async (req, res) => {
  try {
    const { employeeId, issue } = req.body ?? {};
    if (typeof employeeId !== "string" || !ID_PATTERN.test(employeeId)) {
      res.status(400).json({ error: "employeeId must be a valid id" });
      return;
    }
    if (typeof issue !== "string" || !isNudgeableIssue(issue)) {
      res.status(400).json({ error: "issue is not nudgeable" });
      return;
    }
    const branchId = await employeeBranchId(employeeId);
    if (branchId === null) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }
    const allowed = await allowedBranchIds(req);
    if (allowed !== null && !allowed.has(branchId)) {
      res.status(403).json({ error: "Forbidden: this employee is outside your branch / assigned scope" });
      return;
    }
    res.json(await nudgeEmployee({ employeeId, issue, trigger: "manual", actorId: (req as any).authUser?.id ?? null }));
  } catch (err) {
    fail(res, err, "send the nudge");
  }
});

// POST /api/ops-control-tower/nudge/bulk { branchId, issue } — "Notify all" pending joiners in a branch.
// The list is built server-side from the same loader the drawer uses; ids are never taken from the client.
opsControlTowerRouter.post("/nudge/bulk", requireRole(...NUDGE_ROLES), async (req, res) => {
  try {
    const { branchId, issue } = req.body ?? {};
    if (typeof branchId !== "string" || !ID_PATTERN.test(branchId)) {
      res.status(400).json({ error: "branchId must be a valid id" });
      return;
    }
    if (typeof issue !== "string" || !isNudgeableIssue(issue)) {
      res.status(400).json({ error: "issue is not nudgeable" });
      return;
    }
    const allowed = await allowedBranchIds(req);
    if (allowed !== null && !allowed.has(branchId)) {
      res.status(403).json({ error: "Forbidden: this branch is outside your branch / assigned scope" });
      return;
    }
    const results = await nudgeBranchPending({ branchId, issue, actorId: (req as any).authUser?.id ?? null });
    const tally: Record<string, number> = {};
    for (const r of results) tally[r.status] = (tally[r.status] ?? 0) + 1;
    res.json({ results, tally });
  } catch (err) {
    fail(res, err, "send the bulk nudge");
  }
});
