-- 510_portal_superadmin_user.sql
-- Creates / upserts shivam.giri@teammas.in as a portal super-admin user.
-- This user is granted access to ALL active client processes so they can
-- log into any client portal view without needing a per-process token.
--
-- Idempotent: ON DUPLICATE KEY UPDATE means safe to re-run.

-- ── 1. Ensure there is at least one client_master row to anchor the user ──────
-- shivam.giri is an internal MAS super-admin, so we attach them to a
-- synthetic internal client row (client_code = 'MAS_INTERNAL') if it exists,
-- or the first active client otherwise.  The portal token uses process_ids for
-- scope — the client_id on this row is only for FK integrity.

SET @internal_client_id = (
  SELECT id FROM client_master
  WHERE client_code = 'MAS_INTERNAL'
  LIMIT 1
);

-- Fall back to first active client if MAS_INTERNAL doesn't exist yet
SET @internal_client_id = COALESCE(
  @internal_client_id,
  (SELECT id FROM client_master WHERE active_status = 1 ORDER BY created_at LIMIT 1)
);

-- ── 2. Collect ALL active process IDs as a JSON array ────────────────────────
SET @all_process_ids = (
  SELECT CONCAT('[', GROUP_CONCAT(CONCAT('"', id, '"') ORDER BY process_name SEPARATOR ','), ']')
  FROM process_master
  WHERE active_status = 1
);

-- Default to empty array if no processes exist yet
SET @all_process_ids = COALESCE(@all_process_ids, '[]');

-- ── 3. Upsert shivam.giri as a portal client_user ────────────────────────────
-- We only do this if a client exists to anchor to (avoids FK failure on fresh DBs)
INSERT INTO client_user (
  id,
  client_id,
  email,
  name,
  designation,
  process_ids,
  is_active,
  access_level
)
SELECT
  'cu-shivam-superadmin-001',
  @internal_client_id,
  'shivam.giri@teammas.in',
  'Shivam Giri',
  'Super Admin',
  @all_process_ids,
  1,
  'ADMIN'
WHERE @internal_client_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  process_ids  = @all_process_ids,
  is_active    = 1,
  access_level = 'ADMIN',
  name         = 'Shivam Giri',
  designation  = 'Super Admin';

-- ── 4. Set OTP password directly so the portal login OTP flow works ──────────
-- The portal uses email-based OTP (no password column). The user just needs
-- to exist in client_user with is_active=1 and the correct email.
-- No password column needed — OTP is sent to email on each login.

SELECT CONCAT(
  'Portal user status: ',
  COALESCE((SELECT CONCAT(email, ' | active=', is_active, ' | processes=', process_ids)
            FROM client_user WHERE id = 'cu-shivam-superadmin-001'), 'NOT CREATED (no client exists)')
) AS migration_result;
