-- ============================================================================
-- Notification System Monitoring Queries
-- ============================================================================
-- Purpose: Ready-to-use SQL queries for monitoring notification health
-- Usage: Copy and run in MySQL client or monitoring dashboard
-- ============================================================================

USE mas_hrms;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Daily Notification Stats (Last 7 Days)
-- ────────────────────────────────────────────────────────────────────────────
SELECT
  DATE(created_at) as date,
  template_code,
  channel,
  COUNT(*) as total,
  SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
  ROUND(100.0 * SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate_pct
FROM notification_log
WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY DATE(created_at), template_code, channel
ORDER BY date DESC, template_code, channel;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Template Performance Summary (Last 24 Hours)
-- ────────────────────────────────────────────────────────────────────────────
SELECT
  template_code,
  COUNT(*) as total_sent,
  SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as successful,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
  SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) as bounced,
  ROUND(100.0 * SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate_pct,
  MIN(created_at) as first_sent,
  MAX(created_at) as last_sent
FROM notification_log
WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
GROUP BY template_code
ORDER BY total_sent DESC;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Failed Notifications (Last 24 Hours)
-- ────────────────────────────────────────────────────────────────────────────
SELECT
  id,
  template_code,
  recipient_type,
  recipient_email,
  recipient_mobile,
  channel,
  status,
  error_message,
  created_at
FROM notification_log
WHERE status = 'failed'
  AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
ORDER BY created_at DESC
LIMIT 50;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. SLA Breach Alerts (Last 24 Hours)
-- ────────────────────────────────────────────────────────────────────────────
SELECT
  DATE_FORMAT(created_at, '%Y-%m-%d %H:00') as hour,
  COUNT(*) as alert_count,
  COUNT(DISTINCT recipient_id) as unique_candidates,
  ROUND(AVG(CAST(SUBSTRING_INDEX(body, 'waiting for more than ', -1) AS UNSIGNED)), 0) as avg_wait_minutes
FROM notification_log
WHERE template_code = 'SLA_BREACH'
  AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d %H:00')
ORDER BY hour DESC;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Hourly Notification Volume (Today)
-- ────────────────────────────────────────────────────────────────────────────
SELECT
  DATE_FORMAT(created_at, '%H:00') as hour,
  COUNT(*) as total_notifications,
  SUM(CASE WHEN channel = 'email' THEN 1 ELSE 0 END) as emails,
  SUM(CASE WHEN channel = 'sms' THEN 1 ELSE 0 END) as sms,
  SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as successful
FROM notification_log
WHERE DATE(created_at) = CURDATE()
GROUP BY DATE_FORMAT(created_at, '%H:00')
ORDER BY hour;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Top 10 Recipients by Notification Count (Last 7 Days)
-- ────────────────────────────────────────────────────────────────────────────
SELECT
  recipient_email,
  recipient_type,
  COUNT(*) as notification_count,
  GROUP_CONCAT(DISTINCT template_code ORDER BY template_code) as templates_received,
  MAX(created_at) as last_notified
FROM notification_log
WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
  AND recipient_email IS NOT NULL
GROUP BY recipient_email, recipient_type
ORDER BY notification_count DESC
LIMIT 10;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Notification Delivery Time (Email - if sent_at is populated)
-- ────────────────────────────────────────────────────────────────────────────
SELECT
  template_code,
  COUNT(*) as total,
  ROUND(AVG(TIMESTAMPDIFF(SECOND, created_at, sent_at)), 2) as avg_delivery_seconds,
  MIN(TIMESTAMPDIFF(SECOND, created_at, sent_at)) as min_delivery_seconds,
  MAX(TIMESTAMPDIFF(SECOND, created_at, sent_at)) as max_delivery_seconds
FROM notification_log
WHERE status = 'sent'
  AND sent_at IS NOT NULL
  AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
GROUP BY template_code
ORDER BY avg_delivery_seconds DESC;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Candidates Missing Expected Notifications
-- ────────────────────────────────────────────────────────────────────────────
-- Candidates who were selected/rejected but didn't receive notification
SELECT
  c.id,
  c.full_name,
  c.email,
  c.status,
  c.current_stage,
  c.created_at as registered_at,
  (SELECT COUNT(*) FROM notification_log nl WHERE nl.recipient_id = c.id) as notification_count,
  (SELECT GROUP_CONCAT(template_code) FROM notification_log nl WHERE nl.recipient_id = c.id) as templates_received
FROM ats_candidate c
WHERE c.status IN ('Selected', 'Rejected')
  AND c.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
  AND (SELECT COUNT(*) FROM notification_log nl WHERE nl.recipient_id = c.id) = 0
ORDER BY c.created_at DESC
LIMIT 20;

-- ────────────────────────────────────────────────────────────────────────────
-- 9. System Health Dashboard (Real-Time)
-- ────────────────────────────────────────────────────────────────────────────
SELECT
  'Last 1 Hour' as time_period,
  COUNT(*) as total_notifications,
  SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
  SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
  ROUND(100.0 * SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate_pct,
  COUNT(DISTINCT template_code) as unique_templates,
  COUNT(DISTINCT recipient_email) as unique_recipients
FROM notification_log
WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)

UNION ALL

SELECT
  'Last 24 Hours' as time_period,
  COUNT(*) as total_notifications,
  SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
  SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
  ROUND(100.0 * SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate_pct,
  COUNT(DISTINCT template_code) as unique_templates,
  COUNT(DISTINCT recipient_email) as unique_recipients
FROM notification_log
WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)

UNION ALL

SELECT
  'Last 7 Days' as time_period,
  COUNT(*) as total_notifications,
  SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
  SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
  ROUND(100.0 * SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate_pct,
  COUNT(DISTINCT template_code) as unique_templates,
  COUNT(DISTINCT recipient_email) as unique_recipients
FROM notification_log
WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY);

-- ────────────────────────────────────────────────────────────────────────────
-- 10. Error Pattern Analysis
-- ────────────────────────────────────────────────────────────────────────────
-- Group failed notifications by error pattern
SELECT
  SUBSTRING_INDEX(error_message, ':', 1) as error_type,
  COUNT(*) as occurrence_count,
  GROUP_CONCAT(DISTINCT template_code ORDER BY template_code) as affected_templates,
  MAX(created_at) as last_occurrence
FROM notification_log
WHERE status = 'failed'
  AND error_message IS NOT NULL
  AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY SUBSTRING_INDEX(error_message, ':', 1)
ORDER BY occurrence_count DESC
LIMIT 10;

-- ────────────────────────────────────────────────────────────────────────────
-- 11. Template Activity Heatmap (by day and hour)
-- ────────────────────────────────────────────────────────────────────────────
SELECT
  DATE(created_at) as date,
  HOUR(created_at) as hour,
  template_code,
  COUNT(*) as notification_count
FROM notification_log
WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY DATE(created_at), HOUR(created_at), template_code
ORDER BY date DESC, hour DESC, notification_count DESC;

-- ────────────────────────────────────────────────────────────────────────────
-- 12. Recruiter Notification Stats
-- ────────────────────────────────────────────────────────────────────────────
SELECT
  recipient_email,
  COUNT(*) as total_alerts,
  SUM(CASE WHEN template_code = 'REG_RECRUITER' THEN 1 ELSE 0 END) as new_assignments,
  SUM(CASE WHEN template_code = 'SLA_BREACH' THEN 1 ELSE 0 END) as sla_breaches,
  MAX(created_at) as last_alert,
  TIMESTAMPDIFF(HOUR, MAX(created_at), NOW()) as hours_since_last_alert
FROM notification_log
WHERE recipient_type = 'recruiter'
  AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY recipient_email
ORDER BY total_alerts DESC;

-- ────────────────────────────────────────────────────────────────────────────
-- 13. Configuration Status Check
-- ────────────────────────────────────────────────────────────────────────────
-- Check SMTP and SMS configuration
SELECT 'SMTP Configuration' as config_type, COUNT(*) as active_configs
FROM smtp_config WHERE active_status = 1
UNION ALL
SELECT 'SMS Configuration' as config_type, COUNT(*) as active_configs
FROM sms_config WHERE active_status = 1
UNION ALL
SELECT 'Active Templates' as config_type, COUNT(*) as active_configs
FROM notification_template WHERE active_status = 1;

-- ────────────────────────────────────────────────────────────────────────────
-- 14. Log Table Size and Cleanup Recommendation
-- ────────────────────────────────────────────────────────────────────────────
SELECT
  COUNT(*) as total_rows,
  ROUND(SUM(LENGTH(body)) / 1024 / 1024, 2) as body_size_mb,
  MIN(created_at) as oldest_record,
  MAX(created_at) as newest_record,
  DATEDIFF(NOW(), MIN(created_at)) as days_of_data,
  CASE
    WHEN DATEDIFF(NOW(), MIN(created_at)) > 90 THEN 'CLEANUP RECOMMENDED: Run archival script'
    WHEN DATEDIFF(NOW(), MIN(created_at)) > 60 THEN 'CLEANUP SOON: Consider archiving old logs'
    ELSE 'OK: No cleanup needed'
  END as cleanup_status
FROM notification_log;

-- ────────────────────────────────────────────────────────────────────────────
-- 15. Candidate Journey Completion Rate
-- ────────────────────────────────────────────────────────────────────────────
-- Track candidates who completed the full notification journey
SELECT
  c.id,
  c.full_name,
  c.status,
  COUNT(DISTINCT nl.template_code) as notifications_received,
  GROUP_CONCAT(DISTINCT nl.template_code ORDER BY nl.created_at) as notification_sequence,
  CASE
    WHEN c.status = 'Selected' AND COUNT(DISTINCT nl.template_code) >= 2 THEN 'Complete Journey'
    WHEN c.status = 'Rejected' AND COUNT(DISTINCT nl.template_code) >= 2 THEN 'Complete Journey'
    ELSE 'Incomplete Journey'
  END as journey_status
FROM ats_candidate c
LEFT JOIN notification_log nl ON nl.recipient_id = c.id AND nl.status = 'sent'
WHERE c.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
  AND c.status IN ('Selected', 'Rejected', 'Waiting')
GROUP BY c.id, c.full_name, c.status
ORDER BY c.created_at DESC
LIMIT 20;

-- ============================================================================
-- Cleanup Queries (Run Monthly)
-- ============================================================================

-- Archive old logs (optional - create archive table first)
-- CREATE TABLE notification_log_archive LIKE notification_log;
--
-- INSERT INTO notification_log_archive
-- SELECT * FROM notification_log
-- WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY);
--
-- DELETE FROM notification_log
-- WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)
--   AND status != 'failed';  -- Keep failed logs longer for debugging

-- ============================================================================
-- Performance Indexes (if not already created)
-- ============================================================================

-- CREATE INDEX idx_notification_created ON notification_log(created_at);
-- CREATE INDEX idx_notification_template_status ON notification_log(template_code, status);
-- CREATE INDEX idx_notification_recipient ON notification_log(recipient_id);
-- CREATE INDEX idx_notification_email ON notification_log(recipient_email);

-- ============================================================================
-- End of Monitoring Queries
-- ============================================================================
