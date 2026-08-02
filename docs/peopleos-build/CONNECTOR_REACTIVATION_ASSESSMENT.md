# Connector Reactivation Assessment

Six Integration Hub schedules are disabled. Their credentials were repaired on
2026-08-01 (they predated an `ENCRYPTION_KEY` rotation), which makes
reactivation *possible* — this assesses whether it is *advisable*, one connector
at a time.

All findings below were measured against production on 2026-08-02. Nothing was
enabled, and nothing should be until the decisions at the end are made
deliberately.

**Headline: five of the six cannot move data at all, and the sixth would
double-count.** None of them should be enabled as they stand.

---

## 1. The two structural facts that decide most of this

### 1.1 A connector with no table map cannot promote anything

`promotionEngine` writes into the `target_table` named by
`integration_table_map`. Connectors without an active map fetch rows and promote
none.

| Connector | Table maps | Field maps | Can promote? |
|---|---|---|---|
| `dialer_1` (enabled) | 5 | 20 | yes |
| `dialer_2` (no schedule) | 3 | 12 | yes |
| `cosec_biometric` | 1 | 3 | yes |
| `Cosec` | **0** | 0 | **no** |
| `db_audit_sync` | **0** | 2 | **no** |
| `db_external_sync` | **0** | 0 | **no** |
| `dialer_db_sync` | **0** | 0 | **no** |
| `shivamgiri_quality` | **0** | 0 | **no** |

Enabling any of those five produces source reads, connector-run rows and log
noise, and zero promoted data.

### 1.2 The unique key includes `integration_key` — which is the real hazard

**Corrected 2026-08-02.** An earlier revision of this document said promotion is
"INSERT, not upsert". That is true of `promotionEngine.ts:50`, but that path is
whitelisted to `dialer_session_log` only (`INTEGRATION_TARGET_TABLES`) and never
writes biometric or call data at all. The path that *does* write them is
`adapters/dbSyncService.ts`, and it uses `ON DUPLICATE KEY UPDATE`.

So re-running the same connector over the same window is a **harmless upsert**,
not an error per row. The second consequence below is unaffected, and it is the
one that matters. The destination unique keys are:

```
integration_biometric_daily  (integration_key, source_table, employee_code, activity_date)
integration_call_daily       (integration_key, source_table, employee_code, activity_date, process_name)
dialer_session_log           (employee_code, session_date, integration_key)
```

Two consequences, and the second is the dangerous one:

- **Re-running the same connector** over the same window upserts. Harmless.
- **A different connector** writing the same employee and date does **not**
  collide, because `integration_key` differs. It inserts a parallel row. Any
  consumer that does not filter on `integration_key` then double-counts.

**This is now guarded in code**, not only in this document — see
`integration-hub/canonical-writer.ts`. `integration_biometric_daily` declares
`cosec_sqlserver` as its single permitted writer, and `dbSyncService` refuses any
other connector *before reading the source*. Disabled is a state someone can
change in one click months from now; the safeguard has to live where the write
happens rather than in a recommendation.

Consumers of `integration_biometric_daily` in `break-management.service.ts`
(five call sites), `dashboard-drilldown.service.ts` and `dashboard-metric.service.ts`
join or aggregate it **without** filtering `integration_key`. Only
`biometric-punch.routes.ts:127` filters, and only for the `cosec_live` webhook.

---

## 2. The four overlaps you asked about

### 2.1 `shivamgiri_quality` vs the nightly `quality_audit` call — NOT a duplicate, but useless

| | source db | tables | maps |
|---|---|---|---|
| `shivamgiri_quality` | `Shivamgiri` | `[]` | none |
| `quality_audit` (nightly worker, direct) | `db_audit` | `call_quality_assessment` | n/a — called directly |

Different source databases entirely, so no duplication. But `shivamgiri_quality`
names no tables and has no maps, so it cannot promote. Separately, the
`Shivamgiri` database is a stalled pilot: `ci_manual_audit_result` ends
2026-05-23 and `ci_call_master` covers a single day.

**Verdict: leave disabled.** It would read a stale pilot database and write
nothing. The live quality path does not depend on it — `kpi-daily-sync.worker`
calls the `quality_audit` connector directly, which is why quality coverage rose
from 41 to 115 employees on 2026-08-02 with every schedule still off.

### 2.2 `dialer_db_sync` vs `dialer_1` — same source, no path, real read cost

Both point at `dialer_db`. `dialer_1` has 5 table maps and 20 field maps and is
healthy: **17 consecutive complete runs, 5,243 rows promoted** since the
credential fix, `integration_call_daily` current to today.

