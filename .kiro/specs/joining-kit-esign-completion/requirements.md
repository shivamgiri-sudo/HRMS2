# Requirements Document

## Introduction

Joining kits are dispatched to candidates for Aadhaar eSign through Luckpay. The dispatch side works — kits are created, links are generated, candidates open them, and Luckpay signs them. Completion is pull-only by provider design, and the single pull mechanism is switched off, so nothing on the HRMS side ever learns that a signature happened; and even when it does learn, the completion is not recorded as verification. The result is 26 kits stuck at `sent`/`PENDING` with `signed_file_id` NULL, 215 checklist rows stranded at `esign_initiated`/`pending_candidate_esign` for an average of 18 days (worst 57), and a tracker screen that reports figures contradicting both the database and itself.

The disabled pull path is the single root cause of the stuck data. The webhook route is not a co-equal cause: it is dormant because Luckpay was never told where to push, not because it is misconfigured.

> **Premise corrected during requirements.** An earlier draft asserted that the Luckpay webhook route was "sealed shut because `LUCKPAY_WEBHOOK_SECRET` is unset". That was read off the local dev file `backend/.env` and is false for production. The startup guard at `backend/src/config/env.ts:379-382` exits the process when `LUCKPAY_PROVIDER_ENABLED === "true"` and the secret is missing; production demonstrably runs with the provider flag true (26 kits carry genuine `APIB…` provider references, and no kit anywhere carries `blocked_reason='provider_disabled'`) and did not exit at boot, so the secret is configured in production. The design phase MUST NOT reintroduce the sealed-webhook premise.

This spec covers four workstreams and nothing beyond them:

1. Enable and validate the pull path — the reconciliation worker flag, plus hardening, instrumenting and documenting the dormant webhook route.
2. Backfill the 26 stranded kits and 215 stranded checklist rows, report-only for unsigned kits, completed before the 30-day give-up window closes.
3. Make eSign completion write verification state, and extend bulk verification to act on eSigned rows.
4. Correct the joining documents tracker and the per-employee joining documents page: recognise all live eSign states on both surfaces, fix summary bucketing, distinguish null from zero, implement real pagination, and refresh on data change.

### Verified root causes, treated as fixed context

**A. Luckpay never pushes completion, and the one pull mechanism is switched off.** This is the single sufficient explanation for the stuck data, and the evidence for it stands independently of anything about the webhook secret.

`eSignWithURL` only starts a provider-hosted flow and hands back a redirect URL. The Luckpay client registers no callback, notify, or return URL anywhere — the only URL fields it touches are read out of provider *responses* (`redirect_url`, `sign_url`, `verificationUrl` in `luckpay.client.ts`), never sent in a request — so the provider has never been told where to report back. The header of `backend/src/modules/integrations/luckpay/luckpay-status.service.ts` states that completion is pull-based on purpose.

The single pull mechanism is the reconciliation worker (`backend/src/workers/esign-reconciliation.worker.ts`), which self-disables on a default-false flag (`backend/src/config/env.ts:197,414`) and has never run: `last_polled_at` is NULL and `poll_attempts` is 0 across all 48 transactions. Luckpay credentials themselves are valid in `org_settings`.

The zero webhook events in the audit log therefore reflect a provider that does not push, not an endpoint that rejects.

**A1. The webhook route is dormant by provider design, not sealed by misconfiguration.** `LUCKPAY_WEBHOOK_SECRET` **is** configured in production. The startup guard at `backend/src/config/env.ts:379-382` logs `[FATAL]` and calls `process.exit(1)` when `LUCKPAY_PROVIDER_ENABLED === "true"` and the secret is missing. Production demonstrably runs with `LUCKPAY_PROVIDER_ENABLED=true`: 26 kits were dispatched with genuine `APIB…` provider references, and `joiningKitDispatch.service.ts` blocks a kit with `blocked_reason='provider_disabled'` whenever that flag is false — yet `employee_joining_esign_kit` holds no `provider_disabled` block at all, only `draft_missing` (1), `feature_disabled` (1, from the separate `JOINING_KIT_ESIGN_ENABLED` flag) and `payroll_head_not_approved` (3). A backend running with the provider flag true that did not exit at boot has the secret set.

