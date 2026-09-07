# Process Data Source Architecture — manual upload + direct DB connection

**Date:** 2026-09-07
**Status:** Approved for implementation

## Problem

The Process KPI Dashboard shows every client-process metric from the "Process KPI's"
sheet, but a large share of them have no data source anywhere in the estate and
render as an honest `not_tracked` placeholder: Prepaid %, Net Revenue, ROI, Email
Closure TAT, Reshipment TAT, PAN Submission, and GS1's three TATs.

Two different situations produce that gap, and they need two different answers:

1. **The client has no system for it.** The figure exists only in someone's
   spreadsheet or head. It needs a place for an authorised person to enter it.
2. **The client has their own database** holding it. It needs a connection, a
   column mapping, and a refresh — not re-keying.

Today neither path exists at process grain. This spec covers both, behind one
consistent resolver contract so the dashboard does not care which one fed a number.

## What already exists (verified live, 2026-09-07)

Reused rather than rebuilt:

- **`external-db` module** (`backend/src/modules/external-db/`) — `integration_config`
  rows of `integration_type='database'`, AES-256-GCM encrypted credentials, MySQL and
  SQL Server support, connection pooling with read-only enforcement, and a working
  test-connection endpoint. Its one limit: `GET/PUT/:key` only ever *edit* rows that
  already exist. There is no create route, so a genuinely new client database cannot
  be registered at runtime.
- **KPI Studio** (`backend/src/modules/kpi/kpi-studio.*`) — a real 3-source ingestion
  engine (`local_query`, `integration_connector` reading through the `external-db`
  pools, and `manual`/`upload`), a formula evaluator, upload-batch tracking, and a
  column+aggregate field-mapping UI whose identifiers are validated through
  `assertSafeIdentifier`. Its grain is per-employee-per-day.
- **The registry resolver pattern** (`kpi-metric-registry.ts` +
  `kpi-scorecard.service.ts`) — a metric declares where its number comes from
  (`kpiMetricCode` → `kpi_daily_actual`, `cdrSource` → `dialer_db`, Shivamgiri client
  id → the call-audit pilot), and the service resolves it with a uniform
  `availability: ok | no_data | not_tracked` contract. Three sources already ride this
  pattern; this spec adds a fourth.

## Design

### 1. Storage: a process-grain sibling table

```sql
CREATE TABLE process_metric_actual (
  id                   CHAR(36)     NOT NULL PRIMARY KEY,
  process_id           CHAR(36)     NOT NULL,
  metric_key           VARCHAR(64)  NOT NULL,
  score_date           DATE         NOT NULL,
  actual_value         DECIMAL(18,4)    NULL,
  source               ENUM('manual','connector') NOT NULL,
  source_connector_key VARCHAR(64)      NULL,
  note                 TEXT             NULL,
  created_by           CHAR(36)         NULL,
  created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_process_metric_date (process_id, metric_key, score_date),
  KEY idx_process_date (process_id, score_date)
);
```

`metric_key` is the registry's own key (`abc_prepaid_pct`, `gs1_email_tat_sec`), not a
`kpi_metric_master.metric_code`. The registry is already the single place that decides
what a metric means; requiring a second registration in `kpi_metric_master` would add a
setup step that buys nothing.

**Why a new table rather than `kpi_daily_actual` or `kpi_studio_manual_value`:**

- Both are per-employee. Prepaid %, ROI and the GS1 TATs are process-wide figures with
  no single owning employee. Writing one employee's id on a process-wide number
  invents a fact.
- Making `employee_id` nullable on `kpi_daily_actual` would silently change results
  everywhere: `kpi-scorecard.service.ts` and its siblings all `JOIN employees e ON
  e.id = k.employee_id`, and an inner join drops NULL-keyed rows without erroring.
  That is a large, quiet blast radius for a feature that does not need it.
- A separate table keeps every existing consumer of both tables untouched.

