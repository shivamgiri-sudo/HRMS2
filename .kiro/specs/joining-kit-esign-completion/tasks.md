# Implementation Plan: Joining Kit eSign Completion

## Overview

Five code workstreams and one operational rollout, in the order the design's Rollout Order fixes. The write path is corrected first (Workstream 3, 3b), the tracker is made truthful about existing data (Workstream 4), the dormant webhook is hardened (Workstream 1b), and the worker's four observability gaps are closed (Workstream 1) — all with `ESIGN_RECONCILIATION_ENABLED` still `false`. The Backfill_Runner is then built with its Luckpay dependency injected so its bounds are testable without billed calls. Only after the backfill's confirmed run completes does the flag get flipped.

Implementation language is **TypeScript** throughout (backend Node/Express + MySQL, frontend React/TanStack Query), matching the existing codebase.

**Task types are marked**, because several tasks are not code:

- `[CODE]` — writing or modifying source
- `[TEST]` — property, unit, or contract tests
- `[OPERATIONAL]` — performed against the deployed environment or the server; no repository change
- `[DATA CHECK]` — a verification read against production data

**No migration task exists, and none is needed.** The design's Migrations section establishes that every column written already exists (`1042_esign_transaction_poll_state.sql`, `346_employee_joining_document_pack.sql`, `1049_joining_document_esign_kit.sql`) and that the one new *value*, `abandoned_unresolved`, lands in a `VARCHAR` status column with no enum constraint. If implementation discovers a column that is actually absent, stop and raise it rather than adding a migration silently.

## Tasks

- [x] 1. Workstream 3 — completion writes verification state
  - Deploys first: Workstream 2 depends on this (Requirement 3, criterion 4)
  - [x] 1.1 Add the transaction boundary and verification write to `finalizeChecklistEsign`
    - `backend/src/modules/employees/employeeJoiningDocuments.service.ts` (~1923-2132)
    - Wrap exactly three writes in `db.getConnection()` + `beginTransaction` / `commit` / `rollback` / `release`: the checklist `UPDATE`, the transaction-table `UPDATE`, the public-token `UPDATE`
    - Leave `auditDocumentAction`, the payroll-HR inbox notification and `recalculateDocumentProgress` **outside** the boundary
    - Add `verification_status`, `verified_at`, `verification_remarks` and `due_at = NULL` as additional `SET` clauses on the checklist `UPDATE` already there, gated on `signature_mode = 'aadhaar_esign_verified'` — not on `status`, so `aadhaar_esign_pending_artefact` does not qualify
    - Leave `verified_by` NULL; provenance goes in `verification_remarks` and Audit_Log
    - Add optional `completedAt?: Date | null` consumed by `completed_at = COALESCE(?, NOW())`
    - Write the `ESIGN_VERIFICATION_AUTO` audit row with `new_value` `{ verificationSource, signatureMode, providerReferenceId }` and `old_value` `{ status, verification_status, due_at }`
    - _Requirements: 4.1, 4.2, 4.3_
  - [ ]* 1.2 [TEST] Contract test for the transaction boundary
    - `backend/src/modules/employees/__tests__/finalizeChecklistEsign.verificationTransaction.contract.test.ts`
    - Assert the checklist, transaction-table and token writes all sit between `beginTransaction` and `commit` on one connection, and that audit, the inbox block and `recalculateDocumentProgress` sit after `commit`
    - Assert the checklist `UPDATE` sets `verification_status` and `due_at` in the same statement as `status`
    - Required because "same transaction" is unobservable from post-state assertions
    - _Requirements: 4.1_
  - [ ]* 1.3 [TEST] Property test — failed completion leaves verification untouched
    - **Property 9: A failed completion leaves the verification state untouched**
    - **Validates: Requirements 4.2**
  - [x] 1.4 Extend `finalizeKitEsign` with the boundary, verification write, and backfill hooks
    - `backend/src/modules/employees/joiningKitDispatch.service.ts:451`
    - Boundary covers the file-row inserts (:503-521), the per-member checklist `UPDATE`s with their `.catch(() => undefined)` **removed** (:524-532), and the kit, token and transaction updates (:534-553)
    - Keep `assertSignatureInsideReservedArea`, `recalculateDocumentProgress`, `audit(...)` and the fire-and-forget `issueAppointmentLetter` outside, the last one byte-unchanged so `finalizeKitEsign.appointmentLetterTrigger.contract.test.ts` keeps passing
    - Add `completedAt?: Date | null` (every `completed_at = NOW()` becomes `COALESCE(?, NOW())`), `backfill?: { actorUserId: string; providerReferenceId: string }`, and `client?: Pick<typeof luckpayClient, "downloadESignDocument">` defaulting to the real client
    - `backfill` present switches the audit `action_type` from `ESIGN_VERIFICATION_AUTO` to `ESIGN_VERIFICATION_BACKFILL` and carries the operator and provider reference
    - Leave `luckpay-status.service.ts:441-455` unchanged — the `scope='kit'` delegation is already correct
    - _Requirements: 4.4, 3.3, 3.4, 12.1, 12.2, 12.3_
  - [ ]* 1.5 [TEST] Property test — full verified state on every member row
    - `backend/src/modules/employees/__tests__/finalizeKitEsign.verification.test.ts`
    - **Property 8: eSign completion writes the full verified state on every affected row**
    - **Validates: Requirements 4.1, 4.4, 3.3, 3.4**
  - [ ]* 1.6 [TEST] Property test — eSign verification is audit-distinguishable
    - **Property 10: eSign-origin verification is audit-distinguishable from human verification**
    - **Validates: Requirements 4.3, 5.3**

