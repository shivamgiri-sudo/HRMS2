# Design Document

## Overview

Four workstreams, one shared spine. The completion machinery already exists and is correct; what is missing is a flag on the right process, four observability gaps inside the worker, a verification write at the point of completion, a one-off runner for the 26 kits already stranded, and a single shared eSign-state classifier that the SQL, the row badge and the summary tiles all read instead of each keeping their own list.

The design deliberately does not touch the Backoff_Ladder, the completion writers' delegation structure, or the overdue predicate. Where a requirement is satisfied by code that already exists, this document says so and names the file, so the implementation plan does not rewrite working code.

### What changes, and what is merely enabled

| Path | Change |
|---|---|
| deployed `backend/.env` (workers process) | `ESIGN_RECONCILIATION_ENABLED=true` — **configuration only** |
| `backend/src/workers/esign-reconciliation.worker.ts` | poll-counter on the success path, tick log line, per-transaction failure recording, give-up sweep, provider-call counter |
| `backend/src/modules/integrations/luckpay/luckpay-status.service.ts` | **no change** — the `scope='kit'` branch at 441-455 is already correct |
| `backend/src/modules/employees/joiningKitDispatch.service.ts` | `finalizeKitEsign` gains the verification write, a transaction boundary, an optional provider `completedAt`, and backfill attribution parameters |
| `backend/src/modules/employees/employeeJoiningDocuments.service.ts` | `finalizeChecklistEsign` gains the verification write inside a widened transaction boundary |
| `backend/src/modules/employees/employee.compliance.routes.ts` | webhook rejection classification, audit write, dormancy comment |
| `backend/src/modules/employees/employeeCompliancePrivacy.ts` | new `classifyLuckpayWebhookAuth`; `verifyLuckpayWebhookSecret` kept as a thin wrapper |
| `backend/src/modules/ats/esignState.ts` | **new** — the single classifier |
| `src/lib/esignState.ts` | **new** — frontend mirror, pinned to the backend module by contract test |
| `backend/src/modules/ats/ats.joiningDocumentsTracker.service.ts` | classifier-generated SQL, bucket partition, null-vs-zero, real pagination, bulk-verify predicate |
| `backend/src/modules/ats/ats.joiningDocumentsTracker.routes.ts` | pass `page` / `limit` through |
| `src/pages/JoiningDocumentsTrackerPage.tsx` | bucket tiles, dash rendering, invalidation, refetch interval |
| `src/pages/EmployeeJoiningDocumentsPage.tsx` | `STATUS_COLORS` (lines 71-86) completed from the mirror |
| `backend/scripts/backfill-stranded-joining-kits.ts` | **new** — Backfill_Runner |
| `backend/sql/` | **no new migration** — see Migrations |

### The flag alone is not enough (Requirement 1, criterion 1)

`startEsignReconciliationWorker` is registered in exactly one place: `backend/src/workers/all-workers.ts:281`. It is **not** called from `backend/src/server.ts`. Production runs the two-process topology — `.github/workflows/deploy.yml:328-331` starts `hrms2-backend` with `WORKERS_PROCESS=external ENABLE_SCHEDULERS=false` and `hrms2-workers` with `ENABLE_SCHEDULERS=true` — and `startAllWorkers()` (`all-workers.ts:392-418`) runs every registered worker unconditionally, without consulting `ENABLE_SCHEDULERS` itself.

So the flag must reach the **`hrms2-workers`** process. Setting it on `hrms2-backend` alone changes nothing, because that process never registered the worker. Both processes run with `cwd = $DEPLOY_ROOT/backend` and `env.ts:7-18` loads `backend/.env` with `override: false`, so the single change is a line in the deployed `backend/.env`. No workflow edit, no code change, and it reaches both processes while only the workers process acts on it.

This is the whole of Requirement 1's configuration change. Everything else in Requirement 1 is instrumentation the worker does not currently have.

## Architecture

```
                    ┌───────────────────────────────┐
   dormant  ····▶   │  Webhook_Route                │
   (Luckpay         │  employee.compliance.routes   │──┐
    registers       │  :1238                        │  │
    no callback)    └───────────────────────────────┘  │
                                                       ▼
  hrms2-workers                             ┌────────────────────────┐
  ┌──────────────────────────┐              │ handleJoiningDocument  │
  │ Esign_Worker             │              │ EsignWebhook (:2202)   │
  │ esign-reconciliation     │              └───────────┬────────────┘
  │  claimBatch → per row:   │                          │
  │   syncEsignStatus  ──────┼──────┐                   │
  └──────────────────────────┘      ▼                   │
                        ┌───────────────────────┐       │
   backfill (one-off)   │ Status_Service        │       │
  ┌──────────────────┐  │ syncEsignStatus       │       │
  │ Backfill_Runner  │  │  :441 scope==='kit' ──┼───┐   │
  │ scripts/backfill-│  └───────────────────────┘   │   │
  │ stranded-…       │──────────────────────────────┤   │
  └──────────────────┘                              ▼   ▼
                                        ┌──────────────────────────┐
                                        │ Kit_Finalizer            │
                                        │ finalizeKitEsign (:451)  │
                                        │  ┌─────────────────────┐ │
                                        │  │ TX: members + kit + │ │
                                        │  │ token + verification│ │
                                        │  └─────────────────────┘ │
                                        └──────────┬───────────────┘
                                                   │  (outside TX)
                                        recalculateDocumentProgress
                                        issueAppointmentLetter
                                        Audit_Log
```

Three producers, one completion writer per scope. The Backfill_Runner reaches `finalizeKitEsign` directly rather than through `syncEsignStatus`, because it needs to supply the operator attribution and the provider's `completedAt` that Requirement 12 demands, and because it must bypass `claimBatch`'s `GIVE_UP_AFTER_DAYS` window that already excludes MAS47814.

## Components and Interfaces

One entry per component, with the contract each workstream below elaborates. Nothing here is new relative to the workstreams; this is the index.

### Esign_Worker — `backend/src/workers/esign-reconciliation.worker.ts`

Owns the pull path: one tick sweeps abandonments, claims a batch, and polls each claimed transaction through `syncEsignStatus`.

```ts
export async function runEsignReconciliationOnce(): Promise<{
  examined: number;
  completed: number;
  pending: number;
  errors: number;
  providerCalls: { status: number; download: number };
}>;
```

The return value is what the tests assert on and what the unconditional tick log line carries (gap 2). Three internal helpers change:

| Helper | Contract |
|---|---|
| `sweepAbandoned(): Promise<number>` | **new.** Runs first in each tick, before `claimBatch`. Moves every non-terminal `luckpay` transaction older than `GIVE_UP_AFTER_DAYS` to `status = 'abandoned_unresolved'` with an explanatory `error_message` and `next_poll_at = NULL`, and writes one Audit_Log row per transition. Guarded by `status NOT IN (<TERMINAL>, 'abandoned_unresolved')`, so it is idempotent by construction and a second tick affects zero rows. Returns the number of rows transitioned |
| `recordPollFailure(id, attempts, message): Promise<void>` | **new.** Folds the failure text into the same `UPDATE` that `scheduleNext` already issues — one statement, so a failure cannot be recorded without also being rescheduled. Writes `error_message`, `poll_attempts = attempts`, `last_polled_at = NOW()` and the next ladder step |
| `clearSchedule(id, attempts): Promise<void>` | **amended.** Gains the `attempts` parameter and writes `poll_attempts = ?` alongside the existing `last_polled_at = NOW()` and `next_poll_at = NULL`, so a first-poll completion no longer records `poll_attempts = 0` (gap 1) |

`BACKOFF_MINUTES`, `TICK_MS`, `BATCH_SIZE`, `GIVE_UP_AFTER_DAYS`, `nextDelayMinutes`, `claimBatch` and the `running` overlap guard keep their current signatures and values, pinned by `esignReconciliationBudget.contract.test.ts`.

### Webhook auth classifier — `backend/src/modules/employees/employeeCompliancePrivacy.ts`

Leaf module, imports nothing. Replaces a boolean at the call site with a total, disjoint classification of why a delivery was rejected.

```ts
export type WebhookAuthOutcome =
  | { ok: true;  reason: "accepted" }
  | { ok: false; reason: "secret_not_configured" }   // R2.2 — configuration fault
  | { ok: false; reason: "header_absent" }           // R2.4 — unauthenticated probe
  | { ok: false; reason: "header_mismatch" };        // R2.3 — wrong credential

export function classifyLuckpayWebhookAuth(
  providedSecret: string | null | undefined,
  configuredSecret: string | null | undefined,
): WebhookAuthOutcome;
```

Decision order is part of the contract: `secret_not_configured` first (an environment with no secret reports its own fault rather than blaming the caller), then `header_absent`, then `header_mismatch`, then `accepted`. `verifyLuckpayWebhookSecret(provided, configured): boolean` survives unchanged in signature, reimplemented as `classifyLuckpayWebhookAuth(...).ok`, so its existing tests and the two route tests keep passing.

`employee.compliance.routes.ts` consumes the outcome at both call sites (:1238-1244 public, :475-479 authenticated) to pick log level and audit `action_type`. The HTTP status and body stay 401 and unchanged for all three rejections.

### Checklist_Finalizer — `finalizeChecklistEsign` in `backend/src/modules/employees/employeeJoiningDocuments.service.ts`

The single completion writer for `scope = 'document'`. Gains:

- a transaction boundary (`db.getConnection()` + `beginTransaction` / `commit` / `rollback` / `release`) around exactly three writes — the checklist `UPDATE`, the transaction-table `UPDATE` and the public-token `UPDATE`. Audit, the payroll-HR inbox notification and `recalculateDocumentProgress` stay outside;
- the verification write as additional `SET` clauses on the checklist `UPDATE` already there, gated on `signature_mode = 'aadhaar_esign_verified'`;
- an optional `completedAt?: Date | null`, which the `completed_at = COALESCE(?, NOW())` clause consumes. Absent, behaviour is exactly today's `NOW()`.

### Kit_Finalizer — `finalizeKitEsign` in `backend/src/modules/employees/joiningKitDispatch.service.ts`

The single completion writer for `scope = 'kit'`. Reached by `syncEsignStatus` (:441-455, unchanged), by the dormant webhook handler, and directly by the Backfill_Runner. Gains the same boundary — now covering the file-row inserts, the per-member checklist `UPDATE`s with their `.catch(() => undefined)` removed, and the kit, token and transaction updates — plus:

```ts
completedAt?: Date | null;                 // provider's time; COALESCE(?, NOW())
backfill?: { actorUserId: string; providerReferenceId: string };
client?: Pick<typeof luckpayClient, "downloadESignDocument">;   // defaults to the real client
```

`backfill` present switches the audit `action_type` from `ESIGN_VERIFICATION_AUTO` to `ESIGN_VERIFICATION_BACKFILL` and carries the operator and the provider reference the decision was based on. `client` exists so the Backfill_Runner's counting fake covers the single internal download (:462-478) as well as the status call. `assertSignatureInsideReservedArea`, `recalculateDocumentProgress`, `audit(...)` and the fire-and-forget `issueAppointmentLetter` all stay outside the boundary, the last one byte-unchanged.

### eSign state classifier — `backend/src/modules/ats/esignState.ts` (new)

Leaf module, imports nothing, the single authority for status→bucket.

```ts
export type EsignBucket = "completed" | "in_progress" | "not_started";
export const ESIGN_STATE_BUCKET: Readonly<Record<string, EsignBucket>>;
export function classifyEsignState(status: string | null | undefined): EsignBucket;
export function esignBucketCaseSql(column: string): string;
```

`classifyEsignState` is total: an unrecognised value returns `"not_started"` and is logged once per distinct value per process via a module-level `Set`. `esignBucketCaseSql` generates the SQL `CASE` expression from `ESIGN_STATE_BUCKET`, so the query and the function cannot disagree — they are the same table.

### Frontend mirror — `src/lib/esignState.ts` (new)

Presentation only. Re-declares `EsignBucket` and exports a bucket→colour map that `EmployeeJoiningDocumentsPage.tsx`'s `STATUS_COLORS` (lines 71-86) is completed from. No status knowledge: the API sends the bucket. Pinned to the backend module by `esignStateMirror.contract.test.ts`, because `@` aliases to `./src` only and no shared import is possible.

### Summary classifier — `backend/src/modules/ats/ats.joiningDocumentsTracker.service.ts`

```ts
export type SummaryBucket = "completed" | "in_progress" | "pending";
export function classifyEmployeeBucket(pct: number): SummaryBucket;
export function calculateTrackerSummary(employees: EmployeeDocumentRow[]): TrackerSummary;
```

`calculateTrackerSummary` keeps its signature and stays the exported pure function the unit tests target; its loop calls `classifyEmployeeBucket` instead of inlining thresholds, so the three counts partition the input by construction. `pending_verification` leaves `TrackerSummary`; `pending_count` is surfaced to the tiles. `overdue_count` and `needs_correction` are cross-cutting and stay as they are.

### Tracker_Service query surface

`getJoiningDocumentsTracker(actorUserId, filters)` keeps its signature; `TrackerQueryParams` gains `page` and `limit` and `TrackerResponse` gains the page echo and the navigation flags. Four SQL surfaces, one shared text:

| Surface | Contract |
|---|---|
| `const` holding `FROM … WHERE ${whereSQL} GROUP BY e.id ${havingClause}` | Built once per call and interpolated into the row query, the summary query and the fallback count, so the three cannot drift. A contract test asserts all three reference it |
| Row query | The shared text plus the bucket counters from `esignBucketCaseSql('c.status')`, `COUNT(*) OVER () AS total_matching`, `ORDER BY e.date_of_joining DESC, e.employee_code ASC, e.id ASC`, `LIMIT ? OFFSET ?` |
| Summary aggregate query | The same shared text, returning the four summary figures (`total_employees` plus the three partition members) and the two cross-cutting counts directly, so the tiles describe the whole filtered set rather than the visible page |
| Wrapped-count fallback | `SELECT COUNT(*) FROM ( <shared text, selecting e.id and overdue_count> ) t`, issued **only** when `rows.length === 0 && page > 1`, because `COUNT(*) OVER ()` returns no rows past the end of the set. On page 1 an empty result genuinely means `total = 0` and no second query fires |

`bulkVerifyDocuments` keeps its signature and its per-employee transaction; inside, one `UPDATE` becomes two so the uploaded and eSigned provenances get different end states and different audit rows.

### Backfill_Runner — `backend/scripts/backfill-stranded-joining-kits.ts` (new)

Dependencies injected rather than imported at module scope, which is what makes Properties 17-21 testable without billing:

```ts
export async function runBackfill(deps: {
  client: Pick<typeof luckpayClient, "checkESignStatus" | "downloadESignDocument">;
  db: Pool;
  actorUserId: string;
  confirm: boolean;
}): Promise<BackfillReport>;
```

`main()` supplies the real client; tests supply a counting fake returning scripted verdicts. CLI:

```
npx tsx scripts/backfill-stranded-joining-kits.ts --actor-user-id <ID> \
    [--kit-id <ID>...] [--report ./backfill-report.csv] [--confirm]
```

Dry-run by default; refuses to start without `--actor-user-id`. Registered as `"backfill:stranded-kits"` in `backend/package.json` alongside the other `tsx` scripts.

### Tracker_Page — `src/pages/JoiningDocumentsTrackerPage.tsx`

```ts
queryKey: ["joining-documents-tracker", { search, statusFilter, overdueOnly, page, limit }]
refetchInterval: 60_000,
refetchIntervalInBackground: false,
placeholderData: keepPreviousData,
```

Every bulk mutation's `onSuccess` calls `queryClient.invalidateQueries({ queryKey: ["joining-documents-tracker"] })` — prefix invalidation, so every cached page refreshes, not only the visible one — replacing the five local `refetch()` calls. `StatusBadge` keeps its three variants and its markup; only what it reads changes, from `row.joining_document_status` to `classifyEmployeeBucket(row.joining_document_completion_pct)`. The unused `rowIds` memo (:117) is removed. The tile row goes from four to five and `grid-cols-4` becomes `grid-cols-5` at `lg`.

## Data Models

**No migration is required.** Every column this design writes already exists, and the one new *value* — `abandoned_unresolved` — lands in a `VARCHAR` status column with no enum constraint, so it needs no DDL. See Migrations for the file-by-file evidence. What follows is the shape of what is read and written, not a change list.

### `employee_joining_document_checklist`

The verification write touches these columns and no others. `status VARCHAR(80)` and `verification_status VARCHAR(80)` are both unconstrained, so `'esign_completed'` and `'verified'` need no widening.

| Column | Written by this design | Note |
|---|---|---|
| `status` | `'esign_completed'` on completion; `'verified'` for uploaded rows in bulk-verify | eSigned rows keep `esign_completed` — it is the accurate description of how the document arrived, and `recalculateDocumentProgress` already counts it as complete |
| `fill_status`, `signature_mode` | as today | `signature_mode = 'aadhaar_esign_verified'` is the gate for the verification write; `'aadhaar_esign_pending_artefact'` (provider signed, download failed) deliberately does **not** qualify |
| `verification_status` | `'verified'` | `IS NULL`-guarded in bulk-verify, which makes a re-run a zero-row `UPDATE` |
| `verified_at` | `NOW()` | |
| `verified_by` | **left NULL** | `CHAR(36)`, no foreign key. Every other writer puts a real user id here; there is no human verifier on an eSign completion, and a sentinel would make the column untrustworthy everywhere else. Provenance lives in `verification_remarks` and, structurally, in Audit_Log. Set only for uploaded rows in bulk-verify, where a human did click |
| `verification_remarks` | `'Verified by Aadhaar eSign (Luckpay)'` | |
| `due_at` | `NULL` | Safe per the dependency audit; the overdue predicate `due_at < NOW() AND verification_status IS NULL` is untouched |
| `completed_at` | `COALESCE(?, NOW())` | The parameter is the provider's time when one was reported |
| `final_file_locked_at` | `NOW()` when `status = 'esign_completed'` | Unchanged from today |

### `employee_document_esign_transaction`

| Column | Role |
|---|---|
| `status` | `VARCHAR`, not an `ENUM` — which is why `abandoned_unresolved` needs no DDL. Added to `TERMINAL`, making the abandonment a one-way door |
| `scope` | `'document'` \| `'kit'` — selects which finalizer `syncEsignStatus` delegates to |
| `kit_id` | Nullable; set for kit-scope rows, joined on by the backfill selection |
| `client_transaction_id` | The handle a rejected webhook delivery is resolved by, when it can be resolved at all |
| `provider_reference_id` | Must match `^APIB` to be pollable; NULL or non-matching yields `unresolvable_no_provider_reference` with no provider call |
| `signed_file_id` | Non-NULL is `syncEsignStatus`' short-circuit condition (`luckpay-status.service.ts:425`), which is what lets a `pending_artefact` row heal on a later pass |
| `completed_at` | `COALESCE(?, NOW())` |
| `error_message` | Written by `recordPollFailure` and by the abandonment sweep |
| `next_poll_at`, `poll_attempts`, `last_polled_at` | Poll state from migration `1042_esign_transaction_poll_state.sql`, already applied, with `idx_edet_next_poll`. `SUM(poll_attempts)` is the durable status-call count once gap 1 is fixed |

### `employee_joining_esign_kit` and `employee_joining_esign_kit_item`

Kit closure writes `status`, `signed_file_id`, `completed_at` and clears `open_marker`; the backfill selection reads `id`, `employee_id`, `status`, `sent_at`, `signed_file_id` and joins `employees` for `employee_code`. `open_marker` is the `CHAR(1)` NULL-distinct column behind `uq_ejek_employee_open`, so clearing it on closure is what permits a later kit for the same employee.

`employee_joining_esign_kit_item` is read, never written by this design: the `kit_id` → `checklist_id` rows (`joiningKitDispatch.service.ts:465`) are the fan-out the per-member verification `UPDATE`s iterate, and `document_count` on the kit row is the expected member count. Both tables' columns are as declared in `backend/sql/1049_joining_document_esign_kit.sql`.

### `employee_joining_document_public_token`

`token_status` and `consumed_at`. Consumption is `WHERE … token_status = 'active'`, so it already no-ops on a consumed token — idempotence layer 3.

### `employee_joining_document_audit_log`

`employee_id` is `NOT NULL` (`sql/346_…:36`). That constraint is what forces the webhook-rejection behaviour: a rejected delivery has no employee, so it is recorded against the transaction its payload names when `client_transaction_id` resolves one, and otherwise the audit write is **skipped** with a `console.error` rather than attempted and swallowed — a swallowed insert is how the kit audit log silently lost every row before `joiningKitDispatch.service.ts:57-78` was fixed.

