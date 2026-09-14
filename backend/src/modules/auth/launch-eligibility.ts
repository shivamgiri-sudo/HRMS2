import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * ONE launch eligibility resolver, consumed by BOTH GET /launch-readiness and
 * POST /bootstrap-existing-users.
 *
 * WHY THIS EXISTS
 * The two endpoints used to answer "can this employee log in?" differently, and
 * readiness was the optimistic one. Verified live against mas_hrms on 2026-08-16
 * (1,327 active employees):
 *
 *   readiness counted e.user_id IS NULL          -> 338 "without login"
 *   truth is 389: 338 NULL **plus 51 dangling**  -> employees.user_id pointing at
 *                                                   no auth_user row at all
 *   readiness counted COALESCE(e.email,'') = ''  -> 337 "without email"
 *   truth is 389: the literal string 'NA' is not blank but has no '@', so the
 *                 bootstrap's normalizeEmail() rejects it while readiness passed it
 *
 * Net effect: 53 employees were reported launch-ready that the bootstrap provably
 * could not provision, and the readiness payload had no verdict field, so the
 * aggregate could never turn red. Both endpoints now derive every number here.
 *
 * LOGIN IDENTITY (owner decision, 2026-08-16 — Option C)
 * "Official email preferred, with an explicitly-approved verified fallback."
 * employees carries four address columns and the launch code used only `email`,
 * which is the PERSONAL one: of 938 valid values, 851 are gmail and ~68 are a
 * company domain. `official_email` is valid on 1,153 but is itself 700 gmail.
 * Coalescing office -> official -> email reaches 1,224 of 1,327, and 286 employees
 * have no usable `email` at all yet do have an official/office address.
 *
 * So we pick a COMPANY-DOMAIN address wherever one exists, and where only a
 * personal address exists we classify EMAIL_NEEDS_APPROVAL rather than silently
 * mailing a 24-hour password-set link to someone's Gmail. That fallback is
 * provisioned only when the caller explicitly opts in.
 */

/** Employment-status values that mean "do not provision a login at launch". */
const BLOCKED_EMPLOYMENT_STATUSES = new Set(["resigned", "exited", "terminated", "absconded", "suspended"]);

const DEFAULT_COMPANY_EMAIL_DOMAINS = "teammas.co.in,teammas.in,mascallnet.com";

/**
 * Company-owned mail domains. Overridable so IT can add a domain without a code
 * change; the default is what the live data actually contains.
 */
