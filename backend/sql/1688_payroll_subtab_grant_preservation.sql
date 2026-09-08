-- 1688_payroll_subtab_grant_preservation.sql
--
-- Per-tab RBAC on the merged payroll pages, without changing anyone's access.
--
-- WHAT CHANGED IN THE APP
--   Five payroll pages are merges of former separate screens. Each merged page was gated on
--   one page code, so a single grant opened every tab behind it — Payment Center's
--   PAYROLL_BANK_READINESS grant (11 roles) reached the disbursal pipeline, the payment-file
--   export, CSV upload and manual payment entry. The merges did not delete the codes the
--   folded screens used, so src/components/security/TabGate.tsx points each tab back at its
--   original code.
--
-- WHY THIS MIGRATION EXISTS
--   Those child codes kept their pre-merge grants and nobody maintained them afterwards. Read
--   literally they are narrower than the page grant, so gating on them as-is would revoke
--   access people use today: 8 roles would lose Payment Center's Disbursal tab, and
--   payroll_branch / payroll_head would lose BOTH PF tabs and land on an empty page. That is a
--   policy nobody wrote — it is just a stale seed.
--
--   So this backfills each child grant from its parent: whoever can open the page today keeps
--   every tab they see today. Narrowing (should hr reach Disbursal?) is then a visible decision
--   made against real data, not a silent side effect of a UI fix.
--
--   The backfill reads role_page_access rather than hardcoding a role list, so it preserves what
--   the LIVE table holds — including grants added through the Access Control UI that never
--   appear in backend/sql.
--
-- SAFETY
--   Additive and idempotent. INSERT ... WHERE NOT EXISTS: never updates or deletes an existing
--   row, so a grant already narrowed on purpose is left exactly as it is. Safe to re-run.
--   Permission flags are copied from the parent row, so a read-only parent grant stays read-only.
--
-- ROLLBACK
--   The app change is safe without this migration in one direction only: tabs would hide for
--   roles that hold the page but not the child code. To undo, revert the frontend commit; to
--   undo the rows, see the commented DELETE at the foot of this file.

-- ── 1. Payment Center — DELIBERATELY NOT BACKFILLED ─────────────────────────────
-- PAYROLL_DISBURSAL is retired, not stale. Migration 1605 deactivated every grant on it in
-- production on 2026-08-25 with explicit owner approval, because this same merge left the code
-- dangling: "no route has rendered it since PaymentDisbursalCenter.tsx absorbed its
-- functionality ... which is gated on PAYROLL_BANK_READINESS instead".
--
-- So the Disbursal tab is NOT gated per-tab in the app, and no rows are inserted here. Doing
-- either would undo an approved decision. If disbursal should be narrower than bank readiness,
-- that needs a NEW page code with fresh grants — a decision about who may move money.

-- ── 2. PF Management: Creation Queue + Batches tabs ──────────────────────────────
INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
SELECT UUID(), parent.role_key, pages.page_code,
       parent.can_view, parent.can_create, parent.can_edit, parent.can_delete, parent.can_export,
       1, NOW()
  FROM role_page_access parent
 CROSS JOIN (
    SELECT 'PAYROLL_PF_CREATION_QUEUE' AS page_code UNION ALL
    SELECT 'PAYROLL_PF_BATCHES'
 ) pages
 WHERE parent.page_code = 'PAYROLL_PF_MANAGEMENT'
   AND parent.active_status = 1
   AND parent.can_view = 1
   AND NOT EXISTS (
     SELECT 1 FROM role_page_access child
      WHERE child.role_key = parent.role_key
        AND child.page_code = pages.page_code
   );