KPI Studio's **UI and upload-batch mechanics are still reused** — the new flow is a
process-grain mode of the same screens, not a second upload product.

### 2. Resolver: a fourth source type on the registry

`KpiMetricDef` gains an optional marker:

```ts
/** Reads process_metric_actual — a figure entered manually or pulled from the
 *  client's own database, rather than measured by an internal pipeline. */
processSource?: { grain: "process" };
```

`computeScorecards()` resolves those metrics from `process_metric_actual`
(`AVG` for rates/durations, `SUM` for volumes — the same `aggExprFor()` family split
already used), with the identical `availability` contract as every other source. A
metric with a `processSource` and no rows returns `no_data`, never a fabricated zero —
the rule this whole dashboard is built on.

### 3. Connecting a client's own database

Three additions, all to the existing `external-db` module:

- **`POST /api/external-db`** — create a connector. Same validation schema as the
  existing `PUT`, same encryption path, generating a new `integration_key`.
- **`integration_config.process_id`** (nullable) — tags a connector as belonging to
  one process. NULL means an estate-wide connector (COSEC, dialer, db_bill), so every
  existing row keeps its current meaning untouched.
- **Field mapping → aggregate.** A connector maps `{metric_key, table, value_column,
  aggregate, date_column}`, reusing KPI Studio's existing `assertSafeIdentifier`
  guard and its whitelisted-aggregate approach. Running it aggregates over the whole
  date window (no employee grouping) and upserts one `process_metric_actual` row per
  metric per day, `source='connector'`.

Refresh is on-demand (a "Refresh now" action) plus one daily pass in the existing
worker. Configurable per-connector schedules are deliberately out of v1.

Reads stay read-only: connector pools already enforce it in `external-db.service.ts`,
and every statement issued is a `SELECT`.

### 4. Manual upload

- Single-value entry (process, metric, date, value, note).
- Spreadsheet upload of the same four columns, with the row-level validation and
  batch record KPI Studio's upload path already provides.
- Both upsert into `process_metric_actual` with `source='manual'`, keyed on
  `(process_id, metric_key, score_date)`, so a re-upload corrects rather than
  duplicates.

### 5. Access control

Configuration and entry are scoped to the process, not reserved to admins:
`process_manager` / `operations_manager` (plus the existing viewer-role set for
read) acting on a process inside their own scope, enforced server-side through the
same `buildScopeWhereClause` predicate the rest of the module uses. Admin keeps
unconditional access. UI gating is not the control; the query predicate is.

### 6. Bundled fix: Studio writes that no process dashboard can see

`kpi-studio.compute.ts`'s `INSERT INTO kpi_daily_actual` omits `process_id_at_event`
and `branch_id_at_event`, though both columns exist and are what every process-scoped
query filters on. Any figure Studio computes today is therefore invisible to the
Process KPI Dashboard and to `process-performance`. The insert gains both columns,
resolved from the employee's current `process_id`/`branch_id` at write time — the
same live-hierarchy approach already used after finding `team_leader_id_at_event` was
never written either.

## Out of scope for v1

- Free-form SQL in connector config (mapping stays column + whitelisted aggregate).
- A configurable per-connector refresh scheduler.
- Any schema or behaviour change to `kpi_daily_actual` or `kpi_studio_manual_value`.
- Backfilling history from a newly connected database beyond the requested window.

## Verification

- Migration applied to a local/staging schema only; not run against production
  without separate explicit approval (charter hard gate).
- `POST` a connector, `POST /test` it, map one metric, refresh, and confirm a real row
  lands in `process_metric_actual` and surfaces on the dashboard as `availability:ok`.
- Upload a spreadsheet for a `not_tracked` metric and confirm the same.
- Confirm an out-of-scope user gets no rows for a process outside their scope — tested
  at the API, not by hiding UI.
- Confirm a metric with no rows still reports `no_data`, not `0`.
- `cd backend && npx tsc --noEmit` clean on touched files; frontend `npm run build`.
