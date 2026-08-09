-- 174_apr_attendance_rule.sql
-- Inserts APR-based attendance rule for Operations+Executive employees
-- Thresholds: >=480min = Present, 240-479min = Half Day, <240min = Absent
INSERT IGNORE INTO attendance_rule_config
  (id, rule_name, scope_type, attendance_source,
   full_day_minutes, half_day_minutes, grace_minutes,
   effective_from, notes, active_status, created_by)
VALUES
  ('arc-apr-ops-exec',
   'Operations Executive APR Rule',
   'global',
   'dialler',
   480, 240, 0,
   CURDATE(),
   'APR-based rule for Operations+Executive employees: >=480min=Present, 240-479min=Half Day, <240min=Absent. Engine detects APR employees by dept LIKE %operation% AND designation LIKE %executive%.',
   1,
   'system');