`action_type` values this design writes: `ESIGN_VERIFICATION_AUTO`, `ESIGN_VERIFICATION_BACKFILL`, `ESIGN_BACKFILL_EXAMINED_UNSIGNED`, `BULK_VERIFY_ESIGNED` (`BULK_VERIFY` unchanged for uploaded rows), and the three webhook rejections `LUCKPAY_WEBHOOK_REJECTED_UNCONFIGURED` / `_MISMATCH` / `_NO_HEADER`. See the vocabulary table in Workstream 3 for who writes each. `new_value` carries `{ verificationSource, signatureMode, providerReferenceId }`; `old_value` carries `{ status, verification_status, due_at }` as they were before the write, which is also the only surviving record of a cleared deadline.

### TypeScript shapes

```ts
// ats.joiningDocumentsTracker.service.ts — pending_verification removed, pending_count surfaced
export interface TrackerSummary {
  total_employees: number;
  completed_count: number;      // classifyEmployeeBucket === "completed"
  in_progress_count: number;    // "in_progress" — absorbs the former 75-99 band
  pending_count: number;        // "pending" — 0%
  overdue_count: number;        // cross-cutting, outside the partition
  needs_correction: number;     // cross-cutting, outside the partition
}
```

`completed_count + in_progress_count + pending_count === total_employees` for any input, by construction rather than by assertion.

```ts
// nullability pinned between the two declarations by trackerTypeParity.contract.test.ts
// EmployeeDocumentRow (service) and EmployeeRow (JoiningDocumentsTrackerPage.tsx:37-38)
esign_completed_count: number | null;   // null iff the employee has no checklist rows
esign_pending_count:   number | null;
```

Produced null in exactly one place — the SQL `CASE WHEN COUNT(c.id) = 0 THEN NULL` — and never coerced afterwards; the mapper drops `Number(row.x ?? 0)` for `row.x === null ? null : Number(row.x)`. Every other count field on the row keeps its current non-null type.

```ts
// Backfill_Runner
export type KitClassification =
  | "closed"                              // R3.3, R3.4 — finalizeKitEsign ran
  | "left_untouched"                       // R3.5 — provider reports unsigned, zero writes
  | "already_closed"                       // R3.8 — no provider call
  | "unresolvable_no_provider_reference"   // R3.7 — no provider call, not an error
  | "error";                               // per-kit throw, message reported, run continues

export interface BackfillReportEntry {
  employee_code: string;
  dispatch_date: string;
  provider_reference: string | null;
  provider_status: string | null;          // null where no call was made
  classification: KitClassification;
  documents_closed: number;
  note: string;                            // carries completedAtSource, or the error message
}

export interface BackfillReport {
  entries: BackfillReportEntry[];          // exactly one per selected kit — Property 19
  totals: Record<KitClassification, number>;
  providerCalls: { status: number; download: number };
}
```

Remaining shapes are declared where they are used and repeated here only for the index: `WebhookAuthOutcome` (four-arm discriminated union, `employeeCompliancePrivacy.ts`), `EsignBucket` (`"completed" | "in_progress" | "not_started"`, declared in `backend/src/modules/ats/esignState.ts` and mirrored in `src/lib/esignState.ts`), `SummaryBucket` (`"completed" | "in_progress" | "pending"`, tracker service). `TrackerQueryParams` gains `page?: number` and `limit?: number`; `TrackerResponse` keeps `rows`, `total` and `summary` and gains the page echo and navigation flags the page needs.

## Workstream 1 — the pull path

### Four gaps between what the worker does and what Requirement 1 asks for

Read against the current file, these are the only deltas. Each is small and independently regressible.

**1. `poll_attempts` is not incremented on the success path.** `scheduleNext` (lines 60-70) writes `poll_attempts = ?`; `clearSchedule` (lines 72-79) writes `last_polled_at = NOW()` and `next_poll_at = NULL` but leaves the counter alone. A transaction that completes on its first poll therefore records `poll_attempts = 0` — which is indistinguishable from never having been polled, the exact signal Requirement 1 criterion 4 exists to create. Fix: `clearSchedule(id, attempts)` sets `poll_attempts = ?` alongside the existing columns. This also makes `SUM(poll_attempts)` an honest billing figure, which Requirement 11 criterion 6 relies on.

**2. The tick log line is conditional and does not state the enabled state.** Lines 116-120 emit only `if (rows.length)`. A running worker that finds nothing prints nothing, so "enabled and idle" looks identical to "never started" — the state production is in today. Fix: emit unconditionally, naming the enabled state and the selected count:

```ts
console.log(
  `[esign-reconciliation] enabled=true selected=${rows.length} ` +
  `completed=${completed} pending=${stillPending} errors=${errors} providerCalls=${providerCalls}`,
);
```

**3. A provider failure is not recorded against the transaction.** The catch block (lines 104-114) increments a local counter, calls `scheduleNext`, and `console.warn`s. Nothing lands in `employee_document_esign_transaction.error_message`, so a transaction that has failed six times looks the same in the database as one that has succeeded six times. Fix: a `recordPollFailure(id, attempts, message)` that folds the failure text into the same `UPDATE` that `scheduleNext` already issues — one statement, not two, so a failure cannot be recorded without also being rescheduled.

**4. The give-up window is silent.** `claimBatch` (lines 44-58) excludes old transactions with `initiated_at > (NOW() - INTERVAL ? DAY)`. A transaction simply stops appearing; nothing says it was abandoned. Requirement 1 criterion 7 asks for a record. Fix: a `sweepAbandoned()` run at the top of each tick, before `claimBatch`:

```sql
UPDATE employee_document_esign_transaction
   SET status = 'abandoned_unresolved',
       error_message = CONCAT('Abandoned after ', ?, ' days without provider completion'),
       next_poll_at = NULL,
       updated_at = NOW()
 WHERE provider = 'luckpay'
   AND status NOT IN (<TERMINAL>, 'abandoned_unresolved')
   AND initiated_at <= (NOW() - INTERVAL ? DAY)
```

`abandoned_unresolved` is added to `TERMINAL`, so the transition is a one-way door and the sweep is idempotent by construction — the `status NOT IN` clause is the marker, and no extra column is needed. `status` is `VARCHAR`, not an enum (`backend/sql/346_employee_joining_document_pack.sql` for the checklist; the transaction table follows the same convention), so no DDL is required. Each transition also writes one Audit_Log row via the existing `auditDocumentAction` path, and because the `UPDATE` is guarded by `status NOT IN`, a second tick affects zero rows and writes zero rows.

### Provider-call counter (Requirement 11, criterion 6)

Two surfaces, because one is comparable and the other is immediate:

- **Durable and comparable against the invoice.** `SUM(poll_attempts)` over `employee_document_esign_transaction` is the count of `checkESignStatus` calls, once gap 1 is fixed. Downloads are counted by rows in `employee_joining_document_file` with `file_role IN ('signed','kit_signed')` and `uploaded_by_type = 'system'`. Both survive restarts, which an in-memory counter does not.
- **Immediate.** `runEsignReconciliationOnce()` returns `providerCalls: { status: number; download: number }` and the tick log line carries it. The return value is what the tests assert on.

Deliberately **not** `candidate_bgv_api_request_log`: `writeBgvApiLog` requires a `candidateId` (`backend/src/modules/ats/bgv-api-log.service.ts:29`), and a joining-kit transaction may carry a NULL `candidate_id`. Forcing kit polls through that table would either drop rows or fabricate a candidate.

### What is not changing

`BACKOFF_MINUTES`, `TICK_MS`, `BATCH_SIZE`, `GIVE_UP_AFTER_DAYS`, `nextDelayMinutes`, the `running` overlap guard, `claimBatch`'s `next_poll_at IS NULL` tolerance and its `ORDER BY next_poll_at IS NOT NULL, next_poll_at` — all correct and all pinned by contract test so a later refactor cannot quietly widen the polling budget.

## Workstream 1b — the dormant webhook route

The route is not broken; it is unused. The change is to make a genuinely misconfigured environment say so.

### A rejection classifier, not three log lines

`verifyLuckpayWebhookSecret` (`employeeCompliancePrivacy.ts:108-112`) returns a single boolean and therefore cannot distinguish "no secret configured" from "no header sent" from "wrong header sent". Requirement 2 needs all three separated. Replace the boolean at the call site with a total classifier in the same leaf module:

```ts
export type WebhookAuthOutcome =
  | { ok: true;  reason: "accepted" }
  | { ok: false; reason: "secret_not_configured" }   // R2.2 — configuration fault
  | { ok: false; reason: "header_absent" }           // R2.4 — unauthenticated probe
  | { ok: false; reason: "header_mismatch" };        // R2.3 — wrong credential

export function classifyLuckpayWebhookAuth(
  providedSecret: string | null | undefined,
  configuredSecret: string | null | undefined,
): WebhookAuthOutcome;
```

Order matters and is part of the contract: `secret_not_configured` is decided **first**, because an environment with no secret must report its own fault rather than blame the caller for not sending a header. `verifyLuckpayWebhookSecret` stays, reimplemented as `classifyLuckpayWebhookAuth(...).ok`, so `backend/tests/employeeCompliancePrivacy.test.ts:45-51` and the two existing route tests keep passing unchanged.

At the route (`employee.compliance.routes.ts:1238-1244`, and the mirrored authenticated variant at :475-479):

| reason | log level | Audit_Log | response |
|---|---|---|---|
| `secret_not_configured` | `console.error` naming `LUCKPAY_WEBHOOK_SECRET` | yes — `LUCKPAY_WEBHOOK_REJECTED_UNCONFIGURED` | 401 (unchanged) |
| `header_mismatch` | `console.warn` | yes — `LUCKPAY_WEBHOOK_REJECTED_MISMATCH` | 401 (unchanged) |
| `header_absent` | `console.info` | yes — `LUCKPAY_WEBHOOK_REJECTED_NO_HEADER` | 401 (unchanged) |

The response body and status are untouched: a probe must not be able to read the environment's configuration state off the response. Diagnosability is in the logs and the audit trail, which is where Requirement 2 puts it.