The live probe returning HTTP 401 is the correct and expected response to a request carrying no secret header: `verifyLuckpayWebhookSecret` (`backend/src/modules/employees/employeeCompliancePrivacy.ts:108-111`) returns false both when the configured secret is absent and when the provided header does not match it. The 401 is not evidence of misconfiguration.

Two observations about the secret remain true and are recorded as local-dev and configuration-visibility facts rather than as the production defect: `LUCKPAY_WEBHOOK_SECRET` is absent from the local `backend/.env`, so the webhook cannot be exercised in local development; and it is absent from `org_settings`, so it lives only in the deployed environment. Because of that, **its production value is not verifiable from the repository or the database** — confirming it requires an operational check against the deployed environment (see Requirement 2, criterion 7).

**B. Completion does not satisfy verification.** `finalizeChecklistEsign` (`backend/src/modules/employees/employeeJoiningDocuments.service.ts`, ~1930-2130) sets `status`, `fill_status`, `signature_mode` and `final_file_locked_at`, but never sets `verification_status` and never clears `due_at`. The tracker computes `verified_count` from `verification_status = 'verified'` and `overdue_count` from `due_at < NOW() AND verification_status IS NULL` (`backend/src/modules/ats/ats.joiningDocumentsTracker.service.ts:293-297`). Proven on MAS63411: 5 documents at `esign_completed` with `signature_mode = 'aadhaar_esign_verified'` and `completed_at` set, `verification_status` NULL on all 9, so the UI shows "E-Sign 5/5" beside "Documents 0/9" and "Overdue 9". `bulkVerifyDocuments` (~541-616) matches only `status = 'uploaded_pending_review'`, so it can never act on an eSigned row.

**C. Tracker query and summary blind spots.** The eSign counters recognise only `esign_completed`, `esign_initiated` and `pending_candidate_esign`; live data also holds `ready_for_esign`, `employee_review_pending`, `draft_generated`, `hr_fill_required`, `esign_failed` and `correction_requested`. Unrecognised states leave the denominator entirely, so MAS63411 reads a green "5/5" while 4 of its 9 documents are unsigned. `calculateTrackerSummary` (lines 98-145) buckets 75–99% into `pending_verification`, which `src/pages/JoiningDocumentsTrackerPage.tsx` never renders — live tiles read Total 309, Completed 0, In Progress 0 while row badges say "In Progress". The service coerces null to 0 (lines 333-334) while the frontend types the counts `number | null`, so an employee with no eSign documents gets a green `0/0` badge instead of `-`. Pagination is cosmetic: the page sends `page` and `limit`, the service ignores both, hard-codes `LIMIT 500`, and returns `total = rows.length`, so `hasNext` is always false. There is no `refetchInterval` and no query-key invalidation, so correct database updates stay invisible until a manual Refresh.

### Decisions settled in clarify, treated as binding

1. **Auto-verify.** A verified Aadhaar eSign satisfies HR document verification. There is no human review step and no new intermediate state. The same rule applies to backfilled rows.
2. **Polling as built, plus one authorised bulk run.** The existing backoff ladder is unchanged. A separate manually-triggered bulk reconciliation of the 26 stranded kits is authorised.
3. **Unsigned kits are left alone and reported.** No automatic re-send, no automatic expiry, no candidate-facing side effect.
4. **The dormant webhook route is kept, hardened and documented as dormant-by-provider-design.** It is not being repaired, because it is not broken; it is unused because Luckpay was never given a callback URL. The pull path remains the source of truth.
5. **The overdue predicate needs no change.** Once signed documents become `verified` with `due_at` cleared, `due_at < NOW() AND verification_status IS NULL` already excludes them.

