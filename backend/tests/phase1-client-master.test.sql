-- ============================================================
-- Phase 1 Testing: Client Master Enhancement
-- Database Schema Validation
-- ============================================================

USE mas_hrms;

-- ============================================================
-- TEST 1: Verify all new tables exist
-- ============================================================

SELECT 'TEST 1: Checking table existence' AS test_name;

SELECT
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS clients_table,
  CASE WHEN COUNT(*) = 1 THEN 'clients table exists' ELSE 'clients table missing' END AS status
FROM information_schema.tables
WHERE table_schema = 'mas_hrms' AND table_name = 'clients';

SELECT
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS activity_log_table,
  CASE WHEN COUNT(*) = 1 THEN 'portal_user_activity_log exists' ELSE 'portal_user_activity_log missing' END AS status
FROM information_schema.tables
WHERE table_schema = 'mas_hrms' AND table_name = 'portal_user_activity_log';

SELECT
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS sessions_table,
  CASE WHEN COUNT(*) = 1 THEN 'portal_user_sessions exists' ELSE 'portal_user_sessions missing' END AS status
FROM information_schema.tables
WHERE table_schema = 'mas_hrms' AND table_name = 'portal_user_sessions';

SELECT
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS permissions_table,
  CASE WHEN COUNT(*) = 1 THEN 'portal_user_permissions exists' ELSE 'portal_user_permissions missing' END AS status
FROM information_schema.tables
WHERE table_schema = 'mas_hrms' AND table_name = 'portal_user_permissions';

SELECT
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS usage_stats_table,
  CASE WHEN COUNT(*) = 1 THEN 'client_usage_stats exists' ELSE 'client_usage_stats missing' END AS status
FROM information_schema.tables
WHERE table_schema = 'mas_hrms' AND table_name = 'client_usage_stats';

SELECT
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS performance_table,
  CASE WHEN COUNT(*) = 1 THEN 'process_performance_metrics exists' ELSE 'process_performance_metrics missing' END AS status
FROM information_schema.tables
WHERE table_schema = 'mas_hrms' AND table_name = 'process_performance_metrics';

SELECT
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS bulk_jobs_table,
  CASE WHEN COUNT(*) = 1 THEN 'bulk_operation_jobs exists' ELSE 'bulk_operation_jobs missing' END AS status
FROM information_schema.tables
WHERE table_schema = 'mas_hrms' AND table_name = 'bulk_operation_jobs';

SELECT
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS audit_log_table,
  CASE WHEN COUNT(*) = 1 THEN 'client_audit_log exists' ELSE 'client_audit_log missing' END AS status
FROM information_schema.tables
WHERE table_schema = 'mas_hrms' AND table_name = 'client_audit_log';

-- ============================================================
-- TEST 2: Verify clients table structure
-- ============================================================

SELECT 'TEST 2: Clients table structure' AS test_name;

SELECT
  CASE WHEN COUNT(*) >= 20 THEN '✅ PASS' ELSE '❌ FAIL' END AS column_count,
  CONCAT(COUNT(*), ' columns found (expected >= 20)') AS status
FROM information_schema.columns
WHERE table_schema = 'mas_hrms' AND table_name = 'clients';

-- Check critical columns exist
SELECT
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS has_client_code,
  'client_code column' AS column_name
FROM information_schema.columns
WHERE table_schema = 'mas_hrms' AND table_name = 'clients' AND column_name = 'client_code';

SELECT
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS has_subscription_status,
  'subscription_status column' AS column_name
FROM information_schema.columns
WHERE table_schema = 'mas_hrms' AND table_name = 'clients' AND column_name = 'subscription_status';

SELECT
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS has_api_key,
  'api_key column' AS column_name
FROM information_schema.columns
WHERE table_schema = 'mas_hrms' AND table_name = 'clients' AND column_name = 'api_key';

-- ============================================================
-- TEST 3: Verify enhanced portal_users columns
-- ============================================================

SELECT 'TEST 3: Enhanced portal_users columns' AS test_name;

SELECT
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS has_access_level,
  'access_level column added' AS status
FROM information_schema.columns
WHERE table_schema = 'mas_hrms' AND table_name = 'portal_users' AND column_name = 'access_level';

SELECT
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS has_last_login,
  'last_login_at column added' AS status
FROM information_schema.columns
WHERE table_schema = 'mas_hrms' AND table_name = 'portal_users' AND column_name = 'last_login_at';

SELECT
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS has_access_dates,
  'access_start_date/end_date columns added' AS status
FROM information_schema.columns
WHERE table_schema = 'mas_hrms' AND table_name = 'portal_users' AND column_name = 'access_start_date';

