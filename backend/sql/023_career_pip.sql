USE mas_hrms;

CREATE TABLE IF NOT EXISTS career_path (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)     NOT NULL,
  current_role    VARCHAR(128),
  target_role     VARCHAR(128),
  target_timeline DATE,
  readiness_pct   DECIMAL(5,2) NOT NULL DEFAULT 0,
  skills_gap      TEXT,
  notes           TEXT,
  reviewed_by     CHAR(36),
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_career_emp (employee_id),
  INDEX idx_career_emp (employee_id)
);

CREATE TABLE IF NOT EXISTS pip_record (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)     NOT NULL,
  initiated_by    CHAR(36)     NOT NULL,
  start_date      DATE         NOT NULL,
  end_date        DATE         NOT NULL,
  reason          TEXT         NOT NULL,
  goals           JSON,
  status          ENUM('active','completed','extended','terminated') NOT NULL DEFAULT 'active',
  outcome         ENUM('improved','not_improved','resigned','terminated') NULL,
  review_notes    TEXT,
  closed_by       CHAR(36),
  closed_at       DATETIME,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_pip_emp (employee_id)
);

CREATE TABLE IF NOT EXISTS pip_checkpoint (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  pip_id          CHAR(36)     NOT NULL,
  checkpoint_date DATE         NOT NULL,
  rating          ENUM('on_track','at_risk','off_track') NOT NULL DEFAULT 'on_track',
  notes           TEXT,
  recorded_by     CHAR(36),
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pip_check (pip_id),
  FOREIGN KEY (pip_id) REFERENCES pip_record(id) ON DELETE CASCADE
);
