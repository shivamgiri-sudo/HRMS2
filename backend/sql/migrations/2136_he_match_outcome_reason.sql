-- 2136: Why a walk-in candidate did not come or declined. One row per he_match (last tap wins). Additive, re-runnable (CREATE TABLE IF NOT EXISTS only, no FKs).
CREATE TABLE IF NOT EXISTS he_match_outcome_reason (
  match_id       CHAR(36)     NOT NULL PRIMARY KEY,
  outcome        VARCHAR(10)  NOT NULL,
  reason_code    VARCHAR(20)  NOT NULL,
  note           VARCHAR(140) NULL,
  requisition_id CHAR(36)     NOT NULL,
  drive_id       CHAR(36)     NULL,
  recorded_by    CHAR(36)     NULL,
  recorded_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_hmor_drive (drive_id, outcome),
  KEY idx_hmor_req (requisition_id, recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
