-- 000_run_all.sql
-- Run this to execute all schema files in order.
-- Usage: mysql -u root -p < sql/000_run_all.sql

SOURCE sql/001_core_org.sql;
SOURCE sql/002_employees.sql;
SOURCE sql/003_access_control.sql;
SOURCE sql/004_ats.sql;
SOURCE sql/005_attendance_wfm.sql;
SOURCE sql/006_leave.sql;
SOURCE sql/007_payroll.sql;
SOURCE sql/008_integration_hub.sql;
SOURCE sql/009_dialer_ispark.sql;
SOURCE sql/010_kpi_migration.sql;
SOURCE sql/011_exit_management.sql;

SELECT 'mas_hrms schema complete' AS status;
SHOW TABLES;
