/**
 * Demo user registry — single source of truth for the `INTERNAL_DEMO_BYPASS` identities.
 *
 * Lives in `shared/` (not `middleware/`) so any module can read it, without an import cycle:
 * `authMiddleware.ts` already depends on `shared/roleResolver.ts` for real (non-demo) JWT role
 * resolution, so nothing under `shared/` can safely depend back on `middleware/authMiddleware.ts`.
 *
 * Token → user id, email, and role (matches demoCreds.ts in frontend). Consumed by
 * authMiddleware.ts's requireAuth bypass.
 */
export const DEMO_TOKEN_MAP: Record<string, { id: string; email: string; role: string }> = {
  "mock-token-super-admin-role": { id: "demo-super-admin-id", email: "super-admin@mascallnet.com", role: "super_admin" },
  // buildDemoSession() in demoCreds.ts generates `mock-token-${cred.role}`, which for the
  // super_admin demo credential is "mock-token-super_admin" — not the "-role"-suffixed,
  // hyphenated key above. That mismatch meant every authenticated call 401'd after logging
  // in as the super_admin demo user (confirmed live 2026-08-06). Added rather than renamed,
  // so the existing key (used verbatim by policy-engine.routes.test.ts) keeps working.
  "mock-token-super_admin":      { id: "demo-super-admin-id", email: "superadmin@mascallnet.com",  role: "super_admin" },
  "mock-token-admin":            { id: "demo-admin-id",       email: "admin@mascallnet.com",        role: "admin" },
  "mock-token-hr":               { id: "demo-hr-id",          email: "hr@mascallnet.com",           role: "hr" },
  "mock-token-recruiter":        { id: "demo-recruiter-id",   email: "recruiter@mascallnet.com",    role: "recruiter" },
  "mock-token-process_manager":  { id: "demo-manager-id",     email: "manager@mascallnet.com",      role: "process_manager" },
  "mock-token-team_leader":      { id: "demo-tl-id",          email: "tl@mascallnet.com",           role: "team_leader" },
  "mock-token-qa":               { id: "demo-qa-id",          email: "qa@mascallnet.com",           role: "qa" },
  "mock-token-wfm":              { id: "demo-wfm-id",         email: "wfm@mascallnet.com",          role: "wfm" },
  "mock-token-finance":          { id: "demo-finance-id",     email: "finance@mascallnet.com",      role: "finance" },
  "mock-token-employee":         { id: "demo-employee-id",    email: "employee@mascallnet.com",     role: "employee" },
  "mock-token-ceo":              { id: "demo-ceo-id",         email: "ceo@mascallnet.com",          role: "ceo" },
  "mock-token-trainer":          { id: "demo-trainer-id",     email: "trainer@mascallnet.com",      role: "trainer" },
  // Legacy demo token — lowest privilege
  "mock-token":                  { id: "demo-user-id",        email: "demo@mascallnet.com",         role: "employee" },
};

/**
 * Is the demo bypass active? Exactly the gate authMiddleware.requireAuth applies, kept here
 * so every consumer asks the same question rather than re-deriving it.
 *
 * ⚠️  WARNING: INTERNAL_DEMO_BYPASS grants full role-based access to hardcoded demo
 * identities that have NO database backing. It MUST NEVER be enabled in production.
 * The env.ts startup validator already process.exit(1)'s on violation, and this
 * function double-checks NODE_ENV as defence-in-depth.
 */
export function isDemoBypassEnabled(): boolean {
  // SECURITY: Production guard — bypass disabled unconditionally in production
  if (process.env.NODE_ENV === "production") {
    return false; // bypass disabled in production regardless of env var
  }
  return process.env.INTERNAL_DEMO_BYPASS === "true";
}

/**
 * The role a demo user id carries, or null for anything else.
 *
 * authMiddleware puts the right role on req.authUser, but anything that re-derives a role
 * from the database gets nothing: these ids have no row in user_roles, and no employees row
 * either. Every such lookup therefore silently downgrades a demo super_admin to "no roles".
 *
 * In reporting that was not cosmetic. resolveFullScope() reads roles from user_roles, found
 * none, concluded not-super-admin, and returned a scope with no branches — which
 * appendScopeConditions renders as `1 = 0`. Logged in as the demo super_admin, every
 * employee-grain report returned 200 with totalCount 0. Indistinguishable from "this report
 * is broken", and it is why the Report Library looked empty during UI verification.
 *
 * Returns null unless the bypass gate is on, so production behaviour cannot change.
 */
export function demoRoleForUserId(userId: string): string | null {
  if (!isDemoBypassEnabled()) return null;
  for (const demo of Object.values(DEMO_TOKEN_MAP)) {
    if (demo.id === userId) return demo.role;
  }
  return null;
}
