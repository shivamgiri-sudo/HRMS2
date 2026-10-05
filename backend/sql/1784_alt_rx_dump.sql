-- ALT RX ticket Dump: the saved dataset behind the ALT RX dashboard and MIS.
--
-- One row per ticket of the latest uploaded Dump. The bulk-upload pipeline stages a file in
-- upload_batch / upload_batch_row, and importAltRxDumpBatch() writes it here, replacing the
-- previous Dump. Columns follow the Dump's own headers (see EXPECTED_COLUMNS in
-- alt-rx.engine.ts); anything the uploader does not know is kept in extra_json.
--
-- Additive: CREATE TABLE IF NOT EXISTS, and one template row. Applied only after explicit approval.

CREATE TABLE IF NOT EXISTS db_masmis.altdump (
  id                       BIGINT        NOT NULL AUTO_INCREMENT,
  upload_batch_id          CHAR(36)      NOT NULL,
  row_no                   INT           NULL,
  ticket_id                VARCHAR(40)   NULL,
  subject                  VARCHAR(1000) NULL,
  status                   VARCHAR(80)   NULL,
  priority                 VARCHAR(40)   NULL,
  source                   VARCHAR(80)   NULL,
  ticket_type              VARCHAR(120)  NULL,
  agent                    VARCHAR(160)  NULL,
  group_name               VARCHAR(120)  NULL,
  created_time             DATETIME      NULL,
  due_by_time              DATETIME      NULL,
  resolved_time            DATETIME      NULL,
  closed_time              DATETIME      NULL,
  last_update_time         DATETIME      NULL,
  initial_response_time    DATETIME      NULL,
  time_tracked             VARCHAR(40)   NULL,
  first_response_hrs       VARCHAR(40)   NULL,
  resolution_hrs           VARCHAR(40)   NULL,
  agent_interactions       VARCHAR(20)   NULL,
  customer_interactions    VARCHAR(20)   NULL,
  resolution_status        VARCHAR(80)   NULL,
  first_response_status    VARCHAR(80)   NULL,
  tags                     VARCHAR(1000) NULL,
  survey_results           VARCHAR(1000) NULL,
  product                  VARCHAR(255)  NULL,
  every_response_status    VARCHAR(255)  NULL,
  reference_number         VARCHAR(255)  NULL,
  summary                  TEXT          NULL,
  product_series           VARCHAR(255)  NULL,
  source_info              VARCHAR(255)  NULL,
  assigned_ticket_time     DATETIME      NULL,
  full_name                VARCHAR(255)  NULL,
  contact_id               VARCHAR(255)  NULL,
  extra_json               JSON          NULL,
  created_at               DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_altdump_batch (upload_batch_id),
  KEY idx_altdump_created (created_time),
  KEY idx_altdump_ticket (ticket_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Upload template so the ALT RX Dump appears in the Uploader like the other processes.
-- Required = the columns the dashboard cannot work without; the rest are optional.
INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
SELECT UUID(), 'ALT_RX_DUMP_MASMIS', 'ALT RX — Ticket Dump (writes to db_masmis.altdump)', 'db_masmis.altdump',
  'ALT RX ticket Dump. Each upload replaces the previous Dump.',
  JSON_ARRAY('Ticket ID', 'Status', 'Agent', 'Type', 'Source Info', 'Created time', 'Initial response time', 'Resolved time'),
  JSON_ARRAY('Subject', 'Priority', 'Source', 'Group', 'Due by Time', 'Closed time', 'Last update time', 'Time tracked',
    'First response time (in hrs)', 'Resolution time (in hrs)', 'Agent interactions', 'Customer interactions',
    'Resolution status', 'First response status', 'Tags', 'Survey results', 'Product', 'Every response status',
    'Reference Number', 'Summary', 'Product Series', 'Assigned Ticket Time', 'Full name', 'Contact ID'),
  JSON_OBJECT('Ticket ID', 'SAMPLE'),
  1
WHERE NOT EXISTS (SELECT 1 FROM upload_template_master WHERE upload_type_code = 'ALT_RX_DUMP_MASMIS');
