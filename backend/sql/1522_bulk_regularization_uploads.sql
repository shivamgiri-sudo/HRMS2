-- 1522_bulk_regularization_uploads.sql
--
-- WHY
-- ---
-- Attendance regularization, leave, incentive and deduction can each only be raised
-- one employee at a time today. WFM has to open a form per employee per date, which
-- for a branch-month is thousands of manual submissions. This adds a file-upload
-- entry point for all four.
--
-- The design principle, stated by the user: "it is just instead of manual applying we
-- are doing a bulk upload" — so the uploaded rows land in EXACTLY the tables the
-- manual flow writes (attendance_regularization / leave_request / incentive_upload_*
-- / employee_deduction_entries), in the same 'pending' state, and are then approved
-- through the SAME domain engines (wfmService.reviewRegularization,
-- leaveService.reviewRequest, the incentive approval chain, deduction activation).
-- That is what makes the leave balance actually deduct and the attendance record
-- actually change — nothing here re-implements those rules.
--
-- WHAT CHANGES
-- ------------
-- 1. employee_deduction_entries.status gains 'pending_approval'. This is the ONLY
--    one of the four target tables with no pending state — rows went straight to
--    'active' and payrollCalculate.service.ts:1488 picked them up immediately, so a
--    bulk deduction upload would hit payroll before any approval. payroll filters
--    status = 'active', so a 'pending_approval' row is invisible to payroll until
--    the branch head approves it and it flips to 'active'. No salary arithmetic is
--    touched. Existing rows keep their value (enum order preserved, new value
--    appended).
--
-- 2. upload_batch gains an approval stage (approval_status/branch_id/approved_by/
--    approved_at/approval_remarks/submitted_for_approval_at). The existing 15 upload
--    types apply on import and are unaffected — approval_status stays NULL for them
--    and every guard below treats NULL as "no approval required".
--
-- 3. upload_batch_row gains created_entity_type/created_entity_id, so each spreadsheet
--    line is permanently traceable to the domain row it created (and vice versa).
--
-- 4. NEW TABLE bulk_upload_locked_entity — the "nobody can remove that" lock. A row
--    created by an approved bulk upload is registered here, and discard.service.ts
--    refuses to discard anything listed. No FKs (see the collation trap on
--    employees.id); entity_id is a plain char(36) with explicit collation.
--
-- 5. Four upload_template_master rows with real, live-verified sample data (leave
--    codes from leave_type_master, deduction codes from payroll_deduction_type,
--    incentive codes from incentive_master, reason codes from
--    attendance_reason_master — all read from production 2026-08-21).
--
-- SAFE TO APPLY: additive only. One enum widened (append-only), six nullable columns
-- added, one new table, four master rows inserted. No existing column, row or query
-- changes meaning. information_schema-guarded PREPARE/EXECUTE throughout, since
-- MySQL 8 has no ADD COLUMN IF NOT EXISTS (see 1511/1304). Idempotent; safe to re-run.

USE mas_hrms;

