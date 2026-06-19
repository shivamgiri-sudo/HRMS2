-- 043_demo_data.sql
-- Comprehensive demo data for end-to-end flow testing
-- All 11 demo role employees, ATS pipeline, attendance, leave, payroll, engagement, helpdesk, exit
USE mas_hrms;

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 1: Cost Centres
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO cost_centre_master (id, cost_centre_code, cost_centre_name, branch_id, department_id, active_status)
VALUES
  ('cc-hq-hr-001',  'CC-HR-HQ',  'HR Cost Centre',          '6a8c14d9-5caf-11f1-adb1-00155d0ab410','774fd436-5caf-11f1-adb1-00155d0ab410', 1),
  ('cc-hq-ops-001', 'CC-OPS-HQ', 'Operations Cost Centre',  '6a8c14d9-5caf-11f1-adb1-00155d0ab410','775359c8-5caf-11f1-adb1-00155d0ab410', 1),
  ('cc-hq-qa-001',  'CC-QA-HQ',  'QA Cost Centre',          '6a8c14d9-5caf-11f1-adb1-00155d0ab410','7753629b-5caf-11f1-adb1-00155d0ab410', 1),
  ('cc-hq-fin-001', 'CC-FIN-HQ', 'Finance Cost Centre',     '6a8c14d9-5caf-11f1-adb1-00155d0ab410','775587cd-5caf-11f1-adb1-00155d0ab410', 1),
  ('cc-hq-trn-001', 'CC-TRN-HQ', 'Training Cost Centre',   '6a8c14d9-5caf-11f1-adb1-00155d0ab410','77558977-5caf-11f1-adb1-00155d0ab410', 1)
ON DUPLICATE KEY UPDATE cost_centre_name = VALUES(cost_centre_name);

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 2: Grade Bands
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO grade_band_master (id, grade_code, grade_name, band, min_ctc, max_ctc, active_status)
VALUES
  ('gb-l1-001','L1','Junior',   'Band A',180000, 360000, 1),
  ('gb-l2-001','L2','Mid-Level','Band B',360000, 720000, 1),
  ('gb-l3-001','L3','Senior',   'Band C',720000, 1440000,1),
  ('gb-l4-001','L4','Lead',     'Band D',1440000,2400000,1),
  ('gb-l5-001','L5','Manager',  'Band E',2400000,4800000,1),
  ('gb-l6-001','L6','Director', 'Band F',4800000,9600000,1)
ON DUPLICATE KEY UPDATE grade_name = VALUES(grade_name);

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 3: Salary Structure
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO salary_structure_master (id, structure_code, structure_name, basic_pct, hra_pct, active_status)
VALUES
  ('ss-std-001','STD_MONTHLY','Standard Monthly Structure',40.00,20.00,1),
  ('ss-mgr-001','MGR_MONTHLY','Manager Monthly Structure', 45.00,22.00,1)
