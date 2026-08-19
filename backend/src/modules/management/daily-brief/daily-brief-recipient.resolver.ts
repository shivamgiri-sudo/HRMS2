/**
 * Recipient resolution for the D-1 Daily Manager Intelligence Briefing Engine.
 *
 * WIDENING PASS (this revision): eligibility now covers the full live role_key catalog
 * that daily-brief-role-modules.ts's DAILY_BRIEF_ROLE_MODULES matrix already defines
 * module composition for (25 roles), not just the original MVP four
 * (team_leader/tl/manager/branch_head). See that file's own header for the catalog
 * source. Widening eligibility alone is not enough, though: different role FAMILIES
 * need different "who is my team" resolution strategies, and one role family
 * (executive) needs a completely different EXECUTION path in the aggregator, not just
 * a wider employee-id list — see daily-brief-aggregator.service.ts's
 * buildExecutiveDailyBrief / isExecutiveRollup branch for that half of the fix.
 *
 * ROLE-FAMILY -> RESOLUTION-STRATEGY TABLE (ground-truthed against
 * shared/dashboardScope.ts's real bucket sets — SYSTEM_WIDE_ROLES, HEAD_OFFICE_ROLES,
 * ORG_ALL_ROLES, BRANCH_ALL_ROLES, PROCESS_OR_TEAM_ROLES, TEAM_ROLES, SELF_ONLY_ROLES —
 * read at the time this was written, not guessed):
 *
 *   direct_report      team_leader, tl, manager, assistant_manager, branch_head
 *                      -> dashboardScope.ts's TEAM_ROLES (TEAM_ONLY) or BRANCH_ALL_ROLES
 *                         (BRANCH_ALL) bucket, exactly as before this pass. UNCHANGED.
 *
 *   process_functional process_manager, wfm, qa
 *                      -> dashboardScope.ts's PROCESS_OR_TEAM_ROLES bucket (PROCESS_ALL):
 *                         every active employee in the resolved process/branch scope,
 *                         via the same buildScopeWhereEmployees() the direct-report
 *                         family already uses (it already handles PROCESS_ALL).
 *
 *                      trainer -> REPO-REALITY CONTRADICTION: the governing prompt
 *                         groups `trainer` in this family and expects it to behave like
 *                         process_manager/wfm/qa, but `trainer` is NOT a member of
 *                         dashboardScope.ts's PROCESS_OR_TEAM_ROLES (or any other bucket)
 *                         — verified by reading the file, not assumed. Left unhandled,
 *                         resolveDashboardScope's own final fallback would silently
 *                         hand a trainer their own SELF_ONLY scope (just themselves) —
 *                         narrow, not a broad-grant leak, but a silent behavior nobody
 *                         asked for and not the "team" a training-focused brief needs.
 *                         Per the fail-closed constraint, `trainer` is therefore treated
 *                         as UNRESOLVABLE here (see KNOWN_DASHBOARD_SCOPE_ROLES below)
 *                         rather than silently accepting that fallback. Fixing this for
 *                         real means adding `trainer` to dashboardScope.ts's own
 *                         PROCESS_OR_TEAM_ROLES set — an edit to shared, security-
 *                         sensitive scope code outside this pass's authorised scope.
 *
 *   hr_recruitment     hr, recruiter, branch_it, it
 *                      -> hr: dashboardScope.ts's ORG_ALL_ROLES bucket (conditional:
 *                         ORG_ALL with an explicit 'all' grant, else BRANCH_ALL via the
 *                         employee's own branch, else DashboardScopeConfigurationError —
 *                         already fails closed via the existing try/catch below).
 *                         recruiter: PROCESS_OR_TEAM_ROLES bucket (PROCESS_ALL).
 *                         branch_it, it: BRANCH_ALL_ROLES bucket (BRANCH_ALL).
 *
 *                      branch_admin, it_head -> REPO-REALITY CONTRADICTION: neither is a
 *                         member of ANY of dashboardScope.ts's role sets (verified by
 *                         reading the file). `it_head` is close to but distinct from the
 *                         `ho_it` literal that IS in HEAD_OFFICE_ROLES/ORG_ALL_ROLES, and
 *                         `branch_admin` has no counterpart at all (BRANCH_ALL_ROLES has
 *                         `branch_head`/`branch_hr`/`branch_it`/`it` but not
 *                         `branch_admin`). Per the prompt's own instruction for this
 *                         family ("if a role isn't in any bucket, treat it as
 *                         unresolvable... do not invent a new scope rule"), both are
 *                         UNRESOLVABLE here rather than silently falling through
 *                         dashboardScope.ts's SELF_ONLY default.
 *
 *   payroll_finance    payroll, payroll_admin, payroll_hr, finance
 *                      -> dashboardScope.ts's ORG_ALL_ROLES bucket (conditional, as hr
 *                         above).
 *                      payroll_head, finance_head, accounts_head
 *                      -> dashboardScope.ts's HEAD_OFFICE_ROLES bucket: unconditional
 *                         ORG_ALL, no 'all' grant required.
 *                      This family does not get a per-employee teamEmployeeIds list at
 *                      all (see PAYROLL_FINANCE_ROLES handling below) — only a
 *                      scopeDescriptor {branchIds, processIds} taken directly from the
 *                      resolved DashboardScope, because daily-brief-role-modules.ts's
 *                      PAYROLL_FINANCE_CONFIG wires exactly one module (payroll:
 *                      "readiness") for this family, and that module already takes a
 *                      branch/process scope, not employee ids.
 *
 *   executive          ceo, admin, super_admin
 *                      -> ceo: dashboardScope.ts's HEAD_OFFICE_ROLES bucket
 *                         (unconditional ORG_ALL). admin, super_admin:
 *                         dashboardScope.ts's SYSTEM_WIDE_ROLES bucket (unconditional
 *                         ORG_ALL). All three ALWAYS resolve to ORG_ALL — this is the
 *                         gap Phase-B's `loadTeamEmployeeIds` used to refuse outright
 *                         (returning `[]`, making every module NOT_APPLICABLE). Fixed
 *                         here: the org-wide active-employee population IS resolved
 *                         (bounded, see EXECUTIVE_ORG_WIDE_EMPLOYEE_ID_CAP) for
 *                         display/audit purposes, but daily-brief-aggregator.service.ts
 *                         gates EXECUTION through the rollup path (GROUP BY aggregation,
 *                         never per-employee module calls against 1000+ ids) — see
 *                         daily-brief-executive-rollup.module.ts.
 *
 * DEVIATION FROM PROMPT (carried over from the original MVP pass, still true): the
 * prompt describes reusing an exported `resolveTeamEmployeeIds(managerEmployeeId)` from
 * shared/dashboardScope.ts. That function exists there but is NOT exported — it is a
 * private helper used internally by `resolveDashboardScope`. This resolver instead
 * reuses the already-exported `buildScopeWhereEmployees(scope, "e")` against the
 * `DashboardScope` that `resolveDashboardScope` already returns, which is built from
 * the exact same internal computation.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import { hasRole } from "../../../shared/accessGuard.js";
import { getUserRoleContext } from "../../../shared/roleResolver.js";
import {
  DashboardScopeConfigurationError,
  buildScopeWhereEmployees,
  resolveDashboardScope,
  type DashboardScope,
} from "../../../shared/dashboardScope.js";
import type { RecipientInfo, UnresolvedRecipient } from "./daily-brief.types.js";
import { resolveEmailContact } from "../../communication/dispatch.service.js";
import { DAILY_BRIEF_ROLE_MODULES } from "./daily-brief-role-modules.js";
import { EXECUTIVE_ORG_WIDE_EMPLOYEE_ID_CAP } from "./daily-brief-editorial-constants.js";

/**
 * Full live role_key catalog this feature is scoped to — identical to
 * daily-brief-role-modules.ts's DAILY_BRIEF_ROLE_MODULES keys, reused directly (not
 * retyped) so the eligibility gate and the module-composition matrix can never drift
 * apart. `tl` is an alias of `team_leader` (see platform/policy/roles.ts ROLE_ALIASES).
 */
