# Branch Head Health Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live role dashboard for branch heads (MAS Call Net branches only) showing branch health, attention list, process coverage and drill-downs, built on the existing Branch Health Report.

**Architecture:** New backend module `backend/src/modules/branch-head-health/` that resolves the caller's MAS branches, reuses `fetchAllBranchHealthData` + `buildBranchHealthReport` for report-derived sections, adds a process/cost-centre section and a score, and serves them as independent sections. A new `branch_head` dashboard variant renders them with the existing `kit/` components. One new side table stores a daily snapshot for trends.

**Tech Stack:** Express + mysql2 (`db.execute`), vitest, React + react-query, existing `src/pages/dashboards/kit`.

**Spec:** `docs/superpowers/specs/2026-10-15-branch-head-health-page-design.md`

## Global Constraints

- MAS Call Net only: every branch/process query uses `ownCompanyBranchSql("b")` and `notDialDeskProcessSql("p","b")` from `backend/src/shared/ownCompanyCostCentre.ts`, plus `b.active_status = 1 AND b.close_date IS NULL`.
- No ALTER on existing tables; new tables are side tables registered in `backend/src/db/runPendingMigrations.ts` (next free number after `2214`, re-check `origin/main` before creating).
- `cost_centre_master.process_id` and its worker are never written by this work.
- The page is read-only and never drives invoicing; revenue = existing process P&L attribution.
- Names of agents appear only in the process-level drill-down; branch tiles and the leaderboard are aggregate.
- Page numbers derived from the report must equal `buildBranchHealthReport` for the same branch and date.
- Section failure is isolated: `{status: "error"}` for one section never fails the response.
- Feature flag `BRANCH_HEAD_HEALTH_ENABLED` (env, default off) gates the route and the variant.

## Review Focus

- **Duplicate branch names**: `fetchAllBranchHealthData` resolves the branch by `branch_name = ? OR branch_code = ? LIMIT 1`, and `HEAD OFFICE` matches two rows (inactive `HEAD_OFFICE`, active `CORP`). Expected: the page passes the active branch's `branch_code`, never the name (Task 2).
- **Head with no usable branch** (role but no scope row and an inactive or non-MAS home branch): expected an empty state with a reason, not a 500 or another branch's data (Task 1).
- **Head scoped to a DialDesk / I-Spark branch**: expected that branch silently filtered out, and the page still opens for the remaining ones (Task 1).
- **Multi-branch roll-up double counting**: a cost centre or process shared across the selected branches must be counted once (Task 3).
- **Invalid or future `date`**: expected a 400 with a message, and a missing `date` meaning today IST (Task 2).

## File Structure

| File | Responsibility |
|---|---|
| `backend/src/modules/branch-head-health/scope.ts` | resolve caller's MAS branches |
| `backend/src/modules/branch-head-health/types.ts` | `SectionResult`, payload types |
| `backend/src/modules/branch-head-health/overview.ts` | report-derived sections + attention list |
| `backend/src/modules/branch-head-health/processes.ts` | active processes, coverage tier, drill-down |
| `backend/src/modules/branch-head-health/score.ts` | health score |
| `backend/src/modules/branch-head-health/snapshot.ts` | daily snapshot write + trend read |
| `backend/src/modules/branch-head-health/routes.ts` | Express router |
| `backend/sql/migrations/22NN_branch_health_snapshot.sql` | snapshot table |
| `src/pages/dashboards/reference/branchhead/*` | layout + section components |
| `src/hooks/useBranchHeadHealth.ts` | react-query hook |

---

### Task 1: Branch scope resolver

**Files:**
- Create: `backend/src/modules/branch-head-health/scope.ts`
- Test: `backend/src/modules/branch-head-health/__tests__/scope.test.ts`

**Interfaces:**
- Consumes: `resolveDashboardScope(userId: string, role: string): Promise<DashboardScope>` (`backend/src/shared/dashboardScope.ts`), `ownCompanyBranchSql(alias: string): string`, `db` from `backend/src/db/mysql.ts`.
- Produces:
  ```ts
  export interface HeadBranch { branchId: string; branchCode: string; branchName: string }
  export interface HeadScope { branches: HeadBranch[]; viaHomeFallback: boolean; orgWide: boolean; emptyReason: string | null }
  export async function resolveHeadBranches(userId: string): Promise<HeadScope>
  ```