The Audit_Log write needs an `employee_id`, which a rejected delivery does not have — `employee_joining_document_audit_log.employee_id` is `NOT NULL` (`sql/346_...:36`, and the `joiningKitDispatch.service.ts:57-78` header records the silent-rejection bug caused by passing NULL there). A rejected delivery is therefore recorded against the transaction the payload names, when one can be resolved by `client_transaction_id`, and otherwise as a `console.error` only, with the audit write skipped rather than attempted-and-swallowed. `header_absent` from an unauthenticated probe carries no payload at all and will normally take that path; that is correct — an unattributable probe is a log event, not an employee audit event.

### The comment (Requirement 2, criterion 6)

Placed immediately above `publicEmployeeDocumentRouter.post("/esign/webhook/luckpay", ...)`, stating that the route is dormant because the Luckpay client registers no callback URL (`luckpay.client.ts` only ever *reads* `redirect_url` / `sign_url` / `verificationUrl` out of responses), that the pull path in `esign-reconciliation.worker.ts` is the source of truth, and recording the absolute URL Luckpay would need:

```
https://mcnhrms.teammas.in/api/public/employee-documents/esign/webhook/luckpay
```

Host taken from `frontendBaseUrl()`'s production default (`joiningKitDispatch.service.ts:26-28`). Pinned by contract test, so the comment cannot rot into a wrong URL.

### The one thing here that no test can reach (Requirement 2, criterion 7)

Everything above is repository-verifiable and pinned by contract test. Criterion 7 is not: `LUCKPAY_WEBHOOK_SECRET`'s production value is absent from the repository and from `org_settings`, so it exists only in the deployed environment and no test can observe it. It is therefore satisfied by a Deployment_Checklist entry rather than by code — Rollout Order step 0 — and the design records the inference it replaces rather than hiding it: the secret is believed set because a backend running with `LUCKPAY_PROVIDER_ENABLED=true` did not exit at the `env.ts:379-382` guard. That is sound reasoning, not an observation, and criterion 7 exists to close the gap.

## Workstream 3 — completion writes verification state

This is the first workstream to deploy, because Workstream 2 depends on it (Requirement 3 criterion 4).

### The transaction boundary

`finalizeChecklistEsign` (`employeeJoiningDocuments.service.ts:1923-2132`) currently issues four independent `db.execute` calls with no surrounding transaction:

| Statement | Lines | Inside the new boundary? |
|---|---|---|
| checklist `UPDATE` (status, fill_status, signature_mode, locked_at, completed_at) | 2017-2028 | **yes** |
| transaction-table `UPDATE` (status, signed_file_id, completed_at, payload) | 2030-2049 | **yes** |
| public-token `UPDATE` (consumed) | 2051-2057 | **yes** |
| `auditDocumentAction` | 2061-2073 | no |
| payroll-HR inbox notification | 2075-2125 | no |
| `recalculateDocumentProgress` | 2126 | no |

Widen to cover exactly the three writes that constitute *the completion fact*, using `db.getConnection()` + `beginTransaction` / `commit` / `rollback` / `release` — the same shape `bulkVerifyDocuments` (`ats.joiningDocumentsTracker.service.ts:562-605`) and `bulkAssignHR` (:450-483) already use, so the pattern is established rather than invented.

Three things stay **outside**, each for a stated reason:

- **`auditDocumentAction`** — an audit failure must not roll back a real signature. Inside the boundary it would; the current code's design intent (see the `.catch()` reasoning at `joiningKitDispatch.service.ts:77-79`) is that audit is best-effort. Requirement 4 criterion 2 constrains `status`, `verification_status` and `due_at`, not the audit row.
- **Email and inbox notification** — network I/O inside an open transaction holds a pool connection for the duration of an SMTP handshake. `DB_POOL_MAX` defaults to 25 (`env.ts:38`); a slow mail server would starve the pool.
- **`recalculateDocumentProgress`** — it reads the rows this transaction writes. Called inside, it would read the uncommitted state and then be rolled back with it; the value is derived and is recomputed on next read anyway, which is exactly the reasoning already recorded at `bulkVerifyDocuments`' recalculation loop (:607-615).

The verification write joins the checklist `UPDATE` as additional `SET` clauses on the statement that is already there — not a second statement — so Requirement 4 criterion 1's "same database transaction" is satisfied atomically at the statement level as well as the transaction level:

```sql
UPDATE employee_joining_document_checklist
   SET status = ?, fill_status = ?, signature_mode = ?,
       final_file_locked_at = CASE WHEN ? = 'esign_completed' THEN NOW() ELSE final_file_locked_at END,
       completed_at         = CASE WHEN ? = 'esign_completed' THEN COALESCE(?, NOW()) ELSE completed_at END,
       -- new: verification, only for a genuinely verified Aadhaar eSign
       verification_status  = CASE WHEN ? = 'aadhaar_esign_verified' THEN 'verified' ELSE verification_status END,
       verified_at          = CASE WHEN ? = 'aadhaar_esign_verified' THEN NOW()     ELSE verified_at END,
       verification_remarks = CASE WHEN ? = 'aadhaar_esign_verified'
                                   THEN 'Verified by Aadhaar eSign (Luckpay)' ELSE verification_remarks END,
       due_at               = CASE WHEN ? = 'aadhaar_esign_verified' THEN NULL      ELSE due_at END,
       updated_at = NOW()
 WHERE id = ?
```

The gate is `signature_mode = 'aadhaar_esign_verified'`, not `status = 'esign_completed'`. That distinction is load-bearing: both finalizers already set `aadhaar_esign_pending_artefact` when the provider confirmed the signature but the download failed (`employeeJoiningDocuments.service.ts:2011-2012`, `joiningKitDispatch.service.ts:523`). A signature we cannot produce the artefact for must not be recorded as verified — the existing code is scrupulous about that and this design keeps it. Those rows heal on a later pass, because `syncEsignStatus`' short-circuit (`luckpay-status.service.ts:425`) deliberately requires `signed_file_id` to be non-NULL before it returns early.

`verified_by` is left **NULL**. It is `CHAR(36)` with no foreign key, and every other writer puts a real user id there (`ats.joiningDocumentsTracker.service.ts:572`, `employeeJoiningDocuments.service.ts:1056`). There is no human verifier here, and inventing a sentinel would make `verified_by` untrustworthy everywhere else. `verification_remarks` carries the provenance in the row itself, and Audit_Log carries it structurally.

`finalizeKitEsign` gets the same boundary. Its per-member loop (`joiningKitDispatch.service.ts:524-532`) currently runs N independent `UPDATE`s each wrapped in `.catch(() => undefined)`, so a kit can end half-closed today. Inside the transaction the `.catch()`es go, the file-row inserts (:503-521) join them, and the kit row, token and transaction updates (:534-553) come along — the whole "this kit is signed" fact commits or none of it does. `assertSignatureInsideReservedArea` (:495-502), `recalculateDocumentProgress`, `audit(...)` and the fire-and-forget `issueAppointmentLetter` all stay outside, the last one unchanged so `finalizeKitEsign.appointmentLetterTrigger.contract.test.ts` keeps passing.

### Clearing `due_at` — dependency audit

Requirement 4 criterion 1 requires `due_at = NULL`. Every reader of `employee_joining_document_checklist.due_at` was checked:

| Consumer | Reads `due_at` | Broken by clearing it? |
|---|---|---|
| `ats.joiningDocumentsTracker.service.ts:295` | `overdue_count` predicate | No — a NULL `due_at` fails `due_at < NOW()`, which is the intended effect |
| `esign-compliance.worker.ts:169` | selects the column | No — the same query gates on `status IN ('esign_initiated','pending_candidate_esign')` (:181), so a completed row has already left the result set regardless of `due_at` |
| `notification-event.service.ts:444-457` | overdue/expiry templates | No — populated from that worker's rows, which no longer include completed documents |
| `employeeJoiningDocuments.service.ts:862` | returns it in the document pack | Cosmetic — the detail view shows a blank due date on a verified document, which is correct |
| `bulkSetDueDate` (:497-506) | writes it | No — HR setting a due date on an already-verified document is a no-op in practice and remains permitted |
| frontend | nothing | No consumer of this column exists in `src/` |

**No real dependency.** `due_at = NULL` is safe and no `completed_at`-aware predicate is needed, which is why Requirement 4 criterion 6 can leave the overdue predicate untouched. The one loss is historical: after clearing, the original deadline is unrecoverable from the row. It is preserved in the Audit_Log `old_value` for backfilled rows (Requirement 12 criterion 5) and, for forward completions, in the same audit row's `old_value`. Recorded as a low-severity risk below rather than designed around.

### Audit provenance (Requirement 4 criterion 3, Requirement 5 criterion 3)

One `action_type` vocabulary, disjoint from the human-review one, so provenance is a value and not a timestamp comparison:

| `action_type` | Written by |
|---|---|
| `ESIGN_VERIFICATION_AUTO` | `finalizeChecklistEsign`, `finalizeKitEsign` — forward completion |
| `ESIGN_VERIFICATION_BACKFILL` | Backfill_Runner closure (R12.1) |
| `ESIGN_BACKFILL_EXAMINED_UNSIGNED` | Backfill_Runner, kit left untouched (R12.4) |
| `BULK_VERIFY_ESIGNED` | `bulkVerifyDocuments`, row arrived by eSign (R5.3) |
| `BULK_VERIFY` | `bulkVerifyDocuments`, uploaded row — existing value, unchanged |

`new_value` carries `{ verificationSource: 'aadhaar_esign', signatureMode, providerReferenceId }`; `old_value` carries `{ status, verification_status, due_at }` as they were before the write.

## Workstream 3b — bulk verification reaches eSigned rows

`bulkVerifyDocuments`' `WHERE employee_id = ? AND status = 'uploaded_pending_review'` (`ats.joiningDocumentsTracker.service.ts:573`) becomes two statements inside the existing per-employee transaction, because the two provenances need different audit rows and different end states:

```sql
-- uploaded rows: unchanged behaviour, plus due_at
UPDATE employee_joining_document_checklist
   SET status='verified', verification_status='verified',
       verified_at=NOW(), verified_by=?, due_at=NULL, updated_at=NOW()
 WHERE employee_id=? AND status='uploaded_pending_review';

-- eSigned rows: status already terminal, so only verification moves
UPDATE employee_joining_document_checklist
   SET verification_status='verified', verified_at=NOW(),
       verification_remarks='Verified by Aadhaar eSign (Luckpay)',
       due_at=NULL, updated_at=NOW()
 WHERE employee_id=? AND status='esign_completed'
   AND signature_mode='aadhaar_esign_verified'
   AND verification_status IS NULL;
```

