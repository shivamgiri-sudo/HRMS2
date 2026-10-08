# Analytics Catalogue, Dashboard Studio and KPI Studio v2: design

Date: 2026-09-30. Owner request: KPI Studio and the Dashboard Builder are not fit for purpose; users must build their
own dashboards from any data source, with every common chart and diagram type and full styling, scoped by branch and
process, built for future growth.

## Why the current tools fail (evidence from the code)

- Neither tool has a governed catalogue of data. KPI Studio defines sources its own way (half its configuration lives in
  ~40 `backend/scripts/add-*-kpi-sources.ts` scripts); the Dashboard Builder has two hard-wired sources and a free-text
  metric key.
- Dashboard Builder: 5 widget types, monthly-only grouping, no drag/resize, no styling, no filters, no edit after
  create, sharing by role list only, and a process code vs process UUID mismatch that makes UI-created widgets report
  "outside your access".
- KPI Studio: not branch/process scoped on the server, no versioning (re-save overwrites), retire breaks recompute,
  one-day compute only, explain view never rendered, 5-6 overlapping KPI engines writing the same tables.

## Sub-project 1: Analytics Catalogue (semantic layer)

One registry of **datasets** that every analytics surface queries through one safe compiler.

### Data model (migration 1950)

`analytics_dataset`
- `id` CHAR(36), `code` VARCHAR(64) unique, `name`, `description`, `category`
- `connection` VARCHAR(32): `hrms` (mas_hrms) or a key of `NAMED_POOLS` (dialer, onfido, bella, apr, masmis)
- `source_table` VARCHAR(128) (validated identifier)
- `time_field` VARCHAR(64) (field_key of the default time field)
- `scope_mode` ENUM: `process_branch` (row has process and branch columns), `process` (process column; branch via
  process_master), `branch`, `employee` (employee column; process/branch via employees), `constant` (whole table
  belongs to `scope_process_id`), `org` (organisation-wide; only org-wide viewers)
- `process_column`, `branch_column`, `employee_column`, `scope_process_id`
- `max_rows` INT default 5000, `active_status`, `created_by`, timestamps

`analytics_dataset_field`
- `dataset_id`, `field_key`, `label`, `column_name` (validated identifier), `role` ENUM(`dimension`,`measure`,`time`)
- `data_type` ENUM(string, number, date, datetime, boolean), `default_agg` ENUM(sum, avg, min, max, count,
  count_distinct), `format` ENUM(number, integer, percent, currency, duration, text, date)
- `lookup` ENUM(none, process, branch, employee): a dimension holding an id is shown as a name
- `description`, `sort_order`, `hidden`

Seeded datasets (all `hrms`): process KPI actuals (`process_metric_actual`), employee KPI actuals
(`kpi_daily_actual`), employees/headcount, attendance, Bla Bli Blu sales. Admins register more from the UI.

### Query spec and compiler

`POST /api/analytics-catalogue/query` takes a `QuerySpec`:
`{ dataset, dimensions: [{ field, grain? }], measures: [{ field, agg, alias? }], filters: [{ field, op, value }],
dateRange: { preset } | { from, to }, compare?: 'previous_period' | 'previous_year', scope?: { branchIds?, processIds? },
sort?: [{ key, dir }], limit? }`

- Grains for time fields: hour, day, week, month, quarter, year, weekday.
- Aggregations: sum, avg, min, max, count, count_distinct.
- Filter ops: eq, neq, in, not_in, gt, gte, lt, lte, between, contains, starts_with, is_null, not_null.
- Date presets: today, yesterday, last_7, last_30, last_90, this_week, this_month, last_month, this_quarter,
  this_year, custom.
- The compiler is a pure function (dataset, spec, scope) -> `{ sql, params }`. Identifiers only ever come from the
  registry and pass `assertSafeIdentifier`; every value is a bound parameter; `limit` is clamped to `max_rows`; a
  MySQL `MAX_EXECUTION_TIME(20000)` hint bounds every statement.
- **Row scope is always the viewer's**, built from `buildScopeWhereClause` (the same predicate every other surface
  uses) against the dataset's scope columns, joining `process_master` / `employees` where the mode needs it.
  `constant` datasets require the viewer to read `scope_process_id`; `org` datasets require org-wide scope.
  External-pool datasets must be `constant` or `org` (their rows carry no HRMS ids).
- A user-chosen branch/process filter narrows within that scope; it can never widen it.
- Results cached 60 s per (viewer scope, spec). `compare` runs a second query over the shifted range.

### Endpoints

`GET /api/analytics-catalogue/datasets`, `GET /datasets/:code`, `POST /query`, `GET /scope-options` (branches and processes the
viewer can read). Admin (super_admin, admin): `POST/PUT/DELETE /datasets`, `POST /datasets/introspect` (column list of a
table with guessed roles).