ON DUPLICATE KEY UPDATE structure_name = VALUES(structure_name);

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 4: Demo Employees (11)
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO employees (
  id, employee_code, user_id, first_name, last_name, email, mobile,
  gender, date_of_birth, date_of_joining, employment_type, employment_status,
  employee_category, marital_status,
  branch_id, department_id, designation_id, process_id, lob_id, cost_centre_id, grade_id,
  manager_id, active_status
) VALUES
('emp-admin-001','EMP-ADM-001','demo-admin-id','Arjun','Sharma','admin@mascallnet.com','+919876543200','Male','1985-03-15','2020-01-01','Full Time','Active','permanent','married','6a8c14d9-5caf-11f1-adb1-00155d0ab410','774fd436-5caf-11f1-adb1-00155d0ab410','77594790-5caf-11f1-adb1-00155d0ab410','776f5bc7-5caf-11f1-adb1-00155d0ab410','7761193f-5caf-11f1-adb1-00155d0ab410','cc-hq-hr-001','gb-l6-001',NULL,1),
('emp-hr-001','EMP-HR-001','demo-hr-id','Priya','Nair','hr@mascallnet.com','+919876543201','Female','1990-07-22','2021-03-15','Full Time','Active','permanent','married','6a8c14d9-5caf-11f1-adb1-00155d0ab410','774fd436-5caf-11f1-adb1-00155d0ab410','775ee668-5caf-11f1-adb1-00155d0ab410','776f5bc7-5caf-11f1-adb1-00155d0ab410','7761193f-5caf-11f1-adb1-00155d0ab410','cc-hq-hr-001','gb-l4-001','emp-admin-001',1),
('emp-recruiter-001','EMP-REC-001','demo-recruiter-id','Ravi','Kumar','recruiter@mascallnet.com','+919876543202','Male','1995-11-10','2022-06-01','Full Time','Active','permanent','single','6a8c14d9-5caf-11f1-adb1-00155d0ab410','774fd436-5caf-11f1-adb1-00155d0ab410','775ef427-5caf-11f1-adb1-00155d0ab410','776f5bc7-5caf-11f1-adb1-00155d0ab410','7761193f-5caf-11f1-adb1-00155d0ab410','cc-hq-hr-001','gb-l2-001','emp-hr-001',1),
('emp-manager-001','EMP-MGR-001','demo-manager-id','Sunita','Reddy','manager@mascallnet.com','+919876543203','Female','1988-05-18','2019-08-01','Full Time','Active','permanent','married','6a8c14d9-5caf-11f1-adb1-00155d0ab410','775359c8-5caf-11f1-adb1-00155d0ab410','775eed76-5caf-11f1-adb1-00155d0ab410','7768045c-5caf-11f1-adb1-00155d0ab410','7761193f-5caf-11f1-adb1-00155d0ab410','cc-hq-ops-001','gb-l5-001','emp-admin-001',1),
('emp-tl-001','EMP-TL-001','demo-tl-id','Vikram','Mehta','tl@mascallnet.com','+919876543204','Male','1993-02-28','2021-01-15','Full Time','Active','permanent','married','6a8c14d9-5caf-11f1-adb1-00155d0ab410','775359c8-5caf-11f1-adb1-00155d0ab410','775eeed4-5caf-11f1-adb1-00155d0ab410','7768045c-5caf-11f1-adb1-00155d0ab410','7761193f-5caf-11f1-adb1-00155d0ab410','cc-hq-ops-001','gb-l3-001','emp-manager-001',1),
('emp-qa-001','EMP-QA-001','demo-qa-id','Deepa','Iyer','qa@mascallnet.com','+919876543205','Female','1994-09-03','2022-02-14','Full Time','Active','permanent','single','6a8c14d9-5caf-11f1-adb1-00155d0ab410','7753629b-5caf-11f1-adb1-00155d0ab410','775ef177-5caf-11f1-adb1-00155d0ab410','776f5554-5caf-11f1-adb1-00155d0ab410','7761193f-5caf-11f1-adb1-00155d0ab410','cc-hq-qa-001','gb-l2-001','emp-manager-001',1),
('emp-wfm-001','EMP-WFM-001','demo-wfm-id','Karan','Gupta','wfm@mascallnet.com','+919876543206','Male','1992-12-25','2020-09-01','Full Time','Active','permanent','married','6a8c14d9-5caf-11f1-adb1-00155d0ab410','775359c8-5caf-11f1-adb1-00155d0ab410','775eeed4-5caf-11f1-adb1-00155d0ab410','7768045c-5caf-11f1-adb1-00155d0ab410','7761193f-5caf-11f1-adb1-00155d0ab410','cc-hq-ops-001','gb-l3-001','emp-manager-001',1),
('emp-finance-001','EMP-FIN-001','demo-finance-id','Meera','Joshi','finance@mascallnet.com','+919876543207','Female','1991-04-14','2020-04-01','Full Time','Active','permanent','married','6a8c14d9-5caf-11f1-adb1-00155d0ab410','775587cd-5caf-11f1-adb1-00155d0ab410','775ef574-5caf-11f1-adb1-00155d0ab410','776f5bc7-5caf-11f1-adb1-00155d0ab410','7761193f-5caf-11f1-adb1-00155d0ab410','cc-hq-fin-001','gb-l3-001','emp-admin-001',1),
('emp-employee-001','EMP-STF-001','demo-employee-id','Ananya','Singh','employee@mascallnet.com','+919876543208','Female','1997-06-30','2023-03-01','Full Time','Active','permanent','single','6a8c14d9-5caf-11f1-adb1-00155d0ab410','775359c8-5caf-11f1-adb1-00155d0ab410','775ef029-5caf-11f1-adb1-00155d0ab410','7768045c-5caf-11f1-adb1-00155d0ab410','7761193f-5caf-11f1-adb1-00155d0ab410','cc-hq-ops-001','gb-l1-001','emp-tl-001',1),
('emp-ceo-001','EMP-CEO-001','demo-ceo-id','Rajesh','Kapoor','ceo@mascallnet.com','+919876543209','Male','1978-01-08','2015-01-01','Full Time','Active','permanent','married','6a8c14d9-5caf-11f1-adb1-00155d0ab410','77558b14-5caf-11f1-adb1-00155d0ab410','77594790-5caf-11f1-adb1-00155d0ab410','776f5bc7-5caf-11f1-adb1-00155d0ab410','7761193f-5caf-11f1-adb1-00155d0ab410','cc-hq-hr-001','gb-l6-001',NULL,1),
('emp-trainer-001','EMP-TRN-001','demo-trainer-id','Pooja','Bansal','trainer@mascallnet.com','+919876543210','Female','1993-08-16','2021-07-01','Full Time','Active','permanent','married','6a8c14d9-5caf-11f1-adb1-00155d0ab410','77558977-5caf-11f1-adb1-00155d0ab410','775ef2c7-5caf-11f1-adb1-00155d0ab410','776f5bc7-5caf-11f1-adb1-00155d0ab410','7761193f-5caf-11f1-adb1-00155d0ab410','cc-hq-trn-001','gb-l3-001','emp-hr-001',1)
ON DUPLICATE KEY UPDATE email=VALUES(email), employment_status=VALUES(employment_status), manager_id=VALUES(manager_id);

