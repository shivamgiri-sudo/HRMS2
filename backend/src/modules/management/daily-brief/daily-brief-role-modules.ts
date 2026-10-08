/**
 * Role -> module composition matrix for the D-1 Daily Manager Briefing Engine
 * integration pass.
 *
 * Scope note (read before extending this file): `daily-brief-recipient.resolver.ts`'s
 * `DAILY_BRIEF_ELIGIBLE_ROLES` today only admits team_leader/tl/manager/branch_head as
 * daily-brief RECIPIENTS at all (its own header explains why — MVP scope, "widening
 * this list is a separate, explicit step"). This file's matrix is deliberately built
 * against the FULL live role_key catalog per this integration pass's brief, so the
 * aggregator's module-resolution logic is ready the moment that resolver gate widens —
 * but until that separate step happens, only team_leader/tl/manager/branch_head rows
 * below are actually reachable in production. This is flagged explicitly in the
 * integration report as a real, pre-existing scope mismatch this pass did not create
 * and was not asked to resolve.
 *
 * Only role_keys verified live (per the governing prompt's ground truth) are given
 * entries: team_leader, tl, manager, assistant_manager, process_manager, branch_head,
 * branch_admin, wfm, qa, trainer, hr, branch_it, recruiter, payroll, payroll_admin,
 * payroll_head, payroll_hr, finance, finance_head, accounts_head, it, it_head, ceo,
 * admin, super_admin. No entries for coo/operations_manager — not live.
 *
 * Detail-level / scope-mode choices below are this integration pass's own judgment
 * call about which of the eleven already-built modules make sense for a given role,
 * not a discovered spec table — flagged here rather than presented as settled.
 */
import type { KpiDirection } from "./daily-brief-kpi.module.js";

export type KpiQualityDetailLevel = "summary" | "diagnostic";
export type HelpdeskDetailLevelSetting = "operational" | "detailed";
export type TeamOrHrScope = "team" | "hr";
export type PayrollDetailSetting = "readiness" | "hint";

/** Which of the eleven now-available modules apply to a role, and at what detail level.
 * A key absent from this object means that module is OMITTED for this role — not
 * merely empty. `roster` additionally requires the caller to supply a process/branch
 * scope; a role with roster:true but no scope resolves to that module's own
 * NOT_APPLICABLE, not a crash. */
export interface RoleModuleConfig {
  kpi?: KpiQualityDetailLevel;
  quality?: KpiQualityDetailLevel;
  roster?: boolean;
  peopleRisk?: boolean;
  helpdesk?: HelpdeskDetailLevelSetting;
  recruitment?: TeamOrHrScope;
  exit?: TeamOrHrScope;
  training?: boolean;
  payroll?: PayrollDetailSetting;
  /**
   * Executive rule (spec §29): CEO/super_admin/admin should get an aggregate/rollup
   * view, not per-employee exception lists. KNOWN MVP GAP (see integration report):
   * no dedicated rollup engine exists in any of the eleven modules today — every
   * module here still returns TEAM_ONLY/BRANCH_ALL-shaped per-employee data, scoped
   * by whatever teamEmployeeIds the recipient resolver hands it. Marking a role
   * isExecutiveRollup:true does NOT currently change module behavior; it is a
   * deliberate signal for a follow-up pass and for the aggregator to annotate
   * sourceHealth so the gap is visible in the payload rather than silently absent.
   * These roles are still wired into every module that makes sense at whatever
   * granularity exists today (aggregate counts), per this pass's explicit instruction
   * not to skip them entirely.
   */
  isExecutiveRollup?: boolean;
}

// Unused re-export kept only so KpiDirection stays a live import if a future
// aggregator revision wants to branch on it here; avoids an eslint no-unused-vars
// trip while documenting the type is deliberately available to this file's callers.
export type { KpiDirection };

const TEAM_LEADER_CONFIG: RoleModuleConfig = {
  kpi: "summary",
  quality: "summary",
  peopleRisk: true,
  helpdesk: "operational",
  exit: "team",
  training: true,
  payroll: "hint",
};

const MANAGER_CONFIG: RoleModuleConfig = {
  kpi: "summary",
  quality: "summary",
  roster: true,
  peopleRisk: true,
  helpdesk: "operational",
  exit: "team",
  training: true,
  payroll: "hint",
};

const BRANCH_HEAD_CONFIG: RoleModuleConfig = {
  kpi: "summary",
  quality: "summary",
  roster: true,
  peopleRisk: true,
  helpdesk: "operational",
  exit: "team",
  training: true,
  payroll: "hint",
};

/** branch_admin is administrative, not people-manager-adjacent per
 * daily-brief-people-risk.module.ts's own PEOPLE_MANAGER_ADJACENT_ROLES list —
 * peopleRisk/exit omitted here rather than requested-and-ignored. */
