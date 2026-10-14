import type { GuideActivity, GuideModule, RoleGuide } from "./types";

export type { GuideActivity, GuideModule, RoleGuide, GuideStep, GuideQA, GuideIconKey, GuideTone, GuideFrequency } from "./types";

/**
 * Lightweight metadata for every role guide. The full content of each guide lives in its own
 * module under ./roles and is loaded on demand, so opening the guide only downloads the role the
 * user is looking at. Keep `key`, `roleLabel` and `appRoles` in step with the role file.
 */
export type RoleGuideMeta = {
  key: string;
  roleLabel: string;
  /** One-line summary for the role picker. */
  blurb: string;
  appRoles: string[];
  /** Internal staff get the shared "Getting started" and "Self-service" sections too. */
  audience: "staff" | "external";
  group: "Everyone" | "Leadership & Admin" | "HR & Hiring" | "Payroll & Finance" | "Operations" | "Support Functions" | "Outside MAS";
};

/**
 * Order matters: when a user holds several roles, the first matching guide in this list is opened
 * by default (most senior / most specific first). The user can switch to any other guide.
 */
export const ROLE_GUIDES: RoleGuideMeta[] = [
  { key: "super_admin",        roleLabel: "Super Admin / Admin",              blurb: "Logins, roles, page access, masters, integrations, audit", appRoles: ["super_admin", "admin"], audience: "staff", group: "Leadership & Admin" },
  { key: "leadership",         roleLabel: "CEO / COO / Management",           blurb: "Dashboards, P&L, voucher and payroll approvals",            appRoles: ["ceo", "coo", "management"], audience: "staff", group: "Leadership & Admin" },
  { key: "payroll_head",       roleLabel: "Payroll Head / Payroll Admin",     blurb: "Salary review, validation, sign-off, payment center",      appRoles: ["payroll_head", "payroll_admin"], audience: "staff", group: "Payroll & Finance" },
  { key: "finance",            roleLabel: "Finance / Accounts",               blurb: "Budgets, GRN, vouchers, banking, billing, GST",             appRoles: ["finance", "finance_head", "accounts_head"], audience: "staff", group: "Payroll & Finance" },
  { key: "branch_head",        roleLabel: "Branch Head",                      blurb: "Branch approvals: offers, leave, budget, payroll readiness", appRoles: ["branch_head"], audience: "staff", group: "Operations" },
  { key: "branch_admin",       roleLabel: "Branch Admin",                     blurb: "Branch budget, GRNs, provisioning, gate passes",            appRoles: ["branch_admin"], audience: "staff", group: "Support Functions" },
  { key: "hr",                 roleLabel: "HR Admin / Branch HR",             blurb: "Employee records, onboarding, BGV, leave, exits, letters",  appRoles: ["hr", "hr_admin", "hr_head", "branch_hr", "hr_branch", "ho_hr", "process_hr"], audience: "staff", group: "HR & Hiring" },
  { key: "payroll",            roleLabel: "Payroll Executive / Payroll HR",   blurb: "Payroll run, payslips, statutory, PF, F&F",                 appRoles: ["payroll", "payroll_hr", "payroll_branch", "ho_payroll"], audience: "staff", group: "Payroll & Finance" },
  { key: "recruiter",          roleLabel: "Recruiter / Recruitment HR",       blurb: "ATS: requisitions, walk-ins, interviews, Meta leads",       appRoles: ["recruiter", "recruitment_hr"], audience: "staff", group: "HR & Hiring" },
  { key: "interviewer",        roleLabel: "Interviewer / Ops Round Panel",    blurb: "Ops round verdicts and what happens next",                  appRoles: ["interviewer"], audience: "staff", group: "HR & Hiring" },
  { key: "operations_manager", roleLabel: "Operations Manager",               blurb: "Ops dashboard, control tower, process analytics",           appRoles: ["operations_manager"], audience: "staff", group: "Operations" },
  { key: "process_manager",    roleLabel: "Process Manager / Manager",        blurb: "Team approvals, roster, salary verification, KPIs",         appRoles: ["process_manager", "manager", "assistant_manager"], audience: "staff", group: "Operations" },
  { key: "team_leader",        roleLabel: "Team Leader",                      blurb: "My Team, leave & regularization, team roster, coaching",    appRoles: ["team_leader", "tl"], audience: "staff", group: "Operations" },
  { key: "wfm",                roleLabel: "WFM / RTA",                        blurb: "Rosters, live adherence, attendance integrity, breaks",     appRoles: ["wfm", "wfm_spoc", "wfm_analyst", "branch_wfm", "ho_wfm", "rta"], audience: "staff", group: "Operations" },
  { key: "qa",                 roleLabel: "QA / Quality Analyst / TQ Head",   blurb: "Audit forms, call scoring, TNI, quality analytics",         appRoles: ["qa", "quality_analyst", "tq_head"], audience: "staff", group: "Operations" },
  { key: "trainer",            roleLabel: "Trainer / LMS Coordinator",        blurb: "LMS batches, assessments, readiness, handover",             appRoles: ["trainer"], audience: "staff", group: "Operations" },
  { key: "it",                 roleLabel: "IT / IT Admin",                    blurb: "Joiner IT setup, access closure, assets, gate passes",      appRoles: ["it", "it_admin", "branch_it", "it_head"], audience: "staff", group: "Support Functions" },
  { key: "security",           roleLabel: "Security / Reception Desk",        blurb: "Visitors, break desk, gate pass verification",              appRoles: ["security_head", "visitor_security", "visitor_reception"], audience: "staff", group: "Support Functions" },
  { key: "employee",           roleLabel: "Employee (Self-Service)",          blurb: "Profile, attendance, leave, payslips, tax, resignation",    appRoles: ["employee", "agent"], audience: "staff", group: "Everyone" },
  { key: "everyone",           roleLabel: "Everyone — Getting Started",       blurb: "Sign in, passwords, navigation, inbox, Mira, help",         appRoles: [], audience: "staff", group: "Everyone" },
  { key: "new_joiner",         roleLabel: "Candidate / New Joiner",           blurb: "Interview registration, joining form, eSign, first login",  appRoles: [], audience: "external", group: "Outside MAS" },
  { key: "client",             roleLabel: "Client (Client Portal)",           blurb: "Client portal sign-in, KPIs, RAG, reports",                 appRoles: ["client"], audience: "external", group: "Outside MAS" },
];

