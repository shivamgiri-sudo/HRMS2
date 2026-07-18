# Performance Intelligence Hub Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a production-safe first vertical slice of the Performance Intelligence Hub for Employee, Team Leader, Assistant Manager, and Process Manager views using controlled KPI facts derived from the Mydashboards formulas.

**Architecture:** Mydashboards remains a formula/query reference, while `mas_hrms` remains the only writable runtime store. A new backend module resolves the caller's HRMS scope on the server, reads versioned daily KPI facts, calculates mathematically correct period metrics from stored numerators/denominators, and returns stable contracts to one responsive HRMS-native page. Existing performance routes and pages remain available during the transition.

**Tech Stack:** MySQL 8, Express, TypeScript, Zod, Vitest, Supertest, React 18, TanStack Query, Tailwind, shadcn/Radix, Recharts.

## Global Constraints

- Do not run this migration or any write query against production.
- All upstream systems remain read-only; no upstream schema or data changes.
- `mas_hrms` is the only writable PeopleOS database.
- Backend authorization and row scope are mandatory; client-provided scope may only narrow server-resolved scope.
- Preserve existing KPI, Performance, Agent Performance, Call Master, Quality, Integration Hub, and Client Portal flows.
- Do not expose payroll, identity documents, raw transcripts, or unrelated employee PII.
- Do not return fabricated metrics; missing or unverified facts must be labelled as such.
- All database changes are additive and backward-compatible.
- Use the existing HRMS enterprise design tokens and components; do not introduce a competing theme.
- Do not commit, push, deploy, change credentials, or execute live SQL without separate user approval.

---

## File Map

**Create**

- `backend/sql/504_performance_intelligence_foundation.sql` — additive formula-version, KPI lineage, and mapping-exception schema.
- `backend/src/modules/performance-intelligence/performance-intelligence.contracts.ts` — API and repository types.
- `backend/src/modules/performance-intelligence/performance-intelligence.validation.ts` — strict date, scope, paging, and metric query validation.
- `backend/src/modules/performance-intelligence/performance-intelligence.formulas.ts` — pure Mydashboards-derived aggregation and scoring formulas.
- `backend/src/modules/performance-intelligence/performance-intelligence.repository.ts` — parameterized reads from HRMS employees, KPI facts, targets, and mappings.
- `backend/src/modules/performance-intelligence/performance-intelligence.service.ts` — scope enforcement and response composition.
- `backend/src/modules/performance-intelligence/performance-intelligence.routes.ts` — authenticated GET endpoints.
- `backend/src/modules/performance-intelligence/__tests__/performance-intelligence.formulas.test.ts` — formula regression tests.
- `backend/src/modules/performance-intelligence/__tests__/performance-intelligence.validation.test.ts` — boundary validation tests.
- `backend/src/modules/performance-intelligence/__tests__/performance-intelligence.service.test.ts` — negative authorization and composition tests.
- `backend/src/modules/performance-intelligence/__tests__/performance-intelligence.routes.test.ts` — endpoint contract tests.
- `src/types/performanceHub.ts` — frontend API contracts.
- `src/hooks/usePerformanceHub.ts` — query keys, filters, and HRMS API calls.
- `src/components/performance-hub/PerformanceScopeBar.tsx` — effective scope, period, and freshness controls.
- `src/components/performance-hub/PerformanceMetricGrid.tsx` — accessible metric cards with target, status, and provenance.
- `src/components/performance-hub/PerformanceTrendPanel.tsx` — responsive daily trend chart and empty/error states.
- `src/components/performance-hub/PerformancePeopleTable.tsx` — manager-only scoped employee ranking with mobile cards.
- `src/pages/PerformanceHub.tsx` — HRMS enterprise page composition.
- `src/tests/performance-hub.test.tsx` — frontend behavior and accessibility tests.

**Modify**

- `backend/src/app.ts` — mount `/api/performance-hub` without changing existing routes.
- `src/App.tsx` — lazy-load and route `/performance-hub`.
- `src/components/layout/navConfig.tsx` — add Performance Hub navigation for all authenticated HRMS roles.

## Public Interfaces

