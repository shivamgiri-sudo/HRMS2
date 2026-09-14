USE mas_hrms;

UPDATE integration_connector_run
   SET status = 'failed',
       error_message = COALESCE(error_message, 'Run did not complete under the legacy trigger implementation'),
       completed_at = COALESCE(completed_at, NOW()),
       duration_ms = COALESCE(duration_ms, TIMESTAMPDIFF(MICROSECOND, started_at, NOW()) DIV 1000)
 WHERE status = 'running'
   AND started_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE);
