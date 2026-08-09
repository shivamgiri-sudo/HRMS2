# Unified Quality & Operations Dashboards — Design

Status: approved-by-default (owner unavailable for several days, explicit prior authorization to proceed; owner to review on return and redirect if needed)
Owner: Shivam Giri
Author: Claude (design + implementation)
Date: 2026-08-04

## 1. Problem

Super admin login currently surfaces multiple overlapping "quality" and
"operations" dashboards with no consistent drill-down, inconsistent
role-scoping, and raw employee/process codes leaking into the UI instead of
names. Goal: replace all of it with exactly one Quality dashboard page and
one Operations dashboard page, each role-based and drillable from
org → branch → process → team → analyst, showing names not codes.

## 2. Current-state audit (verified against code + live DB on 2026-08-04)

### Quality — frontend (duplicates)
- `src/pages/NativeQualityDashboard.tsx` — `/quality/dashboard` (canonical per code comment)
- `src/pages/dashboards/QualityDashboardRole.tsx` → `ReferenceRoleDashboard(variant="quality")` → `QualityReferenceLayout.tsx` — `/quality-dashboard` (separate parallel implementation, near-duplicate URL)
- `src/pages/ManagerQualityDashboard.tsx` — `/quality/team`
- `src/pages/ExecutiveQualityDashboard.tsx` — `/quality/executive`
- `src/pages/AgentQualityDashboard.tsx` — `/quality/my-dashboard`
- `/quality/audit` already redirects to `/quality/dashboard` (evidence of a prior partial consolidation)

### Quality — backend (mirrors the frontend duplication)
`quality-dashboard.routes.ts` (`/api/quality-dashboard`), `quality-executive.routes.ts` (`/api/executive`), `quality-manager.routes.ts` (`/api/manager`), `quality-qa.routes.ts` (`/api/qa`), `quality-aggregation.routes.ts` (`/api/agent`), `inbound-quality.routes.ts` (`/api/inbound-quality`, ~30 endpoints — the richest existing surface), `qa-audit.routes.ts`, `quality-governance.routes.ts`, `client-drill.routes.ts`, `magical-script.routes.ts`.

### Quality — real data source (critical finding)
`qa_audit` / `qa_audit_form` / `qa_audit_parameter_score` / `process_quality_target` (the "manual QA audit form" subsystem, fully built per `backend/sql/1052_qa_audit_capture.sql` etc.) are **100% empty** — 0 rows, every table, verified live. This workflow was built but never adopted operationally.

The actual live quality engine is `db_audit.call_quality_assessment` (a separate MySQL schema on the same host, reached via `sourceDb.ts` with root-level cross-DB credentials): **439,281 rows**, date range 2024-12-06 → present (2026-08-04, i.e. still being written to today), ~6,530 calls scored in the last 30 days, 260 distinct agents, 30 distinct campaigns. Columns include 18 boolean call-quality checks (professionalism, active listening, hold procedure, etc.), `total_score`/`max_score`/`quality_percentage`, plus fraud/scam signal columns, cuss-word detection, and VOC sentiment text fields. Already queried by `inbound-quality.service.ts` / `client-drill.service.ts`.

Join-ability verified: `call_quality_assessment.User` (e.g. `MAS61561`) matches `employees.employee_code` exactly — confirmed on a live sample, resolving to `full_name`, `branch_id`, `process_id`. `Campaign` column is frequently `NULL` in recent rows — do not rely on it; derive process from `employees.process_id` instead.

Decision: **v1 builds on `db_audit.call_quality_assessment`, not on the empty `qa_audit` tables.** The manual-form subsystem is a separate business-process question for the owner, out of scope here.

### Operations — frontend (duplicates)
- `src/pages/NativeOperationsDashboard.tsx` — `/operations/dashboard`, no `roles=[]` restriction on `ProtectedRoute` (gate is `Gate pageCode` only)
- `src/pages/dashboards/OperationsDashboardRole.tsx` → `ReferenceRoleDashboard(variant="operations")` — `/operations-dashboard` (separate parallel implementation, near-duplicate URL — same pattern as quality)
- `src/pages/NativeOperationsKPI.tsx` — `/operations-kpi`, employee-level leaderboard, renders raw `employee_code`
- `src/pages/OpsBoard.tsx` — `/display/ops-board`, **no auth guard at all**
- `src/pages/dashboards/WfmAttendanceDashboard.tsx` — `/wfm-attendance`
- `src/components/operations-dashboard/OperationsDashboard.tsx` + Heatmap/Queue/Risk/Roster sub-components — unclear which page(s) mount it
- Adjacent/related: `Attendance.tsx`, `AdminAttendanceView.tsx`, `AttendanceControlTower.tsx`, `UnifiedPerformanceCommandCenter.tsx`, `PerformanceHub.tsx`, `Performance.tsx`, `NativeAgentPerformanceDashboard.tsx`