-- PAN numbers
UPDATE employees SET pan_number='ABCPA1234A' WHERE id='emp-admin-001'    AND pan_number IS NULL;
UPDATE employees SET pan_number='ABCPN1234B' WHERE id='emp-hr-001'       AND pan_number IS NULL;
UPDATE employees SET pan_number='ABCPR1234C' WHERE id='emp-recruiter-001' AND pan_number IS NULL;
UPDATE employees SET pan_number='ABCPM1234D' WHERE id='emp-manager-001'  AND pan_number IS NULL;
UPDATE employees SET pan_number='ABCPV1234E' WHERE id='emp-tl-001'       AND pan_number IS NULL;
UPDATE employees SET pan_number='ABCPD1234F' WHERE id='emp-qa-001'       AND pan_number IS NULL;
UPDATE employees SET pan_number='ABCPK1234G' WHERE id='emp-wfm-001'      AND pan_number IS NULL;
UPDATE employees SET pan_number='ABCPJ1234H' WHERE id='emp-finance-001'  AND pan_number IS NULL;
UPDATE employees SET pan_number='ABCPA1234I' WHERE id='emp-employee-001' AND pan_number IS NULL;
UPDATE employees SET pan_number='ABCPR1234J' WHERE id='emp-ceo-001'      AND pan_number IS NULL;
UPDATE employees SET pan_number='ABCPP1234K' WHERE id='emp-trainer-001'  AND pan_number IS NULL;

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 5: Bank Details
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO employee_bank_detail (id, employee_id, bank_name, account_number, ifsc_code, account_type, verified)
VALUES
  ('bank-admin-001',   'emp-admin-001',    'HDFC Bank', 'HDFC1234567890', 'HDFC0001234','Savings',1),
  ('bank-hr-001',      'emp-hr-001',       'ICICI Bank','ICIC9876543210', 'ICIC0005678','Savings',1),
  ('bank-mgr-001',     'emp-manager-001',  'SBI',       'SBI0001122334',  'SBIN0001234','Savings',1),
  ('bank-emp-001',     'emp-employee-001', 'Axis Bank', 'AXIS4455667788', 'UTIB0001234','Savings',1),
  ('bank-fin-001',     'emp-finance-001',  'Kotak Bank','KOTA1234509876', 'KKBK0001234','Savings',1)