- [x] 2. Workstream 3b — bulk verification reaches eSigned rows
  - [x] 2.1 Split the bulk-verify `UPDATE` by provenance
    - `backend/src/modules/ats/ats.joiningDocumentsTracker.service.ts:573`, inside the existing per-employee transaction
    - Uploaded rows: existing behaviour plus `due_at = NULL`, `verified_by` set
    - eSigned rows: `status = 'esign_completed'` AND `signature_mode = 'aadhaar_esign_verified'` AND `verification_status IS NULL` → set `verification_status`, `verified_at`, `verification_remarks`, `due_at = NULL`; do **not** move `status`, and leave `verified_by` NULL
    - Write `BULK_VERIFY_ESIGNED` for eSigned rows, `BULK_VERIFY` unchanged for uploaded rows
    - Leave the `recalcNeeded` deferral (:587, :607-615) and the per-employee try/catch (:591-604) untouched
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [ ]* 2.2 [TEST] Property test — bulk verify acts on exactly the eligible rows
    - **Property 11: Bulk verification acts on exactly the eligible rows and leaves every other row untouched**
    - **Validates: Requirements 5.1, 5.2**
  - [ ]* 2.3 [TEST] Property test — per-employee failure isolation
    - **Property 12: Bulk verification isolates per-employee failure**
    - **Validates: Requirements 5.5**
  - [ ]* 2.4 [TEST] Contract test — overdue predicate and recalculation deferral unchanged
    - `backend/src/modules/ats/__tests__/trackerOverduePredicate.contract.test.ts`
    - Assert `due_at < NOW() AND verification_status IS NULL` is present verbatim, and that `bulkVerifyDocuments` writes no `joining_document_completion_pct` and still calls `recalculateDocumentProgress`
    - _Requirements: 4.6, 5.4_