export function companyEmailDomains(): string[] {
  const raw = process.env.LAUNCH_COMPANY_EMAIL_DOMAINS || DEFAULT_COMPANY_EMAIL_DOMAINS;
  return raw
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

export function normalizeEmail(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  return email.includes("@") ? email : null;
}

function isCompanyDomain(email: string): boolean {
  const domain = email.split("@")[1] ?? "";
  return companyEmailDomains().includes(domain);
}

export type EmailSource = "office_email" | "official_email" | "email";

export interface ResolvedLoginEmail {
  email: string | null;
  source: EmailSource | null;
  /** True when the chosen address is on a company-owned domain. */
  company: boolean;
  /** True when SOME address was present but none of them parsed as an email. */
  hadUnusableValue: boolean;
}

export interface LaunchEmailColumns {
  email?: string | null;
  official_email?: string | null;
  office_email?: string | null;
}

/**
 * Option C in code: prefer a company-domain address from any of the three
 * columns; otherwise fall back to the first syntactically valid address and flag
 * it as needing approval (company === false).
 */
export function resolveLoginEmail(row: LaunchEmailColumns): ResolvedLoginEmail {
  const candidates: Array<[EmailSource, string | null | undefined]> = [
    ["office_email", row.office_email],
    ["official_email", row.official_email],
    ["email", row.email],
  ];

  const present = candidates.filter(([, v]) => String(v ?? "").trim() !== "");
  const parsed = present
    .map(([source, v]) => ({ source, email: normalizeEmail(v) }))
    .filter((c): c is { source: EmailSource; email: string } => c.email !== null);

  const official = parsed.find((c) => isCompanyDomain(c.email));
  if (official) return { email: official.email, source: official.source, company: true, hadUnusableValue: false };

  if (parsed[0]) return { email: parsed[0].email, source: parsed[0].source, company: false, hadUnusableValue: false };

  return { email: null, source: null, company: false, hadUnusableValue: present.length > 0 };
}

export type LaunchEligibilityState =
  | "READY"
  | "BLOCKED"
  | "NO_EMPLOYEE_CODE"
  | "NO_LOGIN_IDENTITY"
  | "INVALID_EMAIL"
  | "EMAIL_NEEDS_APPROVAL"
  | "DANGLING_USER_ID"
  | "NO_AUTH_ACCOUNT"
  | "ROLE_UNMAPPED"
  | "SCOPE_UNMAPPED"
  | "INVITE_NOT_PREPARED"
  | "INVITE_FAILED";

/** States that mean the employee cannot log in on day one. */
export const BLOCKING_STATES: ReadonlySet<LaunchEligibilityState> = new Set<LaunchEligibilityState>([
  "BLOCKED",
  "NO_EMPLOYEE_CODE",
  "NO_LOGIN_IDENTITY",
  "INVALID_EMAIL",
  "EMAIL_NEEDS_APPROVAL",
  "DANGLING_USER_ID",
  "NO_AUTH_ACCOUNT",
  "ROLE_UNMAPPED",
  "SCOPE_UNMAPPED",
  "INVITE_NOT_PREPARED",
  "INVITE_FAILED",
]);

export type LaunchEmployeeRow = RowDataPacket & {
  id: string;
  employee_code?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  official_email?: string | null;
  office_email?: string | null;
  user_id?: string | null;
  employment_status?: string | null;
  branch_id?: string | null;
  process_id?: string | null;
  process_name?: string | null;
  branch_name?: string | null;
  designation_name?: string | null;
  department_name?: string | null;
  auth_user_id?: string | null;
  active_role_count?: number | null;
  privileged_role_count?: number | null;
  scope_row_count?: number | null;
  invite_status?: string | null;
};

export interface LaunchEligibility {
  employeeId: string;
  employeeCode: string;
  name: string;
  state: LaunchEligibilityState;
  reason: string;
  /** The account the employee would actually use, after Option C resolution. */
  loginEmail: string | null;
  emailSource: EmailSource | null;
  companyEmail: boolean;
  /** Resolved auth_user id, or null when no live account backs this employee. */
  authUserId: string | null;
  branch: string | null;
  process: string | null;
  designation: string | null;
  department: string | null;
}

const n = (v: unknown): number => Number(v ?? 0);

/**
 * Classify one employee. Order matters: the FIRST blocking reason wins, so the
 * reported state is the thing that must be fixed next for that person.
 *
 * `authUserEmails` maps lowercased auth_user.email -> id, so an employee whose
 * account exists under their address but was never linked resolves correctly
 * instead of being reported as having no account.
 */
export function classifyLaunchEmployee(
  row: LaunchEmployeeRow,
  authUserEmails: Map<string, string>,
  options: { allowPersonalEmailFallback?: boolean } = {}
): LaunchEligibility {
  const allowPersonalEmailFallback = options.allowPersonalEmailFallback ?? false;
  const resolved = resolveLoginEmail(row);
  const employeeCode = String(row.employee_code ?? "").trim();

  // employees.user_id is only trustworthy when the row it names actually exists.
  const linkedAuthUserId = row.auth_user_id ? String(row.auth_user_id) : null;
  const byEmail = resolved.email ? authUserEmails.get(resolved.email) ?? null : null;
  const authUserId = linkedAuthUserId ?? byEmail;

  const base = {
    employeeId: String(row.id),
    employeeCode,
    name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || "Team Member",
    loginEmail: resolved.email,
    emailSource: resolved.source,
    companyEmail: resolved.company,
    authUserId,
    branch: row.branch_name ?? null,
    process: row.process_name ?? null,
    designation: row.designation_name ?? null,
    department: row.department_name ?? null,
  };

  const at = (state: LaunchEligibilityState, reason: string): LaunchEligibility => ({ ...base, state, reason });

  const employmentStatus = String(row.employment_status ?? "").trim().toLowerCase();
  if (BLOCKED_EMPLOYMENT_STATUSES.has(employmentStatus)) {
    return at("BLOCKED", `Employment status is '${employmentStatus}' — no launch login should be issued`);
  }

  if (!employeeCode) return at("NO_EMPLOYEE_CODE", "Employee has no employee_code");

  if (!resolved.email) {
    return resolved.hadUnusableValue
      ? at("INVALID_EMAIL", "An address is recorded but none of office/official/personal parses as an email")
      : at("NO_LOGIN_IDENTITY", "No email recorded in office_email, official_email or email");
  }

  if (!resolved.company && !allowPersonalEmailFallback) {
    return at(
      "EMAIL_NEEDS_APPROVAL",
      `Only a non-company address is on file (${resolved.source}) — needs explicit approval before an invite is sent`
    );
  }

  // Dangling is reported separately from "no account" because the fix differs:
  // this row needs its stale pointer cleared, not just an account created.
  if (row.user_id && !linkedAuthUserId) {
    return at("DANGLING_USER_ID", `employees.user_id references auth_user ${String(row.user_id)}, which does not exist`);
  }

  if (!authUserId) return at("NO_AUTH_ACCOUNT", "No auth_user row backs this employee");

  if (n(row.active_role_count) === 0) return at("ROLE_UNMAPPED", "Account holds no active role");

  if (n(row.privileged_role_count) > 0 && n(row.scope_row_count) === 0) {
    return at("SCOPE_UNMAPPED", "Account holds a privileged role with no user_assignment_scope row");
  }

  const invite = String(row.invite_status ?? "").trim().toLowerCase();
  if (!invite) return at("INVITE_NOT_PREPARED", "No invite has been prepared for this account");
  if (invite === "failed") return at("INVITE_FAILED", "The most recent invite attempt failed");
  if (invite === "skipped") return at("INVITE_NOT_PREPARED", "The most recent invite was skipped");

  return at("READY", "Account, role and invite are all in place");
}

/**
 * The single population query. Every count either endpoint reports comes from
 * this one statement, so the two can no longer drift apart.
 *
 * The invite status is a correlated subquery rather than a join: an employee can
 * accumulate several hrms_launch_invite_log rows, and joining would multiply the
 * employee row and corrupt every aggregate built on top of it.
 */
const LAUNCH_POPULATION_SQL = `
  SELECT
    e.id, e.employee_code, e.first_name, e.last_name,
    e.email, e.official_email, e.office_email,
    e.user_id, e.employment_status,
    e.branch_id, e.process_id,
    b.branch_name, p.process_name,
    d.designation_name, dep.dept_name AS department_name,
    au.id AS auth_user_id,
    (SELECT COUNT(*) FROM user_roles ur
      WHERE ur.user_id = au.id AND ur.active_status = 1) AS active_role_count,
    (SELECT COUNT(*) FROM user_roles ur
      WHERE ur.user_id = au.id AND ur.active_status = 1 AND ur.role_key <> 'employee') AS privileged_role_count,
    (SELECT COUNT(*) FROM user_assignment_scope uas
      WHERE uas.user_id = au.id AND uas.active_status = 1) AS scope_row_count,
    (SELECT il.invite_status FROM hrms_launch_invite_log il
      WHERE il.employee_id = e.id ORDER BY il.created_at DESC LIMIT 1) AS invite_status
  FROM employees e
  LEFT JOIN auth_user au ON au.id = e.user_id
  LEFT JOIN branch_master b ON b.id = e.branch_id
  LEFT JOIN process_master p ON p.id = e.process_id
  LEFT JOIN designation_master d ON d.id = e.designation_id
  LEFT JOIN department_master dep ON dep.id = e.department_id
  WHERE e.active_status = 1
  ORDER BY e.employee_code
`;

export async function loadLaunchPopulation(): Promise<LaunchEmployeeRow[]> {
  const [rows] = await db.execute<LaunchEmployeeRow[]>(LAUNCH_POPULATION_SQL);
  return rows;
}

/** Lowercased auth_user.email -> id, for adopting accounts that were never linked. */
export async function loadAuthUserEmailIndex(): Promise<Map<string, string>> {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT id, email FROM auth_user WHERE email IS NOT NULL");
  const index = new Map<string, string>();
  for (const row of rows) {
    const email = normalizeEmail((row as { email?: unknown }).email);
    if (email && !index.has(email)) index.set(email, String((row as { id: unknown }).id));
  }
  return index;
}

export async function resolveLaunchEligibility(
  options: { allowPersonalEmailFallback?: boolean } = {}
): Promise<LaunchEligibility[]> {
  const [rows, authUserEmails] = await Promise.all([loadLaunchPopulation(), loadAuthUserEmailIndex()]);
  return rows.map((row) => classifyLaunchEmployee(row, authUserEmails, options));
}

function groupCount(rows: LaunchEligibility[], pick: (r: LaunchEligibility) => string | null) {
  const counts = new Map<string, { total: number; blocked: number }>();
  for (const row of rows) {
    const key = pick(row) ?? "(unassigned)";
    const entry = counts.get(key) ?? { total: 0, blocked: 0 };
    entry.total++;
    if (BLOCKING_STATES.has(row.state)) entry.blocked++;
    counts.set(key, entry);
  }
  return Array.from(counts.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.blocked - a.blocked || b.total - a.total);
}

/**
 * Aggregate for GET /launch-readiness.
 *
 * `verdict` is RED whenever a single in-scope employee lacks a usable login path.
 * There is deliberately no threshold below which this reports green.
 */
export function summariseLaunchEligibility(rows: LaunchEligibility[]) {
  const byState = {} as Record<LaunchEligibilityState, number>;
  for (const row of rows) byState[row.state] = (byState[row.state] ?? 0) + 1;

  const ready = rows.filter((r) => r.state === "READY").length;
  const blocked = rows.length - ready;

  return {
    activePopulation: rows.length,
    ready,
    blocked,
    verdict: blocked === 0 ? "GREEN" : "RED",
    byState,
    blockReasons: Object.entries(byState)
      .filter(([state]) => BLOCKING_STATES.has(state as LaunchEligibilityState))
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count),
    byBranch: groupCount(rows, (r) => r.branch),
    byProcess: groupCount(rows, (r) => r.process),
    byDesignation: groupCount(rows, (r) => r.designation),
  };
}