## Glossary

- **Esign_Worker**: the background worker in `backend/src/workers/esign-reconciliation.worker.ts` that polls Luckpay for transactions the provider never pushed.
- **Backoff_Ladder**: the fixed retry schedule already implemented in Esign_Worker — 2 minutes, then 10 minutes, 30 minutes, 2 hours, 6 hours, 24 hours — with `TICK_MS` 5 minutes, `BATCH_SIZE` 25 and `GIVE_UP_AFTER_DAYS` 30.
- **Status_Service**: `luckpay-status.service.ts`, whose `syncEsignStatus` (lines 441-455) branches on `scope = 'kit'` and delegates to Kit_Finalizer.
- **Kit_Finalizer**: `finalizeKitEsign` in `backend/src/modules/employees/joiningKitDispatch.service.ts:451`, which closes every member checklist of a kit, sets the kit to `signed`, clears `open_marker` and consumes the public token.
- **Checklist_Finalizer**: `finalizeChecklistEsign` in `backend/src/modules/employees/employeeJoiningDocuments.service.ts`, the single-document completion writer.
- **Webhook_Route**: `POST /api/public/employee-documents/esign/webhook/luckpay`, the inbound push endpoint that Luckpay is not currently configured to call.
- **Backfill_Runner**: the manually-triggered, one-off bulk reconciliation of the 26 stranded kits authorised in decision 2.
- **Deployment_Checklist**: the written record of operational steps performed when this specification's changes are deployed, covering checks whose subject exists only in the deployed environment and cannot be read from the repository or the database.
- **Stranded_Kit**: a joining kit at status `sent` with provider status `PENDING` and `signed_file_id` NULL, dispatched between 2026-08-01 and 2026-08-26.
- **Stranded_Row**: a joining document checklist row at `esign_initiated` or `pending_candidate_esign` belonging to a Stranded_Kit.
- **Tracker_Service**: `backend/src/modules/ats/ats.joiningDocumentsTracker.service.ts`.
- **Tracker_Page**: `src/pages/JoiningDocumentsTrackerPage.tsx` together with its TanStack Query hooks.
- **Employee_Documents_Page**: `src/pages/EmployeeJoiningDocumentsPage.tsx`, the per-employee joining document pack view, distinct from Tracker_Page. It presents one row per checklist document for a single employee, including a status indication per document.
- **Esign_State_Authority**: the single declared source from which both Tracker_Service's eSign classification and Employee_Documents_Page's status vocabulary are derived, so that the Esign_State set is stated once rather than maintained independently on each surface.
- **Bulk_Verify**: `bulkVerifyDocuments` in Tracker_Service, the HR action that marks a set of employees' documents verified.
- **Audit_Log**: the existing application audit table written by the joining documents and kit dispatch services.
- **Esign_State**: the value of `status` on a joining document checklist row. The live set is `hr_fill_required`, `draft_generated`, `employee_review_pending`, `ready_for_esign`, `pending_candidate_esign`, `esign_initiated`, `esign_completed`, `esign_failed`, `correction_requested`, `uploaded_pending_review`.
- **Build_Check**: the project's type-checking and compilation step, run both locally and in continuous integration, whose failure blocks a change from being merged or deployed.
- **Give_Up_Window**: the 30-day cut-off at which Esign_Worker stops chasing a transaction. For MAS47814, dispatched 2026-08-01, this closes on 2026-08-31.

## Requirements

### Requirement 1: The pull path runs

**User Story:** As an HR operations lead, I want the system to find out on its own that a candidate has signed, so that a completed signature stops depending on someone noticing.

#### Acceptance Criteria

