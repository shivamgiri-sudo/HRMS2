export interface PilotUser {
  id: string;
  email?: string | null;
  employeeCode?: string | null;
  role?: string | null;
  roles?: readonly string[] | null;
}

const norm = (v: unknown): string => String(v ?? "").trim().toLowerCase();

/** Parsed, lower-cased allow-list entries; empty means "no allow-list". Read at call time. */
export function pilotEntries(env: Record<string, string | undefined> = process.env): string[] {
  return String(env.BRANCH_HEAD_HEALTH_PILOT_USERS ?? "").split(",").map(norm).filter(Boolean);
}

export function isSuperAdmin(user: PilotUser): boolean {
  return norm(user.role) === "super_admin" || (user.roles ?? []).some((r) => norm(r) === "super_admin");
}

/** Pure decision. Unset/empty allow-list passes everyone; super_admin always passes; else id / employee code / email match. */
export function isPilotMember(user: PilotUser, env: Record<string, string | undefined> = process.env): boolean {
  const entries = pilotEntries(env);
  if (entries.length === 0) return true;
  if (isSuperAdmin(user)) return true;
  const mine = [user.id, user.employeeCode, user.email].map(norm).filter(Boolean);
  return mine.some((m) => entries.includes(m));
}

/** Async wrapper: looks the employee code up (memoised per request) only when id/email did not already match. */
export async function isPilotAllowed(
  authUser: { id: string; email?: string; role?: string; roles?: string[] },
  env: Record<string, string | undefined> = process.env,
  extraRoles: readonly string[] = [],
): Promise<boolean> {
  const base: PilotUser = { ...authUser, roles: [...(authUser.roles ?? []), ...extraRoles] };
  if (pilotEntries(env).length === 0 || isPilotMember(base, env)) return true;
  let employeeCode: string | null = null;
  try {
    const { getEmployeeForUser } = await import("../../shared/accessGuard.js");
    employeeCode = (await getEmployeeForUser(authUser.id))?.employee_code ?? null;
  } catch {
    employeeCode = null; // fail closed: not matched
  }
  return isPilotMember({ ...base, employeeCode }, env);
}