- [x] 3. Workstream 4 — the tracker
  - [x] 3.1 Create the shared eSign state classifier
    - `backend/src/modules/ats/esignState.ts` (new, leaf module, imports nothing)
    - Export `EsignBucket`, `ESIGN_STATE_BUCKET` as the design declares it, `classifyEsignState` (total; unknown → `"not_started"`, logged once per distinct value per process via a module-level `Set`), and `esignBucketCaseSql(column)` generating the SQL `CASE` from the same table
    - _Requirements: 6.1, 6.2, 6.3, 6.5_
  - [ ]* 3.2 [TEST] Property test — classifier totality, disjointness, unknown-value logging
    - `backend/src/modules/ats/__tests__/esignState.test.ts`
    - **Property 13: The eSign state classifier is total and disjoint, and unknown values are counted and named**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.5**
  - [ ]* 3.3 [TEST] Contract test — classifier covers the allow-list, SQL has no inline literals
    - `backend/src/modules/ats/__tests__/esignStateClassifierCoverage.contract.test.ts`
    - Assert every member of `ALLOWED_CHECKLIST_STATUSES` (`employeeJoiningDocuments.service.ts:89-107`) has a key in `ESIGN_STATE_BUCKET`, and the tracker SQL contains no inline status literal — only the generated `CASE`
    - Anti-drift: adding a status to the allow-list without classifying it fails the build
    - _Requirements: 6.1, 6.3_
  - [x] 3.4 Create the frontend mirror and complete `STATUS_COLORS`
    - `src/lib/esignState.ts` (new) — re-declare `EsignBucket` and export a bucket→colour map; no status knowledge, the API sends the bucket
    - Complete `STATUS_COLORS` in `src/pages/EmployeeJoiningDocumentsPage.tsx:71-86` from the mirror so Employee_Documents_Page renders a status indication for every live Esign_State rather than leaving one unstyled, with its vocabulary derived from the mirror of Esign_State_Authority rather than an independently maintained list
    - _Requirements: 6.1, 6.6, 6.7_
  - [x] 3.5 [TEST] Contract test — frontend mirror key-set parity
    - `esignStateMirror.contract.test.ts`
    - Compare the bucket key sets declared in `src/lib/esignState.ts` and `backend/src/modules/ats/esignState.ts`; assert `STATUS_COLORS` covers every bucket. No shared import is possible (`@` aliases to `./src` only), so the agreement is pinned rather than assumed
    - The `STATUS_COLORS`-covers-every-bucket assertion is what makes 6.8's Build_Check failure real: a status added to Esign_State_Authority without a presentation classification fails here and is named, so it cannot reach merge unclassified
    - Non-optional: it is the only coverage for 6.8, which is a build-gate requirement rather than a nice-to-have
    - _Requirements: 6.7, 6.8_
  - [x] 3.6 Partition the summary buckets
    - `backend/src/modules/ats/ats.joiningDocumentsTracker.service.ts:98-145`
    - Export `SummaryBucket` and `classifyEmployeeBucket(pct)`; have `calculateTrackerSummary` call it in its loop instead of inlining thresholds, keeping its signature as the exported pure function
    - Remove `pending_verification` from `TrackerSummary`; surface `pending_count`. Keep `overdue_count` and `needs_correction` as cross-cutting counts outside the partition
    - _Requirements: 7.1, 7.2_
  - [ ]* 3.7 [TEST] Property test — summary partition and badge agreement
    - `backend/src/modules/ats/__tests__/trackerSummary.test.ts`
    - **Property 14: Summary buckets partition the employee set and agree with the row badge**
    - Include the 75 and 99 boundaries and a 309-employee fixture
    - **Validates: Requirements 7.1, 7.2, 7.4, 7.3**
  - [x] 3.8 Rebuild the tracker row query on the classifier, with null-vs-zero counts
    - Build the `FROM … WHERE ${whereSQL} GROUP BY e.id ${havingClause}` text once into a single `const`
    - Replace the inline three-state counters (:296-297) with `esignBucketCaseSql('c.status')`
    - Produce null in exactly one place: `CASE WHEN COUNT(c.id) = 0 THEN NULL ELSE …` for `esign_completed_count` and `esign_pending_count`; the mapper (:333-334) drops `Number(row.x ?? 0)` for `row.x === null ? null : Number(row.x)`
    - Declare `esign_completed_count: number | null` and `esign_pending_count: number | null` on `EmployeeDocumentRow`; every other count field keeps its current non-null type
    - _Requirements: 6.4, 8.1, 8.3_
  - [ ]* 3.9 [TEST] Property test — null iff no checklist rows
    - `backend/src/modules/ats/__tests__/trackerNullCounts.test.ts`
    - **Property 15: Absent eSign work reads as absent and present eSign work reads as a number**
    - **Validates: Requirements 8.1**
  - [x] 3.10 Implement real pagination and a page-independent summary
    - Add `page` (default 1, min 1) and `limit` (default 50, min 1, max 200) to `TrackerQueryParams`; bind `LIMIT ? OFFSET ?` rather than interpolating; drop the hard-coded `LIMIT 500`
    - Add `COUNT(*) OVER () AS total_matching` to the row query and `ORDER BY e.date_of_joining DESC, e.employee_code ASC, e.id ASC`
    - Add the wrapped-count fallback over the identical grouped subquery, issued **only** when `rows.length === 0 && page > 1`
    - Compute the summary from a second aggregate query over the same shared text, with its percentage bands generated from `classifyEmployeeBucket`'s thresholds, so the tiles describe the whole filtered set
    - Return the page echo and `hasNext` / `hasPrev` on `TrackerResponse`
    - _Requirements: 9.1, 9.2, 9.3, 9.5, 7.3_
  - [x] 3.11 Pass `page` and `limit` through the route
    - `backend/src/modules/ats/ats.joiningDocumentsTracker.routes.ts:33-44` — parse and clamp both, forward to the service
    - _Requirements: 9.1_
  - [ ]* 3.12 [TEST] Property test — pagination is a faithful partition
    - `backend/src/modules/ats/__tests__/trackerPagination.test.ts`
    - **Property 16: Pagination is a faithful partition of the filtered set**
    - Include colliding `date_of_joining` values, since that is what makes the tiebreak load-bearing
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.5**
  - [ ]* 3.13 [TEST] Contract test — count-field nullability parity
    - `trackerTypeParity.contract.test.ts`
    - Compare nullability of every count field between `EmployeeDocumentRow` (service) and `EmployeeRow` (`JoiningDocumentsTrackerPage.tsx:37-38`)
    - _Requirements: 8.3_
  - [x] 3.14 Update the tracker page's tiles, badge and dash rendering
    - `src/pages/JoiningDocumentsTrackerPage.tsx`
    - Tile row goes four to five — Total, Completed, In Progress, **Pending**, Overdue — and `grid-cols-4` becomes `grid-cols-5` at `lg`
    - `StatusBadge` keeps its three variants and markup; change only what it reads, from `row.joining_document_status` to `classifyEmployeeBucket(row.joining_document_completion_pct)`
    - Keep the existing null-aware eSign badge render (dash when either count is null)
    - Reset to page 1 when a filter or search term changes
    - Remove the unused `rowIds` memo (:117)
    - _Requirements: 7.3, 7.4, 8.2, 9.4_
  - [x] 3.15 Make corrected data visible without a manual refresh
    - Query key becomes `["joining-documents-tracker", { search, statusFilter, overdueOnly, page, limit }]`
    - Replace the five local `refetch()` calls (:128, 139, 152, 172, 184) with `queryClient.invalidateQueries({ queryKey: ["joining-documents-tracker"] })` in every bulk mutation's `onSuccess` — prefix invalidation, so every cached page refreshes
    - Add `refetchInterval: 60_000`, `refetchIntervalInBackground: false`, `placeholderData: keepPreviousData`
    - Do not clear `selectedIds` on data arrival
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [x] 4. Workstream 1b — harden and document the dormant webhook route
  - Hardening and documentation, not a repair: the route is dormant because Luckpay was never given a callback URL
  - [x] 4.1 Add `classifyLuckpayWebhookAuth`
    - `backend/src/modules/employees/employeeCompliancePrivacy.ts`
    - Export the four-arm `WebhookAuthOutcome` union and the classifier, with the decision order part of the contract: `secret_not_configured` first, then `header_absent`, then `header_mismatch`, then `accepted`
    - Keep `verifyLuckpayWebhookSecret(provided, configured): boolean` at its current signature, reimplemented as `classifyLuckpayWebhookAuth(...).ok`
    - _Requirements: 2.2, 2.3, 2.4_
  - [ ]* 4.2 [TEST] Property test — rejection classification is total and disjoint
    - Extend `backend/tests/employeeCompliancePrivacy.test.ts`
    - **Property 6: Webhook rejection classification is total and disjoint**
    - Cover undefined, empty and whitespace-only values; leave the existing `verifyLuckpayWebhookSecret` assertions unchanged
    - **Validates: Requirements 2.2, 2.3, 2.4**
  - [x] 4.3 Consume the outcome at both route call sites
    - `backend/src/modules/employees/employee.compliance.routes.ts:1238-1244` (public) and `:475-479` (authenticated)
    - Map reason → log level and audit `action_type`: `secret_not_configured` → `console.error` naming `LUCKPAY_WEBHOOK_SECRET` + `LUCKPAY_WEBHOOK_REJECTED_UNCONFIGURED`; `header_mismatch` → `console.warn` + `_MISMATCH`; `header_absent` → `console.info` + `_NO_HEADER`
    - HTTP status and body stay 401 and unchanged for all three, so a probe cannot read configuration state off the response
    - Resolve `employee_id` for the audit row from the payload's `client_transaction_id`; when it cannot be resolved, **skip** the audit write with a `console.error` rather than attempting and swallowing it (`employee_joining_document_audit_log.employee_id` is `NOT NULL`)
    - Keep the accepted path routed through the same completion path as the pull path
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [x] 4.4 Add the dormancy comment and callback URL
    - Immediately above `publicEmployeeDocumentRouter.post("/esign/webhook/luckpay", ...)`
    - State that the route is dormant because the Luckpay client registers no callback URL, that the pull path in `esign-reconciliation.worker.ts` is the source of truth, and record `https://mcnhrms.teammas.in/api/public/employee-documents/esign/webhook/luckpay`
    - _Requirements: 2.6_
  - [ ]* 4.5 [TEST] Contract test — dormancy comment, route path, rejection branches
    - `luckpayWebhookDormancy.contract.test.ts`
    - Assert the comment and absolute URL sit above the route, the route path literal is unchanged, and the three rejection branches each log and audit distinguishably
    - _Requirements: 2.1, 2.6_
  - [ ]* 4.6 [TEST] Contract test — one completion writer for both paths
    - `esignCompletionSingleWriter.contract.test.ts`
    - Assert neither `handleJoiningDocumentEsignWebhook` nor `syncEsignStatus` contains its own `UPDATE … SET status = 'esign_completed'` for a kit-scope transaction; both delegate
    - **Property 7: A pushed completion and a pulled completion converge on the same writer**
    - **Validates: Requirements 2.5**
  - [ ]* 4.7 [TEST] Contract test — the startup guard survives
    - `env.luckpayWebhookGuard.contract.test.ts`
    - Assert the `LUCKPAY_PROVIDER_ENABLED === "true" && !LUCKPAY_WEBHOOK_SECRET` guard and its `process.exit(1)` still exist at `backend/src/config/env.ts:379-382`
    - _Requirements: 2.8_

