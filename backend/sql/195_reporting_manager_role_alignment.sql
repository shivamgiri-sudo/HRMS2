-- Align active reporting managers with the canonical manager role.
USE mas_hrms;

INSERT INTO user_roles (id, user_id, role_key, active_status)
SELECT UUID(), managers.user_id, 'manager', 1
FROM (
  SELECT DISTINCT manager.user_id
  FROM employees manager
  JOIN employees report
    ON report.reporting_manager_id = manager.id
   AND report.active_status = 1
  WHERE manager.active_status = 1
    AND manager.user_id IS NOT NULL
) managers
ON DUPLICATE KEY UPDATE active_status = 1;
