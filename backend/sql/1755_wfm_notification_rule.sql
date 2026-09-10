-- Roster Notification Hub (/wfm/notification-hub) was pure front-end mock: 8 hardcoded
-- rules in React state, "Save All Settings" only called setTimeout + a success toast, no
-- backend call anywhere in the file. Nothing a WFM/HR admin configured there ever persisted
-- or affected real alert delivery. This table gives it a real, editable, persisted source.
--
-- Global (tenant-wide) config, not per-employee — matches the page's own model: one row per
-- alert_type, configuring who gets notified company-wide, not a personal preference screen
-- (that already exists separately as employee_roster_preference).
CREATE TABLE IF NOT EXISTS wfm_notification_rule (
  id VARCHAR(36) NOT NULL DEFAULT (UUID()),
  alert_type VARCHAR(64) NOT NULL,
  alert_name VARCHAR(120) NOT NULL,
  description VARCHAR(255) NULL,
  recipients_json JSON NOT NULL,
  channels_json JSON NOT NULL,
  frequency ENUM('immediate','hourly','daily','weekly') NOT NULL DEFAULT 'immediate',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  threshold_pct INT NULL,
  schedule_time TIME NULL,
  updated_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_wfm_notification_rule_alert_type (alert_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Seed with the same 8 rules the mock UI already showed, so the page's first real load looks
-- identical to what users have been seeing — nothing changes visually, only "Save" now works.
INSERT IGNORE INTO wfm_notification_rule
  (alert_type, alert_name, description, recipients_json, channels_json, frequency, enabled, threshold_pct, schedule_time)
VALUES
  ('UNPLANNED_ABSENCE', 'Unplanned Absence Alert', 'Notify when employee is absent without prior leave request', JSON_ARRAY('manager','wfm'), JSON_ARRAY('email','push'), 'immediate', 1, NULL, NULL),
  ('MANAGER_DIGEST', 'Daily Manager Digest', 'Summary of team attendance, pending approvals, and roster changes', JSON_ARRAY('manager'), JSON_ARRAY('email'), 'daily', 1, NULL, '08:00:00'),
  ('COMPLIANCE_VIOLATION', 'Compliance Violation Alert', 'Alert when WFM rules are violated (rest policy, consecutive days)', JSON_ARRAY('wfm','hr'), JSON_ARRAY('email','push'), 'immediate', 1, NULL, NULL),
  ('ROSTER_PUBLISHED', 'Roster Published', 'Notify employees when new roster is published for their team', JSON_ARRAY('employee'), JSON_ARRAY('push'), 'immediate', 1, NULL, NULL),
  ('SHIFT_CHANGE', 'Shift Change Notice', 'Alert employee when their assigned shift is modified', JSON_ARRAY('employee','manager'), JSON_ARRAY('email','push','sms'), 'immediate', 1, NULL, NULL),
  ('COVERAGE_GAP', 'Coverage Gap Warning', 'Alert when staffing falls below minimum threshold', JSON_ARRAY('wfm','operations_manager'), JSON_ARRAY('email','push'), 'immediate', 1, 80, NULL),
  ('WEEKOFF_REQUEST', 'Week-off Request Pending', 'Remind manager of pending week-off requests', JSON_ARRAY('manager'), JSON_ARRAY('email'), 'daily', 0, NULL, '09:00:00'),
  ('AT_RISK_EMPLOYEE', 'At-Risk Employee Alert', 'Notify HR when employee enters HIGH/CRITICAL risk tier', JSON_ARRAY('hr','manager'), JSON_ARRAY('email','push'), 'immediate', 1, NULL, NULL);
