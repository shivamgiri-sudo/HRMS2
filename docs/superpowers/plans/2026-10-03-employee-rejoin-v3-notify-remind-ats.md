# Employee Rejoin v3 — Notifications, Reminders/Escalation, ATS Leaver Catch (Plan 3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the rejoin flow run itself: tell people when something needs them, nudge and escalate when it stalls, and stop a returning leaver from being silently created as a brand-new employee at ATS conversion.

**Architecture:** One migration registers six notification events, their email templates, an escalation claim table, reminder columns and a worker_config row. One notifications module wraps `notificationGateway.notify` (never throws). One worker sweeps pending requests hourly (nudge at 48h and 96h, escalate once after 5 days). One small module decides what to do when an ATS candidate matches a former employee, wired into the orchestrator with a single call.

**Tech Stack:** TypeScript, Express, mysql2, vitest. Builds on Plans 1, 2a, 3a (branch `feat/rejoin-v3-flags`, worktree `/home/shuvam/hrms-rejoin-3`).

**Plan series:** 1 core ✔ → 2a dossier API ✔ → 2b review UI (another session) → 3a flags/follow-ups ✔ → **3b this** → 3c split-month payroll (flagged).

**Rules for every task:** TDD (write the test, see it fail, implement, see it pass), commit per task, never push, never touch prod or any real database. Work in `/home/shuvam/hrms-rejoin-3` only; run backend commands from `backend/`. Known failing files that are NOT ours (they fail on origin/main): `src/db/__tests__/shivamgiri-schema-case.test.ts`, `tests/upload-batch-retention.test.ts`, `src/workers/__tests__/esignDeadKitRedispatch.worker.test.ts`.

---

## What the research established (verbatim facts this plan depends on)

- Gateway: `notificationGateway.notify(input)` (a method, not a bare export) from `backend/src/modules/communication/notification.gateway.ts`. `NotifyInput = { eventCode, dedupeKey, context: RecipientContext, data?, entityType?, entityId?, correlationId?, specOverride? }`. Outcomes: `sent | shadow | duplicate | cooldown | disabled | capped | undeliverable | blocked`. An unregistered or disabled event returns `disabled`, it does not throw; live delivery errors do throw, so producers wrap in try/catch. Cooldown only applies when `entityType` and `entityId` are given and `cooldown_minutes > 0`; set `cooldown_minutes = 0` for every rejoin event and let `dedupeKey` do the work.
- Recipients (`backend/src/shared/recipient-resolver.types.ts`): `RecipientSpec = { to: RecipientSelector[]; cc?; bcc? }`. Selectors used here: `{kind:'branch_head', branchId?}` (falls back to `context.branchId`), `{kind:'role_scope', roleKeys, scope?:{type:'all'}|{type:'branch',branchIds}, limit?}`, `{kind:'payroll_hr', branchId?}`, `{kind:'user', userId}` (resolves through `employees.user_id`, active employees only). The `employee` selector is gated on `active_status = 1`, so a notification can **not** be addressed to a leaver; do not try.
- Events: row in `notification_event_config` (`event_code` unique, `enabled`, `dispatch_mode` `shadow|live|off`, `channels`, `is_critical`, `sensitivity` `int|conf|fin`, `recipient_spec` JSON, `max_per_run`, `max_per_day`, `cooldown_minutes`, `template_key`). Idempotent insert style: `INSERT ... SELECT UUID(), ... FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM notification_event_config WHERE event_code = '...')`. Templates: `communication_template (id, name, subject, body_html, body_text, category, channel, is_active, is_critical)`, matched by `name = template_key`, `{{placeholders}}` filled from `data`. A missing template falls back to an auto-generated body, it does not block the send. The deliverer appends an action link from `backend/src/modules/communication/notification.links.ts`.
- Every sent email is mirrored into `work_inbox_item` for recipients that have a user id.
- Worker pattern: `backend/src/workers/leave-approval-reminder.worker.ts` (WORKER_NAME must match a `worker_config.worker_name` row; `isWorkerEnabled` fails open on a missing row; `withWorkerLock`, `recordWorkerRun`, `markWorkerRun`, `registerTimer`/`unregisterTimer`; counters advance whether or not the send succeeded so a max bounds an unresolvable recipient). Registered in **both** `backend/src/workers/all-workers.ts` (import ~line 90, entry ~498, stop call ~630) and `backend/src/server.ts` (import ~81, start call ~388 inside the schedulers block). Once-only claim pattern: `INSERT IGNORE` into a table with a unique key and check `affectedRows === 1` (`roster-requests.escalation.ts`).
- Migration rules: new migrations live in `backend/sql/migrations/`, must be listed in `MIGRATION_MANIFEST` (`backend/src/db/runPendingMigrations.ts`), must be MySQL-8-safe (information_schema-guarded `PREPARE`, no `ADD COLUMN IF NOT EXISTS`), and `tests/migration-hot-table-guard.test.ts` forbids ALTERs on hot tables (`employee_reactivation_requests` is not one). Run `node scripts/update-migration-lock.mjs --write` after registering. `backend/sql/schema-snapshot.json` (column-name arrays per table) must list new tables/columns or `schema-column-refs.test.ts` fails; edit it by hand, never regenerate it against a database.
- ATS: `createEmployeeFromCandidate` (`backend/src/modules/employees/employee-creation-orchestrator.service.ts`) runs `validateStatutoryInfo` then the underage check; blockers are `{type, reason, severity}`, then `await conn.rollback(); return result;`. `findActiveEmployeeByStatutoryId` matches only `active_status = 1`, so a leaver (`active_status = 0`) silently becomes a second employee today. `backend/src/modules/employees/__tests__/conversion-duplicate-identity.contract.test.ts` asserts on the orchestrator's SOURCE TEXT: do **not** edit `findActiveEmployeeByStatutoryId`, do not write the string `s.aadhaar_number`, do not remove the comment `7. No duplicate mobile/email blocking`, keep `type: 'duplicate_pan'` / `'duplicate_aadhaar'` literals followed by `severity: 'critical'` within 600 chars, and any code added after `async function findActiveEmployeeByStatutoryId` must not break the regexes (so add the new code **before** it, or in another file). The thrown error carries only the joined blocker `reason` text to the UI (`errorHandler.ts`), so the reason string is what HR sees.
- Columns: `ats_candidate.pan_number`, `ats_candidate.aadhar_number` (note the spelling); `employees.pan_number`, `employees.aadhaar_number`, `employees.active_status`, `employees.employment_status`, `employees.date_of_exit`; `employee_statutory_info.pan_number`, `employee_statutory_info.aadhaar_id`. `pan_blind_index` is empty on all employees; compare raw columns.
- Leaver statuses: `NON_REACTIVATABLE_STATUSES` / `nonReactivatableSqlList()` in `backend/src/modules/exit/exitEmploymentStatus.ts`. It includes `not_joined` (a person who never started): that is **not** a leaver for this purpose and must be excluded here.

## Decisions made in this plan

- **Live, not shadow.** The six events ship `enabled=1, dispatch_mode='live'` like other recent events; the rows are only ever triggered by the new rejoin flow. An owner can flip a row to `shadow` or `off` without a deploy.
- **Escalation target is HR** (`role_scope` role `hr`, all scope): there is no generic "beyond the branch head" resolver in the codebase, and HR is the rejoin flow's old final actor.
- **ATS does not auto-create a rejoin request.** The raise form needs a requester and a reason written by a human, and the branch head approving an offer is not an allowed requester. Instead the conversion is blocked with a precise message and HR is alerted with a link; HR raises the request in two clicks.
- **ATS gap over 30 days with a clean record is allowed** (fresh onboarding is the rule for long gaps) with a warning that names the old employee code. A conduct-blocked leaver (termination, misconduct, performance exit, disciplinary flag, repeated absconding) is blocked **even through ATS**.
- **ATS check fails open**: if the lookup itself errors, conversion proceeds with a warning, because failing closed would stop all hiring on a transient query error.

## File Structure

| File | Responsibility |
|---|---|
| Create `backend/sql/migrations/2080_rejoin_notifications_reminders.sql` | events, templates, claim table, reminder columns, worker_config row |
| Modify `backend/src/db/runPendingMigrations.ts`, `backend/sql/MIGRATION_MANIFEST.lock.json`, `backend/sql/schema-snapshot.json` | registration |
| Modify `backend/src/modules/communication/notification.links.ts` | action links for the new event codes |
| Create `backend/src/modules/employees/rehire/rejoinNotifications.ts` | `notifyRejoinRequested`, `notifyRejoinDecided`, `notifyRejoinReminder`, `notifyRejoinEscalation`, `notifyFollowUpAttention`, `notifyRejoinBlockedAtJoining` |
| Modify `backend/src/modules/employees/employee-reactivation.routes.ts` | fire notifications after raise and after decision |
| Create `backend/src/workers/rejoin-pending-reminder.worker.ts` | hourly sweep: nudge, escalate |
| Modify `backend/src/workers/all-workers.ts`, `backend/src/server.ts` | register the worker |
| Create `backend/src/modules/employees/rehire/returningLeaver.ts` | find a leaver for an ATS candidate; decide the outcome |
| Modify `backend/src/modules/employees/employee-creation-orchestrator.service.ts` | one call after `validateStatutoryInfo` |
| Tests | `rehire/__tests__/rejoinNotifications.test.ts`, `rehire/__tests__/returningLeaver.test.ts`, `backend/src/workers/__tests__/rejoin-pending-reminder.worker.test.ts`, route test updates, a source-text contract test for the orchestrator call |

Test helper pattern (each test file defines its own copy):

```ts
function executor(map: Record<string, unknown[] | Error>) {
  return {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const key = Object.keys(map).find((k) => sql.includes(k));
      const v = key ? map[key] : [];
      if (v instanceof Error) throw v;
      return [v, []];
    }),
  };
}
```

---

### Task 1: Migration, registration, action links

**Files:**
- Create: `backend/sql/migrations/2080_rejoin_notifications_reminders.sql`
- Modify: `backend/src/db/runPendingMigrations.ts` (append after the `2079_...` entry), `backend/sql/MIGRATION_MANIFEST.lock.json` (script), `backend/sql/schema-snapshot.json` (hand edit), `backend/src/modules/communication/notification.links.ts`