-- ── 3. Holiday Work: Submit + Approvals tabs ─────────────────────────────────────
-- Both children are already granted to the same roles as the parent in backend/sql, so this
-- is expected to insert 0 rows. It is here so the live table cannot differ from that.
INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
SELECT UUID(), parent.role_key, pages.page_code,
       parent.can_view, parent.can_create, parent.can_edit, parent.can_delete, parent.can_export,
       1, NOW()
  FROM role_page_access parent
 CROSS JOIN (
    SELECT 'PAYROLL_HOLIDAY_WORK_REQUESTS' AS page_code UNION ALL
    SELECT 'PAYROLL_HOLIDAY_WORK_APPROVALS'
 ) pages
 WHERE parent.page_code = 'PAYROLL_HOLIDAY_WORK'
   AND parent.active_status = 1
   AND parent.can_view = 1
   AND NOT EXISTS (
     SELECT 1 FROM role_page_access child
      WHERE child.role_key = parent.role_key
        AND child.page_code = pages.page_code
   );

-- ── 4. Payroll Readiness: Process View tab ───────────────────────────────────────
-- The page is gated on PAYROLL_BRANCH_READINESS, so today anyone who can open it sees both
-- views regardless of whether they hold PAYROLL_PROCESS_READINESS. payroll_hr is the one role
-- seeded into branch but not process (migration 1643).
INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
SELECT UUID(), parent.role_key, 'PAYROLL_PROCESS_READINESS',
       parent.can_view, parent.can_create, parent.can_edit, parent.can_delete, parent.can_export,
       1, NOW()
  FROM role_page_access parent
 WHERE parent.page_code = 'PAYROLL_BRANCH_READINESS'
   AND parent.active_status = 1
   AND parent.can_view = 1
   AND NOT EXISTS (
     SELECT 1 FROM role_page_access child
      WHERE child.role_key = parent.role_key
        AND child.page_code = 'PAYROLL_PROCESS_READINESS'
   );

-- ── 5. Verification ──────────────────────────────────────────────────────────────
-- A grant is only effective if its page_catalog row is active: getAccessMe() filters on
-- COALESCE(pc.active_status, 1) = 1. Any code listed as INACTIVE below would leave its tab
-- hidden for everyone despite the rows above. Reported rather than auto-corrected — flipping a
-- catalog row back on is a decision, not a side effect of a UI change.
SELECT page_code,
       CASE WHEN active_status = 1 THEN 'active' ELSE '*** INACTIVE — tab will stay hidden ***' END AS catalog_state
  FROM page_catalog
 WHERE page_code IN (
   'PAYROLL_PF_CREATION_QUEUE','PAYROLL_PF_BATCHES',
   'PAYROLL_HOLIDAY_WORK_REQUESTS','PAYROLL_HOLIDAY_WORK_APPROVALS','PAYROLL_PROCESS_READINESS'
 )
 ORDER BY page_code;

-- Parent vs child coverage after the backfill. Every child count should now be >= its parent.
SELECT page_code, COUNT(*) AS roles_with_view
  FROM role_page_access
 WHERE active_status = 1 AND can_view = 1
   AND page_code IN (
     'PAYROLL_PF_MANAGEMENT','PAYROLL_PF_CREATION_QUEUE','PAYROLL_PF_BATCHES',
     'PAYROLL_HOLIDAY_WORK','PAYROLL_HOLIDAY_WORK_REQUESTS','PAYROLL_HOLIDAY_WORK_APPROVALS',
     'PAYROLL_BRANCH_READINESS','PAYROLL_PROCESS_READINESS'
   )
 GROUP BY page_code
 ORDER BY page_code;

SELECT 'Migration 1688: payroll sub-tab grants backfilled from parent pages' AS status;

-- ── Rollback ─────────────────────────────────────────────────────────────────────
-- Removes only the rows this migration created (identified by created_at), never a
-- pre-existing grant. Substitute the actual run timestamp before use.
--
-- DELETE FROM role_page_access
--  WHERE page_code IN ('PAYROLL_PF_CREATION_QUEUE','PAYROLL_PF_BATCHES',
--                      'PAYROLL_HOLIDAY_WORK_REQUESTS','PAYROLL_HOLIDAY_WORK_APPROVALS',
--                      'PAYROLL_PROCESS_READINESS')
--    AND created_at >= '<migration run timestamp>';
