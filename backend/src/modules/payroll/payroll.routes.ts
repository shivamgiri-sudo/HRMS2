import { Router } from "express";
import { sqlLimitOffset } from "../../db/pagination.js";
import { randomUUID, createHash } from "crypto";
import path from "path";
import fs from "fs";
import multer from "multer";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireScopedRole } from "../../middleware/scopeMiddleware.js";
import { requireWFMAccess } from "../../middleware/requireWFMAccess.js";
import { payrollRunLimiter } from "../../middleware/rateLimiter.js";
import { buildScopeWhereClause, hasAnyRole as hasAnyRoleAsync, hasScopedAccess, getUserAssignmentScopes } from "../../shared/scopeAccess.js";
import { statutoryRegimeForFinancialYear } from "./statutory-regime.js";
import { loadFlatStatutoryConfig } from "./statutory-config.loader.js";
import { getPartAAvailability } from "./tds-certificate-part-a.service.js";
import { resolvePii } from "../../shared/piiCiphertext.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { resolveAccountNumber } from "../../shared/fieldEncryption.js";

// Synchronous role check against req.user.role (used for validate/reject guards)
function hasAnyRole(req: any, roles: string[]): boolean {
  const userRole: string = req?.authUser?.role ?? req?.user?.role ?? "";
  return roles.includes(userRole);
}
import { payrollController as c } from "./payroll.controller.js";
import { calculatePayrollRun, calculatePayrollRunScoped } from "./payrollCalculate.service.js";
import { payrollGovernanceService } from "./payroll-governance.service.js";
import { assertRunEditable } from "./payrollWindowGuard.js";
import { isRunClosed, runRankSql } from "./run-status.js";
import { payslipService } from "./payslip.service.js";
import { taxDeclarationService } from "./taxDeclaration.service.js";
import { payrollBranchReadinessService } from "./payroll-branch-readiness.service.js";
import { buildBankReadinessReport } from "./bank-payment-readiness.service.js";
import { payrollAttendanceControlService } from "./payroll-attendance-control.service.js";
import { cosecSyncService } from "../wfm/cosec-sync.service.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { db } from "../../db/mysql.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";

/**
 * Roles whose payroll authority can be org-wide, used with hasOrgWideScope on the
 * bank-file endpoints below. Those refuse a branch-scoped caller outright rather
 * than emit a silently partial payment instruction.
 */
const PAYROLL_EXPORT_ROLES = ["finance", "payroll", "finance_head", "payroll_head", "payroll_admin"];
const ORG_WIDE_REQUIRED_MSG =
  "This export requires org-wide payroll scope. A branch-scoped export would produce a partial payment file, which is indistinguishable from a complete one once downloaded.";

/**
 * The bank/NEFT export's own org-wide test — deliberately NOT hasOrgWideScope().
 *
 * hasOrgWideScope() short-circuits to true for anyone holding `admin` (scopeAccess.ts:~192)
 * before it ever looks at a scope row. Fixed 2026-08-17 (Section M RBAC audit): this file's
 * neft-lines and neft-export endpoints were still using the raw hasOrgWideScope check, even
 * though the identical vulnerability was already found and fixed for /payment-file in
 * bank-payment-readiness.routes.ts (c202fe10, 2026-08-14), whose own commit message names this
 * exact gap as an unfixed follow-up: "the admin-implies-org-wide shortcut in hasOrgWideScope()
 * still applies to every other endpoint that uses it." Measured against production 2026-08-14:
 * one active account holds `admin` + `branch_admin` with ZERO scope_type='all' rows. Routed
 * through hasOrgWideScope, that branch administrator could download every employee's full
 * decrypted bank account number for the whole organisation through THIS file's endpoints.
 *
 * super_admin is org-wide by definition; everyone else needs a real scope_type='all' row
 * against a payroll export role. Holding `admin` is not, by itself, org-wide payroll scope.
 * Same helper/logic as bank-payment-readiness.routes.ts's hasExportScope — duplicated here
 * rather than shared, to keep this a minimal, targeted fix on the files that were still
 * vulnerable rather than a cross-file refactor.
 *
 * STATUS 2026-08-26 — the shortcut this helper was written to avoid is GONE.
 * hasOrgWideScope() no longer short-circuits on `admin`; it now reads
 *   super_admin -> true; else require an allowed role; else require a
 *   scope_type='all' row against those roles
 * which is character-for-character the logic below when called as
 * hasOrgWideScope(userId, PAYROLL_EXPORT_ROLES). This helper is therefore a
 * duplicate rather than a divergence, and the paragraphs above are kept as the
 * record of WHY it exists, not as a live warning about the shared function.
 *
 * It is deliberately NOT collapsed into hasOrgWideScope(). Doing so would edit the
 * gate on a live full-account-number/payment export for zero behavioural gain, and
 * this file's own history is the argument against that trade. Anyone consolidating
 * later must diff both implementations again first — do not assume this note is
 * still true.
 */
async function hasExportScope(userId: string): Promise<boolean> {
  if (await hasAnyRoleAsync(userId, "super_admin")) return true;
  if (!(await hasAnyRoleAsync(userId, ...PAYROLL_EXPORT_ROLES))) return false;
  const scopes = await getUserAssignmentScopes(userId, PAYROLL_EXPORT_ROLES);
  return scopes.some((s) => s.scope_type === "all");
}

// Must match files.routes.ts UPLOADS_ROOT, which serves these back via
// /api/files/tax-documents/*. Resolving from __dirname wrote to backend/dist/uploads/
// once compiled, so uploaded tax proofs 404'd in production.
const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");

/**
 * Canonical ordering of payroll runs: most-progressed status first.
 *
 * A month can hold several runs (a re-run, a correction, an abandoned draft) and
 * exactly one of them is the figure of record. Every surface that has to choose
 * between them MUST use this ordering, or the same month reports different totals
 * in different places — which is precisely how the trend chart came to disagree
 * with the KPI cards sitting directly above it.
 *
 * @param alias table alias for `salary_prep_run`, or "" when the column is unqualified
 */

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// ─── Structures ───────────────────────────────────────────────────────────────

router.get("/structures", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(c.listStructures));
router.post("/structures", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(c.createStructure));
router.put("/structures/:id", requireRole("admin", "super_admin", "finance", "payroll"), h(c.updateStructure));
router.delete("/structures/:id", requireRole("admin", "super_admin"), h(c.deleteStructure));