- [ ] **Step 1: Write the migration**

```sql
-- Rejoin v3 notifications, reminders and escalation (plan 3b). Additive and re-runnable.

-- 1. Reminder bookkeeping on the request (employee_reactivation_requests is not a hot table).
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'employee_reactivation_requests' AND COLUMN_NAME = 'reminder_count') = 0,
  'ALTER TABLE employee_reactivation_requests ADD COLUMN reminder_count INT NOT NULL DEFAULT 0, ADD COLUMN last_reminder_at DATETIME NULL',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 2. Once-only escalation claim: INSERT IGNORE then check affectedRows = 1.
CREATE TABLE IF NOT EXISTS rejoin_request_escalation (
  request_id   CHAR(36) NOT NULL,
  escalated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Worker switch (isWorkerEnabled fails OPEN on a missing row, so seed it explicitly).
INSERT IGNORE INTO worker_config (worker_name, enabled, description)
VALUES ('rejoin-pending-reminder', 1,
  'Nudges the branch head at 48h and 96h on a pending rejoin request and escalates to HR after 5 days. Set enabled=0 to stop.');

-- 4. Notification events. Idempotent: insert only when the event_code is missing.
INSERT INTO notification_event_config
  (id, event_code, module, display_name, description, enabled, dispatch_mode, channels,
   is_critical, sensitivity, recipient_spec, max_per_run, max_per_day, cooldown_minutes, template_key)
SELECT UUID(), 'rejoin_requested', 'employees', 'Rejoin request raised',
  'HR or a reporting manager asked to bring a former employee back; the branch head must decide.',
  1, 'live', 'email', 0, 'conf',
  JSON_OBJECT('to', JSON_ARRAY(JSON_OBJECT('kind', 'branch_head'))),
  100, 500, 0, 'REJOIN_REQUESTED'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM notification_event_config WHERE event_code = 'rejoin_requested');

INSERT INTO notification_event_config
  (id, event_code, module, display_name, description, enabled, dispatch_mode, channels,
   is_critical, sensitivity, recipient_spec, max_per_run, max_per_day, cooldown_minutes, template_key)
SELECT UUID(), 'rejoin_decided', 'employees', 'Rejoin request decided',
  'The branch head approved or rejected a rejoin request. Recipients are set by the producer: the requester, with HR and branch payroll in cc.',
  1, 'live', 'email', 0, 'conf',
  JSON_OBJECT('to', JSON_ARRAY(JSON_OBJECT('kind', 'role_scope', 'roleKeys', JSON_ARRAY('hr'), 'scope', JSON_OBJECT('type', 'all'), 'limit', 10))),
  100, 500, 0, 'REJOIN_DECIDED'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM notification_event_config WHERE event_code = 'rejoin_decided');

INSERT INTO notification_event_config
  (id, event_code, module, display_name, description, enabled, dispatch_mode, channels,
   is_critical, sensitivity, recipient_spec, max_per_run, max_per_day, cooldown_minutes, template_key)
SELECT UUID(), 'rejoin_pending_reminder', 'employees', 'Rejoin request waiting for the branch head',
  'Reminder to the branch head at 48h and 96h while a rejoin request is still pending.',
  1, 'live', 'email', 0, 'conf',
  JSON_OBJECT('to', JSON_ARRAY(JSON_OBJECT('kind', 'branch_head'))),
  100, 500, 0, 'REJOIN_PENDING_REMINDER'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM notification_event_config WHERE event_code = 'rejoin_pending_reminder');

INSERT INTO notification_event_config
  (id, event_code, module, display_name, description, enabled, dispatch_mode, channels,
   is_critical, sensitivity, recipient_spec, max_per_run, max_per_day, cooldown_minutes, template_key)
SELECT UUID(), 'rejoin_pending_escalation', 'employees', 'Rejoin request stuck for 5 days',
  'A rejoin request has waited 5 days for the branch head. Escalated once to HR.',
  1, 'live', 'email', 1, 'conf',
  JSON_OBJECT('to', JSON_ARRAY(JSON_OBJECT('kind', 'role_scope', 'roleKeys', JSON_ARRAY('hr'), 'scope', JSON_OBJECT('type', 'all'), 'limit', 10))),
  100, 500, 0, 'REJOIN_PENDING_ESCALATION'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM notification_event_config WHERE event_code = 'rejoin_pending_escalation');

INSERT INTO notification_event_config
  (id, event_code, module, display_name, description, enabled, dispatch_mode, channels,
   is_critical, sensitivity, recipient_spec, max_per_run, max_per_day, cooldown_minutes, template_key)
SELECT UUID(), 'rejoin_followup_attention', 'employees', 'Rejoin approved, a follow-up step needs attention',
  'The employee is active again but a follow-up (login, LMS, IT provisioning) failed or needs HR.',
  1, 'live', 'email', 1, 'conf',
  JSON_OBJECT('to', JSON_ARRAY(JSON_OBJECT('kind', 'role_scope', 'roleKeys', JSON_ARRAY('hr'), 'scope', JSON_OBJECT('type', 'all'), 'limit', 10))),
  100, 500, 0, 'REJOIN_FOLLOWUP_ATTENTION'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM notification_event_config WHERE event_code = 'rejoin_followup_attention');

INSERT INTO notification_event_config
  (id, event_code, module, display_name, description, enabled, dispatch_mode, channels,
   is_critical, sensitivity, recipient_spec, max_per_run, max_per_day, cooldown_minutes, template_key)
SELECT UUID(), 'rejoin_blocked_at_joining', 'employees', 'A former employee was stopped at ATS joining',
  'An ATS candidate matched a former employee by PAN or Aadhaar. The conversion was stopped; HR must raise a rejoin request or decline.',
  1, 'live', 'email', 1, 'conf',
  JSON_OBJECT('to', JSON_ARRAY(JSON_OBJECT('kind', 'role_scope', 'roleKeys', JSON_ARRAY('hr'), 'scope', JSON_OBJECT('type', 'all'), 'limit', 10))),
  100, 500, 0, 'REJOIN_BLOCKED_AT_JOINING'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM notification_event_config WHERE event_code = 'rejoin_blocked_at_joining');

-- 5. Email templates. {{placeholders}} are filled from the producer's `data`.
INSERT INTO communication_template (id, name, subject, body_html, body_text, category, channel, is_active, is_critical)
SELECT UUID(), 'REJOIN_REQUESTED',
  'Rejoin request for {{employee_name}} ({{employee_code}}) needs your decision',
  CONCAT('<div style="font-family:system-ui,sans-serif;font-size:14px;color:#1f2937">',
    '<p>{{requester_name}} ({{requester_role}}) has asked to bring back <b>{{employee_name}}</b> ({{employee_code}}), {{branch_name}}.</p>',
    '<p>Proposed rejoin date: <b>{{proposed_joining_date}}</b> (gap {{gap_days}} days). Eligibility: <b>{{eligibility_status}}</b>.</p>',
    '<p>{{review_reasons}}</p><p>Reason given: {{reason}}</p>',
    '<p>Open the request to see the full history of this employee and approve or reject.</p></div>'),
  'Rejoin request for {{employee_name}} ({{employee_code}}), {{branch_name}}. Requested by {{requester_name}} ({{requester_role}}). Proposed date {{proposed_joining_date}}, gap {{gap_days}} days. Eligibility: {{eligibility_status}}. {{review_reasons}} Reason: {{reason}}',
  'alerts', 'email', 1, 0
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM communication_template WHERE name = 'REJOIN_REQUESTED');

INSERT INTO communication_template (id, name, subject, body_html, body_text, category, channel, is_active, is_critical)
SELECT UUID(), 'REJOIN_DECIDED',
  'Rejoin {{decision}}: {{employee_name}} ({{employee_code}})',
  CONCAT('<div style="font-family:system-ui,sans-serif;font-size:14px;color:#1f2937">',
    '<p>The rejoin request for <b>{{employee_name}}</b> ({{employee_code}}), {{branch_name}}, was <b>{{decision}}</b> by the branch head.</p>',
    '<p>Proposed rejoin date: {{proposed_joining_date}}.</p><p>Remarks: {{remarks}}</p></div>'),
  'Rejoin {{decision}} for {{employee_name}} ({{employee_code}}), {{branch_name}}. Proposed date {{proposed_joining_date}}. Remarks: {{remarks}}',
  'alerts', 'email', 1, 0
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM communication_template WHERE name = 'REJOIN_DECIDED');

INSERT INTO communication_template (id, name, subject, body_html, body_text, category, channel, is_active, is_critical)
SELECT UUID(), 'REJOIN_PENDING_REMINDER',
  'Reminder {{reminder_no}}: rejoin request for {{employee_name}} is waiting for you',
  CONCAT('<div style="font-family:system-ui,sans-serif;font-size:14px;color:#1f2937">',
    '<p>The rejoin request for <b>{{employee_name}}</b> ({{employee_code}}), {{branch_name}}, has been waiting {{days_waiting}} days.</p>',
    '<p>Proposed rejoin date: {{proposed_joining_date}}. Please open it and approve or reject.</p></div>'),
  'Reminder {{reminder_no}}: the rejoin request for {{employee_name}} ({{employee_code}}), {{branch_name}}, has waited {{days_waiting}} days. Proposed date {{proposed_joining_date}}.',
  'alerts', 'email', 1, 0
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM communication_template WHERE name = 'REJOIN_PENDING_REMINDER');

INSERT INTO communication_template (id, name, subject, body_html, body_text, category, channel, is_active, is_critical)
SELECT UUID(), 'REJOIN_PENDING_ESCALATION',
  'Escalation: rejoin request for {{employee_name}} stuck for {{days_waiting}} days',
  CONCAT('<div style="font-family:system-ui,sans-serif;font-size:14px;color:#1f2937">',
    '<p>The rejoin request for <b>{{employee_name}}</b> ({{employee_code}}), {{branch_name}}, raised by {{requester_name}}, has had no decision from the branch head for {{days_waiting}} days.</p>',
    '<p>Please follow up with the branch head.</p></div>'),
  'Escalation: the rejoin request for {{employee_name}} ({{employee_code}}), {{branch_name}}, raised by {{requester_name}}, has had no branch head decision for {{days_waiting}} days.',
  'alerts', 'email', 1, 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM communication_template WHERE name = 'REJOIN_PENDING_ESCALATION');

INSERT INTO communication_template (id, name, subject, body_html, body_text, category, channel, is_active, is_critical)
SELECT UUID(), 'REJOIN_FOLLOWUP_ATTENTION',
  'Rejoin approved for {{employee_name}} ({{employee_code}}): action needed on {{failed_count}} step(s)',
  CONCAT('<div style="font-family:system-ui,sans-serif;font-size:14px;color:#1f2937">',
    '<p><b>{{employee_name}}</b> ({{employee_code}}) is active again, but these follow-up steps need attention:</p>',
    '<p>{{failed_steps}}</p></div>'),
  '{{employee_name}} ({{employee_code}}) is active again, but these follow-up steps need attention: {{failed_steps}}',
  'alerts', 'email', 1, 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM communication_template WHERE name = 'REJOIN_FOLLOWUP_ATTENTION');

INSERT INTO communication_template (id, name, subject, body_html, body_text, category, channel, is_active, is_critical)
SELECT UUID(), 'REJOIN_BLOCKED_AT_JOINING',
  'ATS joining stopped: {{candidate_name}} is a former employee ({{employee_code}})',
  CONCAT('<div style="font-family:system-ui,sans-serif;font-size:14px;color:#1f2937">',
    '<p>Candidate <b>{{candidate_name}}</b> matched former employee <b>{{employee_name}}</b> ({{employee_code}}, {{employment_status}}) by PAN or Aadhaar. The joining was stopped.</p>',
    '<p>{{outcome_message}}</p></div>'),
  'Candidate {{candidate_name}} matched former employee {{employee_name}} ({{employee_code}}, {{employment_status}}). The joining was stopped. {{outcome_message}}',
  'alerts', 'email', 1, 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM communication_template WHERE name = 'REJOIN_BLOCKED_AT_JOINING');
```

