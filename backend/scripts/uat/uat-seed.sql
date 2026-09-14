-- =============================================================================================
-- UAT seed data for the KPI Studio and the Client Portal.
--
-- Applied to the DISPOSABLE UAT database only (mas_hrms_test on 127.0.0.1:13306).
--
-- WHAT THIS DELIBERATELY CONTAINS
--
-- 1. TWO processes, one populated and one EMPTY. The empty one is not an oversight: the portal has
--    to render a process with no operational data as "no_data", not as 0%. A suite that only ever
--    sees populated processes cannot tell those two apart, and 0% is the failure mode that tells a
--    client their floor did not turn up.
--
-- 2. EVERY value of attendance_daily_record.attendance_status, including the three that are easy to
--    forget and that the metrics specifically depend on:
--      week_off_worked  -> counts as attendance, and scoring it 0 was a documented false-zero bug
--      unreconciled     -> neither present nor absent; drives DQ and must be EXCLUDED from ATT
--      missing_punch    -> same
--    Roughly 14% of rows are unreconciled/missing_punch, matching the live company-wide 13.7%, so
--    the DQ metric produces a realistic number rather than a trivially perfect one.
--
-- 3. An employee with date_of_exit set, so retention/attrition has a real numerator, and an
--    inactive employee, so active_status filtering is exercised rather than assumed.
--
-- 4. Six months of history (2026-03..2026-08) because the sparkline is a 6-point series. Five
--    months would let an off-by-one in the range boundary pass unnoticed.
--
-- Deterministic: statuses are a function of the day number, so a re-run produces identical numbers
-- and a changed KPI figure means changed CODE, not a reshuffled fixture.
-- =============================================================================================

SET SESSION FOREIGN_KEY_CHECKS = 0;

DELETE FROM kpi_studio_manual_value  WHERE employee_id      LIKE 'uat-emp-%';
DELETE FROM kpi_studio_definition    WHERE id               LIKE 'uat-def-%';
DELETE FROM kpi_studio_source_field  WHERE data_source_id   LIKE 'uat-src-%';
DELETE FROM kpi_studio_data_source   WHERE id               LIKE 'uat-src-%';
DELETE FROM attendance_daily_record  WHERE employee_id      LIKE 'uat-emp-%';
DELETE FROM leave_request            WHERE employee_id      LIKE 'uat-emp-%';
DELETE FROM employees                WHERE id               LIKE 'uat-emp-%';
DELETE FROM process_master           WHERE id               LIKE 'uat-prc-%';
DELETE FROM client_master            WHERE id               LIKE 'uat-cli-%';
DELETE FROM branch_master            WHERE id               LIKE 'uat-brn-%';
DELETE FROM designation_master       WHERE id               LIKE 'uat-dsg-%';
DELETE FROM kpi_metric_master        WHERE id               LIKE 'uat-met-%';
DELETE FROM leave_type_master        WHERE id               LIKE 'uat-lvt-%';

INSERT INTO branch_master      (id, branch_code, branch_name)              VALUES ('uat-brn-1','UATBR1','UAT Branch One');
INSERT INTO designation_master (id, designation_code, designation_name)    VALUES ('uat-dsg-1','UATDSG1','UAT Agent');
INSERT INTO client_master      (id, client_code, client_name)              VALUES ('uat-cli-1','UATCL1','UAT Client One');
INSERT INTO leave_type_master  (id, leave_code, leave_name)                VALUES ('uat-lvt-1','UATCL','UAT Casual Leave');

-- Process A carries data. Process B is intentionally left with zero employees and zero attendance.
INSERT INTO process_master (id, process_code, process_name, client_id, branch_id)
VALUES ('uat-prc-a','UATPRCA','UAT Process Alpha','uat-cli-1','uat-brn-1'),
       ('uat-prc-b','UATPRCB','UAT Process Bravo (no data)','uat-cli-1','uat-brn-1');

-- Five employees. 004 has exited (attrition numerator); 005 is inactive (active_status filter).
-- full_name is a GENERATED column on this table, so it is not supplied.
INSERT INTO employees
  (id, employee_code, first_name, last_name, date_of_joining, date_of_exit,
   process_id, branch_id, designation_id, designation, department, active_status, employment_status)