// ─── Employee Salaries (per-employee assignment with full CTC breakup from components) ─
router.get("/employee-salaries", requireRole("ceo", "admin", "hr", "super_admin", "finance", "payroll", "finance_head", "payroll_head", "payroll_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const scoped = await buildScopeWhereClause(
    req.authUser!.id,
    ["hr", "finance", "payroll", "finance_head", "payroll_head", "payroll_admin"],
    { branchId: "e.branch_id", processId: "e.process_id" },
    { allowAdminBypass: true, allowCeoAllRead: true }
  );
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       esa.id,
       esa.employee_id,
       esa.ctc_annual,
       esa.structure_id,
       esa.effective_from,
       ss.structure_code,
       ss.structure_name,
       ss.basic_pct,
       ss.hra_pct,
       CONCAT_WS(' ', e.first_name, e.last_name)  AS employee_name,
       e.employee_code,
       e.email                                     AS employee_email,
       e.avatar_url                                AS employee_avatar
     FROM employee_salary_assignment esa
     JOIN salary_structure_master ss ON ss.id = esa.structure_id
     JOIN employees e               ON e.id  = esa.employee_id
     WHERE esa.active_status = 1
       AND e.employment_status = 'active'
       AND (${scoped.sql})
     ORDER BY e.employee_code`,
    scoped.params
  );

  // Fetch all components for these structures in one query
  const structureIds = [...new Set((rows as any[]).map(r => r.structure_id).filter(Boolean))];
  const componentMap: Record<string, Array<{component_code: string; component_name: string; calc_type: string; value: number}>> = {};

  if (structureIds.length > 0) {
    const placeholders = structureIds.map(() => '?').join(',');
    const [compRows] = await db.execute<RowDataPacket[]>(
      `SELECT ssc.structure_id, scm.component_code, scm.component_name, ssc.calc_type, ssc.value
         FROM salary_structure_component ssc
         JOIN salary_component_master scm ON scm.id = ssc.component_id
        WHERE ssc.structure_id IN (${placeholders})
          AND ssc.calc_type IN ('fixed', 'pct_of_ctc')
        ORDER BY ssc.sequence`,
      structureIds
    );
    for (const c of compRows as any[]) {
      if (!componentMap[c.structure_id]) componentMap[c.structure_id] = [];
      componentMap[c.structure_id].push({
        component_code: c.component_code,
        component_name: c.component_name,
        calc_type: c.calc_type,
        value: Number(c.value) || 0,
      });
    }
  }

  // Enrich each row with actual component amounts
  const enriched = (rows as any[]).map(row => {
    const comps = componentMap[row.structure_id] || [];
    const basic = comps.find(c => c.component_code === 'BASIC')?.value || 0;
    const hra = comps.find(c => c.component_code === 'HRA')?.value || 0;
    const bonus = comps.find(c => c.component_code === 'BONUS')?.value || 0;
    const conv = comps.find(c => c.component_code === 'CONV')?.value || 0;
    const portfolio = comps.find(c => c.component_code === 'PORTFOLIO')?.value || 0;
    const medical = comps.find(c => c.component_code === 'MEDICAL')?.value || 0;
    const lta = comps.find(c => c.component_code === 'LTA')?.value || 0;
    const special = comps.find(c => c.component_code === 'SPECIAL')?.value || 0;
    const otherAllow = comps.find(c => c.component_code === 'OTHER_ALLOW')?.value || 0;
    const pli = comps.find(c => c.component_code === 'PLI')?.value || 0;
    const gross = basic + hra + bonus + conv + portfolio + medical + lta + special + otherAllow + pli;

    return {
      ...row,
      basic_salary: basic || Math.round((row.ctc_annual / 12) * (row.basic_pct || 40) / 100 * 100) / 100,
      hra: hra || Math.round((row.ctc_annual / 12) * (row.hra_pct || 20) / 100 * 100) / 100,
      bonus, conv, portfolio, medical, lta, special_allowance: special, other_allowance: otherAllow, pli,
      gross_monthly: gross || Math.round(row.ctc_annual / 12 * 100) / 100,
      ctc_monthly: Math.round(row.ctc_annual / 12 * 100) / 100,
      components: comps,
    };
  });

  return res.json({ success: true, data: enriched });
}));

// ─── Components ───────────────────────────────────────────────────────────────

router.get("/components", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(c.listComponents));
router.post("/components", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(c.createComponent));

// ─── Salary Assignments ───────────────────────────────────────────────────────

router.post("/salary-assignments",
  requireRole("admin", "hr", "super_admin", "finance", "payroll"),
  requireScopedRole(["hr", "finance", "payroll"], async (req) => {
    // Resolve employee's branch/process from DB
    const [rows] = await db.execute(
      'SELECT branch_id, process_id, department_id FROM employees WHERE id = ? LIMIT 1',
      [req.body.employeeId ?? req.body.employee_id]
    ) as any[];
    const emp = rows[0];
    return {
      branchId: emp?.branch_id,
      processId: emp?.process_id,
      departmentId: emp?.department_id
    };
  }),
  h(c.assignSalary)
);
router.post("/salary-assignments/bulk", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(c.bulkAssignSalary));

// requireRole alone checked only role membership: any hr/finance/payroll user, however
// narrowly they're scoped, could read any employee's salary assignment org-wide by
// supplying a different :employeeId. requireScopedRole applies the same branch/process
// rule buildScopeWhereClause already enforces on /runs, /records and /employee-salaries
// (super_admin still bypasses unconditionally inside hasScopedAccess).
async function resolveEmployeeIdParamScope(req: AuthenticatedRequest) {
  const [rows] = await db.execute(
    'SELECT branch_id, process_id, department_id FROM employees WHERE id = ? LIMIT 1',
    [req.params.employeeId]
  ) as any[];
  const emp = rows[0];
  return { branchId: emp?.branch_id, processId: emp?.process_id, departmentId: emp?.department_id, employeeId: req.params.employeeId };
}
router.get("/salary-assignments/:employeeId",
  requireRole("admin", "hr", "super_admin", "finance", "payroll"),
  requireScopedRole(["hr", "finance", "payroll"], resolveEmployeeIdParamScope),
  h(c.getEmployeeSalary)
);
router.get("/salary-assignments/:employeeId/history",
  requireRole("admin", "hr", "super_admin", "finance", "payroll"),
  requireScopedRole(["hr", "finance", "payroll"], resolveEmployeeIdParamScope),
  h(c.getEmployeeSalaryHistory)
);

// ─── Payroll Runs — static paths before :id ───────────────────────────────────

const PAYROLL_SCOPE_ROLES = ["hr", "finance", "payroll", "finance_head", "payroll_head", "payroll_admin"] as const;

router.get("/runs", requireRole("ceo", "admin", "hr", "super_admin", "finance", "payroll", "finance_head", "payroll_head", "payroll_admin"), h(async (req, res) => {
  let scoped: { sql: string; params: unknown[] };
  try {
    scoped = await buildScopeWhereClause(
      req.authUser!.id,
      [...PAYROLL_SCOPE_ROLES],
      { branchId: "spr.branch_id", processId: "spr.process_id" },
      { allowAdminBypass: true, allowCeoAllRead: true }
    );
  } catch (_err) {
    scoped = { sql: "1=0", params: [] };
  }
  (req as any).scopeFilter = scoped;
  return c.listRuns(req, res);
}));
router.get("/records", requireRole("ceo", "admin", "hr", "super_admin", "finance", "payroll", "finance_head", "payroll_head", "payroll_admin"), h(async (req, res) => {
  let scoped: { sql: string; params: unknown[] };
  try {
    scoped = await buildScopeWhereClause(
      req.authUser!.id,
      [...PAYROLL_SCOPE_ROLES],
      { branchId: "e.branch_id", processId: "e.process_id" },
      { allowAdminBypass: true, allowCeoAllRead: true }
    );
  } catch (_err) {
    scoped = { sql: "1=0", params: [] };
  }
  (req as any).scopeFilter = scoped;
  return c.listPayrollRecords(req, res);
}));
// Same role list as GET /records in payroll.secure.routes.ts. Commit 18c00e4f admitted
// finance_head/payroll_head/payroll_admin to /runs and /records but left /overview behind,
// so those three roles loaded the payroll grid and then got a 403 on the summary cards above
// it — which the frontend rendered as ₹0 rather than as an error. The grid and the cards it
// sits under have to agree on who may read them.
router.get(
  "/overview",
  requireRole("admin", "hr", "super_admin", "finance", "payroll", "finance_head", "payroll_head", "payroll_admin"),
  h(c.getPayrollOverview)
);

router.get(
  "/attendance-control-tower",
  requireRole("super_admin", "admin", "payroll_head", "payroll_branch", "payroll", "hr", "wfm", "branch_head"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await payrollAttendanceControlService.getControlTower({
      runMonth: typeof req.query.runMonth === "string" ? req.query.runMonth : undefined,
      runId: typeof req.query.runId === "string" ? req.query.runId : undefined,
      from: typeof req.query.from === "string" ? req.query.from : undefined,
      to: typeof req.query.to === "string" ? req.query.to : undefined,
      issueType: typeof req.query.issueType === "string" ? req.query.issueType : undefined,
      reviewStatus: typeof req.query.reviewStatus === "string" ? req.query.reviewStatus : undefined,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      branchId: typeof req.query.branchId === "string" ? req.query.branchId : undefined,
      processId: typeof req.query.processId === "string" ? req.query.processId : undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    return res.json({ success: true, data });
  }),
);

// Detail behind one gap row, for the drill-down drawer. The key is the synthetic
// gap id from the list; it is URL-encoded because every form contains colons.
// Registered before the POST block so it sits with the other reads.
router.get(
  "/attendance-control-tower/gap/:key",
  requireRole("super_admin", "admin", "payroll_head", "payroll_branch", "payroll", "hr", "wfm", "branch_head"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await payrollAttendanceControlService.getGapDetail(String(req.params.key ?? ""));
    if (!data) {
      return res.status(404).json({ success: false, message: "Gap not found or key not recognised" });
    }
    return res.json({ success: true, data });
  }),
);

router.post(
  "/attendance-control-tower/notify-managers",
  requireRole("super_admin", "admin", "payroll_head", "payroll_branch", "payroll", "hr", "wfm", "branch_head"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await payrollAttendanceControlService.notifyReportingManagers({
      runMonth: typeof req.body.runMonth === "string" ? req.body.runMonth : undefined,
      runId: typeof req.body.runId === "string" ? req.body.runId : undefined,
      from: typeof req.body.from === "string" ? req.body.from : undefined,
      to: typeof req.body.to === "string" ? req.body.to : undefined,
      issueType: typeof req.body.issueType === "string" ? req.body.issueType : undefined,
      search: typeof req.body.search === "string" ? req.body.search : undefined,
      branchId: typeof req.body.branchId === "string" ? req.body.branchId : undefined,
      processId: typeof req.body.processId === "string" ? req.body.processId : undefined,
      conflictKeys: Array.isArray(req.body.conflictKeys) ? req.body.conflictKeys.map(String) : undefined,
      actorUserId: req.authUser?.id ?? null,
    });
    return res.json({ success: true, data, message: "Reporting manager notifications queued" });
  }),
);

router.post(
  "/attendance-control-tower/review-status",
  requireRole("super_admin", "admin", "payroll_head", "payroll_branch", "payroll", "hr", "wfm", "branch_head"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const status = String(req.body.status ?? "");
    if (!["reviewed", "no_issue", "regularization_required"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid review status" });
    }
    const conflictKeys = Array.isArray(req.body.conflictKeys) ? req.body.conflictKeys.map(String).filter(Boolean) : [];
    if (conflictKeys.length === 0) {
      return res.status(400).json({ success: false, message: "Select at least one conflict row" });
    }
    const data = await payrollAttendanceControlService.updateReviewStatus({
      runMonth: typeof req.body.runMonth === "string" ? req.body.runMonth : undefined,
      conflictKeys,
      status: status as "reviewed" | "no_issue" | "regularization_required",
      actorUserId: req.authUser?.id ?? null,
      note: typeof req.body.note === "string" ? req.body.note : undefined,
    });
    return res.json({ success: true, data, message: "Review status updated" });
  }),
);

router.post(
  "/attendance-control-tower/repair-missing-adr",
  requireRole("super_admin", "admin", "payroll_head", "payroll_branch", "payroll", "hr", "wfm", "branch_head"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const conflictKeys = Array.isArray(req.body.conflictKeys) ? req.body.conflictKeys.map(String).filter(Boolean) : [];
    if (conflictKeys.length === 0) {
      return res.status(400).json({ success: false, message: "Select at least one ADR missing row" });
    }
    const invalid = conflictKeys.some((key) => {
      const value = String(key);
      return !value.startsWith("apr:") && !value.startsWith("ncosec:");
    });
    if (invalid) {
      return res.status(400).json({ success: false, message: "Only APR-backed or COSEC-backed ADR missing rows can be repaired from this action" });
    }
    const data = await payrollAttendanceControlService.repairMissingAdr({
      conflictKeys,
      actorUserId: req.authUser?.id ?? null,
    });
    return res.json({ success: true, data, message: "ADR repair attempt completed" });
  }),
);

router.post(
  "/attendance-control-tower/lock-regularizations",
  requireRole("super_admin", "admin", "payroll_head", "payroll_branch", "payroll", "hr", "wfm"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const conflictKeys = Array.isArray(req.body.conflictKeys) ? req.body.conflictKeys.map(String).filter(Boolean) : [];
    if (conflictKeys.length === 0) {
      return res.status(400).json({ success: false, message: "Select at least one regularization gap row" });
    }
    const invalid = conflictKeys.some((key) => !String(key).startsWith("regularization:"));
    if (invalid) {
      return res.status(400).json({ success: false, message: "Only approved_regularization_not_locked_in_adr rows can be locked from this action" });
    }
    const data = await payrollAttendanceControlService.lockUnlockedRegularizations({
      conflictKeys,
      actorUserId: req.authUser?.id ?? null,
    });
    return res.json({ success: true, data, message: "Regularization lock attempt completed" });
  }),
);

// ── Async job store for COSEC re-sync (avoids browser HTTP timeout on full-month pulls) ──
interface CosecResyncJob {
  id: string;
  status: "running" | "done" | "error";
  startedAt: number;
  from: string;
  to: string;
  employeeCode: string | null;
  autoRepair: boolean;
  result: any | null;
  error: string | null;
}
const cosecResyncJobs = new Map<string, CosecResyncJob>();
function pruneCosecJobs() {
  const cutoff = Date.now() - 3_600_000;
  for (const [id, job] of cosecResyncJobs) {
    if (job.startedAt < cutoff) cosecResyncJobs.delete(id);
  }
}

async function runCosecResyncJob(job: CosecResyncJob, actorUserId: string | null) {
  try {
    const before = await payrollAttendanceControlService.snapshotCosecState(job.from, job.to, job.employeeCode ?? undefined);

    let syncResult: any = null;
    let syncError: string | null = null;
    try {
      syncResult = await cosecSyncService.sync({ from: job.from, to: job.to });
    } catch (err: any) {
      syncError = err?.message ?? String(err);
    }

    const after = await payrollAttendanceControlService.snapshotCosecState(job.from, job.to, job.employeeCode ?? undefined);

    const beforeMap = new Map<string, any>();
    for (const row of before) beforeMap.set(`${row.employee_code}__${row.activity_date}`, row);
    const diff: Array<{ employeeCode: string; date: string; status: string; before: any; after: any }> = [];
    const seen = new Set<string>();
    for (const row of after) {
      const key = `${row.employee_code}__${row.activity_date}`;
      seen.add(key);
      const b = beforeMap.get(key) ?? null;
      let s = "unchanged";
      if (!b) s = "added";
      else if (Number(b.biometric_minutes) !== Number(row.biometric_minutes) || Number(b.total_punches) !== Number(row.total_punches)) s = "changed";
      diff.push({ employeeCode: String(row.employee_code), date: String(row.activity_date), status: s, before: b, after: row });
    }
    for (const row of before) {
      const key = `${row.employee_code}__${row.activity_date}`;
      if (!seen.has(key)) diff.push({ employeeCode: String(row.employee_code), date: String(row.activity_date), status: "removed", before: row, after: null });
    }
    diff.sort((a, b) => `${a.employeeCode}__${a.date}`.localeCompare(`${b.employeeCode}__${b.date}`));

    let repairResult: { requested: number; repaired: number; skipped: number } | null = null;
    if (job.autoRepair && !syncError) {
      const missingKeys = await payrollAttendanceControlService.getMissingAdrKeys(job.from, job.to, job.employeeCode ?? undefined);
      repairResult = missingKeys.length > 0
        ? await payrollAttendanceControlService.repairMissingAdr({ conflictKeys: missingKeys, actorUserId })
        : { requested: 0, repaired: 0, skipped: 0 };
    }

    await logSensitiveAction({
      actor_user_id: actorUserId ?? "system",
      action_type: "COSEC_BIOMETRIC_RESYNCED",
      module_key: "payroll",
      entity_type: "integration_biometric_daily",
      entity_id: `${job.from}__${job.to}${job.employeeCode ? `__${job.employeeCode}` : ""}`,
      change_summary: {
        from: job.from, to: job.to, employeeCode: job.employeeCode,
        beforeCount: before.length, afterCount: after.length,
        added: diff.filter((d) => d.status === "added").length,
        changed: diff.filter((d) => d.status === "changed").length,
        syncError, autoRepair: job.autoRepair, repairResult,
      },
    });

    job.result = {
      from: job.from, to: job.to, employeeCode: job.employeeCode,
      syncResult, syncError,
      beforeCount: before.length, afterCount: after.length,
      added: diff.filter((d) => d.status === "added").length,
      changed: diff.filter((d) => d.status === "changed").length,
      removed: diff.filter((d) => d.status === "removed").length,
      unchanged: diff.filter((d) => d.status === "unchanged").length,
      diff, repairResult,
    };
    job.status = "done";
  } catch (err: any) {
    job.error = err?.message ?? String(err);
    job.status = "error";
  }
}

router.post(
  "/attendance-control-tower/resync-cosec",
  requireRole("super_admin", "admin", "payroll_head", "payroll_branch", "payroll", "hr", "wfm"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const dateInput = typeof req.body.date === "string" ? req.body.date.trim() : null;
    const fromInput = typeof req.body.from === "string" ? req.body.from.trim() : null;
    const toInput = typeof req.body.to === "string" ? req.body.to.trim() : null;
    const employeeCode = typeof req.body.employeeCode === "string" ? req.body.employeeCode.trim() || null : null;
    const autoRepair = req.body.autoRepair === true || req.body.autoRepair === "true";

    const from = dateInput ?? fromInput ?? "";
    const to = dateInput ?? toInput ?? from;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ success: false, message: "Provide a valid date (YYYY-MM-DD)" });
    }
    const daysDiff = Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
    if (daysDiff < 0 || daysDiff > 31) {
      return res.status(400).json({ success: false, message: "Date range must be 1–31 days" });
    }
    if (cosecSyncService.isRunning()) {
      return res.status(409).json({ success: false, message: "A COSEC sync is already in progress. Try again in a few minutes." });
    }

    pruneCosecJobs();
    const jobId = randomUUID();
    const job: CosecResyncJob = {
      id: jobId, status: "running", startedAt: Date.now(),
      from, to, employeeCode, autoRepair, result: null, error: null,
    };
    cosecResyncJobs.set(jobId, job);

    // Fire-and-forget — returns immediately so the browser never times out
    void runCosecResyncJob(job, req.authUser?.id ?? null);

    return res.json({ success: true, data: { jobId, status: "running", from, to } });
  }),
);

router.get(
  "/attendance-control-tower/resync-cosec/status/:jobId",
  requireRole("super_admin", "admin", "payroll_head", "payroll_branch", "payroll", "hr", "wfm"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const job = cosecResyncJobs.get(String(req.params.jobId ?? ""));
    if (!job) return res.status(404).json({ success: false, message: "Job not found or expired" });
    return res.json({ success: true, data: { jobId: job.id, status: job.status, from: job.from, to: job.to, result: job.result, error: job.error } });
  }),
);

// ─── Cascading filter options for payroll workspace dropdowns ──
// wfm, payroll_branch and branch_head are included deliberately: they can open
// /payroll/attendance-control-tower, which calls this route for its branch and
// process dropdowns. Without them the page loaded but both filters came back
// empty with no error shown, because the client ignores this query's failure.
router.get("/filter-options", requireRole("ceo", "admin", "hr", "super_admin", "finance", "payroll", "finance_head", "payroll_head", "payroll_admin", "wfm", "payroll_branch", "branch_head"), h(async (req: AuthenticatedRequest, res: Response) => {
  const branchId = typeof req.query.branchId === "string" ? req.query.branchId : undefined;

  const scoped = await buildScopeWhereClause(
    req.authUser!.id,
    [...PAYROLL_SCOPE_ROLES],
    { branchId: "e.branch_id", processId: "e.process_id" },
    { allowAdminBypass: true, allowCeoAllRead: true }
  );
  const scopeSql = scoped.sql === "1=1" ? "" : ` AND (${scoped.sql})`;

  const [branches] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT bm.id, bm.branch_name
       FROM branch_master bm
       JOIN employees e ON e.branch_id = bm.id
       JOIN salary_prep_line spl ON spl.employee_id = e.id
      WHERE bm.active_status = 1${scopeSql}
      ORDER BY bm.branch_name`,
    scoped.params
  );

  const processParams: unknown[] = [...scoped.params];
  let processQuery = `SELECT DISTINCT pm.id, pm.process_name
       FROM process_master pm
       JOIN employees e ON e.process_id = pm.id
       JOIN salary_prep_line spl ON spl.employee_id = e.id
      WHERE pm.active_status = 1${scopeSql}`;
  if (branchId) {
    processQuery += ` AND e.branch_id = ?`;
    processParams.push(branchId);
  }
  processQuery += ` ORDER BY pm.process_name`;
  const [processes] = await db.execute<RowDataPacket[]>(processQuery, processParams);

  const deptParams: unknown[] = [...scoped.params];
  let deptQuery = `SELECT DISTINCT dm.id, dm.dept_name
       FROM department_master dm
       JOIN employees e ON e.department_id = dm.id
       JOIN salary_prep_line spl ON spl.employee_id = e.id
      WHERE dm.active_status = 1${scopeSql}`;
  if (branchId) {
    deptQuery += ` AND e.branch_id = ?`;
    deptParams.push(branchId);
  }
  deptQuery += ` ORDER BY dm.dept_name`;
  const [departments] = await db.execute<RowDataPacket[]>(deptQuery, deptParams);

  res.json({ success: true, data: { branches, processes, departments } });
}));

// ─── Attendance summary for a specific payroll line (used in payslip dialog) ──
router.get("/lines/:lineId/attendance", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(async (req, res) => {
  const { lineId } = req.params;
  // Resolve employee_id + run_month + payroll-computed day fields from the line
  const [lineRows] = await db.execute<RowDataPacket[]>(
    `SELECT spl.employee_id, spr.run_month,
            spl.paid_working_days, spl.eligible_weekoff_days,
            spl.eligible_holiday_days, spl.final_payable_days,
            spl.active_calendar_days
       FROM salary_prep_line spl
       JOIN salary_prep_run spr ON spr.id = spl.run_id
      WHERE spl.id = ? LIMIT 1`,
    [lineId]
  );
  const line = (lineRows as any[])[0];
  if (!line) return res.status(404).json({ success: false, message: "Line not found" });

  const [yr, mo] = String(line.run_month).split("-");
  const monthStart = `${yr}-${mo}-01`;
  const monthEnd   = new Date(Number(yr), Number(mo), 0).toISOString().slice(0, 10); // last day of month

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*)                                                                         AS total_days,
       COUNT(CASE WHEN attendance_status IN ('present','late')         THEN 1 END)      AS present_days,
       COUNT(CASE WHEN attendance_status = 'absent'                    THEN 1 END)      AS absent_days,
       COUNT(CASE WHEN attendance_status = 'week_off'                  THEN 1 END)      AS week_off_days,
       COUNT(CASE WHEN attendance_status = 'holiday'                   THEN 1 END)      AS holiday_days,
       COUNT(CASE WHEN attendance_status = 'half_day'                  THEN 1 END)      AS half_days,
       COUNT(CASE WHEN attendance_status = 'leave_approved'            THEN 1 END)      AS approved_leave_days,
       COALESCE(SUM(lwp_value), 0)                                                      AS lwp_days,
       COUNT(CASE WHEN attendance_status NOT IN ('week_off','holiday') THEN 1 END)      AS working_days
     FROM attendance_daily_record
    WHERE employee_id = ? AND record_date BETWEEN ? AND ?`,
    [line.employee_id, monthStart, monthEnd]
  );
  const summary = (rows as any[])[0] ?? {};

  // Use payroll-computed eligible counts (from slab logic) over raw attendance counts
  // Raw week_off_days/holiday_days may be 0 if not populated in attendance_daily_record
  const eligibleWeekoffs = Number(line.eligible_weekoff_days ?? 0);
  const eligibleHolidays = Number(line.eligible_holiday_days ?? 0);
  if (eligibleWeekoffs > 0 || Number(summary.week_off_days) === 0) {
    summary.week_off_days = eligibleWeekoffs;
  }
  if (eligibleHolidays > 0 || Number(summary.holiday_days) === 0) {
    summary.holiday_days = eligibleHolidays;
  }
  summary.paid_working_days = Number(line.paid_working_days ?? 0);
  summary.final_payable_days = Number(line.final_payable_days ?? 0);
  summary.active_calendar_days = Number(line.active_calendar_days ?? 0);

  return res.json({ success: true, data: summary });
}));
router.post("/runs",
  payrollRunLimiter,
  requireRole("admin", "super_admin", "finance", "payroll"),
  requireScopedRole(["finance", "payroll"], async (req) => ({
    branchId: req.body.branch_id,
    processId: req.body.process_id,
    departmentId: req.body.department_id
  })),
  h(c.createRun)
);
router.get("/runs/:id", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(c.getRun));
router.get("/runs/:id/readiness", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(async (req, res) => {
  const data = await payrollGovernanceService.readiness(req.params.id);
  return res.json({ success: true, data });
}));

// payroll_head/finance_head added 2026-08-25: Payroll Validation Screen's Freeze Attendance
// button is built for payroll_head specifically, and this route excluded them, so the button
// 403'd for the exact role the page is designed around.
router.post("/runs/:id/freeze-attendance", requireRole("admin", "super_admin", "finance", "payroll", "payroll_head", "finance_head"), h(async (req, res) => {
  await assertRunEditable(req.params.id);
  const actorId = req.authUser?.id ?? "system";
  const data = await payrollGovernanceService.freezeAttendance(req.params.id, actorId);

  void logSensitiveAction({
    actor_user_id: actorId,
    action_type: "PAYROLL_ATTENDANCE_FROZEN",
    module_key: "payroll",
    entity_type: "salary_prep_run",
    entity_id: req.params.id,
    change_summary: data,
    req,
  });

  return res.json({ success: true, data, message: "Attendance frozen for payroll run" });
}));

// finance_head/payroll_head added 2026-08-19, caught by an independent QA re-audit: the
// service-level head-role check inside updateRunStatus() for locked/disbursed (and the Lock
// Run button's own frontend gate, src/pages/Payroll.tsx) already expected these two roles —
// but this route-level requireRole() never included them, so the one live user holding
// finance_head/payroll_head (and none of admin/super_admin/finance/payroll) got a 403 here
// before that correctly-built service check ever ran. Widening this list doesn't change what
// updateRunStatus() itself allows any of these roles to do — its own internal checks (head-role
// gate on locked/disbursed, finance sign-off, PT-block safety, self-approval block) are the
// real authorization boundary and are unchanged by this route-level fix.
router.patch("/runs/:id/status", requireRole("admin", "super_admin", "finance", "payroll", "finance_head", "payroll_head"), h(c.updateRunStatus));
router.get("/runs/:id/lines", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(c.listLines));

// Action-level capabilities for current user
router.get("/capabilities", requireAuth, h(async (req: AuthenticatedRequest, res: Response) => {
  const role = req.authUser?.role ?? "";
  const adminRoles = new Set(["admin", "super_admin", "finance", "payroll"]);
  const hrRoles = new Set(["admin", "super_admin", "hr", "finance", "payroll"]);
  res.json({
    success: true,
    data: {
      canViewPayroll: hrRoles.has(role),
      canEditLine: adminRoles.has(role),
      canChangeStatus: adminRoles.has(role),
      canApprove: role === "super_admin" || role === "finance",
      canDisburse: role === "super_admin" || role === "finance",
      canExport: hrRoles.has(role),
      canManageStructures: adminRoles.has(role),
    },
  });
}));

// E1.1: Branch breakdown for payroll dashboard
router.get("/runs/:id/branch-breakdown", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const runId = req.params.id;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COALESCE(bm.branch_name, 'Unassigned') AS branch_name,
       COUNT(DISTINCT spl.employee_id) AS employee_count,
       COALESCE(SUM(spl.gross_salary), 0) AS total_gross,
       COALESCE(SUM(spl.net_salary), 0) AS total_net
     FROM salary_prep_line spl
     LEFT JOIN employees e ON e.id = spl.employee_id
     LEFT JOIN branch_master bm ON bm.id = e.branch_id
     WHERE spl.run_id = ?
     GROUP BY e.branch_id, bm.branch_name
     ORDER BY bm.branch_name ASC`,
    [runId]
  );
  return res.json({ success: true, data: rows ?? [] });
}));

