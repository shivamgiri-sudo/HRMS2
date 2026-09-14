-- Migration 1664: MAS Connect (SOCIAL_FEED) page catalog row and grants
--
-- The social feed shipped on 2026-08-01 (196cd48a, "MAS Connect — company social
-- media feed in HRMS") with its route, its backend module and its sync cron, but
-- with NO page_catalog row and NO role_page_access grants — SOCIAL_FEED appears
-- nowhere in backend/sql/ at all. Verified against production 2026-09-03:
-- `SELECT * FROM page_catalog WHERE page_code LIKE 'SOCIAL%'` returns zero rows.
--
-- That is the same failure 1066, 1129 and 1632 each describe in their own headers:
-- access.service.ts builds its permission map from ACTIVE page_catalog rows, so a
-- page_code with no catalogue row can be held by nobody and <Gate pageCode="SOCIAL_FEED">
-- denies the whole organisation. The page has therefore been unreachable since the
-- day it shipped, for every role.
--
-- WHO GETS IT
-- The route is `<ProtectedRoute><Gate pageCode="SOCIAL_FEED">` with NO role array
-- (platform.routes.tsx:262) — any authenticated user, which matches the feature's
-- own commit message: "Surfaces MAS Callnet's external social media inside HRMS for
-- all employees." So the grant set is derived from MY_PROFILE, the existing
-- company-wide read-only page, rather than invented here: whoever can open their own
-- profile can open the company feed. That is an OBSERVED role set (39 live grants on
-- production), and on a rebuilt database it resolves from whatever MY_PROFILE holds
-- there, so the two cannot drift apart.
--
-- Deliberately view-only. The editable half of this feature, /social-feed/admin, is
-- guarded by its own role array (super_admin, hr_admin, admin) in the route itself and
-- carries no page code, so nothing here should grant create/edit/delete/export.
--
-- Purely additive and idempotent: two INSERT ... ON DUPLICATE KEY UPDATE statements
-- against page_catalog and role_page_access. No ALTER, no DROP, no DELETE, no
-- FOREIGN KEY, and no grant on any other page is touched.
--
-- ROLLBACK:
--   UPDATE role_page_access SET active_status = 0 WHERE page_code = 'SOCIAL_FEED';
--   UPDATE page_catalog     SET active_status = 0 WHERE page_code = 'SOCIAL_FEED';

INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES
  ('SOCIAL_FEED', 'MAS Connect', '/social-feed', 'Engagement',
   'Company social media feed — Facebook, Instagram and YouTube posts synced from the official MAS Callnet accounts, plus the public profile links.',
   1)
ON DUPLICATE KEY UPDATE
  page_name     = VALUES(page_name),
  page_path     = VALUES(page_path),
  module        = VALUES(module),
  description   = VALUES(description),
  active_status = VALUES(active_status);

-- View-only for every role that already holds MY_PROFILE. Derived rather than listed
-- so this cannot fall behind the role set as new roles are added, and so it grants
-- nothing to a role that holds no pages at all.
INSERT INTO role_page_access
  (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT DISTINCT rpa.role_key, 'SOCIAL_FEED', 1, 0, 0, 0, 0, 1
  FROM role_page_access rpa
 WHERE rpa.page_code = 'MY_PROFILE'
   AND rpa.active_status = 1
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  active_status = 1;