const BRANCH_ADMIN_CONFIG: RoleModuleConfig = {
  kpi: "summary",
  quality: "summary",
  roster: true,
  helpdesk: "operational",
  training: true,
  payroll: "hint",
};

const WFM_CONFIG: RoleModuleConfig = {
  roster: true,
};

const QA_CONFIG: RoleModuleConfig = {
  quality: "diagnostic",
};

const TRAINER_CONFIG: RoleModuleConfig = {
  training: true,
};

const HR_CONFIG: RoleModuleConfig = {
  peopleRisk: true,
  exit: "hr",
  recruitment: "hr",
  training: true,
  helpdesk: "operational",
};

const IT_CONFIG: RoleModuleConfig = {
  helpdesk: "detailed",
};

const RECRUITER_CONFIG: RoleModuleConfig = {
  recruitment: "team",
};

/** Payroll/finance roles per PAYROLL_ROLES (platform/policy/roles.ts) — the ONLY
 * roles ever allowed to receive buildPayrollReadinessModule's output. See
 * daily-brief-aggregator.service.ts's role gate for the enforcement point (this
 * matrix expresses intent; the aggregator is what actually refuses). */
const PAYROLL_FINANCE_CONFIG: RoleModuleConfig = {
  payroll: "readiness",
};

/** CEO/admin/super_admin — see isExecutiveRollup doc above.
 *
 * ROLLUP WIRING (this pass): isExecutiveRollup now actually changes behavior.
 * daily-brief-aggregator.service.ts's buildExecutiveDailyBrief() checks this flag and,
 * when set, calls daily-brief-executive-rollup.module.ts instead of the per-employee
 * module set below — so the kpi/quality/roster/peopleRisk/helpdesk/recruitment/exit/
 * training fields on THIS config object are no longer consulted for these three roles;
 * they are kept here only so a multi-role account holding one of these plus a
 * direct-report role still gets a sensible merged config for the (non-rollup) fallback
 * defined by resolveModulesForRoles.
 *
 * PAYROLL — REPO-REALITY CONTRADICTION, corrected here: this config previously claimed
 * "payroll included because all three are members of PAYROLL_ROLES"
 * (platform/policy/roles.ts). That is FALSE for `ceo` — PAYROLL_ROLES is
 * [super_admin, admin, payroll, payroll_head, payroll_branch, payroll_hr, finance,
 * finance_head, accounts_head]; `ceo` is not a member (verified by reading the file).
 * `payroll: "readiness"` is left on this shared config anyway because the actual
 * security gate is buildPayrollReadinessModule's own isPayrollEntitledRole() check
 * (daily-brief-payroll.module.ts), re-verified independently by the aggregator's
 * hasRole(...PAYROLL_ROLES) call before ever invoking it — for `ceo` specifically that
 * call resolves false, so `ceo`'s executive rollup gets NO payroll detail at all
 * (neither the per-employee path nor the rollup path ever reaches
 * buildPayrollReadinessModule for `ceo`). admin/super_admin (both true PAYROLL_ROLES
 * members) get the real aggregate readiness detail.
 */
const EXECUTIVE_CONFIG: RoleModuleConfig = {
  kpi: "summary",
  quality: "summary",
  roster: true,
  peopleRisk: true,
  helpdesk: "operational",
  recruitment: "hr",
  exit: "hr",
  training: true,
  payroll: "readiness",
  isExecutiveRollup: true,
};

export const DAILY_BRIEF_ROLE_MODULES: Readonly<Record<string, RoleModuleConfig>> = {
  team_leader: TEAM_LEADER_CONFIG,
  tl: TEAM_LEADER_CONFIG,
  manager: MANAGER_CONFIG,
  assistant_manager: MANAGER_CONFIG,
  process_manager: MANAGER_CONFIG,
  branch_head: BRANCH_HEAD_CONFIG,
  branch_admin: BRANCH_ADMIN_CONFIG,
  wfm: WFM_CONFIG,
  qa: QA_CONFIG,
  trainer: TRAINER_CONFIG,
  hr: HR_CONFIG,
  branch_it: IT_CONFIG,
  recruiter: RECRUITER_CONFIG,
  payroll: PAYROLL_FINANCE_CONFIG,
  payroll_admin: PAYROLL_FINANCE_CONFIG,
  payroll_head: PAYROLL_FINANCE_CONFIG,
  payroll_hr: PAYROLL_FINANCE_CONFIG,
  finance: PAYROLL_FINANCE_CONFIG,
  finance_head: PAYROLL_FINANCE_CONFIG,
  accounts_head: PAYROLL_FINANCE_CONFIG,
  it: IT_CONFIG,
  it_head: IT_CONFIG,
  ceo: EXECUTIVE_CONFIG,
  admin: EXECUTIVE_CONFIG,
  super_admin: EXECUTIVE_CONFIG,
};

