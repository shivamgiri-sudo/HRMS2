USE mas_hrms;

-- Stores HR-approved, pre-aggregated, masked snapshots visible to clients
CREATE TABLE IF NOT EXISTS portal_published_snapshot (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  process_id      CHAR(36)     NOT NULL,
  snapshot_type   ENUM('kpi','governance','attrition','staffing','quality') NOT NULL,
  period          VARCHAR(7)   NOT NULL COMMENT 'YYYY-MM',
  snapshot_data   JSON         NOT NULL COMMENT 'Pre-aggregated, masked data approved for client view',
  approved_by     CHAR(36)     NOT NULL,
  approved_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  notes           TEXT,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pps_process (process_id, snapshot_type, period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Staging queue: HR prepares data here before approving for client view
CREATE TABLE IF NOT EXISTS portal_data_approval_queue (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  process_id       CHAR(36)     NOT NULL,
  snapshot_type    ENUM('kpi','governance','attrition','staffing','quality') NOT NULL,
  period           VARCHAR(7)   NOT NULL,
  prepared_data    JSON         NOT NULL,
  prepared_by      CHAR(36),
  status           ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  reviewed_by      CHAR(36),
  reviewed_at      DATETIME,
  rejection_reason TEXT,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
