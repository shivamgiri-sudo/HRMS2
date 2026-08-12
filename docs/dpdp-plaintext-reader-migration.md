# DPDP plaintext reader migration — measured scope

Measured against `backend/src` and production on 2026-08-12. This exists because the encryption
work is only half done: `employees.aadhaar_number`, `employees.pan_number` and
`employees.bank_account_number` are at 100% ciphertext coverage, but plaintext is still what the
application reads. Until the readers move, nothing is actually protected — which is the audit's
own criterion: *"Encryption mirrors alone do not satisfy DPDP if applications continue to read
raw columns."*

## What is already done

| Column | Ciphertext coverage | Plaintext |
|---|---|---|
| `employees.aadhaar_number` | 30,108 / 30,108 | still the read path |
| `employees.pan_number` | 23,341 / 23,341 | still the read path |
| `employees.bank_account_number` | no encrypted sibling exists | — |
| `ats_candidate.{aadhar,pan,bank_account_no}` | 28,764 / 24,929 / 31,142 | still present |
| `employee_bank_detail.account_number` | 12,768 / 12,768 | still present |
| `legacy_payslip_snapshot.account_number` | 115,698 | **retired** ✅ |

`legacy_payslip_snapshot` is the one column that completed the full cycle — encrypt, migrate
readers, retire plaintext — and is the template for the rest.

## Reference classification

237 references to the three plaintext columns across `backend/src` (excluding `__tests__`):

| Kind | Count | Meaning |
|---|---|---|
| read | **75** | the actual migration surface |
| other | 101 | mostly SQL column lists and identifiers the classifier could not attribute |
| comment | 36 | prose, no behaviour |
| write | 18 | INSERT/UPDATE paths |
| type | 7 | interface fields |

## The 75 reads are concentrated

27 files, but the top six hold 35 of them — 47%:

| Refs | File |
|---|---|
| 8 | `modules/employees/employee.routes.ts` |
| 6 | `modules/employees/employee-creation-orchestrator.service.ts` |
| 6 | `modules/payroll/payroll.routes.ts` |
| 6 | `modules/reporting/report-suite.routes.ts` |
| 5 | `workers/domains/employee-sync-handler.ts` |
| 4 | `modules/dashboards/dashboard-metric.service.ts` |

So this is a focused effort, not an open-ended sweep. Migrating the top six files covers nearly
half the surface.

## Reads that need no work

Some of the 75 are already safe and should not be counted as debt:

- `modules/reporting/executors/payroll.executor.ts` (4) and `identity.executor.ts` (3) already
  gate on `canViewSensitiveFields` and emit `'***MASKED***'` otherwise.
- `modules/reporting/bpo-master-verified-workforce-adapters.ts` (2) emits raw SQL, but
  `bpo-master-report.routes.ts` masks every column flagged `sensitive` for non-exporters, and
  all five identifier columns carry that flag.
- `shared/employeeIdentifierRedaction.ts` (3) and `shared/portalMask.ts` (2) are the masking
  helpers themselves.

## One file appears dead

`modules/employees/employee.profile.service.ts` has 2 plaintext reads and **no importer** — the
only references anywhere are two paths inside a contract test that reads it as a file. Worth
confirming and deleting rather than migrating, on the same reasoning that removed the six
unrouted `/analytics/*` endpoints: unreachable code that looks maintained is worse than none.

## CORRECTION 2026-08-12 — the "75 reads" figure is inflated, and re-measuring changed the plan

The 75 was produced by a reference classifier, and it over-counts badly. A second measurement
excluding masked expressions, null/empty completeness predicates, comments, and the masking
helpers themselves returns **126 raw references across 28 files** — but almost none are
disclosure. Spot-checking the six files the table above called the priority surface:

| File | Classifier said | What is actually there |
|---|---|---|
| `employee.routes.ts` | 8 reads | **Done.** The one disclosing path already calls `resolvePii` (L169/176); the remaining hits are the fallback `SELECT` that feeds it, plus write paths |
| `dashboard-metric.service.ts` | 4 reads | `IS NULL` / `!= ''` **completeness counts**. No identifier is ever selected |
| `payroll.routes.ts` | 6 reads | `bank_account_number` is already masked inline to `XXXX`+last4; `pan_number` is on a **payslip**, behind `hasScopedAccess`, where PAN is statutorily expected |
| `employee-creation-orchestrator.service.ts` | 6 reads | Copies candidate PAN **into** the employee record — a write path — plus a duplicate-check lookup |
| `employee-sync-handler.ts` | 5 reads | `VALUES(pan_number)` upserts in the **dead** legacy-sync subsystem, and it already calls `encryptPanForSync` |

So the reader migration is far smaller than this document claimed. **Do not plan against the 75.**
Re-derive the surface as "reads that place a raw identifier into a response for an actor not
entitled to it", which is a different and much shorter list than "references the column".

This is the same measurement error as the ESIC finding closed the same day: a predicate that
selects the wrong population and yields a confident wrong count. See
[[hrms2-esic-zero-lines-are-correct]].

### Two dead modules found while measuring

- **`modules/privacy-engine/privacyFieldProjection.service.ts` has no importer.** It is a
  per-role masking policy table (`pan_number: "mask"`, `"allow"` for payroll) that **nothing
  consults**. The only reference anywhere is a comment in `shared/employeeIdentifierRedaction.ts`
  explaining why it is deliberately not used. A privacy policy that is never enforced is worse
  than none, because an audit reads it as a control.
- **`modules/employees/employee.profile.service.ts` has no importer** — only two contract-test
  paths that read it as a file. Previously suspected; now confirmed.

Neither was deleted: removing them changes what those contract tests assert, which needs its own
commit and its own proof.

## Sequencing

The `record_type` change is the model, and its ordering mattered:

1. **Migrate readers** to a resolver that prefers ciphertext and falls back to plaintext. No
   behaviour change while both exist — this is the safe, reversible majority of the work.
2. **Prove equivalence per call site** against production, the way the exclusion switch was:
   equal counts are not enough, the row-by-row disagreement count must be zero.
3. **Retire plaintext** only once nothing reads it. This is a destructive schema change and
   needs explicit approval; it is also the only step that actually satisfies DPDP.

Doing 3 before 2 is the failure mode to avoid — it is the same shape as repointing
`excludeEmployeeShapedCandidatesSql` before its backfill had run, which would have silently
marked every legacy row as genuine.

## Note on the write paths

The 18 writes matter for a different reason: `shared/syncPiiEncryption.ts` exists because
`employees.pan_number_encrypted` was backfilled for all 23,341 rows while some write paths did
not maintain it. Any reader migration is undone by a write path that populates plaintext and
leaves ciphertext stale, so the writes need auditing alongside — not after.
