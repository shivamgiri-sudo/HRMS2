-- RECONCILE 2026-09-10: retracts sql/1736's gnc_apr_daily_actual, which
-- landed 0 rows in production (the import path was built but never run for
-- real) and had a KPI Studio source (GNC_APR) wired but not yet computing
-- anything real. Per explicit user instruction given directly in this
-- conversation ("we will use the same database table just build the
-- uploader in HRMS"), GNC APR now writes into db_masmis.gnc_apr directly --
-- the SAME already-live table (829 real rows, stale since 2026-05-30) the
-- separate My Dashboards tool (github.com/tausifansari-mcn/Mydashboards)
-- already writes into. See gnc-apr-masmis-bulk.service.ts. This
-- reconciles the split between GNC APR's earlier new-table approach and
-- GNC Sale's (sql/1740) same-table approach -- both now follow the same
-- rule, at the user's explicit direction, which supersedes the project's
-- default read-only-upstream stance for this specific case.
DROP TABLE IF EXISTS gnc_apr_daily_actual;

UPDATE kpi_studio_data_source
   SET source_object = 'db_masmis.gnc_apr',
       description = 'Manually-uploaded GNC Agent Productivity Report -- writes and reads the same live db_masmis.gnc_apr table Mydashboards already uses (confirmed real, 829+ rows, stale since 2026-05-30 until this uploader is used again).'
 WHERE source_code = 'GNC_APR';