router.post("/runs/:id/calculate", payrollRunLimiter, requireRole("admin", "super_admin", "finance", "payroll"), async (req: any, res: any, next: any) => {
  try {
    await assertRunEditable(req.params.id);
    const actorId = req.authUser?.id ?? "system";
    // Readiness gate: always enforced in production; skippable only in non-production with explicit flag.
    const skipReadiness = process.env.PAYROLL_SKIP_READINESS === "true" && process.env.NODE_ENV !== "production";
    if (!skipReadiness) {
      const readiness = await payrollGovernanceService.readiness(req.params.id);

      if (!readiness.canCalculate || !readiness.attendanceSnapshotLocked) {
        return res.status(409).json({
          success: false,
          message: "Payroll readiness check failed. Resolve blockers and freeze attendance before calculation.",
          data: readiness,
        });
      }
    }

    // B6 gate: warn if incentives were already applied to this run
    const forceRecalc = req.body?.force === true || req.query?.force === "true";
    if (!forceRecalc) {
      const [incCheck] = await db.execute<RowDataPacket[]>(
        `SELECT incentives_applied_at FROM salary_prep_run WHERE id = ? LIMIT 1`,
        [req.params.id]
      );
      const appliedAt = (incCheck as RowDataPacket[])[0]?.incentives_applied_at;
      if (appliedAt) {
        return res.status(409).json({
          success: false,
          message: "Incentives were applied to this run. Recalculating will wipe them. Pass force=true to confirm, then re-apply incentives after.",
          data: { incentives_applied_at: appliedAt },
        });
      }
    }

    // Root-caused 2026-08-14: 'approved' is deliberately not a closed status
    // (run-status.ts) — recalculation was reachable on an approved, finance
    // -signed, CEO-acknowledged or Head-Payroll-validated run with no warning,
    // silently reverting status to 'processing' and leaving those signatures
    // dated against figures the recalculation had since changed (the engine
    // now clears the stamps when that happens — see payrollCalculate.service.ts
    // — but this gate stops it happening by accident in the first place).
    if (!forceRecalc) {
      const [approvalCheck] = await db.execute<RowDataPacket[]>(
        `SELECT status, finance_approved_at, ceo_acknowledged_at, validation_status
           FROM salary_prep_run WHERE id = ? LIMIT 1`,
        [req.params.id]
      );
      const runRow = (approvalCheck as RowDataPacket[])[0];
      const approvalMarkers: string[] = [];
      if (String(runRow?.status ?? "").toLowerCase() === "approved") approvalMarkers.push("status=approved");
      if (runRow?.finance_approved_at) approvalMarkers.push("finance-approved");
      if (runRow?.ceo_acknowledged_at) approvalMarkers.push("CEO-acknowledged");
      if (runRow?.validation_status === "validated") approvalMarkers.push("Head-Payroll-validated");
      if (approvalMarkers.length > 0) {
        return res.status(409).json({
          success: false,
          message: `This run is already ${approvalMarkers.join(", ")}. Recalculating will change its figures and clear every one of those signatures, since a signature must never describe numbers other than the ones it was actually given for. Pass force=true to confirm and re-collect sign-off afterward.`,
          data: { approvalMarkers },
        });
      }
    }

    const result = await calculatePayrollRun(req.params.id, actorId);
    void logSensitiveAction({
      actor_user_id: actorId,
      action_type: "PAYROLL_RUN_CALCULATED",
      module_key: "payroll",
      entity_type: "salary_prep_run",
      entity_id: req.params.id,
      change_summary: { run_id: req.params.id },
      req,
    });
    return res.json({ success: true, data: result, message: "Payroll calculated" });
  } catch (err) { next(err); }
});

// ─── Bulk Week-Off Correction ────────────────────────────────────────────────
// POST /api/payroll/runs/:id/correct-weekoffs
// Re-runs full payroll calculation (scoped to all employees) for the given run
// using the fixed calendar-Sunday-based weekoff eligibility logic.
// Only allowed on non-locked, non-disbursed runs.
router.post("/runs/:id/correct-weekoffs", payrollRunLimiter, requireRole("admin", "super_admin", "finance", "payroll"), async (req: any, res: any, next: any) => {
  try {
    await assertRunEditable(req.params.id);
    const actorId = req.authUser?.id ?? "system";

    // Same gate as POST /runs/:id/calculate immediately above, and for the identical reason:
    // this endpoint also calls into the recalculation path (calculatePayrollRunScoped), which
    // clears finance/CEO/Head-Payroll sign-off stamps unconditionally when it changes figures
    // (payrollCalculate.service.ts) — that clearing is correct and already shared, but doing it
    // with no confirmation is not. Verified live 2026-08-14: this route had none of the two
    // guards the sibling /calculate route was just given, so an approved/signed-off run's
    // week-off correction proceeded silently instead of requiring force=true like recalculation
    // does everywhere else.
    const forceRecalc = req.body?.force === true || req.query?.force === "true";
    if (!forceRecalc) {
      const [approvalCheck] = await db.execute<RowDataPacket[]>(
        `SELECT status, finance_approved_at, ceo_acknowledged_at, validation_status, incentives_applied_at
           FROM salary_prep_run WHERE id = ? LIMIT 1`,
        [req.params.id]
      );
      const runRow = (approvalCheck as RowDataPacket[])[0];
      const approvalMarkers: string[] = [];
      if (String(runRow?.status ?? "").toLowerCase() === "approved") approvalMarkers.push("status=approved");
      if (runRow?.finance_approved_at) approvalMarkers.push("finance-approved");
      if (runRow?.ceo_acknowledged_at) approvalMarkers.push("CEO-acknowledged");
      if (runRow?.validation_status === "validated") approvalMarkers.push("Head-Payroll-validated");
      if (runRow?.incentives_applied_at) approvalMarkers.push("incentives-applied");
      if (approvalMarkers.length > 0) {
        return res.status(409).json({
          success: false,
          message: `This run is already ${approvalMarkers.join(", ")}. Applying the week-off correction will change its figures and clear every one of those signatures, since a signature must never describe numbers other than the ones it was actually given for. Pass force=true to confirm and re-collect sign-off afterward.`,
          data: { approvalMarkers },
        });
      }
    }

    // Fetch all employee_ids in this run so we can scope the recalc and report count
    const [lineRows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT employee_id FROM salary_prep_line WHERE run_id = ?`,
      [req.params.id]
    );
    const employeeIds = (lineRows as Array<{ employee_id: string }>).map((r) => r.employee_id);
    if (employeeIds.length === 0) {
      return res.status(404).json({ success: false, message: "No employees found in this payroll run." });
    }

    const result = await calculatePayrollRunScoped(req.params.id, actorId, { employeeIds });

    void logSensitiveAction({
      actor_user_id: actorId,
      action_type: "PAYROLL_WEEKOFF_BULK_CORRECTION",
      module_key: "payroll",
      entity_type: "salary_prep_run",
      entity_id: req.params.id,
      change_summary: { run_id: req.params.id, employees_corrected: employeeIds.length },
      req,
    });

    return res.json({
      success: true,
      message: `Week-off correction applied to ${employeeIds.length} employee(s). Recalculation complete.`,
      data: result,
    });
  } catch (err) { next(err); }
});

// ─── Run Lines ────────────────────────────────────────────────────────────────

router.patch("/lines/:id", requireRole("admin", "super_admin", "finance", "payroll"), h(async (req: any, res: any) => {
  // Resolve run_id from line, then check window guard
  const [lineRows] = await db.execute<RowDataPacket[]>(
    `SELECT run_id FROM salary_prep_line WHERE id = ? LIMIT 1`, [req.params.id]
  );
  const runId = (lineRows[0] as any)?.run_id;
  if (runId) await assertRunEditable(runId);
  return c.updateLine(req, res);
}));

// ─── Overtime (WFM-only) ──────────────────────────────────────────────────────

router.patch("/lines/:lineId/overtime",
  requireAuth,
  requireWFMAccess,
  h(async (req: any, res: any) => {
    const [lineRows] = await db.execute<RowDataPacket[]>(
      `SELECT run_id FROM salary_prep_line WHERE id = ? LIMIT 1`, [req.params.lineId]
    );
    const runId = (lineRows[0] as any)?.run_id;
    if (runId) await assertRunEditable(runId);
    return c.updateOvertime(req, res);
  })
);

// ─── Advances ─────────────────────────────────────────────────────────────────

router.post("/advances",
  requireRole("admin", "hr", "super_admin", "finance", "payroll"),
  requireScopedRole(["hr", "finance", "payroll"], async (req) => {
    // Resolve employee's branch/process
    const [rows] = await db.execute(
      'SELECT branch_id, process_id, department_id FROM employees WHERE id = ? LIMIT 1',
      [req.body.employee_id]
    ) as any[];
    const emp = rows[0];
    return {
      branchId: emp?.branch_id,
      processId: emp?.process_id,
      departmentId: emp?.department_id
    };
  }),
  h(c.createAdvance)
);
router.get("/advances/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const isPayrollRole = await hasRole(req.authUser!.id, "admin", "hr", "finance", "payroll");
  if (!isPayrollRole) {
    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp || callerEmp.id !== req.params.employeeId) {
      return res.status(403).json({ success: false, message: "Forbidden: you may only view your own advances" });
    }
  }
  return c.listAdvances(req as any, res);
}));

// GET /api/payroll/advances — paginated advances list scoped to the caller's branch/process
router.get("/advances",
  requireRole("ceo", "admin", "hr", "super_admin", "finance", "payroll", "payroll_head"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const page  = Math.max(1, Number(req.query.page  ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
    const offset = (page - 1) * limit;

    // super_admin sees everything; everyone else is scoped to their branch/process
    let scoped: { sql: string; params: unknown[] };
    try {
      const isSuperAdmin = await hasRole(req.authUser!.id, "super_admin");
      if (isSuperAdmin) {
        scoped = { sql: "1=1", params: [] };
      } else {
        scoped = await buildScopeWhereClause(
          req.authUser!.id,
          ["admin", "hr", "finance", "payroll", "payroll_head"],
          { branchId: "e.branch_id", processId: "e.process_id" },
          { allowCeoAllRead: true }
        );
      }
    } catch {
      scoped = { sql: "1=0", params: [] };
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      /*
       * salary_advance_log is: id, employee_id, advance_date, amount, recovery_months,
       * recovered_amount, status, notes, created_at, legacy_loan_id, loan_type.
       *
       * This query asked for advance_amount, recovery_month, approved_by, approved_at and
       * rejection_reason. The first two are just the wrong spelling of amount and
       * recovery_months; the last three do not exist in any form, so listing salary advances
       * raised ER_BAD_FIELD_ERROR and the page behind it has never shown a row.
       *
       * The three approval columns are selected as NULL rather than dropped, so the response
       * keeps the shape its client already reads. Recording an approver and a rejection reason
       * against the row needs those columns added by an additive migration - flagged, not done
       * here, because it is a schema change to a shared database. Nothing is lost meanwhile: the
       * approve and reject routes below both write to the sensitive-action audit log, and the
       * reject route already passes the reason there.
       */
      `SELECT sal.id, sal.employee_id,
              sal.amount,
              sal.advance_date,
              sal.status,
              NULL AS approved_by, NULL AS approved_at, NULL AS rejection_reason,
              sal.recovery_months,
              sal.notes AS purpose,
              sal.created_at,
              e.employee_code,
              CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name
         FROM salary_advance_log sal
         JOIN employees e ON e.id = sal.employee_id
        WHERE ${scoped.sql}
        ORDER BY sal.advance_date DESC
        ${sqlLimitOffset(limit, offset)}`,
      scoped.params
    );

    const [[countRow]] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
         FROM salary_advance_log sal
         JOIN employees e ON e.id = sal.employee_id
        WHERE ${scoped.sql}`,
      scoped.params
    );

    res.json({ success: true, data: rows, total: Number((countRow as any).total), page, limit });
  })
);

// PATCH /api/payroll/advances/:id/approve
router.patch("/advances/:id/approve",
  requireRole("admin", "super_admin", "finance", "payroll", "payroll_head"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    await db.execute(
      // approved_by / approved_at do not exist on this table, so this UPDATE threw and no advance
      // could ever be approved. Who approved it and when is recorded by logSensitiveAction below,
      // which is where the rest of payroll's approvals are audited anyway.
      `UPDATE salary_advance_log SET status = 'approved' WHERE id = ?`,
      [id]
    );
    await logSensitiveAction({ actor_user_id: req.authUser!.id, action_type: "advance_approved", module_key: "payroll", entity_type: "salary_advance_log", entity_id: id });
    res.json({ success: true, message: "Advance approved" });
  })
);

// PATCH /api/payroll/advances/:id/reject
router.patch("/advances/:id/reject",
  requireRole("admin", "super_admin", "finance", "payroll", "payroll_head"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { reason } = req.body;
    await db.execute(
      // Same three missing columns as the approve route. The reason is not dropped - it is passed
      // to logSensitiveAction below as metadata - and notes is deliberately left alone rather than
      // overwritten, because it holds the employee's stated purpose for the advance.
      `UPDATE salary_advance_log SET status = 'rejected' WHERE id = ?`,
      [id]
    );
    await logSensitiveAction({ actor_user_id: req.authUser!.id, action_type: "advance_rejected", module_key: "payroll", entity_type: "salary_advance_log", entity_id: id, metadata: { reason } });
    res.json({ success: true, message: "Advance rejected" });
  })
);

// ─── Statutory Config ─────────────────────────────────────────────────────────

router.get("/statutory-config", requireRole("admin", "super_admin", "finance", "payroll"), h(c.getStatutoryConfig));

// ─── Payslip ──────────────────────────────────────────────────────────────────