ON DUPLICATE KEY UPDATE verified=1;

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 6: Salary Assignments
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO employee_salary_assignment (id, employee_id, structure_id, ctc_annual, effective_from, active_status)
VALUES
  ('sal-admin-001',  'emp-admin-001',    'ss-mgr-001',1800000,'2020-01-01',1),
  ('sal-hr-001',     'emp-hr-001',       'ss-mgr-001',900000, '2021-03-15',1),
  ('sal-rec-001',    'emp-recruiter-001','ss-std-001', 480000, '2022-06-01',1),
  ('sal-mgr-001',    'emp-manager-001',  'ss-mgr-001',1200000,'2019-08-01',1),
  ('sal-tl-001',     'emp-tl-001',       'ss-std-001', 720000, '2021-01-15',1),
  ('sal-qa-001',     'emp-qa-001',       'ss-std-001', 540000, '2022-02-14',1),
  ('sal-wfm-001',    'emp-wfm-001',      'ss-std-001', 660000, '2020-09-01',1),
  ('sal-fin-001',    'emp-finance-001',  'ss-std-001', 720000, '2020-04-01',1),
  ('sal-emp-001',    'emp-employee-001', 'ss-std-001', 360000, '2023-03-01',1),
  ('sal-ceo-001',    'emp-ceo-001',      'ss-mgr-001',4800000,'2015-01-01',1),
  ('sal-trainer-001','emp-trainer-001',  'ss-std-001', 600000, '2021-07-01',1)
ON DUPLICATE KEY UPDATE ctc_annual=VALUES(ctc_annual);

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 7: Leave Balance Ledger
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
VALUES
  (UUID(),'emp-admin-001',   '80e058a3-5ac5-11f1-adb1-00155d0ab410',2026,12,2,0),
  (UUID(),'emp-admin-001',   '80e06054-5ac5-11f1-adb1-00155d0ab410',2026,7,1,0),
  (UUID(),'emp-admin-001',   '80e07731-5ac5-11f1-adb1-00155d0ab410',2026,15,3,0),
  (UUID(),'emp-hr-001',      '80e058a3-5ac5-11f1-adb1-00155d0ab410',2026,12,1,0),
  (UUID(),'emp-hr-001',      '80e06054-5ac5-11f1-adb1-00155d0ab410',2026,7,0,0),
  (UUID(),'emp-hr-001',      '80e07731-5ac5-11f1-adb1-00155d0ab410',2026,15,2,0),
  (UUID(),'emp-employee-001','80e058a3-5ac5-11f1-adb1-00155d0ab410',2026,12,3,0),
  (UUID(),'emp-employee-001','80e06054-5ac5-11f1-adb1-00155d0ab410',2026,7,1,0),
  (UUID(),'emp-employee-001','80e07731-5ac5-11f1-adb1-00155d0ab410',2026,15,5,0),
  (UUID(),'emp-manager-001', '80e058a3-5ac5-11f1-adb1-00155d0ab410',2026,12,0,0),
  (UUID(),'emp-manager-001', '80e07731-5ac5-11f1-adb1-00155d0ab410',2026,15,4,0),
  (UUID(),'emp-tl-001',      '80e058a3-5ac5-11f1-adb1-00155d0ab410',2026,12,1,0),
  (UUID(),'emp-tl-001',      '80e07731-5ac5-11f1-adb1-00155d0ab410',2026,15,2,0)
ON DUPLICATE KEY UPDATE allocated_days=VALUES(allocated_days);

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 8: Leave Requests
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO leave_request (id, employee_id, leave_type_id, from_date, to_date, total_days, reason, status)
VALUES
  ('lr-001','emp-employee-001','80e058a3-5ac5-11f1-adb1-00155d0ab410','2026-06-05','2026-06-07',3,'Personal work','pending'),
  ('lr-002','emp-tl-001',      '80e058a3-5ac5-11f1-adb1-00155d0ab410','2026-05-20','2026-05-22',3,'Family function','approved'),
  ('lr-003','emp-qa-001',      '80e06054-5ac5-11f1-adb1-00155d0ab410','2026-05-15','2026-05-15',1,'Medical appointment','approved'),
  ('lr-004','emp-manager-001', '80e07731-5ac5-11f1-adb1-00155d0ab410','2026-04-10','2026-04-14',5,'Annual vacation','approved'),
  ('lr-005','emp-recruiter-001','80e058a3-5ac5-11f1-adb1-00155d0ab410','2026-06-10','2026-06-11',2,'Personal','pending')