```ts
type PerformancePeriod = { from: string; to: string };
type PerformanceMetricCode =
  | "CALLS"
  | "AHT"
  | "ADHERENCE"
  | "UTILIZATION"
  | "QUALITY_SCORE"
  | "FATAL_RATE"
  | "CONVERSION_RATE";

type CalculationStatus = "verified" | "legacy_unverified" | "missing";

interface PerformanceQuery {
  from: string;
  to: string;
  branchId?: string;
  processId?: string;
  employeeId?: string;
  page?: number;
  pageSize?: number;
}

interface PerformanceContext {
  effectiveRole: string;
  scopeLevel: "ORG_ALL" | "BRANCH_ALL" | "PROCESS_ALL" | "TEAM_ONLY" | "SELF_ONLY" | "CUSTOM_SCOPE";
  canViewPeople: boolean;
  canSelectBranch: boolean;
  canSelectProcess: boolean;
  effectiveBranchIds: string[];
  effectiveProcessIds: string[];
  subjectEmployeeId: string | null;
}

interface MetricFact {
  employeeId: string;
  metricCode: PerformanceMetricCode;
  scoreDate: string;
  actualValue: number | null;
  numeratorValue: number | null;
  denominatorValue: number | null;
  targetValue: number | null;
  direction: "higher_is_better" | "lower_is_better";
  sourceSystem: string | null;
  sourceRecordCount: number | null;
  formulaVersion: string | null;
  computedAt: string;
}

interface PerformanceMetricResult {
  metricCode: PerformanceMetricCode;
  label: string;
  unit: "count" | "seconds" | "percent";
  value: number | null;
  target: number | null;
  achievementPct: number | null;
  status: "on_track" | "watch" | "off_track" | "no_target" | "missing";
  calculationStatus: CalculationStatus;
  sourceSystems: string[];
  recordCount: number;
  latestComputedAt: string | null;
}
```

Endpoints:

- `GET /api/performance-hub/context`
- `GET /api/performance-hub/scorecard?from=YYYY-MM-DD&to=YYYY-MM-DD&branchId=&processId=&employeeId=`
- `GET /api/performance-hub/trends?from=YYYY-MM-DD&to=YYYY-MM-DD&branchId=&processId=&employeeId=`
- `GET /api/performance-hub/people?from=YYYY-MM-DD&to=YYYY-MM-DD&branchId=&processId=&page=1&pageSize=25`

Every response uses `{ success: true, data, meta }`; errors use the existing error middleware and must never convert database failures into successful empty datasets.

---

### Task 1: Add the KPI lineage and formula-version foundation

**Files:**

- Create: `backend/sql/504_performance_intelligence_foundation.sql`

**Interfaces:**

- Consumes: existing `kpi_daily_actual`, `kpi_metric_master`, `integration_run`, and `employee_external_mapping`.
- Produces: `kpi_formula_version`, `integration_mapping_exception`, and nullable lineage columns on `kpi_daily_actual`.

- [ ] **Step 1: Write schema assertions before SQL**

Add executable comments listing the expected post-migration columns and indexes:

```sql
-- VERIFY AFTER STAGING EXECUTION:
-- SELECT formula_code, version_no, status FROM kpi_formula_version ORDER BY formula_code;
-- SHOW COLUMNS FROM kpi_daily_actual LIKE 'numerator_value';
-- SHOW INDEX FROM integration_mapping_exception WHERE Key_name = 'idx_mapping_exception_status';
```

- [ ] **Step 2: Add backward-compatible schema**

Create formula versions with immutable `(formula_code, version_no)`, mapping exceptions keyed by source/system/external identifier/run, and these nullable daily-fact columns:

```sql
ALTER TABLE kpi_daily_actual
  ADD COLUMN numerator_value DECIMAL(18,6) NULL AFTER actual_value,
  ADD COLUMN denominator_value DECIMAL(18,6) NULL AFTER numerator_value,
  ADD COLUMN source_system VARCHAR(50) NULL AFTER source,
  ADD COLUMN source_record_count INT UNSIGNED NULL AFTER source_system,
  ADD COLUMN formula_version_id CHAR(36) NULL AFTER source_record_count,
  ADD COLUMN integration_run_id CHAR(36) NULL AFTER formula_version_id,
  ADD COLUMN computed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER integration_run_id,
  ADD INDEX idx_kpi_daily_metric_date (metric_id, score_date),
  ADD INDEX idx_kpi_daily_run (integration_run_id);
```

Use `INFORMATION_SCHEMA.COLUMNS`-guarded prepared statements so rerunning the additive migration does not fail when a column already exists. Do not alter the current `source` enum in this phase; source-system detail belongs in `source_system`.

- [ ] **Step 3: Validate statically**

Run:

