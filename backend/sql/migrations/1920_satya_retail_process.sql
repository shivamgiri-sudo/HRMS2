-- Migration 1920: a "Satya Retail" process record.
--
-- Satya Retail has its own Process Performance (TPZ) dashboards and real uploaded data (satya_allocation, satya_cdr:
-- thousands of shops and call records), but no process_master row, so it cannot be selected on Process Operations and its
-- sales / calling figures never reach the KPI page. Business datapoints resolves it by name (any process whose name
-- contains "satya") as soon as one exists.
--
-- Additive and idempotent: inserts one active process only when no process with this code or a "satya" name exists.
-- No branch, client, employees or metric definitions are attached; those are set by the owner in the normal screens.
INSERT INTO process_master (process_code, process_name, slug, active_status)
SELECT 'SATYA_RETAIL', 'Satya Retail', 'satya-retail', 1
  FROM DUAL
 WHERE NOT EXISTS (
         SELECT 1 FROM process_master WHERE process_code = 'SATYA_RETAIL' OR LOWER(process_name) LIKE '%satya%'
       );