ON DUPLICATE KEY UPDATE status=VALUES(status);

INSERT INTO leave_approval_log (id, leave_request_id, action, action_by, remarks)
VALUES
  (UUID(),'lr-002','approved','emp-manager-001','Approved'),
  (UUID(),'lr-003','approved','emp-manager-001','Medical leave approved'),
  (UUID(),'lr-004','approved','emp-admin-001',  'Annual leave approved')
ON DUPLICATE KEY UPDATE action=VALUES(action);

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 9: WFM Shift Master
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO wfm_shift_master (id, shift_code, shift_name, start_time, end_time, required_minutes, active_status)
VALUES
  ('shift-gen-001','GEN','General Shift', '09:00:00','18:00:00',480,1),
  ('shift-eve-001','EVE','Evening Shift', '14:00:00','23:00:00',480,1),
  ('shift-ngt-001','NGT','Night Shift',   '22:00:00','07:00:00',480,1)
ON DUPLICATE KEY UPDATE shift_name=VALUES(shift_name);

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 10: Attendance Sessions (May 2026)
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO wfm_attendance_session
  (id, employee_id, session_date, login_time, logout_time, total_login_minutes, current_status, punch_source)
VALUES
  (UUID(),'emp-employee-001','2026-05-02','2026-05-02 09:05:00','2026-05-02 18:10:00',545,'Logged Out','System'),
  (UUID(),'emp-employee-001','2026-05-05','2026-05-05 09:00:00','2026-05-05 18:00:00',540,'Logged Out','System'),
  (UUID(),'emp-employee-001','2026-05-06','2026-05-06 09:15:00','2026-05-06 18:20:00',545,'Logged Out','System'),
  (UUID(),'emp-employee-001','2026-05-07','2026-05-07 09:02:00','2026-05-07 18:05:00',543,'Logged Out','System'),
  (UUID(),'emp-employee-001','2026-05-08','2026-05-08 09:00:00','2026-05-08 18:00:00',540,'Logged Out','System'),
  (UUID(),'emp-employee-001','2026-05-09','2026-05-09 09:30:00','2026-05-09 18:30:00',540,'Logged Out','System'),
  (UUID(),'emp-employee-001','2026-05-12','2026-05-12 09:00:00','2026-05-12 18:00:00',540,'Logged Out','System'),
  (UUID(),'emp-employee-001','2026-05-13','2026-05-13 09:10:00','2026-05-13 18:15:00',545,'Logged Out','System'),
  (UUID(),'emp-employee-001','2026-05-14','2026-05-14 09:00:00','2026-05-14 18:00:00',540,'Logged Out','System'),
  (UUID(),'emp-employee-001','2026-05-16','2026-05-16 09:05:00','2026-05-16 18:10:00',545,'Logged Out','System'),
  (UUID(),'emp-employee-001','2026-05-19','2026-05-19 09:00:00','2026-05-19 18:00:00',540,'Logged Out','System'),
  (UUID(),'emp-employee-001','2026-05-20','2026-05-20 09:00:00','2026-05-20 18:00:00',540,'Logged Out','System'),
  (UUID(),'emp-employee-001','2026-05-21','2026-05-21 09:00:00','2026-05-21 18:00:00',540,'Logged Out','System'),
  (UUID(),'emp-employee-001','2026-05-22','2026-05-22 09:00:00','2026-05-22 18:00:00',540,'Logged Out','System'),
  (UUID(),'emp-employee-001','2026-05-23','2026-05-23 09:20:00','2026-05-23 18:20:00',540,'Logged Out','System'),
  (UUID(),'emp-employee-001','2026-05-26','2026-05-26 09:00:00','2026-05-26 18:00:00',540,'Logged Out','System'),
  (UUID(),'emp-employee-001','2026-05-27','2026-05-27 09:00:00','2026-05-27 18:00:00',540,'Logged Out','System'),
  (UUID(),'emp-employee-001','2026-05-28','2026-05-28 09:00:00','2026-05-28 18:00:00',540,'Logged Out','System'),
  (UUID(),'emp-employee-001','2026-05-29','2026-05-29 09:00:00','2026-05-29 18:00:00',540,'Logged Out','System'),
  (UUID(),'emp-employee-001','2026-05-30','2026-05-30 09:00:00','2026-05-30 18:00:00',540,'Logged Out','System'),
  -- TL attendance
  (UUID(),'emp-tl-001','2026-05-02','2026-05-02 09:00:00','2026-05-02 18:00:00',540,'Logged Out','System'),
  (UUID(),'emp-tl-001','2026-05-05','2026-05-05 09:00:00','2026-05-05 18:00:00',540,'Logged Out','System'),
  (UUID(),'emp-tl-001','2026-05-06','2026-05-06 09:00:00','2026-05-06 18:00:00',540,'Logged Out','System'),
  (UUID(),'emp-tl-001','2026-05-07','2026-05-07 09:00:00','2026-05-07 18:00:00',540,'Logged Out','System'),
  (UUID(),'emp-tl-001','2026-05-08','2026-05-08 09:00:00','2026-05-08 18:00:00',540,'Logged Out','System'),
  -- Manager attendance
  (UUID(),'emp-manager-001','2026-05-02','2026-05-02 09:00:00','2026-05-02 18:00:00',540,'Logged Out','System'),
  (UUID(),'emp-manager-001','2026-05-05','2026-05-05 09:00:00','2026-05-05 18:00:00',540,'Logged Out','System'),
  (UUID(),'emp-manager-001','2026-05-06','2026-05-06 09:00:00','2026-05-06 18:00:00',540,'Logged Out','System')
