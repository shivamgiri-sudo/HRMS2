# Analytics Catalogue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A registry of datasets plus one safe, scope-enforcing query compiler that Dashboard Studio and KPI Studio both query.

**Architecture:** Two tables (`analytics_dataset`, `analytics_dataset_field`). A pure compiler turns a `QuerySpec` + dataset + scope clause into parameterised SQL. A thin service resolves the viewer's scope with the existing `buildScopeWhereClause`, runs the SQL on the right pool with a 20 s execution cap, and caches 60 s. An Express router exposes it at `/api/analytics-catalogue`.

**Tech Stack:** Express + TypeScript, mysql2, vitest; existing `buildScopeWhereClause` (`backend/src/shared/scopeAccess.ts:248`), `assertSafeIdentifier` (`backend/src/modules/integration-hub/adapters/databaseAdapter.ts:26`), `NAMED_POOLS` (`backend/src/modules/kpi/kpi-studio.pools.ts`).

---

## File structure

| File | Responsibility |
|---|---|
| `backend/sql/migrations/1950_analytics_catalogue.sql` | Tables + 5 seeded datasets |
| `backend/src/modules/analytics-catalogue/analytics.types.ts` | `Dataset`, `DatasetField`, `QuerySpec`, `QueryResult` types, enums as const arrays |
| `backend/src/modules/analytics-catalogue/date-range.ts` | Preset -> `{from,to}`, previous-period / previous-year shift (pure) |
| `backend/src/modules/analytics-catalogue/query-compiler.ts` | `validateSpec`, `compileQuery(dataset, spec, scope)` (pure) |
| `backend/src/modules/analytics-catalogue/scope.ts` | Viewer scope -> SQL clause per `scope_mode` (uses `buildScopeWhereClause`) |
| `backend/src/modules/analytics-catalogue/catalogue.service.ts` | Dataset CRUD, validation, introspection |
| `backend/src/modules/analytics-catalogue/query.service.ts` | Run a spec: scope, compile, execute, lookups, compare, cache |
| `backend/src/modules/analytics-catalogue/analytics.routes.ts` | HTTP surface |
| `backend/src/modules/analytics-catalogue/__tests__/*.test.ts` | compiler, date-range, scope, catalogue validation |
| `backend/src/app.ts` | mount `/api/analytics-catalogue` |
| `backend/src/db/runPendingMigrations.ts`, `backend/sql/MIGRATION_MANIFEST.lock.json` | register migration |

## Contracts (all later tasks rely on these names)

```ts
export const FIELD_ROLES = ["dimension", "measure", "time"] as const;
export const DATA_TYPES = ["string", "number", "date", "datetime", "boolean"] as const;
export const AGGS = ["sum", "avg", "min", "max", "count", "count_distinct"] as const;
export const GRAINS = ["hour", "day", "week", "month", "quarter", "year", "weekday"] as const;
export const OPS = ["eq","neq","in","not_in","gt","gte","lt","lte","between","contains","starts_with","is_null","not_null"] as const;
export const SCOPE_MODES = ["process_branch", "process", "branch", "employee", "constant", "org"] as const;
export const DATE_PRESETS = ["today","yesterday","last_7","last_30","last_90","this_week","this_month","last_month","this_quarter","this_year","all","custom"] as const;

interface DatasetField { fieldKey; label; columnName; role; dataType; defaultAgg; format; lookup: "none"|"process"|"branch"|"employee"; description; sortOrder; hidden }
interface Dataset { id; code; name; description; category; connection; sourceTable; timeField: string|null; scopeMode;
  processColumn; branchColumn; employeeColumn; scopeProcessId; maxRows; fields: DatasetField[] }
interface QuerySpec { dataset: string; dimensions: {field; grain?}[]; measures: {field; agg?; alias?}[];
  filters?: {field; op; value?}[]; dateRange?: {preset; from?; to?}; compare?: "previous_period"|"previous_year";
  scope?: {branchIds?: string[]; processIds?: string[]}; sort?: {key; dir: "asc"|"desc"}[]; limit?: number }
compileQuery(dataset, spec, scopeClause: {sql, params, joins}) -> { sql, params, columns: {key,label,kind,format}[] }
```

Output column keys: dimension `d0, d1…`, measure `m0, m1…` (stable, safe, never user text).

## Tasks

