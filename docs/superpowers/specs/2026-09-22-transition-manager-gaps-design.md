# Transition Manager Gaps — Design

**Date:** 2026-09-22
**Source:** Gap analysis of `MCN Employee transition Manager.pptx` against the live HRMS2 codebase, confirmed with the product owner.

## Background

The deck describes a ticket-driven joiner/leaver automation module. Comparing it against the codebase surfaced 5 open items. The owner resolved them as follows:

1. Keep the existing 7-day / reporting-manager-confirmation AWOL detection model exactly as-is (`backend/src/modules/employees/awol-detection.service.ts`) — build the confirm action around it, do not touch the threshold or the human-confirmation requirement.
2. "MCN Employee Notifier" (deck slide 8, title-only) — left out of this build; no detail exists to build against.
3. The deck's "Partner ID deletion" concept is already covered by the existing `dialler_delete` exit-provisioning task — confirmed equivalent, no new concept needed. (An auto-email to a client/partner contact on this task was raised as a possible extra but is not part of this build — flagged separately if wanted later.)
4. Real 4-hourly repeating reminders on open tickets, until closed, are a genuine gap — today the system only sends a 24h SLA email once and flags overdue once.
5. A new internal, HR-facing BGV ticket (vendor-correspondence note + Red/Green result) does not exist and should be added, fully separate from the existing candidate-facing DigiLocker/BGV self-service flow.

This spec covers the three confirmed build items: (A) one-click AWOL confirm action, (B) 4-hourly repeat reminders, (C) new internal BGV ticket.

## A. One-click "Confirm Absconding" on the Work Inbox item

### Problem
Today `AWOL_SUSPECTED` work items only deep-link to the employee's 360 page (`backend/src/modules/work-inbox/action-item-registry.ts`). The manager has to navigate away and use the generic exit form to act on it.

### Design
Add two actions directly on the work item: **Confirm Absconding** and **Not Absconding**.

- **Not Absconding**: dismisses the item, requires a one-line reason (audit trail), marks the work item resolved. No exit created.
- **Confirm Absconding**: opens a compact 2-field dialog — a last-worked-date field and an optional remarks field — then calls the existing `createExitRequest` with `exitSubType: "absconding"` and that date, and marks the item resolved.

**Last-worked-date source:** `work_item` (the table AWOL actually uses — `backend/sql/290_dashboard_analytics_engine.sql`) has no structured metadata column, only free-text `title`/`description` and an `entity_type`/`entity_id` pointer back to the employee. Rather than adding a schema column to carry this, the confirm dialog re-derives the date live by re-running the same consecutive-absence query `awol-detection.service.ts` already uses for that employee, and pre-fills it, editable by the manager before submit. This keeps a single source of truth for the date logic and avoids a schema change for a value that's cheap to recompute and safer fresh than cached.

Everything downstream of `createExitRequest` reaching `exited` status is unchanged — deprovisioning (`domain_delete`, `email_delete`, `biometric_delete`, `dialler_delete`) already fires automatically via `exit.service.ts`'s existing dispatch.

### UI
Work Inbox item detail view, workflow/approval pattern (#120): amber "decision needed" tone for the pending item. Confirm dialog: `GlassCard`-styled (`rounded-2xl`, `bg-white/95 backdrop-blur-sm`), primary blue submit button — not destructive-red, since nothing is deleted at this step, only an exit request is opened.

### Testing
- Unit: last-worked-date re-derivation returns the same value the original AWOL scan would compute for a given employee/attendance fixture.
- Unit: Confirm Absconding calls `createExitRequest` with the correct `exitSubType` and date; Not Absconding never calls it.
- Integration: full path from work item to exit request creation, with RBAC (only the item's assigned recipient — reporting manager/payroll HR — may act on it).

## B. Real 4-hour repeating reminders

### Problem
`it-provisioning.cron.ts` currently sends one SLA-due email and flags overdue once (`notifyOverdueProvisioning`). The deck wants indefinite nagging every 4 hours until the ticket closes.

### Design
Reuse `backend/src/workers/tat-escalation.worker.ts` / `governance/tat.service.ts` rather than building a second reminder mechanism — it already has the safety machinery this needs: backfill floor, per-event dedup constraint, kill switch, shadow mode.

Its existing mode is a 3-level escalation ladder (L1/L2/L3, each fired once). This needs a second, simpler mode: **repeat every 4 hours indefinitely while the ticket is not closed.** Concretely:

- Add a `repeat_interval_minutes` (nullable) column to `notification_event_config` (additive migration). When set, the due-escalation query in `tat.service.ts` computes next-fire as `last_fired_at + repeat_interval_minutes` instead of consuming a fixed L1→L2→L3 ladder, and keeps firing as long as the ticket's status is still open.
- Register the 4 existing join tasks (`IT_EMAIL_DOMAIN_ASSET`, `ADMIN_BIOMETRIC_ID_CARD`, `WFM_PROCESS_ALIGNMENT`, `APPOINTMENT_LETTER_ESIGN`) and the new BGV task (part C) under this repeat mode at 240 minutes.
- No new UI. Same email templates it-provisioning already sends, just re-sent every 4 hours instead of once.

### Testing
- Unit: `tat.service.ts`'s due-escalation query correctly computes next-fire under repeat mode and stops once status leaves the open set.
- Unit: existing 3-level ladder behavior is unaffected for event configs without `repeat_interval_minutes` set (regression guard).
- Integration: worker poll cycle against a fixture ticket left open across multiple simulated 4-hour windows sends one notification per window, none after closure.

## C. New "HR Action: BGV Initiation" ticket

### Problem
No internal record exists of HR's own BGV follow-up with the vendor — the current BGV system is entirely candidate-facing self-service (DigiLocker/Luckpay).

### Design
A 5th join-provisioning task, same shape as the existing 4 in `it-provisioning.service.ts`'s `JOIN_TASKS` array: `HR_BGV_INITIATION`, assigned to role `hr`, dispatched in parallel with the others by `dispatchJoinProvisioningTasks` on employee-code creation.

Its completion form (in `task-completion-handlers.service.ts`) takes:
- `vendorNote` (free text) — vendor correspondence reference.
- `result` (`red` | `green`) — outcome flag.

This does not touch `bgv-verification.service.ts`, `luckpay-status.service.ts`, or the candidate self-service flow at all — it is a parallel, independent record. Subject to the same 4-hour repeat reminder from part B until completed.

### UI
IT Provisioning task list, same card/table pattern as the existing 4 tasks. Completion form: two-field dialog, red/green result shown as a colored badge consistent with the tone system (`red`/`green` tones already defined in the design system).

### Testing
- Unit: task creation, completion validation (`vendorNote` required, `result` must be red/green), RBAC (only `hr` role can complete).
- Integration: task appears alongside the other 4 on join, is independently completable, does not affect or get affected by candidate-side BGV state.

## Migrations (additive only, per standing deploy authorization)

1. `notification_event_config` — add nullable `repeat_interval_minutes` column.
2. `it-provisioning` — add `HR_BGV_INITIATION` task type + its two result columns (`vendor_note`, `result`) to whichever table backs task completion detail (to be confirmed against the live schema during implementation — same table the existing 4 tasks use).

No destructive changes. No changes to candidate-facing BGV/DigiLocker code.