// GET /api/payroll/payslip/my — list own payslip history (employee self-service)
router.get("/payslip/my", h(async (req: AuthenticatedRequest, res: Response) => {
  const callerEmp = await getEmployeeForUser(req.authUser!.id);
  if (!callerEmp) return res.status(403).json({ success: false, message: "No employee record for authenticated user" });

  const year = req.query.year ? String(req.query.year) : String(new Date().getFullYear());
  const numericYear = Number(year);
  if (!/^\d{4}$/.test(year) || numericYear < 2000 || numericYear > new Date().getFullYear() + 1) {
    return res.status(400).json({ success: false, message: "Invalid payslip year" });
  }

  // Fetch main payroll lines with employee profile data + disbursal payment info
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT spl.id, spl.run_id, spl.employee_id, spl.employee_code,
            spl.gross_salary, spl.total_deductions, spl.net_salary,
            spl.basic, spl.hra, spl.special_allowance,
            spl.incentive_total, spl.other_deductions,
            spl.pf_employee, spl.esic_employee, spl.professional_tax, spl.tds,
            spl.lwp_deduction, spl.advance_recovery,
            spl.pf_employer, spl.esic_employer,
            spl.working_days, spl.present_days, spl.leave_days, spl.lwp_days,
            spl.paid_working_days, spl.eligible_weekoff_days, spl.eligible_holiday_days,
            spl.final_payable_days, spl.active_calendar_days,
            spl.status, spl.remarks,
            spr.run_month, spr.disbursed_at AS paid_at, spr.status AS run_status,
            sp.acknowledged_at, sp.file_url, sp.payslip_ref,
            e.first_name, e.last_name,
            COALESCE(eu.uan, eu.member_id, e.epf_number) AS epf_number,
            eu.uan AS uan_number,
            e.pan_number, e.pan_number_encrypted,
            e.esic_number AS esi_number,
            CASE WHEN e.bank_account_number IS NOT NULL
              THEN CONCAT('XXXX', RIGHT(e.bank_account_number, 4))
              ELSE NULL END AS bank_account_masked,
            des.designation_name,
            dept.dept_name,
            br.branch_name,
            loc.location_name,
            srd.cheque_no,
            srd.payment_mode,
            srd.payment_date
       FROM salary_prep_line spl
       JOIN salary_prep_run spr ON spr.id = spl.run_id
       LEFT JOIN salary_payslip sp ON sp.prep_line_id = spl.id
       LEFT JOIN employees e ON e.id = spl.employee_id
       LEFT JOIN employee_uan eu ON eu.employee_id = e.id AND eu.is_active = 1
       LEFT JOIN designation_master des ON des.id = e.designation_id
       LEFT JOIN department_master dept ON dept.id = e.department_id
       LEFT JOIN branch_master br ON br.id = e.branch_id
       LEFT JOIN location_master loc
         ON loc.id COLLATE utf8mb4_unicode_ci = e.location_id
       LEFT JOIN salary_run_disbursal srd
         ON srd.run_id = spl.run_id
        AND srd.employee_id = spl.employee_id
      WHERE spl.employee_id = ?
        AND spr.run_month LIKE ?
        AND spl.status NOT IN ('excluded', 'blocked')
        -- All pre-Aug 2026 runs are legacy-migrated and confirmed closed (status = 'finalized').
        -- Aug 2026+ runs follow the live workflow (draft → approved → disbursed).
        -- Deny-list on CANCELLED only so every finalized/approved/disbursed run is visible.
        AND LOWER(spr.status) NOT IN ('cancelled', 'rejected')
      ORDER BY
        spr.run_month DESC,
        ${runRankSql("spr")}`,
    [callerEmp.id, `${year}-%`]
  );

  // For each line, fetch detailed component breakdown
  for (const line of rows as any[]) {
    // PAN was serialized straight from the plaintext column; employees also carries
    // pan_number_encrypted for exactly this read. Prefer ciphertext, fall back to
    // plaintext (resolvePii already handles both, and never throws on a read path).
    line.pan_number = resolvePii(line.pan_number_encrypted, line.pan_number).value;
    delete line.pan_number_encrypted;

    const [components] = await db.execute<RowDataPacket[]>(
      `SELECT component_code, component_name, component_type, amount, taxable
       FROM salary_prep_line_component
       WHERE line_id = ?
       ORDER BY
         CASE component_type
           WHEN 'earning' THEN 1
           WHEN 'deduction' THEN 2
           ELSE 3
         END,
         component_code`,
      [line.id]
    );

    // Split components by type
    line.earnings = (components as any[]).filter(c => c.component_type === 'earning');
    line.deductions = (components as any[]).filter(c => c.component_type === 'deduction');
    line.employer_costs = (components as any[]).filter(c => c.component_type === 'employer_cost');

    // If basic/hra/special_allowance columns are NULL, populate from components
    if (!line.basic) {
      const basicComp = line.earnings.find((e: any) => e.component_code === 'BASIC');
      line.basic = basicComp ? Number(basicComp.amount) : 0;
    }
    if (!line.hra) {
      const hraComp = line.earnings.find((e: any) => e.component_code === 'HRA');
      line.hra = hraComp ? Number(hraComp.amount) : 0;
    }
    if (!line.special_allowance) {
      const specialComp = line.earnings.find((e: any) => e.component_code === 'SPECIAL');
      line.special_allowance = specialComp ? Number(specialComp.amount) : 0;
    }
  }

  await logSensitiveAction({
    actor_user_id: req.authUser!.id,
    action_type: "PAYSLIP_HISTORY_VIEWED",
    module_key: "payroll",
    entity_type: "employee",
    entity_id: callerEmp.id,
    change_summary: { year, statement_count: rows.length },
    req,
  });

  // Merge legacy payslips for months NOT already covered by salary_prep_line
  const coveredMonths = new Set((rows as any[]).map((r: any) => String(r.run_month || '').substring(0, 7)));
  const [legacyRows] = await db.execute<RowDataPacket[]>(
    `SELECT lps.id AS legacy_id, lps.employee_code, lps.pay_month AS run_month,
            lps.sal_date, lps.gross_salary, lps.gross_earned, lps.total_deductions,
            lps.net_salary, lps.basic, lps.hra, lps.special_allowance, lps.conveyance,
            lps.portfolio, lps.medical_allowance, lps.lta, lps.other_allowance,
            lps.bonus, lps.incentive, lps.arrear, lps.pli, lps.extra_day,
            lps.epf_employee, lps.esic_employee, lps.professional_tax, lps.income_tax,
            lps.advance_paid, lps.loan_deduction, lps.other_deduction,
            lps.short_collection, lps.asset_recovery, lps.leave_deduction,
            lps.epf_employer, lps.esic_employer, lps.admin_charges,
            lps.ctc_monthly, lps.ctc_offered, lps.working_days, lps.earned_days,
            lps.leave_days, lps.epf_number, lps.esic_number, lps.salary_payment_mode,
            lps.cheque_number, lps.is_fnf, lps.status AS db_bill_status,
            NULL AS acknowledged_at, NULL AS file_url, NULL AS run_id,
            NULL AS run_status, NULL AS paid_at, NULL AS payslip_ref,
            'legacy' AS source
     FROM legacy_payslip_snapshot lps
     WHERE lps.employee_id = ?
       AND lps.pay_month LIKE ?
     ORDER BY lps.pay_month DESC`,
    [callerEmp.id, `${year}-%`]
  );

  // Only include legacy rows for months not in current HRMS run data
  const legacyFiltered = (legacyRows as any[]).filter(r => !coveredMonths.has(r.run_month));

  // Tag rows: Aug 2026+ is the first live HRMS payroll run; everything before is migrated legacy.
  for (const r of rows as any[]) {
    r.source = String(r.run_month ?? "").slice(0, 7) < "2026-08" ? "legacy" : "hrms";
    r.is_draft = r.run_status === 'draft' || r.run_status === 'processing';
  }

  const combined = [...(rows as any[]), ...legacyFiltered].sort((a, b) =>
    String(b.run_month).localeCompare(String(a.run_month))
  );

  return res.json({ success: true, data: combined });
}));

// GET /api/payroll/verify/payslip/:empCode/:monthYear — moved to payroll.public.routes.ts.
// It must stay off this router: `router.use(requireAuth)` above gates every route
// registered here, so the payslip QR scan was answered with 401 instead of a verdict.

// GET /api/payroll/payslip/list/:employeeId — paginated payslip history for one employee (admin/HR view)
//
// requireRole alone checked role membership only, never branch/process scope, so a
// branch-scoped hr/finance/payroll user could read any employee's payslip figures
// org-wide by supplying a different :employeeId. 'ceo' also removed here: 31-Jul-2026
// removed CEO from org-wide payroll visibility on /runs and /records (see
// payroll.secure.routes.ts) specifically because "the CEO sees their own payslip, not
// the organisation's payroll" — this route granted the exact access that fix closed.
router.get("/payslip/list/:employeeId", requireAuth, requireRole("super_admin", "admin", "hr", "finance", "payroll"),
  requireScopedRole(["hr", "finance", "payroll"], resolveEmployeeIdParamScope),
  h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeId } = req.params;
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 12)));
  const offset = (page - 1) * limit;
  // `payroll_employee` and `payroll_run` do not exist. Neither query was
  // error-wrapped, so this endpoint returned a 500 to every caller — admin, HR,
  // finance, payroll and CEO alike — for as long as it has been mounted.
  //
  // The real tables are salary_prep_line (80,338 rows) and salary_prep_run (66),
  // which is what the /payslip/history endpoint immediately below already uses
  // successfully. Column names are aliased so the response shape is unchanged.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT spl.run_id            AS run_id,
            spr.run_month         AS run_label,
            spr.run_month         AS period_label,
            spr.disbursed_at      AS pay_date,
            spl.net_salary        AS net_pay,
            spl.gross_salary      AS gross_pay,
            spl.total_deductions  AS total_deductions,
            spl.status            AS status
       FROM salary_prep_line spl
       JOIN salary_prep_run spr ON spr.id = spl.run_id
      WHERE spl.employee_id = ?
        AND spr.status NOT IN ('draft', 'cancelled')
      ORDER BY spr.run_month DESC
      LIMIT ${limit} OFFSET ${offset}`,
    [employeeId],
  );
  const [[countRow]] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total
       FROM salary_prep_line spl
       JOIN salary_prep_run spr ON spr.id = spl.run_id
      WHERE spl.employee_id = ?
        AND spr.status NOT IN ('draft', 'cancelled')`,
    [employeeId],
  );
  return res.json({ success: true, data: rows, total: Number(countRow.total), page, limit });
}));

// GET /api/payroll/payslip/history/:employeeId — HR/admin view of any employee's payslip list
router.get("/payslip/history/:employeeId", requireAuth, requireRole("super_admin", "admin", "hr", "payroll_head", "payroll_admin", "finance", "payroll"),
  requireScopedRole(["hr", "payroll_head", "payroll_admin", "finance", "payroll"], resolveEmployeeIdParamScope),
  h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeId } = req.params;
  const requestedLimit = Number(req.query.limit ?? 24);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(50, Math.max(1, Math.trunc(requestedLimit)))
    : 24;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT spl.run_id, spl.gross_salary, spl.total_deductions, spl.net_salary,
            spl.status, spr.disbursed_at AS paid_at, spr.status AS run_status, spr.run_month
       FROM salary_prep_line spl
       JOIN salary_prep_run spr ON spr.id = spl.run_id
      WHERE spl.employee_id = ?
        AND spr.status NOT IN ('draft', 'cancelled')
      ORDER BY spr.run_month DESC,
               -- 'finalized' omitted from this ranking previously made MySQL's FIELD()
               -- (0 for unranked values) sort FINALIZED runs ahead of everything else.
               FIELD(spr.status,'disbursed','finalized','approved','locked','under_review','calculated','processing') ASC
      LIMIT ${limit * 3}`,
    [employeeId]
  );
  // Deduplicate: keep the most-advanced-status row per run_month
  const seenMonths = new Set<string>();
  const deduped = (rows as RowDataPacket[]).filter(r => {
    const key = String(r.run_month).substring(0, 7);
    if (seenMonths.has(key)) return false;
    seenMonths.add(key);
    return true;
  }).slice(0, limit);
  return res.json({ success: true, data: deduped });
}));

// GET /api/payroll/payslip/legacy/:employeeId — list legacy payslips (HR/admin/payroll)
// 'ceo' removed — see the note on /payslip/list/:employeeId above.
router.get("/payslip/legacy/:employeeId", requireAuth, requireRole("super_admin", "admin", "hr", "finance", "payroll"),
  requireScopedRole(["hr", "finance", "payroll"], resolveEmployeeIdParamScope),
  h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeId } = req.params;
  const year = req.query.year ? String(req.query.year) : null;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id AS legacy_id, employee_code, pay_month AS run_month, sal_date,
            gross_salary, gross_earned, total_deductions, net_salary,
            basic, hra, special_allowance, conveyance, portfolio,
            medical_allowance, lta, other_allowance, bonus, incentive,
            arrear, pli, extra_day,
            epf_employee, esic_employee, professional_tax, income_tax,
            advance_paid, loan_deduction, other_deduction, short_collection,
            asset_recovery, leave_deduction, epf_employer, esic_employer,
            admin_charges, ctc_monthly, ctc_offered,
            working_days, earned_days, leave_days,
            epf_number, esic_number, salary_payment_mode, cheque_number,
            is_fnf, status AS db_bill_status, db_bill_id, snapshot_taken_at,
            'legacy' AS source
       FROM legacy_payslip_snapshot
      WHERE employee_id = ?
        ${year ? "AND pay_month LIKE ?" : ""}
      ORDER BY pay_month DESC
      LIMIT 120`,
    year ? [employeeId, `${year}-%`] : [employeeId]
  );
  return res.json({ success: true, data: rows });
}));

// GET /api/payroll/payslip/legacy-detail/:employeeCode/:payMonth — single legacy payslip detail
router.get("/payslip/legacy-detail/:employeeCode/:payMonth", requireAuth, h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeCode, payMonth } = req.params;

  // Employees can only view their own; HR+ can view any within their branch/process scope.
  // 'ceo' removed — see the note on /payslip/list/:employeeId above.
  const callerEmp = await getEmployeeForUser(req.authUser!.id);
  const isSelf = Boolean(callerEmp && callerEmp.employee_code === employeeCode);
  if (!isSelf) {
    const isHR = hasAnyRole(req, ["super_admin", "admin", "hr", "finance", "payroll"]);
    if (!isHR) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const [targetRows] = await db.execute<RowDataPacket[]>(
      "SELECT id, branch_id, process_id, department_id FROM employees WHERE employee_code = ? LIMIT 1",
      [employeeCode]
    );
    const target = (targetRows as RowDataPacket[])[0] as { id: string; branch_id: string | null; process_id: string | null; department_id: string | null } | undefined;
    const scoped = target && await hasScopedAccess(req.authUser!.id, ["hr", "finance", "payroll"], {
      branchId: target.branch_id, processId: target.process_id, departmentId: target.department_id, employeeId: target.id,
    });
    if (!scoped) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT lps.*,
            e.first_name, e.last_name,
            e.pan_number, e.pan_number_encrypted,
            CASE WHEN e.bank_account_number IS NOT NULL
              THEN CONCAT('XXXX', RIGHT(e.bank_account_number, 4))
              ELSE NULL END AS bank_account_masked,
            d.designation_name,
            dept.dept_name,
            br.branch_name
       FROM legacy_payslip_snapshot lps
       LEFT JOIN employees e ON e.employee_code = lps.employee_code
       LEFT JOIN designation_master d ON d.id = e.designation_id
       LEFT JOIN department_master dept ON dept.id = e.department_id
       LEFT JOIN branch_master br ON br.id = e.branch_id
      WHERE lps.employee_code = ? AND lps.pay_month = ?
      LIMIT 1`,
    [employeeCode, payMonth]
  );
  if (!(rows as any[]).length) {
    return res.status(404).json({ success: false, message: "Legacy payslip not found" });
  }
  const legacyRow = (rows as any[])[0];
  legacyRow.pan_number = resolvePii(legacyRow.pan_number_encrypted, legacyRow.pan_number).value;
  delete legacyRow.pan_number_encrypted;
  return res.json({ success: true, data: legacyRow });
}));

// GET /api/payroll/payslip/:runId/:employeeId — admin/hr/finance/payroll or employee own
// MUST be registered after all static /payslip/<literal>/... routes to avoid shadowing them.
router.get("/payslip/:runId/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const { runId, employeeId } = req.params;

  const callerEmp = await getEmployeeForUser(req.authUser!.id);
  const isSelf = Boolean(callerEmp && callerEmp.id === employeeId);
  if (!isSelf) {
    // hasRole() auto-bypasses admin as well as super_admin, but a role check alone let
    // a branch-scoped hr/finance/payroll user pull any employee's payslip org-wide.
    // hasScopedAccess applies the same branch/process rule the rest of this module
    // enforces on /runs, /records and the sibling payslip routes above.
    const isPayrollRole = await hasRole(req.authUser!.id, "admin", "hr", "finance", "payroll", "payroll_head", "payroll_admin");
    if (!isPayrollRole) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const [targetRows] = await db.execute<RowDataPacket[]>(
      "SELECT branch_id, process_id, department_id FROM employees WHERE id = ? LIMIT 1",
      [employeeId]
    );
    const target = (targetRows as RowDataPacket[])[0] as { branch_id: string | null; process_id: string | null; department_id: string | null } | undefined;
    const scoped = await hasScopedAccess(req.authUser!.id, ["hr", "finance", "payroll", "payroll_head", "payroll_admin"], {
      branchId: target?.branch_id ?? null, processId: target?.process_id ?? null, departmentId: target?.department_id ?? null, employeeId,
    });
    if (!scoped) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
  }

  const raw = await payslipService.getPayslip(employeeId, runId);
  // Parse run_month (YYYY-MM) into numeric month/year for frontend
  const [runYear, runMon] = (raw.run_month ?? '').split('-').map(Number);
  const data = { ...raw, month: runMon || 0, year: runYear || 0 };
  return res.json({ success: true, data });
}));

// POST /api/payroll/payslip/:runId/generate — admin/hr/finance/payroll only
router.post(
  "/payslip/:runId/generate",
  requireRole("admin", "hr", "super_admin", "finance", "payroll"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { employeeId } = req.body as { employeeId?: string };
    if (!employeeId) {
      return res.status(400).json({ success: false, message: "employeeId is required" });
    }

    const data = await payslipService.generatePayslip(req.params.runId, employeeId, req.authUser!.id, req);
    return res.status(201).json({ success: true, data, message: "Payslip generated" });
  })
);

