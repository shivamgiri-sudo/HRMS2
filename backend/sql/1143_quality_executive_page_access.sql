-- 1143_quality_executive_page_access.sql
-- Widens QUALITY_EXECUTIVE (/quality/executive) so everyone who can already reach
-- /quality-dashboard (QUALITY_DASHBOARD) can also reach it.
--
-- WHY THIS MIGRATION EXISTS
-- /quality/executive redirected to /quality-dashboard since the 2026-08-04 unified-dashboards
-- consolidation retired ExecutiveQualityDashboard.tsx as a near-duplicate (see
-- docs/superpowers/specs/2026-08-04-unified-quality-operations-dashboards-design.md). On
-- 2026-08-17, QualityDashboard.tsx's Drill-Down/Heatmap/Agent Risk/Inbound/CLAP VOC/
-- Sales & Funnel/AI & ROI tabs moved to ExecutiveQualityDashboard.tsx, and the route was
-- changed to render that page instead of redirecting.
--
-- QUALITY_EXECUTIVE's page_catalog row already existed (1029_ungated_routes_page_catalog.sql)
-- but its role_page_access grants — like FINANCE_GRN's before 1129 — were backfilled to
-- super_admin only by that migration's generic catch-all, plus a handful of roles added since
-- (ceo, coo, tq_head). Live comparison against QUALITY_DASHBOARD's active grants
-- (branch_head, branch_qa, ceo, coo, qa, quality_analyst, super_admin, tq_head) on
-- 2026-08-17 found QUALITY_EXECUTIVE only had ceo/coo/super_admin/tq_head — branch_head,
-- branch_qa, qa and quality_analyst could reach /quality-dashboard's tabs today but would
-- have hit "Access Denied" opening the same tabs at their new address. This migration closes
-- that gap so the move is not also a silent narrowing for those four roles.
--
-- View-only: these roles browse the drill-down/analytics tabs, same as QUALITY_DASHBOARD's
-- own grants for them (can_create/can_edit/can_delete = 0 there too).
--
-- Additive and idempotent. Not executed automatically; runs on the next deploy's migration
-- pass, and a pm2 restart applies it.

INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'branch_head',     'QUALITY_EXECUTIVE', 1, 0, 0, 0, 0, 1),
  (UUID(), 'branch_qa',       'QUALITY_EXECUTIVE', 1, 0, 0, 0, 0, 1),
  (UUID(), 'qa',              'QUALITY_EXECUTIVE', 1, 0, 0, 0, 0, 1),
  (UUID(), 'quality_analyst', 'QUALITY_EXECUTIVE', 1, 0, 0, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  can_view      = 1,
  active_status = 1;

SELECT '1143_quality_executive_page_access.sql applied' AS migration_status;

-- Rollback:
--   UPDATE role_page_access SET active_status = 0
--   WHERE page_code = 'QUALITY_EXECUTIVE'
--     AND role_key IN ('branch_head', 'branch_qa', 'qa', 'quality_analyst');