Two decisions worth stating. The eSigned statement does **not** move `status` to `'verified'` — `esign_completed` is the accurate description of how that document arrived, and the comment at :567-571 explains that `status` had to move for uploaded rows only because `recalculateDocumentProgress` counts `uploaded_pending_review` as incomplete; `esign_completed` it already counts as complete. And `verified_by` is set for uploaded rows (a human clicked) but not for eSigned rows (nobody reviewed), consistent with Workstream 3. `verification_status IS NULL` makes a re-run a no-op. The existing `recalcNeeded` deferral (:587, :607-615) is untouched, satisfying Requirement 5 criterion 4, and the per-employee try/catch that produces `errors` (:591-604) already satisfies criterion 5.

## Workstream 2 — the Backfill_Runner

### Shape: a script, not an endpoint

`backend/scripts/backfill-stranded-joining-kits.ts`, dry-run by default, `--confirm` to act. Matched to `backend/scripts/dispatch-joining-kit.mjs`, which is the nearest existing precedent and settles the question:

- It must run on the server regardless. `dispatch-joining-kit.mjs`' header records that Luckpay accepts only the deployment's egress IP — "from anywhere else the handshake fails with *IP address \<yours\> is not whitelisted*". An admin endpoint would run there too, so the endpoint buys nothing on that axis.
- The repo has ~40 `backfill-*` scripts and an established dry-run pair convention (`apr-rescope-reprocess-dry-run.ts` / `apr-rescope-reprocess.ts`). A one-off remediation matching that convention needs no route, no RBAC grant, no `page_catalog` row and no `role_page_access` migration.
- Requirement 12 criterion 1 needs an operator. A script takes `--actor-user-id` explicitly and refuses without it, which is a stronger guarantee than an endpoint's ambient `req.authUser.id`: the operator is recorded because it was stated, not because a session happened to exist.
- A script cannot be re-triggered by an accidental double-click, and its stdout *is* the report.

The trade is that it is not runnable from the UI. For a single authorised run before 2026-08-31 that is the right trade.

Interface:

```
# on the server, from /var/www/HRMS2/backend
npx tsx scripts/backfill-stranded-joining-kits.ts --actor-user-id <ID> \
    [--kit-id <ID>...] [--report ./backfill-report.csv] [--confirm]
```

`tsx`, not `node`, matching the `.ts` scripts already wired into `backend/package.json` (`inbox:reconcile`, `preflight:tables`, `dashboard:audit`), so the runner can import the service modules directly from `src/` instead of depending on a fresh `dist/` build. A `package.json` entry — `"backfill:stranded-kits": "tsx scripts/backfill-stranded-joining-kits.ts"` — is added alongside them. Refuses to start without `--actor-user-id`.

### Selection

Selects Stranded_Kits directly, not through `claimBatch` — whose `initiated_at > (NOW() - INTERVAL 30 DAY)` clause already excludes MAS47814:

```sql
SELECT k.id AS kit_id, k.employee_id, k.status AS kit_status, k.sent_at,
       k.signed_file_id, e.employee_code,
       t.id AS tx_id, t.client_transaction_id, t.provider_reference_id, t.status AS tx_status
  FROM employee_joining_esign_kit k
  JOIN employees e ON e.id = k.employee_id
  LEFT JOIN employee_document_esign_transaction t
         ON t.kit_id = k.id AND t.provider = 'luckpay' AND t.scope = 'kit'
 WHERE k.status = 'sent'
   AND k.signed_file_id IS NULL
   AND k.sent_at >= '2026-08-01' AND k.sent_at < '2026-08-27'
 ORDER BY k.sent_at ASC
```

`ORDER BY k.sent_at ASC` puts MAS47814 (dispatched 2026-08-01, the closest to its Give_Up_Window) first, so a run interrupted part-way has resolved the most urgent kits.

### Per-kit decision tree

```
resolve transaction
├─ no transaction row, or provider_reference_id NULL / not matching ^APIB
│    └─ classify 'unresolvable_no_provider_reference'      (R3.7) — no provider call
├─ kit already status='signed' or signed_file_id set
│    └─ classify 'already_closed'                          (R3.8) — no provider call
└─ checkESignStatus({ clientTransactionId, transactionId })   ← the one billed status call
     ├─ state === 'completed'
     │    ├─ extract providerCompletedAt from status.sanitized
     │    └─ finalizeKitEsign({ …, completedAt, backfill: { actorUserId, providerReferenceId } })
     │         └─ classify 'closed'                         (R3.3, R3.4)
     └─ otherwise
          ├─ write ESIGN_BACKFILL_EXAMINED_UNSIGNED audit row   (R12.4)
          └─ classify 'left_untouched'                      (R3.5) — zero writes to kit/checklist/token
```

Exactly one `checkESignStatus` per kit per run and at most one `downloadESignDocument`, the latter only inside `finalizeKitEsign`'s existing single download (`joiningKitDispatch.service.ts:462-478`) — upper bound 26 and 26, as Requirement 11 criterion 5 states.

### Preserving the provider's completion time (Requirement 12, criterion 3)

`LuckpayStatusResult` (`luckpay.client.ts:54-63`) carries no timestamp field — only `sanitized`. So `finalizeKitEsign` gains an optional `completedAt?: Date | null` and every `completed_at = NOW()` in it becomes `COALESCE(?, NOW())`, and a small extractor reads the first present of `esignDetails.signed_at`, `esignDetails.completed_at`, `signedAt`, `completedAt` out of `sanitized`.

When the provider reports no timestamp, the run time is used and the audit row records `completedAtSource: 'backfill_run_time'` rather than `'provider'`. That is the honest reading of criterion 3: preserve the provider's time whenever there is one, and never disguise its absence.

### Report (Requirement 3, criterion 6)

One row per examined kit, CSV to `--report` and a table to stdout, with a trailing tally. The rows below are **illustrative shape only** — the `provider_status` and `classification` values are placeholders showing what each column carries, not predictions. Which of the 26 Luckpay reports signed is unknown until the dry run in rollout step 4, and the design tolerates any answer including zero:

```
employee_code, dispatch_date, provider_reference, provider_status, classification, documents_closed, note
MAS47814, 2026-08-01, APIB1785567457469073, SIGNED,  closed,          9, completed_at from provider
MAS63411, 2026-08-04, APIB1785601233440912, PENDING, left_untouched,  0, unchanged
MAS63502, 2026-08-11, (none),               —,       unresolvable_no_provider_reference, 0, link_generated only
```

Totality is a property, not a hope: every selected kit produces exactly one row, including the ones no provider call was made for.

### Idempotence (Requirement 3, criterion 8)

Three layers, so a second run is safe even if one layer is bypassed:

1. `already_closed` short-circuits before any provider call, so a re-run costs nothing.
2. The eSigned bulk-verify predicate and the checklist verification write are both `verification_status IS NULL`-guarded, so re-application is a zero-row `UPDATE`.
3. `finalizeKitEsign`'s token consumption is `WHERE … token_status = 'active'` (`joiningKitDispatch.service.ts:541-544`) and already no-ops on a consumed token.

## Workstream 4 — the tracker

### One classifier, three consumers

The drift is the bug: the SQL hard-codes three states inline (`ats.joiningDocumentsTracker.service.ts:296-297`) and `EmployeeJoiningDocumentsPage.tsx:71-86` keeps a separate colour map that omits `ready_for_esign`, `draft_generated`, `hr_fill_required`, `employee_review_pending` and `correction_requested`. Neither knows about the other.

There is no shared module between the two builds — `vite.config.ts:57-59` and `tsconfig.json:7-11` both alias `@` to `./src` only, and the backend is a separate `tsconfig`. So a literal single source cannot be imported by both. The design instead makes the **server the single authority** and reduces the frontend's independent knowledge to presentation:

**`backend/src/modules/ats/esignState.ts`** (new, leaf module — imports nothing):

```ts
export type EsignBucket = "completed" | "in_progress" | "not_started";

/** Every status this system writes to employee_joining_document_checklist.status,
 *  mapped to exactly one bucket. Union of the Esign_State set and
 *  ALLOWED_CHECKLIST_STATUSES (employeeJoiningDocuments.service.ts:89-107). */
export const ESIGN_STATE_BUCKET: Readonly<Record<string, EsignBucket>> = {
  esign_completed: "completed",
  employee_confirmed: "completed",
  verified: "completed",
  completed: "completed",
  signed_verified: "completed",
  wet_signed_uploaded: "completed",

  esign_initiated: "in_progress",
  pending_candidate_esign: "in_progress",
  ready_for_esign: "in_progress",
  employee_review_pending: "in_progress",
  uploaded_pending_review: "in_progress",
  uploaded_pending_esign: "in_progress",
  correction_requested: "in_progress",
  needs_correction: "in_progress",
  esign_failed: "in_progress",

  draft_generated: "not_started",
  hr_fill_required: "not_started",
  pending_hr_upload: "not_started",
  pending_generation: "not_started",
  template_pending: "not_started",
};

export function classifyEsignState(status: string | null | undefined): EsignBucket;
/** SQL CASE expression generated from the table above, so the query cannot drift from it. */
export function esignBucketCaseSql(column: string): string;
```

Three consequences that matter:

- **The denominator is the row count.** Every status maps, so `completed + in_progress + not_started` equals `COUNT(c.id)`. MAS63411's nine documents give a denominator of 9, and no row can silently leave it. This is why `uploaded_pending_review` is mapped rather than excluded: Requirement 6 criterion 1's governing rule is that no checklist row is dropped.
- **The SQL is generated, not written.** `esignBucketCaseSql('c.status')` emits the `CASE` expression, so the counters and `classifyEsignState` cannot disagree — they are the same table.
- **Unknown values are counted and logged once.** `classifyEsignState` returns `"not_started"` for an unrecognised value and records it in a module-level `Set` so the log line fires once per distinct value per process, not once per row. Without that, one bad status on 309 employees is 309 log lines.

The anti-drift mechanism is a contract test asserting that every member of `ALLOWED_CHECKLIST_STATUSES` has a key in `ESIGN_STATE_BUCKET`. Adding a status to the allow-list without classifying it fails the build.

**`src/lib/esignState.ts`** (new) mirrors `EsignBucket` and a bucket→colour map for `STATUS_COLORS`, and a contract test compares the two files' key sets. The tracker page needs no status knowledge at all: the API sends the bucket.