- [ ] **Step 2: Register it**

Append to `MIGRATION_MANIFEST` in `backend/src/db/runPendingMigrations.ts` after the `2079_...` entry:

```ts
  "migrations/2080_rejoin_notifications_reminders.sql", // Registered 2026-10-04. Rejoin v3 notifications + reminders: employee_reactivation_requests.reminder_count/last_reminder_at (information_schema-guarded; not a hot table), rejoin_request_escalation once-only claim table, worker_config row 'rejoin-pending-reminder', six notification_event_config events (rejoin_requested, rejoin_decided, rejoin_pending_reminder, rejoin_pending_escalation, rejoin_followup_attention, rejoin_blocked_at_joining; live) and six communication_template rows. Every insert is guarded by NOT EXISTS / INSERT IGNORE; re-run is a no-op.
```

Then `cd backend && node scripts/update-migration-lock.mjs --write` and check the lock diff adds only `2080_...` (plus any entries that were already stale, as happened with 2079).

- [ ] **Step 3: Register the schema in the snapshot**

In `backend/sql/schema-snapshot.json` (a map of table → column-name array; keep tables sorted and recompute `tableCount`/`columnCount` exactly as the previous edit for 2079 did): append `reminder_count`, `last_reminder_at` to `employee_reactivation_requests`; add table `rejoin_request_escalation` with `["request_id", "escalated_at"]`. Check whether `notification_event_config`, `communication_template` and `worker_config` are already present (they are written by raw INSERTs that the schema guard scans); if a guard reports them missing, add their real columns from their CREATE TABLE statements.

- [ ] **Step 4: Action links**

Read `backend/src/modules/communication/notification.links.ts` and add the six event codes to its mapping, pointing at the rejoin review page: `/employees/reactivation` (the existing list route; if the mapping supports data tokens, append `?request=` plus the `request_id` from `data`, otherwise link to the list). `rejoin_blocked_at_joining` links to `/employees/reactivation` as well (HR raises the request there). Add a unit assertion to the file's existing test (find it with `grep -rl notification.links backend/src --include=*.test.ts`) or, if none exists, a small test `backend/src/modules/communication/__tests__/rejoinLinks.test.ts` asserting each of the six codes resolves to a URL starting with `/employees/reactivation`.

- [ ] **Step 5: Verify**

Run: `cd backend && npx vitest run src/db tests src/modules/communication 2>&1 | tail -15 && npx tsc --noEmit`
Expected: only the 3 known pre-existing failing files fail. `tests/migration-hot-table-guard.test.ts` must pass (no hot-table ALTER). If `schema-column-refs` or a manifest test fails, fix by registering, never by weakening a guard or editing a baseline.

- [ ] **Step 6: Commit**

```bash
git add backend/sql backend/src
git commit -m "feat(rejoin): migration for notifications, reminders and escalation claim

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Notifications module

**Files:**
- Create: `backend/src/modules/employees/rehire/rejoinNotifications.ts`
- Test: `backend/src/modules/employees/rehire/__tests__/rejoinNotifications.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import {
  notifyRejoinRequested, notifyRejoinDecided, notifyRejoinReminder, notifyRejoinEscalation,
  notifyFollowUpAttention, notifyRejoinBlockedAtJoining, type NotifyDeps,
} from "../rejoinNotifications.js";

const ctxRow = {
  id: "r1", employee_id: "e1", proposed_joining_date: "2026-10-10", gap_days: 12, status: "pending",
  reinstatement_reason: "Good record at the branch", raised_by_role: "hr",
  eligibility_status: "review",
  eligibility_snapshot: { status: "review", reasons: [{ code: "ASSETS_UNRETURNED", severity: "review", message: "Company assets were not returned." }] },
  initiated_by: "u-hr", branch_head_remarks: "Reviewed the history", created_days: 3,
  employee_code: "MAS001", employee_name: "Asha Rao", branch_id: "b1", process_id: "p1", branch_name: "Pune", requester_name: "Hema HR",
};

function deps(row: unknown = ctxRow, outcome = "sent") {
  const notify = vi.fn(async () => ({ outcome }));
  return {
    notify,
    d: {
      db: { execute: vi.fn(async () => [row ? [row] : [], []]) },
      gateway: { notify },
    } as unknown as NotifyDeps,
  };
}

