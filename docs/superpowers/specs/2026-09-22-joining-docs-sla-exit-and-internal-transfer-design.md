# Joining Documents SLA + Left/Dropped Handling, and Internal Fund Transfer Voucher

Date: 2026-09-22
Status: Approved by user, proceeding to implementation.

## Part A — Joining Documents Tracker & Appointment Letter Queue

### Problem

1. No visibility for "employee ID created more than 3 days ago, joining docs/appointment letter still pending" — only per-document due dates exist today.
2. A candidate who gets an employee ID but drops out before completing onboarding has no way to be marked left/dropped, so they sit in both queues indefinitely.
3. Root cause found in code: the Joining Documents Tracker excludes exited employees with
   `employment_status NOT IN ('resigned', 'terminated')` (`ats.joiningDocumentsTracker.service.ts`), but
   `exitEmploymentStatus.ts` actually writes `'inactive' | 'terminated' | 'absconded'` on exit completion.
   A resigned employee (the common case, maps to `'inactive'`) is never excluded — this is the literal
   cause of "inactive employee data should not reflect" in the tracker.
   The Appointment Letter Queue (`appointmentLetterEligibility.service.ts: listAppointmentLetterQueue`)
   is worse: its population filter is `e.active_status = 1` only, with **no** `employment_status` check
   at all.

### Design

1. **SLA field.** Add `days_since_id_created` (= `DATEDIFF(CURDATE(), e.created_at)`) and
   `id_creation_sla_breached` (`days_since_id_created > 3`) to:
   - `getJoiningDocumentsTracker()` row payload + a new `id_creation_overdue_count` in the summary block.
   - `listAppointmentLetterQueue()` / `evaluateAppointmentLetterEligibility()` row payload.
   Frontend: red "ID SLA breached (Xd)" badge on both pages; new filter checkbox + summary tile on the
   Tracker (mirrors the existing `overdueOnly`/`overdue_count` pattern); blocked list on the Appointment
   Letter Queue sorted breached-first.

2. **Mark Left / Dropped action.** Row action on both pages, shown only while joining/appointment is
   incomplete. Deep-links into the existing Exit Management "Initiate Exit" flow, pre-filled with the
   employee. Adds one new exit sub-type, `did_not_join`, mapping to `employment_status = 'terminated'`
   in `exitEmploymentStatus.ts`'s existing mapper — additive, nothing existing changes. Chosen over
   reusing `absconding` because it is factually different (never joined vs. left after joining) and
   exit/attrition reporting should be able to tell them apart.

3. **Fix the exclusion filters.**
   - Tracker: replace the ad hoc `NOT IN ('resigned','terminated')` with
     `employment_status NOT IN (<NON_REACTIVATABLE_STATUSES>)`, importing the canonical list from
     `exitEmploymentStatus.ts` instead of re-deriving it.
   - Appointment Letter Queue: add the same `employment_status` exclusion alongside the existing
     `active_status = 1` condition in `listAppointmentLetterQueue()`.
   This is retroactive — any already-exited employee currently leaking into either page disappears
   once deployed, no backfill script needed (it's a read-path filter, not a data migration).

### No new tables. No breaking changes to existing exit sub-types, tracker filters callers already pass, or appointment letter issuance logic.

### Testing

- Extend `ats.joiningDocumentsTracker.routes.test.ts` and the appointment-letter queue tests with
  fixture employees in each terminal `employment_status`, asserting exclusion.
- New test: `days_since_id_created`/`id_creation_sla_breached` computed correctly at the 3-day boundary.
- New test: `employmentStatusForExit(..., 'did_not_join')` (or however the sub-type is threaded through)
  returns `'terminated'` and is included in `NON_REACTIVATABLE_STATUSES`-derived exclusions.

## Part B — Finance: Internal Fund Transfer on Raise Voucher

### Problem

`payment_voucher` models one bank account (money out) against one `payable_account_id` (an external
payable — vendor/expense/imprest). There is no way to represent moving money between two of the
company's own `company_bank_account` rows.

### Design

1. New `sourceType: "internal_transfer"` alongside the existing
   `vendor_grn | imprest_allocation | general | vendor_advance | vendor_advance_application | sales_receipt`.
   Raise form: existing source bank account picker, plus a new destination `company_bank_account`
   picker (same list, source excluded), amount, remarks. No vendor/GRN/payable fields.
2. Goes through the unchanged existing approval chain: Raise (Finance Head) → CEO Approve →
   Release (Finance Head). No workflow/role changes.
3. On `release()`, post **two** `bank_account_ledger_entry` rows in the same transaction instead of one:
   debit on the source account, credit on the destination account, both carrying the same `voucher_id`
   so they reconcile as a pair, each with its own correctly-computed `running_balance` under the
   existing row-lock pattern.
4. `bank_account_ledger_entry.payable_account_id` is `NOT NULL` ("the other side of the entry"). Seed
   one system `payable_account_master` row, "Inter-Account Transfer", used as the counterpart on both
   legs — avoids a schema change to that column.

### No new tables (one seeded row in an existing table). No changes to existing voucher source types,
approval roles, or the single-entry posting path they already use.

### Testing

- Unit test on `release()` for `sourceType: 'internal_transfer'`: both ledger rows post atomically,
  matching amounts, correct running balances per account, and rollback-together on failure.
- Contract test: raising an internal transfer voucher rejects a destination account equal to the source
  account, and rejects vendor/GRN/payable fields being set for this source type.