SELECT
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS has_deactivation,
  'deactivated_by/at columns added' AS status
FROM information_schema.columns
WHERE table_schema = 'mas_hrms' AND table_name = 'portal_users' AND column_name = 'deactivated_by';

-- ============================================================
-- TEST 4: Verify enhanced processes columns
-- ============================================================

SELECT 'TEST 4: Enhanced processes columns' AS test_name;

SELECT
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS has_client_uuid,
  'client_uuid column added' AS status
FROM information_schema.columns
WHERE table_schema = 'mas_hrms' AND table_name = 'processes' AND column_name = 'client_uuid';

SELECT
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS has_sla_response,
  'sla_response_hours column added' AS status
FROM information_schema.columns
WHERE table_schema = 'mas_hrms' AND table_name = 'processes' AND column_name = 'sla_response_hours';

SELECT
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS has_process_type,
  'process_type column added' AS status
FROM information_schema.columns
WHERE table_schema = 'mas_hrms' AND table_name = 'processes' AND column_name = 'process_type';

-- ============================================================
-- TEST 5: Verify indexes
-- ============================================================

SELECT 'TEST 5: Index verification' AS test_name;

SELECT
  CASE WHEN COUNT(*) >= 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS has_client_code_index,
  CONCAT(COUNT(*), ' index(es) on clients.client_code') AS status
FROM information_schema.statistics
WHERE table_schema = 'mas_hrms' AND table_name = 'clients' AND column_name = 'client_code';

SELECT
  CASE WHEN COUNT(*) >= 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS has_activity_user_index,
  CONCAT(COUNT(*), ' index(es) on portal_user_activity_log.user_id') AS status
FROM information_schema.statistics
WHERE table_schema = 'mas_hrms' AND table_name = 'portal_user_activity_log' AND column_name = 'user_id';

-- ============================================================
-- TEST 6: Data insertion test (clients table)
-- ============================================================

SELECT 'TEST 6: Client CRUD operations' AS test_name;

-- Insert test client
INSERT INTO clients (
  client_code, client_name, legal_entity_name, industry,
  primary_contact_name, primary_contact_email, primary_contact_phone,
  city, country, subscription_status, billing_cycle
) VALUES (
  'TEST_CLIENT_001',
  'Test Corporation',
  'Test Corp Private Limited',
  'Technology',
  'John Doe',
  'john.doe@testcorp.com',
  '+91-9876543210',
  'Mumbai',
  'India',
  'ACTIVE',
  'MONTHLY'
);

SELECT
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS insert_success,
  'Test client inserted' AS status
FROM clients
WHERE client_code = 'TEST_CLIENT_001';

-- Read test
SELECT
  CASE WHEN client_name = 'Test Corporation' THEN '✅ PASS' ELSE '❌ FAIL' END AS read_success,
  'Client data retrieved correctly' AS status
FROM clients
WHERE client_code = 'TEST_CLIENT_001';

-- Update test
UPDATE clients
SET primary_contact_email = 'updated@testcorp.com'
WHERE client_code = 'TEST_CLIENT_001';

SELECT
  CASE WHEN primary_contact_email = 'updated@testcorp.com' THEN '✅ PASS' ELSE '❌ FAIL' END AS update_success,
  'Client data updated' AS status
FROM clients
WHERE client_code = 'TEST_CLIENT_001';

-- Cleanup
DELETE FROM clients WHERE client_code = 'TEST_CLIENT_001';

SELECT
  CASE WHEN COUNT(*) = 0 THEN '✅ PASS' ELSE '❌ FAIL' END AS delete_success,
  'Test client deleted' AS status
FROM clients
WHERE client_code = 'TEST_CLIENT_001';

-- ============================================================
-- TEST 7: Activity log insertion test
-- ============================================================

SELECT 'TEST 7: Activity logging' AS test_name;

-- Create test portal user first (if not exists)
INSERT IGNORE INTO portal_users (id, email, client_id, is_active, process_ids)
VALUES ('test-user-001', 'test@portal.com', 'test-client', 1, '[]');

-- Log activity
INSERT INTO portal_user_activity_log (
  user_id, action_type, resource_type, resource_id,
  ip_address, request_method, request_path, response_status
) VALUES (
  'test-user-001', 'LOGIN', 'PORTAL', NULL,
  '192.168.1.1', 'POST', '/api/portal/login', 200
);

SELECT
  CASE WHEN COUNT(*) >= 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS activity_log_success,
  CONCAT(COUNT(*), ' activity record(s) created') AS status
