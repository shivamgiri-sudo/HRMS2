USE mas_hrms;

CREATE TABLE IF NOT EXISTS location_master (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  location_name  VARCHAR(128) NOT NULL,
  location_code  VARCHAR(32),
  address        TEXT,
  city           VARCHAR(64),
  state          VARCHAR(64),
  pincode        VARCHAR(10),
  branch_id      CHAR(36),
  active_status  TINYINT(1)   NOT NULL DEFAULT 1,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS policy_master (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  policy_name    VARCHAR(128) NOT NULL,
  policy_code    VARCHAR(32),
  description    TEXT,
  effective_date DATE,
  version        VARCHAR(16),
  active_status  TINYINT(1)   NOT NULL DEFAULT 1,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
