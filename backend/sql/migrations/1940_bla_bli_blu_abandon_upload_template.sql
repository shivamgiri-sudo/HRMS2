-- Bulk Upload Hub entry for the Bla Bli Blu abandon-cart "Received Data" sheet (daily data allocation) that feeds the
-- BLA / BLI / BLU Sales Dashboard. Same target table as the dashboard page's own uploader (bla_dash_received, mig. 1910);
-- re-uploading a date replaces that date. Template row only; no data change. Idempotent (delete + insert of this code).
DELETE FROM upload_template_master WHERE upload_type_code = 'BLA_BLI_BLU_ABANDON';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'BLA_BLI_BLU_ABANDON', 'Bla Bli Blu — Abandon (Received Data)', 'bla_dash_received',
   'Bla Bli Blu abandon-cart Received Data sheet: daily data allocation (Fresh / NC, Workable, DND, attempts, final dispo) that feeds the BLA / BLI / BLU Sales Dashboard. Re-uploading a date replaces that date.',
   JSON_ARRAY('Date', 'LOB', 'Data Type'),
   JSON_ARRAY('Phone', 'Workable', 'Call Answer With in Same Day', 'Same Day Attempt', 'Final Dispo', 'Emp Id', 'Emp Name'),
   JSON_OBJECT('Date', '2026-09-01', 'LOB', 'Cart ABC', 'Data Type', 'Fresh', 'Workable', 'Workable', 'Phone', '9000000001',
     'Same Day Attempt', '1', 'Final Dispo', 'Connected', 'Emp Id', 'MAS00001', 'Emp Name', 'Sample Agent 1'),
   1);