### Summary buckets (Requirement 7)

`calculateTrackerSummary` (:98-145) emits `pending_verification` and `needs_correction`; the page renders `total_employees`, `completed_count`, `in_progress_count`, `overdue_count`. So a 75-99% employee is counted somewhere nothing displays, which is why live tiles read Completed 0 / In Progress 0 above rows badged In Progress.

**Decision: fold `pending_verification` into `in_progress`; surface `pending_count`.** Two separate calls, and they pull in opposite directions, so both need stating.

`pending_verification` is folded away rather than given a tile of its own. It was invented for documents that were complete but awaiting a human check, and Workstream 3 removes that population outright — a verified Aadhaar eSign is the verification, so there is no longer a 75-99% band that means something different from "in progress". A tile for it would be permanently near-zero and would invite the same drift back.

`pending_count` does get a tile, because Requirement 7 criterion 3 requires the rendered tiles to sum to 309, and `completed + in_progress` cannot reach 309 while any employee sits at 0%. The tile row goes from four to five: Total, Completed, In Progress, **Pending**, Overdue, and the `grid-cols-4` block becomes `grid-cols-5` at the `lg` breakpoint. Total and Overdue stay outside the sum — Total *is* the sum, and Overdue is a cross-cutting count.

So:

```ts
export type SummaryBucket = "completed" | "in_progress" | "pending";

export function classifyEmployeeBucket(pct: number): SummaryBucket {
  if (pct >= 100) return "completed";
  if (pct > 0)    return "in_progress";   // absorbs the former 75-99 pending_verification band
  return "pending";
}
```

`calculateTrackerSummary` calls it in its loop instead of inlining the thresholds, so the three counts partition the list by construction and `completed + in_progress + pending === total_employees` for any input. `overdue_count` and `needs_correction` stay as they are — they are **cross-cutting counts**, not buckets, and an employee can be both in-progress and overdue. `pending_verification` is removed from `TrackerSummary` outright rather than left unrendered; a field nothing reads is how this drifted.

Requirement 7 criterion 3's sum-to-309 then falls out of the partition rather than being asserted separately. The row badge calls the same `classifyEmployeeBucket`, replacing `StatusBadge`'s read of `row.joining_document_status` (a separate column with its own drift risk, written by `recalculateDocumentProgress` on a schedule the tiles know nothing about), which is what Requirement 7 criterion 4 asks for. `StatusBadge`'s three variants (`JoiningDocumentsTrackerPage.tsx:57-65`) already carry exactly the three bucket names, so the change is what it reads, not what it renders.

### Null vs zero (Requirement 8)

Null is produced in **one** place — the SQL — and never coerced afterwards:

```sql
CASE WHEN COUNT(c.id) = 0 THEN NULL ELSE SUM(<bucket case> = 'completed')     END AS esign_completed_count,
CASE WHEN COUNT(c.id) = 0 THEN NULL ELSE SUM(<bucket case> <> 'completed')    END AS esign_pending_count,
```

`SUM()` over a `LEFT JOIN` with no matching rows already yields NULL, but relying on that is fragile once the join graph changes; the explicit `CASE` states the intent. The mapper (:333-334) drops `Number(row.x ?? 0)` in favour of `row.x === null ? null : Number(row.x)`.

For criterion 3, the types are made to agree by **deriving one from the other's shape** in the only way the two builds allow: `EmployeeDocumentRow` in the service declares `esign_completed_count: number | null` and `esign_pending_count: number | null`, the page's `EmployeeRow` already declares exactly that (`JoiningDocumentsTrackerPage.tsx:37-38`), and a contract test compares the nullability of every count field between the two declarations. Same mechanism as the classifier mirror: no shared import is possible, so the agreement is pinned rather than assumed. The page's existing render already handles the null case correctly (`row.esign_completed_count !== null && row.esign_pending_count !== null ? badge : dash`) — it was the service lying that broke it.

### Real pagination (Requirement 9)

The obstacle is that the row query is `GROUP BY e.id` with `HAVING overdue_count > 0` for `overdue_only`, so `total` cannot be a plain `COUNT(*)` over the `WHERE` clause — the `HAVING` filters after grouping.

**Approach: `COUNT(*) OVER ()` in the row query.** MySQL evaluates window functions after `WHERE`/`GROUP BY`/`HAVING` and before `ORDER BY`/`LIMIT`, so `COUNT(*) OVER ()` on the grouped-and-having-filtered result is exactly the filtered employee count, computed in the same pass as the page. MySQL 8 is the deployment (`PROJECT_OVERVIEW.md:57`) and window functions are already used in production queries — `COUNT(*) OVER (PARTITION BY …)` at `process-performance.service.ts:744`, `ROW_NUMBER() OVER` at `pnl-actuals.service.ts:71` — so this needs no new capability.

```sql
SELECT  …,
        COUNT(*) OVER () AS total_matching
  FROM  …
 WHERE ${whereSQL}
 GROUP BY e.id
 ${havingClause}
 ORDER BY e.date_of_joining DESC, e.employee_code ASC, e.id ASC
 LIMIT ? OFFSET ?
```

One round trip, and the count cannot disagree with the page because it comes from the same statement — which a separate count query can, if a filter is applied to one and not the other.

**The empty-page edge.** `COUNT(*) OVER ()` returns no rows when the page is past the end, so `total` would read 0 and `hasPrev` would strand the user. Handled with a narrow fallback: when `rows.length === 0 && page > 1`, issue a wrapped count over the identical grouped subquery:

```sql
SELECT COUNT(*) AS total FROM (
  SELECT e.id, SUM(CASE WHEN c.due_at < NOW() AND c.verification_status IS NULL THEN 1 ELSE 0 END) AS overdue_count
    FROM … WHERE ${whereSQL} GROUP BY e.id ${havingClause}
) t
```

The `FROM … WHERE … GROUP BY … HAVING` text is built once into a single `const` and interpolated into both statements, so the fallback cannot drift from the primary. On page 1 an empty result genuinely means `total = 0` and no second query is issued.

**Deterministic order (criterion 5).** `ORDER BY e.date_of_joining DESC` alone is not unique — 309 employees over ~26 dispatch days guarantees ties, and MySQL may order tied rows differently between the `OFFSET 0` and `OFFSET 50` executions, so an employee can appear twice or not at all. Tiebreak on `e.employee_code ASC` (the `WHERE` already asserts `e.employee_code IS NOT NULL`) and then `e.id ASC` as the guaranteed-unique final key.

**Parameters.** `page` (default 1, min 1) and `limit` (default 50, min 1, **max 200**) parsed in `ats.joiningDocumentsTracker.routes.ts:33-44` and added to `TrackerQueryParams`; `LIMIT ?/OFFSET ?` bound rather than interpolated. The cap replaces the current hard `LIMIT 500` as the abuse ceiling — without one, `limit=100000` reintroduces the unbounded scan the 500 was there to prevent.

**Summary scope.** `calculateTrackerSummary` currently runs over the returned rows, so with real pagination the tiles would describe page 1 only. The summary must be computed over the whole filtered set, not the page. It is computed from a **second aggregate query** over the same shared `FROM … WHERE … GROUP BY … HAVING` text, returning the four bucket counts and the two cross-cutting counts directly, so the tiles are page-independent as Requirement 7 criterion 3 requires. `calculateTrackerSummary` is kept as the exported pure function the unit tests target, and the aggregate query's `CASE` bands are generated from `classifyEmployeeBucket`'s thresholds so the two cannot diverge.

**Cost.** No index helps `ORDER BY e.date_of_joining DESC` over a grouped set; the plan is a filesort over the grouped result, the same work the current `LIMIT 500` already does. At 309 in-scope employees this is not worth optimising, and the existing `idx_ejdc_employee` covers the join. Revisit if the in-scope population passes a few thousand.

### Refresh (Requirement 10)

Query key becomes `["joining-documents-tracker", { search, statusFilter, overdueOnly, page, limit }]`. Then:

- **10.1** — every bulk mutation's `onSuccess` calls `queryClient.invalidateQueries({ queryKey: ["joining-documents-tracker"] })` instead of the local `refetch()` used today at lines 128, 139, 152, 172, 184. Prefix invalidation refreshes every cached page, not only the visible one, so the tiles and the list both re-read.
- **10.2** — `refetchInterval: 60_000` with `refetchIntervalInBackground: false`, so a background tab stops polling. Sixty seconds against `TICK_MS` of five minutes means a worker completion surfaces within a minute of being written.
- **10.3** — page, filters and selection live in component state and are untouched by a refetch; the only care needed is not clearing `selectedIds` on data arrival. The existing `rowIds` memo (:117) is unused and is removed rather than left to imply a reset that does not happen.
- **10.4** — `placeholderData: keepPreviousData` keeps the previous page's rows on screen during a page change or interval refetch, so the table does not blank.

## Migrations

**None.** Every column this design writes already exists:

- `next_poll_at`, `poll_attempts`, `last_polled_at` and `idx_edet_next_poll` — `backend/sql/1042_esign_transaction_poll_state.sql`, already applied.
- `verification_status`, `verified_at`, `verified_by`, `verification_remarks`, `due_at`, `completed_at` on `employee_joining_document_checklist` — `backend/sql/346_employee_joining_document_pack.sql:36-41`.
- `employee_joining_esign_kit.sent_at`, `signed_file_id`, `open_marker`, `completed_at` — `backend/sql/1049_joining_document_esign_kit.sql:53-59`.
- `abandoned_unresolved` needs no DDL: `employee_document_esign_transaction.status` is a `VARCHAR`, not an `ENUM`, following the same convention as the checklist table's `status VARCHAR(80)`.
- `verification_status` is `VARCHAR(80)` with no enum constraint, so `'verified'` needs no widening.

Avoiding a migration is deliberate. Repository convention (`backend/src/db/runPendingMigrations.ts:717-720`) is that migrations are registered and applied under explicit approval; a remediation that needs none can ship on its own schedule.

## Error Handling

