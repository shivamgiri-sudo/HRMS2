# Why the slow reports are slow — measured, 2026-08-09, **corrected 2026-08-10**

`monthly-shrinkage-trend` and `daily-shrinkage-report` are slow. Seven SQL rewrites have now
been tried and every one was rejected. **The SQL is not the problem** — but the first version of
this document got the reason wrong, and the correction is the most useful thing in it.

## Correction: the original numbers were measured over the public route

Everything in the first version was timed against `122.184.128.90`, the off-LAN address. Re-run
from the office LAN against `192.168.10.6` — same server, same data, same 128 MB buffer pool,
verified by `@@hostname` and matching row anchors — the same statement runs roughly **three to
four times faster**:

| | public route | office LAN |
|---|---|---|
| `monthly-shrinkage-trend`, 430 rows | 69–99s | **12–32s** |

So the headline "30–100s" was substantially an artefact of where it was measured from. On-LAN
users were never waiting as long as the original figures implied.

## The finding that supersedes the rest: this server cannot be benchmarked by A/B

Run-to-run variance on identical SQL is roughly **±80%**, and it swamps every effect worth
measuring. The clinching evidence, three alternating passes on the LAN:

| | median |
|---|---|
| with the SQL window function | 19.52s |
| **identical query, window function removed** | **28.08s** |

Removing work made it measure *slower*. That is not a result, it is the noise floor announcing
itself — individual runs ranged 17.83s to 32.04s for the same statement. An earlier isolation
ladder that appeared to show the query costing 6.33s was simply a lucky moment on the same
distribution.

**Consequence: do not accept — or produce — a query-shape conclusion here from a handful of
timings.** That includes several in the first version of this document, which quoted a clean
"every join adds ~20s" ladder built from single runs. Those numbers are not reproducible. Nothing
short of many alternating passes, or `performance_schema`, can distinguish a real improvement
from load on this box.

## What is still solidly true

These are read from server state, not inferred from wall-clock, and are unaffected by the
measurement path:

| | |
|---|---|
| `mas_hrms` on disk | **3,399 MB** (1,475 data + 1,924 index, 930 tables) |
| `innodb_buffer_pool_size` | **128 MB** — the stock MySQL default, never tuned |
| buffer pool free | **0 MB** |
| buffer pool hit rate | **95.1%** (a healthy OLTP server runs 99.9%+) |

The working set is 27× the cache. `attendance_daily_record` (55 MB data + 201 MB index) and
`employees` (39 MB data + **180 MB index**, 113 columns, 38 indexes) together need ~475 MB — on
their own, nearly 4× the whole pool. A cache that small against a database this size is a real
limitation and a reasonable suspect for both the slowness and the variance.

What can no longer be claimed is the *magnitude*: the original text asserted the buffer pool
explained a 30–100s query, and the LAN re-measurement shows the network path accounted for much
of that. Treat cache starvation as consistent with the evidence, not as a quantified cause.

## Rewrites tried and rejected — do not repeat these

The first four were rejected on correctness or on showing no benefit; given the variance above,
read every "no benefit" as "no effect large enough to see through the noise", which is the same
practical answer.

1. **Use `attendance_daily_record`'s own `branch_id`/`process_id`**, dropping two joins. Disagrees
   with the employee master on 1,276 and 634 rows. Faster and wrong.
2. **Group by ids instead of joined names.** Splits the three distinct branches that share the
   name "Head Office".
3. **Strip `ORDER BY` from the count wrapper.** No measurable benefit; MySQL already discards it.
4. **Two-level rewrite avoiding `COUNT(DISTINCT)`.** Identical results, no measurable benefit.
5. **Derived table for the employee→name map.** No measurable benefit.
6. **Force materialisation of that derived table** (`GROUP BY id`, so MySQL cannot merge it).
   Identical rows; measured slower, but see the variance caveat.
7. **Remove the window function** and compute the 3-month rolling average in Node. Measured
   *slower* than keeping it, which is how the noise floor was discovered. Not worth doing.

What *has* landed is real because it is structural rather than a timing claim:
`fetchPageWithTotal` (`executors/types.ts`) stopped these reports executing twice — once for the
page, once for a `COUNT(*)` wrapper the same scan already knew. That halves the work by
construction, whatever the clock says.

## What would actually help — both need approval

Neither is a code change, and both touch production, so neither has been done.

1. **Raise `innodb_buffer_pool_size`.** 128 MB against a 3.4 GB database is indefensible on its
   own terms regardless of how much of the observed latency it explains. Requires a MySQL restart
   and depends on free RAM on the DB host, which has not been inspected.
2. **Drop redundant indexes.** 67 groups of exact-duplicate indexes exist, 69 redundant copies in
   total — `employees` alone carries **four** separate indexes on `employee_code`
   (`employee_code`, `idx_emp_code`, `idx_employees_directory_code`,
   `idx_employees_employee_code`). Index bytes compete with data for the same 128 MB. Care is
   required: some pairs are a `uq_*` unique constraint plus a plain index, and only the plain copy
   may be dropped — the unique one enforces a constraint.

## Method note for whoever measures next

Two traps, both of which caught this investigation:

- **Record which DB address you used.** `122.184.128.90` and `192.168.10.6` are the same server;
  which one resolves depends on the network the dev machine is on that day, and the difference is
  3–4× on these queries. A timing without its route is not a measurement.
- **Alternate A and B repeatedly and take medians.** A single A-then-B pair on this server will
  confidently report whichever ran during the quieter moment.