describe("notifyRejoinRequested", () => {
  it("notifies the branch head of the employee's branch, once per request", async () => {
    const { notify, d } = deps();
    expect(await notifyRejoinRequested("r1", d)).toBe(true);
    const arg = notify.mock.calls[0]![0] as any;
    expect(arg.eventCode).toBe("rejoin_requested");
    expect(arg.dedupeKey).toBe("rejoin_request:r1:requested");
    expect(arg.context).toMatchObject({ employeeId: "e1", branchId: "b1", processId: "p1" });
    expect(arg.entityType).toBe("employee_reactivation_request");
    expect(arg.entityId).toBe("r1");
    expect(arg.data).toMatchObject({ employee_name: "Asha Rao", employee_code: "MAS001", branch_name: "Pune", requester_name: "Hema HR", requester_role: "hr", gap_days: 12, eligibility_status: "review", proposed_joining_date: "2026-10-10", request_id: "r1" });
    expect(arg.data.review_reasons).toContain("Company assets were not returned.");
    expect(arg.specOverride).toBeUndefined();
  });

  it("returns false and never throws when the request cannot be found", async () => {
    const { notify, d } = deps(null);
    expect(await notifyRejoinRequested("nope", d)).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it("returns false and never throws when the gateway throws", async () => {
    const d = { db: { execute: vi.fn(async () => [[ctxRow], []]) }, gateway: { notify: vi.fn(async () => { throw new Error("smtp down"); }) } } as unknown as NotifyDeps;
    await expect(notifyRejoinRequested("r1", d)).resolves.toBe(false);
  });

  it("counts shadow as handled, and disabled / duplicate as not sent", async () => {
    expect(await notifyRejoinRequested("r1", deps(ctxRow, "shadow").d)).toBe(true);
    expect(await notifyRejoinRequested("r1", deps(ctxRow, "disabled").d)).toBe(false);
    expect(await notifyRejoinRequested("r1", deps(ctxRow, "duplicate").d)).toBe(false);
  });
});

describe("notifyRejoinDecided", () => {
  it("addresses the requester with HR and branch payroll in cc, and dedupes per decision", async () => {
    const { notify, d } = deps();
    await notifyRejoinDecided("r1", "approved", d);
    const arg = notify.mock.calls[0]![0] as any;
    expect(arg.eventCode).toBe("rejoin_decided");
    expect(arg.dedupeKey).toBe("rejoin_request:r1:decided:approved");
    expect(arg.specOverride.to).toEqual([{ kind: "user", userId: "u-hr" }]);
    expect(arg.specOverride.cc).toEqual([
      { kind: "role_scope", roleKeys: ["hr"], scope: { type: "all" }, limit: 10 },
      { kind: "payroll_hr", branchId: "b1" },
    ]);
    expect(arg.data).toMatchObject({ decision: "approved", remarks: "Reviewed the history" });
  });

  it("a rejection is a separate notification from an approval", async () => {
    const { notify, d } = deps();
    await notifyRejoinDecided("r1", "rejected", d);
    expect((notify.mock.calls[0]![0] as any).dedupeKey).toBe("rejoin_request:r1:decided:rejected");
  });
});

describe("notifyRejoinReminder / Escalation", () => {
  it("puts the reminder number in the dedupe key so each reminder fires once", async () => {
    const { notify, d } = deps();
    await notifyRejoinReminder("r1", 2, d);
    const arg = notify.mock.calls[0]![0] as any;
    expect(arg.eventCode).toBe("rejoin_pending_reminder");
    expect(arg.dedupeKey).toBe("rejoin_request:r1:reminder:2");
    expect(arg.data).toMatchObject({ reminder_no: 2, days_waiting: 3 });
  });

  it("escalation goes to HR through the configured spec and fires once", async () => {
    const { notify, d } = deps();
    await notifyRejoinEscalation("r1", d);
    const arg = notify.mock.calls[0]![0] as any;
    expect(arg.eventCode).toBe("rejoin_pending_escalation");
    expect(arg.dedupeKey).toBe("rejoin_request:r1:escalated");
    expect(arg.specOverride).toBeUndefined();
  });
});

describe("notifyFollowUpAttention", () => {
  it("lists only the failed steps, and does nothing when all steps passed", async () => {
    const { notify, d } = deps();
    expect(await notifyFollowUpAttention("r1", [{ step: "auth", ok: true }], d)).toBe(false);
    expect(notify).not.toHaveBeenCalled();
    await notifyFollowUpAttention("r1", [
      { step: "auth", ok: false, detail: "No login account is linked" },
      { step: "lms", ok: true },
      { step: "it_provisioning", ok: false, detail: "IT down" },
    ], d);
    const arg = notify.mock.calls[0]![0] as any;
    expect(arg.eventCode).toBe("rejoin_followup_attention");
    expect(arg.dedupeKey).toBe("rejoin_request:r1:followup_attention");
    expect(arg.data.failed_count).toBe(2);
    expect(arg.data.failed_steps).toContain("auth: No login account is linked");
    expect(arg.data.failed_steps).toContain("it_provisioning: IT down");
    expect(arg.data.failed_steps).not.toContain("lms");
  });
});

describe("notifyRejoinBlockedAtJoining", () => {
  it("alerts HR once per candidate with the former employee's details", async () => {
    const notify = vi.fn(async () => ({ outcome: "sent" }));
    const d = { db: { execute: vi.fn(async () => [[{ candidate_name: "Asha Rao", branch_id: "b1" }], []]) }, gateway: { notify } } as unknown as NotifyDeps;
    const ok = await notifyRejoinBlockedAtJoining({
      candidateId: "c1",
      leaver: { employeeId: "e1", employeeCode: "MAS001", fullName: "Asha Rao", employmentStatus: "resigned" },
      message: "Raise a rejoin request for MAS001.",
    }, d);
    expect(ok).toBe(true);
    const arg = notify.mock.calls[0]![0] as any;
    expect(arg.eventCode).toBe("rejoin_blocked_at_joining");
    expect(arg.dedupeKey).toBe("ats_candidate:c1:rejoin_blocked");
    expect(arg.data).toMatchObject({ candidate_name: "Asha Rao", employee_code: "MAS001", employment_status: "resigned", outcome_message: "Raise a rejoin request for MAS001." });
  });

  it("never throws", async () => {
    const d = { db: { execute: vi.fn(async () => { throw new Error("db"); }) }, gateway: { notify: vi.fn() } } as unknown as NotifyDeps;
    await expect(notifyRejoinBlockedAtJoining({ candidateId: "c1", leaver: { employeeId: "e", employeeCode: "X", fullName: "Y", employmentStatus: "z" }, message: "m" }, d)).resolves.toBe(false);
  });
});
```

(`created_days: 3` in `ctxRow` stands for the loader's `DATEDIFF(NOW(), r.created_at) AS created_days` column.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run src/modules/employees/rehire/__tests__/rejoinNotifications.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

```ts
import type { RowDataPacket } from "mysql2";
import { db as pool } from "../../../db/mysql.js";
import { notificationGateway } from "../../communication/notification.gateway.js";
import type { RecipientSpec } from "../../../shared/recipient-resolver.types.js";
import type { SqlExecutor } from "./rehireFacts.js";
import type { FollowUpResult } from "./rejoinFollowUps.js";

export interface NotifyDeps {
  db: SqlExecutor;
  gateway: { notify: (input: any) => Promise<{ outcome: string }> };
}
const realDeps: NotifyDeps = { db: pool as unknown as SqlExecutor, gateway: notificationGateway };

/**
 * Every function here is best-effort and NEVER throws: a notification problem must not break a raise, an
 * approval or an ATS conversion. They return true when the gateway handled it (sent, or shadow-mode) and
 * false otherwise (disabled, duplicate, undeliverable, error).
 *
 * Leavers cannot be addressed: the `employee` selector only resolves active employees. All recipients are
 * the branch head, HR, branch payroll, or the requester (an active HR user / manager).
 */

const HR_ALL = { kind: "role_scope", roleKeys: ["hr"], scope: { type: "all" }, limit: 10 } as const;

interface RequestContext {
  requestId: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  branchId: string | null;
  processId: string | null;
  branchName: string;
  proposedJoiningDate: string;
  gapDays: number;
  reason: string;
  raisedByRole: string;
  requesterUserId: string;
  requesterName: string;
  eligibilityStatus: string;
  reviewReasons: string;
  remarks: string;
  daysWaiting: number;
}

const CONTEXT_SQL = `
  SELECT r.id, r.employee_id, DATE_FORMAT(r.proposed_joining_date, '%Y-%m-%d') AS proposed_joining_date,
         r.gap_days, r.status, r.reinstatement_reason, r.raised_by_role, r.eligibility_status,
         r.eligibility_snapshot, r.initiated_by, r.branch_head_remarks,
         DATEDIFF(NOW(), r.created_at) AS created_days,
         e.employee_code, COALESCE(NULLIF(e.full_name, ''), CONCAT(e.first_name, ' ', e.last_name)) AS employee_name,
         e.branch_id, e.process_id, b.branch_name,
         COALESCE(NULLIF(ru.full_name, ''), CONCAT(ru.first_name, ' ', ru.last_name)) AS requester_name
    FROM employee_reactivation_requests r
    JOIN employees e ON e.id = r.employee_id
    LEFT JOIN branch_master b ON b.id = e.branch_id
    LEFT JOIN employees ru ON ru.user_id = r.initiated_by
   WHERE r.id = ?`;

async function loadContext(db: SqlExecutor, requestId: string): Promise<RequestContext | null> {
  const [rows] = await db.execute<RowDataPacket[]>(CONTEXT_SQL, [requestId]);
  const r = rows[0];
  if (!r) return null;
  // mysql2 returns a JSON column as an object; tolerate a string too.
  let snapshot: any = r.eligibility_snapshot;
  if (typeof snapshot === "string") {
    try { snapshot = JSON.parse(snapshot); } catch { snapshot = null; }
  }
  const reasons: string[] = Array.isArray(snapshot?.reasons) ? snapshot.reasons.map((x: any) => String(x.message)) : [];
  return {
    requestId: String(r.id),
    employeeId: String(r.employee_id),
    employeeCode: String(r.employee_code ?? ""),
    employeeName: String(r.employee_name ?? "").trim(),
    branchId: r.branch_id ?? null,
    processId: r.process_id ?? null,
    branchName: String(r.branch_name ?? ""),
    proposedJoiningDate: String(r.proposed_joining_date),
    gapDays: Number(r.gap_days ?? 0),
    reason: String(r.reinstatement_reason ?? ""),
    raisedByRole: String(r.raised_by_role ?? ""),
    requesterUserId: String(r.initiated_by),
    requesterName: String(r.requester_name ?? "").trim() || "HR",
    eligibilityStatus: String(r.eligibility_status ?? ""),
    reviewReasons: reasons.join(" "),
    remarks: String(r.branch_head_remarks ?? ""),
    daysWaiting: Number(r.created_days ?? 0),
  };
}

const handled = (outcome: string) => outcome === "sent" || outcome === "shadow";

async function send(
  label: string,
  requestId: string,
  d: NotifyDeps,
  build: (c: RequestContext) => { eventCode: string; dedupeKey: string; data: Record<string, unknown>; specOverride?: RecipientSpec },
): Promise<boolean> {
  try {
    const c = await loadContext(d.db, requestId);
    if (!c) return false;
    const n = build(c);
    const res = await d.gateway.notify({
      eventCode: n.eventCode,
      dedupeKey: n.dedupeKey,
      context: { employeeId: c.employeeId, branchId: c.branchId, processId: c.processId },
      entityType: "employee_reactivation_request",
      entityId: c.requestId,
      correlationId: `rejoin:${c.requestId}`,
      data: {
        request_id: c.requestId,
        employee_name: c.employeeName,
        employee_code: c.employeeCode,
        branch_name: c.branchName,
        proposed_joining_date: c.proposedJoiningDate,
        ...n.data,
      },
      ...(n.specOverride ? { specOverride: n.specOverride } : {}),
    });
    return handled(res.outcome);
  } catch (err) {
    console.error(`[rejoin-notify] ${label} ${requestId}:`, (err as Error).message);
    return false;
  }
}

export function notifyRejoinRequested(requestId: string, d: NotifyDeps = realDeps): Promise<boolean> {
  return send("requested", requestId, d, (c) => ({
    eventCode: "rejoin_requested",
    dedupeKey: `rejoin_request:${c.requestId}:requested`,
    data: {
      requester_name: c.requesterName, requester_role: c.raisedByRole, gap_days: c.gapDays,
      eligibility_status: c.eligibilityStatus, review_reasons: c.reviewReasons, reason: c.reason,
    },
  }));
}

export function notifyRejoinDecided(requestId: string, decision: "approved" | "rejected", d: NotifyDeps = realDeps): Promise<boolean> {
  return send("decided", requestId, d, (c) => ({
    eventCode: "rejoin_decided",
    dedupeKey: `rejoin_request:${c.requestId}:decided:${decision}`,
    data: { decision, remarks: c.remarks },
    // The requester is dynamic, so the producer sets the recipients: requester to, HR and branch payroll cc.
    specOverride: {
      to: [{ kind: "user", userId: c.requesterUserId }],
      cc: [{ ...HR_ALL, roleKeys: [...HR_ALL.roleKeys] }, { kind: "payroll_hr", branchId: c.branchId ?? undefined }],
    },
  }));
}

export function notifyRejoinReminder(requestId: string, reminderNo: number, d: NotifyDeps = realDeps): Promise<boolean> {
  return send("reminder", requestId, d, (c) => ({
    eventCode: "rejoin_pending_reminder",
    dedupeKey: `rejoin_request:${c.requestId}:reminder:${reminderNo}`,
    data: { reminder_no: reminderNo, days_waiting: c.daysWaiting },
  }));
}

export function notifyRejoinEscalation(requestId: string, d: NotifyDeps = realDeps): Promise<boolean> {
  return send("escalation", requestId, d, (c) => ({
    eventCode: "rejoin_pending_escalation",
    dedupeKey: `rejoin_request:${c.requestId}:escalated`,
    data: { days_waiting: c.daysWaiting, requester_name: c.requesterName },
  }));
}

export async function notifyFollowUpAttention(requestId: string, steps: FollowUpResult[], d: NotifyDeps = realDeps): Promise<boolean> {
  const failed = steps.filter((s) => !s.ok);
  if (failed.length === 0) return false;
  return send("followup", requestId, d, (c) => ({
    eventCode: "rejoin_followup_attention",
    dedupeKey: `rejoin_request:${c.requestId}:followup_attention`,
    data: { failed_count: failed.length, failed_steps: failed.map((s) => `${s.step}: ${s.detail ?? "failed"}`).join("; ") },
  }));
}

export interface BlockedAtJoining {
  candidateId: string;
  leaver: { employeeId: string; employeeCode: string; fullName: string; employmentStatus: string };
  message: string;
}

export async function notifyRejoinBlockedAtJoining(p: BlockedAtJoining, d: NotifyDeps = realDeps): Promise<boolean> {
  try {
    const [rows] = await d.db.execute<RowDataPacket[]>(
      `SELECT COALESCE(NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), ''), candidate_code) AS candidate_name,
              NULL AS branch_id
         FROM ats_candidate WHERE id = ?`,
      [p.candidateId],
    );
    const res = await d.gateway.notify({
      eventCode: "rejoin_blocked_at_joining",
      dedupeKey: `ats_candidate:${p.candidateId}:rejoin_blocked`,
      context: { employeeId: p.leaver.employeeId },
      entityType: "ats_candidate",
      entityId: p.candidateId,
      correlationId: `ats-rejoin:${p.candidateId}`,
      data: {
        candidate_name: String(rows[0]?.candidate_name ?? "A candidate"),
        employee_name: p.leaver.fullName,
        employee_code: p.leaver.employeeCode,
        employment_status: p.leaver.employmentStatus,
        outcome_message: p.message,
      },
    });
    return handled(res.outcome);
  } catch (err) {
    console.error(`[rejoin-notify] blocked-at-joining ${p.candidateId}:`, (err as Error).message);
    return false;
  }
}
```

Adapt the `ats_candidate` name columns to what really exists (check `backend/sql/schema-snapshot.json` for `first_name`, `last_name`, `candidate_code`; if the name columns differ use the real ones). The test mocks `execute` to return `{ candidate_name: "Asha Rao" }` regardless of the SQL text.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx vitest run src/modules/employees/rehire/__tests__/rejoinNotifications.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors. If the `RecipientSpec` literal typing complains about `HR_ALL`, build the selector as a fresh object literal inside `notifyRejoinDecided` instead of spreading.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/employees/rehire
git commit -m "feat(rejoin): non-throwing notifications for raise, decision, reminder, escalation, follow-up, ATS block

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Wire notifications into the routes

**Files:**
- Modify: `backend/src/modules/employees/employee-reactivation.routes.ts`
- Modify: `backend/src/modules/employees/rehire/__tests__/rejoinRoutes.test.ts`, `backend/src/modules/employees/__tests__/employee-reactivation-scope.test.ts` (add the module mock)

Behaviour: after the request row is inserted in `initiate` call `notifyRejoinRequested(String(result.insertId))`. **Careful:** the table's primary key is `CHAR(36) DEFAULT (UUID())`, so `result.insertId` is 0, not the id. Read the real id back (`SELECT id FROM employee_reactivation_requests WHERE employee_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`) — this is also the correct id to return to the UI; check what `initiate` currently returns as `id` (Plan 1 returned `result.insertId`, which would be wrong for a UUID key). If it is wrong, fix it as part of this task and add a test asserting the response `id` is the UUID. In `branch-action` after the commit and the follow-ups: approved → `notifyRejoinDecided(id, "approved")` and, if any follow-up has `ok:false`, `notifyFollowUpAttention(id, followUps)`; rejected → `notifyRejoinDecided(id, "rejected")`. All calls are `void`-style best effort: await inside try/catch so a notification problem cannot change the HTTP result.

- [ ] **Step 1: Add the failing tests**

In `rejoinRoutes.test.ts` add next to the other hoisted mocks:

```ts
const { notifyRejoinRequested, notifyRejoinDecided, notifyFollowUpAttention } = vi.hoisted(() => ({
  notifyRejoinRequested: vi.fn(), notifyRejoinDecided: vi.fn(), notifyFollowUpAttention: vi.fn(),
}));
vi.mock("../rejoinNotifications.js", () => ({ notifyRejoinRequested, notifyRejoinDecided, notifyFollowUpAttention }));
```

reset/resolve them in `beforeEach` (`mockResolvedValue(true)`), and add tests:
- initiate success notifies the branch head with the **real request id** and returns that id (mock the id read-back query to return `[{ id: "req-uuid-1" }]`);
- initiate does not notify when blocked (400) or when the manager is out of scope (403);
- approve calls `notifyRejoinDecided("r1", "approved")` after the commit (record call order with the commit mock, like the follow-up ordering test);
- approve with a failed follow-up (`[{step:"it_provisioning", ok:false}]`) also calls `notifyFollowUpAttention("r1", followUps)`, and with all-ok follow-ups does not;
- reject calls `notifyRejoinDecided("r1", "rejected")`;
- a throwing notifier (`mockRejectedValue`) does not change the status code (still 201 / 200).
Add the same `vi.mock("../rehire/rejoinNotifications.js", ...)` to `employee-reactivation-scope.test.ts` (it mocks `authMiddleware` partially, like the follow-up mocks added in Plan 3a).

- [ ] **Step 2: Run to verify they fail**, implement the handler edits, run again until they pass.

- [ ] **Step 3: Verify**

Run: `cd backend && npx vitest run src/modules/employees src/platform src/db tests 2>&1 | tail -12 && npx tsc --noEmit`
Expected: only the 3 known failing files fail.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/employees
git commit -m "feat(rejoin): notify on raise, decision and follow-up failure; return the real request id

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Reminder and escalation worker

**Files:**
- Create: `backend/src/workers/rejoin-pending-reminder.worker.ts`
- Modify: `backend/src/workers/all-workers.ts`, `backend/src/server.ts`
- Test: `backend/src/workers/__tests__/rejoin-pending-reminder.worker.test.ts`

Schedule: reminder 1 when a pending request is 48h old, reminder 2 at 96h, escalation once at 5 days. Only requests created on or after the rollout date (so requests from the old flow are not blasted). Each reminder advances `reminder_count` whether or not the send succeeded, which bounds an unreachable branch head. Escalation is claimed with `INSERT IGNORE`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { runRejoinReminderSweep, REMINDER_EVERY_HOURS, MAX_REMINDERS, ESCALATE_AFTER_DAYS } from "../rejoin-pending-reminder.worker.js";

function exec(map: Record<string, unknown[] | Error | { affectedRows: number }>) {
  return {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const key = Object.keys(map).find((k) => sql.includes(k));
      const v = key ? map[key] : [];
      if (v instanceof Error) throw v;
      return [v, []];
    }),
  };
}
const deps = (over: Partial<{ r: boolean; e: boolean }> = {}) => ({
  notifyReminder: vi.fn(async () => over.r ?? true),
  notifyEscalation: vi.fn(async () => over.e ?? true),
});

describe("constants", () => {
  it("nudges at 48h and 96h and escalates at 5 days", () => {
    expect(REMINDER_EVERY_HOURS).toBe(48);
    expect(MAX_REMINDERS).toBe(2);
    expect(ESCALATE_AFTER_DAYS).toBe(5);
  });
});

describe("runRejoinReminderSweep", () => {
  it("sends the next reminder number and advances the counter", async () => {
    const e = exec({
      "reminder_count < ?": [{ id: "r1", reminder_count: 0 }, { id: "r2", reminder_count: 1 }],
      "rejoin_request_escalation x": [],
    });
    const d = deps();
    const out = await runRejoinReminderSweep(e as never, d);
    expect(d.notifyReminder).toHaveBeenNthCalledWith(1, "r1", 1);
    expect(d.notifyReminder).toHaveBeenNthCalledWith(2, "r2", 2);
    const updates = e.execute.mock.calls.filter(([s]) => String(s).includes("UPDATE employee_reactivation_requests"));
    expect(updates).toHaveLength(2);
    expect(String(updates[0]![0])).toMatch(/reminder_count\s*=\s*reminder_count\s*\+\s*1/);
    expect(out).toMatchObject({ reminded: 2, failed: 0 });
  });

  it("advances the counter even when the send fails, so an unreachable approver is bounded", async () => {
    const e = exec({ "reminder_count < ?": [{ id: "r1", reminder_count: 0 }], "rejoin_request_escalation x": [] });
    const d = deps({ r: false });
    const out = await runRejoinReminderSweep(e as never, d);
    expect(e.execute.mock.calls.some(([s]) => String(s).includes("UPDATE employee_reactivation_requests"))).toBe(true);
    expect(out).toMatchObject({ reminded: 0, failed: 1 });
  });

  it("a throwing notifier is counted as failed, never aborts the sweep", async () => {
    const e = exec({ "reminder_count < ?": [{ id: "r1", reminder_count: 0 }, { id: "r2", reminder_count: 0 }], "rejoin_request_escalation x": [] });
    const d = { notifyReminder: vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(true), notifyEscalation: vi.fn(async () => true) };
    const out = await runRejoinReminderSweep(e as never, d);
    expect(d.notifyReminder).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({ reminded: 1, failed: 1 });
  });

  it("escalates a stale request exactly once, only if it wins the claim", async () => {
    const e = {
      execute: vi.fn(async (sql: string) => {
        if (sql.includes("reminder_count < ?")) return [[], []];
        if (sql.includes("rejoin_request_escalation x")) return [[{ id: "r9" }, { id: "r10" }], []];
        if (sql.includes("INSERT IGNORE INTO rejoin_request_escalation")) {
          // r9 claim wins, r10 was already claimed by another worker
          const calls = e.execute.mock.calls.filter(([s]) => String(s).includes("INSERT IGNORE INTO rejoin_request_escalation")).length;
          return [{ affectedRows: calls === 1 ? 1 : 0 }, []];
        }
        return [[], []];
      }),
    };
    const d = deps();
    const out = await runRejoinReminderSweep(e as never, d);
    expect(d.notifyEscalation).toHaveBeenCalledTimes(1);
    expect(d.notifyEscalation).toHaveBeenCalledWith("r9");
    expect(out.escalated).toBe(1);
  });

  it("selects only pending requests created after the rollout floor", async () => {
    const e = exec({ "reminder_count < ?": [], "rejoin_request_escalation x": [] });
    await runRejoinReminderSweep(e as never, deps());
    const q = e.execute.mock.calls.find(([s]) => String(s).includes("reminder_count < ?"))!;
    expect(String(q[0])).toMatch(/status\s*=\s*'pending'/);
    expect(String(q[0])).toMatch(/created_at\s*>=\s*\?/);
    expect(q[1]![0]).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it("a failing query is reported, not thrown", async () => {
    const e = exec({ "reminder_count < ?": new Error("db gone") });
    await expect(runRejoinReminderSweep(e as never, deps())).resolves.toMatchObject({ reminded: 0 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run src/workers/__tests__/rejoin-pending-reminder.worker.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the worker**

```ts
import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import { isWorkerEnabled, markWorkerRun } from "../shared/worker-config.js";
import { withWorkerLock, recordWorkerRun, registerTimer, unregisterTimer } from "./worker-utils.js";
import { notifyRejoinReminder, notifyRejoinEscalation } from "../modules/employees/rehire/rejoinNotifications.js";
import type { SqlExecutor } from "../modules/employees/rehire/rehireFacts.js";

// Must match the worker_config row seeded in migration 2080. isWorkerEnabled fails OPEN on a missing row.
const WORKER_NAME = "rejoin-pending-reminder";
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const STARTUP_DELAY_MS = 7 * 60 * 1000;
export const REMINDER_EVERY_HOURS = 48; // reminder 1 at 48h, reminder 2 at 96h
export const MAX_REMINDERS = 2;
export const ESCALATE_AFTER_DAYS = 5;
const MAX_PER_RUN = 100;
// Requests from the old two-step flow predate this; do not blast them.
const ROLLOUT_AT = "2026-10-04 00:00:00";

let intervalRef: ReturnType<typeof setInterval> | undefined;
let startupRef: ReturnType<typeof setTimeout> | undefined;

export interface ReminderDeps {
  notifyReminder: (requestId: string, reminderNo: number) => Promise<boolean>;
  notifyEscalation: (requestId: string) => Promise<boolean>;
}
export interface SweepResult { reminded: number; escalated: number; failed: number }

export async function runRejoinReminderSweep(exec: SqlExecutor, deps: ReminderDeps): Promise<SweepResult> {
  const out: SweepResult = { reminded: 0, escalated: 0, failed: 0 };
  try {
    // Due reminders: reminder k (0-based count) is due when the request is older than 48h x (k + 1).
    const [due] = await exec.execute<RowDataPacket[]>(
      `SELECT id, reminder_count FROM employee_reactivation_requests
        WHERE status = 'pending'
          AND created_at >= ?
          AND reminder_count < ?
          AND created_at <= DATE_SUB(NOW(), INTERVAL (? * (reminder_count + 1)) HOUR)
          AND (last_reminder_at IS NULL OR last_reminder_at < DATE_SUB(NOW(), INTERVAL 1 HOUR))
        ORDER BY created_at LIMIT ${MAX_PER_RUN}`,
      [ROLLOUT_AT, MAX_REMINDERS, REMINDER_EVERY_HOURS],
    );
    for (const row of due) {
      const reminderNo = Number(row.reminder_count) + 1;
      let ok = false;
      try {
        ok = await deps.notifyReminder(String(row.id), reminderNo);
      } catch (err) {
        console.error(`[RejoinReminder] ${row.id}:`, err instanceof Error ? err.message : err);
      }
      // Advances whether or not the send worked, so MAX_REMINDERS bounds an unreachable branch head.
      await exec.execute(
        `UPDATE employee_reactivation_requests SET reminder_count = reminder_count + 1, last_reminder_at = NOW() WHERE id = ?`,
        [row.id],
      );
      if (ok) out.reminded++; else out.failed++;
    }

    // Escalate once, after 5 days. The claim row is the once-only guard.
    const [stale] = await exec.execute<RowDataPacket[]>(
      `SELECT r.id FROM employee_reactivation_requests r
         LEFT JOIN rejoin_request_escalation x ON x.request_id = r.id
        WHERE r.status = 'pending' AND r.created_at >= ?
          AND r.created_at <= DATE_SUB(NOW(), INTERVAL ? DAY)
          AND x.request_id IS NULL
        ORDER BY r.created_at LIMIT ${MAX_PER_RUN}`,
      [ROLLOUT_AT, ESCALATE_AFTER_DAYS],
    );
    for (const row of stale) {
      const [claim] = await exec.execute<any>(`INSERT IGNORE INTO rejoin_request_escalation (request_id) VALUES (?)`, [row.id]);
      if (Number((claim as any)?.affectedRows ?? 0) !== 1) continue; // another worker got it
      try {
        if (await deps.notifyEscalation(String(row.id))) out.escalated++; else out.failed++;
      } catch (err) {
        out.failed++;
        // The claim stays: a half-delivered escalation is not retried into duplicates.
        console.error(`[RejoinReminder] escalation ${row.id}:`, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error("[RejoinReminder] sweep failed:", err instanceof Error ? err.message : err);
  }
  return out;
}

async function sweep(): Promise<void> {
  if (!(await isWorkerEnabled(WORKER_NAME))) return;
  await withWorkerLock(WORKER_NAME, async () => {
    await recordWorkerRun(WORKER_NAME, "started").catch(() => undefined);
    try {
      const res = await runRejoinReminderSweep(db as unknown as SqlExecutor, {
        notifyReminder: notifyRejoinReminder,
        notifyEscalation: notifyRejoinEscalation,
      });
      await markWorkerRun(WORKER_NAME).catch(() => undefined);
      await recordWorkerRun(WORKER_NAME, "completed", { ...res }).catch(() => undefined);
    } catch (err) {
      await recordWorkerRun(WORKER_NAME, "failed", { error: err instanceof Error ? err.message : String(err) }).catch(() => undefined);
    }
  });
}

export function startRejoinPendingReminderWorker(): void {
  if (intervalRef) return;
  startupRef = setTimeout(() => { void sweep(); }, STARTUP_DELAY_MS);
  intervalRef = setInterval(() => { void sweep(); }, CHECK_INTERVAL_MS);
  registerTimer(WORKER_NAME, intervalRef);
  console.log(`[RejoinReminder] started — sweeping hourly, first run in ${STARTUP_DELAY_MS / 60000}m`);
}

export function stopRejoinPendingReminderWorker(): void {
  if (startupRef) { clearTimeout(startupRef); startupRef = undefined; }
  if (intervalRef) {
    clearInterval(intervalRef);
    unregisterTimer(WORKER_NAME);
    intervalRef = undefined;
    console.log("[RejoinReminder] stopped");
  }
}
```

Check against `leave-approval-reminder.worker.ts` that the helper import paths (`../shared/worker-config.js`, `./worker-utils.js`) and names match exactly, and adapt if they differ.

- [ ] **Step 4: Register in BOTH places**

`backend/src/workers/all-workers.ts`: add the import next to the leave reminder import, add an entry after the `leave-approval-reminder` entry,

```ts
    {
      name: "rejoin-pending-reminder",
      start: () => { startRejoinPendingReminderWorker(); return Promise.resolve(); },
    },
```

and add `stopRejoinPendingReminderWorker();` beside `stopLeaveApprovalReminderWorker();` in the stop-all function. `backend/src/server.ts`: add the import and the `startRejoinPendingReminderWorker();` call right after `startLeaveApprovalReminderWorker();` inside the same schedulers block; **verify that block's guard** (read the lines around the call) and confirm it is not executed in tests; state what you found. If a test enumerates the registered workers or checks that every worker has a `worker_config` row (`grep -rl "all-workers" backend/src --include=*.test.ts`), update it in the way that test asks.

- [ ] **Step 5: Verify**

Run: `cd backend && npx vitest run src/workers src/db tests 2>&1 | tail -12 && npx tsc --noEmit`
Expected: new tests pass; only the 3 known failing files fail.

- [ ] **Step 6: Commit**

```bash
git add backend/src
git commit -m "feat(rejoin): hourly worker nudges the branch head and escalates to HR after 5 days

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: ATS — stop a returning leaver from becoming a new employee

**Files:**
- Create: `backend/src/modules/employees/rehire/returningLeaver.ts`
- Modify: `backend/src/modules/employees/employee-creation-orchestrator.service.ts` (one call, after the `validateStatutoryInfo` block, before the underage check — and **before** `async function findActiveEmployeeByStatutoryId` if you add any helper there)
- Test: `backend/src/modules/employees/rehire/__tests__/returningLeaver.test.ts`, `backend/src/modules/employees/__tests__/returningLeaverWiring.contract.test.ts`

Outcome rules (`decideLeaverOutcome`, pure):
- any blocked reason other than `GAP_EXCEEDS_30` / `REJOIN_BEFORE_EXIT` (termination, misconduct, performance exit, disciplinary flag, repeated absconding) → `block_not_allowed` (blocks even through ATS);
- else gap over 30 days → `allow_fresh_onboarding` with a warning naming the old employee code;
- else (gap ≤ 30 or an inconsistent date) → `block_rejoin_required` (HR raises a rejoin request).

- [ ] **Step 1: Write the failing tests**

`returningLeaver.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { findReturningLeaverForCandidate, decideLeaverOutcome, checkReturningLeaver } from "../returningLeaver.js";
import type { RehireVerdict } from "../rehireEligibility.js";

function exec(map: Record<string, unknown[] | Error>) {
  return {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const key = Object.keys(map).find((k) => sql.includes(k));
      const v = key ? map[key] : [];
      if (v instanceof Error) throw v;
      return [v, []];
    }),
  };
}
const leaver = { employeeId: "e1", employeeCode: "MAS001", fullName: "Asha Rao", employmentStatus: "resigned" };
const verdict = (reasons: { code: string; severity: "blocked" | "review" }[], fresh = false): RehireVerdict => ({
  status: reasons.some((r) => r.severity === "blocked") ? "blocked" : reasons.length ? "review" : "eligible",
  reasons: reasons.map((r) => ({ ...r, message: r.code })),
  requiresFreshOnboarding: fresh,
  requiresAbscondingAck: false,
});

describe("findReturningLeaverForCandidate", () => {
  it("returns null when the candidate has no PAN or Aadhaar", async () => {
    const e = exec({ "FROM ats_candidate": [{ pan_number: null, aadhar_number: "" }] });
    expect(await findReturningLeaverForCandidate(e as never, "c1")).toBeNull();
  });

  it("matches only LEAVERS: inactive and a terminal status, never a person who did not join", async () => {
    const e = exec({
      "FROM ats_candidate": [{ pan_number: "abcde1234f", aadhar_number: "1234 5678 9012" }],
      "FROM employees e": [{ id: "e1", employee_code: "MAS001", full_name: "Asha Rao", employment_status: "resigned" }],
    });
    const out = await findReturningLeaverForCandidate(e as never, "c1");
    expect(out).toEqual(leaver);
    const q = e.execute.mock.calls.find(([s]) => String(s).includes("FROM employees e"))!;
    const sql = String(q[0]);
    expect(sql).toMatch(/e\.active_status\s*=\s*0/);
    expect(sql).toMatch(/'resigned'/);
    expect(sql).not.toMatch(/'not_joined'/);
    expect(q[1]).toContain("ABCDE1234F"); // PAN normalised to upper case
    expect(q[1]).toContain("123456789012"); // Aadhaar normalised to digits
  });

  it("returns null when nothing matches", async () => {
    const e = exec({ "FROM ats_candidate": [{ pan_number: "ABCDE1234F", aadhar_number: null }], "FROM employees e": [] });
    expect(await findReturningLeaverForCandidate(e as never, "c1")).toBeNull();
  });

  it("only compares identifiers that are present", async () => {
    const e = exec({ "FROM ats_candidate": [{ pan_number: "ABCDE1234F", aadhar_number: null }], "FROM employees e": [] });
    await findReturningLeaverForCandidate(e as never, "c1");
    const q = e.execute.mock.calls.find(([s]) => String(s).includes("FROM employees e"))!;
    expect(String(q[0])).not.toMatch(/aadhaar/i);
  });
});

describe("decideLeaverOutcome", () => {
  it("conduct-blocked leavers are blocked even through ATS", () => {
    for (const code of ["TERMINATED", "MISCONDUCT", "PERFORMANCE_ACTION", "DISCIPLINARY_FLAG", "REPEAT_ABSCONDING", "LEGACY_TERMINATED"]) {
      const o = decideLeaverOutcome(leaver, verdict([{ code, severity: "blocked" }]));
      expect(o.action).toBe("block_not_allowed");
    }
  });

  it("a conduct block wins over a long gap", () => {
    const o = decideLeaverOutcome(leaver, verdict([{ code: "TERMINATED", severity: "blocked" }, { code: "GAP_EXCEEDS_30", severity: "blocked" }], true));
    expect(o.action).toBe("block_not_allowed");
  });

  it("a long gap with a clean record may be fresh-onboarded, with a warning that names the old code", () => {
    const o = decideLeaverOutcome(leaver, verdict([{ code: "GAP_EXCEEDS_30", severity: "blocked" }], true));
    expect(o.action).toBe("allow_fresh_onboarding");
    expect((o as any).warning).toContain("MAS001");
  });

  it("a short gap means a rejoin request, with the employee code in the message", () => {
    const o = decideLeaverOutcome(leaver, verdict([]));
    expect(o.action).toBe("block_rejoin_required");
    expect((o as any).reason).toContain("MAS001");
  });

  it("review-only reasons (absconding, open clearance) still need a rejoin request, not a new record", () => {
    expect(decideLeaverOutcome(leaver, verdict([{ code: "ABSCONDING", severity: "review" }])).action).toBe("block_rejoin_required");
  });

  it("an inconsistent date (rejoin before exit) is sent to HR as a rejoin, not allowed through", () => {
    expect(decideLeaverOutcome(leaver, verdict([{ code: "REJOIN_BEFORE_EXIT", severity: "blocked" }])).action).toBe("block_rejoin_required");
  });
});

describe("checkReturningLeaver", () => {
  it("is a no-op ('none') when the candidate matches no leaver", async () => {
    const e = exec({ "FROM ats_candidate": [{ pan_number: "ABCDE1234F", aadhar_number: null }], "FROM employees e": [] });
    const r = await checkReturningLeaver(e as never, "c1", "2026-10-10");
    expect(r.outcome.action).toBe("none");
  });

  it("fails OPEN with a warning when the lookup itself errors", async () => {
    const e = exec({ "FROM ats_candidate": new Error("db gone") });
    const r = await checkReturningLeaver(e as never, "c1", "2026-10-10");
    expect(r.outcome.action).toBe("none");
    expect(r.warning).toMatch(/could not check/i);
  });
});
```

`returningLeaverWiring.contract.test.ts` (source-text guard, same style as the existing duplicate-identity contract test):

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(path.resolve(__dirname, "../employee-creation-orchestrator.service.ts"), "utf8");

describe("orchestrator: returning leaver check", () => {
  it("calls checkReturningLeaver after validateStatutoryInfo and before the age check", () => {
    const stat = SRC.indexOf("validateStatutoryInfo(conn, candidateId)");
    const leaver = SRC.indexOf("checkReturningLeaver(conn, candidateId");
    const age = SRC.indexOf("resolveVerifiedDob(candidateId");
    expect(stat).toBeGreaterThan(-1);
    expect(leaver).toBeGreaterThan(stat);
    expect(age).toBeGreaterThan(leaver);
  });

  it("blocks with critical blockers and rolls back, for both rejoin outcomes", () => {
    expect(SRC).toMatch(/type:\s*['"]rejoin_not_allowed['"]/);
    expect(SRC).toMatch(/type:\s*['"]rejoin_required['"]/);
  });

  it("keeps the existing duplicate-identity code untouched (active-employee lookup still active_status = 1 only)", () => {
    expect(SRC).toMatch(/WHERE e\.active_status = 1/);
    expect(SRC).toContain("7. No duplicate mobile/email blocking");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx vitest run src/modules/employees/rehire/__tests__/returningLeaver.test.ts src/modules/employees/__tests__/returningLeaverWiring.contract.test.ts`
Expected: FAIL — module missing; wiring assertions fail.

- [ ] **Step 3: Write `returningLeaver.ts`**

```ts
import type { RowDataPacket } from "mysql2";
import { NON_REACTIVATABLE_STATUSES } from "../../exit/exitEmploymentStatus.js";
import { evaluateRehire, type RehireVerdict } from "./rehireEligibility.js";
import { loadRehireFacts, type SqlExecutor } from "./rehireFacts.js";

export interface ReturningLeaver {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  employmentStatus: string;
}

export type LeaverOutcome =
  | { action: "none" }
  | { action: "block_rejoin_required"; reason: string }
  | { action: "block_not_allowed"; reason: string }
  | { action: "allow_fresh_onboarding"; warning: string };

/**
 * A leaver is someone who actually worked here and left. 'not_joined' is in the exit module's
 * non-reactivatable list but is NOT a leaver (an id was created and the person never started), so it is
 * excluded here: they are a normal fresh hire.
 */
const LEAVER_STATUSES = NON_REACTIVATABLE_STATUSES.filter((s) => s !== "not_joined");
const STATUS_SQL = LEAVER_STATUSES.map((s) => `'${s}'`).join(", "); // compile-time literals

const normPan = (v: unknown) => String(v ?? "").trim().toUpperCase();
const normAadhaar = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/**
 * The existing duplicate-identity check (orchestrator findActiveEmployeeByStatutoryId) matches only
 * active_status = 1, so a LEAVER matched nothing and silently became a second employee record. This is the
 * missing half: match by PAN / Aadhaar against people who left. Raw columns, because pan_blind_index is
 * empty on every employee row.
 */
export async function findReturningLeaverForCandidate(db: SqlExecutor, candidateId: string): Promise<ReturningLeaver | null> {
  const [cand] = await db.execute<RowDataPacket[]>(
    `SELECT pan_number, aadhar_number FROM ats_candidate WHERE id = ? LIMIT 1`,
    [candidateId],
  );
  const pan = normPan(cand[0]?.pan_number);
  const aadhaar = normAadhaar(cand[0]?.aadhar_number);
  if (!pan && !aadhaar) return null;

  const clauses: string[] = [];
  const params: string[] = [];
  if (pan) {
    clauses.push(`(e.pan_number IS NOT NULL AND e.pan_number <> '' AND UPPER(e.pan_number) = ?)`);
    clauses.push(`(s.pan_number IS NOT NULL AND s.pan_number <> '' AND UPPER(s.pan_number) = ?)`);
    params.push(pan, pan);
  }
  if (aadhaar) {
    clauses.push(`(e.aadhaar_number IS NOT NULL AND e.aadhaar_number <> '' AND REPLACE(e.aadhaar_number, ' ', '') = ?)`);
    clauses.push(`(s.aadhaar_id IS NOT NULL AND s.aadhaar_id <> '' AND REPLACE(s.aadhaar_id, ' ', '') = ?)`);
    params.push(aadhaar, aadhaar);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, TRIM(CONCAT_WS(' ', e.first_name, e.last_name)) AS full_name, e.employment_status
       FROM employees e
       LEFT JOIN employee_statutory_info s ON s.employee_id = e.id
      WHERE e.active_status = 0
        AND LOWER(COALESCE(e.employment_status, '')) IN (${STATUS_SQL})
        AND (${clauses.join(" OR ")})
      ORDER BY e.date_of_exit DESC
      LIMIT 1`,
    params,
  );
  const r = rows[0];
  if (!r) return null;
  return {
    employeeId: String(r.id),
    employeeCode: String(r.employee_code),
    fullName: String(r.full_name ?? "").trim(),
    employmentStatus: String(r.employment_status ?? ""),
  };
}

// Reasons that mean "this person must not come back", as opposed to "the gap is too long for a quick rejoin".
const GAP_ONLY_CODES = new Set(["GAP_EXCEEDS_30", "REJOIN_BEFORE_EXIT"]);

export function decideLeaverOutcome(leaver: ReturningLeaver, verdict: RehireVerdict): LeaverOutcome {
  const who = `${leaver.fullName} (${leaver.employeeCode}, ${leaver.employmentStatus})`;

  const conductBlock = verdict.reasons.find((r) => r.severity === "blocked" && !GAP_ONLY_CODES.has(r.code));
  if (conductBlock) {
    return {
      action: "block_not_allowed",
      reason: `This candidate is the former employee ${who}, who cannot be rehired: ${conductBlock.message} A new employee record cannot be created for them.`,
    };
  }
  if (verdict.requiresFreshOnboarding) {
    return {
      action: "allow_fresh_onboarding",
      warning: `This candidate is the former employee ${who}, away for more than 30 days, so fresh onboarding is allowed. Link the new record to ${leaver.employeeCode} for history.`,
    };
  }
  return {
    action: "block_rejoin_required",
    reason: `This candidate is the former employee ${who}. Raise a rejoin request for ${leaver.employeeCode} (Employees > Reactivation) instead of creating a new employee record.`,
  };
}

export interface LeaverCheck {
  outcome: LeaverOutcome;
  leaver: ReturningLeaver | null;
  warning?: string;
}

/**
 * One call for the orchestrator. Fails OPEN: if the lookup errors, conversion continues with a warning,
 * because failing closed would stop all hiring on a transient query error.
 */
export async function checkReturningLeaver(db: SqlExecutor, candidateId: string, joiningDate: string | null): Promise<LeaverCheck> {
  try {
    const leaver = await findReturningLeaverForCandidate(db, candidateId);
    if (!leaver) return { outcome: { action: "none" }, leaver: null };
    const proposed = (joiningDate ?? new Date().toISOString()).slice(0, 10);
    const loaded = await loadRehireFacts(db, leaver.employeeId, proposed);
    if (!loaded) return { outcome: { action: "none" }, leaver: null };
    return { outcome: decideLeaverOutcome(leaver, evaluateRehire(loaded.facts)), leaver };
  } catch (err) {
    console.error(`[returning-leaver] check failed for candidate ${candidateId}:`, (err as Error).message);
    return { outcome: { action: "none" }, leaver: null, warning: "Could not check whether this candidate is a former employee." };
  }
}
```

- [ ] **Step 4: Wire it into the orchestrator**

Add imports at the top of `employee-creation-orchestrator.service.ts`:

```ts
import { checkReturningLeaver } from "./rehire/returningLeaver.js";
import { notifyRejoinBlockedAtJoining } from "./rehire/rejoinNotifications.js";
```

Immediately after the `validateStatutoryInfo` block (which ends with `await conn.rollback(); return result; }`) and before the underage check, insert:

```ts
      // RULE 12: a returning LEAVER is a rejoin, not a new employee. findActiveEmployeeByStatutoryId only sees
      // active employees, so before this a former employee silently got a second record.
      const leaverCheck = await checkReturningLeaver(conn, candidateId, offer?.date_of_joining ?? null);
      if (leaverCheck.warning) result.warnings.push(leaverCheck.warning);
      if (leaverCheck.outcome.action === 'block_rejoin_required' || leaverCheck.outcome.action === 'block_not_allowed') {
        const blockedForGood = leaverCheck.outcome.action === 'block_not_allowed';
        result.blockers.push({
          type: blockedForGood ? 'rejoin_not_allowed' : 'rejoin_required',
          reason: leaverCheck.outcome.reason,
          severity: 'critical',
        });
        await conn.rollback();
        if (leaverCheck.leaver) {
          // Best effort, after the rollback; never throws.
          void notifyRejoinBlockedAtJoining({ candidateId, leaver: leaverCheck.leaver, message: leaverCheck.outcome.reason });
        }
        return result;
      }
      if (leaverCheck.outcome.action === 'allow_fresh_onboarding') {
        result.warnings.push(leaverCheck.outcome.warning);
      }
```

`conn` is a `PoolConnection`; `checkReturningLeaver` takes a `SqlExecutor` — if tsc complains about the `execute` generics, cast `conn as unknown as SqlExecutor` (as other callers in this module do for pool connections). Add the new function usage only; do **not** touch `findActiveEmployeeByStatutoryId` or the strings the existing contract test pins.

- [ ] **Step 5: Run the tests and the existing guards**

Run: `cd backend && npx vitest run src/modules/employees 2>&1 | tail -12 && npx tsc --noEmit`
Expected: the new tests pass, `conversion-duplicate-identity.contract.test.ts` still passes unchanged, and any existing orchestrator unit test that mocks `db` keeps passing (if one fails because it doesn't expect the extra queries, extend that test's mock to return empty rows for the `ats_candidate`/`employees e` queries — never loosen what it asserts). Run the full suite once at the end of the task; only the 3 known failing files may fail.

- [ ] **Step 6: Commit**

```bash
git add backend/src
git commit -m "feat(rejoin): stop a returning leaver being created as a new employee at ATS conversion

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Verify on a real MySQL (no prod) and the full suite

The unit tests use fake executors; this closes the gap, as in Plans 2a and 3a.

- [ ] **Step 1:** Throwaway `mysql:8.0` container (unique name `rejoin3b-scratch`, `--rm`, removed at the end; touch no other container, no real database). Build, from repo SQL with FOREIGN KEY lines stripped and columns cross-checked against `schema-snapshot.json`: `employees`, `employee_statutory_info`, `ats_candidate`, `employee_reactivation_requests` (+2079 and 2080 columns), `employee_reactivation_audit`, `rejoin_request_escalation`, `notification_event_config`, `communication_template`, `worker_config`, `branch_master`, `exit_request`, `employment_stint`, `employee_rehire_control`, `exit_clearance_checklist`, `asset_assignment`, `full_final_calculation`. Apply migration 2080 **twice**: both runs must exit 0, and the second must add no rows (6 events, 6 templates, 1 worker_config row, exactly once each).
- [ ] **Step 2:** Through a real `mysql2` pool run every new SQL: the notification context loader (with a seeded request, requester and branch), the reminder SELECT (seed requests aged 1h / 50h / 100h / 6d, one non-pending, one created before the rollout floor, and prove which are picked), the reminder counter UPDATE, the escalation SELECT + `INSERT IGNORE` claim (second claim returns `affectedRows = 0`), `findReturningLeaverForCandidate` (seed: a resigned leaver with PAN, a terminated leaver with Aadhaar, an active employee with the same PAN, a `not_joined` person with a PAN; assert the active and `not_joined` ones are never returned and PAN case / Aadhaar spaces are normalised), and `checkReturningLeaver` for: short-gap resigned leaver (→ `block_rejoin_required`), terminated leaver (→ `block_not_allowed`), 45-day-gap resigned leaver (→ `allow_fresh_onboarding`), no match (→ `none`). Any SQL error means a wrong column name: fix against the snapshot and keep unit tests green.
- [ ] **Step 3:** Run `runRejoinReminderSweep` end to end on the seeded data with recorder deps: assert exactly the right requests get reminder 1 vs 2, counters advance, escalation fires once for the 6-day request and **not again on a second sweep**.
- [ ] **Step 4:** Mount the real `employeeReactivationRouter` with the real pool and stubbed auth, notification module replaced by recorders: raise as hr → recorder saw `rejoin_requested` with the **UUID request id**, response `id` equals that UUID; approve as branch_head → `rejoin_decided` + (when a follow-up dep fails) `rejoin_followup_attention`.
- [ ] **Step 5:** Tear down the container. Run `cd backend && npm run build && npx vitest run 2>&1 | tail -20`; only the 3 known failing files may fail. Run `graphify update .` only if the command exists; do not commit `graphify-out`.
- [ ] **Step 6:** Commit any query fixes as `fix(rejoin): align reminder, notification and leaver queries with the real schema` (skip if nothing changed). Report plainly what was and was not verified (the live gateway and email delivery, the template rendering, a real login and prod are NOT exercised). Do not push.

---

## Self-Review

**Spec coverage (items this plan owns)**
- "Notify requester, HR and payroll on approval" → `rejoin_decided` (Task 2/3). "Branch head nudged day 2 and day 4; escalate after 5 days; shown in the pending list" → worker (Task 4; the pending list itself already exists). "Request with a past proposed date flagged for the requester to update" → **not built here**; it belongs with the review UI (a derived flag on the request row) and is added to the Plan 2b/UI backlog.
- "ATS/joining duplicate match against a former employee redirects to a rejoin request; a blocked leaver stops the joining and alerts HR" → Task 5 (HR alert via `rejoin_blocked_at_joining`; HR raises the request from the alert rather than the system auto-raising one, by decision above).
- Follow-up failures from Plan 3a become visible to HR (`rejoin_followup_attention`).

**Placeholders:** none. Two judgement points are called out with exact instructions: adapting the `ats_candidate` name columns to the real snapshot (Task 2 Step 3) and verifying the `server.ts` scheduler guard (Task 4 Step 4).

**Type consistency:** `NotifyDeps {db, gateway}`, the six notify function names and signatures (Task 2) are used identically in Tasks 3, 4 and 5; `FollowUpResult` comes from Plan 3a; `ReturningLeaver`, `LeaverOutcome`, `checkReturningLeaver(db, candidateId, joiningDate)` (Task 5) match the orchestrator call and tests; worker constants `REMINDER_EVERY_HOURS`, `MAX_REMINDERS`, `ESCALATE_AFTER_DAYS` and `runRejoinReminderSweep(exec, deps)` match the test.

**Risks to watch:** mock keys match SQL by substring (a key matching two statements returns the wrong rows: change the SQL text, never the key); `result.insertId` is 0 for a UUID-keyed table (Task 3 fixes the id returned and notified); the orchestrator contract test pins source strings (Task 5 adds code only before/outside the pinned regions); mysql2 returns JSON columns as objects.