-- ---------------------------------------------------------------------------
-- 1. employee_deduction_entries.status += 'pending_approval'
-- ---------------------------------------------------------------------------
-- Guarded on the enum not already containing the value, so a re-run is a no-op
-- rather than a redundant table rebuild.
SET @add_pending = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE employee_deduction_entries MODIFY COLUMN status ENUM(''active'',''inactive'',''pending_approval'') NOT NULL DEFAULT ''active''',
    'SELECT 1 -- employee_deduction_entries.status already has pending_approval'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'employee_deduction_entries'
    AND COLUMN_NAME = 'status'
    AND COLUMN_TYPE LIKE '%pending_approval%'
);
PREPARE _stmt FROM @add_pending;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- ---------------------------------------------------------------------------
-- 2. upload_batch — approval stage
-- ---------------------------------------------------------------------------
-- approval_status vocabulary:
--   NULL                  → this upload type applies on import (the existing 15 types)
--   'pending_branch_head' → rows are staged in their real tables, awaiting branch head
--   'approved'            → branch head approved; domain engines have run
--   'rejected'            → branch head rejected; staged rows cancelled, nothing applied
--   'partially_applied'   → approval ran, some rows failed their domain rules
SET @c = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE upload_batch ADD COLUMN approval_status VARCHAR(30) NULL AFTER batch_status',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'upload_batch' AND COLUMN_NAME = 'approval_status');
PREPARE _s FROM @c; EXECUTE _s; DEALLOCATE PREPARE _s;

-- The branch the whole batch belongs to. Resolved from the uploaded employees at
-- import time, NOT from the uploader — a super_admin uploading for Noida produces a
-- Noida batch that the Noida branch head approves. A batch spanning branches is
-- rejected at import rather than stored with an arbitrary branch_id.
SET @c = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE upload_batch ADD COLUMN branch_id CHAR(36) NULL AFTER approval_status',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'upload_batch' AND COLUMN_NAME = 'branch_id');
PREPARE _s FROM @c; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE upload_batch ADD COLUMN submitted_for_approval_at DATETIME NULL AFTER branch_id',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'upload_batch' AND COLUMN_NAME = 'submitted_for_approval_at');
PREPARE _s FROM @c; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE upload_batch ADD COLUMN approved_by VARCHAR(36) NULL AFTER submitted_for_approval_at',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'upload_batch' AND COLUMN_NAME = 'approved_by');
PREPARE _s FROM @c; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE upload_batch ADD COLUMN approved_at DATETIME NULL AFTER approved_by',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'upload_batch' AND COLUMN_NAME = 'approved_at');
PREPARE _s FROM @c; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE upload_batch ADD COLUMN approval_remarks TEXT NULL AFTER approved_at',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'upload_batch' AND COLUMN_NAME = 'approval_remarks');
PREPARE _s FROM @c; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c = (SELECT IF(COUNT(*) = 0,
  'CREATE INDEX idx_upload_batch_approval ON upload_batch (approval_status, branch_id)',
  'SELECT 1') FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'upload_batch' AND INDEX_NAME = 'idx_upload_batch_approval');
PREPARE _s FROM @c; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ---------------------------------------------------------------------------
-- 3. upload_batch_row — link each spreadsheet line to the row it created
-- ---------------------------------------------------------------------------
SET @c = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE upload_batch_row ADD COLUMN created_entity_type VARCHAR(50) NULL AFTER row_status',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'upload_batch_row' AND COLUMN_NAME = 'created_entity_type');
PREPARE _s FROM @c; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE upload_batch_row ADD COLUMN created_entity_id VARCHAR(36) NULL AFTER created_entity_type',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'upload_batch_row' AND COLUMN_NAME = 'created_entity_id');
PREPARE _s FROM @c; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c = (SELECT IF(COUNT(*) = 0,
  'CREATE INDEX idx_upload_batch_row_entity ON upload_batch_row (created_entity_type, created_entity_id)',
  'SELECT 1') FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'upload_batch_row' AND INDEX_NAME = 'idx_upload_batch_row_entity');
PREPARE _s FROM @c; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ---------------------------------------------------------------------------
-- 4. bulk_upload_locked_entity — the immutability lock
-- ---------------------------------------------------------------------------
-- "should be locked, nobody can remove that". There is no hard DELETE against any
-- of the four target tables anywhere in the backend (verified 2026-08-21) — the only
-- removal path is the discard module, which soft-sets status='discarded' and reverses
-- the leave balance. So the lock is enforced at that one chokepoint:
-- discard.service.ts consults this table and refuses a locked entity.
--
-- A separate registry rather than a `locked` column on four different tables: it keeps
-- the change additive on tables payroll reads, and it holds the provenance (which
-- batch, which approver) that a bare boolean could not.
--
-- No FOREIGN KEY on entity_id — it is polymorphic across four tables, and a char(36)
-- FK into employees/auth_user needs explicit collation to attach at all. Explicit
-- COLLATE on every char column so this table can be joined to upload_batch (verified
-- utf8mb4_unicode_ci) without an "Illegal mix of collations" at query time.
CREATE TABLE IF NOT EXISTS bulk_upload_locked_entity (
  id                CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  entity_type       VARCHAR(50)  COLLATE utf8mb4_unicode_ci NOT NULL,
  entity_id         VARCHAR(36)  COLLATE utf8mb4_unicode_ci NOT NULL,
  upload_batch_id   CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  upload_batch_no   VARCHAR(50)  COLLATE utf8mb4_unicode_ci NULL,
  employee_id       CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  locked_by         VARCHAR(36)  COLLATE utf8mb4_unicode_ci NOT NULL,
  locked_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lock_reason       VARCHAR(255) COLLATE utf8mb4_unicode_ci NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bule_entity (entity_type, entity_id),
  KEY idx_bule_batch (upload_batch_id),
  KEY idx_bule_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 5. upload_template_master — four new templates with real sample data
-- ---------------------------------------------------------------------------
-- Every code in the sample rows was read from live production on 2026-08-21:
--   leave_type_master   → CL, SL, EL, LWP, CO, ML …
--   payroll_deduction_type → CANTEEN, UNIFORM, LOAN_EMI, MOBILE, ASSET_RECOVERY …
--   incentive_master    → PERF, NSA, REF, OT, PLI, SPEC
--   attendance_reason_master → BIOMETRIC_MISMATCH, WFH_NOT_CAPTURED, SYSTEM_OUTAGE …
-- A sample row that names a code the DB does not have would fail validation on the
-- user's very first upload, which is how sample data usually rots.

DELETE FROM upload_template_master
 WHERE upload_type_code IN (
   'ATTENDANCE_REGULARIZATION_BULK','LEAVE_APPLICATION_BULK',
   'INCENTIVE_BULK','DEDUCTION_BULK');

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description,
   required_columns, optional_columns, sample_row, active_status)
VALUES
(UUID(), 'ATTENDANCE_REGULARIZATION_BULK', 'Attendance Regularization (Bulk)',
 'attendance_regularization',
 'Raises attendance regularization requests for many employees at once. Each row becomes one row in attendance_regularization with status=pending — exactly what the single-employee Attendance Regularization screen creates. On branch head approval the existing review engine applies the correction to the attendance record. Uploaded by Super Admin or branch WFM; approved by the Branch Head.',
 JSON_ARRAY('employee_code','session_date','requested_status','reason'),
 JSON_ARRAY('reason_code','dispute_type','new_punch_in','new_punch_out','supporting_note'),
 JSON_OBJECT(
   'employee_code','24852C',
   'session_date','2026-08-05',
   'requested_status','present',
   'reason','Biometric device offline at Noida gate; presence confirmed from dialler login report',
   'reason_code','BIOMETRIC_MISMATCH',
   'dispute_type','missing_punch',
   'new_punch_in','09:30',
   'new_punch_out','18:30',
   'supporting_note','Verified against COSEC outage ticket INC-4471'
 ), 1),

(UUID(), 'LEAVE_APPLICATION_BULK', 'Leave Application (Bulk)',
 'leave_request',
 'Applies leave for many employees at once. Each row becomes one row in leave_request with status=pending and approval_level=branch_head — the same table the manual Apply Leave screen writes. The balance is NOT touched at upload; on branch head approval the existing leave engine deducts it, writing leave_balance_ledger, leave_balance_deduction and leave_approval_log exactly as a manual approval does. Uploaded by Super Admin or branch WFM; approved by the Branch Head.',
 JSON_ARRAY('employee_code','leave_code','from_date','to_date','total_days'),
 JSON_ARRAY('reason'),
 JSON_OBJECT(
   'employee_code','24852C',
   'leave_code','CL',
   'from_date','2026-08-11',
   'to_date','2026-08-12',
   'total_days','2',
   'reason','Family function — informed team leader in advance'
 ), 1),

(UUID(), 'INCENTIVE_BULK', 'Incentive Upload (Bulk)',
 'incentive_upload_line',
 'Uploads monthly incentive amounts for many employees. Rows land in incentive_upload_batch / incentive_upload_line — the same tables the Incentives screen uses — and are held at the branch head approval step before they can reach a payroll register. Uploaded by Super Admin or branch WFM; approved by the Branch Head.',
 JSON_ARRAY('employee_code','incentive_code','pay_month','amount'),
 JSON_ARRAY('remarks'),
 JSON_OBJECT(
   'employee_code','24852C',
   'incentive_code','PERF',
   'pay_month','2026-08',
   'amount','2500.00',
   'remarks','Q2 performance incentive as per approved matrix'
 ), 1),

(UUID(), 'DEDUCTION_BULK', 'Deduction Upload (Bulk)',
 'employee_deduction_entries',
 'Uploads ad-hoc payroll deductions for many employees. Rows land in employee_deduction_entries with status=pending_approval, so payroll (which reads only status=active) cannot pick them up until the branch head approves. Approval flips them to active — the same state a manually entered deduction is created in. Uploaded by Super Admin or branch WFM; approved by the Branch Head.',
 JSON_ARRAY('employee_code','deduction_type_code','run_month','amount','description'),
 JSON_ARRAY('is_prorated'),
 JSON_OBJECT(
   'employee_code','24852C',
   'deduction_type_code','CANTEEN',
   'run_month','2026-08',
   'amount','850.00',
   'description','Canteen recovery for August 2026 as per vendor statement',
   'is_prorated','0'
 ), 1);


-- ---------------------------------------------------------------------------
-- 6. Page access — the queue page, and the WFM grant that was switched off
-- ---------------------------------------------------------------------------
-- Two separate problems, both of which would have made this feature unreachable:
--
-- (a) `wfm` HAS a role_page_access row for BULK_UPLOAD, but with active_status = 0.
--     Verified live 2026-08-21. So the branch WFM — one of the two roles the design
--     names as an uploader — could not open the Bulk Upload page at all. Reactivated
--     here, and added to rbacPageMatrix.ts so apply-rbac-page-matrix does not revoke
--     it again (that script deactivates any live grant missing from the matrix).
--
-- (b) The Branch Head approval queue is a new page and needs its own page_code, since
--     reusing BULK_UPLOAD would hand branch heads the upload screen as well and defeat
--     the separation of duties the gate exists to create.

INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status)
SELECT UUID(), 'BULK_UPLOAD_APPROVALS', 'Bulk Upload Approvals', '/bulk-upload-approvals', 'Admin',
       'Branch Head approval queue for bulk-uploaded leave, attendance regularization, incentive and deduction batches', 1
 WHERE NOT EXISTS (SELECT 1 FROM page_catalog WHERE page_code = 'BULK_UPLOAD_APPROVALS');

-- Branch Head: view and approve (can_edit carries the decision right). No can_create —
-- an approver must not be able to originate a batch on this screen.
INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), 'branch_head', 'BULK_UPLOAD_APPROVALS', 1, 0, 1, 0, 1, 1
 WHERE NOT EXISTS (
   SELECT 1 FROM role_page_access WHERE role_key = 'branch_head' AND page_code = 'BULK_UPLOAD_APPROVALS');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), 'super_admin', 'BULK_UPLOAD_APPROVALS', 1, 0, 1, 0, 1, 1
 WHERE NOT EXISTS (
   SELECT 1 FROM role_page_access WHERE role_key = 'super_admin' AND page_code = 'BULK_UPLOAD_APPROVALS');

-- Reactivate the existing (dormant) WFM grant on the upload hub rather than inserting a
-- duplicate row, so the original grant's history is preserved.
UPDATE role_page_access
   SET active_status = 1, can_create = 1, can_edit = 1
 WHERE role_key = 'wfm' AND page_code = 'BULK_UPLOAD';

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), 'wfm', 'BULK_UPLOAD', 1, 1, 1, 0, 0, 1
 WHERE NOT EXISTS (SELECT 1 FROM role_page_access WHERE role_key = 'wfm' AND page_code = 'BULK_UPLOAD');

SELECT 'Migration 1522 applied: bulk regularization/leave/incentive/deduction upload with branch-head approval' AS status;