/**
 * Roles whose gating string inside an already-built module (daily-brief-exit.module.ts's
 * TEAM_ROLES/HR_ROLES, daily-brief-people-risk.module.ts's PEOPLE_MANAGER_ADJACENT_ROLES)
 * uses a DIFFERENT literal than the role_key this matrix/the RBAC alias table
 * (platform/policy/roles.ts's ROLE_ALIASES) treats as equivalent. Concretely:
 * `process_manager` and `assistant_manager` are RBAC-equivalent to `manager`
 * (ROLE_ALIASES / MANAGEMENT_ROLES conventions) but neither exit.module.ts's TEAM_ROLES
 * nor people-risk.module.ts's PEOPLE_MANAGER_ADJACENT_ROLES literal sets include them —
 * calling those two modules with the raw role string "process_manager" would silently
 * return NOT_APPLICABLE for a role this matrix says should see exit/people-risk data.
 * REAL REPO CONTRADICTION flagged in the integration report, fixed here (not by editing
 * the two modules' internal string sets) by canonicalizing the role passed to them.
 */
const MODULE_GATING_ROLE_ALIASES: Readonly<Record<string, string>> = {
  process_manager: "manager",
  assistant_manager: "manager",
};

/** Canonical role string to pass into a module that does its OWN internal role-string
 * gating (buildExitModule, buildPeopleRiskModule) — see MODULE_GATING_ROLE_ALIASES. */
export function canonicalRoleForModuleGating(role: string): string {
  const normalized = role.trim().toLowerCase();
  return MODULE_GATING_ROLE_ALIASES[normalized] ?? role;
}

/**
 * Union the module configs applicable across every role a recipient holds (spec
 * requirement: a multi-role recipient gets ONE merged brief, not one per role).
 * Merge rule per field: booleans OR together; detail-level fields take the "richer"
 * level across roles (diagnostic/detailed beats summary/operational); scope-mode
 * fields prefer "hr" over "team" (broader access wins, never narrower); payroll
 * prefers "readiness" over "hint" (a role entitled to the real detail should not be
 * downgraded to the safe hint because another held role only qualifies for the hint —
 * the aggregator still re-verifies PAYROLL_ROLES membership before ever calling the
 * readiness path, so this union is intent-only, not the security gate itself).
 * isExecutiveRollup is OR'd — any held executive role marks the whole brief.
 *
 * Design choice: this merge lives here (not duplicated in the aggregator) because the
 * matrix and the merge rule are two halves of the same decision — "what does role
 * membership entitle you to" — and keeping them in one file means a new role's entry
 * automatically participates in multi-role merging correctly without the aggregator
 * needing its own copy of the precedence rules.
 */
export function resolveModulesForRoles(roles: readonly string[]): RoleModuleConfig {
  const merged: RoleModuleConfig = {};
  const detailRank: Record<string, number> = { summary: 0, diagnostic: 1, operational: 0, detailed: 1 };
  const scopeRank: Record<TeamOrHrScope, number> = { team: 0, hr: 1 };
  const payrollRank: Record<PayrollDetailSetting, number> = { hint: 0, readiness: 1 };

  for (const rawRole of roles) {
    const config = DAILY_BRIEF_ROLE_MODULES[rawRole.trim().toLowerCase()];
    if (!config) continue;

    if (config.kpi && (!merged.kpi || detailRank[config.kpi] > detailRank[merged.kpi])) {
      merged.kpi = config.kpi;
    }
    if (config.quality && (!merged.quality || detailRank[config.quality] > detailRank[merged.quality])) {
      merged.quality = config.quality;
    }
    if (config.roster) merged.roster = true;
    if (config.peopleRisk) merged.peopleRisk = true;
    if (config.helpdesk && (!merged.helpdesk || detailRank[config.helpdesk] > detailRank[merged.helpdesk])) {
      merged.helpdesk = config.helpdesk;
    }
    if (config.recruitment && (!merged.recruitment || scopeRank[config.recruitment] > scopeRank[merged.recruitment])) {
      merged.recruitment = config.recruitment;
    }
    if (config.exit && (!merged.exit || scopeRank[config.exit] > scopeRank[merged.exit])) {
      merged.exit = config.exit;
    }
    if (config.training) merged.training = true;
    if (config.payroll && (!merged.payroll || payrollRank[config.payroll] > payrollRank[merged.payroll])) {
      merged.payroll = config.payroll;
    }
    if (config.isExecutiveRollup) merged.isExecutiveRollup = true;
  }

  return merged;
}