- [x] 5. Workstream 1 — close the worker's four observability gaps
  - Code only; `ESIGN_RECONCILIATION_ENABLED` stays `false` until task 9.6. Do not alter `BACKOFF_MINUTES`, `TICK_MS`, `BATCH_SIZE`, `GIVE_UP_AFTER_DAYS`, `nextDelayMinutes`, `claimBatch` or the `running` overlap guard
  - [x] 5.1 Gap 1 — increment `poll_attempts` on the success path
    - `backend/src/workers/esign-reconciliation.worker.ts:72-79` — `clearSchedule(id, attempts)` gains the parameter and writes `poll_attempts = ?` alongside the existing `last_polled_at = NOW()` and `next_poll_at = NULL`
    - Makes a first-poll completion distinguishable from never-polled, and `SUM(poll_attempts)` an honest billing figure
    - _Requirements: 1.4, 11.1, 11.6_
  - [x] 5.2 Gap 2 — emit the tick log line unconditionally with the enabled state
    - Replace the `if (rows.length)` guard at :116-120 with an unconditional line naming the enabled state, the selected count, and the completed / pending / error / provider-call counts
    - _Requirements: 1.5_
  - [x] 5.3 Gap 3 — record poll failures against the transaction
    - Add `recordPollFailure(id, attempts, message)` folding the failure text into the same `UPDATE` that `scheduleNext` already issues — one statement, so a failure cannot be recorded without also being rescheduled — writing `error_message`, `poll_attempts`, `last_polled_at = NOW()` and the next ladder step
    - Call it from the catch block (:104-114); keep the batch processing the remaining transactions
    - _Requirements: 1.6_
  - [x] 5.4 Gap 4 — add `sweepAbandoned()` and extend `TERMINAL`
    - Run `sweepAbandoned()` first in each tick, before `claimBatch`; transition every non-terminal `luckpay` transaction older than `GIVE_UP_AFTER_DAYS` to `status = 'abandoned_unresolved'` with an explanatory `error_message` and `next_poll_at = NULL`, guarded by `status NOT IN (<TERMINAL>, 'abandoned_unresolved')` so it is idempotent by construction
    - Write one Audit_Log row per transition via the existing `auditDocumentAction` path; return the transitioned count
    - Add `abandoned_unresolved` to `TERMINAL` — no DDL, the column is `VARCHAR`
    - _Requirements: 1.7, 11.4_
  - [x] 5.5 Expose the provider-call counter
    - `runEsignReconciliationOnce()` returns `{ examined, completed, pending, errors, providerCalls: { status, download } }`; the tick log line carries it
    - Call `downloadESignDocument` only for a transaction the provider reported signed
    - Do not route these calls through `candidate_bgv_api_request_log` — `writeBgvApiLog` requires a `candidateId` a kit transaction may not have
    - _Requirements: 11.1, 11.2, 11.3, 11.6_
  - [ ]* 5.6 [TEST] Property tests for the worker
    - `backend/src/workers/__tests__/esignReconciliation.test.ts`
    - **Property 1: The backoff ladder is a total, non-decreasing schedule whose final interval repeats**
    - **Property 2: Every poll advances the poll counter exactly once**
    - **Property 3: A batch survives per-transaction failure**
    - **Property 4: Nothing outside the give-up window is selected, and abandonment is recorded exactly once**
    - **Property 5: Provider call volume is bounded by the schedule** (against a counting mock)
    - **Validates: Requirements 1.2, 1.4, 1.6, 1.7, 11.1, 11.2, 11.3, 11.4**
  - [x] 5.7 [TEST] Contract test — polling budget and kit delegation
    - `esignReconciliationBudget.contract.test.ts`
    - Assert `BACKOFF_MINUTES`, `TICK_MS`, `BATCH_SIZE`, `GIVE_UP_AFTER_DAYS` unchanged, and that the `scope === 'kit'` delegation to `finalizeKitEsign` precedes the per-document download block in `luckpay-status.service.ts`
    - Non-optional: Requirement 1 criterion 3 (kit-scope delegation) is satisfied entirely by existing unchanged code, so this test is its **only** coverage — left optional, the mechanism that closes all six documents of a kit under one signature could regress unnoticed. It also carries R11.2's polling-budget ceiling, the guard against per-call billing running away
    - _Requirements: 1.2, 1.3, 11.2_
  - [ ]* 5.8 [TEST] Contract test — worker registration and flag source
    - `esignReconciliationRegistration.contract.test.ts`
    - Assert `startEsignReconciliationWorker` is registered in `all-workers.ts` and the flag is read from `env.ts`. This registration being single-file is the reason a flag on the API process would do nothing — do **not** add a registration in `server.ts`
    - _Requirements: 1.1_

