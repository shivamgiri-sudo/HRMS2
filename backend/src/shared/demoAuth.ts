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