`dialer_db_sync` names no tables and has no maps. Its source is the same
database, whose largest shard `vicidial_agent_log_11_5` holds **19.3M rows**.

**Verdict: leave disabled.** It cannot promote, and its only effect is read load
against the dialer during a window `dialer_1` already covers hourly.

### 2.3 `Cosec` vs `cosec_biometric` — overlapping source, and one would double-count

Both point at `NCOSEC`.

- `Cosec`: no tables, no maps → cannot promote. Last scheduled run 2026-06-15.
- `cosec_biometric`: maps `dbo.Mx_ATDEventTrn → integration_biometric_daily`.

The important part is what already writes that table:

```
integration_key   source_table            rows    latest       last write
cosec_sqlserver   dbo.Mx_ATDEventTrn     34,617   2026-08-02   2026-08-02 12:59:45
cosec_mysql       …integration_biometric… 1,036   2026-07-12   2026-07-13 00:08:15
cosec_sqlserver   dbo.Mx_DATDTrn            790   2026-07-11   2026-07-12 10:04:21
```

Biometric data is **already flowing**, written under `integration_key =
'cosec_sqlserver'` from the **same source table** `dbo.Mx_ATDEventTrn`, by the
`cosec-sync` worker registered in `all-workers.ts` — not by any schedule.

Enabling `cosec_biometric` would write the same source rows under a *different*
`integration_key`. Because the unique key includes that column, they would not
collide; they would be **parallel duplicate rows**. Break management, the
attendance drill-down and the dashboard metrics all read this table without
filtering the key, so attendance and punch counts would inflate.

**Verdict: leave both disabled. `cosec_biometric` is the highest-risk of the
six** — it is the only one that would successfully write, and what it writes is
duplication of live data.

### 2.4 `db_audit_sync` and `db_external_sync` — duplicate sources of working direct calls

| | source db | tables | maps | already read by |
|---|---|---|---|---|
| `db_audit_sync` | `db_audit` | `[]` | 0 table / 2 field | `quality_audit` (nightly, direct) |
| `db_external_sync` | `db_external` | `[]` | none | `outbound_calls` (kpi connector, direct) |

Neither can promote. Both target databases are already read by working
direct-call connectors. `db_audit.call_quality_assessment` holds ~438k rows and
grows continuously.

**Verdict: leave both disabled.** No promotion path, and the data they would
read is already reaching HRMS by a shorter route.

---

## 3. Per-connector summary

| Connector | Cron | Last sched. run | Credentials | Can promote | Overlaps | Recommendation |
|---|---|---|---|---|---|---|
| `Cosec` | `0 * * * *` | 2026-06-15 | valid | **no** | `cosec_biometric` (same NCOSEC) | leave disabled |
| `cosec_biometric` | `0 */5 * * * *` | 2026-07-27 | valid | yes | **duplicates the live `cosec_sqlserver` writer** | leave disabled — highest risk |
| `db_audit_sync` | `0 2 * * *` | 2026-06-15 | valid | **no** | `quality_audit` reads same db | leave disabled |
| `db_external_sync` | `0 */6 * * *` | never | valid | **no** | `outbound_calls` reads same db | leave disabled |
| `dialer_db_sync` | `0 */4 * * *` | 2026-06-14 | valid | **no** | `dialer_1` reads same db | leave disabled |
| `shivamgiri_quality` | `0 * * * *` | 2026-07-27 | valid | **no** | none — different source | leave disabled |

Note `cosec_biometric`'s cron is a **six-field** expression (`0 */5 * * * *`),
i.e. seconds-resolution: every five *minutes*, not hours. Against a SQL Server
whose post-login phase takes ~15 seconds, that cadence deserves its own review
before it ever runs again.

---

## 4. Staged reactivation plan

None of the six is ready. The sequence below is what *would* make one safe, in
order; each stage gates the next.

**Stage 0 — decide whether the connector is wanted at all.**
Five of six have no promotion path, which usually means the Integration Hub route
was abandoned in favour of a direct call. If the direct call is the intended
design, the correct action is to **delete the schedule**, not enable it. That
removes the ambiguity permanently.

**Stage 1 — for any connector that is wanted: define its table and field maps.**
Until `integration_table_map` has an active row, enabling only produces load.
Targets are whitelisted in `integration.service.ts:APPROVED_MAPPING_TARGETS` —
currently `dialer_session_log`, `integration_call_daily`,
`integration_biometric_daily`.

**Stage 2 — resolve the duplication before enabling anything that writes.**
For `cosec_biometric` specifically, one of:
  a. retire the `cosec-sync` worker and let the schedule own the table; or
  b. make every consumer filter `integration_key`; or
  c. leave the worker as the single writer and delete the schedule.