ON DUPLICATE KEY UPDATE current_status=VALUES(current_status);

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 11: Payroll Run (May 2026)
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO salary_prep_run (id, run_month, branch_filter, status, total_employees, total_gross, total_deductions, total_net, created_by)
VALUES ('payrun-may26-001','2026-05',NULL,'draft',11,1236250,185437,1050813,'emp-finance-001')
ON DUPLICATE KEY UPDATE status=VALUES(status);

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 12: ATS Candidates
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO ats_candidate (
  id, candidate_code, full_name, mobile, email, gender,
  applied_for_process, applied_for_branch, sourcing_channel,
  walk_in_date, current_stage, active_status
) VALUES
  ('cand-001','CND-001','Rahul Verma',  '+919800000001','rahul.v@test.com',  'Male',  '7768045c-5caf-11f1-adb1-00155d0ab410','6a8c14d9-5caf-11f1-adb1-00155d0ab410','Walk-In',   '2026-05-28','New',      1),
  ('cand-002','CND-002','Sneha Pillai', '+919800000002','sneha.p@test.com',  'Female','7768045c-5caf-11f1-adb1-00155d0ab410','6a8c14d9-5caf-11f1-adb1-00155d0ab410','Walk-In',   '2026-05-29','New',      1),
  ('cand-003','CND-003','Amit Saxena',  '+919800000003','amit.s@test.com',   'Male',  '7768045c-5caf-11f1-adb1-00155d0ab410','6a8c14d9-5caf-11f1-adb1-00155d0ab410','Walk-In',   '2026-05-30','New',      1),
  ('cand-004','CND-004','Neha Sharma',  '+919800000004','neha.s@test.com',   'Female','7768045c-5caf-11f1-adb1-00155d0ab410','6a8c14d9-5caf-11f1-adb1-00155d0ab410','Job Portal','2026-05-20','Screening',1),
  ('cand-005','CND-005','Suresh Babu',  '+919800000005','suresh.b@test.com', 'Male',  '7768045c-5caf-11f1-adb1-00155d0ab410','6a8c14d9-5caf-11f1-adb1-00155d0ab410','Referral',  '2026-05-18','Screening',1),
  ('cand-006','CND-006','Kavitha Rao',  '+919800000006','kavitha.r@test.com','Female','7768045c-5caf-11f1-adb1-00155d0ab410','6a8c14d9-5caf-11f1-adb1-00155d0ab410','LinkedIn',  '2026-05-15','Interview',1),
  ('cand-007','CND-007','Praveen Nair', '+919800000007','praveen.n@test.com','Male',  '7768045c-5caf-11f1-adb1-00155d0ab410','6a8c14d9-5caf-11f1-adb1-00155d0ab410','Walk-In',   '2026-05-22','Interview',1),
  ('cand-008','CND-008','Divya Menon',  '+919800000008','divya.m@test.com',  'Female','7768045c-5caf-11f1-adb1-00155d0ab410','6a8c14d9-5caf-11f1-adb1-00155d0ab410','Walk-In',   '2026-05-25','Interview',1),
  ('cand-009','CND-009','Rohit Singh',  '+919800000009','rohit.s@test.com',  'Male',  '7768045c-5caf-11f1-adb1-00155d0ab410','6a8c14d9-5caf-11f1-adb1-00155d0ab410','Naukri',    '2026-05-10','Offered',  1),
  ('cand-010','CND-010','Priti Malhotra','+919800000010','priti.m@test.com', 'Female','7768045c-5caf-11f1-adb1-00155d0ab410','6a8c14d9-5caf-11f1-adb1-00155d0ab410','LinkedIn',  '2026-05-08','Offered',  1)
