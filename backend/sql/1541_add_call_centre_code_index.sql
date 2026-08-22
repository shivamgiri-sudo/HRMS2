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
-- Safe to re-run: ADD INDEX IF NOT EXISTS is idempotent on MySQL 8.0+.

ALTER TABLE employees
  ADD INDEX IF NOT EXISTS idx_call_centre_code (call_centre_code);