export const DAILY_BRIEF_ELIGIBLE_ROLES = Object.keys(DAILY_BRIEF_ROLE_MODULES) as readonly string[];

// ---------------------------------------------------------------------------
// Role families (this resolver's own classification, for team-resolution strategy
// selection only — orthogonal to, and cross-checked against, dashboardScope.ts's
// own bucket sets in KNOWN_DASHBOARD_SCOPE_ROLES below).
// ---------------------------------------------------------------------------

const DIRECT_REPORT_ROLES = new Set(["team_leader", "tl", "manager", "assistant_manager", "branch_head"]);
const PROCESS_FUNCTIONAL_ROLES = new Set(["process_manager", "wfm", "qa", "trainer"]);
const HR_RECRUITMENT_ROLES = new Set(["hr", "recruiter", "branch_admin", "branch_it", "it", "it_head"]);
const PAYROLL_FINANCE_ROLES = new Set([
  "payroll", "payroll_admin", "payroll_head", "payroll_hr", "finance", "finance_head", "accounts_head",
]);
const EXECUTIVE_ROLES = new Set(["ceo", "admin", "super_admin"]);

type RecipientFamily =
  | "direct_report"
  | "process_functional"
  | "hr_recruitment"
  | "payroll_finance"
  | "executive"
  | "unmapped";