ON DUPLICATE KEY UPDATE current_stage=VALUES(current_stage);

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 13: Badges + Points
-- ═══════════════════════════════════════════════════════════════════
INSERT IGNORE INTO gamification_badge_master (badge_id, badge_name, badge_description, badge_icon, badge_category, points_value, is_active)
VALUES
  ('badge-star-001',  'Star Performer',     'Consistently exceeded targets',    '🏆', 'performance',100,1),
  ('badge-team-001',  'Team Player',        'Always helps teammates',            '🤝', 'social',     50, 1),
  ('badge-attend-001','Perfect Attendance',  '100% attendance for a month',       '📅', 'activity',   75, 1),
  ('badge-learn-001', 'Fast Learner',       'Completed 5 courses in 30 days',   '📚', 'activity',   60, 1),
  ('badge-year1-001', '1 Year Milestone',   'Completed 1 year at MAS CallNet',  '🎂', 'tenure',     150,1);

INSERT IGNORE INTO employee_badge_earned (earned_id, employee_id, badge_id, earned_at, awarded_by, reason)
VALUES
  (UUID(),'emp-employee-001','badge-attend-001','2026-05-31','emp-manager-001','Perfect attendance May 2026'),
  (UUID(),'emp-tl-001',      'badge-star-001', '2026-05-31','emp-manager-001','Exceeded KPI targets'),
  (UUID(),'emp-manager-001', 'badge-team-001', '2026-05-15','emp-admin-001',  'Great team coordination'),
  (UUID(),'emp-trainer-001', 'badge-learn-001','2026-05-20','emp-hr-001',     'Fast LMS curriculum completion'),
  (UUID(),'emp-hr-001',      'badge-year1-001','2026-05-01','emp-admin-001',  '5 years at MAS CallNet');

INSERT INTO gamification_point_log (id, employee_id, points_earned, points_source, source_ref_id, awarded_date, awarded_by, notes)
VALUES
  (UUID(),'emp-employee-001',75, 'badge','badge-attend-001','2026-05-31','emp-manager-001','Perfect Attendance badge'),
  (UUID(),'emp-tl-001',      100,'badge','badge-star-001',  '2026-05-31','emp-manager-001','Star Performer badge'),
  (UUID(),'emp-manager-001', 50, 'badge','badge-team-001',  '2026-05-15','emp-admin-001',  'Team Player badge'),
  (UUID(),'emp-employee-001',25, 'kudos','',                '2026-05-28','emp-tl-001',     'Great call handling'),
  (UUID(),'emp-tl-001',      25, 'kudos','',                '2026-05-25','emp-manager-001','Monthly top performer')
ON DUPLICATE KEY UPDATE notes=VALUES(notes);

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 14: Helpdesk Tickets
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO helpdesk_ticket (id, ticket_code, employee_id, category, subject, description, priority, status)
VALUES
  ('ticket-001','TKT-001','emp-employee-001','IT',      'Laptop keyboard issue',       'Keys stuck on laptop',     'medium','open'),
  ('ticket-002','TKT-002','emp-tl-001',      'HR',      'Salary slip correction April','Net pay mismatch in April','high',  'pending'),
  ('ticket-003','TKT-003','emp-qa-001',      'Facility','AC not working in QA bay',    'Temperature too high',     'low',   'open'),
  ('ticket-004','TKT-004','emp-recruiter-001','IT',     'VPN access for WFH',          'Need VPN credentials',     'medium','resolved')