| Failure | Behaviour | Why |
|---|---|---|
| Provider unreachable during a tick | Per-transaction `error_message` + `next_poll_at` on the ladder; batch continues | An outage must not burn the backoff budget faster than a real pending signature — the reasoning already in the worker's catch block |
| Provider says signed, download fails | `signature_mode = 'aadhaar_esign_pending_artefact'`; **no** verification write | A signature we cannot produce must not read as verified. Heals on a later pass via the `signed_file_id IS NULL` short-circuit |
| Completion transaction fails mid-way | Rollback; `status`, `verification_status`, `due_at` all at pre-state | R4.2. The three are one fact |
| Audit write fails after a committed completion | Logged, not rethrown | Outside the boundary by design; losing an audit row is better than rolling back a real signature |
| `recalculateDocumentProgress` fails | Logged; percentage stale until next read | Derived value, recomputed on next pack open — the existing reasoning at `bulkVerifyDocuments`:607-615 |
| Backfill: kit has no `APIB…` reference | Classified `unresolvable_no_provider_reference`, reported, **not** an error, no provider call | R3.7 |
| Backfill: `finalizeKitEsign` throws for one kit | Caught per kit; classified `error` with the message in the report; run continues | A single bad kit must not abandon the other 25 before the window closes |
| Backfill run interrupted | Safe to re-run; `already_closed` short-circuits before billing | R3.8 |
| Webhook: audit write impossible (no resolvable employee) | `console.error` only, audit skipped | `employee_id` is `NOT NULL`; a swallowed insert is how the kit audit log silently lost every row before `joiningKitDispatch.service.ts:57-78` was fixed |
| Tracker: unrecognised checklist status | Row counted in the denominator; one log line per distinct value per process | R6.5 without a 309-line log storm |

## Rollout Order

Workstream 3 changes write behaviour and Workstream 2 depends on it (R3.4), so the sequence is not negotiable.

0. **Record the Deployment_Checklist confirmation that `LUCKPAY_WEBHOOK_SECRET` is set in production (R2.7).** Its presence is currently *inferred* — from the startup guard at `env.ts:379-382` not having fired in a backend demonstrably running with `LUCKPAY_PROVIDER_ENABLED=true` — and the value is absent from both the repository and `org_settings`, so nothing in either can confirm it. The checklist entry replaces the inference with an operational check against the running environment. Numbered zero because it is a record against the deployed environment rather than a deploy, which leaves steps 1-6 with the numbering the Risks section and the task list refer to.
1. **Workstream 3 + 3b + 4 deploy together, flag still off.** The write path becomes correct and the tracker becomes truthful about the current data before anything new is written. Enabling the tracker fixes first also means the backfill's effect is observable the moment it runs. `ESIGN_RECONCILIATION_ENABLED` stays `false` here.
2. **Workstream 1b (webhook hardening) rides along.** No behavioural dependency either way; it is in step 1 only to avoid a second deploy.
3. **Verify on MAS63411.** Its 5 `esign_completed` rows carry `signature_mode = 'aadhaar_esign_verified'` and `completed_at` already, but `verification_status` NULL on all 9. They are *past* completions, so the forward write does not reach them — clear them with `bulk-verify` from the tracker, which now matches eSigned rows (Workstream 3b), and confirm `verified_count = 5` / `overdue_count = 4` (R4.5) and denominator 9 (R6.4). This is the acceptance test for steps 1 and 2 and it needs no provider call.
4. **Backfill dry run.** `--actor-user-id <ID>` without `--confirm`. Costs 26 status calls, writes nothing, and produces the report. Its value is answering the open question — how many of the 26 Luckpay actually reports signed — before any write.
5. **Backfill confirmed run, MAS47814 first.** Ordered `sent_at ASC`. Must complete on or before **2026-08-31**.
6. **Flip `ESIGN_RECONCILIATION_ENABLED=true` in the deployed `backend/.env`, restart `hrms2-workers`.** Last, deliberately: by now the write path is correct, so the first thing the worker does cannot produce a signed-but-unverified row. Confirm from the first tick's log line that it reports `enabled=true` and a selected count, and that `last_polled_at` is non-NULL and `poll_attempts` non-zero across the table — the observable that has been NULL and 0 on all 48 transactions to date.

Reversing 5 and 6 is the one ordering that must not happen: the worker's `GIVE_UP_AFTER_DAYS = 30` window would already have excluded MAS47814, so enabling the worker first does not resolve it and consumes the deadline.

## Testing Strategy

Vitest, matching the repo's existing split: behavioural unit tests for pure functions, source-text contract tests for structural guarantees the type checker cannot see. The contract-test style follows `backend/src/__tests__/publicRouteMountOrder.contract.test.ts` and `backend/src/modules/employees/__tests__/finalizeKitEsign.appointmentLetterTrigger.contract.test.ts`, both of which read source and assert on its shape — the honest tool here, because as that second file's header records, "this repo has no harness that drives a real webhook payload through to a live database".

### Unit and property tests

| File | Covers |
|---|---|
| `backend/src/modules/ats/__tests__/esignState.test.ts` | Classifier totality and disjointness over the union set; `esignBucketCaseSql` emits a `CASE` naming every key exactly once; unknown values bucket and log once per distinct value (Property 13) |
| `backend/src/modules/ats/__tests__/trackerSummary.test.ts` | `classifyEmployeeBucket` partitions across 0-100 including the 75 and 99 boundaries; `calculateTrackerSummary` sums to input length; badge bucket equals tile bucket; 309-employee fixture (Property 14, and R7.3) |
| `backend/src/modules/ats/__tests__/trackerPagination.test.ts` | Page concatenation reproduces the ordered set exactly once over colliding `date_of_joining` values; `total` invariant; `hasNext` matches remaining count (Property 16) |
| `backend/src/modules/ats/__tests__/trackerNullCounts.test.ts` | Counts null iff row count 0, numeric (including 0) otherwise (Property 15) |
| `backend/tests/employeeCompliancePrivacy.test.ts` (extend) | `classifyLuckpayWebhookAuth` totality and disjointness over arbitrary string/undefined pairs including empty and whitespace; existing `verifyLuckpayWebhookSecret` assertions unchanged (Property 6) |
| `backend/src/workers/__tests__/esignReconciliation.test.ts` | Ladder membership, monotonicity, terminal repetition; poll counter advances once per outcome including a throw; failing-subset isolation; abandonment written exactly once over repeated ticks; provider-call counts against a counting mock (Properties 1-5) |
| `backend/src/modules/employees/__tests__/finalizeKitEsign.verification.test.ts` | Every member row of a 1-12 member kit reaches the full verified state; per-member state identical (Property 8) |
| `backend/scripts/__tests__/backfillStrandedKits.test.ts` | Idempotence, unsigned-kit immutability, report totality, attribution, `completed_at` provenance, call counts (Properties 17-21) |

### Contract tests

| File | Asserts |
|---|---|
| `finalizeChecklistEsign.verificationTransaction.contract.test.ts` | The checklist write, the transaction-table write and the token write all sit between `beginTransaction` and `commit` on one connection; `auditDocumentAction`, the inbox block and `recalculateDocumentProgress` all sit **after** `commit`; the checklist `UPDATE` sets `verification_status` and `due_at` in the same statement as `status`. This is R4.1's "same transaction" — unobservable from any post-state assertion, which is why it needs its own test |
| `esignStateClassifierCoverage.contract.test.ts` | Every member of `ALLOWED_CHECKLIST_STATUSES` (`employeeJoiningDocuments.service.ts:89-107`) has a key in `ESIGN_STATE_BUCKET`; the tracker SQL contains no inline status literal, only the generated `CASE` |
| `esignStateMirror.contract.test.ts` | `src/lib/esignState.ts` and `backend/src/modules/ats/esignState.ts` declare the same bucket names; `STATUS_COLORS` covers every bucket |
| `trackerTypeParity.contract.test.ts` | Nullability of every count field agrees between `EmployeeDocumentRow` and the page's `EmployeeRow` (R8.3) |
| `trackerOverduePredicate.contract.test.ts` | `due_at < NOW() AND verification_status IS NULL` still present verbatim (R4.6); `bulkVerifyDocuments` contains no `joining_document_completion_pct` write and still calls `recalculateDocumentProgress` (R5.4) |
| `luckpayWebhookDormancy.contract.test.ts` | The dormancy comment and the absolute callback URL sit above the route; the route path literal is unchanged; the three rejection branches each log and audit distinguishably (R2.1, R2.6) |
| `esignReconciliationBudget.contract.test.ts` | `BACKOFF_MINUTES`, `TICK_MS`, `BATCH_SIZE`, `GIVE_UP_AFTER_DAYS` unchanged; the `scope === 'kit'` delegation to `finalizeKitEsign` precedes the per-document download block in `luckpay-status.service.ts` (R1.2, R1.3, R11.2) |
| `esignReconciliationRegistration.contract.test.ts` | `startEsignReconciliationWorker` is registered in `all-workers.ts`, and the flag is read from `env.ts` — the registration whose single-file nature is the reason a flag on the API process would do nothing (R1.1) |
| `env.luckpayWebhookGuard.contract.test.ts` | The `LUCKPAY_PROVIDER_ENABLED === "true" && !LUCKPAY_WEBHOOK_SECRET` guard and its `process.exit(1)` still exist (R2.8) |
| `esignCompletionSingleWriter.contract.test.ts` | Neither `handleJoiningDocumentEsignWebhook` nor `syncEsignStatus` contains its own `UPDATE … SET status = 'esign_completed'` for a kit-scope transaction; both delegate (R2.5) |

### Testing the Backfill_Runner without billed calls

The runner takes its Luckpay dependency by injection rather than importing `luckpayClient` at module scope:

```ts
export async function runBackfill(deps: {
  client: Pick<typeof luckpayClient, "checkESignStatus" | "downloadESignDocument">;
  db: Pool;
  actorUserId: string;
  confirm: boolean;
}): Promise<BackfillReport>;
```

The script's `main()` supplies the real client; tests supply a counting fake that returns scripted verdicts and records call counts per `transactionId`. That is what makes Properties 17-21 testable at all — a runner that imports its client directly can only be tested by billing for it. `finalizeKitEsign`'s own internal download is reached through the same injected client, threaded as an optional parameter defaulting to the real one, so the mock covers the whole path.

The dry-run mode is a second, weaker safety net rather than the primary one: `--confirm` absent means no write, but it still issues the 26 status calls, so it is not free and is not a substitute for the mock in tests.

### Property test configuration

Minimum 100 iterations per property. Each test carries the tag `Feature: joining-kit-esign-completion, Property {number}: {property text}` in its `describe` or `it` title, so a failure names the design property it violated.

### PBT applicability