1. THE Esign_Worker SHALL run with `ESIGN_RECONCILIATION_ENABLED` set to `true` in the deployed backend environment.
2. WHEN Esign_Worker polls a transaction, THE Esign_Worker SHALL follow the Backoff_Ladder as already implemented, without altering the interval sequence, `TICK_MS`, `BATCH_SIZE` or `GIVE_UP_AFTER_DAYS`.
3. WHEN Esign_Worker finds a transaction whose provider status is signed and whose `scope` is `kit`, THE Status_Service SHALL delegate completion to Kit_Finalizer rather than closing only the anchor checklist row.
4. WHEN Esign_Worker polls a transaction, THE Esign_Worker SHALL set `last_polled_at` and increment `poll_attempts` on that transaction, so that a worker that is running is distinguishable from one that is not.
5. WHEN Esign_Worker starts a tick, THE Esign_Worker SHALL emit a log line stating the enabled state and the number of transactions selected for that tick.
6. IF a provider call for a transaction fails, THEN THE Esign_Worker SHALL record the failure against that transaction, schedule the next attempt on the Backoff_Ladder, and continue processing the remaining transactions in the batch.
7. WHEN a transaction reaches the Give_Up_Window, THE Esign_Worker SHALL stop selecting that transaction and SHALL leave a record stating that it was abandoned unresolved.

### Requirement 2: The dormant webhook route is hardened, diagnosable, and documented

**User Story:** As an engineer on call, I want a genuinely misconfigured environment to be diagnosable from its own logs, so that a missing secret is never confused with a provider that simply does not push.

This requirement is hardening and documentation, not a repair. Root cause A1 establishes that the route is dormant because Luckpay was never given a callback URL, and that the secret is configured in production. Nothing here presumes the secret is currently unset in any deployed environment.

#### Acceptance Criteria

1. THE Webhook_Route SHALL remain mounted at `POST /api/public/employee-documents/esign/webhook/luckpay`.
2. WHERE `LUCKPAY_WEBHOOK_SECRET` is unset in the running environment, WHEN a request reaches Webhook_Route, THE Webhook_Route SHALL emit an error-level log entry naming the unset secret as the reason and SHALL write an Audit_Log row for the rejected delivery, in addition to returning its rejection response, so that an environment that is genuinely misconfigured is diagnosable from its own output.
3. WHEN a request reaches Webhook_Route carrying an `X-HRMS-Webhook-Secret` header that does not match the configured secret, THE Webhook_Route SHALL reject the request and SHALL record the rejection distinguishably from the unset-secret case of criterion 2.
4. WHEN a request reaches Webhook_Route carrying no `X-HRMS-Webhook-Secret` header while the secret is configured, THE Webhook_Route SHALL reject the request and SHALL record the rejection distinguishably from both criterion 2 and criterion 3, so that an unauthenticated probe is not read as a configuration fault.
5. WHEN a request reaches Webhook_Route with a matching secret, THE Webhook_Route SHALL process the payload through the same completion path as the pull path, so that a pushed and a pulled completion produce the same database state.
6. THE Webhook_Route SHALL carry an in-code comment stating that the route is dormant because Luckpay registers no callback URL and pushes nothing, that the pull path is the source of truth, and recording the absolute callback URL Luckpay would need in order to start pushing.
7. WHEN the changes in this specification are deployed, THE Deployment_Checklist SHALL record an operational confirmation that `LUCKPAY_WEBHOOK_SECRET` is set in the production environment, so that a value which is absent from `org_settings` and therefore unreadable from the repository or the database is confirmed against the running environment instead of inferred.
8. WHERE the deployment sets `LUCKPAY_PROVIDER_ENABLED` to `true`, THE backend SHALL continue to enforce the existing startup guard at `backend/src/config/env.ts:379-382` that refuses to boot without `LUCKPAY_WEBHOOK_SECRET`.

### Requirement 3: The 26 stranded kits are resolved before the window closes

**User Story:** As an HR operations lead, I want the kits already stuck in production closed out, so that candidates who signed weeks ago stop being chased and the ones who did not are handed to me as a list.

#### Acceptance Criteria