- [ ] **Step 1: Write failing tests** (mock `db` and `resolveDashboardScope`): `scoped to NOIDA and NOIDA-2 returns both`; `role without scope row falls back to home branch and sets viaHomeFallback`; `scope containing NOIDA-DIALDESK drops it and keeps the rest`; `only a non-MAS branch returns branches [] with emptyReason "No MAS Call Net branch in your scope"`; `ORG_ALL returns every active MAS branch with orgWide true`; `inactive or closed branch is dropped`.
- [ ] **Step 2: Run** `cd backend && npx vitest run src/modules/branch-head-health/__tests__/scope.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** `resolveHeadBranches`. One query over `branch_master b` with `WHERE b.id IN (?) AND b.active_status = 1 AND b.close_date IS NULL AND ${ownCompanyBranchSql("b")}`; for `ORG_ALL` omit the `IN`. Home fallback: when `scope.branchIds` is empty, use the employee's `branch_id` via `employees.user_id`.
- [ ] **Step 4: Run** the same command — expect PASS.
- [ ] **Step 5: Commit** `feat(branch-head-health): MAS branch scope resolver`.

### Task 2: Overview sections reusing the report

**Files:**
- Create: `backend/src/modules/branch-head-health/types.ts`, `overview.ts`
- Test: `backend/src/modules/branch-head-health/__tests__/overview.test.ts`

**Interfaces:**
- Consumes: `HeadBranch` (Task 1); `fetchAllBranchHealthData(branchName: string, today: string): Promise<BranchHealthRawData>` (`branch-health-report/query.ts`); `buildBranchHealthReport(branch: string, reportDate: string, raw): BranchHealthReport` (`metrics.ts`).
- Produces:
  ```ts
  export type SectionStatus = "ok" | "empty" | "error";
  export interface SectionResult<T> { status: SectionStatus; data: T | null; asOf: string; message?: string }
  export interface BranchOverview {
    branch: HeadBranch; date: string;
    status: "healthy" | "watch" | "critical";
    attention: Array<{ label: string; detail: string; severity: "critical" | "warning" }>;
    positives: Array<{ label: string; detail: string }>;
    people: SectionResult<unknown>; attendance: SectionResult<unknown>;
    hiring: SectionResult<unknown>; finance: SectionResult<unknown>;
    leaderboard: SectionResult<Array<{ manager: string; late: number; shrinkagePct: number | null }>>;
  }
  export async function buildOverview(branch: HeadBranch, date: string): Promise<BranchOverview>
  ```

- [ ] **Step 1: Write failing tests**: `passes branch_code (not name) to fetchAllBranchHealthData` (assert call arg is `"CORP"` for HEAD OFFICE); `overallStatus, criticalPoints equal buildBranchHealthReport output`; `a section that throws becomes status "error" while the others stay "ok"`; `leaderboard is aggregate per manager and carries no agent names`; `branchId null from the fetcher yields empty sections, not an exception`.
- [ ] **Step 2: Run** the file — expect FAIL.
- [ ] **Step 3: Implement** `buildOverview`: fetch once, build the report once, then slice into the four sections; wrap each slice in a `try`/`SectionResult` helper `safe(fn, asOf)`.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(branch-head-health): report-derived overview sections`.

### Task 3: Active processes, coverage tier and drill-down

**Files:**
- Create: `backend/src/modules/branch-head-health/processes.ts`
- Test: `backend/src/modules/branch-head-health/__tests__/processes.test.ts`

**Interfaces:**
- Consumes: `HeadBranch`; tables `process_master`, `cost_centre_master`, `cost_centre_process_link`, `employees`, `process_metric_actual`; `notDialDeskProcessSql`.
- Produces:
  ```ts
  export type CoverageTier = "full" | "inbound_quality" | "outbound_sale" | "baseline" | "not_wired";
  export interface BranchProcess {
    processId: string; processCode: string; processName: string;
    costCentres: string[]; viaLink: boolean; mandatedSeats: number | null;
    headcount: number; tier: CoverageTier; latestMetricDate: string | null;
  }
  export interface ProcessGroups { active: BranchProcess[]; unmapped: BranchProcess[] }
  export async function listBranchProcesses(branchIds: string[]): Promise<ProcessGroups>
  export interface DrillRow { employeeCode: string; name: string; value: number | null; metric: string }
  export async function getProcessDrilldown(branchId: string, processId: string, metric: string): Promise<DrillRow[]>
  export function coverageTier(metricKeys: string[]): CoverageTier
  ```

