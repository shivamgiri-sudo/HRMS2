-- 239_conversion_funnel_schema.sql
-- Conversion funnel tracking for Inbound, Outbound, Chat, and Email processes
USE mas_hrms;

-- Primary conversion funnel fact table
CREATE TABLE IF NOT EXISTS conversion_funnel_event (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  process_type        VARCHAR(50)  NOT NULL, -- 'inbound', 'outbound', 'chat', 'email'
  funnel_stage        VARCHAR(50)  NOT NULL, -- stage within the funnel
  contact_id          VARCHAR(255) NOT NULL, -- unique identifier per channel
  employee_id         CHAR(36),
  process_master_id   CHAR(36),
  customer_id         VARCHAR(255),
  customer_segment    VARCHAR(100),
  channel             VARCHAR(50),

  -- Funnel progression timestamps
  stage_entered_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  stage_exited_at     DATETIME,
  stage_duration_secs INT,

  -- Stage-specific metrics
  metric_value        DECIMAL(12,2), -- e.g., call duration, resolution time
  status              VARCHAR(50),   -- 'pending', 'completed', 'abandoned', 'converted'
  conversion_flag     TINYINT      DEFAULT 0, -- 1 if led to conversion

  -- Audit
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_cfe_process_type (process_type),
  INDEX idx_cfe_stage (funnel_stage),
  INDEX idx_cfe_contact (contact_id),
  INDEX idx_cfe_employee (employee_id),
  INDEX idx_cfe_process (process_master_id),
  INDEX idx_cfe_entered_at (stage_entered_at),
  INDEX idx_cfe_conversion (conversion_flag, process_type),
  KEY idx_cfe_composite (process_type, funnel_stage, stage_entered_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Inbound funnel stages detail
CREATE TABLE IF NOT EXISTS inbound_funnel_detail (
  id                       CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  conversion_funnel_event_id CHAR(36)  NOT NULL,

  -- Inbound specific: call_connect -> concern -> offer -> sale
  call_initiated_at        DATETIME,
  call_connected_at        DATETIME,
  concern_identified_at    DATETIME,
  concern_category         VARCHAR(100),
  offer_prepared_at        DATETIME,
  offer_presented_at       DATETIME,
  offer_details            JSON,
  sale_completed_at        DATETIME,
  sale_amount              DECIMAL(12,2),

  -- Quality metrics
  iq_score                 DECIMAL(5,2),
  csat_score               DECIMAL(5,2),

  created_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversion_funnel_event_id) REFERENCES conversion_funnel_event(id) ON DELETE CASCADE,
  INDEX idx_inbound_event (conversion_funnel_event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Outbound funnel stages detail
CREATE TABLE IF NOT EXISTS outbound_funnel_detail (
  id                       CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  conversion_funnel_event_id CHAR(36)  NOT NULL,

  -- Outbound specific: dial -> connect -> talk_30s -> sale
  dial_initiated_at        DATETIME,
  dial_attempted_count     INT,
  connection_established_at DATETIME,
  talk_start_at            DATETIME,
  talk_end_at              DATETIME,
  talk_duration_secs       INT,
  connection_quality       VARCHAR(50), -- 'excellent', 'good', 'poor', 'dropped'
  talk_duration_threshold  INT          DEFAULT 30, -- seconds

  sale_completed_at        DATETIME,
  sale_amount              DECIMAL(12,2),

  -- Attempt tracking
  attempt_number           INT,
  callback_scheduled_at    DATETIME,

  created_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversion_funnel_event_id) REFERENCES conversion_funnel_event(id) ON DELETE CASCADE,
  INDEX idx_outbound_event (conversion_funnel_event_id),
  INDEX idx_outbound_dial_at (dial_initiated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Chat funnel stages detail
CREATE TABLE IF NOT EXISTS chat_funnel_detail (
  id                       CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  conversion_funnel_event_id CHAR(36)  NOT NULL,

  -- Chat specific: initiated -> resolved -> upsell -> sale
  chat_initiated_at        DATETIME,
  first_response_at        DATETIME,
  first_response_time_secs INT,

  issue_identified_at      DATETIME,
  issue_category           VARCHAR(100),
  resolution_suggested_at  DATETIME,
  resolution_accepted_at   DATETIME,
  resolution_time_secs     INT,

  upsell_offered_at        DATETIME,
  upsell_details           JSON,
  upsell_accepted_at       DATETIME,

  sale_completed_at        DATETIME,
  sale_amount              DECIMAL(12,2),

  -- Chat metrics
  message_count            INT,
  avg_response_time_secs   DECIMAL(10,2),
  csat_score               DECIMAL(5,2),

  created_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversion_funnel_event_id) REFERENCES conversion_funnel_event(id) ON DELETE CASCADE,
  INDEX idx_chat_event (conversion_funnel_event_id),
  INDEX idx_chat_initiated_at (chat_initiated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Email funnel stages detail
CREATE TABLE IF NOT EXISTS email_funnel_detail (
  id                       CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  conversion_funnel_event_id CHAR(36)  NOT NULL,

  -- Email specific: received -> responded -> resolved -> upsell
  email_received_at        DATETIME,
  email_subject            VARCHAR(500),
  email_category           VARCHAR(100),

  first_response_at        DATETIME,
  response_time_hours      DECIMAL(10,2),
  response_count           INT,

  resolution_provided_at   DATETIME,
  resolution_category      VARCHAR(100),
  customer_confirmed_at    DATETIME,

  upsell_offered_at        DATETIME,
  upsell_details           JSON,
  upsell_accepted_at       DATETIME,

  sale_completed_at        DATETIME,
  sale_amount              DECIMAL(12,2),

  -- Email metrics
  email_exchange_count     INT,
  total_time_hours         DECIMAL(10,2),

  created_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversion_funnel_event_id) REFERENCES conversion_funnel_event(id) ON DELETE CASCADE,
  INDEX idx_email_event (conversion_funnel_event_id),
  INDEX idx_email_received_at (email_received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Process-level funnel stage configuration
CREATE TABLE IF NOT EXISTS funnel_stage_config (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  process_type        VARCHAR(50)  NOT NULL,
  stage_sequence      INT          NOT NULL,
  stage_name          VARCHAR(100) NOT NULL,
  stage_description   TEXT,

  -- SLA and targets
  sla_minutes         INT,
  target_conversion_pct DECIMAL(5,2),

  active_status       TINYINT      DEFAULT 1,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_funnel_stage (process_type, stage_name),
  INDEX idx_funnel_process (process_type, stage_sequence)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed funnel stage configuration
INSERT IGNORE INTO funnel_stage_config (id, process_type, stage_sequence, stage_name, stage_description, sla_minutes, target_conversion_pct) VALUES
-- Inbound stages
(UUID(), 'inbound', 1, 'call_connect', 'Customer call connected to agent', 1, 100),
(UUID(), 'inbound', 2, 'concern_identified', 'Agent identified customer concern', 3, 100),
(UUID(), 'inbound', 3, 'offer_prepared', 'Agent prepared offer/solution', 5, 80),
(UUID(), 'inbound', 4, 'offer_presented', 'Offer presented to customer', 8, 75),
(UUID(), 'inbound', 5, 'sale_completed', 'Sale completed or declined', 10, 60),

-- Outbound stages
(UUID(), 'outbound', 1, 'dial_initiated', 'Dial attempt initiated', 0, 100),
(UUID(), 'outbound', 2, 'call_connected', 'Customer connection established', 2, 70),
(UUID(), 'outbound', 3, 'talk_30s', 'Talk duration exceeds 30 seconds', 3, 65),
(UUID(), 'outbound', 4, 'sale_completed', 'Sale completed or declined', 10, 45),

-- Chat stages
(UUID(), 'chat', 1, 'chat_initiated', 'Customer initiates chat', 0, 100),
(UUID(), 'chat', 2, 'first_response', 'Agent responds to customer', 2, 95),
(UUID(), 'chat', 3, 'issue_resolved', 'Issue resolved and confirmed', 15, 85),
(UUID(), 'chat', 4, 'upsell_offered', 'Upsell opportunity presented', 20, 70),
(UUID(), 'chat', 5, 'sale_completed', 'Sale completed or declined', 25, 50),

-- Email stages
(UUID(), 'email', 1, 'email_received', 'Email received and queued', 0, 100),
(UUID(), 'email', 2, 'first_response', 'First response sent to customer', 240, 90),
(UUID(), 'email', 3, 'issue_resolved', 'Issue resolved and confirmed', 480, 80),
(UUID(), 'email', 4, 'upsell_offered', 'Upsell opportunity presented', 720, 60),
(UUID(), 'email', 5, 'sale_completed', 'Sale completed or declined', 1440, 40);

-- Funnel analytics snapshot table (daily aggregation)
CREATE TABLE IF NOT EXISTS funnel_daily_snapshot (
  id                    CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  snapshot_date         DATE         NOT NULL,
  process_type          VARCHAR(50)  NOT NULL,
  funnel_stage          VARCHAR(50)  NOT NULL,

  total_entries         INT          DEFAULT 0,
  completed_entries     INT          DEFAULT 0,
  abandoned_entries     INT          DEFAULT 0,
  converted_entries     INT          DEFAULT 0,

  conversion_pct        DECIMAL(5,2),
  stage_drop_off_pct    DECIMAL(5,2),
  avg_stage_duration_secs INT,

  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_funnel_snapshot (snapshot_date, process_type, funnel_stage),
  INDEX idx_funnel_snap_date (snapshot_date),
  INDEX idx_funnel_snap_process (process_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Department/Branch-level funnel performance
CREATE TABLE IF NOT EXISTS funnel_org_performance (
  id                    CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  performance_date      DATE         NOT NULL,
  process_type          VARCHAR(50)  NOT NULL,
  process_id            CHAR(36),
  department_id         CHAR(36),
  branch_id             CHAR(36),

  -- Full funnel metrics
  total_funnel_entries  INT,
  stage_1_count         INT,
  stage_2_count         INT,
  stage_3_count         INT,
  stage_4_count         INT,
  stage_5_count         INT,

  -- Conversions
  total_conversions     INT,
  conversion_rate_pct   DECIMAL(5,2),

  -- Bottleneck analysis
  worst_drop_off_stage  VARCHAR(50),
  worst_drop_off_pct    DECIMAL(5,2),

  -- Revenue impact
  total_sale_value      DECIMAL(15,2),
  avg_sale_value        DECIMAL(12,2),

  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_funnel_perf_date (performance_date),
  INDEX idx_funnel_perf_process (process_type),
  INDEX idx_funnel_perf_process_id (process_id),
  KEY idx_funnel_perf_composite (performance_date, process_type, branch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Employee-level funnel performance
CREATE TABLE IF NOT EXISTS funnel_employee_performance (
  id                    CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  performance_date      DATE         NOT NULL,
  employee_id           CHAR(36)     NOT NULL,
  process_type          VARCHAR(50)  NOT NULL,

  -- Funnel progression
  total_entries         INT          DEFAULT 0,
  completed_entries     INT          DEFAULT 0,
  conversions           INT          DEFAULT 0,
  conversion_rate_pct   DECIMAL(5,2),

  -- Performance tier
  performance_tier      VARCHAR(20), -- 'top_10', 'top_25', 'median', 'bottom_25', 'bottom_10'

  -- Benchmarking
  dept_avg_conv_pct     DECIMAL(5,2),
  dept_rank             INT,

  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_emp_perf (performance_date, employee_id, process_type),
  INDEX idx_emp_perf_date (performance_date),
  INDEX idx_emp_perf_employee (employee_id),
  INDEX idx_emp_perf_process (process_type),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
