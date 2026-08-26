-- Migration: 1620_enable_wired_notification_events.sql
-- Purpose: Turn on the 36 notification events that are fully wired and have been
--          silently switched off since they were seeded.
-- Date: 2026-08-27
--
-- ── WHY ALMOST NO HRMS2 EMAIL SENDS ─────────────────────────────────────────
--
--   1022_notification_event_registry.sql seeds every event with the column list
--
--       (event_code, module, display_name, sensitivity, is_critical, recipient_spec,
--        template_key)
--
--   which omits `enabled` and `dispatch_mode`. Both therefore take their table defaults --
--   `enabled TINYINT(1) NOT NULL DEFAULT 0` and
--   `dispatch_mode ENUM(...) NOT NULL DEFAULT 'shadow'` -- so all 68 events were born
--   switched off. That was never a rollout decision; 1022's own comment at line 120 says
--   so. Commit e13457f3 (2026-08-24) noticed it for ONE module and added a post-seed
--   UPDATE for leave. The other seven were left.
--
--   Live state before this migration (verified 2026-08-27): 8 of 68 live, all leave.
--   payroll 0/15, uat 0/12, wfm 0/10, attendance 0/8, governance 0/8, exit 0/5,
--   reporting 0/2.
--
-- ── WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT ───────────────────────
--
--   Enables ONLY events with a real producer -- a file that actually calls
--   notificationGateway.notify() and names that event_code. Grepping all of src/ for the
--   bare string is not sufficient and gave a wrong answer three times while this was
--   written: weekoff_denied is also a roster decisionType, attendance_missing_punch is a
--   work_item type, and exit_clearance_pending is a SmartPing DLT SMS key. None of the
--   three notifies. __tests__/enabled-events-have-producers.test.ts enforces this.
--
--   That leaves 60 dark events accounted for as: 36 enabled here, 1 held back
--   (provisioning_overdue, below), and 23 with no producer at all. For most of those 23
--   `git log -S '<code>' -- backend/src` returns zero commits ever — they were catalogued
--   and never wired, not wired and later broken. Switching them on would change nothing
--   except make the registry lie about what is live, so they stay off until someone
--   writes the call site.
--
--   Not enabled here, on purpose:
--     provisioning_overdue -- wired, but 69 requests are already past SLA. Enabling it
--       sends that backlog at 25/run hourly. That is the intended behaviour and the
--       owner should choose the moment. One line when ready:
--         UPDATE notification_event_config SET enabled = 1, dispatch_mode = 'live'
--          WHERE event_code = 'provisioning_overdue';
--
--   Backlog check for the other sweep-driven events, so this does not open with a storm:
--     exit_lwd_approaching  -- scans a bounded forward window (LWD >= CURDATE() and
--                              <= +7 days). 0 rows match today.
--     task_sla_breach_l1/2/3 -- driven by task_tat_instance, which holds 0 rows, and the
--                              tat-escalation worker is itself worker_config.enabled = 0.
--   Everything else in the list below fires on a state change in a request path, so it
--   only ever fires on NEW activity -- there is no history for it to replay.
--
--   Rows already deliberately set to dispatch_mode='off' are preserved: the WHERE clause
--   touches only rows still sitting at the accidental default. Same guard e13457f3 used.
--
-- Purely a data change: no schema, no new column, no row deleted. Reversible by setting
-- enabled = 0 for any event_code below.

UPDATE notification_event_config
   SET enabled = 1,
       dispatch_mode = 'live'
 WHERE enabled = 0
   AND dispatch_mode = 'shadow'
   AND event_code IN (
     -- attendance (3) — regularisation lifecycle, all request-path.
     -- NOT attendance_missing_punch: its only occurrences are a work_item `type`
     -- in attendance-engine.service.ts, not an eventCode passed to notify().
     'regularization_submitted',
     'regularization_stage2_pending',
     'regularization_decision',

     -- exit (4) — resignation lifecycle and the bounded LWD lookahead.
     -- NOT exit_clearance_pending: its only occurrence is a `key` in the SmartPing DLT
     -- template registry, which is the SMS catalogue, not a gateway call site.
     'resignation_submitted',
     'resignation_decision',
     'resignation_revoked',
     'exit_lwd_approaching',

     -- governance (3) — TAT breach ladder; the instance table is empty and its worker
     -- is separately disabled, so these arm without firing
     'task_sla_breach_l1',
     'task_sla_breach_l2',
     'task_sla_breach_l3',

     -- payroll (12) — run lifecycle, payslip, F&F, statutory opt-out, increment
     'payroll_run_calculated',
     'payroll_run_under_review',
     'payroll_run_approved',
     'payroll_run_locked',
     'payroll_window_closing',
     'payslip_ready',
     'salary_advance_recovery',
     'salary_increment_letter',
     'statutory_opt_out_submitted',
     'statutory_opt_out_decided',
     'statutory_opt_out_revoked',
     'full_final_ready',

     -- uat (12) — internal release governance
     'uat_approval_requested',
     'uat_approval_decided',
     'uat_feedback_assigned',
     'uat_feedback_blocked',
     'uat_feedback_needs_info',
     'uat_pr_ready',
     'uat_build_failed',
     'uat_deployed_for_retest',
     'uat_retest_failed',
     'uat_rolled_back',
     'uat_released',
     'uat_closed',

     -- wfm (2) — roster publication and shift change.
     -- NOT weekoff_denied: despite the matching name its only occurrence is a
     -- `decisionType` string written to the roster decision audit in
     -- roster-generation.service.ts. Nothing notifies on it.
     'roster_published',
     'shift_changed'
   );