### Operations — backend
`operations-live.routes.ts` (`/api/operations` — `live-status`, `roster-vs-actual`, `attrition-risk`; already uses `dashboardScope.ts` server-side scoping), `kpi.routes.ts` (`/api/kpi` — metrics/templates/assignments/scores/leaderboard/org-summary), `performance-dashboard.routes.ts`, `performance-intelligence.routes.ts` (`/api/performance-hub`), `performance-feedback.routes.ts`, `operations.executor.ts` (reporting).

### Operations — real data (verified live, `mas_hrms` on <mas_hrms DB host — see backend/.env> / 192.168.10.6)
| Table | Rows | Usable? |
|---|---|---|
| `attendance_daily_record` | 114,593 | Yes — `process_id` 94% populated, `branch_id` 98% populated |
| `wfm_roster_assignment` | 413,386 | Partial — denormalized `branch_name`/`process_name` text but `process_name` only 19% populated; `team_leader_employee_id` **0% populated, unusable** |
| `cosec_daily_agg` | 284,270 | Needs join via `employees.biometric_code` (no direct employee FK) |
| `kpi_daily_actual` | 51,156 | `process_id_at_event` only 6% populated; `team_leader_id_at_event` 0% populated |
| `dashboard_metric_snapshot` | 2,299 | Precomputed rollups, already in production use — reuse as a cache layer |
| `dashboard_role_metric_config` | 401 | Defines which metrics a role sees — reuse to drive the new dashboards' metric sets |
| `dashboard_metric_catalog` | 19 | Human-readable `metric_name` lookup — reuse |
| `shrinkage_daily_snapshot`, `kpi_score`, `process_performance_metrics`, `process_delivery_actual`, and ~10 other well-designed tables | 0 | Built, unused — same pattern as `qa_audit` |

### Core hierarchy tables
- `branch_master` (45 rows, code+name populated, some inactive test rows)
- `process_master` (131 rows, code+name populated, but **`branch_id` only 28% populated** — do not use this table to derive branch↔process grouping)
- `employees` (58,626 total, 1,125 active; **87% of active employees have both `branch_id` and `process_id` populated directly on the row** — use this as the branch↔process source of truth instead of `process_master.branch_id`)
- `reporting_hierarchy` (1,392 rows, `employee_id → reports_to_employee_id`) — **the only usable team/TL grouping mechanism**, since every dedicated TL-link column elsewhere is 0% populated
- `branch_head_assignments` (4 rows, free-text branch names not FK'd, sample values don't match `branch_master` — stale, do not use)

### RBAC / scoping already built
- `backend/src/shared/dashboardScope.ts` (`resolveDashboardScope`) — returns `ORG_ALL | BRANCH_ALL | PROCESS_ALL | TEAM_ONLY | SELF_ONLY | CUSTOM_SCOPE`, fail-closed, already consumed by `operations-live.routes.ts`. **This is the scoping engine both new dashboards should use.**
- `backend/src/middleware/requireRole.ts` — route-level role allowlist (security boundary)
- Frontend `ProtectedRoute roles={[...]}` + `Gate pageCode="..."` / `WorkforcePageGate` — UI-level gating only, not the security boundary

### Code/name leaks confirmed (to fix)
- `NativeOperationsKPI.tsx` — raw `employee_code` rendered
- `RiskList.tsx:81` — raw `employee_code`
- `NativeOperationsDashboard.tsx:145-146` — falls back to `employee_code` when name resolution fails
- `ManagerQualityDashboard.tsx:267,285,331` — raw `agent_code`
- `ExecutiveQualityDashboard.tsx:319,349` — `agent_code` as React key, raw `process` string instead of resolved name
- `dashboard-data-contracts.ts` / `useQualityRoleDashboard.ts` — code-not-name baked into the TypeScript contracts themselves; contracts need updating, not just the render call sites

## 3. Approaches considered

**A — Unify both frontend and backend onto the existing scope resolver (recommended).** One page per domain, one aggregation API per domain, `dashboardScope.ts` reused/extended to quality (currently quality routers do ad hoc scoping via `user_assigned_scope` independently), team grouping via `reporting_hierarchy`. Old routes become redirects, matching the precedent already set at `/quality/audit`.

**B — Frontend-only unification.** Merge pages, keep the 4 quality routers / 5 ops routers as-is behind the scenes. Rejected: perpetuates the exact backend duplication the audit found; the duplication is the disease, not just the symptom.

**C — Full data-model replatform.** Backfill `process_master.branch_id`, add real TL-link columns, retire the empty tables. Correct long-term, but touches shared production data/schema I should not change unilaterally while the owner is unreachable. Deferred to a Phase 2 the owner explicitly approves.