Option (c) is least work and matches what is already true.

**Stage 3 — enable ONE connector, off-peak, and watch a single run.**
Confirm `rows_fetched > 0`, `rows_promoted > 0`, `rows_failed = 0`, and that the
destination row count rose by the promoted amount and no more.

**Stage 4 — confirm no double-count.**
`SELECT integration_key, COUNT(*) … GROUP BY integration_key` on the destination.
A new key appearing beside an existing one for the same dates is the failure
signal.

**Stage 5 — only then consider the next connector.** Never two at once: with
plain INSERTs and key-scoped uniqueness, two new writers are indistinguishable
from one working and one duplicating.

### Rollback

Per connector, in order:

```sql
-- 1. stop it
UPDATE integration_schedule SET enabled = 0 WHERE integration_key = ?;

-- 2. see what it wrote
SELECT integration_key, source_table, COUNT(*), MIN(created_at), MAX(created_at)
  FROM <destination> WHERE integration_key = ? GROUP BY integration_key, source_table;

-- 3. remove only its rows — integration_key scopes this precisely,
--    which is the one advantage of it being in the unique key
DELETE FROM <destination> WHERE integration_key = ? AND created_at >= '<enable time>';
```

Because every promoted row carries its `integration_key` and `run_id`, a
reactivation is fully reversible without touching another connector's data. That
is the property that makes Stage 3 safe to attempt at all.

---

## 4a. Classification, and what should happen to each

Verified against production 2026-08-02: all six remain `enabled = 0`. Only
`dialer_1` and `lms_sync` are enabled.

| Connector | Class | Why | Disposition |
|---|---|---|---|
| `cosec_biometric` | **DUPLICATE** | Same source table as the live `cosec-sync` worker, which owns `integration_biometric_daily` under `cosec_sqlserver` | **Deprecate.** Blocked in code by `canonical-writer.ts`; delete the schedule once that is confirmed for a full cycle |
| `Cosec` | **SUPERSEDED** | Same `NCOSEC` source, no table maps, replaced by the worker | Deprecate, then delete |
| `dialer_db_sync` | **SUPERSEDED** | Same `dialer_db` as `dialer_1`, which is healthy and hourly; no maps | Deprecate, then delete |
| `db_audit_sync` | **SUPERSEDED** | `db_audit` is already read directly by the nightly `quality_audit` connector | Deprecate, then delete |
| `db_external_sync` | **SUPERSEDED** | `db_external` already read directly by `outbound_calls`; never ran once | Deprecate, then delete |
| `shivamgiri_quality` | **LEGACY** | Points at a stalled pilot DB (`ci_manual_audit_result` ends 2026-05-23); no maps | Retire — the data behind it is dead, not merely routed elsewhere |
| `dialer_1` | **REQUIRED** | 17 clean runs, 5,243 rows, current | Keep enabled |
| `lms_sync` | **REQUIRED** | Enabled and scheduled | Keep enabled |

**Nothing in the table above has been executed.** All six stay disabled, no
schedule has been deleted, and no `DEPRECATED` flag has been written to the
database — marking them needs a schema change and an approved production write,
neither of which is in scope here.

The one thing that *is* enforced today is the duplicate-write guard, because it
is the only item that fails dangerously and silently if someone acts before the
rest of this is decided.

### The canonical biometric source, determined rather than chosen

| integration_key | source_table | rows | latest | last write |
|---|---|---|---|---|
| `cosec_sqlserver` | `dbo.Mx_ATDEventTrn` | 34,620 | 2026-08-02 | 2026-08-02 13:16 |
| `cosec_sqlserver` | `dbo.Mx_DATDTrn` | 790 | 2026-07-11 | 2026-07-12 10:04 |
| `cosec_mysql` | `…integration_biometric…` | 1,036 | 2026-07-12 | 2026-07-13 00:08 |

`cosec_sqlserver` is canonical on the evidence: it is the only writer still
current, and it carries 97% of the rows. `cosec_mysql` stopped three weeks ago.

---

## 5. What is working, for contrast

| Path | Mechanism | State |
|---|---|---|
| Call data | `dialer_1` schedule | 17 clean runs, 5,243 rows, current to today |
| Biometric | `cosec-sync` **worker** | 34,617 rows, current to 12:59 today |
| Quality KPI | `quality_audit` via nightly worker | 41 → 115 employees, current to 2026-08-01 |
| LMS | `lms_sync` schedule | enabled, next run scheduled |

Every one of these bypasses the six disabled schedules. That is the strongest
evidence that they are redundant rather than missing.