export const ROLE_GUIDE_GROUPS: RoleGuideMeta["group"][] = [
  "Everyone", "Leadership & Admin", "HR & Hiring", "Payroll & Finance", "Operations", "Support Functions", "Outside MAS",
];

const LOADERS: Record<string, () => Promise<RoleGuide>> = {
  super_admin:        () => import("./roles/superAdmin").then((m) => m.superAdminGuide),
  leadership:         () => import("./roles/leadership").then((m) => m.leadershipGuide),
  payroll_head:       () => import("./roles/payrollHead").then((m) => m.payrollHeadGuide),
  finance:            () => import("./roles/finance").then((m) => m.financeGuide),
  branch_head:        () => import("./roles/branchHead").then((m) => m.branchHeadGuide),
  branch_admin:       () => import("./roles/branchAdmin").then((m) => m.branchAdminGuide),
  hr:                 () => import("./roles/hr").then((m) => m.hrGuide),
  payroll:            () => import("./roles/payroll").then((m) => m.payrollGuide),
  recruiter:          () => import("./roles/recruiter").then((m) => m.recruiterGuide),
  interviewer:        () => import("./roles/interviewer").then((m) => m.interviewerGuide),
  operations_manager: () => import("./roles/operationsManager").then((m) => m.operationsManagerGuide),
  process_manager:    () => import("./roles/processManager").then((m) => m.processManagerGuide),
  team_leader:        () => import("./roles/teamLeader").then((m) => m.teamLeaderGuide),
  wfm:                () => import("./roles/wfm").then((m) => m.wfmGuide),
  qa:                 () => import("./roles/qa").then((m) => m.qaGuide),
  trainer:            () => import("./roles/trainer").then((m) => m.trainerGuide),
  it:                 () => import("./roles/it").then((m) => m.itGuide),
  security:           () => import("./roles/security").then((m) => m.securityGuide),
  employee:           () => import("./roles/employee").then((m) => m.employeeGuide),
  everyone:           () => import("./roles/everyone").then((m) => m.everyoneGuide),
  new_joiner:         () => import("./roles/newJoiner").then((m) => m.newJoinerGuide),
  client:             () => import("./roles/client").then((m) => m.clientGuide),
};

const cache = new Map<string, Promise<RoleGuide>>();

export function getRoleGuideMeta(key: string | null | undefined): RoleGuideMeta | undefined {
  return ROLE_GUIDES.find((g) => g.key === key);
}