- [x] 6. Checkpoint — code for rollout steps 1 and 2 is complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Workstream 2 — the Backfill_Runner
  - [x] 7.1 Create the script with its Luckpay dependency injected
    - `backend/scripts/backfill-stranded-joining-kits.ts` (new)
    - Export `runBackfill(deps: { client: Pick<typeof luckpayClient, "checkESignStatus" | "downloadESignDocument">; db: Pool; actorUserId: string; confirm: boolean }): Promise<BackfillReport>` — injection first, not retrofitted, because it is what makes Properties 17-21 testable without billed calls
    - `main()` supplies the real client and threads it into `finalizeKitEsign`'s optional `client` so the mock covers the internal download too
    - CLI: `--actor-user-id <ID>` (refuse to start without it), `[--kit-id <ID>...]`, `[--report ./backfill-report.csv]`, `[--confirm]`; dry-run by default
    - Register `"backfill:stranded-kits": "tsx scripts/backfill-stranded-joining-kits.ts"` in `backend/package.json`
    - Declare `KitClassification`, `BackfillReportEntry`, `BackfillReport`
    - _Requirements: 3.1, 11.5_
  - [x] 7.2 Implement the selection query
    - Select Stranded_Kits directly, not through `claimBatch` — whose 30-day window already excludes MAS47814
    - `k.status = 'sent' AND k.signed_file_id IS NULL AND k.sent_at >= '2026-08-01' AND k.sent_at < '2026-08-27'`, joined to `employees` and `LEFT JOIN` the kit-scope `luckpay` transaction
    - `ORDER BY k.sent_at ASC`, so MAS47814 is first and an interrupted run has resolved the most urgent kits
    - _Requirements: 3.1, 3.2_
  - [x] 7.3 Implement the per-kit decision tree and its three idempotence layers
    - No transaction row, or `provider_reference_id` NULL / not matching `^APIB` → `unresolvable_no_provider_reference`, no provider call, not an error
    - Kit already `signed` or `signed_file_id` set → `already_closed`, no provider call
    - Otherwise exactly one `checkESignStatus`: signed → `finalizeKitEsign(...)` → `closed`; anything else → zero writes to kit, checklist, token and reminders → `left_untouched`
    - Catch per kit: classify `error` with the message and continue with the remaining kits
    - _Requirements: 3.3, 3.4, 3.5, 3.7, 3.8_
  - [x] 7.4 Preserve the provider's completion time and write attribution
    - Extractor reading the first present of `esignDetails.signed_at`, `esignDetails.completed_at`, `signedAt`, `completedAt` out of `status.sanitized`; pass it as `completedAt`
    - When the provider reports no timestamp, use the run time and record `completedAtSource: 'backfill_run_time'` rather than `'provider'`
    - `ESIGN_VERIFICATION_BACKFILL` on closure carrying the operator and provider reference; `ESIGN_BACKFILL_EXAMINED_UNSIGNED` for a kit left untouched; `old_value` retains the pre-backfill status of the kit and every member checklist row
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_
  - [x] 7.5 Produce the report
    - One row per selected kit — including kits no provider call was made for — with employee code, dispatch date, provider reference, provider-reported status, classification, documents closed, note; CSV to `--report` and a table to stdout, plus a trailing tally by classification and the provider-call counts
    - _Requirements: 3.6, 3.7_
  - [ ]* 7.6 [TEST] Property tests for the runner against a counting fake
    - `backend/scripts/__tests__/backfillStrandedKits.test.ts`
    - **Property 17: The backfill is idempotent**
    - **Property 18: A kit the provider reports unsigned is left byte-identical and is evidenced**
    - **Property 19: The backfill report is total over the kits it examined**
    - **Property 20: A backfilled closure is attributable and preserves the provider's completion time**
    - **Property 21: The backfill's own call volume is bounded by one status call per kit**
    - **Validates: Requirements 3.5, 3.6, 3.7, 3.8, 11.5, 12.1, 12.2, 12.3, 12.4, 12.5**