// POST /api/payroll/payslip/:payslipId/acknowledge — employee self (server-mapped)
router.post("/payslip/:payslipId/acknowledge", h(async (req: AuthenticatedRequest, res: Response) => {
  const callerEmp = await getEmployeeForUser(req.authUser!.id);
  if (!callerEmp) {
    return res.status(403).json({ success: false, message: "No employee record" });
  }
  const data = await payslipService.acknowledgePayslip(req.params.payslipId, callerEmp.id);
  return res.json({ success: true, data, message: "Payslip acknowledged" });
}));

// ─── Tax Declaration ──────────────────────────────────────────────────────────

// GET /api/payroll/tax-declaration/:employeeId/:year — admin/hr/finance/payroll or employee own
router.get("/tax-declaration/:employeeId/:year", h(async (req: AuthenticatedRequest, res: Response) => {
  let { employeeId } = req.params;
  const { year } = req.params;

  // Resolve "me" alias to the caller's employee ID
  if (employeeId === 'me') {
    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp) return res.status(403).json({ success: false, message: 'No employee record for authenticated user' });
    employeeId = callerEmp.id;
  }

  const isPayrollRole = await hasRole(req.authUser!.id, "admin", "hr", "finance", "payroll");
  if (!isPayrollRole) {
    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp || callerEmp.id !== employeeId) {
      return res.status(403).json({ success: false, message: "Forbidden: you may only view your own tax declaration" });
    }
  }

  const [data, history] = await Promise.all([
    taxDeclarationService.find(employeeId, year),
    taxDeclarationService.listHistory(employeeId),
  ]);
  return res.json({ success: true, data, history });
}));

// POST /api/payroll/tax-declaration/:employeeId/:year — admin/hr/finance/payroll or employee own
router.post("/tax-declaration/:employeeId/:year", h(async (req: AuthenticatedRequest, res: Response) => {
  let { employeeId } = req.params;
  const { year } = req.params;

  // Resolve "me" alias to the caller's employee ID
  if (employeeId === 'me') {
    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp) return res.status(403).json({ success: false, message: 'No employee record' });
    employeeId = callerEmp.id;
  }

  const isPayrollRole = await hasRole(req.authUser!.id, "admin", "hr", "finance", "payroll");
  if (!isPayrollRole) {
    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp || callerEmp.id !== employeeId) {
      return res.status(403).json({ success: false, message: "Forbidden: you may only submit your own tax declaration" });
    }
    const data = await taxDeclarationService.upsert(callerEmp.id, year, req.body, req.authUser!.id);
    return res.json({ success: true, data, message: "Tax declaration saved" });
  }

  const data = await taxDeclarationService.upsert(employeeId, year, req.body, req.authUser!.id);
  return res.json({ success: true, data, message: "Tax declaration saved" });
}));

// POST /api/payroll/tax-declaration/:employeeId/:year/document — upload tax proof document
const taxDocUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(UPLOADS_ROOT, "tax-documents");
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`File type ${ext} not allowed for tax documents`));
  },
});

router.post("/tax-declaration/:employeeId/:year/document", (req: any, res: any, next: any) => {
  taxDocUpload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
    if (err) return res.status(400).json({ success: false, message: err.message });
    next();
  });
}, h(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

  let { employeeId } = req.params;
  const { year } = req.params;
  const isPayrollRole = await hasRole(req.authUser!.id, "admin", "hr", "finance", "payroll");
  const callerEmp = employeeId === "me" || !isPayrollRole
    ? await getEmployeeForUser(req.authUser!.id)
    : null;

  if (employeeId === "me") {
    if (!callerEmp) {
      return res.status(403).json({ success: false, message: "No employee record" });
    }
    employeeId = callerEmp.id;
  } else if (!isPayrollRole) {
    if (!callerEmp || callerEmp.id !== employeeId) {
      return res.status(403).json({ success: false, message: "Forbidden: you may only upload your own tax documents" });
    }
    employeeId = callerEmp.id;
  }

  const documentType = `tax_declaration_${year}`;
  const documentName = (req.body?.document_name as string) || req.file.originalname;
  const fileUrl = `/api/files/tax-documents/${req.file.filename}`;
  const id = randomUUID();

  await db.execute(
    `INSERT INTO employee_documents (id, employee_id, doc_type, doc_category, doc_name, file_url, uploaded_by)
     VALUES (?, ?, ?, 'tax', ?, ?, ?)`,
    [id, employeeId, documentType, documentName, fileUrl, req.authUser!.id]
  );

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_id, 'tax_declaration' AS document_type, doc_name AS document_name, file_url, verified, created_at AS uploaded_at
     FROM employee_documents WHERE id = ? LIMIT 1`,
    [id]
  );

  res.status(201).json({ success: true, data: (rows as RowDataPacket[])[0] });
}));

// GET /api/payroll/tax-declaration/:employeeId/:year/documents — list tax docs for employee+year
router.get("/tax-declaration/:employeeId/:year/documents", h(async (req: AuthenticatedRequest, res: Response) => {
  let { employeeId } = req.params;
  const { year } = req.params;
  const isPayrollRole = await hasRole(req.authUser!.id, "admin", "hr", "finance", "payroll");
  const callerEmp = employeeId === "me" || !isPayrollRole
    ? await getEmployeeForUser(req.authUser!.id)
    : null;

  if (employeeId === "me") {
    if (!callerEmp) {
      return res.status(403).json({ success: false, message: "No employee record" });
    }
    employeeId = callerEmp.id;
  } else if (!isPayrollRole) {
    if (!callerEmp || callerEmp.id !== employeeId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    employeeId = callerEmp.id;
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_id, 'tax_declaration' AS document_type, doc_name AS document_name, file_url, verified, created_at AS uploaded_at
     FROM employee_documents
     WHERE employee_id = ? AND doc_type = ?
     ORDER BY created_at DESC`,
    [employeeId, `tax_declaration_${year}`]
  );

  res.json({ success: true, data: rows });
}));

// PATCH /api/payroll/tax-declaration/:employeeId/:year/verify — HR verify or reject a declaration
router.patch("/tax-declaration/:employeeId/:year/verify", requireRole("admin", "hr", "super_admin", "payroll", "finance"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeId, year } = req.params;
  const { status, review_note } = req.body as { status?: "verified" | "rejected"; review_note?: string };
  const targetStatus = status === "rejected" ? "rejected" : "verified";

  const declaration = await taxDeclarationService.find(employeeId, year);
  if (!declaration) {
    return res.status(404).json({ success: false, message: "Tax declaration not found" });
  }

  await db.execute(
    `UPDATE tax_declaration_form12bb_detail
        SET submission_status = ?, verified_by = ?, verified_at = NOW(), review_note = ?
      WHERE declaration_id = ?`,
    [targetStatus, req.authUser!.id, review_note ?? null, declaration.id]
  );

  void logSensitiveAction({
    actor_user_id: req.authUser!.id,
    action_type: "tax_declaration_verify",
    module_key: "payroll",
    entity_type: "tax_declaration",
    entity_id: declaration.id,
    change_summary: { employee_id: employeeId, financial_year: year, status: targetStatus, review_note },
    req,
  });

  return res.json({ success: true, message: `Declaration ${targetStatus}`, data: { submission_status: targetStatus } });
}));

// DELETE /api/payroll/tax-declaration/:employeeId/:year/document/:docId — delete a tax proof document
router.delete("/tax-declaration/:employeeId/:year/document/:docId", requireRole("admin", "hr", "super_admin", "payroll", "finance"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeId, docId } = req.params;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, file_url FROM employee_documents WHERE id = ? AND employee_id = ? LIMIT 1`,
    [docId, employeeId]
  );
  if (!(rows as RowDataPacket[]).length) {
    return res.status(404).json({ success: false, message: "Document not found" });
  }

  await db.execute(`DELETE FROM employee_documents WHERE id = ?`, [docId]);

  void logSensitiveAction({
    actor_user_id: req.authUser!.id,
    action_type: "tax_document_delete",
    module_key: "payroll",
    entity_type: "employee_documents",
    entity_id: docId,
    change_summary: { employee_id: employeeId },
    req,
  });

  return res.json({ success: true, message: "Document deleted" });
}));

// ─── UAN ─────────────────────────────────────────────────────────────────────

// GET /api/payroll/uan/:employeeId — admin/hr/finance/payroll or self
router.get("/uan/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeId } = req.params;
  const isPrivileged = await hasRole(req.authUser!.id, "admin", "hr", "finance", "payroll");
  if (!isPrivileged) {
    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp || callerEmp.id !== employeeId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM employee_uan WHERE employee_id = ? LIMIT 1",
    [employeeId]
  );
  return res.json({ success: true, data: (rows as RowDataPacket[])[0] ?? null });
}));

// POST /api/payroll/uan/:employeeId — upsert UAN (admin/hr/finance)
router.post("/uan/:employeeId", requireRole("admin", "hr", "finance"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeId } = req.params;
  const { uan, member_id, epf_join_date } = req.body as {
    uan: string;
    member_id?: string;
    epf_join_date?: string;
  };
  if (!uan) return res.status(400).json({ success: false, message: "uan is required" });

  await db.execute(
    `INSERT INTO employee_uan (id, employee_id, uan, member_id, epf_join_date)
       VALUES (UUID(), ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         uan = VALUES(uan),
         member_id = VALUES(member_id),
         epf_join_date = VALUES(epf_join_date),
         updated_at = NOW()`,
    [employeeId, uan, member_id ?? null, epf_join_date ?? null]
  );
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM employee_uan WHERE employee_id = ? LIMIT 1",
    [employeeId]
  );
  return res.status(201).json({ success: true, data: (rows as RowDataPacket[])[0] });
}));

// ─── Disbursements ────────────────────────────────────────────────────────────

// POST /api/payroll/disbursements — record a bank disbursement
router.post(
  "/disbursements",
  requireRole("admin", "super_admin", "finance", "payroll"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { run_id, bank_ref, total_amount, employee_count } = req.body as {
      run_id: string;
      bank_ref?: string;
      total_amount: number;
      employee_count: number;
    };

    if (!run_id || total_amount === undefined || employee_count === undefined) {
      return res.status(400).json({ success: false, message: "run_id, total_amount, employee_count are required" });
    }

    const [runCheck] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM salary_prep_run WHERE id = ? LIMIT 1",
      [run_id]
    );
    if (!(runCheck as RowDataPacket[]).length) {
      return res.status(404).json({ success: false, message: "Payroll run not found" });
    }

    const id = (await import("crypto")).randomUUID();
    const actorId = req.authUser?.id ?? null;
    await db.execute(
      `INSERT INTO payroll_disbursement (id, run_id, bank_ref, total_amount, employee_count, disbursed_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, run_id, bank_ref ?? null, total_amount, employee_count, actorId]
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM payroll_disbursement WHERE id = ? LIMIT 1",
      [id]
    );
    return res.status(201).json({ success: true, data: (rows as RowDataPacket[])[0] });
  })
);

// GET /api/payroll/disbursements/:runId — get disbursement for a run
router.get(
  "/disbursements/:runId",
  requireRole("admin", "super_admin", "finance", "payroll"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM payroll_disbursement WHERE run_id = ? ORDER BY created_at DESC",
      [req.params.runId]
    );
    return res.json({ success: true, data: rows });
  })
);

// PATCH /api/payroll/disbursements/:id — update disbursement status
router.patch(
  "/disbursements/:id",
  requireRole("admin", "super_admin", "finance", "payroll"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { status, disbursed_at } = req.body as {
      status?: "completed" | "failed";
      disbursed_at?: string;
    };

    const allowed = new Set(["completed", "failed"]);
    if (status && !allowed.has(status)) {
      return res.status(400).json({ success: false, message: "status must be 'completed' or 'failed'" });
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    if (status)       { sets.push("status = ?");       params.push(status); }
    if (disbursed_at) { sets.push("disbursed_at = ?"); params.push(disbursed_at); }
    if (sets.length === 0) {
      return res.status(400).json({ success: false, message: "No fields to update" });
    }

    params.push(req.params.id);
    const [result] = await db.execute(
      `UPDATE payroll_disbursement SET ${sets.join(", ")} WHERE id = ?`,
      params
    ) as unknown as [{ affectedRows: number }, unknown];

    if ((result as { affectedRows: number }).affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Disbursement not found" });
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM payroll_disbursement WHERE id = ? LIMIT 1",
      [req.params.id]
    );
    return res.json({ success: true, data: (rows as RowDataPacket[])[0] });
  })
);

// ─── Form 16 Data ─────────────────────────────────────────────────────────────