export function loadRoleGuide(key: string): Promise<RoleGuide> {
  const loader = LOADERS[key];
  if (!loader) return Promise.reject(new Error(`Unknown guide: ${key}`));
  let p = cache.get(key);
  if (!p) {
    p = loader();
    // Do not cache failures (e.g. a chunk that failed to download) so a retry can succeed.
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

export function loadAllRoleGuides(keys: string[] = ROLE_GUIDES.map((g) => g.key)): Promise<RoleGuide[]> {
  return Promise.all(keys.filter((k) => LOADERS[k]).map((k) => loadRoleGuide(k)));
}

// ─── Role scoping ────────────────────────────────────────────────────────────

/** Roles that administer everyone's access, so they may read every guide. */
const SEE_ALL_ROLES = ["super_admin", "admin"];

/**
 * Guides a role may read on top of its own, because the job involves walking someone else through
 * that guide (a recruiter helping a candidate fill the joining form, an ops manager sitting on the
 * interview panel). Keyed by guide key.
 */
const RELATED_GUIDES: Record<string, string[]> = {
  hr: ["new_joiner"],
  recruiter: ["new_joiner", "interviewer"],
  operations_manager: ["interviewer"],
  process_manager: ["interviewer"],
};

/**
 * The guide keys a user is allowed to open, in display order.
 * - Super Admin / Admin: every guide.
 * - Client-only logins: the Client guide only.
 * - Everyone else: the guides matching their roles, plus Employee self-service and Getting Started,
 *   plus the related guides above. With no resolvable role, Employee + Getting Started.
 */
export function allowedGuideKeys(roleKeys: string[]): string[] {
  const have = new Set(roleKeys.map((r) => r.toLowerCase()));
  if (SEE_ALL_ROLES.some((r) => have.has(r))) return ROLE_GUIDES.map((g) => g.key);

  const own = guidesForRoles(roleKeys).map((g) => g.key);
  if (own.length === 1 && own[0] === "client") return ["client"];

  const keys = new Set<string>(own);
  for (const k of own) for (const extra of RELATED_GUIDES[k] ?? []) keys.add(extra);
  keys.add("employee");
  keys.add("everyone");
  return ROLE_GUIDES.map((g) => g.key).filter((k) => keys.has(k));
}

/** Guides that match the signed-in user's role keys, best match first. Always includes Employee for staff. */
export function guidesForRoles(roleKeys: string[]): RoleGuideMeta[] {
  const have = new Set(roleKeys.map((r) => r.toLowerCase()));
  const matched = ROLE_GUIDES.filter((g) => g.appRoles.some((r) => have.has(r)));
  const isClient = have.has("client") && matched.every((g) => g.key === "client");
  if (!isClient && !matched.some((g) => g.key === "employee") && roleKeys.length > 0) {
    const emp = getRoleGuideMeta("employee");
    if (emp) matched.push(emp);
  }
  return matched;
}

// ─── Search ──────────────────────────────────────────────────────────────────

export type GuideSearchHit = {
  roleKey: string;
  roleLabel: string;
  module: GuideModule;
  activity: GuideActivity;
  score: number;
};

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

function activityHaystack(a: GuideActivity, m: GuideModule): { strong: string; weak: string } {
  const strong = norm([a.title, ...(a.tags ?? []), m.title].join(" \u0001 "));
  const weak = norm([
    a.description,
    a.menuPath ?? "",
    a.path ?? "",
    ...a.steps.map((s) => `${s.action} ${s.detail ?? ""}`),
    ...(a.troubleshooting ?? []).map((t) => `${t.q} ${t.a}`),
    ...(a.prerequisites ?? []),
    a.screenGuide ?? "",
    a.tip ?? "",
    a.afterThis ?? "",
  ].join(" \u0001 "));
  return { strong, weak };
}

/**
 * Every whitespace-separated term must appear somewhere in the activity. Title/tag/module hits
 * outrank body hits; an exact phrase match in the title ranks highest.
 */
export function searchGuides(guides: RoleGuide[], query: string, limit = 60): GuideSearchHit[] {
  const q = norm(query.trim());
  if (q.length < 2) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  const hits: GuideSearchHit[] = [];
  for (const g of guides) {
    for (const m of g.modules) {
      for (const a of m.activities) {
        const { strong, weak } = activityHaystack(a, m);
        let score = 0;
        let ok = true;
        for (const t of terms) {
          if (strong.includes(t)) score += 10;
          else if (weak.includes(t)) score += 2;
          else { ok = false; break; }
        }
        if (!ok) continue;
        if (norm(a.title).includes(q)) score += 25;
        hits.push({ roleKey: g.key, roleLabel: g.roleLabel, module: m, activity: a, score });
      }
    }
  }
  return hits.sort((x, y) => y.score - x.score).slice(0, limit);
}

export function countActivities(guide: RoleGuide): number {
  return guide.modules.reduce((n, m) => n + m.activities.length, 0);
}
