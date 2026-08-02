# Quality target governance — validation report

Covers the migration-manifest guard, the recovery of migration 543, the
quality-target lifecycle, simulation/worker parity, the two new screens, and the
connector duplicate-write guard.

Everything below was measured on 2026-08-02. Where something could not be
verified, it says so rather than being left to look verified.

---

## 1. Commits

| Commit | What |
|---|---|
| `772b8d29` | 543 recovered byte-exact; `knownDangling` cleared |
| `47cd58ea` | 1058 state machine, transition service, 7 lifecycle routes, 26 tests |
| `da822e33` | Simulation/worker parity — shared evaluator, 4 divergences fixed |
| `604b07b9` | `/quality/targets` config screen |
| `dcb4bb04` | `/quality/pipeline-health` — eight states kept apart |
| `60071e6b` | `canonical-writer.ts` duplicate-write guard + connector classification |

All six verified present on `origin/main` after pushing, by re-reading the files
from the remote rather than trusting the push output — this repo has a history of
edits vanishing under other sessions' whole-tree commits.

## 2. Tests

**163 passing across 10 suites**, run together:

```
tests/quality-target-transition.test.ts          26
tests/quality-simulation-worker-parity.test.ts    7
tests/canonical-writer.test.ts                    6
tests/coaching-trigger.test.ts
tests/coaching-writer.test.ts
tests/weekly-coaching.test.ts
tests/quality-aggregation.test.ts
tests/quality-queries.test.ts
tests/process-metric-definition.write.test.ts
src/db/__tests__/migration-manifest-guard.test.ts 9
                                            ---
 Test Files  10 passed (10)
      Tests  163 passed (163)
```

Scoped `tsc` exit 0. Frontend `vite build` succeeds; both new pages emit chunks
(`NativeQualityTargetConfig` 17.8 kB, `NativeQualityPipelineHealth` 9.3 kB).

### Two regressions proven, not assumed

A test that has never failed is a test nobody has checked.

- **Manifest guard**: removing `543_…sql` fails exactly 2 of the 9 guard tests
  ("manifest entry has a file", "released file not renamed or deleted"). Before
  `knownDangling` was cleared it failed **none** — the exemption was masking it.
- **Parity**: restoring the hardcoded `MATERIAL_SHORTFALL = 0.9` fails exactly
  one test, "honours NON-default thresholds", and nothing else.

## 3. Migration 543 — recovered, not reconstructed

`schema_migrations.checksum_sha256` is written by the runner from real file
bytes, which makes it an exact oracle. Validated against 542 first: its committed
file reproduces its stored hash `de978532…`.

The recovered file hashes to
`f59257d2a2d7538d07359309bee5de46a619eb813a7a52ad5f3efee44e25bc87` — identical to
what production recorded on 2026-07-27. Because it matches, production's row
stays valid and `MIGRATION_STRICT_MODE=true` now passes rather than trading a
missing-file abort for a checksum-mismatch one.

Correction to the original framing: a missing manifest file does **not** block
later migrations. `runPendingMigrations.ts:915` logs `skipping missing file` and
continues; it is fatal only under `MIGRATION_STRICT_MODE=true`. The real exposure
was a fresh install missing both objects at runtime, since
`cosec-sync.service.ts:733` reads the table unconditionally.

## 4. Role access — checked against production, not assumed

| Page code | Roles granted (`role_page_access`, active) |
|---|---|
| `QA_EVALUATION` | admin, qa, super_admin, tq_head |
| `QUALITY_DASHBOARD` | branch_head, branch_qa, ceo, coo, qa, quality_analyst, super_admin, tq_head |

`/quality/targets` is gated on `QA_EVALUATION` — exactly the four roles in the
backend's `TARGET_ADMIN`. `/quality/pipeline-health` is gated on
`QUALITY_DASHBOARD`, matching `HEALTH_VIEWERS`.

Both have nav entries, so `app-shell-routing.contract` sees them. That test has
one remaining failure, `/settings/signing-certificate` — pre-existing, another
session's page, and untouched here because choosing roles for certificate
management would be guessing at access control.

## 5. API surface

