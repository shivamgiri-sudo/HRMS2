-- Migration 1041: ATS SLA and TAT rules seed
-- Safe to re-run: INSERT IGNORE skips duplicates on unique key (task_type, branch_id)

-- 1. ATS Queue wait SLA (30 min = 0.5 hours default)
INSERT IGNORE INTO tat_matrix_master (id, task_type, task_description, default_tat_hours, is_active)
VALUES (UUID(), 'ATS_QUEUE_WAIT', 'Walk-in queue wait time before SLA alert', 0.5, 1);

-- 2. ATS Recruitment lifecycle TAT rules
INSERT IGNORE INTO tat_matrix_master (id, task_type, task_description, default_tat_hours, is_active)
VALUES
  (UUID(), 'ATS_INTERVIEW_RESULT', 'Interview feedback submission', 4, 1),
  (UUID(), 'ATS_OFFER_LETTER', 'Offer letter generation after selection', 24, 1),
  (UUID(), 'ATS_CANDIDATE_DOCS', 'Document submission after offer acceptance', 48, 1),
  (UUID(), 'ATS_BGV_RESULT', 'BGV result update after initiation', 72, 1),
  (UUID(), 'ATS_JOINING_CONFIRMATION', 'Joining confirmation after DOJ', 4, 1),
  (UUID(), 'ATS_ONBOARDING_COMPLETE', 'Full onboarding checklist completion', 48, 1);

-- 3. Default escalation rules for ATS_QUEUE_WAIT
-- Level 1: immediate notify to recruiter
-- Level 2: 1 hour after breach, notify HR
-- Level 3: 2 hours after breach, notify Branch Head
INSERT IGNORE INTO escalation_matrix_master (id, task_type, escalation_level, trigger_after_hours, notify_role, escalation_action, is_active)
VALUES
  (UUID(), 'ATS_QUEUE_WAIT', 1, 0, 'recruiter', 'notify', 1),
  (UUID(), 'ATS_QUEUE_WAIT', 2, 1, 'hr', 'notify', 1),
  (UUID(), 'ATS_QUEUE_WAIT', 3, 2, 'branch_head', 'notify', 1);