function classifyFamily(role: string): RecipientFamily {
  const r = role.trim().toLowerCase();
  if (DIRECT_REPORT_ROLES.has(r)) return "direct_report";
  if (PROCESS_FUNCTIONAL_ROLES.has(r)) return "process_functional";
  if (HR_RECRUITMENT_ROLES.has(r)) return "hr_recruitment";
  if (PAYROLL_FINANCE_ROLES.has(r)) return "payroll_finance";
  if (EXECUTIVE_ROLES.has(r)) return "executive";
  return "unmapped";
}

/**
 * MIRROR of shared/dashboardScope.ts's own private role-bucket sets (SYSTEM_WIDE_ROLES,
 * HEAD_OFFICE_ROLES, ORG_ALL_ROLES, BRANCH_ALL_ROLES, PROCESS_OR_TEAM_ROLES, TEAM_ROLES,
 * SELF_ONLY_ROLES), union'd. None of those sets are exported — dashboardScope.ts is
 * security-sensitive shared code out of scope for this pass to edit (same constraint
 * documented in daily-brief-role-modules.ts's MODULE_GATING_ROLE_ALIASES for a similar
 * situation). This mirror exists ONLY to detect the specific contradiction documented in
 * this file's header: a role_key this feature is asked to support that dashboardScope.ts
 * has NO bucket for at all, which would otherwise silently fall through to its bottom
 * default (SELF_ONLY) rather than fail closed. Verified against the source read for this
 * pass — if dashboardScope.ts's own sets are ever edited, this mirror must be re-verified.
 */
const KNOWN_DASHBOARD_SCOPE_ROLES = new Set([
  // SYSTEM_WIDE_ROLES
  "super_admin", "admin",
  // HEAD_OFFICE_ROLES
  "ceo", "coo", "management",
  "ho_hr", "ho_payroll", "ho_operations", "ho_wfm", "ho_rta", "ho_it",
  "compliance_head", "payroll_head", "finance_head", "accounts_head", "operations_head",
  // ORG_ALL_ROLES (superset of HEAD_OFFICE_ROLES plus these)
  "hr_admin", "hr", "payroll_admin", "payroll_hr", "payroll", "finance",
  // BRANCH_ALL_ROLES
  "branch_head", "bm", "branch_manager", "branch_hr", "hr_branch", "branch_finance",
  "payroll_branch", "branch_it", "it",
  // PROCESS_OR_TEAM_ROLES
  "process_manager", "wfm_spoc", "rta", "process_hr", "qa_manager", "quality_analyst",
  "quality_lead", "qa", "operations_manager", "recruiter", "wfm",
  // TEAM_ROLES
  "manager", "assistant_manager", "team_leader", "team_lead", "tl",
  // SELF_ONLY_ROLES
  "employee", "agent", "trainee",
]);

interface RecipientEmployeeRow extends RowDataPacket {
  id: string;
  user_id: string | null;
  full_name: string;
  email: string | null;
  official_email: string | null;
  active_status: number;
}

async function loadEmployee(employeeId: string): Promise<RecipientEmployeeRow | null> {
  const [rows] = await db.execute<RecipientEmployeeRow[]>(
    `SELECT id, user_id, full_name, email, official_email, active_status
       FROM employees WHERE id = ? LIMIT 1`,
    [employeeId],
  );
  return rows[0] ?? null;
}