## Sub-project 2: Dashboard Studio (Dashboard Builder v2)

Replaces the page at `/dashboard-builder` (same page code `DASHBOARD_BUILDER`); deep links `/dashboard-builder/:id`.
The old builder API and tables stay in place, untouched, so nothing existing breaks.

### Data model (migration 1951)

- `analytics_dashboard`: id, name, description, owner_user_id, home_branch_id, home_process_id, `theme` VARCHAR(32),
  `settings_json` (filter bar definition, default date range, auto-refresh, cross-filter on/off), is_template,
  active_status, version, timestamps.
- `analytics_widget`: id, dashboard_id, widget_type VARCHAR(32), title, subtitle, `query_json` (QuerySpec),
  `viz_json` (style), `layout_json` ({ lg, md, sm } each { x, y, w, h }), active_status, timestamps.
- `analytics_dashboard_share`: dashboard_id, principal_type ENUM(role, branch, process, user), principal_value,
  permission ENUM(view, edit).
- Access: owner and admins edit; shares grant view or edit; a branch/process share reaches users whose assignment
  scope covers it. **Seeing a dashboard never grants its data**: every widget queries with the viewer's scope.

### Endpoints

Dashboards CRUD, `PUT /dashboards/:id/layout` (bulk positions), widget CRUD, `POST /dashboards/:id/duplicate`,
shares GET/PUT, `GET /templates`, `POST /templates/:id/use`.

### Front end

- Grid: `react-grid-layout` (drag, resize, responsive breakpoints 12/8/4/1 columns).
- Visualisation registry `src/components/analytics/viz/`: each type declares label, category, icon, data requirements
  (min/max dimensions and measures), style defaults and a renderer. Adding a type is one file plus one registry line.
- Types (31):
  - Tiles: KPI (value, delta vs previous period, sparkline, target), gauge, bullet, progress, leaderboard.
  - Comparison: column, bar (horizontal), stacked column, 100% stacked, grouped, waterfall.
  - Trend: line, area, stacked area, step line, combo (bars + line, dual axis).
  - Part to whole: pie, donut, nested donut, treemap, funnel, radial bar.
  - Distribution: histogram, scatter, bubble, box plot, heatmap matrix, calendar heatmap.
  - Relationship and diagrams: radar, Sankey, flow diagram (@xyflow/react).
  - Tables: table (sort, pagination, totals, conditional colours), pivot table.
  - Content: text (markdown subset, no HTML), section header.
- Editor: widget gallery; config panel with Data tab (dataset, fields, grain, aggregation, filters, sort, top-N,
  limit) and Style tab (palette or per-series colours, value-threshold colours, legend, data labels, axis titles,
  grid lines, number format and decimals, prefix/suffix, stacking, curve, orientation, card style, title alignment);
  live preview; undo/redo; duplicate widget.
- Dashboard: filter bar (date range, branch, process, any dataset field), click-to-filter across widgets, themes
  (Light, Midnight, Corporate, MAS Gold, Emerald, High contrast) applied to the canvas, auto-refresh, export of a
  widget or the whole dashboard to CSV / XLSX, print to PDF, starter templates.

## Sub-project 3: KPI Studio v2

- **Scoped authoring**: definitions, preview, compute and uploads check the caller can read the target process/branch
  (`readableProcessIds`); company-wide definitions need org-wide scope.
- **Versioning**: saving an edit closes the current version (`effective_to` = new start - 1 day) and inserts a new one;
  history view; edit and clone from the list. Retire sets `effective_to`, never `active_status = 0`, so past dates
  still recompute.
- **Range backfill**: compute a date range (max 62 days) as a tracked job with per-day progress; dry run by default.
- **Complete source configuration in the UI**: all six source types, process key settings, field filters; the
  scripts become optional.
- **Explain drill-down** wired into the UI (component exists, unrendered today).
- **Catalogue link**: KPI results are queryable in Dashboard Studio through the seeded KPI datasets.
- Correctness fixes: employee-grain `date_format`, field-name cache invalidated on edit.
- Engine consolidation is documented as a migration path (which engine each metric family moves to); no engine is
  deleted in this pass, because production scorecards read them.

## Testing

- Backend: compiler (SQL shape per grain/agg/op, identifier rejection, scope clause per mode, limit clamp), dataset
  validation, dashboard/share access rules, KPI Studio scope and versioning.
- Front end: every visualisation renders from sample data; registry requirement checks; layout helpers; spec builder.
- Production: browser verification of creating a dashboard end to end as a scoped user.

## Out of scope for this pass

Geographic maps (no geo data), writing SQL by hand, scheduled e-mail of dashboards, deleting the legacy KPI engines.