1. THE Backfill_Runner SHALL be triggerable manually and SHALL process the 26 Stranded_Kits and their 215 Stranded_Rows.
2. THE Backfill_Runner SHALL complete its run against MAS47814 on or before 2026-08-31, so that the transaction dispatched on 2026-08-01 is resolved inside the Give_Up_Window.
3. WHEN Backfill_Runner receives a signed confirmation from Luckpay for a Stranded_Kit, THE Backfill_Runner SHALL close that kit through Kit_Finalizer, so that every member checklist row, the kit status, `open_marker` and the public token are all settled in one path.
4. WHEN Backfill_Runner closes a Stranded_Kit, THE Backfill_Runner SHALL apply the same verification write defined in Requirement 4 to every checklist row it closes.
5. IF Luckpay reports that a Stranded_Kit is not signed, THEN THE Backfill_Runner SHALL leave that kit, its checklist rows, its reminders and its candidate-facing token unchanged, and SHALL add the kit to the report described in criterion 6.
6. WHEN a Backfill_Runner run finishes, THE Backfill_Runner SHALL produce a report listing, for each of the 26 kits, the employee code, the dispatch date, the provider reference, the provider-reported status, and whether the kit was closed or left untouched.
7. WHEN Backfill_Runner encounters a transaction with a `fallback_internal_link` or `link_generated` provider state rather than a real `APIB…` reference, THE Backfill_Runner SHALL classify that transaction as unresolvable by polling and SHALL list it in the report rather than treating it as an error.
8. WHEN Backfill_Runner processes a kit, THE Backfill_Runner SHALL be safe to re-run, so that a second run over an already-closed kit changes no data and reports it as already closed.

### Requirement 4: eSign completion writes verification state

**User Story:** As an HR user looking at a candidate who signed everything, I want the tracker to say the documents are verified and not overdue, so that I am not reading two contradictory numbers about the same nine documents.

#### Acceptance Criteria

1. WHEN Checklist_Finalizer completes a checklist row with a verified Aadhaar eSign, THE Checklist_Finalizer SHALL set `verification_status` to `verified` and SHALL set `due_at` to NULL in the same database transaction that sets `status` to `esign_completed`.
2. IF the transaction in criterion 1 fails at any point, THEN THE Checklist_Finalizer SHALL leave `status`, `verification_status` and `due_at` all unchanged, so that a row cannot end up signed but unverified.
3. WHEN Checklist_Finalizer writes the verification state, THE Checklist_Finalizer SHALL record in Audit_Log that the verification came from an Aadhaar eSign rather than from a human review action.
4. WHEN Kit_Finalizer closes the member checklist rows of a kit, THE Kit_Finalizer SHALL produce the same verification state on every member row as criterion 1 defines for a single row.
5. WHEN the verification write has been applied to MAS63411, THE Tracker_Service SHALL report that employee with `verified_count` of 5 and `overdue_count` of 4, replacing the current "Documents 0/9" and "Overdue 9".
6. THE Tracker_Service SHALL continue to compute `overdue_count` from `due_at < NOW() AND verification_status IS NULL` without modification.

### Requirement 5: Bulk verification acts on eSigned rows

**User Story:** As an HR user, I want the bulk verify action to cover documents that arrived by eSign, so that a row the system already trusts is not permanently outside the one tool I have for clearing verification.

#### Acceptance Criteria

1. WHEN Bulk_Verify runs for a set of employees, THE Bulk_Verify SHALL match checklist rows at `esign_completed` with `signature_mode` of `aadhaar_esign_verified` in addition to rows at `uploaded_pending_review`.
2. WHEN Bulk_Verify verifies a row, THE Bulk_Verify SHALL set `verification_status` to `verified` and SHALL clear `due_at`, producing the same end state as Requirement 4.
3. WHEN Bulk_Verify verifies a row that arrived by eSign, THE Bulk_Verify SHALL record in Audit_Log that the row was eSigned, so that the entry is distinguishable from verification of an uploaded document.
4. THE Bulk_Verify SHALL continue to defer completion-percentage recalculation to `recalculateDocumentProgress` rather than computing a rival percentage.
5. WHEN Bulk_Verify runs over a set of employees where one employee fails, THE Bulk_Verify SHALL report that employee in its `errors` array and SHALL continue with the remaining employees.

