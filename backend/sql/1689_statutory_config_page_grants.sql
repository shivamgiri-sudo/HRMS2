-- 1689_statutory_config_page_grants.sql
--
-- OPTIONAL — this one WIDENS access. Run it only if the finding below is accepted.
-- 1688 is the migration that ships with the sub-tab RBAC change; this is separate on purpose
-- so it can be declined without holding that up.
--
-- THE FINDING
--   STATUTORY_CONFIG is the page code /payroll/statutory is gated on (payroll.routes.tsx), and
--   it has NO role_page_access grant anywhere in backend/sql — only its page_catalog row, added
--   by 170_access_improvements.sql. Because getAccessMe() hands super_admin every active page
--   code, super_admin is the only role that can open Statutory & Filing at all.
--
--   Everything around it disagrees with that:
--     - the route lists roles super_admin, payroll_head, finance, admin
--     - navConfig.tsx line 376 offers the link to admin, hr, finance, super_admin, payroll_head
--     - PAYROLL_STATUTORY_FILING — the Filing Tracker tab's own code — is granted to
--       admin, finance, payroll_head, super_admin
--   So three roles hold the filing grant for a tab on a page they cannot open, and the sidebar
--   offers them a link that denies them. StatutoryCenter.tsx carried a hardcoded
--   roleKeys.includes("super_admin") on the Config tab, which reads like a workaround for this.
--
-- WHAT THIS DOES
--   Grants STATUTORY_CONFIG to exactly the roles that already hold PAYROLL_STATUTORY_FILING, so
--   the page opens for the population the filing grant already describes. It does not invent a
--   new set: if you want a different one, edit the source page code below rather than adding
--   roles by hand, so the two stay explainable.
--
--   Config remains read-only for them regardless: the write controls inside the Configuration
--   tab are gated separately on super_admin in StatutoryCenter.tsx (ConfigTab, line ~863), and
--   the statutory override endpoints enforce their own roles. This grant decides who can OPEN
--   the page, not who can change a statutory rate.
--
-- SAFETY
--   Additive and idempotent (INSERT ... WHERE NOT EXISTS). can_edit / can_delete are 0 — this
--   grants viewing only. Safe to re-run. Rollback at the foot of the file.

INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
SELECT UUID(), src.role_key, 'STATUTORY_CONFIG', 1, 0, 0, 0, src.can_export, 1, NOW()
  FROM role_page_access src
 WHERE src.page_code = 'PAYROLL_STATUTORY_FILING'
   AND src.active_status = 1
   AND src.can_view = 1
   AND NOT EXISTS (
     SELECT 1 FROM role_page_access existing
      WHERE existing.role_key = src.role_key
        AND existing.page_code = 'STATUTORY_CONFIG'
   );

-- Verification: who can now open /payroll/statutory, and who sees each tab.
SELECT page_code, GROUP_CONCAT(role_key ORDER BY role_key) AS roles
  FROM role_page_access
 WHERE active_status = 1 AND can_view = 1
   AND page_code IN ('STATUTORY_CONFIG', 'PAYROLL_STATUTORY_FILING')
 GROUP BY page_code;

SELECT 'Migration 1689: STATUTORY_CONFIG granted to the roles already holding PAYROLL_STATUTORY_FILING' AS status;

-- ── Rollback ─────────────────────────────────────────────────────────────────────
-- DELETE FROM role_page_access
--  WHERE page_code = 'STATUTORY_CONFIG'
--    AND created_at >= '<migration run timestamp>';