Mounted at `/api/quality-governance`, one endpoint per transition rather than a
generic status setter — each step has different authorisation and different
preconditions, and a status setter would make "who may move this, and from
where" a runtime argument instead of a route.

| Method | Path | Role |
|---|---|---|
| GET | `/targets?processId=` | TARGET_ADMIN |
| GET | `/targets/missing` | HEALTH_VIEWERS |
| POST | `/targets` | TARGET_ADMIN |
| PATCH | `/targets/:id` | TARGET_ADMIN |
| POST | `/targets/:id/simulate-review` | TARGET_ADMIN |
| POST | `/targets/:id/submit` | TARGET_ADMIN |
| POST | `/targets/:id/approve` | TARGET_APPROVER |
| POST | `/targets/:id/reject` | TARGET_APPROVER |
| POST | `/targets/:id/activate` | TARGET_APPROVER |
| POST | `/targets/:id/deactivate` | TARGET_APPROVER |
| GET | `/targets/:processId/history` | TARGET_ADMIN |
| GET | `/health` | HEALTH_VIEWERS |

The actor is always taken from the session, never the request body.

## 6. Production state after all of this

Read-only checks, 2026-08-02:

| Check | Value |
|---|---|
| Targets configured | **0** |
| Targets active | **0** |
| Target audit rows | **0** |
| Coaching sessions | **0** |
| Schedules enabled | **2** (`dialer_1`, `lms_sync`) |
| Schedules disabled | **6** |
| Migration 1058 applied | **no** |
| Migration 543 recorded | yes (2026-07-27, historical) |

So, explicitly:

- **No coaching can be raised**, because no approved target exists and the
  evaluator declines without one rather than inventing a bar.
- **All six connector schedules remain disabled.** None deleted, no `DEPRECATED`
  flag written.
- **No target was created, approved or activated** by this work. The audit table
  is empty because nothing has happened yet, not because auditing is missing —
  every transition writes a row with actor, timestamp, before/after and reason.

## 7. What could NOT be verified, and why

Stated plainly so nobody reads this report as more complete than it is.

- **Fresh-database migration run — NOT DONE.** There is no MySQL server available
  to this environment (no local instance; `127.0.0.1:3306` refused). Executing
  the manifest end-to-end needs either a local server or an approved scratch
  schema on a real host, and creating one is a production write outside the
  charter. What *was* verified: the manifest has zero dangling entries and zero
  unapproved removals, and 1058 is registered in both the manifest and the lock.
  Its DDL has not been executed anywhere.
- **Screenshots (desktop and mobile) — NOT PRODUCED.** This environment has no
  browser or renderer. The pages build and their chunks emit; their layout uses
  responsive grids (`sm:`/`md:`/`lg:` breakpoints) and horizontally scrollable
  tables, but *that is a code claim, not a visual verification*. They need a
  human to open them.
- **Live API request/response samples — NOT CAPTURED.** Calling the endpoints
  requires an authenticated session against production, which would also mean
  writing target rows there. The routes are exercised by unit tests instead.
- **1058 against real data — NOT RUN.** Both tables are empty, so the enum
  widening and generated columns rewrite nothing, but that is reasoning from row
  counts rather than an executed migration.

## 8. Known limitations in what was built

- The **stale-simulation rule is enforced in the service, not by a CHECK
  constraint.** MySQL's documented CHECK restrictions do not clearly cover
  references to generated columns, and with no database available to prove it,
  shipping a migration that might fail on a fresh install is the exact defect
  this work spent its time repairing. `config_fingerprint` being STORED GENERATED
  is what makes the service-side comparison trustworthy: the service can refuse a
  mismatch but cannot manufacture a match.
- **Full range-overlap exclusion is service-side.** The unique key catches the
  dangerous case (two open-ended actives). Overlapping *closed* windows are
  rejected in the transaction, under a row lock taken before the incumbent is
  read.
- **`consecutiveShortfalls` reads `kpi_employee_resolved`**, not the approved
  target, for its historical weeks. It now takes the configured warning band, but
  the target value in past weeks is still the resolved one. Correcting that means
  dating the target per week, which is a larger change than this.
- **The connector classification is documented, not enforced.** Only the
  duplicate-write guard is live, because it is the only item that fails
  dangerously and silently if someone acts before the rest is decided.
