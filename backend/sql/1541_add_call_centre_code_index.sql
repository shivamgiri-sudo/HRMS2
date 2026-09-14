-- Migration: 1541_add_call_centre_code_index.sql
-- Adds an index on employees.call_centre_code so the KPI sync bridge
-- (mapEmployees in kpi-data-connector.service.ts) can resolve MasId
-- identifiers from call_quality_assessment and CallDetails in O(1)
-- rather than a full-table scan.
--
-- The call_centre_code column holds the agent's dialer/call-centre ID
-- (e.g. shivamgiri.AgentMaster.MasId). Once populated via the bridge
-- script (backend/scripts/populate-call-centre-code.mjs), this index
-- is what makes every subsequent KPI quality sync fast.
--
-- Safe to re-run: checks information_schema before adding, compatible with MySQL 5.7+.

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name   = 'employees'
    AND index_name   = 'idx_call_centre_code'
);
SET @sql := IF(@idx_exists > 0,
  'SELECT 1 -- index already exists',
  'ALTER TABLE employees ADD INDEX idx_call_centre_code (call_centre_code)'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
