# Phase 0-B — Database Boundary and Security
**Date:** 2026-05-29  
**Branch:** `phase-0b/security-database-boundary`  
**Status:** Implemented and tested

---

## System-of-Record Matrix

| System | Role |
|---|---|
| MySQL `mas_hrms` | Writable PeopleOS application database — all HRMS operational data |
| Existing operational SQL database(s) | Upstream read-only source systems — future controlled connectors/sync into `mas_hrms` only; no schema or data modification without explicit approval |
| Supabase Auth | Authentication and session identity — permanent |
| Supabase Storage / transitional flows | Asset and document storage; native flows preserved until tested convergence |
| MySQL `user_roles` | Backend API access authority |
| Supabase `role_page_access` | Transitional frontend UI visibility mirror only — not API authority |
| Deployed internal LMS | External LMS system of record; HRMS integrates via bridge only |

---

## Database Boundary Rule

`mas_hrms` is the dedicated writable PeopleOS application database. Existing operational production database(s) are upstream read-only source systems. Future integration must use controlled read-only connectors or sync flows into `mas_hrms` only. No upstream source schema or data modification without explicit written approval.

This rule is now recorded in `CLAUDE.md`.

---

## RBAC Authority Rule

MySQL `user_roles` is the authority for backend API access and sensitive-data enforcement. Supabase `role_page_access` is a transitional frontend UI visibility mirror only. A user visible in Supabase but absent from MySQL `user_roles` will be denied on all protected backend API calls — this is by design and verified by tests.

---

## Client Portal Security — Changes in This Package

### A. Demo Bypass Control

- Added `PORTAL_DEMO_BYPASS` env var to `backend/src/config/env.ts` (default: `"false"`).
- Added `isDemoBypassEnabled()` method to `portal.auth.service.ts` — returns `true` only when `PORTAL_DEMO_BYPASS=true` is explicitly set.
- Production default is secure: bypass is disabled when absent, false, or when `NODE_ENV=production` (even if flag is true). No automatic demo JWT issuance without this flag in a non-production environment.
- The OTP verification flow is unchanged — all auth goes through bcrypt OTP + MySQL client_user lookup.

### B. Authenticated Client Access Logging

The `portal_access_log` table already existed and `logAccess()` was already implemented in `portal.controller.ts` but was only called on two endpoints (`getOverview`, `getKpis`).

Added `logAccess` to all remaining authenticated client portal endpoints:
- `getGlidePaths` → logs `/portal/processes/:id/glide-paths`
- `getActionPlans` → logs `/portal/processes/:id/action-plans`
- `getGovernance` → logs `/portal/processes/:id/governance`
- `getAttrition` → logs `/portal/processes/:id/attrition`
- `getCommentary` → logs `/portal/processes/:id/commentary`
- `acknowledgeCommentary` → logs `/portal/commentary/:id/acknowledge`
- `replyCommentary` → logs `/portal/commentary/:id/reply`

**Logged fields:** `id` (UUID), `client_user_id`, `page` (path), `ip_address` — no PII, no tokens, no salary data.

---

## RBAC Reconciliation — Changes in This Package

### New endpoint: `GET /api/access/rbac-reconciliation`

- Admin-only (`requireRole("admin")`).
- Read-only: no writes, no auto-fix, no backfill, no permission elevation.
- Compares MySQL `user_roles` (backend authority) against Supabase `user_roles` (UI mirror).
- Returns: `total_mysql_users`, `total_supabase_users`, `mismatches[]`, `checked_at`.
- Each mismatch includes: `user_id`, `mysql_roles`, `supabase_roles`, `in_supabase_only`, `in_mysql_only`.

Note: This endpoint reconciles role assignments only. Page-access reconciliation (`role_page_access`) and assignment-scope reconciliation remain later enhancements.

### New files
- `backend/src/modules/access/access.service.ts`
- `backend/src/modules/access/access.routes.ts`

---

## API Endpoints Added

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/access/rbac-reconciliation` | Supabase JWT + `requireRole("admin")` | Read-only RBAC mismatch report |

No existing endpoints modified beyond `portal.controller.ts` (logAccess additions only).

---

## Files Changed

| File | Change |
|---|---|
| `CLAUDE.md` | Added database-boundary rule section |
| `backend/src/config/env.ts` | Added `PORTAL_DEMO_BYPASS` env var (default `"false"`) |
| `backend/src/modules/portal/portal.auth.service.ts` | Added `isDemoBypassEnabled()` method |
| `backend/src/modules/portal/portal.controller.ts` | Added `logAccess` on 7 remaining client endpoints |
| `backend/src/modules/access/access.service.ts` | New — RBAC reconciliation logic |
| `backend/src/modules/access/access.routes.ts` | New — `/api/access/rbac-reconciliation` route |
| `backend/src/app.ts` | Mount `/api/access` router |
| `backend/tests/portal.security.test.ts` | New — portal security tests (12 tests) |
| `backend/tests/access.rbac.test.ts` | New — RBAC reconciliation tests (8 tests) |
| `docs/peopleos-build/PHASE_0B_DATABASE_BOUNDARY_AND_SECURITY.md` | This file |
| `docs/peopleos-build/CLAUDE_IMPLEMENTATION_TRACKER.md` | Updated tracker status |

---

## Test Evidence

- Backend tests: **513/513 passed** (41 test files)
- New tests added: 20 (12 portal security + 8 RBAC reconciliation)
- TypeScript: 0 new errors (39 pre-existing `TS6059` test-rootDir configuration errors unchanged)
- Backend build: `dist/server.js` produced
- Frontend build: `✓ built in 7.95s`

---

## Explicitly Not Implemented in This Package

- No payroll changes
- No LMS integration code
- No SQL schema changes or new migrations
- No Supabase project reference changes
- No upstream operational database connections
- No assets/documents convergence
- No ATS or WFM feature expansion
- No UI redesign
- No deployment configuration changes