- [x] 8. Checkpoint — all code complete, flag still false
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Rollout — operational steps, in this order
  - The order below is the design's Rollout Order. **9.5 must precede 9.6.** `GIVE_UP_AFTER_DAYS` is measured from `initiated_at`, not from when the worker started, so enabling the worker first neither resolves MAS47814 nor buys time — `claimBatch` would already have excluded a 2026-08-01 transaction, and the abandonment sweep would write 26 `abandoned_unresolved` rows on the first tick
  - [~] 9.1 [OPERATIONAL] Record the `LUCKPAY_WEBHOOK_SECRET` confirmation in the Deployment_Checklist
    - Confirm operationally that `LUCKPAY_WEBHOOK_SECRET` is set in the production environment and record it in the Deployment_Checklist
    - Not reachable from any test: the value is absent from `org_settings` and from the repository, so it exists only in the deployed environment. Its presence is currently *inferred* from the startup guard not having fired — this task replaces the inference with a check
    - _Requirements: 2.7_
  - [~] 9.2 [OPERATIONAL] Deploy tasks 1-5 with `ESIGN_RECONCILIATION_ENABLED` still `false`
    - The write path becomes correct and the tracker becomes truthful about existing data before anything new is written
    - Confirm the flag is still `false` in the deployed `backend/.env` after the deploy
    - _Requirements: 4.1, 5.1, 6.1, 7.1, 9.1, 10.1, 2.1_
  - [~] 9.3 [DATA CHECK] Verify on MAS63411 using the now-eSign-aware bulk verify
    - Its 5 `esign_completed` rows already carry `signature_mode = 'aadhaar_esign_verified'` and `completed_at`, but `verification_status` is NULL on all 9 — they are *past* completions, so the forward write does not reach them
    - Clear them with bulk-verify from the tracker (task 2.1), then confirm `verified_count = 5`, `overdue_count = 4`, and an eSign denominator of 9
    - Requires no provider call. This is the acceptance test for 9.2
    - _Requirements: 4.5, 6.4_
  - [~] 9.4 [OPERATIONAL] Backfill dry run on the server
    - `npx tsx scripts/backfill-stranded-joining-kits.ts --actor-user-id <ID>` without `--confirm`, from `/var/www/HRMS2/backend`
    - Must run on the server: Luckpay accepts only the deployment's egress IP
    - 26 status calls, zero writes. Its value is answering how many of the 26 Luckpay actually reports signed, before any write — the design tolerates any answer, including zero
    - Retain the report
    - _Requirements: 3.6, 11.5_
  - [~] 9.5 [OPERATIONAL] Backfill confirmed run — **on or before 2026-08-31**
    - Same command with `--confirm`, ordered `sent_at ASC` so MAS47814 (dispatched 2026-08-01) is processed first
    - This is the only step that resolves MAS47814. If the window closes, the kit is unrecoverable by polling and would need a manual re-dispatch, which decision 3 did not authorise
    - Retain the report and confirm the audit rows distinguish backfilled closures from normal completions
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 12.1_
  - [~] 9.6 [OPERATIONAL] Flip the flag on the workers process and restart it
    - Set `ESIGN_RECONCILIATION_ENABLED=true` in the deployed `backend/.env`. Configuration only — no code change, no workflow edit
    - Restart **`hrms2-workers`**. `startEsignReconciliationWorker` is registered only at `all-workers.ts:281` and never in `server.ts`, so setting the flag on the API process does nothing
    - Confirm from the first tick's log line that it reports `enabled=true` and a selected count, and that `last_polled_at` is non-NULL and `poll_attempts` non-zero across the transaction table — the observable that has been NULL and 0 on all 48 transactions to date
    - Do not perform this before 9.5
    - _Requirements: 1.1, 1.4, 1.5_

