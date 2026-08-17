# UAT Performance Report

Session: continuation of the go-live UAT brief, `uat-100pct-readiness` branch, base SHA `a599081c`.
Environment: dedicated dev backend (port 5056) + two dev frontends (5041, 8080) in an isolated
git worktree at `/c/tmp/hrms2-uat-100pct`, DB reached via the public IP (`122.184.128.90`) —
the office LAN address was unreachable for the whole of this session.

## Directly observed, live evidence for P0 items 11-14 (MySQL capacity)

1. **Backend cold-boot schema verification timed out.** On startup:
   `[migration] Schema verification error: Error: verifySchemaVersion exceeded 10000ms`
   (logged twice). `GET /api/health` returned `503 degraded` for ~10s immediately after boot,
   while an ordinary `GET /api/employees` in the same window returned in well under 1s (401,
   auth-required, but fast) — the slow path is specific to whatever `verifySchemaVersion` does,
   not general query latency.

2. **Fresh DB connection establishment degraded partway through the session**, independent of
   the health-check issue above. Three consecutive standalone script connections (via `tsx`,
   fresh `mysql2` pool each time) timed out at 30s, 45s, and 90s respectively — genuinely hung,
   not merely slow (`timeout 90 ...` returned exit 124). In the same window, the **already-running**
   backend's warm connection pool kept responding normally (`/api/health` 200 in 3.2s — slower
   than its earlier 3ms best case, but working). This isolates the problem to **new connection
   establishment**, not the database engine being down or query execution itself being broken.

3. **Most likely cause**: this session ran concurrently with a large number of other active
   worktrees/sessions on the same machine (51 worktrees listed by `git worktree list` at one
   point today), several of which appeared to be running their own dev backends against the
   same shared production-scale database over the same public IP. This matches the brief's own
   framing exactly (item 11: "Buffer pool measured at 128 MB against ~19.55 GB server data...
   severe cache thrashing") — contention from many simultaneous dev instances hitting one
   under-provisioned DB is a very plausible mechanism for exactly this symptom (fast warm-pool
   reads, slow/hung new-connection setup).

4. **Not independently confirmed**: the actual physical RAM of the production MySQL host, its
   current `innodb_buffer_pool_size`, or `SHOW STATUS`-level hit-rate/Threads_running numbers —
   this session's backend ran in dev mode against the shared DB and never had a safe, exclusive
   window to run the brief's own tuning-report-only script without that measurement itself being
   contaminated by the same concurrent load it's trying to characterize.

## Test-suite timing

| Suite | Duration | Result |
|---|---|---|
| Backend full test-baseline (`npm run test:baseline`, 8581 tests) | not separately timed but ran to completion in this session's background | 8581 passed, 0 failed |
| Playwright `page-smoke` project, full run #1 (before SidebarNav fix) | 11.2 min | 24 passed, 35 failed, 3 skipped |
| Playwright `page-smoke` project, full run #2 (after SidebarNav fix) | 11.3 min | 26 passed, 33 failed, 3 skipped |

The near-identical wall-clock time between the two smoke runs despite fixing a rendering defect
suggests the 15s-per-failing-test timeout budget (not raw page load time) dominates total suite
duration — most of the ~11 minutes is failing tests exhausting their timeout, not passing tests
running slowly.

## AON Shrinkage (P0 item 13)

Not re-benchmarked this session. Project memory records this query as consistently timing out
at 120s (gateway timeout) as of the last check; the brief's own instruction is to re-benchmark
**after** DB tuning, which per the finding above has not yet happened this session (tuning
requires the DBA-level access and exclusive measurement window this session did not have).
Treat as still open, not re-verified.

## What this session did NOT measure

- p50/p95 for the "top 20 slow reports" (brief item 14) — not attempted this pass, genuine scope
  gap.
- Individual page load times across the 377-route inventory — chrome-devtools MCP was
  unavailable (see `UAT_PENDING_ISSUES.csv` P007); Playwright's `page-smoke` suite gives a
  pass/fail signal per page but was not instrumented to record load-time metrics this pass.
