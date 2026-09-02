-- Migration 1641: Create portal users for all clients with mapped processes
-- Applied 2026-08-31
--
-- Creates one portal user per client, granting access to all their mapped processes.
-- Emails use placeholder pattern: portal-{client_code}@mcnhrms.teammas.in
-- These should be updated to real client contact emails for production use.

-- Temporarily skip if user already exists (by client_id)
INSERT INTO client_user (id, client_id, email, name, designation, process_ids, access_level, is_active)
SELECT
  UUID(),
  c.id,
  CONCAT('portal-', LOWER(REPLACE(c.client_code, ' ', '-')), '@mcnhrms.teammas.in') AS email,
  COALESCE(c.primary_contact_name, CONCAT(c.client_name, ' Portal User')) AS name,
  'Client Admin' AS designation,
  COALESCE(
    (SELECT JSON_ARRAYAGG(pm.id) FROM process_master pm WHERE pm.client_id = c.id AND pm.active_status = 1),
    '[]'
  ) AS process_ids,
  'USER' AS access_level,
  1 AS is_active
FROM client_master c
WHERE c.active_status = 1
  AND NOT EXISTS (
    SELECT 1 FROM client_user cu WHERE cu.client_id = c.id
  )
  AND EXISTS (
    SELECT 1 FROM process_master pm WHERE pm.client_id = c.id AND pm.active_status = 1
  );