- [~] 10. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP. Two test tasks are deliberately **not** marked optional: 3.5, the only coverage for Requirement 6 criterion 8's Build_Check gate, and 5.7, the only coverage for Requirement 1 criterion 3's kit-scope delegation and Requirement 11 criterion 2's polling-budget ceiling
- `[CODE]` is the default; `[TEST]`, `[OPERATIONAL]` and `[DATA CHECK]` are marked explicitly. Tasks 9.1-9.6 are the only non-code tasks, and 9.1, 9.2, 9.4, 9.5 and 9.6 act on the deployed environment rather than the repository
- **No migration task.** The design's Migrations section establishes none is needed — every column already exists and `abandoned_unresolved` lands in an unconstrained `VARCHAR`. Raise it rather than adding one silently if implementation finds otherwise
- Out of scope, deliberately: re-sending or expiring unsigned kits (decision 3), changing the overdue predicate (Requirement 4 criterion 6), altering the Backoff_Ladder constants, registering the worker in `server.ts`, and the 5 blocked kits (`draft_missing` 1, `feature_disabled` 1, `payroll_head_not_approved` 3), which are not Stranded_Kits
- `luckpay-status.service.ts` gets **no change** — the `scope='kit'` branch at :441-455 is already correct
- Property tests run a minimum of 100 iterations and each carries the tag `Feature: joining-kit-esign-completion, Property {number}: {property text}` in its title
- The three anti-drift contract tests (3.3, 3.5, 3.13) are what keep the classifier, its frontend mirror and the count-field nullability from separating again — 3.5 is non-optional because it is the Build_Check that names an unclassified status; 1.2 is the only way to observe "same transaction"

