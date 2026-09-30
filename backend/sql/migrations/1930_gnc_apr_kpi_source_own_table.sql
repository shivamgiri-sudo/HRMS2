-- GNC "Agent Productivity Report" KPI source read the stale db_masmis.gnc_apr mirror, which has no pause_seconds
-- column, so the pause_sec field could never compute. GNC's uploads land in our own gnc_apr_daily_actual
-- (migration 1736), which has every column this source uses (dispo/pause/talk/wait seconds, report_date, process_id).
-- Idempotent: only touches the row while it still points at the old object.
UPDATE kpi_studio_data_source
   SET source_object = 'gnc_apr_daily_actual'
 WHERE source_code = 'GNC_APR'
   AND source_object = 'db_masmis.gnc_apr';
