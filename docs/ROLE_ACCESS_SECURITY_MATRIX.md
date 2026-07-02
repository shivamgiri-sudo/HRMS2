# ROLE ACCESS SECURITY MATRIX
**Date:** 2026-06-12

## Roles in System

| Role Key | Description |
|----------|-------------|
| `admin` | Super Admin — full access |
| `hr` | HR Admin — all employee/leave/payroll data |
| `recruiter` | Recruitment — assigned candidates only |
| `manager` / `process_manager` | Process scope — own process data |
| `branch_head` | Branch scope — own branch data |
| `ceo` | Read-all (same as admin for most views) |
| `finance` | Payroll/finance module |
| `wfm` | WFM/roster module |
| `employee` | Self-service — own data only |
| `trainer` | LMS/training |
| `qa` | Quality module |
| `client` | Portal — scoped to assigned process/LOB only |

---

## Authentication Security

| Check | Status | Notes |
|-------|--------|-------|
| JWT verified server-side | ✅ | `authMiddleware.ts` — verifies via `authService.verifyAccessToken()` |
| Demo bypass only in dev | ✅ | `INTERNAL_DEMO_BYPASS=true` AND `NODE_ENV !== 'production'` required |
| Known demo tokens only | ✅ | `DEMO_TOKEN_MAP` — exact match only, no wildcards |
| Rate limiting on `/login` | ✅ | 10 attempts / 15 min per IP |
| Rate limiting on `/forgot-password` | ✅ | Same limiter |
| Password min length enforced | ✅ | 8 chars minimum |
| Refresh token revocation | ✅ | `auth_refresh_token.revoked` flag |
| `is_blocked` check on login | ✅ | Blocked users cannot login |
| `must_change_password` flag | ✅ | Forced password change on first login |

---

## Route-Level Authorization

| Route Prefix | Middleware | Roles Allowed |
|-------------|------------|---------------|
| `/api/auth/*` | Public | All |
| `/api/employees` | `requireAuth` + `requireRole` | admin, hr, manager, ceo |
| `/api/payroll` | `requireAuth` + `requireRole` | admin, hr, finance |
| `/api/ats/*` | `requireAuth` + `requireRole` | admin, hr, recruiter, manager |
| `/api/leave` | `requireAuth` | All authenticated |
| `/api/wfm` | `requireAuth` + `requireRole` | admin, hr, wfm, manager |
| `/api/portal` | `requireClientAuth` (separate) | Client users only |
| `/api/kpi` | `requireAuth` + `requireRole` | admin, hr, manager, process_manager |
| `/api/admin` | `requireAuth` + `requireRole` | admin only |
| `/api/management` | `requireAuth` + `requireRole` | admin, hr, ceo, manager |

---

## Scope Enforcement

| Feature | Scope Enforced | Method |
|---------|---------------|--------|
| ATS candidate list | ✅ | `buildScopeWhereClause` — branch/process scope for non-admin |
| ATS recruiter queue | ✅ | JWT → `resolveRecruiterForActor` — no query param override for non-privileged |
| ATS journey view | ✅ | `hasScopedAccess` check for non-admin/hr |
| Portal data | ✅ | `requireClientAuth` — process_ids whitelist in `client_user` |
| Payroll | ✅ | `requireRole('admin','hr','finance')` |
| Employee export | ✅ | Same role check as read |
| KPI scores | ✅ | Process/branch scope via `user_assignment_scope` |

---

## Security Issues Found

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | Demo bypass enabled in development (expected) | INFO | By design |
| 2 | JWT secret uses default dev value | WARN | Must change in production (env validator enforces) |
| 3 | Client portal uses separate JWT with separate secret | OK | `PORTAL_JWT_SECRET` separate from main `JWT_SECRET` |

---

## Tampering Prevention

| Attack Vector | Protected | Method |
|--------------|-----------|--------|
| Pass `recruiterName` query param to view other recruiter's queue | ✅ | JWT identity resolution, query param ignored for non-privileged |
| Pass different `branch_id` in request body | ✅ | Server derives scope from JWT user's assignment |
| Access payroll of other employees | ✅ | `requireRole` blocks employee-role users |
| Access portal data of other clients | ✅ | `process_ids` whitelist enforced on every query |
| Forge role in token | ✅ | Role fetched from DB on every request via `requireRole` |
