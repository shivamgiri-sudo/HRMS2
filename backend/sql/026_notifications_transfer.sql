USE mas_hrms;

CREATE TABLE IF NOT EXISTS work_inbox_item (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  user_id         CHAR(36)     NOT NULL,
  type            VARCHAR(64)  NOT NULL COMMENT 'leave_approval, exit_clearance, workflow_request, pip_checkpoint, asset_return, etc.',
  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  entity_type     VARCHAR(64),
  entity_id       CHAR(36),
  action_url      VARCHAR(512),
  priority        ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  is_read         TINYINT(1)   NOT NULL DEFAULT 0,
  is_actioned     TINYINT(1)   NOT NULL DEFAULT 0,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_inbox_user (user_id),
  INDEX idx_inbox_unread (user_id, is_read)
);

CREATE TABLE IF NOT EXISTS transfer_record (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)     NOT NULL,
  transfer_type   ENUM('branch','department','process','location','reporting') NOT NULL DEFAULT 'department',
  from_value      VARCHAR(255) NOT NULL,
  to_value        VARCHAR(255) NOT NULL,
  effective_date  DATE         NOT NULL,
  reason          TEXT,
  approved_by     CHAR(36),
  status          ENUM('pending','approved','rejected','completed') NOT NULL DEFAULT 'pending',
  initiated_by    CHAR(36)     NOT NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_transfer_emp (employee_id)
);

CREATE TABLE IF NOT EXISTS promotion_record (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)     NOT NULL,
  from_designation VARCHAR(128),
  to_designation  VARCHAR(128) NOT NULL,
  from_grade      VARCHAR(64),
  to_grade        VARCHAR(64),
  effective_date  DATE         NOT NULL,
  salary_revision DECIMAL(12,2),
  reason          TEXT,
  approved_by     CHAR(36),
  status          ENUM('pending','approved','rejected','completed') NOT NULL DEFAULT 'pending',
  initiated_by    CHAR(36)     NOT NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_promo_emp (employee_id)
);