- [ ] **Step 1: Write failing tests**: `coverageTier` — keys with `FUNNEL_*`,`RISK_*`,`QA_*` → `full`; `INBOUND_SL_PCT`+`QA_*` without funnel → `inbound_quality`; `FUNNEL_*` without `QA_*` → `outbound_sale`; only `SHRINKAGE_PCT/PROCESS_JOINERS/...` → `baseline`; empty → `not_wired`. Listing — process linked only via `cost_centre_process_link` is `active` with `viaLink: true`; process with no cost centre and 0 headcount lands in `unmapped`; a process reachable through two selected branches appears once; a `BSS_*` process with no headcount is grouped under its cost centre (not listed alone).
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** both functions. Active rule: `cost_centre_master.process_id = p.id` and cc active and MAS, OR a row in `cost_centre_process_link` with `active_status = 1`, OR active headcount. `getProcessDrilldown` returns agent code and name (the only place names appear) restricted to employees whose `process_id` belongs to a process of `branchId`.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(branch-head-health): active processes, coverage tiers, drill-down`.

### Task 4: Health score and daily snapshot

**Files:**
- Create: `backend/src/modules/branch-head-health/score.ts`, `snapshot.ts`, `backend/sql/migrations/22NN_branch_health_snapshot.sql`
- Modify: `backend/src/db/runPendingMigrations.ts` (register the file)
- Test: `__tests__/score.test.ts`, `src/db/__tests__/branchHealthSnapshotMigration.contract.test.ts` (copy the structure of `costCentreProcessLinkMigration.contract.test.ts`)

**Interfaces:**
- Consumes: `BranchHealthReport`.
- Produces:
  ```ts
  export interface PillarScore { key: "attendance"|"people"|"finance"|"hiring"|"compliance"|"quality"; weight: number; score: number | null }
  export function computeScore(report: BranchHealthReport, weights?: Record<PillarScore["key"], number>): { score: number; pillars: PillarScore[]; excluded: string[] }
  export async function writeSnapshot(branchId: string, date: string, score: number, pillars: PillarScore[], metrics: Record<string, number>): Promise<void>
  export async function readTrend(branchId: string, metric: string, days: number): Promise<Array<{ date: string; value: number | null }>>
  ```
- Table: `branch_health_snapshot(id CHAR(36) PK, branch_id CHAR(36), snap_date DATE, score DECIMAL(5,2), pillars_json JSON, metrics_json JSON, created_at, UNIQUE (branch_id, snap_date))`, no FK, `CREATE TABLE IF NOT EXISTS`.

- [ ] **Step 1: Write failing tests**: default weights sum to 100 (25/20/20/15/10/10); a pillar with no data is excluded and the remaining weights renormalise to a score on 0–100; `score` never exceeds 100 or goes below 0; status band equals the report's `overallStatus` thresholds; migration contract test (registered after the previous entry, no FK, no ALTER).
- [ ] **Step 2: Run** the three test files — expect FAIL.
- [ ] **Step 3: Implement** `computeScore`, `writeSnapshot` (`INSERT … ON DUPLICATE KEY UPDATE`), `readTrend`, the migration and its manifest line.
- [ ] **Step 4: Run** — expect PASS, plus `npx vitest run src/db/__tests__/migration-manifest-guard.test.ts`.
- [ ] **Step 5: Commit** `feat(branch-head-health): score and snapshot table`.

### Task 5: Routes, flag and access registry

**Files:**
- Create: `backend/src/modules/branch-head-health/routes.ts`
- Modify: `backend/src/app.ts` (mount `/api/branch-head-health`), `backend/src/shared/dashboardAccessRegistry.ts`, `src/pages/dashboards/roleDashboardAccess.ts`
- Test: `__tests__/routes.test.ts`, `src/pages/dashboards/__tests__/branchHeadVariant.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: `GET /api/branch-head-health/overview?branchIds=&date=` → `{ success, data: { scope, branches: BranchOverview[], processes: ProcessGroups, score } }`; `GET /api/branch-head-health/process/:processId/drilldown?metric=`; `GET /api/branch-head-health/trend?branchId=&metric=&days=`. Registry entry `BRANCH_HEAD_DASHBOARD` with `variant: "branch_head"`, `route: "/branch-head/dashboard"`, `allowedRoleKeys: ["branch_head", "ceo", "coo", "super_admin"]`.

- [ ] **Step 1: Write failing tests**: invalid `date` → 400; future `date` → 400; missing `date` → today IST; `branchIds` outside the caller's scope are dropped, never returned; flag off → 404; a non-`branch_head` role → 403; variant test — a user with roles `["branch_head","hr","manager"]` resolves to `branch_head`; `["hr"]` still resolves to `hr`.
- [ ] **Step 2: Run** both files — expect FAIL.
- [ ] **Step 3: Implement** the router (`requireAuth`, `requireRole`, the `h()` async wrapper used by `branch-health-report/export.routes.ts`), mount it, add the registry entry and insert `"branch_head"` into `RESOLUTION_PRIORITY` directly after `"ceo"`.
- [ ] **Step 4: Run** both files and `npx vitest run src/shared` — expect PASS.
- [ ] **Step 5: Commit** `feat(branch-head-health): routes, flag and dashboard variant`.