### Requirement 6: Every surface recognises every live eSign state

**User Story:** As an HR user reading a row badge on the tracker or a document status on an employee's own document pack, I want every eSign state to be accounted for on both screens, so that a green 5/5 cannot sit on top of four unsigned documents and a document in a live state cannot appear with no status at all.

Criteria 1 to 5 bind Tracker_Service. Criteria 6 to 8 bind Employee_Documents_Page, which carries the same class of defect from a separately maintained list of statuses: its status presentation omits `ready_for_esign`, `draft_generated`, `hr_fill_required`, `employee_review_pending` and `correction_requested`, all of which occur in production data.

#### Acceptance Criteria

1. THE Tracker_Service SHALL classify every value in the Esign_State set into exactly one of completed, in-progress, or not-started, so that no checklist row is dropped from the eSign denominator.
2. THE Tracker_Service SHALL count `esign_completed` as completed.
3. THE Tracker_Service SHALL count `pending_candidate_esign`, `esign_initiated`, `ready_for_esign`, `employee_review_pending`, `draft_generated`, `hr_fill_required`, `esign_failed` and `correction_requested` within the eSign denominator.
4. WHEN Tracker_Service reports MAS63411 after this change, THE Tracker_Service SHALL show an eSign denominator of 9 rather than 5.
5. IF a checklist row carries a status outside the Esign_State set, THEN THE Tracker_Service SHALL include that row in the denominator and SHALL emit a log entry naming the unrecognised value.
6. WHEN Employee_Documents_Page renders a checklist row, THE Employee_Documents_Page SHALL present a status indication for every value in the Esign_State set, so that a document in any live state renders with its status styling rather than unstyled.
7. THE Employee_Documents_Page SHALL derive the status vocabulary it presents from Esign_State_Authority, the same authority from which Tracker_Service derives the classification behind its counters, rather than from a list maintained independently on the page.
8. WHEN a status value is added to Esign_State_Authority without being classified for presentation on Employee_Documents_Page, THE Build_Check SHALL fail and SHALL name the unclassified value, so that the omission is caught before the value can reach Employee_Documents_Page unstyled.

### Requirement 7: Summary tiles agree with the rows beneath them

**User Story:** As an HR manager glancing at the top of the tracker, I want the tiles to match the rows, so that "0 In Progress" cannot appear above a list of employees badged In Progress.

#### Acceptance Criteria

1. THE Tracker_Service SHALL assign every employee to exactly one summary bucket, and the buckets it produces SHALL be the buckets Tracker_Page renders.
2. WHEN an employee has a completion percentage between 75 and 99 inclusive, THE Tracker_Service SHALL count that employee in a bucket that Tracker_Page displays.
3. WHEN Tracker_Page renders the summary for the current production data of 309 employees, THE Tracker_Page SHALL show a non-zero total across the In Progress, Completed and Pending tiles that sums to 309.
4. THE Tracker_Page SHALL derive a row's badge from the same classification the summary tiles use, so that a row badged In Progress is counted in the In Progress tile.

### Requirement 8: Absent eSign documents read as absent, not as complete

**User Story:** As an HR user, I want an employee with no eSign documents to show a dash, so that "nothing to sign" is not displayed as "everything signed".

#### Acceptance Criteria

1. WHEN an employee has no checklist rows in the eSign denominator, THE Tracker_Service SHALL return null for the eSign counts rather than coercing them to 0.
2. WHEN Tracker_Page receives a null eSign count, THE Tracker_Page SHALL render a dash rather than a `0/0` badge.
3. THE Tracker_Service response type and the Tracker_Page consuming type SHALL agree on nullability for every count field, so that the service cannot return a value the page's type declares impossible.

