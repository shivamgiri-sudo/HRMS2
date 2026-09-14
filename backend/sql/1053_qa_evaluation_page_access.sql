-- 1053_qa_evaluation_page_access.sql
--
-- Register the QA audit pages so somebody can actually open them.
--
-- WHY
-- ---
-- QA_EVALUATION and QA_CALIBRATION do not exist in production. Not "granted but
-- unrouted" — absent entirely: zero rows in page_catalog and zero rows in
-- role_page_access. 102_role_page_access_seed.sql contains them, but those rows
-- were never applied.
--
-- That matters now because /quality/audit-forms is gated on QA_EVALUATION.
-- WorkforcePageGate resolves access through /api/access/me, which joins against
-- page_catalog, so a page code missing from the catalog blocks EVERY role
-- including the ones the router names. The form builder would have been
-- unreachable — the same "built but nobody can open it" defect that left
-- QUALITY_EXECUTIVE, CALL_MASTER and four other pages with no grants at all.
--
-- QA_CALIBRATION is registered as INACTIVE. Calibration has no route and no
-- table yet, and an active catalog row for a page that does not exist sends
-- ModuleLauncher straight to a 404 — roughly 30 rows already do exactly that.
-- It is recorded so the grant story is complete, and switched on when the page
-- ships.
--
-- ADDITIVE. Two catalog rows and four grants. Nothing is modified or removed.
--
-- ROLLBACK
--   DELETE FROM role_page_access WHERE page_code IN ('QA_EVALUATION','QA_CALIBRATION');
--   DELETE FROM page_catalog     WHERE page_code IN ('QA_EVALUATION','QA_CALIBRATION');

INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status, created_at)
SELECT UUID(), 'QA_EVALUATION', 'QA Audit Forms', '/quality/audit-forms', 'Quality',
       'Define what a process is scored on, and version it', 1, NOW()
 WHERE NOT EXISTS (SELECT 1 FROM page_catalog WHERE page_code = 'QA_EVALUATION');

INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status, created_at)
SELECT UUID(), 'QA_CALIBRATION', 'QA Calibration', '/quality/calibration', 'Quality',
       'Cross-auditor calibration — inactive until the page ships', 0, NOW()
 WHERE NOT EXISTS (SELECT 1 FROM page_catalog WHERE page_code = 'QA_CALIBRATION');

-- Defining the criteria everyone is judged by is a QA-lead decision, so this
-- matches the route's own role list rather than the wider audit-filing set.
-- quality_analyst files audits; it does not set what they are scored against.
INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
SELECT UUID(), r.role_key, 'QA_EVALUATION', 1, 1, 1, 0, 0, 1, NOW()
  FROM (SELECT 'super_admin' AS role_key
        UNION ALL SELECT 'admin'
        UNION ALL SELECT 'qa'
        UNION ALL SELECT 'tq_head') r
 WHERE NOT EXISTS (
   SELECT 1 FROM role_page_access x
    WHERE x.role_key = r.role_key AND x.page_code = 'QA_EVALUATION'
 );