async function userIsActive(userId: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT is_blocked FROM auth_user WHERE id = ? LIMIT 1`,
    [userId],
  );
  const row = rows[0] as { is_blocked?: number } | undefined;
  if (!row) return false;
  return Number(row.is_blocked ?? 0) === 0;
}

/**
 * Generic employee-id-list resolution for the direct_report and process_functional
 * families (both already correctly produce TEAM_ONLY/BRANCH_ALL/PROCESS_ALL scopes via
 * resolveDashboardScope, and both want an actual per-employee id list). Deliberately
 * still refuses (returns `[]`, logged) for ORG_ALL — a role in either of these two
 * families should never legitimately resolve to ORG_ALL per dashboardScope.ts's own
 * bucket design (PROCESS_OR_TEAM_ROLES throws rather than returning ORG_ALL when no
 * process assignment exists), so this is defensive, not a live path. This function is
 * NOT used for the executive family — see loadOrgWideActiveEmployeeIds below, which is
 * a deliberate, bounded, logged widening reserved for that family only.
 */
async function loadTeamEmployeeIds(scope: DashboardScope): Promise<string[]> {
  if (scope.level === "ORG_ALL") {
    console.warn(
      `[daily-brief-recipient] loadTeamEmployeeIds refused an ORG_ALL scope for role '${scope.role}' ` +
        `(direct_report/process_functional family) — this role is not expected to resolve org-wide; ` +
        `returning an empty team rather than guessing. If this fires in production, the role's ` +
        `dashboardScope.ts bucket membership has changed and this resolver's family classification ` +
        `needs review.`,
    );
    return [];
  }
  const where = buildScopeWhereEmployees(scope, "e");
  if (where.sql === "1=0") return [];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id FROM employees e WHERE e.active_status = 1 AND ${where.sql} LIMIT 2000`,
    where.params,
  );
  return (rows as RowDataPacket[]).map((r) => String(r.id));
}

/**
 * Executive-family-only widening: the full active-employee population, bounded and
 * logged. Used ONLY to populate RecipientInfo.teamEmployeeIds for display/audit context
 * on an executive recipient — the executive rollup module never consumes this list; it
 * queries with GROUP BY aggregation directly (see daily-brief-executive-rollup.module.ts
 * and daily-brief-aggregator.service.ts's buildExecutiveDailyBrief). Per-employee module
 * calls (kpi/quality/roster/peopleRisk/helpdesk/recruitment/exit/training/attendance/
 * hygiene/actions) are never invoked against this list for an executive recipient — that
 * is exactly the "50-page email" / performance-disaster gap this pass closes.
 */
async function loadOrgWideActiveEmployeeIds(): Promise<string[]> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM employees WHERE active_status = 1 LIMIT ${EXECUTIVE_ORG_WIDE_EMPLOYEE_ID_CAP + 1}`,
    );
    const ids = (rows as RowDataPacket[]).map((r) => String(r.id));
    if (ids.length > EXECUTIVE_ORG_WIDE_EMPLOYEE_ID_CAP) {
      console.warn(
        `[daily-brief-recipient] Org-wide active employee population exceeds ` +
          `EXECUTIVE_ORG_WIDE_EMPLOYEE_ID_CAP (${EXECUTIVE_ORG_WIDE_EMPLOYEE_ID_CAP}) — truncating the ` +
          `RecipientInfo.teamEmployeeIds list carried for an executive recipient. This does not affect ` +
          `the executive rollup module's own data (it queries with GROUP BY, not this list).`,
      );
      return ids.slice(0, EXECUTIVE_ORG_WIDE_EMPLOYEE_ID_CAP);
    }
    return ids;
  } catch (err) {
    console.warn(
      `[daily-brief-recipient] loadOrgWideActiveEmployeeIds query failed — ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

export type RecipientResolution =
  | { ok: true; recipient: RecipientInfo }
  | { ok: false; unresolved: UnresolvedRecipient };

/**
 * Resolve a single employee into a daily-brief recipient, or a documented reason why
 * they cannot receive one. Never silently drops a candidate recipient.
 */
export async function resolveDailyBriefRecipient(employeeId: string): Promise<RecipientResolution> {
  const emp = await loadEmployee(employeeId);
  if (!emp) {
    return {
      ok: false,
      unresolved: { employeeId, userId: null, fullName: null, role: "unknown", reason: "No employee record found" },
    };
  }
  if (Number(emp.active_status) !== 1) {
    return {
      ok: false,
      unresolved: { employeeId, userId: emp.user_id, fullName: emp.full_name, role: "unknown", reason: "Employee is not active" },
    };
  }
  if (!emp.user_id) {
    return {
      ok: false,
      unresolved: { employeeId, userId: null, fullName: emp.full_name, role: "unknown", reason: "Employee has no linked login account" },
    };
  }
  if (!(await userIsActive(emp.user_id))) {
    return {
      ok: false,
      unresolved: { employeeId, userId: emp.user_id, fullName: emp.full_name, role: "unknown", reason: "Login account is blocked/inactive" },
    };
  }

  const eligible = await hasRole(emp.user_id, ...DAILY_BRIEF_ELIGIBLE_ROLES);
  if (!eligible) {
    return {
      ok: false,
      unresolved: {
        employeeId,
        userId: emp.user_id,
        fullName: emp.full_name,
        role: "unknown",
        reason: `Not an eligible role for the daily brief (requires one of: ${DAILY_BRIEF_ELIGIBLE_ROLES.join(", ")})`,
      },
    };
  }

  const context = await getUserRoleContext(emp.user_id);
  const normalizedRole = context.primaryRole.trim().toLowerCase();

  // Fail closed BEFORE calling into resolveDashboardScope for the roles this feature
  // supports that have no bucket at all in shared/dashboardScope.ts — see this file's
  // header ("REPO-REALITY CONTRADICTION" entries for branch_admin, it_head, trainer).
  // Calling resolveDashboardScope for these would not throw; it would silently return
  // SELF_ONLY via that function's own bottom-of-function default, which is not the
  // broad team scope this feature needs and is not distinguishable from a genuinely
  // narrow (but intentional) SELF_ONLY role without this explicit check.
  if (!KNOWN_DASHBOARD_SCOPE_ROLES.has(normalizedRole)) {
    return {
      ok: false,
      unresolved: {
        employeeId,
        userId: emp.user_id,
        fullName: emp.full_name,
        role: context.primaryRole,
        reason:
          `Role '${context.primaryRole}' has no scope-resolution bucket in shared/dashboardScope.ts ` +
          `(not in SYSTEM_WIDE_ROLES/HEAD_OFFICE_ROLES/ORG_ALL_ROLES/BRANCH_ALL_ROLES/` +
          `PROCESS_OR_TEAM_ROLES/TEAM_ROLES/SELF_ONLY_ROLES) — refusing rather than accepting that ` +
          `file's SELF_ONLY fallback, which is not a valid team scope for a daily brief.`,
      },
    };
  }

  const family = classifyFamily(normalizedRole);
  if (family === "unmapped") {
    // Should be unreachable: DAILY_BRIEF_ELIGIBLE_ROLES is exactly the union of the five
    // family sets below. Fail closed anyway rather than assume that invariant holds.
    return {
      ok: false,
      unresolved: {
        employeeId,
        userId: emp.user_id,
        fullName: emp.full_name,
        role: context.primaryRole,
        reason: `Role '${context.primaryRole}' is eligible but has no daily-brief family classification — refusing.`,
      },
    };
  }

  let scope: DashboardScope;
  try {
    scope = await resolveDashboardScope(emp.user_id, context.primaryRole);
  } catch (err) {
    // DashboardScopeConfigurationError is the fail-closed signal this resolver must
    // respect — an unconfigured scope is never widened to "everyone" or silently skipped.
    const reason = err instanceof DashboardScopeConfigurationError
      ? err.message
      : `Scope resolution failed: ${err instanceof Error ? err.message : String(err)}`;
    return {
      ok: false,
      unresolved: { employeeId, userId: emp.user_id, fullName: emp.full_name, role: context.primaryRole, reason },
    };
  }

  let teamEmployeeIds: string[];
  let scopeDescriptor: { branchIds: string[]; processIds: string[] } | undefined;
  let scopeLabel: string;

  switch (family) {
    case "direct_report":
    case "process_functional":
      teamEmployeeIds = await loadTeamEmployeeIds(scope);
      scopeLabel =
        scope.level === "TEAM_ONLY" ? "Your direct/indirect reports"
        : scope.level === "BRANCH_ALL" ? "Your branch"
        : scope.level === "PROCESS_ALL" ? "Your process"
        : scope.level;
      break;

    case "hr_recruitment":
      // hr may legitimately resolve to ORG_ALL (with an explicit 'all' grant) — per this
      // file's header, that genuine-org-wide-HR case is NOT widened to the executive
      // rollup path (out of this pass's scope; the per-employee brief is simply thinner
      // for that rare account, same limitation loadTeamEmployeeIds already logs).
      teamEmployeeIds = await loadTeamEmployeeIds(scope);
      scopeLabel =
        scope.level === "ORG_ALL" ? "Organization-wide (HR)"
        : scope.level === "BRANCH_ALL" ? "Your branch"
        : scope.level === "PROCESS_ALL" ? "Your process"
        : scope.level;
      break;

    case "payroll_finance":
      // Per daily-brief-role-modules.ts's PAYROLL_FINANCE_CONFIG, this family is wired
      // into exactly one module (payroll: "readiness"), which takes a branch/process
      // scope descriptor, not employee ids. No per-employee team is resolved — the
      // aggregator's always-on attendance/hygiene/priority-actions sections (which key
      // off teamEmployeeIds) correctly become NOT_APPLICABLE for this family, matching
      // the prompt's own example ("attendance hygiene isn't really meaningful for a
      // payroll_hr role"). scopeDescriptor is taken directly from the resolved
      // DashboardScope: for ORG_ALL-scoped roles (payroll_head/finance_head/
      // accounts_head, or payroll/payroll_hr/finance with an 'all' grant) this is
      // `{branchIds: [], processIds: []}`, which buildPayrollReadinessModule's own
      // documented scope rule already treats as "no branch/process scope at all ->
      // sees every in-flight run" — the correct behavior for an org-wide payroll role.
      teamEmployeeIds = [];
      scopeDescriptor = { branchIds: scope.branchIds, processIds: scope.processIds };
      scopeLabel =
        scope.level === "ORG_ALL" ? "Organization-wide (payroll/finance)"
        : scope.level === "BRANCH_ALL" ? "Your branch (payroll/finance)"
        : scope.level === "PROCESS_ALL" ? "Your process (payroll/finance)"
        : scope.level;
      break;

    case "executive":
      // ceo/admin/super_admin ALWAYS resolve to ORG_ALL per dashboardScope.ts's
      // SYSTEM_WIDE_ROLES/HEAD_OFFICE_ROLES short-circuit. The org-wide population is
      // resolved here (bounded) for display/audit context; execution is gated through
      // the rollup path by the aggregator (see this file's header + module doc).
      teamEmployeeIds = await loadOrgWideActiveEmployeeIds();
      scopeDescriptor = { branchIds: [], processIds: [] };
      scopeLabel = "Organization-wide (executive rollup)";
      break;
  }

  const email = resolveEmailContact({ email: emp.email, official_email: emp.official_email }, true);

  return {
    ok: true,
    recipient: {
      employeeId: emp.id,
      userId: emp.user_id,
      fullName: emp.full_name,
      role: context.primaryRole,
      // Every active role the account holds, so a multi-role recipient (e.g.
      // team_leader + qa) can be given the UNION of applicable modules by the
      // integration pass's role-modules matrix instead of just the primary role's
      // set — see daily-brief.types.ts's RecipientInfo.allRoles doc comment.
      allRoles: context.roleKeys,
      scopeLabel,
      teamEmployeeIds,
      email,
      scopeDescriptor,
    },
  };
}

/**
 * All active, role-eligible employees for the daily brief, each resolved (or recorded
 * as unresolved). Used by the (not-yet-wired) dispatch job; the preview route resolves
 * a single employee via resolveDailyBriefRecipient instead.
 */
export async function resolveAllEligibleRecipients(): Promise<{
  resolved: RecipientInfo[];
  unresolved: UnresolvedRecipient[];
}> {
  const placeholders = DAILY_BRIEF_ELIGIBLE_ROLES.map(() => "?").join(",");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT e.id
       FROM employees e
       JOIN user_roles ur ON ur.user_id = e.user_id AND ur.active_status = 1
      WHERE e.active_status = 1
        AND e.user_id IS NOT NULL
        AND ur.role_key IN (${placeholders})
      LIMIT 5000`,
    [...DAILY_BRIEF_ELIGIBLE_ROLES],
  );
  const resolved: RecipientInfo[] = [];
  const unresolved: UnresolvedRecipient[] = [];
  for (const row of rows as RowDataPacket[]) {
    const result = await resolveDailyBriefRecipient(String(row.id));
    if (result.ok) resolved.push(result.recipient);
    else unresolved.push(result.unresolved);
  }
  return { resolved, unresolved };
}