// GET /api/payroll/form16-data/:runId/:employeeId — Form 16 Part B structured data
router.get(
  "/form16-data/:runId/:employeeId",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { runId, employeeId } = req.params;

    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    const isSelf = Boolean(callerEmp && callerEmp.id === employeeId);
    if (!isSelf) {
      const isPayrollRole = await hasRole(req.authUser!.id, "admin", "hr", "finance", "payroll");
      if (!isPayrollRole) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }
      const [targetRows] = await db.execute<RowDataPacket[]>(
        "SELECT branch_id, process_id, department_id FROM employees WHERE id = ? LIMIT 1",
        [employeeId]
      );
      const target = (targetRows as RowDataPacket[])[0] as { branch_id: string | null; process_id: string | null; department_id: string | null } | undefined;
      const scoped = await hasScopedAccess(req.authUser!.id, ["hr", "finance", "payroll"], {
        branchId: target?.branch_id ?? null, processId: target?.process_id ?? null, departmentId: target?.department_id ?? null, employeeId,
      });
      if (!scoped) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }
    }

    // Load run
    const [runRows] = await db.execute<RowDataPacket[]>(
      "SELECT run_month FROM salary_prep_run WHERE id = ? LIMIT 1",
      [runId]
    );
    const run = (runRows as Array<{ run_month: string }>)[0];
    if (!run) return res.status(404).json({ success: false, message: "Run not found" });

    // Existence guard only. The certificate's figures are summed across the
    // whole financial year below; this just confirms the employee actually
    // belongs to the run the caller named, so an arbitrary runId cannot be used
    // to pull a certificate for someone who was never in it.
    const [lineRows] = await db.execute<RowDataPacket[]>(
      `SELECT 1 AS present
         FROM salary_prep_line spl
        WHERE spl.run_id = ? AND spl.employee_id = ? LIMIT 1`,
      [runId, employeeId]
    );
    if ((lineRows as RowDataPacket[]).length === 0) {
      return res.status(404).json({ success: false, message: "Payroll line not found for employee" });
    }

    // Load employee details
    const [empRows] = await db.execute<RowDataPacket[]>(
      // PAN comes from employees, not employee_documents. employee_documents is the file store —
      // its columns are doc_type, doc_name, file_url and friends, with no pan_number at all — so
      // `ed.pan_number` made this query fail outright:
      //
      //   ER_BAD_FIELD_ERROR: Unknown column 'ed.pan_number' in 'field list'
      //
      // Verified against mas_hrms. This is GET /form16-data/:runId/:employeeId, so Form 16 — a
      // statutory certificate that cannot be issued without a PAN — returned nothing for anyone,
      // employee or payroll. employees.pan_number exists and is populated for 915 of the 1,125
      // active employees; the remaining 210 now render an empty PAN instead of failing the whole
      // request, which is the same treatment every other nullable field here already gets.
      //
      // The employee_documents join went with it: `ed` was referenced for pan_number and nothing
      // else, so it was scanning a 207,616-row table to contribute one column that did not exist.
      `SELECT CONCAT_WS(' ', e.first_name, e.last_name) AS name,
              e.pan_number AS pan, e.pan_number_encrypted,
              dm.designation_name AS designation,
              e.date_of_joining
         FROM employees e
         LEFT JOIN designation_master dm  ON dm.id = e.designation_id
        WHERE e.id = ? LIMIT 1`,
      [employeeId]
    );
    const emp = (empRows as Array<{
      name: string; pan: string | null; pan_number_encrypted: string | null; designation: string | null; date_of_joining: string | null;
    }>)[0];
    if (emp) {
      emp.pan = resolvePii(emp.pan_number_encrypted, emp.pan).value;
    }

    // Derive financial year for declaration lookup
    const [yr, mo] = run.run_month.split("-").map(Number);
    const fyStart = mo >= 4 ? yr : yr - 1;
    const financialYear = `${fyStart}-${fyStart + 1}`;
    const legacyFinancialYear = `${fyStart}-${String(fyStart + 1).slice(2)}`;

    // Load tax declaration
    const [declRows] = await db.execute<RowDataPacket[]>(
      `SELECT declared_hra, declared_80c, declared_80d, regime
         FROM tax_declaration
        WHERE employee_id = ? AND financial_year IN (?, ?)
        ORDER BY financial_year = ? DESC
        LIMIT 1`,
      [employeeId, financialYear, legacyFinancialYear, financialYear]
    );
    const decl = (declRows as Array<{
      declared_hra: number; declared_80c: number; declared_80d: number; regime: string;
    }>)[0] ?? null;

    /**
     * Actual amounts paid across the financial year — not one month annualised.
     *
     * This previously reported the run's monthly gross and multiplied it by 12.
     * That is wrong for anyone who joined or left mid-year, had a salary
     * revision, took LWP, or received a bonus, incentive or arrears — which in
     * practice is most people. A TDS certificate reports what was actually paid
     * and actually deducted, so it is summed from the payroll lines themselves.
     *
     * Only finalized runs count: a draft or cancelled run is not money paid.
     *
     * A month can hold several runs — a re-run, a correction, an abandoned
     * draft — and exactly one is canonical for that month: the most-progressed
     * status, newest on a tie. Summing all of them would double-count a
     * corrected month, so ROW_NUMBER picks one line per month, matching the
     * convention the payroll analytics endpoints already follow.
     */
    const fyFirstMonth = `${fyStart}-04`;
    const fyLastMonth  = `${fyStart + 1}-03`;

    const [fyRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*)                                   AS months_paid,
              COALESCE(SUM(gross_salary), 0)             AS gross_salary,
              COALESCE(SUM(tds_deducted), 0)             AS tds_deducted,
              COALESCE(SUM(professional_tax), 0)         AS professional_tax,
              COALESCE(SUM(pf_employee), 0)              AS pf_employee,
              MIN(run_month)                             AS first_month,
              MAX(run_month)                             AS last_month
         FROM (
           SELECT spr.run_month,
                  spl.gross_salary,
                  COALESCE(NULLIF(spl.tds_amount, 0), spl.tds) AS tds_deducted,
                  spl.professional_tax,
                  spl.pf_employee,
                  ROW_NUMBER() OVER (
                    PARTITION BY spr.run_month
                    ORDER BY FIELD(spr.status, 'disbursed', 'finalized', 'locked', 'approved', 'completed'),
                             spr.created_at DESC
                  ) AS rn
             FROM salary_prep_line spl
             JOIN salary_prep_run spr ON spr.id = spl.run_id
            WHERE spl.employee_id = ?
              AND spr.run_month BETWEEN ? AND ?
              -- 'finalized' is the status payroll actually settles runs in (see run-status.ts);
              -- omitting it here excluded most production months from TDS certificates.
              AND spr.status IN ('locked', 'finalized', 'approved', 'disbursed', 'completed')
              AND spl.status NOT IN ('excluded', 'blocked')
         ) canonical
        WHERE canonical.rn = 1`,
      [employeeId, fyFirstMonth, fyLastMonth]
    );
    const fy = (fyRows as Array<{
      months_paid: number; gross_salary: number; tds_deducted: number;
      professional_tax: number; pf_employee: number;
      first_month: string | null; last_month: string | null;
    }>)[0];

    const grossSalary  = Number(fy?.gross_salary ?? 0);
    const tdsDeducted  = Number(fy?.tds_deducted ?? 0);
    const professionalTax = Number(fy?.professional_tax ?? 0);
    const monthsPaid   = Number(fy?.months_paid ?? 0);

    // Resolved for the financial year the certificate covers, and with no
    // fallback: a certificate computed from a guessed standard deduction is a
    // tax document stating a figure nobody approved, and the employee files
    // their return on it. Refusing is recoverable; a wrong Form 16/130 is not.
    const fyConfig = await loadFlatStatutoryConfig(`${fyStart}-04-01`);
    const standardDeduction = fyConfig["tds_standard_deduction"];
    if (standardDeduction === undefined) {
      return res.status(409).json({
        success: false,
        message:
          "Cannot issue the certificate: tds_standard_deduction has no active configuration " +
          `effective for FY ${fyStart}-${String(fyStart + 1).slice(2)}. Seed and activate it, then retry.`,
        data: { missing_config_keys: ["tds_standard_deduction"] },
      });
    }

    // Professional tax is deductible from salary income (s.16(iii) of the 1961
    // Act), so it reduces taxable income alongside the standard deduction.
    const totalDeductions = standardDeduction
      + professionalTax
      + (decl ? Number(decl.declared_hra) + Number(decl.declared_80c) + Number(decl.declared_80d) : 0);
    const netTaxableIncome = Math.max(0, grossSalary - totalDeductions);

    // Which Act governs the year this certificate covers, and therefore what the
    // certificate is called. The Income-tax Act, 2025 renamed the salary TDS
    // certificate from Form 16 to Form 130 with effect from 1 April 2026, so a
    // certificate for FY 2026-27 is a Form 130 while one reissued for FY 2025-26
    // remains a Form 16. Resolved from the financial year covered, never from
    // today's date — otherwise reprinting an older year would relabel it wrongly.
    const regime = statutoryRegimeForFinancialYear(fyStart);

    // Part A — tax deposited, challan and BSR codes, TRACES verification — is
    // issued by TRACES from the quarterly return and cannot be produced here.
    // Reporting its state alongside Part B is what stops this response being
    // mistaken for a complete certificate: without a verified Part A it is half
    // a document, and an employee filing from it would be missing the half that
    // proves the tax was actually deposited.
    const partA = await getPartAAvailability(employeeId, fyStart);

    return res.json({
      success: true,
      data: {
        financial_year: financialYear,
        period: run.run_month,
        // Additive: existing consumers are unaffected, and a client that renders
        // this instead of a hardcoded "Form 16" is correct for every year.
        /**
         * Completeness of the certificate, stated rather than implied.
         *
         * Part B below is produced here. Part A comes from TRACES and cannot
         * be. `is_complete` is false until a verified Part A exists, so a
         * client can say "your Part B is ready, Part A is pending" instead of
         * presenting half a document as a whole one.
         */
        part_a: {
          status: partA.status,
          available: partA.verified,
          certificate_number: partA.certificateNumber,
          vault_document_id: partA.vaultDocumentId,
          covers_quarters: partA.coversQuarters,
          message: partA.message,
        },
        is_complete: partA.verified,
        statutory: {
          act: regime.actName,
          certificate_form: regime.salaryCertificateForm,
          certificate_label: `Form ${regime.salaryCertificateForm}`,
          salary_tds_section: regime.salaryTdsSection,
          quarterly_return_form: regime.quarterlyReturnForm,
          rebate_section: regime.rebateSection,
          period_term: regime.periodTerm,
        },
        employee: {
          name: emp?.name ?? "",
          pan: emp?.pan ?? null,
          designation: emp?.designation ?? null,
          period: `Apr ${fyStart} – Mar ${fyStart + 1}`,
        },
        // Annual actuals, summed from finalized payroll lines for this FY.
        gross_salary: grossSalary,
        standard_deduction: standardDeduction,
        professional_tax: professionalTax,
        tds_deducted: tdsDeducted,
        net_taxable_income: netTaxableIncome,
        /**
         * How much of the year this certificate actually rests on.
         *
         * A mid-year joiner legitimately has fewer than 12 months; a year with
         * unfinalized runs does not. The reader cannot tell those apart from the
         * totals alone, so the basis is stated rather than implied — and
         * `is_partial_year` marks anything short of a full twelve.
         */
        basis: {
          months_paid: monthsPaid,
          first_month: fy?.first_month ?? null,
          last_month: fy?.last_month ?? null,
          is_partial_year: monthsPaid > 0 && monthsPaid < 12,
          financial_year_range: `${fyFirstMonth} to ${fyLastMonth}`,
        },
        declaration: decl
          ? {
              hra: Number(decl.declared_hra),
              "80c": Number(decl.declared_80c),
              "80d": Number(decl.declared_80d),
              regime: decl.regime,
            }
          : null,
      },
    });
  })
);

// ─── Analytics ────────────────────────────────────────────────────────────────

/**
 * A month can hold several payroll runs (a re-run, a correction, an abandoned
 * draft). Exactly one is the canonical figure for that month: the most-progressed
 * status, newest on a tie. Both analytics endpoints MUST resolve the month the
 * same way — the trend chart used to sum every non-cancelled run while the KPI
 * cards showed a single run, so the same month reported two different totals on
 * one screen.
 */
const RUN_RANK_SQL = runRankSql();

/** One canonical run id per run_month, ranked as above. */
const CANONICAL_RUNS_CTE = `
  canonical AS (
    SELECT id, run_month, status,
           ROW_NUMBER() OVER (PARTITION BY run_month ORDER BY ${RUN_RANK_SQL}, created_at DESC) AS rn
      FROM salary_prep_run
     WHERE UPPER(status) NOT IN ('CANCELLED')
  )`;

// GET /api/payroll/analytics/trends?months=6
router.get("/analytics/trends", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const months = Math.min(24, Math.max(1, Number(req.query.months ?? 6)));
  // Take the latest N months that actually have a run, rather than a calendar
  // window. `>= CURDATE() - INTERVAL 6 MONTH` returned 7 months (the current one
  // plus six) under a "Six-Month Trend" heading, and rendered gaps for months
  // with no payroll.
  const [rows] = await db.execute<RowDataPacket[]>(
    `WITH ${CANONICAL_RUNS_CTE},
     recent AS (
       SELECT id, run_month, status FROM canonical WHERE rn = 1
        ORDER BY run_month DESC LIMIT ${months}
     )
     SELECT r.run_month,
            r.status                            AS run_status,
            COUNT(DISTINCT spl.employee_id)     AS headcount,
            ROUND(SUM(spl.gross_salary),2)      AS total_gross,
            ROUND(SUM(spl.total_deductions),2)  AS total_deductions,
            ROUND(SUM(spl.net_salary),2)        AS total_net,
            ROUND(SUM(COALESCE(spl.pf_employer,0)),2)   AS total_pf_employer,
            ROUND(SUM(COALESCE(spl.esic_employer,0)),2) AS total_esic_employer
       FROM recent r
       JOIN salary_prep_line spl ON spl.run_id = r.id AND spl.status != 'cancelled'
      GROUP BY r.run_month, r.status
      ORDER BY r.run_month ASC`
  );
  return res.json({ success: true, data: rows });
}));

// GET /api/payroll/analytics?dimension=department&runMonth=2026-06
router.get("/analytics", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const dimension = (req.query.dimension as string) || "department";
  let runMonth = req.query.runMonth as string | undefined;

  // Resolve the canonical single run for the month. Shares RUN_RANK_SQL with the
  // trends endpoint so both surfaces describe the same run.
  const pickRun = async (month: string): Promise<{ id: string; status: string; siblings: number } | null> => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, status, COUNT(*) OVER () AS siblings
         FROM salary_prep_run
        WHERE run_month = ? AND UPPER(status) NOT IN ('CANCELLED')
        ORDER BY ${RUN_RANK_SQL}, created_at DESC
        LIMIT 1`,
      [month]
    );
    const row = (rows as any[])[0];
    return row ? { id: String(row.id), status: String(row.status ?? ""), siblings: Number(row.siblings ?? 1) } : null;
  };

  if (!runMonth) {
    const [latest] = await db.execute<RowDataPacket[]>(
      `SELECT run_month FROM salary_prep_run WHERE UPPER(status) NOT IN ('DRAFT','CANCELLED')
       ORDER BY run_month DESC LIMIT 1`
    );
    runMonth = (latest as any[])[0]?.run_month;
    if (!runMonth) return res.json({ success: true, runMonth: null, kpi: {}, data: [] });
  }

  const run = await pickRun(runMonth);
  if (!run) return res.json({ success: true, runMonth, kpi: {}, data: [], meta: null });
  const runId = run.id;

  const [kpiRows] = await db.execute<RowDataPacket[]>(
    // avg_net is derived from the same numerator and denominator the dimension
    // table uses (total ÷ distinct employees) so the KPI card and the table can
    // never disagree about what "average" means.
    `SELECT COUNT(DISTINCT spl.employee_id)             AS headcount,
            ROUND(SUM(spl.net_salary),2)                AS total_net,
            ROUND(SUM(spl.net_salary) / NULLIF(COUNT(DISTINCT spl.employee_id),0),2) AS avg_net,
            ROUND(SUM(spl.gross_salary),2)              AS total_gross,
            ROUND(SUM(spl.total_deductions),2)          AS total_deductions,
            ROUND(SUM(spl.basic),2)                     AS total_basic,
            ROUND(SUM(COALESCE(spl.pf_employer,0)),2)   AS total_pf_employer,
            ROUND(SUM(COALESCE(spl.esic_employer,0)),2) AS total_esic_employer
     FROM salary_prep_line spl
     WHERE spl.run_id = ? AND spl.status != 'cancelled'`,
    [runId]
  );

  const DIM: Record<string, { sel: string; join: string; grp: string }> = {
    department: {
      sel:  "COALESCE(dm.dept_name, 'Unknown') AS dimension_name",
      join: "LEFT JOIN department_master dm ON dm.id = e.department_id",
      grp:  "e.department_id, dm.dept_name",
    },
    branch: {
      sel:  "COALESCE(bm.branch_name, 'Unknown') AS dimension_name",
      join: "LEFT JOIN branch_master bm ON bm.id = e.branch_id",
      grp:  "e.branch_id, bm.branch_name",
    },
    process: {
      sel:  "COALESCE(pm.process_name, 'Unknown') AS dimension_name",
      join: "LEFT JOIN process_master pm ON pm.id = e.process_id",
      grp:  "e.process_id, pm.process_name",
    },
  };
  const d = DIM[dimension] ?? DIM.department;

  const [dimRows] = await db.execute<RowDataPacket[]>(
    `SELECT ${d.sel},
            COUNT(DISTINCT spl.employee_id)                                                           AS headcount,
            ROUND(SUM(spl.basic),2)                                                                   AS total_basic,
            -- Everything in gross that is not basic. Summing only hra +
            -- special_allowance dropped incentive_total and overtime_pay, so
            -- basic + allowances did not reconcile to gross.
            ROUND(SUM(GREATEST(spl.gross_salary - spl.basic, 0)),2)                                    AS total_allowances,
            ROUND(SUM(spl.gross_salary),2)                                                            AS total_gross,
            ROUND(SUM(spl.total_deductions),2)                                                        AS total_deductions,
            ROUND(SUM(spl.net_salary),2)                                                              AS total_net,
            ROUND(SUM(COALESCE(spl.pf_employer,0)),2)                                                 AS total_pf_employer,
            ROUND(SUM(COALESCE(spl.esic_employer,0)),2)                                               AS total_esic_employer
     FROM salary_prep_line spl
     LEFT JOIN employees e ON e.id = spl.employee_id
     ${d.join}
     WHERE spl.run_id = ? AND spl.status != 'cancelled'
     GROUP BY ${d.grp}
     ORDER BY total_net DESC`,
    [runId]
  );

  // Provenance: which run these figures came from, its status, and whether other
  // runs exist for the month. Without this the reader cannot tell a final
  // disbursed payroll from an in-progress draft.
  const meta = {
    runId,
    runStatus: run.status,
    isProvisional: ["draft", "processing"].includes(run.status.toLowerCase()),
    otherRunsInMonth: Math.max(0, run.siblings - 1),
    dimension,
  };

  return res.json({ success: true, runMonth, kpi: (kpiRows as any[])[0] ?? {}, data: dimRows, meta });
}));

// ─── PT Slabs ─────────────────────────────────────────────────────────────────

// GET /api/payroll/pt-slabs — list PT slabs; optional ?state_code=
router.get("/pt-slabs", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { state_code } = req.query as { state_code?: string };
  const params: unknown[] = [];
  let where = "WHERE is_active = 1";
  if (state_code) {
    where += " AND state_code = ?";
    params.push(state_code);
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM pt_slab_master ${where} ORDER BY state_code, income_from`,
    params
  );
  return res.json({ success: true, data: rows });
}));

// POST /api/payroll/pt-slabs — create slab (admin/finance)
router.post(
  "/pt-slabs",
  requireRole("admin", "finance"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { state_code, state_name, income_from, income_to, pt_amount, frequency, effective_from } =
      req.body as {
        state_code: string;
        state_name: string;
        income_from: number;
        income_to?: number | null;
        pt_amount: number;
        frequency: string;
        effective_from: string;
      };

    if (!state_code || !state_name || income_from === undefined || pt_amount === undefined || !frequency || !effective_from) {
      return res.status(400).json({ success: false, message: "state_code, state_name, income_from, pt_amount, frequency, effective_from are required" });
    }

    const id = (await import("crypto")).randomUUID();
    await db.execute(
      `INSERT INTO pt_slab_master (id, state_code, state_name, income_from, income_to, pt_amount, frequency, effective_from, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [id, state_code, state_name, income_from, income_to ?? null, pt_amount, frequency, effective_from]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM pt_slab_master WHERE id = ? LIMIT 1",
      [id]
    );
    return res.status(201).json({ success: true, data: (rows as RowDataPacket[])[0] });
  })
);

// PATCH /api/payroll/pt-slabs/:id — update slab (admin/finance)
router.patch(
  "/pt-slabs/:id",
  requireRole("admin", "finance"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { pt_amount, income_to, is_active } = req.body as {
      pt_amount?: number;
      income_to?: number | null;
      is_active?: number;
    };

    const sets: string[] = [];
    const params: unknown[] = [];

    if (pt_amount !== undefined) { sets.push("pt_amount = ?");  params.push(pt_amount); }
    if (income_to !== undefined) { sets.push("income_to = ?");  params.push(income_to ?? null); }
    if (is_active !== undefined) { sets.push("is_active = ?");  params.push(is_active); }

    if (sets.length === 0) {
      return res.status(400).json({ success: false, message: "No fields to update" });
    }

    params.push(id);
    const patchResult = await db.execute(
      `UPDATE pt_slab_master SET ${sets.join(", ")} WHERE id = ?`,
      params
    );
    const result = (patchResult as unknown as [{ affectedRows: number }, unknown])[0];

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "PT slab not found" });
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM pt_slab_master WHERE id = ? LIMIT 1",
      [id]
    );
    return res.json({ success: true, data: (rows as RowDataPacket[])[0] });
  })
);