```powershell
rg -n "DROP|DELETE|TRUNCATE|UPDATE kpi_daily_actual" backend/sql/504_performance_intelligence_foundation.sql
```

Expected: no output.

Do not execute the migration.

### Task 2: Implement verified Mydashboards-derived formulas test-first

**Files:**

- Create: `backend/src/modules/performance-intelligence/performance-intelligence.contracts.ts`
- Create: `backend/src/modules/performance-intelligence/performance-intelligence.formulas.ts`
- Test: `backend/src/modules/performance-intelligence/__tests__/performance-intelligence.formulas.test.ts`

**Interfaces:**

- Consumes: `MetricFact[]`.
- Produces: `aggregateMetricFacts(facts: MetricFact[]): PerformanceMetricResult[]` and `calculateAchievement(value, target, direction): number | null`.

- [ ] **Step 1: Write failing formula tests**

Cover these exact cases:

```ts
it("sums call volume", () => {
  expect(byCode(aggregateMetricFacts([fact("CALLS", 10), fact("CALLS", 15)]), "CALLS").value).toBe(25);
});

it("uses the stored numerator and denominator for AHT", () => {
  const facts = [fact("AHT", 100, { numeratorValue: 200, denominatorValue: 2 }), fact("AHT", 50, { numeratorValue: 150, denominatorValue: 3 })];
  expect(byCode(aggregateMetricFacts(facts), "AHT").value).toBe(70);
});

it("does not label a plain average as verified", () => {
  expect(byCode(aggregateMetricFacts([fact("QUALITY_SCORE", 80)], "QUALITY_SCORE").calculationStatus).toBe("legacy_unverified");
});

it("reverses achievement for lower-is-better metrics", () => {
  expect(calculateAchievement(80, 100, "lower_is_better")).toBe(125);
});
```

- [ ] **Step 2: Run RED**

Run:

```powershell
cd backend
npx vitest run src/modules/performance-intelligence/__tests__/performance-intelligence.formulas.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimal pure formulas**

Formula rules:

- `CALLS`: `SUM(actual_value)`.
- `AHT`: `SUM(numerator_value) / SUM(denominator_value)` where numerator is handle seconds and denominator is handled calls.
- `ADHERENCE`, `UTILIZATION`, `QUALITY_SCORE`, `FATAL_RATE`, `CONVERSION_RATE`: `SUM(numerator_value) / SUM(denominator_value) * 100`.
- If required numerator/denominator lineage is absent but actual values exist, return the average actual value with `legacy_unverified`.
- If no actual value exists, return `null` with `missing`.
- Cap display achievement at 999.99 but do not cap the raw metric value.
- `on_track` is achievement `>= 100`, `watch` is `>= 90`, otherwise `off_track`.

- [ ] **Step 4: Run GREEN**

Run the same Vitest command.

Expected: all formula tests PASS.

### Task 3: Enforce scope and expose stable backend contracts

**Files:**

- Create: `backend/src/modules/performance-intelligence/performance-intelligence.validation.ts`
- Create: `backend/src/modules/performance-intelligence/performance-intelligence.repository.ts`
- Create: `backend/src/modules/performance-intelligence/performance-intelligence.service.ts`
- Create: `backend/src/modules/performance-intelligence/performance-intelligence.routes.ts`
- Create: `backend/src/modules/performance-intelligence/__tests__/performance-intelligence.validation.test.ts`
- Create: `backend/src/modules/performance-intelligence/__tests__/performance-intelligence.service.test.ts`
- Create: `backend/src/modules/performance-intelligence/__tests__/performance-intelligence.routes.test.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**

- Consumes: `resolveDashboardScope`, `narrowDashboardScope`, `buildScopeWhereEmployees`, authenticated user ID.
- Produces: four GET endpoints under `/api/performance-hub`.

- [ ] **Step 1: Write failing validation tests**

Verify:

```ts
expect(() => parsePerformanceQuery({ from: "2026-07-01", to: "2026-07-18" })).not.toThrow();
expect(() => parsePerformanceQuery({ from: "18/07/2026", to: "2026-07-18" })).toThrow();
expect(() => parsePerformanceQuery({ from: "2026-07-18", to: "2026-07-01" })).toThrow();
expect(() => parsePerformanceQuery({ from: "2025-01-01", to: "2026-07-18" })).toThrow();
expect(parsePerformanceQuery({ from: "2026-07-01", to: "2026-07-18", pageSize: "500" }).pageSize).toBe(100);
```