## Requirements Coverage

| Requirement | Tasks |
|---|---|
| 1 — the pull path runs | 5.1, 5.2, 5.3, 5.4, 5.5, 5.6*, 5.7, 5.8*, 9.6 |
| 2 — webhook hardened and documented | 4.1, 4.2*, 4.3, 4.4, 4.5*, 4.6*, 4.7*, 9.1 |
| 3 — 26 stranded kits resolved | 1.4 (3.3, 3.4 — the verification write the runner reuses), 7.1, 7.2, 7.3, 7.5, 7.6*, 9.4, 9.5 |
| 4 — completion writes verification state | 1.1, 1.2*, 1.3*, 1.4, 1.5*, 1.6*, 2.4*, 9.3 |
| 5 — bulk verification reaches eSigned rows | 2.1, 2.2*, 2.3*, 2.4* |
| 6 — every surface recognises every live eSign state (Tracker_Service **and** Employee_Documents_Page) | 3.1, 3.2*, 3.3*, 3.4, 3.5, 3.8, 9.3 |
| 7 — tiles agree with rows | 3.6, 3.7*, 3.10, 3.14 |
| 8 — absent reads as absent | 3.8, 3.9*, 3.13*, 3.14 |
| 9 — pagination is real | 3.10, 3.11, 3.12*, 3.14 |
| 10 — visible without manual refresh | 3.15 |
| 11 — provider spend inside budget | 5.1, 5.5, 5.6*, 5.7, 7.1, 7.6*, 9.4 |
| 12 — backfilled signatures attributable | 1.4, 7.4, 7.6*, 9.5 |

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.4", "3.1", "4.1", "5.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.5", "1.6", "2.1", "3.2", "3.3", "3.4", "4.2", "4.3", "5.2"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "3.5", "3.6", "4.4", "5.3"] },
    { "id": 3, "tasks": ["3.7", "3.8", "4.5", "4.6", "4.7", "5.4"] },
    { "id": 4, "tasks": ["3.9", "3.10", "5.5"] },
    { "id": 5, "tasks": ["3.11", "3.12", "3.13", "3.14", "5.6", "5.7", "5.8"] },
    { "id": 6, "tasks": ["3.15", "7.1"] },
    { "id": 7, "tasks": ["7.2"] },
    { "id": 8, "tasks": ["7.3"] },
    { "id": 9, "tasks": ["7.4"] },
    { "id": 10, "tasks": ["7.5"] },
    { "id": 11, "tasks": ["7.6"] },
    { "id": 12, "tasks": ["9.1", "9.2"] },
    { "id": 13, "tasks": ["9.3"] },
    { "id": 14, "tasks": ["9.4"] },
    { "id": 15, "tasks": ["9.5"] },
    { "id": 16, "tasks": ["9.6"] }
  ]
}
```