### Task 6: Frontend layout and sections

**Files:**
- Create: `src/hooks/useBranchHeadHealth.ts`, `src/pages/dashboards/reference/branchhead/BranchHeadReferenceLayout.tsx`, `…/branchhead/ProcessCoveragePanel.tsx`, `…/branchhead/AttentionList.tsx`
- Modify: `src/pages/dashboards/ReferenceRoleDashboard.tsx` (add `branch_head` to `DASHBOARD_CODE` and the layout switch)
- Test: `src/pages/dashboards/reference/branchhead/__tests__/BranchHeadReferenceLayout.test.tsx`

**Interfaces:**
- Consumes: the Task 5 endpoints.
- Produces: `useBranchHeadHealth(branchIds: string[], date?: string): { data, isLoading, error }`; `BranchHeadReferenceLayout` with props `{ data: BranchHeadPayload }`.

- [ ] **Step 1: Write failing tests**: renders hero status and score; renders a section `error` inline while other sections show; coverage badge text for each tier; "Not mapped to a cost centre" group collapsed by default; branch switcher absent for one branch and present for two; drill-down shows names only after opening a process.
- [ ] **Step 2: Run** `npx vitest run src/pages/dashboards/reference/branchhead` — expect FAIL.
- [ ] **Step 3: Implement** the layout from `kit/` components; status always paired with an icon and label, skeletons reserve height, every chart has a table fallback.
- [ ] **Step 4: Run** the test and `npx vite build` — expect PASS and a clean build (Tailwind scans source text: no `/[-:T]/`-style regex literals).
- [ ] **Step 5: Commit** `feat(branch-head-health): dashboard layout`.

### Task 7: Operations, quality and Callmaster sections

**Files:**
- Modify: `backend/src/modules/branch-head-health/overview.ts` (add `operations`, `quality`, `callmaster` sections)
- Create: `backend/src/modules/branch-head-health/ops.ts`, `dataHealth.ts`
- Test: `__tests__/ops.test.ts`, `__tests__/dataHealth.test.ts`

**Interfaces:**
- Consumes: `listProcesses(userId, windowDays)` (`process-operations.service.ts`); `getInboundProjects({includeDbOnly})`; `getKPIs`, `getQualityTrend`, `getFatalAgentSummary` (`call-master.service.ts`).
- Produces: `export async function clientIdsForProcesses(processIds: string[]): Promise<number[]>` (project `clientId` / `fcrClientId` where `project.processId` is in the set); `export async function buildOpsSections(processes: BranchProcess[], range: {startDate: string; endDate: string}): Promise<{ operations: SectionResult<unknown>; quality: SectionResult<unknown>; callmaster: SectionResult<unknown> }>`.

- [ ] **Step 1: Write failing tests**: `clientIdsForProcesses` ignores projects with no `processId`; Callmaster section is `empty` (not `error`) when a branch has no mapped client; ops section lists only the branch's active processes and returns the `tier` per process; metrics older than 14 days are flagged `stale`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** both functions; Callmaster calls reuse the existing service with `clientIds` set, no new SQL.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Data health** — `export async function buildDataHealth(branchIds: string[]): Promise<SectionResult<{ unmappedProcesses: number; costCentresWithoutProcess: number; overMandate: Array<{ costCentre: string; seats: number; headcount: number }>; staleProcesses: number }>>`; test `non-numeric mandated_seats such as 'o' is ignored, not NaN`; section returned only for `branch_head`, `ceo`, `coo`, `super_admin`.
- [ ] **Step 6: Commit** `feat(branch-head-health): ops, quality, callmaster and data-health sections`.

### Task 8: Verification and rollout

**Files:** none new; extends `.github/workflows/ops-billing-schema-verify.yml` with the snapshot table check.

- [ ] **Step 1:** `cd backend && npx tsc --noEmit && npx vitest run src/modules/branch-head-health src/db/__tests__` — expect all green.
- [ ] **Step 2:** `npx vite build` from the repo root — expect a clean build.
- [ ] **Step 3:** Run the new endpoints locally against the live-copy DB for NOIDA, NOIDA-2, AHMEDABAD-JALDARSHAN and HEAD OFFICE; check the page numbers equal the emailed report for the same date and that no non-MAS branch appears.
- [ ] **Step 4:** Push from a clean worktree (`git fetch && git rebase origin/main && git push origin HEAD:main`), then dispatch `deploy.yml`; confirm the migration in `schema_migrations` via the verify workflow and the flag stays off.
- [ ] **Step 5:** Enable `BRANCH_HEAD_HEALTH_ENABLED` for pilot heads and audit the live page with a real branch-head login (desktop and 375 px).
