# Why the slow reports are slow — measured, 2026-08-09

`monthly-shrinkage-trend` and `daily-shrinkage-report` take 30–100s. Six SQL rewrites have now
been tried and every one was rejected on measurement. **The SQL is not the problem.** Read this
before attempting a seventh.

## The measurement that settles it

`monthly-shrinkage-trend` reads 105k `attendance_daily_record` rows and returns 430. Built up one
join at a time, against live:

| Query | Time |
|---|---|
| round trip (`SELECT 1`) | 0.02s |
| `COUNT(*)` on attendance_daily_record (120,471 rows) | 0.44s |
| inner `GROUP BY`, no joins | 5.29s |
| + `JOIN employees` on the primary key | **22.72s** |
| + branch/process joins, grouped by name | **44.02s** |
| + `COUNT(DISTINCT record_date)` | **64.70s** |

Every join adds ~20s. The `employees` join is a *single-row primary-key lookup* — the EXPLAIN
confirms `Single-row index lookup on e using PRIMARY`. 105k PK lookups costing 17s is ~160µs
each, which is disk-seek latency, not memory.

## The cause

| | |
|---|---|
| `mas_hrms` on disk | **3,399 MB** (1,475 data + 1,924 index, 930 tables) |
| `innodb_buffer_pool_size` | **128 MB** — the stock MySQL default, never tuned |
| buffer pool free | **0 MB** |
| buffer pool hit rate | **95.1%** (a healthy OLTP server runs 99.9%+) |

The working set is 27× the cache. `attendance_daily_record` (55 MB data + 201 MB index) and
`employees` (39 MB data + **180 MB index**, 113 columns, 38 indexes) together need ~475 MB — on
their own, nearly 4× the entire pool.

Confirming it is eviction and not merely a busy server: running the identical query twice
back-to-back gives 71.7s then 68.7s. If the pool could retain the pages, the second run would be
dramatically faster. It cannot, so it isn't.

This also explains why the same query has been timed at 27s, 33s, 52s and 100s on different days.
Wall-clock here measures what else happened to be resident, not the query.

## Rewrites tried and rejected — do not repeat these

1. **Use `attendance_daily_record`'s own `branch_id`/`process_id`**, dropping two joins. Disagrees
   with the employee master on 1,276 and 634 rows. Faster and wrong.
2. **Group by ids instead of joined names.** Splits the three distinct branches that share the
   name "Head Office".
3. **Strip `ORDER BY` from the count wrapper.** No consistent benefit; MySQL already discards it.
4. **Two-level rewrite avoiding `COUNT(DISTINCT)`.** Identical results, no speedup.
5. **Derived table for the employee→name map.** 80.7s → 70.4s, within this server's noise.
6. **Force materialisation of that derived table** (`GROUP BY id`, so MySQL cannot merge it).
   *Slower*: 85–92s against 69–72s. Identical rows (same hash).

What *has* landed is real but structural, not arithmetic: `fetchPageWithTotal`
(`executors/types.ts`) stopped these reports executing twice — once for the page, once for a
`COUNT(*)` wrapper the same scan already knew. That halved the work. It cannot halve it again.

## What would actually fix it — both need approval

Neither is a code change, and both touch production, so neither has been done.

1. **Raise `innodb_buffer_pool_size`.** 128 MB against a 3.4 GB database is the whole story. A
   pool that holds the hot working set turns those 160µs lookups into memory reads. Requires a
   MySQL restart and depends on free RAM on the DB host, which has not been inspected.
2. **Drop redundant indexes.** 67 groups of exact-duplicate indexes exist, 69 redundant copies in
   total — `employees` alone carries **four** separate indexes on `employee_code`
   (`employee_code`, `idx_emp_code`, `idx_employees_directory_code`,
   `idx_employees_employee_code`). Index bytes compete with data for the same 128 MB. Care is
   required: some pairs are a `uq_*` unique constraint plus a plain index, and only the plain copy
   may be dropped — the unique one enforces a constraint.

Until one of those happens, narrowing a report's default date range only trades completeness for
latency; it does not make the database faster.