### Requirement 9: Pagination is real

**User Story:** As an HR user with more than 500 employees in scope, I want the next page to actually exist, so that employees past the cut-off are reachable.

#### Acceptance Criteria

1. WHEN Tracker_Page sends `page` and `limit`, THE Tracker_Service SHALL apply both to the query rather than hard-coding a row limit.
2. THE Tracker_Service SHALL return `total` as the count of employees matching the active filters, independent of how many rows the current page returned.
3. WHEN the filtered result set extends beyond the requested page, THE Tracker_Service SHALL return `hasNext` as true.
4. WHEN a filter or search term changes, THE Tracker_Page SHALL reset to the first page.
5. THE Tracker_Service SHALL apply a deterministic sort order across pages, so that an employee cannot appear on two pages or be skipped between them.

### Requirement 10: Corrected data becomes visible without a manual refresh

**User Story:** As an HR user who has just verified a batch of documents, I want the screen to update, so that I do not have to press Refresh to find out whether my own action worked.

#### Acceptance Criteria

1. WHEN a bulk action on Tracker_Page succeeds, THE Tracker_Page SHALL invalidate the tracker query so that the list and the summary tiles both re-read from the server.
2. WHILE Tracker_Page is mounted and visible, THE Tracker_Page SHALL refetch tracker data on a fixed interval, so that completions arriving from Esign_Worker appear without user action.
3. WHEN Tracker_Page refetches, THE Tracker_Page SHALL preserve the active page, filters and selection.
4. WHILE a refetch is in flight, THE Tracker_Page SHALL keep the previous rows visible rather than clearing the table.

### Requirement 11: Provider spend stays inside the agreed budget

**User Story:** As the owner of the Luckpay contract, I want polling to stay inside the agreed backoff, so that enabling the worker does not turn per-call billing into an open-ended cost.

#### Acceptance Criteria

1. THE Esign_Worker SHALL make at most one `checkESignStatus` call per transaction per scheduled attempt on the Backoff_Ladder.
2. THE Esign_Worker SHALL process at most `BATCH_SIZE` transactions per tick, at the existing `TICK_MS` interval.
3. THE Esign_Worker SHALL call `downloadESignDocument` only for a transaction the provider has reported as signed.
4. WHEN a transaction reaches a terminal state, THE Esign_Worker SHALL stop selecting that transaction for polling.
5. THE Backfill_Runner SHALL make at most one status call per Stranded_Kit per run, giving an upper bound of 26 status calls and 26 download calls for the authorised run.
6. THE Esign_Worker SHALL expose a counter of provider calls made, so that actual call volume can be compared against the billed volume.

### Requirement 12: Every backfilled signature is attributable

**User Story:** As an auditor, I want a backfilled completion to be distinguishable from one that completed normally, so that a bulk remediation is never mistaken for 26 candidates signing on the same afternoon.

#### Acceptance Criteria

1. WHEN Backfill_Runner closes a Stranded_Kit, THE Backfill_Runner SHALL write an Audit_Log row identifying the closure as a backfill, naming the operator who triggered the run and the provider reference the decision was based on.
2. THE Audit_Log row from criterion 1 SHALL be distinguishable from the row a normal completion writes, without relying on inspecting timestamps.
3. WHEN Backfill_Runner writes verification state on a checklist row, THE Backfill_Runner SHALL preserve the original `completed_at` reported by the provider rather than substituting the backfill run time.
4. WHEN Backfill_Runner leaves a kit untouched, THE Backfill_Runner SHALL write an Audit_Log row recording that the kit was examined and found not signed, so that the absence of action is itself evidenced.
5. THE Audit_Log SHALL retain the pre-backfill status of every kit and checklist row the Backfill_Runner changed, so that the remediation is reviewable after the fact.
