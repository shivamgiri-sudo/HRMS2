CREATE TABLE IF NOT EXISTS upload_batch (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  upload_batch_no   VARCHAR(50)  NOT NULL UNIQUE,
  upload_type_code  VARCHAR(50)  NOT NULL,
  original_file_name VARCHAR(255),
  file_path         VARCHAR(500),
  file_size_bytes   INT,
  total_rows        INT          NOT NULL DEFAULT 0,
  valid_rows        INT          NOT NULL DEFAULT 0,
  error_rows        INT          NOT NULL DEFAULT 0,
  imported_rows     INT          NOT NULL DEFAULT 0,
  batch_status      VARCHAR(50)  NOT NULL DEFAULT 'pending',
  error_summary     TEXT,
  metadata          JSON,
  uploaded_by       CHAR(36),
  validated_by      CHAR(36),
  validated_at      DATETIME,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_batch_no (upload_batch_no),
  INDEX idx_batch_status (batch_status)
);

CREATE TABLE IF NOT EXISTS upload_batch_row (
  id               CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  upload_batch_id  CHAR(36)    NOT NULL,
  row_no           INT         NOT NULL,
  raw_data         JSON,
  normalized_data  JSON,
  row_status       VARCHAR(50) NOT NULL DEFAULT 'pending',
  error_messages   JSON,
  created_at       DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (upload_batch_id) REFERENCES upload_batch(id) ON DELETE CASCADE,
  INDEX idx_batch_row (upload_batch_id, row_no)
);