Property-based testing is used for the classifiers, the bucket partition, the pagination partition, the ladder, the counting bounds and the backfill's idempotence — all pure functions or bounded loops over generated inputs. It is **not** used for: the deployed flag and the production secret (SMOKE, deployment-checklist items whose subject is unreachable from any test), the four `2026-08-31`/MAS63411/MAS47814/309-employee figures (EXAMPLE, single production snapshots), or the TanStack Query configuration in Requirement 10 (EXAMPLE, single configuration facts that do not vary with input).

## Risks

**Per-call billing.** `checkESignStatus` and `downloadESignDocument` may each be billed, which is why the worker was written default-off. Bounded by the Backoff_Ladder (Property 5) and by the backfill's 26+26 ceiling (Property 21), both asserted against counting mocks. The residual exposure is the first tick, where every eligible transaction has `next_poll_at IS NULL` and `claimBatch` treats that as due now — but `BATCH_SIZE` 25 caps the first tick at 25 status calls and the ladder spreads the rest across the following ticks. Mitigation if the invoice disagrees: compare `SUM(poll_attempts)` against the billed count, which is the whole point of fixing gap 1.

**The 2026-08-31 deadline for MAS47814.** Steps 1-5 of the rollout must complete inside the window, and step 5 is the only one that resolves it. The worker cannot: `claimBatch`'s `initiated_at > (NOW() - INTERVAL 30 DAY)` excludes a 2026-08-01 transaction from the moment the window closes. If the deadline is missed, the kit is unrecoverable by polling and becomes a manual re-dispatch — which decision 3 explicitly did not authorise, so it would need a fresh decision.

**Luckpay may report fewer than 13 signed kits.** The 13 opened-page employees are evidence of interest, not of signature. The dry run in rollout step 4 is designed to answer this before any write, and the design tolerates any answer: an unsigned kit takes the `left_untouched` path, which writes nothing and reports (Property 18). Nothing downstream assumes a particular yield. If the answer is zero, the backfill's value is the report and the audit trail, and the 215 stranded rows stay stranded pending a decision this spec does not make.

**`GIVE_UP_AFTER_DAYS` silently excludes older transactions even after the flag is on.** The window is measured from `initiated_at`, not from when the worker started, so enabling the worker on 2026-09-02 excludes everything dispatched before 2026-08-03 — most of the 26 — with no signal at all today. The abandonment sweep (gap 4) converts that silence into 26 `abandoned_unresolved` rows and 26 audit entries on the first tick, which is the correct outcome but will look alarming if the backfill has not run first. This is the sharpest reason rollout step 5 precedes step 6.

**Clearing `due_at` destroys the original deadline on the row.** No consumer breaks (see the dependency audit), but the value is not recoverable from the checklist row afterwards. Preserved in the Audit_Log `old_value` for every row this spec's writes touch. Low severity: `bulkSetDueDate` can re-establish a date, and the deadline's only reader was the overdue predicate this change is designed to satisfy.

**`abandoned_unresolved` is a new value in a `VARCHAR` status column.** No DDL is needed, but any consumer switching on `employee_document_esign_transaction.status` sees an unfamiliar value. Adding it to `TERMINAL` covers the worker; the tracker does not read this column. Checked and no other reader exists, but this is the kind of value that acquires readers later.

**`COUNT(*) OVER ()` materialises the full grouped set on every page.** Acceptable at 309 in-scope employees and no worse than the `LIMIT 500` it replaces. If the in-scope population grows past a few thousand, the row query and the count should split, with the count cached per filter set for the duration of a page walk.

**Summary computed by a second query can disagree with the row query.** Mitigated by building the `FROM … WHERE … GROUP BY … HAVING` text once and interpolating it into both statements, and by generating the summary query's percentage bands from `classifyEmployeeBucket`. A contract test asserts both statements reference the same shared constant.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: The backoff ladder is a total, non-decreasing schedule whose final interval repeats

For any attempt count, including zero, negative values and values beyond the ladder's length, `nextDelayMinutes` returns a member of `BACKOFF_MINUTES`, the returned delay never decreases as the attempt count rises, and every attempt count at or beyond the ladder's last index returns the same final interval.

**Validates: Requirements 1.2**

### Property 2: Every poll advances the poll counter exactly once

For any poll outcome — completed, failed, still pending, or a provider call that throws — the polled transaction's `poll_attempts` is exactly one greater than before the poll and its `last_polled_at` is set.

**Validates: Requirements 1.4, 11.1**

### Property 3: A batch survives per-transaction failure

For any batch of transactions and any subset of them whose provider call fails, every transaction outside that subset is still processed, and every transaction inside it carries both a recorded failure message and a next scheduled attempt.

**Validates: Requirements 1.6**

### Property 4: Nothing outside the give-up window is selected, and abandonment is recorded exactly once

For any set of transactions with arbitrary initiation dates, the transactions selected for polling are exactly those inside the give-up window and not in a terminal state; and for any number of consecutive ticks over the same abandoned transaction, exactly one abandonment record exists.

**Validates: Requirements 1.7, 11.4**

### Property 5: Provider call volume is bounded by the schedule

For any candidate pool larger than the batch size and any mix of provider verdicts including thrown errors, the number of status calls equals the number of transactions selected, the number selected never exceeds the batch size, and the number of document downloads equals the number of transactions the provider reported as signed.

**Validates: Requirements 11.1, 11.2, 11.3**

### Property 6: Webhook rejection classification is total and disjoint

For any pair of configured secret and provided header value, including undefined, empty and whitespace-only values, the classifier returns exactly one outcome from the set {accepted, secret not configured, header absent, header mismatch}, that outcome matches the independently stated expectation for the pair, and only "accepted" permits the payload to be processed.

**Validates: Requirements 2.2, 2.3, 2.4**

### Property 7: A pushed completion and a pulled completion converge on the same writer

For any signed kit-scope transaction, the push path and the pull path both reach the kit finalizer, and neither path contains its own write of a checklist row to the completed state.

**Validates: Requirements 2.5**

### Property 8: eSign completion writes the full verified state on every affected row

For any checklist row, and for every member row of any kit, completed by an eSign whose signed artefact was retrieved, the post-state carries the completed status, a verification status of verified, and a null due date, and every member row of the same kit carries an identical verification state.

**Validates: Requirements 4.1, 4.4, 3.3, 3.4**

### Property 9: A failed completion leaves the verification state untouched

For any injected failure at any statement inside the completion transaction, the row's status, verification status and due date all equal their values before the transaction began.

**Validates: Requirements 4.2**

### Property 10: eSign-origin verification is audit-distinguishable from human verification

For any verification written by an eSign completion, an audit entry exists whose action type identifies the eSign origin and carries the signature mode and provider reference, and that action type is never one written by a human review action.

**Validates: Requirements 4.3, 5.3**

### Property 11: Bulk verification acts on exactly the eligible rows and leaves every other row untouched

For any employee whose checklist rows span the full set of live statuses and signature modes, exactly the rows that are pending upload review, or completed by a verified eSign and not yet verified, end verified with a null due date, and every other row is byte-identical to its pre-state.

**Validates: Requirements 5.1, 5.2**

### Property 12: Bulk verification isolates per-employee failure

For any list of employees and any subset of them whose verification fails, the errors array contains exactly that subset and every employee outside it is verified.

**Validates: Requirements 5.5**

### Property 13: The eSign state classifier is total and disjoint, and unknown values are counted and named

For any checklist status value, including every value in the known status set and any string outside it, the classifier returns exactly one of completed, in progress or not started; for any set of checklist rows the three bucket counts sum to the row count; and for any status outside the known set the row is still counted and exactly one log entry naming that value is emitted per distinct value.

**Validates: Requirements 6.1, 6.2, 6.3, 6.5**

### Property 14: Summary buckets partition the employee set and agree with the row badge

For any list of employees with completion percentages spanning zero to one hundred, each employee is counted in exactly one summary bucket, the bucket counts sum to the number of employees, and each employee's rendered badge names the same bucket the summary counted them in.

**Validates: Requirements 7.1, 7.2, 7.4**

### Property 15: Absent eSign work reads as absent and present eSign work reads as a number

For any employee, the eSign counts are null if and only if that employee has no checklist rows, and are numeric — including legitimately zero — whenever any checklist row exists.

**Validates: Requirements 8.1**

### Property 16: Pagination is a faithful partition of the filtered set

For any filtered employee set, any page size, and the complete sequence of pages walked from the first to the last, the concatenation of the returned pages reproduces the fully ordered filtered set exactly once with no duplicated and no skipped employee, the reported total is identical on every page, and the next-page flag is true on every page except the last — including when many employees share the same date of joining.

**Validates: Requirements 9.1, 9.2, 9.3, 9.5**

### Property 17: The backfill is idempotent

For any set of kits, running the backfill twice leaves the database in the same state as running it once, issues zero provider calls on the second run for every kit the first run closed, and reports those kits as already closed.

**Validates: Requirements 3.8**

### Property 18: A kit the provider reports unsigned is left byte-identical and is evidenced

For any kit the provider reports as not signed, the complete pre-run state of the kit row, its checklist rows, its public tokens and its reminder state equals the post-run state, and exactly one audit entry records that the kit was examined and found unsigned.

**Validates: Requirements 3.5, 12.4**

### Property 19: The backfill report is total over the kits it examined

For any set of selected kits, including kits carrying no real provider reference, the report contains exactly one entry per kit, every entry carries the employee code, dispatch date, provider reference, provider-reported status and a classification, and a kit with no pollable reference is classified as unresolvable rather than raising an error.

**Validates: Requirements 3.6, 3.7**

### Property 20: A backfilled closure is attributable and preserves the provider's completion time

For any kit closed by the backfill, the audit entry carries a backfill-specific action type disjoint from the one a normal completion writes, the operator who triggered the run, and the provider reference the decision was based on; the prior status of the kit and of every member checklist row is retained; and the recorded completion time equals the provider's reported time whenever the provider reported one, with its absence recorded as such rather than presented as the provider's.

**Validates: Requirements 12.1, 12.2, 12.3, 12.5**

### Property 21: The backfill's own call volume is bounded by one status call per kit

For any set of kits and any mix of provider verdicts, a single backfill run makes exactly one status call per kit for which a pollable provider reference exists, no status call at all for a kit already closed or carrying no pollable reference, and a number of document downloads not exceeding the number of kits the provider reported as signed.

**Validates: Requirements 11.5**
