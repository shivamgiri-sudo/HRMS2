-- Fixes a real design bug found while finally running the real import for
-- lp_leads_raw/lp_apr_daily_actual/lp_cr_report_raw (sql/1701, 1709, 1713 --
-- all three shipped weeks ago with correct code but 0 rows in production,
-- the same "shipped but never run" gap fixed for Housing Premium earlier
-- this session): each table's UNIQUE KEY includes source_reference (the
-- upload batch id), which is different on every re-upload -- so
-- "ON DUPLICATE KEY UPDATE" never actually triggers across separate
-- batches, and re-running the same file's real data creates fresh
-- duplicate rows every time instead of upserting. Caught live: after
-- fixing a real header-mismatch bug in lp-apr-daily-bulk.service.ts and
-- re-running the import multiple times against the same real files, all
-- three tables ended up with exact duplicate rows (verified: 100% of the
-- existing rows in all three tables share the same created_at day --
-- every single row came from this session's own repeated runs today, no
-- prior legitimate data exists to preserve).
--
-- Cleans up by TRUNCATE (safe -- confirmed no pre-existing legitimate
-- data) and re-creates each unique key WITHOUT source_reference, so the
-- row's own real-world identity (agent+date, or lead+phone+campaign+date)
-- is what dedupes, and a re-upload of the same source file correctly
-- upserts instead of duplicating.
TRUNCATE TABLE lp_leads_raw;
ALTER TABLE lp_leads_raw
  DROP INDEX uq_lp_leads_raw,
  ADD UNIQUE KEY uq_lp_leads_raw (process_id, dashboard_label, lead_name, phone_masked, campaign, allocated_on);

TRUNCATE TABLE lp_apr_daily_actual;
ALTER TABLE lp_apr_daily_actual
  DROP INDEX uq_lp_apr_daily,
  ADD UNIQUE KEY uq_lp_apr_daily (process_id, agent_name, call_date);

TRUNCATE TABLE lp_cr_report_raw;
ALTER TABLE lp_cr_report_raw
  DROP INDEX uq_lp_cr_report_raw,
  ADD UNIQUE KEY uq_lp_cr_report_raw (process_id, dashboard_label, lead_name, mobile_masked, created_on);