VALUES
  ('uat-emp-1','UAT001','Asha','Rao','2025-04-01',NULL,'uat-prc-a','uat-brn-1','uat-dsg-1','UAT Agent','Operations',1,'Active'),
  ('uat-emp-2','UAT002','Bikram','Das','2025-06-15',NULL,'uat-prc-a','uat-brn-1','uat-dsg-1','UAT Agent','Operations',1,'Active'),
  ('uat-emp-3','UAT003','Chitra','Nair','2025-09-01',NULL,'uat-prc-a','uat-brn-1','uat-dsg-1','UAT Agent','Operations',1,'Active'),
  ('uat-emp-4','UAT004','Deepak','Sahu','2025-02-10','2026-07-18','uat-prc-a','uat-brn-1','uat-dsg-1','UAT Agent','Operations',0,'Resigned'),
  ('uat-emp-5','UAT005','Esha','Kaur','2025-11-20',NULL,'uat-prc-a','uat-brn-1','uat-dsg-1','UAT Agent','Operations',0,'inactive');

-- Metrics the Studio definitions attach to. Two directions and two units, so RAG and achievement
-- are exercised in both senses rather than only "higher is better, percent".
INSERT INTO kpi_metric_master (id, metric_code, metric_name, category, unit, direction)
VALUES
  ('uat-met-qa',  'UAT_QA_SCORE',  'UAT QA Score',        'quality',    'percent', 'higher_is_better'),
  ('uat-met-aht', 'UAT_AHT',       'UAT Avg Handle Time', 'operations', 'seconds', 'lower_is_better'),
  ('uat-met-conv','UAT_CONVERSION','UAT Conversion Rate', 'sales',      'percent', 'higher_is_better');

-- ── Attendance: 2026-03-01 .. 2026-08-31 for the four non-inactive employees ──────────────────
-- Status is chosen from the day-of-month so the mix is fixed and reproducible:
--   d%7=0        -> week_off            (excluded from the ATT denominator entirely)
--   d%7=6        -> week_off_worked     (worked a rest day: counts as attendance)
--   d%13=1       -> half_day            (0.5 in the numerator, 1 in the denominator)
--   d%11=3       -> absent
--   d%17=5       -> leave_approved      (excluded from the denominator, it is not absenteeism)
--   d%19=7       -> unreconciled        (NOT counted either way; lowers DQ)
--   d%23=9       -> missing_punch       (NOT counted either way; lowers DQ)
--   d=1 of month -> holiday             (excluded)
--   otherwise    -> present
INSERT INTO attendance_daily_record (id, employee_id, record_date, attendance_status, late_mark)
WITH RECURSIVE d AS (
  SELECT DATE('2026-03-01') AS dt
  UNION ALL SELECT dt + INTERVAL 1 DAY FROM d WHERE dt < DATE('2026-08-31')
),
e AS (
  SELECT 'uat-emp-1' AS eid UNION ALL SELECT 'uat-emp-2'
  UNION ALL SELECT 'uat-emp-3' UNION ALL SELECT 'uat-emp-4'
)
SELECT
  CONCAT('uat-att-', e.eid, '-', DATE_FORMAT(d.dt, '%Y%m%d')),
  e.eid,
  d.dt,
  CASE
    WHEN DAYOFMONTH(d.dt) = 1                 THEN 'holiday'
    WHEN DAYOFMONTH(d.dt) % 7  = 0            THEN 'week_off'
    WHEN DAYOFMONTH(d.dt) % 7  = 6            THEN 'week_off_worked'
    WHEN DAYOFMONTH(d.dt) % 13 = 1            THEN 'half_day'
    WHEN DAYOFMONTH(d.dt) % 11 = 3            THEN 'absent'
    WHEN DAYOFMONTH(d.dt) % 17 = 5            THEN 'leave_approved'
    WHEN DAYOFMONTH(d.dt) % 19 = 7            THEN 'unreconciled'
    WHEN DAYOFMONTH(d.dt) % 23 = 9            THEN 'missing_punch'
    ELSE 'present'
  END,
  -- Late only on days actually worked, and only for two of the four employees, so the LAT
  -- denominator (days present) differs from the ATT denominator.
  CASE WHEN e.eid IN ('uat-emp-1','uat-emp-3') AND DAYOFMONTH(d.dt) % 9 = 4 THEN 1 ELSE 0 END
FROM d CROSS JOIN e
-- An exited employee stops producing attendance on the day they leave.
WHERE NOT (e.eid = 'uat-emp-4' AND d.dt > DATE('2026-07-18'));

-- ── Approved leave, matching the leave_approved attendance days ───────────────────────────────
INSERT INTO leave_request (id, employee_id, leave_type_id, from_date, to_date, total_days, status)
SELECT CONCAT('uat-lv-', employee_id, '-', DATE_FORMAT(record_date, '%Y%m%d')),
       employee_id, 'uat-lvt-1', record_date, record_date, 1.0, 'approved'
FROM attendance_daily_record
WHERE employee_id LIKE 'uat-emp-%' AND attendance_status = 'leave_approved';

SET SESSION FOREIGN_KEY_CHECKS = 1;