ON DUPLICATE KEY UPDATE status=VALUES(status);

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 15: Performance Feedback Cycle
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO performance_feedback_cycle (cycle_id, cycle_name, period, start_date, end_date, deadline, status, feedback_type, created_by)
VALUES
  ('pf-cycle-001','Q1 2026 Performance Review','Q1-2026','2026-01-01','2026-03-31','2026-04-15','active','360',  'emp-hr-001'),
  ('pf-cycle-002','Annual Appraisal 2025-26',  'FY25-26', '2025-04-01','2026-03-31','2026-04-30','active','annual','emp-hr-001')
ON DUPLICATE KEY UPDATE status=VALUES(status);

INSERT INTO performance_feedback_request (request_id, cycle_id, employee_id, reviewer_id, reviewer_type, status)
VALUES
  ('pfr-001','pf-cycle-001','emp-employee-001','emp-manager-001','manager','pending'),
  ('pfr-002','pf-cycle-001','emp-tl-001',      'emp-manager-001','manager','submitted'),
  ('pfr-003','pf-cycle-001','emp-employee-001','emp-tl-001',     'peer',   'pending'),
  ('pfr-004','pf-cycle-002','emp-employee-001','emp-manager-001','manager','pending'),
  ('pfr-005','pf-cycle-002','emp-tl-001',      'emp-manager-001','manager','pending')
ON DUPLICATE KEY UPDATE status=VALUES(status);

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 16: Goals
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO goal (id, employee_id, title, description, goal_type, period, target_value, actual_value, weightage, status, created_by)
VALUES
  ('goal-001','emp-employee-001','Reduce AHT to 4.5 min','Average handle time target','kpi',  'Q1-2026',4.5,4.8,30,'active','emp-manager-001'),
  ('goal-002','emp-employee-001','FCR > 85%',            'First call resolution',      'kpi',  'Q1-2026',85, 82, 25,'active','emp-manager-001'),
  ('goal-003','emp-tl-001',      'Team adherence > 92%', 'Schedule adherence',         'kpi',  'Q1-2026',92, 90, 40,'active','emp-manager-001'),
  ('goal-004','emp-manager-001', 'Process headcount met','Hiring targets achieved',    'strategic','Q1-2026',100,80,50,'active','emp-admin-001')
ON DUPLICATE KEY UPDATE actual_value=VALUES(actual_value);

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 17: Exit Request
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO exit_request (
  id, employee_id, initiated_by, exit_type, exit_sub_type,
  exit_reason_category, resignation_reason,
  last_working_day_proposed, notice_period_days, status
) VALUES (
  'exit-001','emp-recruiter-001','emp-recruiter-001',
  'voluntary','resignation',
  'Better opportunity','Got a better offer from another company',
  DATE_ADD(CURDATE(), INTERVAL 30 DAY), 30, 'submitted'
) ON DUPLICATE KEY UPDATE status=VALUES(status);

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 18: Notification Preferences
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO notification_preferences (id, employee_id, category, preferred_channel, enabled)
SELECT UUID(), e.id, cat.category, 'email', 1
FROM employees e
CROSS JOIN (
  SELECT 'onboarding' category UNION SELECT 'payroll' UNION
  SELECT 'attendance' UNION SELECT 'leave' UNION SELECT 'performance' UNION
  SELECT 'alerts' UNION SELECT 'announcements'
) cat
WHERE e.id IN ('emp-admin-001','emp-hr-001','emp-recruiter-001','emp-manager-001',
               'emp-tl-001','emp-qa-001','emp-wfm-001','emp-finance-001',
               'emp-employee-001','emp-ceo-001','emp-trainer-001')
ON DUPLICATE KEY UPDATE enabled=1;

SELECT CONCAT('Demo data seeded: ', COUNT(*), ' employees') AS status FROM employees WHERE id LIKE 'emp-%';