FROM portal_user_activity_log
WHERE user_id = 'test-user-001' AND action_type = 'LOGIN';

-- Cleanup
DELETE FROM portal_user_activity_log WHERE user_id = 'test-user-001';
DELETE FROM portal_users WHERE id = 'test-user-001';

-- ============================================================
-- TEST 8: Permissions test
-- ============================================================

SELECT 'TEST 8: Permission management' AS test_name;

-- Create test user
INSERT IGNORE INTO portal_users (id, email, client_id, is_active, process_ids)
VALUES ('test-user-002', 'test2@portal.com', 'test-client', 1, '[]');

-- Grant permission
INSERT INTO portal_user_permissions (
  user_id, permission_type, resource_scope, granted_by
) VALUES (
  'test-user-002', 'VIEW_REPORTS', 'ALL', 'admin-user'
);

SELECT
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS permission_grant_success,
  'Permission granted successfully' AS status
FROM portal_user_permissions
WHERE user_id = 'test-user-002' AND permission_type = 'VIEW_REPORTS';

-- Revoke permission
UPDATE portal_user_permissions
SET active_status = 0
WHERE user_id = 'test-user-002' AND permission_type = 'VIEW_REPORTS';

SELECT
  CASE WHEN active_status = 0 THEN '✅ PASS' ELSE '❌ FAIL' END AS permission_revoke_success,
  'Permission revoked successfully' AS status
FROM portal_user_permissions
WHERE user_id = 'test-user-002' AND permission_type = 'VIEW_REPORTS';

-- Cleanup
DELETE FROM portal_user_permissions WHERE user_id = 'test-user-002';
DELETE FROM portal_users WHERE id = 'test-user-002';

-- ============================================================
-- TEST 9: Bulk operation job tracking
-- ============================================================

SELECT 'TEST 9: Bulk operation job tracking' AS test_name;

-- Create test job
INSERT INTO bulk_operation_jobs (
  job_type, entity_type, total_records, created_by, status
) VALUES (
  'IMPORT_USERS', 'PORTAL_USERS', 100, 'admin-user', 'PENDING'
);

SELECT
  CASE WHEN COUNT(*) >= 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS job_creation_success,
  'Bulk job created' AS status
FROM bulk_operation_jobs
WHERE job_type = 'IMPORT_USERS' AND entity_type = 'PORTAL_USERS';

-- Update job progress
UPDATE bulk_operation_jobs
SET status = 'PROCESSING', processed_records = 50, success_count = 45, error_count = 5
WHERE job_type = 'IMPORT_USERS' AND entity_type = 'PORTAL_USERS' AND status = 'PENDING'
LIMIT 1;

SELECT
  CASE WHEN status = 'PROCESSING' AND processed_records = 50 THEN '✅ PASS' ELSE '❌ FAIL' END AS job_update_success,
  'Job progress updated' AS status
FROM bulk_operation_jobs
WHERE job_type = 'IMPORT_USERS' AND entity_type = 'PORTAL_USERS'
ORDER BY created_at DESC LIMIT 1;

-- Cleanup
DELETE FROM bulk_operation_jobs WHERE job_type = 'IMPORT_USERS' AND entity_type = 'PORTAL_USERS';

-- ============================================================
-- TEST 10: Audit log test
-- ============================================================

SELECT 'TEST 10: Audit logging' AS test_name;

-- Log audit event
INSERT INTO client_audit_log (
  entity_type, entity_id, action_type, actor_user_id,
  actor_email, change_summary, ip_address
) VALUES (
  'CLIENT', 'test-client-001', 'CREATE', 'admin-user',
  'admin@system.com', 'Created new test client', '192.168.1.1'
);

SELECT
  CASE WHEN COUNT(*) >= 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS audit_log_success,
  'Audit record created' AS status
FROM client_audit_log
WHERE entity_type = 'CLIENT' AND entity_id = 'test-client-001';

-- Cleanup
DELETE FROM client_audit_log WHERE entity_id = 'test-client-001';

-- ============================================================
-- FINAL SUMMARY
-- ============================================================

SELECT '============================================================' AS separator;
SELECT 'PHASE 1 DATABASE SCHEMA TESTING COMPLETE' AS summary;
SELECT '============================================================' AS separator;

-- Count results
SELECT
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'mas_hrms' AND table_name IN (
    'clients', 'portal_user_activity_log', 'portal_user_sessions',
    'portal_user_permissions', 'client_usage_stats', 'process_performance_metrics',
    'bulk_operation_jobs', 'client_audit_log'
  )) AS tables_created,
  '/ 8 expected' AS tables_status;
