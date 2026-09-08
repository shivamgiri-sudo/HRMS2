# KPI Studio — process grain

**Date:** 2026-09-07
**Status:** Approved for implementation
**Follows:** `2026-09-07-process-data-source-architecture-design.md`

## Problem

KPI Studio can define a metric, map it to columns in almost any source, and
evaluate a validated formula — but every result it produces is per-employee,
per-day. A large share of client SLAs are not per-employee at all: prepaid %,
ROI, net revenue, a TAT across a queue. These are process totals.

They cannot be produced by rolling up the employee-grain output, because a
process ratio is not the mean of employee ratios. "Prepaid % for GS1" is
`SUM(prepaid) / SUM(total)` over the whole process; averaging each agent's
personal percentage gives a different, wrong number, and the gap widens the more
uneven the agents' volumes are. The aggregation has to happen inside the query,
before the formula runs.

There is a second reason employee grain cannot serve these: **a client's own
database has no MAS employee IDs in it.** Their orders table has order rows, not
agents. There is nothing to group by and nothing to join on.

## Design

### 1. Grain is a property of the definition

`kpi_studio_definition.grain ENUM('employee','process') NOT NULL DEFAULT 'employee'`.

Employee-grain definitions behave exactly as today and write to
`kpi_daily_actual` — nothing regresses, and the default means every existing row
keeps its current meaning without a backfill.

A process-grain definition skips the per-employee grouping, aggregates across
all in-scope rows into one row per process per day, evaluates the formula once
with process totals as its inputs, and writes to `process_metric_actual`.

The formula engine, the field mappings, the aggregate whitelist and
`assertSafeIdentifier` are all reused unchanged. Only the `GROUP BY` and the
destination differ.

### 2. How a source says which rows belong to a process

Two mappings, covering the two cases that actually exist in this estate:

- **`constant`** — the whole source belongs to one process. This is a client's
  own database: every row in it is theirs. Configured by `process_id` on the
  data source.
- **`column`** — a column in the source carries a client identifier that is not
  a `process_master.id`. Shivamgiri's audit feed keys on `client_id = '487'`;
  `dialer_db.cdr_in_10_4` keys on `CampaignName = 'Blabliblu_IN'`. Neither value
  is anything mas_hrms would recognise, so the source must state the translation
  outright: *rows where `<process_key_column>` equals `<process_key_value>`
  belong to `<process_id>`*. A source can therefore serve one process; a second
  client on the same table is a second source row, which is also how it reads to
  whoever configures it.

Three new columns on `kpi_studio_data_source`:

```
process_key_kind   ENUM('none','constant','column') NOT NULL DEFAULT 'none'
process_key_column VARCHAR(64) NULL   -- 'column' only
process_key_value  VARCHAR(191) NULL  -- 'column' only
```

plus `process_id CHAR(36) NULL`, which names the target process for BOTH the
`constant` and `column` cases. `none` is the default, so every existing source
keeps behaving exactly as it does now.

A third possible mapping — joining through `employees.process_id` — is
deliberately **not** built. Internal per-employee metrics are already served by
the employee grain, and adding a third path now would be speculative.

### 3. Binding a process-grain metric to the dashboard

`process_metric_actual.metric_key` currently holds the registry's own
`metricKey` (`gs1_email_tat_sec`). A Studio definition knows its metric by
`kpi_metric_master.metric_code` instead. These are two namespaces for the same
idea, and until definitions themselves become data they have to be bridged
explicitly rather than assumed equal.

`KpiMetricDef.processSource` gains an optional `metricCode`. When set, the
scorecard resolver matches a `process_metric_actual` row whose `metric_key` is
**either** the registry key or that metric code. A metric therefore lights up
whether the number was typed in by hand or computed by Studio, with no second
storage path and no rename.

### 4. What is deliberately left out

- **Filters (`WHERE`)** — the next increment, and larger than it looks: it needs
  its own validated operator/value model to avoid becoming free-form SQL.
- **Scheduling** — compute stays manual-trigger until a process-grain metric has
  been run by hand and trusted.
- **Joins and multi-table sources.**
- **SQL Server**, unchanged from the previous spec.

## Verification

- A process-grain definition over a `constant`-mapped source produces one row per
  day in `process_metric_actual`, not one per employee.
- A ratio computed at process grain differs from the mean of employee ratios on
  real data — proving the aggregation genuinely happens in the query. This is the
  test that would catch a roll-up implementation masquerading as process grain.
- Existing employee-grain definitions still write to `kpi_daily_actual` and are
  untouched by the migration (default `'employee'`, no backfill).
- A source with `process_key_kind='none'` cannot back a process-grain definition,
  and says so rather than silently producing nothing.
- Migration applied to the live schema only with explicit approval, as before.