// ─── Minimum Wages ────────────────────────────────────────────────────────────

// GET /api/payroll/minimum-wages — list minimum wages; optional ?state_code=
router.get("/minimum-wages", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { state_code } = req.query as { state_code?: string };
  const params: unknown[] = [];
  let where = "WHERE is_active = 1";
  if (state_code) {
    where += " AND state_code = ?";
    params.push(state_code);
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM minimum_wage_master ${where} ORDER BY state_code, category`,
    params
  );
  return res.json({ success: true, data: rows });
}));

// ─── NEFT Export ─────────────────────────────────────────────────────────────

// GET /api/payroll/runs/:id/neft-summary — count of employees with/without bank details
router.get("/runs/:id/neft-summary", requireRole("admin", "super_admin", "finance", "payroll", "payroll_head"), h(async (req: AuthenticatedRequest, res: Response) => {
  // This is the figure Finance reads BEFORE exporting, so it must use the same definition of
  // "payable" the export itself uses, or the preview and the file disagree.
  //
  // It previously counted an employee as banked whenever any employee_bank_detail row existed
  // with a non-null ifsc_code — ignoring whether that row was the active primary one, whether an
  // account number existed at all, and whether the IFSC was routable. total_net summed everyone,
  // banked or not, so the headline matched the export's old overstated TOTAL rather than what
  // could be paid.
  // `payable` is computed once in a derived table rather than repeated across six aggregates —
  // repeating it is how the export and this summary drifted apart in the first place.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*)                                                     AS total,
       SUM(is_payable)                                              AS with_bank,
       SUM(1 - is_payable)                                          AS missing_bank,
       SUM(net_salary)                                              AS total_net,
       SUM(CASE WHEN is_payable = 1 THEN net_salary ELSE 0 END)     AS payable_net,
       SUM(CASE WHEN is_payable = 0 THEN net_salary ELSE 0 END)     AS unpayable_net
     FROM (
       SELECT spl.net_salary,
              CASE
                WHEN ebd.employee_id IS NOT NULL
                 AND COALESCE(NULLIF(TRIM(ebd.account_number), ''),
                              NULLIF(TRIM(ebd.account_number_enc), '')) IS NOT NULL
                 -- Mirrors /neft-export's SCIENTIFIC_RE/VALID_ACCT_RE — a plaintext value present
                 -- must actually look like an account number (an Excel-mangled "3.03801E+13" is
                 -- non-null and would otherwise count as payable here while /neft-export now
                 -- excludes it, which is exactly the drift this query's own comment above warns
                 -- against). account_number_enc is ciphertext and can't be format-checked in SQL,
                 -- so a row relying on it alone is unaffected by this clause.
                 --
                 -- account_number is varbinary(500), not text — REGEXP against it directly throws
                 -- ER_CHARACTER_SET_MISMATCH ("Character set 'binary' cannot be used in
                 -- conjunction with 'utf8mb4_unicode_ci'"), caught live before this shipped.
                 -- CONVERT(...USING utf8mb4) makes it a text value REGEXP can actually match.
                 AND (NULLIF(TRIM(ebd.account_number), '') IS NULL
                      OR (CONVERT(TRIM(ebd.account_number) USING utf8mb4) REGEXP '^[0-9]{6,20}$'
                          AND CONVERT(TRIM(ebd.account_number) USING utf8mb4) NOT REGEXP '[Ee][+-]'))
                 AND UPPER(TRIM(COALESCE(ebd.ifsc_code, ''))) REGEXP '^[A-Z]{4}0[A-Z0-9]{6}$'
                THEN 1 ELSE 0
              END AS is_payable
         FROM salary_prep_line spl
         JOIN employees e ON e.id = spl.employee_id
         LEFT JOIN employee_bank_detail ebd
                ON ebd.employee_id = spl.employee_id
               AND ebd.active_status = 1
               AND ebd.is_primary = 1
        WHERE spl.run_id = ? AND spl.net_salary > 0
          AND LOWER(COALESCE(spl.status, '')) NOT IN ('excluded', 'blocked')
     ) scored`,
    [req.params.id]
  );
  res.json({ success: true, data: (rows as RowDataPacket[])[0] });
}));

// GET /api/payroll/runs/:runId/neft-lines
// Per-employee bank details (full account numbers) + net salary for Finance NEFT file preparation
// Returns decrypted full bank account numbers — use for NEFT transfer prep only, not dashboard display
router.get(
  "/runs/:runId/neft-lines",
  requireAuth,
  requireRole("admin", "super_admin", "finance", "payroll"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { runId } = req.params;

    // Returns decrypted full account numbers for every employee in the run — same
    // org-wide requirement as the NEFT export this feeds.
    if (!(await hasExportScope(req.authUser!.id))) {
      return res.status(403).json({ success: false, message: ORG_WIDE_REQUIRED_MSG });
    }

    // Validate runId is a valid UUID
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) {
      return res.status(400).json({ success: false, error: "Invalid run ID format" });
    }

    const [runRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, run_month, status FROM salary_prep_run WHERE id = ? LIMIT 1`,
      [runId]
    );
    if (!(runRows as RowDataPacket[]).length) {
      return res.status(404).json({ success: false, error: "Payroll run not found" });
    }
    const run = (runRows as RowDataPacket[])[0];

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.employee_code,
              e.first_name,
              e.last_name,
              COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
              ebd.bank_name,
              ebd.ifsc_code,
              COALESCE(ebd.account_holder_name, CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS account_holder_name,
              ebd.account_number_enc,
              ebd.account_number AS account_number_legacy,
              spl.net_salary,
              spl.gross_salary,
              spl.total_deductions,
              spl.status AS line_status
         FROM salary_prep_line spl
         JOIN employees e ON e.id = spl.employee_id
         -- Active primary account only. This feeds NEFT file preparation, so an unfiltered join
         -- would hand Finance one row per bank record — each carrying the full net_salary — and
         -- the duplicate is invisible in a spreadsheet of 1,000 rows.
         LEFT JOIN employee_bank_detail ebd
                ON ebd.employee_id = spl.employee_id
               AND ebd.active_status = 1
               AND ebd.is_primary = 1
        WHERE spl.run_id = ?
          AND spl.net_salary > 0
        ORDER BY e.employee_code ASC`,
      [runId]
    );

    const lines = (rows as RowDataPacket[]).map((r: any) => ({
      ...r,
      account_number: resolveAccountNumber({ account_number_enc: r.account_number_enc, account_number: r.account_number_legacy }),
    }));

    return res.json({
      success: true,
      run,
      data: lines,
      meta: {
        count: lines.length,
        total_net: lines.reduce((sum: number, r: any) => sum + Number(r.net_salary ?? 0), 0),
      },
    });
  })
);

// GET /api/payroll/runs/:id/neft-export — generate NEFT disbursement CSV
router.get("/runs/:id/neft-export", requireRole("admin", "super_admin", "finance", "payroll", "payroll_head"), h(async (req: AuthenticatedRequest, res: Response) => {
  const runId = req.params.id;

  // Bank file — deny a branch-scoped caller rather than row-filter. See
  // hasOrgWideScope in shared/scopeAccess.ts for why a partial payment file is
  // worse than none. (This route duplicates the one in payroll-extended.routes.ts;
  // both are gated so whichever the UI reaches behaves identically.)
  if (!(await hasExportScope(req.authUser!.id))) {
    return res.status(403).json({ success: false, message: ORG_WIDE_REQUIRED_MSG });
  }

  const [runRows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM salary_prep_run WHERE id = ? LIMIT 1",
    [runId]
  );
  const run = (runRows as RowDataPacket[])[0];
  if (!run) return res.status(404).json({ error: "Run not found" });
  // isRunClosed (locked/disbursed/finalized, case-insensitive) rather than a literal
  // ["locked","disbursed"] list — that literal previously blocked NEFT export for every
  // FINALIZED production run (see run-status.ts).
  if (!isRunClosed(run.status)) {
    return res.status(400).json({ error: "Run must be locked, finalized, or disbursed to generate NEFT export" });
  }
  if (run.validation_status && run.validation_status !== 'validated') {
    return res.status(403).json({ success: false, message: "Payroll must be validated before generating NEFT export. Current status: " + run.validation_status });
  }

  // FINANCE SIGN-OFF (payment gate requirement E).
  //
  // A closed, validated run still is not a mandate to move money — that is a separate act by a
  // separate person, which is why salary_prep_run carries finance_approved_by/at at all. Nothing
  // read those columns before this, so the only thing standing between a FINALIZED run and a bank
  // file was validation_status. Verified live 2026-08-17: finance_approved_by is NULL on ALL 66
  // runs, so no run in this system has ever actually been signed off for payment.
  //
  // Deliberately checked as a distinct 409 rather than folded into the run-state check above:
  // "not signed off" is a workflow state a human resolves, not a malformed request.
  if (!run.finance_approved_by) {
    return res.status(409).json({
      success: false,
      code: "FINANCE_SIGNOFF_MISSING",
      message:
        "Finance sign-off is required before a payment file can be generated. " +
        "This run has no finance_approved_by. Record the sign-off, then export.",
    });
  }

  // Active primary account only — see the identical filter on /neft-lines. Unfiltered, this
  // emits one CSV row per employee_bank_detail row, each carrying the FULL net_salary and each
  // added to the declared total, so an employee with two bank rows is instructed to be paid
  // twice. It duplicates nothing today (verified live: 12,858 employees hold bank rows, maximum
  // 1 each) but the bank-change-approval workflow exists to create the second row.
  const [lines] = await db.execute<RowDataPacket[]>(
    `SELECT spl.employee_id, spl.net_salary, spl.gross_salary, spl.total_deductions,
            e.employee_code, e.full_name, e.email,
            ebd.bank_name, ebd.ifsc_code,
            ebd.account_number_enc, ebd.account_number AS account_number_legacy
     FROM salary_prep_line spl
     JOIN employees e ON e.id = spl.employee_id
     LEFT JOIN employee_bank_detail ebd
            ON ebd.employee_id = spl.employee_id
           AND ebd.active_status = 1
           AND ebd.is_primary = 1
     WHERE spl.run_id = ? AND spl.net_salary > 0
       AND LOWER(COALESCE(spl.status, '')) NOT IN ('excluded', 'blocked')
     ORDER BY e.employee_code`,
    [runId]
  );

  /** RBI IFSC: 4 letters, a literal zero, then 6 alphanumerics. A failing value cannot be routed. */
  const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
  /**
   * Same two checks as the "payable bank total" in payroll-extended.routes.ts's golden-month
   * reconciliation. (disbursal.routes.ts's /bank-export carried them too, until it was retired on
   * 2026-08-17 for bypassing the release controls.) Not reused here only because
   * account_number arrives already resolved (encrypted-or-legacy) as a plain string, not as a
   * (enc, legacy) pair those two check separately.
   *
   * A number like "3.03801E+13" is truthy and passes `!accountNo`, so it silently reached the
   * bank as a real payment line before this: live 2026-04 run, MAS-code employee, Rs 55,414,
   * account_number literally that string (a legacy plaintext value Excel round-tripped into
   * scientific notation on someone's machine before import). VALID_ACCT_RE also rejects it on
   * length/character grounds independent of the scientific-notation check, so either alone would
   * have caught this one; both are kept because they catch different corruption shapes.
   */
  const SCIENTIFIC_RE = /[Ee][+-]/;
  const VALID_ACCT_RE = /^[0-9]{6,20}$/;

  // Standard Indian bank NEFT format
  // Columns: Sr No, Employee Code, Employee Name, Bank Name, IFSC Code, Account Number, Net Amount, Remarks
  const csvRows = ["Sr No,Employee Code,Employee Name,Bank Name,IFSC Code,Account Number,Net Amount,Remarks"];
  let srNo = 1;
  let totalAmount = 0;

  // Employees who cannot be paid are NOT written as payment instructions and NOT counted in the
  // declared total.
  //
  // Previously every payable line was emitted with "NOT_LINKED" substituted for a missing
  // account or IFSC, while its net_salary was still added to TOTAL. The bank rejects those rows
  // and pays the rest, so the file's own total never matched what moved — and the gap is not
  // small. On the FINALIZED 2026-04 run, now the certification golden month: 143 of 982 payable
  // employees have no usable account, carrying Rs 19,37,731 of the Rs 1,76,04,080 declared
  // (11.0%). Payable net is Rs 1,56,66,349.
  //
  // They are not dropped either — silently shortening a payment file is the worse failure. They
  // are listed in an EXCLUDED block after TOTAL with the reason, and summarised in response
  // headers so a caller can reconcile without parsing the CSV. No employee's pay changes; only
  // what is asserted to be payable right now.
  const unpayable: Array<{ code: string; name: string; amount: number; reason: string }> = [];
  /** Employees actually written as payment instructions — the set reconciled against readiness. */
  const paidEmployeeIds: string[] = [];

  for (const line of lines as RowDataPacket[]) {
    const accountNo = resolveAccountNumber({ account_number_enc: (line as any).account_number_enc, account_number: (line as any).account_number_legacy });
    const ifsc = ((line.ifsc_code as string | null) ?? "").trim().toUpperCase();
    const bank = ((line.bank_name as string | null) ?? "").replace(/,/g, " ");
    const name = ((line.full_name as string | null) ?? "").replace(/,/g, " ");
    const net = Number(line.net_salary);
    const code = line.employee_code as string;

    const reason = !accountNo ? "NO_ACTIVE_PRIMARY_ACCOUNT"
      : (SCIENTIFIC_RE.test(accountNo) || !VALID_ACCT_RE.test(accountNo)) ? "ACCOUNT_INVALID_FORMAT"
      : !ifsc ? "IFSC_MISSING"
      : !IFSC_RE.test(ifsc) ? "IFSC_INVALID_FORMAT"
      : null;

    if (reason) {
      unpayable.push({ code, name, amount: net, reason });
      continue;
    }

    const remarks = `SALARY ${run.run_month as string}`;
    csvRows.push(`${srNo},${code},${name},${bank},${ifsc},${accountNo},${net.toFixed(2)},${remarks}`);
    paidEmployeeIds.push(String(line.employee_id));
    srNo++;
    totalAmount += net;
  }

  // Refuse rather than hand over a payment file with no payment rows in it.
  //
  // Ported from the secondary disbursal exporter retired on 2026-08-17, which held this guard
  // while the canonical one did not. Without it a run where every employee fails the account/IFSC
  // checks still produces a well-formed CSV — header, TOTAL 0.00, and an EXCLUDED block — which
  // reads as a completed export. Nobody gets paid, and the failure only surfaces when someone
  // reads the excluded list. A 422 naming the count makes it a blocked export instead.
  if (paidEmployeeIds.length === 0) {
    return res.status(422).json({
      success: false,
      code: "NO_PAYABLE_EMPLOYEES",
      message:
        `No employee in this run can be paid: all ${unpayable.length} carry a missing or malformed `
        + `bank account or IFSC. Resolve them in Payroll → Bank Payment Readiness and export again.`,
      unpayableCount: unpayable.length,
      unpayable: unpayable.map((u) => ({ code: u.code, reason: u.reason })),
    });
  }

  csvRows.push(`TOTAL,,,,,,${totalAmount.toFixed(2)},`);

  const excludedTotal = unpayable.reduce((sum, u) => sum + u.amount, 0);
  if (unpayable.length > 0) {
    csvRows.push("");
    csvRows.push("EXCLUDED — NOT PAYABLE, NOT INCLUDED IN TOTAL ABOVE");
    csvRows.push("Employee Code,Employee Name,Net Amount,Reason");
    for (const u of unpayable) {
      csvRows.push(`${u.code},${u.name},${u.amount.toFixed(2)},${u.reason}`);
    }
    csvRows.push(`EXCLUDED_TOTAL,,${excludedTotal.toFixed(2)},`);
  }

  // POPULATION RECONCILIATION (payment gate requirement B).
  //
  // Until this, two independent payment populations existed and nothing compared them. This route
  // derives its own from salary_prep_line; bank-payment-readiness.service.ts derives another and
  // is what the Bank Payment Readiness page reports. Measured on the FINALIZED 2026-04 run
  // (2026-08-17): this exporter 982 employees / Rs 1,76,04,080, readiness 712 / Rs 1,38,70,123 —
  // a 270-employee, Rs 37,33,957 divergence, entirely employees.active_status = 0.
  //
  // That divergence is not self-evidently wrong: those 270 held April payroll lines and left
  // afterwards, so the exporter answers "who was owed money in this run" while readiness answers
  // "who can we pay right now". Both are defensible readings. What is NOT defensible is shipping
  // a bank file while the two disagree and nobody has said which is correct — so this refuses the
  // file and hands a human the exact difference to adjudicate.
  //
  // buildBankReadinessReport() is CALLED rather than re-implemented on purpose. Deriving the
  // comparison population here would create a third one, which is the very failure being closed.
  const readinessReport = await buildBankReadinessReport(runId);

  // Readiness verifies accounts against db_bill's confirmed credits. That host is LAN-only, and
  // when it is unreachable the report DEGRADES — every row falls out of READY. Measured
  // 2026-08-17 from off-LAN: db_bill ETIMEDOUT and the report returned 0 READY out of 837
  // otherwise-payable employees.
  //
  // Refusing is still correct — an unverifiable payment population must not become a bank file —
  // but reporting it as a population MISMATCH would be a confident wrong answer: it names the
  // employee data as the problem when the actual fault is a database nobody can reach. Whoever
  // reads that error would go looking for 837 bad bank records that do not exist.
  if (!readinessReport.verification_source.available) {
    return res.status(409).json({
      success: false,
      code: "PAYMENT_READINESS_UNVERIFIABLE",
      message:
        "Bank payment readiness could not be verified — its verification source is unavailable, " +
        "so the payment population cannot be reconciled. No file has been generated. This is not " +
        "a problem with the employee data.",
      verification_source: readinessReport.verification_source,
    });
  }

  const readyIds = new Set(
    readinessReport.rows.filter((r) => r.readiness_class === "READY").map((r) => r.employee_id),
  );
  const paidNotReady = paidEmployeeIds.filter((id) => !readyIds.has(id));
  const readyNotPaid = [...readyIds].filter((id) => !paidEmployeeIds.includes(id));

  if (paidNotReady.length > 0 || readyNotPaid.length > 0) {
    const amountByEmployee = new Map(
      (lines as RowDataPacket[]).map((l) => [String(l.employee_id), Number(l.net_salary) || 0]),
    );
    const sumOf = (ids: string[]) => ids.reduce((s, id) => s + (amountByEmployee.get(id) ?? 0), 0);
    return res.status(409).json({
      success: false,
      code: "PAYMENT_POPULATION_MISMATCH",
      message:
        "The payment file population does not reconcile against bank payment readiness. " +
        "No file has been generated. Resolve the difference, then export.",
      reconciliation: {
        exporter_payable_count: paidEmployeeIds.length,
        exporter_payable_total: Number(totalAmount.toFixed(2)),
        readiness_ready_count: readyIds.size,
        would_pay_but_not_ready: {
          count: paidNotReady.length,
          amount: Number(sumOf(paidNotReady).toFixed(2)),
          sample: paidNotReady.slice(0, 20),
        },
        ready_but_would_not_pay: {
          count: readyNotPaid.length,
          sample: readyNotPaid.slice(0, 20),
        },
      },
    });
  }

  const csv = csvRows.join("\n");
  const filename = `NEFT_${run.run_month as string}_${runId.slice(0, 8)}.csv`;

  // Record what this file actually contained, BEFORE handing it over.
  //
  // Without this a regenerated export cannot be shown to be identical to the one already sent to
  // the bank, and a disputed duplicate payment has no evidence on either side. The hash is of the
  // exact bytes sent, so "reproducible" becomes checkable: regenerate, hash, compare. Two rows
  // for one run with DIFFERENT hashes is the real hazard — the file was regenerated and it
  // changed — which the readiness gate can then surface for a human to adjudicate.
  //
  // Written to payroll_register_export_log rather than a new table: it already exists, already
  // has a live writer in payrollCompliance.routes.ts, and its register_type enum already carries
  // 'bank_register'. A second payment-file log beside it would be the two-rival-systems mistake
  // this audit keeps finding elsewhere.
  //
  // Deliberately NOT wrapped in try/catch. If the file cannot be recorded it must not be handed
  // out — an untracked payment file is the precise condition this exists to prevent, and a
  // swallowed failure here would leave the log silently incomplete while the money still moved.
  // The existing compliance writer takes the same un-caught approach, so this is consistent
  // rather than a new convention.
  const contentSha256 = createHash("sha256").update(csv, "utf8").digest("hex");
  await db.execute(
    `INSERT INTO payroll_register_export_log
       (id, run_id, register_type, filter_json, generated_by, row_count,
        file_name, content_sha256, total_amount, excluded_count, excluded_amount)
     VALUES (UUID(), ?, 'bank_register', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      runId,
      JSON.stringify({ endpoint: "neft-export" }),
      req.authUser?.id ?? null,
      srNo - 1,
      filename,
      contentSha256,
      totalAmount.toFixed(2),
      unpayable.length,
      excludedTotal.toFixed(2),
    ],
  );

  // Machine-readable reconciliation, so a caller never has to infer these by parsing the CSV.
  res.setHeader("X-Payroll-File-Sha256", contentSha256);
  res.setHeader("X-Payroll-Payable-Count", String(srNo - 1));
  res.setHeader("X-Payroll-Payable-Total", totalAmount.toFixed(2));
  res.setHeader("X-Payroll-Excluded-Count", String(unpayable.length));
  res.setHeader("X-Payroll-Excluded-Total", excludedTotal.toFixed(2));
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
}));

// ─── Payroll Validation / Rejection (Head Payroll) ───────────────────────────

// PATCH /api/payroll/runs/:id/validate — Head Payroll validates a run (unlocks NEFT export)
router.patch("/runs/:id/validate", requireAuth, h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  if (!(await hasAnyRoleAsync(userId, "payroll_head", "super_admin"))) {
    return res.status(403).json({ success: false, message: "Only Head Payroll can validate a payroll run" });
  }
  const { note } = req.body as { note?: string };
  const [runRows] = await db.execute("SELECT id, status, validation_status FROM salary_prep_run WHERE id = ? LIMIT 1", [req.params.id]);
  const run = (runRows as any[])[0];
  if (!run) return res.status(404).json({ success: false, message: "Run not found" });
  if (run.validation_status === "validated") return res.status(400).json({ success: false, message: "Already validated" });

  await db.execute(
    `UPDATE salary_prep_run SET validation_status = 'validated', validated_by = ?, validated_at = NOW() WHERE id = ?`,
    [userId, req.params.id]
  );
  await db.execute(
    `INSERT INTO payroll_validation_log (id, run_id, action, actor_id, actor_role, reason, created_at) VALUES (UUID(), ?, 'validated', ?, ?, ?, NOW())`,
    [req.params.id, userId, req.authUser!.role, note ?? null]
  );
  return res.json({ success: true, message: "Payroll run validated. NEFT export is now unlocked." });
}));

// PATCH /api/payroll/runs/:id/reject-validation — Head Payroll rejects a run
router.patch("/runs/:id/reject-validation", requireAuth, h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  if (!(await hasAnyRoleAsync(userId, "payroll_head", "super_admin"))) {
    return res.status(403).json({ success: false, message: "Only Head Payroll can reject a payroll run" });
  }
  const { reason } = req.body as { reason?: string };
  if (!reason?.trim()) return res.status(400).json({ success: false, message: "Rejection reason is required" });
  const [runRows] = await db.execute("SELECT id, status, validation_status FROM salary_prep_run WHERE id = ? LIMIT 1", [req.params.id]);
  const run = (runRows as any[])[0];
  if (!run) return res.status(404).json({ success: false, message: "Run not found" });

  await db.execute(
    `UPDATE salary_prep_run SET validation_status = 'rejected', rejected_by = ?, rejected_at = NOW(), rejection_reason = ? WHERE id = ?`,
    [userId, reason, req.params.id]
  );
  await db.execute(
    `INSERT INTO payroll_validation_log (id, run_id, action, actor_id, actor_role, reason, created_at) VALUES (UUID(), ?, 'rejected', ?, ?, ?, NOW())`,
    [req.params.id, userId, req.authUser!.role, reason]
  );
  return res.json({ success: true, message: "Payroll run rejected. Recalculation required before re-validation." });
}));

// ─── ECR / ESIC Challan ───────────────────────────────────────────────────────

// GET /api/payroll/runs/:id/ecr — ECR-format data for a run
router.get("/runs/:id/ecr", requireRole("admin", "super_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const runId = req.params.id;

  // Verify run exists
  const [runRows] = await db.execute<RowDataPacket[]>(
    "SELECT id, run_month FROM salary_prep_run WHERE id = ? LIMIT 1",
    [runId]
  );
  if (!(runRows as RowDataPacket[]).length) {
    return res.status(404).json({ success: false, message: "Run not found" });
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       eu.uan,
       eu.member_id,
       CONCAT_WS(' ', e.first_name, e.last_name) AS member_name,
       spl.gross_salary                           AS wages,
       spl.pf_employee                            AS epf_contribution,
       (spl.pf_employer - ROUND(spl.pf_employer * 3.67 / 12, 2)) AS eps_contribution
     FROM salary_prep_line spl
     JOIN employees e        ON e.id  = spl.employee_id
     LEFT JOIN employee_uan eu ON eu.employee_id = spl.employee_id
     WHERE spl.run_id = ? AND spl.status != 'cancelled'
     ORDER BY e.employee_code`,
    [runId]
  );

  return res.json({ success: true, run_id: runId, data: rows });
}));