### Task 1: types + date ranges (TDD)
- Test `date-range.test.ts`: `resolveRange({preset:"last_7"}, 2026-09-30)` -> `2026-09-24..2026-09-30`; `this_month` -> `09-01..09-30`; `last_month` -> `08-01..08-31`; `this_quarter` -> `07-01..09-30`; custom validates ISO and swaps reversed; `shiftRange(prev period)` of `09-24..09-30` -> `09-17..09-23`; previous_year -> `2025-09-24..2025-09-30`.
- Implement `analytics.types.ts`, `date-range.ts`. Run, commit.

### Task 2: compiler (TDD)
Tests (`query-compiler.test.ts`) with a fixture dataset on `process_metric_actual`:
1. sum measure by month grain -> SQL contains ``DATE_FORMAT(t.`score_date`, '%Y-%m-01') AS `d0` `` and ``SUM(t.`actual_value`) AS `m0` `` and `GROUP BY 1`.
2. `count` with no field uses `COUNT(*)`; `count_distinct` uses `COUNT(DISTINCT …)`.
3. filter `in` with 3 values -> `IN (?,?,?)` and params in order; `between` two params; `contains` -> `LIKE ?` with `%v%`; `is_null` no param.
4. date range -> `t.`score_date` BETWEEN ? AND ?` first in WHERE.
5. scope clause `{sql:"sp.branch_id = ?", params:["b1"], joins:["LEFT JOIN process_master sp ON sp.id = t.`process_id`"]}` is ANDed and its params follow the date params.
6. unknown field key -> throws `UnknownField`; column name with `;` in dataset -> throws on identifier check; limit 999999 clamps to `maxRows`; weekday grain -> `WEEKDAY(...)`.
7. sort by `m0 desc` -> `ORDER BY `m0` DESC`; unknown sort key rejected.
8. lookup `process` dimension adds `LEFT JOIN process_master lp0 ON lp0.id = t.col` and selects `lp0.process_name`.
9. statement begins with `SELECT /*+ MAX_EXECUTION_TIME(20000) */`.
Implement, run, commit.

### Task 3: scope clause (TDD)
`buildDatasetScope(dataset, viewerScope)` where `viewerScope` = result of `buildScopeWhereClause` called with aliases returned by `scopeAliases(dataset)`:
- `process_branch` -> aliases `{processId:"t.`p`", branchId:"t.`b`"}`, no join.
- `process` -> join `process_master sp`, branch alias `sp.branch_id`.
- `branch` -> branch alias only.
- `employee` -> join `employees se ON se.id = t.`e``, aliases `se.process_id`/`se.branch_id`.
- `constant` / `org` -> no row clause; access decided by `canReadConstant` / `isOrgWide` in the service.
User narrowing `scope.processIds/branchIds` -> extra `IN (...)` on the same aliases. Tests for each mode. Commit.

### Task 4: migration + catalogue service
- Migration 1950 creating both tables (`utf8mb4_unicode_ci`, `IF NOT EXISTS`) and seeding datasets `process_kpi_daily`, `employee_kpi_daily`, `headcount`, `attendance_daily`, `bla_bli_blu_sales` with fields (idempotent `INSERT ... WHERE NOT EXISTS`).
- `catalogue.service.ts`: `listDatasets(viewer)` (org datasets hidden from non org-wide viewers), `getDataset(code)`, `saveDataset(input, userId)` with validation (identifiers, one time field max, measures numeric unless count, scope columns required by mode, external connection only with constant/org), `archiveDataset`, `introspect(connection, table)` guessing roles from data types. Unit test the validator. Register migration, regenerate lock, commit.

### Task 5: query service + routes + mount
- `runQuery(userId, spec)`: load dataset, access check, scope clause, compile, execute on `db` or named pool, map lookup names, optional compare query merged as `m{i}_prev`, 60 s cache keyed by user id + JSON spec, returns `{ columns, rows, truncated, compare?, generatedAt }`.
- Routes: `GET /datasets`, `GET /datasets/:code`, `POST /query`, `GET /scope-options`, admin `POST /datasets`, `PUT /datasets/:code`, `DELETE /datasets/:code`, `POST /datasets/introspect`. Validation errors -> 400 `INVALID_QUERY` with message.
- Mount in `app.ts`. Route contract test via supertest pattern used in `kpi-studio.routes.contract.test.ts`. Typecheck, run tests, commit, deploy, verify on production with a real query.
