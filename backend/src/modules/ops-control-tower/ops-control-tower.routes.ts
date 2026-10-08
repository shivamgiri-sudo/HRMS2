// Ops Control Tower API — mounted at /api/ops-control-tower.
import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { logger } from "../../logger.js";
import {
  DashboardScopeConfigurationError,
  resolveDashboardScopeForRequest,
} from "../../shared/dashboardScope.js";
import { blockAllowedForPayrollOnly, scopeSummaryToBranches } from "./ops-control-tower.logic.js";
import { cachedSummary } from "./ops-summary-cache.js";
import { closeOldAttendanceIssues, getSyncHealth, runBackfill } from "./ops-attendance-actions.service.js";
import { hasRole } from "../../shared/accessGuard.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
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
  getDocsPendingDetail,
  getBgvPendingDetail,
  getAddressReviewPendingDetail,
  getItProvisioningPendingDetail,
  getAdminProvisioningPendingDetail,
  getWfmProvisioningPendingDetail,
} from "./ops-control-tower.service.js";
import {
  employeeBranchId,
  issueOnboardingLink,
  emailOnboardingLink,
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
  "payroll_hr",
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
  "payroll_hr",
];
// Closing old mismatch items as reviewed is a data-quality call, not a payroll one.
const CLOSE_ROLES = ["super_admin", "admin", "hr", "hr_admin", "payroll_head"];
// Backfilling writes attendance records, which payroll reads: narrower again.
const BACKFILL_ROLES = ["super_admin", "admin", "payroll_head"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ID_PATTERN = /^[0-9a-fA-F-]{36}$/;


// Roles that may use the whole tower. A caller holding only payroll_hr (from VIEW_ROLES) is limited
// to PAYROLL_HR_BLOCKS - their branch scope still applies on top.
const FULL_TOWER_ROLES = VIEW_ROLES.filter((r) => r !== "payroll_hr");
async function mayUseBlock(req: import("express").Request, block: string): Promise<boolean> {
  if (blockAllowedForPayrollOnly(block)) return true;
  const userId = (req as any).authUser?.id as string | undefined;
  return !!userId && (await hasRole(userId, ...FULL_TOWER_ROLES));
}

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
    const date = dateParam ?? todayIST();
    // Cached org-wide; scoping to the caller's branches happens on the cached copy, never inside it.
    res.json(scopeSummaryToBranches(await cachedSummary(date, () => getOpsControlTowerSummary(date)), allowed));
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
  "docs-pending": getDocsPendingDetail,
  "bgv-pending": getBgvPendingDetail,
  "address-review-pending": getAddressReviewPendingDetail,
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
      if (!(await mayUseBlock(req, block))) {
        res.status(403).json({ error: "Forbidden: this section is not available to your role" });
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
    if (!(await mayUseBlock(req, issue))) {
      res.status(403).json({ error: "Forbidden: this issue is not available to your role" });
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

// GET /api/ops-control-tower/sync-health - is the attendance PIPELINE healthy? Last runs of the jobs that create
// attendance records, and per-branch coverage (share of active staff with a record) for the last 7 days, so a
// cut-off run shows up as a dip in the pipeline instead of as a pile of employee names.
opsControlTowerRouter.get("/sync-health", requireRole(...VIEW_ROLES), async (req, res) => {
  try {
    if (!(await mayUseBlock(req, "attendance-mismatch"))) {
      res.status(403).json({ error: "Forbidden: this section is not available to your role" });
      return;
    }
    const allowed = await allowedBranchIds(req);
    const health = await getSyncHealth();
    const coverage = allowed === null ? health.coverage : health.coverage.filter((b) => allowed.has(b.branchId));
    res.json({ ...health, coverage, lowDays: coverage.reduce((n, b) => n + b.days.filter((d) => d.low).length, 0) });
  } catch (err) {
    fail(res, err, "load the sync health");
  }
});

// POST /api/ops-control-tower/attendance/close { branchId, reason, issueTypes? } - close OLD mismatch items for a
// branch as reviewed (who + why recorded). Items inside the 7-day automatic window are refused by the service.
opsControlTowerRouter.post("/attendance/close", requireRole(...CLOSE_ROLES), async (req, res) => {
  try {
    const { branchId, reason, issueTypes } = req.body ?? {};
    if (typeof branchId !== "string" || !ID_PATTERN.test(branchId)) {
      res.status(400).json({ error: "branchId must be a valid id" });
      return;
    }
    if (issueTypes !== undefined && (!Array.isArray(issueTypes) || issueTypes.some((t: unknown) => typeof t !== "string"))) {
      res.status(400).json({ error: "issueTypes must be a list of strings" });
      return;
    }
    if (!(await mayUseBlock(req, "attendance-mismatch"))) {
      res.status(403).json({ error: "Forbidden: this section is not available to your role" });
      return;
    }
    const allowed = await allowedBranchIds(req);
    if (allowed !== null && !allowed.has(branchId)) {
      res.status(403).json({ error: "Forbidden: this branch is outside your branch / assigned scope" });
      return;
    }
    const actorId = (req as any).authUser?.id as string;
    const out = await closeOldAttendanceIssues({ branchId, reason: String(reason ?? ""), actorId, issueTypes });
    if (!out.ok) {
      res.status(out.status).json({ error: out.message });
      return;
    }
    void logSensitiveAction({
      actor_user_id: actorId, action_type: "ATTENDANCE_MISMATCH_CLOSED_AS_REVIEWED", module_key: "ops-control-tower",
      entity_type: "branch", entity_id: branchId,
      change_summary: { closed: out.closed, left_open: out.leftOpen, months: out.closableMonths, issue_types: issueTypes ?? "all", reason: String(reason).slice(0, 200) }, req: req as any,
    });
    res.json({ closed: out.closed, leftOpen: out.leftOpen, closableMonths: out.closableMonths });
  } catch (err) {
    fail(res, err, "close the attendance items");
  }
});

// POST /api/ops-control-tower/attendance/backfill { branchId, from, to, mode: preview|commit, confirm? }
// Creates MISSING attendance records for a branch using the normal engine. Preview writes nothing and lists the
// payroll runs for the months it touches; committing beyond the 7-day automatic window needs confirm "BACKFILL".
opsControlTowerRouter.post("/attendance/backfill", requireRole(...BACKFILL_ROLES), async (req, res) => {
  try {
    const { branchId, from, to, mode, confirm } = req.body ?? {};
    if (typeof branchId !== "string" || !ID_PATTERN.test(branchId)) {
      res.status(400).json({ error: "branchId must be a valid id" });
      return;
    }
    if (mode !== "preview" && mode !== "commit") {
      res.status(400).json({ error: "mode must be preview or commit" });
      return;
    }
    if (!(await mayUseBlock(req, "attendance-mismatch"))) {
      res.status(403).json({ error: "Forbidden: this section is not available to your role" });
      return;
    }
    const allowed = await allowedBranchIds(req);
    if (allowed !== null && !allowed.has(branchId)) {
      res.status(403).json({ error: "Forbidden: this branch is outside your branch / assigned scope" });
      return;
    }
    const actorId = (req as any).authUser?.id as string;
    const out = await runBackfill({ branchId, from, to, mode, confirm: typeof confirm === "string" ? confirm : undefined, actorId });
    if (!out.ok) {
      res.status(out.status).json({ error: out.message });
      return;
    }
    if (mode === "commit") {
      void logSensitiveAction({
        actor_user_id: actorId, action_type: "ATTENDANCE_BACKFILL", module_key: "ops-control-tower",
        entity_type: "branch", entity_id: branchId,
        change_summary: { from, to, found: out.data.found, processed: out.data.processed, failed: out.data.failed, payroll_runs_in_range: out.data.payrollRunsInRange.length }, req: req as any,
      });
    }
    res.json(out.data);
  } catch (err) {
    fail(res, err, "run the attendance backfill");
  }
});

// POST /api/ops-control-tower/onboarding-link { employeeId, issue } - a fresh link HR can hand over directly.
// Same roles, branch scope and per-role section limits as a nudge, plus an audit entry: the link lets the
// holder act on the joiner's onboarding record, so every issue is traceable.
opsControlTowerRouter.post("/onboarding-link", requireRole(...NUDGE_ROLES), async (req, res) => {
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
    if (!(await mayUseBlock(req, issue))) {
      res.status(403).json({ error: "Forbidden: this issue is not available to your role" });
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
    const issued = await issueOnboardingLink(employeeId);
    if (!issued) {
      res.status(409).json({ error: "This employee has no onboarding link to issue (no onboarding record, or marked not joining)" });
      return;
    }
    void logSensitiveAction({
      actor_user_id: (req as any).authUser?.id,
      action_type: "ONBOARDING_LINK_ISSUED",
      module_key: "ops-control-tower",
      entity_type: "employee",
      entity_id: employeeId,
      change_summary: { issue, expires_at: issued.expiresAt },
      req: req as any,
    });
    res.json(issued);
  } catch (err) {
    fail(res, err, "issue the onboarding link");
  }
});

// POST /api/ops-control-tower/onboarding-link/email { employeeId, issue } - emails the joiner their link.
// Same roles, branch scope and section limits as the Copy link action; audited without the token.
opsControlTowerRouter.post("/onboarding-link/email", requireRole(...NUDGE_ROLES), async (req, res) => {
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
    if (!(await mayUseBlock(req, issue))) {
      res.status(403).json({ error: "Forbidden: this issue is not available to your role" });
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
    const out = await emailOnboardingLink(employeeId);
    void logSensitiveAction({
      actor_user_id: (req as any).authUser?.id,
      action_type: "ONBOARDING_LINK_EMAILED",
      module_key: "ops-control-tower",
      entity_type: "employee",
      entity_id: employeeId,
      change_summary: { issue, outcome: out.status },
      req: req as any,
    });
    if (out.status === "sent") { res.json({ status: "sent", sentTo: out.sentTo }); return; }
    if (out.status === "no_email") { res.status(409).json({ error: "No valid email address on file for this employee" }); return; }
    if (out.status === "no_link") { res.status(409).json({ error: "This employee has no onboarding link to issue (no onboarding record, or marked not joining)" }); return; }
    if (out.status === "not_found") { res.status(404).json({ error: "Employee not found" }); return; }
    res.status(502).json({ error: `Email could not be delivered: ${out.status === "failed" ? out.error : "unknown error"}` });
  } catch (err) {
    fail(res, err, "email the onboarding link");
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
    if (!(await mayUseBlock(req, issue))) {
      res.status(403).json({ error: "Forbidden: this issue is not available to your role" });
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
