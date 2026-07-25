-- =====================================================================
-- Attendance Data Audit Script for mas47814 (Shivam Giri)
-- Purpose: Diagnose why attendance data is not syncing correctly
-- =====================================================================

-- 1. Verify employee record exists and mapping is correct
SELECT
    '=== EMPLOYEE RECORD ===' AS section,
    id AS employee_id,
    employee_code,
    email,
    CONCAT(first_name, ' ', COALESCE(last_name, '')) AS full_name,
    department_id,
    designation_id,
    process_id,
    branch_id,
    employment_status,
    active_status,
    date_of_joining,
    date_of_exit
FROM employees
WHERE employee_code = 'mas47814' OR email = 'shivam.giri@teammas.in';

-- 2. Check recent APR (dialler) data for this employee
SELECT
    '=== APR DATA (Last 10 days) ===' AS section,
    UserID,
    ReportDate,
    Net_Login,
    Campaign,
    DATE_FORMAT(ReportDate, '%Y-%m-%d') AS formatted_date
FROM apr
WHERE UserID = 'mas47814'
ORDER BY ReportDate DESC
LIMIT 10;

-- 3. Check attendance_daily_record (ADR) - primary attendance table
SELECT
    '=== ATTENDANCE_DAILY_RECORD (Last 10 days) ===' AS section,
    adr.id,
    adr.record_date,
    adr.attendance_status,
    adr.lwp_value,
    adr.raw_minutes,
    adr.dialler_minutes,
    adr.biometric_minutes,
    adr.attendance_source,
    adr.is_locked,
    adr.override_reason,
    adr.regularization_id,
    adr.mismatch_flag,
    adr.biometric_status,
    adr.apr_status,
    adr.processed_at
FROM attendance_daily_record adr
WHERE adr.employee_id = (SELECT id FROM employees WHERE employee_code = 'mas47814' LIMIT 1)
ORDER BY adr.record_date DESC
LIMIT 10;

-- 4. Check biometric session data
SELECT
    '=== WFM_ATTENDANCE_SESSION (Last 10 days) ===' AS section,
    was.id,
    was.session_date,
    was.login_time,
    was.logout_time,
    was.total_login_minutes,
    was.current_status,
    was.punch_source
FROM wfm_attendance_session was
WHERE was.employee_id = (SELECT id FROM employees WHERE employee_code = 'mas47814' LIMIT 1)
ORDER BY was.session_date DESC
LIMIT 10;

-- 5. Check for pending or approved regularizations
SELECT
    '=== ATTENDANCE_REGULARIZATION (Last 30 days) ===' AS section,
    ar.id,
    ar.session_date,
    ar.status,
    ar.requested_status,
    ar.old_status,
    ar.new_status,
    ar.dispute_type,
    ar.reason,
    ar.created_at,
    ar.reviewed_at
FROM attendance_regularization ar
WHERE ar.employee_id = (SELECT id FROM employees WHERE employee_code = 'mas47814' LIMIT 1)
  AND ar.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
ORDER BY ar.session_date DESC;

-- 6. Check APR eligibility configuration
SELECT
    '=== APR_ELIGIBILITY_CONFIG ===' AS section,
    aec.*
FROM apr_eligibility_config aec
WHERE aec.active_status = 1
  AND (
    aec.designation_id = (SELECT designation_id FROM employees WHERE employee_code = 'mas47814' LIMIT 1)
    OR aec.department_id = (SELECT department_id FROM employees WHERE employee_code = 'mas47814' LIMIT 1)
    OR aec.process_id = (SELECT process_id FROM employees WHERE employee_code = 'mas47814' LIMIT 1)
    OR (aec.designation_id IS NULL AND aec.department_id IS NULL AND aec.process_id IS NULL)
  );

-- 7. Check for locked records that may be preventing updates
SELECT
    '=== LOCKED ATTENDANCE RECORDS (Last 30 days) ===' AS section,
    adr.record_date,
    adr.attendance_status,
    adr.is_locked,
    adr.override_by,
    adr.override_reason,
    adr.regularization_id,
    adr.processed_at
FROM attendance_daily_record adr
WHERE adr.employee_id = (SELECT id FROM employees WHERE employee_code = 'mas47814' LIMIT 1)
  AND adr.is_locked = 1
  AND adr.record_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
ORDER BY adr.record_date DESC;

-- 8. Check for date range with missing ADR but has APR data (sync gap detection)
SELECT
    '=== SYNC GAP: APR exists but ADR missing ===' AS section,
    apr.ReportDate AS missing_adr_date,
    apr.Net_Login AS apr_net_login,
    'ADR record missing - engine may not have run' AS issue
FROM apr
LEFT JOIN attendance_daily_record adr
    ON adr.employee_id = (SELECT id FROM employees WHERE employee_code = 'mas47814' LIMIT 1)
    AND adr.record_date = DATE_FORMAT(apr.ReportDate, '%Y-%m-%d')
WHERE apr.UserID = 'mas47814'
  AND apr.ReportDate >= DATE_SUB(CURDATE(), INTERVAL 10 DAY)
  AND adr.id IS NULL
ORDER BY apr.ReportDate DESC;

-- 9. Check for mismatch between APR and biometric
SELECT
    '=== APR vs BIOMETRIC MISMATCH ===' AS section,
    adr.record_date,
    adr.attendance_status AS final_status,
    adr.apr_status AS apr_detected_status,
    adr.biometric_status AS biometric_detected_status,
    adr.mismatch_flag,
    adr.dialler_minutes,
    adr.biometric_minutes,
    CASE
        WHEN adr.mismatch_flag = 1 THEN 'MISMATCH DETECTED'
        ELSE 'Match OK'
    END AS alert
FROM attendance_daily_record adr
WHERE adr.employee_id = (SELECT id FROM employees WHERE employee_code = 'mas47814' LIMIT 1)
  AND adr.record_date >= DATE_SUB(CURDATE(), INTERVAL 10 DAY)
  AND adr.mismatch_flag = 1
ORDER BY adr.record_date DESC;

-- 10. Summary statistics for last 30 days
SELECT
    '=== 30-DAY SUMMARY ===' AS section,
    COUNT(DISTINCT adr.record_date) AS days_with_adr,
    SUM(CASE WHEN adr.attendance_status = 'present' THEN 1 ELSE 0 END) AS present_days,
    SUM(CASE WHEN adr.attendance_status = 'absent' THEN 1 ELSE 0 END) AS absent_days,
    SUM(CASE WHEN adr.attendance_status = 'half_day' THEN 1 ELSE 0 END) AS half_days,
    SUM(CASE WHEN adr.attendance_status = 'missing_punch' THEN 1 ELSE 0 END) AS missing_punch_days,
    SUM(adr.lwp_value) AS total_lwp,
    SUM(CASE WHEN adr.is_locked = 1 THEN 1 ELSE 0 END) AS locked_records,
    SUM(CASE WHEN adr.mismatch_flag = 1 THEN 1 ELSE 0 END) AS mismatch_count
FROM attendance_daily_record adr
WHERE adr.employee_id = (SELECT id FROM employees WHERE employee_code = 'mas47814' LIMIT 1)
  AND adr.record_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY);