// GET /api/payroll/runs/:id/esic-challan — ESIC challan data for a run
router.get("/runs/:id/esic-challan", requireRole("admin", "super_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const runId = req.params.id;

  const [runRows] = await db.execute<RowDataPacket[]>(
    "SELECT id, run_month FROM salary_prep_run WHERE id = ? LIMIT 1",
    [runId]
  );
  const run = (runRows as Array<{ id: string; run_month: string }>)[0];
  if (!run) {
    return res.status(404).json({ success: false, message: "Run not found" });
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       e.employee_code,
       CONCAT_WS(' ', e.first_name, e.last_name) AS employee_name,
       spl.gross_salary                           AS wages,
       spl.esic_employee                          AS employee_contribution,
       spl.esic_employer                          AS employer_contribution
     FROM salary_prep_line spl
     JOIN employees e ON e.id = spl.employee_id
     WHERE spl.run_id = ? AND spl.status != 'cancelled'
     ORDER BY e.employee_code`,
    [runId]
  );

  const lines = rows as Array<{
    employee_code: string;
    employee_name: string;
    wages: number;
    employee_contribution: number;
    employer_contribution: number;
  }>;

  const totals = lines.reduce(
    (acc, l) => {
      acc.total_wages        += Number(l.wages);
      acc.employee_total     += Number(l.employee_contribution);
      acc.employer_total     += Number(l.employer_contribution);
      return acc;
    },
    { total_wages: 0, employee_total: 0, employer_total: 0 }
  );

  return res.json({
    success: true,
    run_id: runId,
    period: run.run_month,
    employee_count: lines.length,
    ...totals,
    data: lines,
  });
}));

// ─── Payroll Dashboard Endpoints ──────────────────────────────────────

// GET /api/payroll/summary — payroll dashboard summary metrics
router.get("/summary", requireRole("admin", "super_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  /*
   * Two faults here, and the second is the dangerous one.
   *
   * employees has no ctc_annual column - it is ctc - so this raised ER_BAD_FIELD_ERROR and the
   * payroll summary returned nothing.
   *
   * Correcting only the name would have been worse than leaving it broken. The employee-grain
   * figures were being aggregated across a LEFT JOIN to salary_prep_line, which holds one row
   * per employee per payroll run: 1,125 active employees fan out to 14,277 joined rows, so
   * SUM(ctc) counted each employee's CTC once per payroll line they appear in. That reports a
   * total CTC of 379 crore against a true figure of 1.97 crore, and an average inflated the same
   * way - a number nobody would query, on a payroll dashboard.
   *
   * Each aggregate is now computed at its own grain. The payroll-line totals keep their original
   * meaning, summed over every run belonging to an active employee; only the employee-grain ones
   * stop being multiplied. No arithmetic changed - SUM(ctc) now means the sum of ctc.
   */
  const ACTIVE = "active_status = 1 AND employment_status = 'active'";
  const [summary] = await db.execute<RowDataPacket[]>(`
    SELECT
      (SELECT COUNT(*)                    FROM employees WHERE ${ACTIVE}) as payroll_processed,
      (SELECT COALESCE(SUM(ctc), 0)       FROM employees WHERE ${ACTIVE}) as total_ctc,
      (SELECT COALESCE(SUM(spl.gross_salary), 0)
         FROM salary_prep_line spl
         JOIN employees e ON e.id = spl.employee_id
        WHERE e.active_status = 1 AND e.employment_status = 'active') as total_gross,
      (SELECT COALESCE(SUM(spl.net_salary), 0)
         FROM salary_prep_line spl
         JOIN employees e ON e.id = spl.employee_id
        WHERE e.active_status = 1 AND e.employment_status = 'active') as total_net,
      (SELECT COALESCE(AVG(ctc), 0)       FROM employees WHERE ${ACTIVE}) as avg_ctc
  `);
  return res.json({ success: true, data: (summary as RowDataPacket[])[0] || {} });
}));

// GET /api/payroll/compliance — payroll compliance check (statutory fields validation)
router.get("/compliance", requireRole("admin", "super_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const [compliance] = await db.execute<RowDataPacket[]>(`
    SELECT e.id, e.employee_code, CONCAT_WS(' ', e.first_name, e.last_name) AS employee_name,
           e.pan_number, e.pan_number_encrypted, e.uan_number, e.epf_number, e.esic_number,
           -- 'Valid' if either the ciphertext or the legacy plaintext column is populated —
           -- an employee whose PAN now lives only in pan_number_encrypted must not read as Missing.
           CASE WHEN (e.pan_number IS NOT NULL AND e.pan_number != '')
                  OR (e.pan_number_encrypted IS NOT NULL AND e.pan_number_encrypted != '')
                THEN 'Valid' ELSE 'Missing' END as pan_status,
           CASE WHEN e.uan_number IS NOT NULL AND e.uan_number != '' THEN 'Valid' ELSE 'Missing' END as uan_status,
           CASE WHEN e.epf_number IS NOT NULL AND e.epf_number != '' THEN 'Valid' ELSE 'Missing' END as epf_status,
           CASE WHEN e.esic_number IS NOT NULL AND e.esic_number != '' THEN 'Valid' ELSE 'Missing' END as esic_status
    FROM employees e
    WHERE e.active_status = 1 AND e.employment_status = 'active'
    ORDER BY e.employee_code
    LIMIT 100
  `);
  for (const row of compliance as any[]) {
    row.pan_number = resolvePii(row.pan_number_encrypted, row.pan_number).value;
    delete row.pan_number_encrypted;
  }
  return res.json({ success: true, data: compliance });
}));

// POST /api/payroll/runs/:id/finance-approve — Finance team approves run for disbursement
router.post(
  "/runs/:id/finance-approve",
  requireAuth,
  requireRole("finance", "admin", "super_admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const actorUserId = req.authUser!.id;
    try {
      const result = await (await import("./payroll.service.js")).approveRunForDisbursement(id, actorUserId);
      return res.json(result);
    } catch (err: any) {
      const msg = err.message ?? "Approval failed";
      if (msg.includes("not found")) {
        return res.status(404).json({ success: false, message: msg });
      }
      if (msg.includes("must be in")) {
        return res.status(400).json({ success: false, message: msg });
      }
      throw err;
    }
  })
);

// ─── Holiday Debug (diagnostic endpoint) ──────────────────────────────────────
import { holidayDebugRouter } from "./holiday-debug.routes.js";
router.use("/holiday-debug", holidayDebugRouter);

// ─── PATCH /runs/:id/tds-mode ──────────────────────────────────────────────────
// Sets tds_mode ('auto' | 'manual') on a draft/calculating run.
// auto = taxEngineService reads payroll_tax_fy_config + payroll_tax_slab_master.
// manual = salary_run_manual_tds rows override per-employee TDS (default).
// Blocked once the run has been calculated (status not in draft/calculating).
router.patch(
  "/runs/:id/tds-mode",
  requireRole("payroll_head", "super_admin", "admin", "finance"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { tds_mode } = req.body as { tds_mode?: string };
    if (!tds_mode || !["auto", "manual"].includes(tds_mode)) {
      return res.status(400).json({ success: false, message: "tds_mode must be 'auto' or 'manual'" });
    }
    const [runRows] = await db.execute<RowDataPacket[]>(
      "SELECT id, status FROM salary_prep_run WHERE id = ? LIMIT 1",
      [req.params.id],
    );
    const run = (runRows as RowDataPacket[])[0];
    if (!run) {
      return res.status(404).json({ success: false, message: "Payroll run not found" });
    }
    if (!["draft", "calculating"].includes(String(run.status))) {
      return res.status(409).json({
        success: false,
        message: "TDS mode cannot be changed after calculation has started",
      });
    }
    await db.execute(
      "UPDATE salary_prep_run SET tds_mode = ? WHERE id = ?",
      [tds_mode, req.params.id],
    );
    return res.json({ success: true, data: { tds_mode }, message: `TDS mode set to ${tds_mode}` });
  }),
);

export { router as payrollRouter };