Limit a query to 93 inclusive days.

- [ ] **Step 2: Run RED, implement validation, run GREEN**

Use Zod date regex plus calendar validation and cross-field refinement. Default `page=1`, `pageSize=25`, maximum `pageSize=100`.

- [ ] **Step 3: Write failing negative scope tests**

Use dependency injection for repository and scope functions. Verify:

```ts
it("ignores an employeeId outside the server-resolved employee set", async () => {
  await expect(service.scorecard(auth("tl-user"), query({ employeeId: "other-employee" })))
    .rejects.toMatchObject({ statusCode: 403 });
  expect(repository.listMetricFacts).not.toHaveBeenCalled();
});

it("does not let a team leader widen to a process", async () => {
  const result = await service.context(auth("tl-user"));
  expect(result.scopeLevel).toBe("TEAM_ONLY");
  expect(result.canSelectProcess).toBe(false);
});

it("fails closed when no employee record maps to a self-only user", async () => {
  await expect(service.scorecard(auth("employee-user"), query())).rejects.toMatchObject({ statusCode: 403 });
});
```

- [ ] **Step 4: Implement repository queries**

Repository methods:

```ts
interface PerformanceRepository {
  findSubjectEmployeeId(userId: string): Promise<string | null>;
  canAccessEmployee(scope: DashboardScope, employeeId: string): Promise<boolean>;
  listMetricFacts(scope: DashboardScope, query: PerformanceQuery, subjectEmployeeId: string | null): Promise<MetricFact[]>;
  listDailyTrendFacts(scope: DashboardScope, query: PerformanceQuery, subjectEmployeeId: string | null): Promise<MetricFact[]>;
  listPeople(scope: DashboardScope, query: PerformanceQuery): Promise<{ rows: PerformancePersonRow[]; total: number }>;
}
```

Every employee query must embed `buildScopeWhereEmployees(scope, "e")`, use placeholders, filter `e.active_status = 1`, filter the seven metric codes, and apply bounded date/pagination values. Never concatenate a user-supplied identifier.

- [ ] **Step 5: Implement service scope composition**

Resolve the scope from the authenticated user, then call `narrowDashboardScope`. For `SELF_ONLY`, force the mapped employee. For `TEAM_ONLY`, allow only reporting employees. For wider roles, permit a requested employee only after `canAccessEmployee` succeeds. A denied custom scope returns no data only when the user requested an invalid branch/process; an employee breakout outside scope returns HTTP 403.

- [ ] **Step 6: Write failing route tests**

Mock `requireAuth` by setting `req.authUser`; test HTTP 401 without identity, 400 for invalid dates, 403 for out-of-scope employees, and 200 contract shape for all four routes. Assert `Cache-Control: private, no-store`.

- [ ] **Step 7: Implement and mount routes**

Mount:

```ts
app.use("/api/performance-hub", performanceIntelligenceRouter);
```

Keep `/api/performance-dashboard` and `/api/kpi-master` unchanged.

- [ ] **Step 8: Run backend slice verification**

Run:

```powershell
cd backend
npx vitest run src/modules/performance-intelligence
npm run typecheck
```

Expected: focused tests PASS and TypeScript exits 0.

### Task 4: Build the HRMS-native frontend contract and page test-first

**Files:**

- Create: `src/types/performanceHub.ts`
- Create: `src/hooks/usePerformanceHub.ts`
- Create: `src/components/performance-hub/PerformanceScopeBar.tsx`
- Create: `src/components/performance-hub/PerformanceMetricGrid.tsx`
- Create: `src/components/performance-hub/PerformanceTrendPanel.tsx`
- Create: `src/components/performance-hub/PerformancePeopleTable.tsx`
- Create: `src/pages/PerformanceHub.tsx`
- Create: `src/tests/performance-hub.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/layout/navConfig.tsx`

**Interfaces:**

- Consumes: the four backend response contracts and existing `hrmsApi`, `EnterprisePageShell`, `FilterBar`, `KpiCard`, `EmptyState`, and `ErrorState`.
- Produces: authenticated `/performance-hub`.

- [ ] **Step 1: Write failing page tests**

Test:

```tsx
it("shows the caller's server-resolved scope and formula freshness", async () => {
  renderHub({ context: teamContext, scorecard: verifiedScorecard });
  expect(await screen.findByText("My team")).toBeInTheDocument();
  expect(screen.getByText(/calculated/i)).toBeInTheDocument();
});

it("does not render people ranking for self-only users", async () => {
  renderHub({ context: employeeContext, scorecard: verifiedScorecard });
  expect(screen.queryByRole("table", { name: /team performance/i })).not.toBeInTheDocument();
});

it("labels legacy KPI facts as unverified", async () => {
  renderHub({ context: employeeContext, scorecard: legacyScorecard });
  expect(await screen.findByText("Needs source verification")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run RED**

Run:

```powershell
npx vitest run src/tests/performance-hub.test.tsx
```

Expected: FAIL because the page and components do not exist.

- [ ] **Step 3: Implement typed hooks**

Use stable query keys:

```ts
["performance-hub", "context"]
["performance-hub", "scorecard", filters]
["performance-hub", "trends", filters]
["performance-hub", "people", filters]
```

Do not request `people` when `context.canViewPeople` is false. Serialize only defined query parameters.

- [ ] **Step 4: Implement the page in the existing template**

Use `EnterprisePageShell`, enterprise CSS variables, existing buttons/selects/table primitives, `KpiCard`, and Recharts. The deliberate signature element is a compact “scope and freshness rail” directly below the page header, not a new visual theme.

Required states:

- loading skeletons;
- real empty state explaining that no verified KPI facts exist for the period;
- visible API error with retry;
- per-metric target, achievement, formula status, source systems, and latest computation time;
- manager people table only when allowed;
- responsive mobile cards at 375 px;
- keyboard-visible controls with at least 44 px touch height;
- no animation when reduced motion is requested.

- [ ] **Step 5: Add route and navigation**

Lazy import `PerformanceHub`, add `/performance-hub`, and add “Performance Hub” as the first child of the existing Performance navigation group. Do not remove or redirect `/performance`, `/agent-performance`, or `/performance/command-center`.

- [ ] **Step 6: Run GREEN**

Run the focused frontend test, then:

```powershell
npm run typecheck
npm run build
```

Expected: test PASS, typecheck exits 0, Vite build exits 0.

### Task 5: Security, compatibility, and completion verification

**Files:**

- Review all files changed by Tasks 1–4.

**Interfaces:**

- Consumes: complete Phase 1 slice.
- Produces: evidence-backed release handoff with no production action.

- [ ] **Step 1: Run secret and unsafe-SQL scans**

```powershell
rg -n "<live-host-or-secret-pattern>|SELECT \\* FROM Shivamgiri|mysql\\.createPool" backend/src/modules/performance-intelligence src/components/performance-hub src/pages/PerformanceHub.tsx
rg -n "<unsafe-dml-or-ddl-patterns>" backend/sql/504_performance_intelligence_foundation.sql backend/src/modules/performance-intelligence
```

Expected: no output.

- [ ] **Step 2: Run focused tests**

```powershell
cd backend
npx vitest run src/modules/performance-intelligence
cd ..
npx vitest run src/tests/performance-hub.test.tsx tests/roleDashboardAccess.test.ts
```

Expected: all selected tests PASS.

- [ ] **Step 3: Run builds**

```powershell
npm run typecheck
npm run build
cd backend
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 4: Inspect the final diff**

```powershell
git diff --check
git status --short
git diff --stat
```

Confirm existing routes remain mounted, migration is unexecuted, no secrets appear, and only planned files changed.

- [ ] **Step 5: Browser verification**

Run the frontend and backend only against an isolated local/staging database. Verify Employee, TL, and AM layouts at 375, 768, 1024, and 1440 px; check console and network errors; capture screenshots. Do not point this verification at the production database.

- [ ] **Step 6: Handoff without committing**

Report files changed, exact verification output, migration status, data prerequisites, known limitations, and rollback. Wait for explicit approval before commit, push, migration execution, deployment, or production activation.

## Follow-on Plans

This phase deliberately establishes the reusable engine and proves Employee→TL→AM/Process Manager behavior. Separate approved phases will add:

1. Branch Head and Operations hierarchy comparison with branch/process drilldowns.
2. QA/T&Q parameter, fatal, TNI, and coaching detail.
3. WFM adherence, shrinkage, roster, and utilization reconciliation.
4. Management/CEO cross-branch scorecards and data-health command center.
5. Client Portal aggregate-only process/LOB performance with explicit metric allowlists.
6. Controlled Integration Hub ingestion adapters for APR, unified call master, quality assessment, sales/customer, and dialer sources.