Decision: **A**, with C's items logged as an explicit follow-up, not silently dropped.

## 4. Design

### 4.1 Drill-down hierarchy (identical shape, both dashboards)
```
Org (ORG_ALL)
 └─ Branch (branch_master.branch_name)
     └─ Process (employees.process_id grouped, process_master.process_name for label)
         └─ Team (reporting_hierarchy: employees grouped by reports_to_employee_id; TL = employees.full_name of the reports_to id)
             └─ Analyst (employees.full_name, employee_code shown only as secondary/tooltip)
                 └─ [Quality only] individual audited call (db_audit.call_quality_assessment row — transcript, fraud flags, parameter breakdown)
```

### 4.2 Role → landing level → scope
| Role | Scope (via `dashboardScope.ts`) | Lands on |
|---|---|---|
| super_admin / admin / ceo / hr | ORG_ALL | Branch grid |
| branch_head | BRANCH_ALL | Their branch's process grid |
| process_manager | PROCESS_ALL | Their process's team grid |
| team_leader / manager | TEAM_ONLY | Their team's analyst grid |
| analyst / agent | SELF_ONLY | Own scorecard (no further drill needed) |

Drill-down never lets a role exceed its resolved scope ceiling (fail-closed, same guarantee `operations-live.routes.ts` already provides). This is a server-side check, not a UI-only gate.

### 4.3 API shape (one per domain, level-parameterized, replaces the 4+5 duplicate routers)
```
GET /api/quality-dashboard-v2/summary?level=branch|process|team|analyst&id=<uuid?>
GET /api/quality-dashboard-v2/analyst/:employeeId/calls?range=<>       (level-5 drill)
GET /api/operations-dashboard-v2/summary?level=branch|process|team|analyst&id=<uuid?>
GET /api/operations-dashboard-v2/analyst/:employeeId/detail?range=<>
```
Every response resolves and returns names (`branch_name`, `process_name`, `team_leader_name`, `full_name`) — never bare codes as the primary label. Reuse `dashboard_metric_snapshot` + `dashboard_role_metric_config` + `dashboard_metric_catalog` as the metric-definition/caching layer rather than reinventing one.

### 4.4 Frontend
- `src/pages/QualityDashboard.tsx`, `src/pages/OperationsDashboard.tsx` — the only two pages going forward for these domains.
- Shared `DrillDownDashboardShell` component: breadcrumb (Org / Branch / Process / Team / Analyst), back navigation, level-appropriate chart set, role-aware landing level.
- All old routes (`/quality/dashboard`, `/quality-dashboard`, `/quality/team`, `/quality/executive`, `/quality/my-dashboard`, `/operations/dashboard`, `/operations-dashboard`, `/operations-kpi`, `/wfm-attendance`) redirect to the new unified routes. `/display/ops-board` (currently unauthenticated) gets an explicit decision at implementation time — likely keep as a separate deliberately-public kiosk view, not folded into the authenticated dashboard, but flagged for the owner to confirm since it's a distinct use case (TV wallboard).

### 4.5 Visual design
Glassmorphism + soft 3D depth (elevated frosted KPI tiles, gradient accents, subtle shadows), generated via the `ui-ux-pro-max` skill's design-system search against the existing shadcn/Tailwind/Recharts stack — no new dependencies. Interactive charts: trend lines (quality score over time), heatmap grid (branch × process performance), funnel (quality parameter pass rates), leaderboard tables with sparklines.

### 4.6 Explicitly out of scope for v1
- Reviving/backfilling the empty manual `qa_audit` form workflow
- Backfilling `process_master.branch_id` (28% populated)
- Populating dead TL-link columns in `wfm_roster_assignment` / `kpi_daily_actual`
- `/display/ops-board` kiosk consolidation (flagged, not decided)

These are logged, not silently dropped — Phase 2 candidates once the owner is back.

## 5. Testing plan
- Backend: verify each level's summary endpoint against real DB numbers (spot-check against manual `SELECT` aggregates) for at least one branch, one process, one team, one analyst — per the project's standing "verify against live DB" practice.
- RBAC: confirm an analyst-scoped token cannot fetch PROCESS_ALL/BRANCH_ALL/ORG_ALL data by manually requesting a level above their resolved scope (expect fail-closed rejection, not silent truncation).
- Frontend: manual browser walkthrough of the full drill path for at least one role at each landing level; confirm every displayed identity is a name, not a code.
- No regression tests exist yet for these routes; new ones will be added per `sp-test-driven-development` as endpoints are built.

## 6. Rollout
Build and verify locally first. Production deploy is a separate, explicit step — not bundled into this design — per the project's standing practice of showing real test output and doing a dry run before deploying, especially since the owner is unavailable to confirm right after.
