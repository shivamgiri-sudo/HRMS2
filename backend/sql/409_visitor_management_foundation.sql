-- 409_visitor_management_foundation.sql
-- Additive Visitor Management foundation. Safe to rerun; no production data is seeded.

CREATE TABLE IF NOT EXISTS visitor_profile (
  id                 CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  full_name          VARCHAR(200) NOT NULL,
  mobile             VARCHAR(20)  NOT NULL,
  mobile_normalized  VARCHAR(20)  NOT NULL,
  email              VARCHAR(255),
  company_name       VARCHAR(255),
  photo_storage_key  VARCHAR(500),
  active_status      TINYINT(1)   NOT NULL DEFAULT 1,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_visitor_profile_mobile (mobile_normalized),
  INDEX idx_visitor_profile_name (full_name)
);

CREATE TABLE IF NOT EXISTS visitor_visit (
  id                    CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  visit_number          VARCHAR(40)   NOT NULL UNIQUE,
  visitor_id            CHAR(36)      NOT NULL,
  branch_id             CHAR(36)      NOT NULL,
  host_employee_id      CHAR(36),
  created_by_user_id    CHAR(36),
  source_channel        VARCHAR(30)   NOT NULL DEFAULT 'visitor_self',
  visit_type            VARCHAR(50)   NOT NULL,
  purpose               VARCHAR(500)  NOT NULL,
  status                VARCHAR(40)   NOT NULL DEFAULT 'pending_approval',
  scheduled_start       DATETIME      NOT NULL,
  scheduled_end         DATETIME      NOT NULL,
  approved_at           DATETIME,
  checked_in_at         DATETIME,
  checked_out_at        DATETIME,
  checkout_requested_at DATETIME,
  tracking_token_hash   CHAR(64)      NOT NULL UNIQUE,
  host_display_name     VARCHAR(200),
  security_notes        TEXT,
  rejection_reason      VARCHAR(500),
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_visitor_visit_profile FOREIGN KEY (visitor_id) REFERENCES visitor_profile(id),
  CONSTRAINT fk_visitor_visit_branch FOREIGN KEY (branch_id) REFERENCES branch_master(id),
  CONSTRAINT fk_visitor_visit_host FOREIGN KEY (host_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  INDEX idx_visitor_visit_branch_status (branch_id, status, scheduled_start),
  INDEX idx_visitor_visit_host_status (host_employee_id, status, scheduled_start),
  INDEX idx_visitor_visit_visitor (visitor_id, created_at)
);

CREATE TABLE IF NOT EXISTS visitor_companion (
  id                 CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  visit_id           CHAR(36)     NOT NULL,
  full_name          VARCHAR(200) NOT NULL,
  mobile             VARCHAR(20),
  relationship_label VARCHAR(100),
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_visitor_companion_visit FOREIGN KEY (visit_id) REFERENCES visitor_visit(id) ON DELETE CASCADE,
  INDEX idx_visitor_companion_visit (visit_id)
);

CREATE TABLE IF NOT EXISTS visitor_consent (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  visitor_id      CHAR(36)     NOT NULL,
  visit_id        CHAR(36)     NOT NULL,
  consent_type    VARCHAR(80)  NOT NULL,
  consent_version VARCHAR(40)  NOT NULL,
  accepted        TINYINT(1)   NOT NULL DEFAULT 1,
  accepted_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_address      VARCHAR(64),
  user_agent      VARCHAR(512),
  withdrawn_at    DATETIME,
  CONSTRAINT fk_visitor_consent_profile FOREIGN KEY (visitor_id) REFERENCES visitor_profile(id),
  CONSTRAINT fk_visitor_consent_visit FOREIGN KEY (visit_id) REFERENCES visitor_visit(id) ON DELETE CASCADE,
  UNIQUE KEY uq_visitor_consent_version (visit_id, consent_type, consent_version)
);

CREATE TABLE IF NOT EXISTS visitor_approval (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  visit_id          CHAR(36)     NOT NULL,
  approval_level    VARCHAR(40)  NOT NULL DEFAULT 'host',
  approver_user_id  CHAR(36),
  approver_employee_id CHAR(36),
  status            VARCHAR(30)  NOT NULL DEFAULT 'pending',
  decision_reason   VARCHAR(500),
  decided_at        DATETIME,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_visitor_approval_visit FOREIGN KEY (visit_id) REFERENCES visitor_visit(id) ON DELETE CASCADE,
  CONSTRAINT fk_visitor_approval_employee FOREIGN KEY (approver_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  INDEX idx_visitor_approval_queue (status, approver_employee_id, created_at)
);

CREATE TABLE IF NOT EXISTS visitor_badge (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  badge_number    VARCHAR(80)  NOT NULL,
  branch_id       CHAR(36)     NOT NULL,
  status          VARCHAR(30)  NOT NULL DEFAULT 'available',
  current_visit_id CHAR(36),
  issued_at       DATETIME,
  returned_at     DATETIME,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_visitor_badge_branch FOREIGN KEY (branch_id) REFERENCES branch_master(id),
  CONSTRAINT fk_visitor_badge_visit FOREIGN KEY (current_visit_id) REFERENCES visitor_visit(id) ON DELETE SET NULL,
  UNIQUE KEY uq_visitor_badge_branch_number (branch_id, badge_number),
  INDEX idx_visitor_badge_branch_status (branch_id, status)
);

CREATE TABLE IF NOT EXISTS visitor_check_event (
  id              CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  visit_id        CHAR(36)    NOT NULL,
  event_type      VARCHAR(40) NOT NULL,
  gate_code       VARCHAR(80),
  badge_id        CHAR(36),
  actor_user_id   CHAR(36),
  occurred_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata_json   JSON,
  CONSTRAINT fk_visitor_check_event_visit FOREIGN KEY (visit_id) REFERENCES visitor_visit(id) ON DELETE CASCADE,
  CONSTRAINT fk_visitor_check_event_badge FOREIGN KEY (badge_id) REFERENCES visitor_badge(id) ON DELETE SET NULL,
  INDEX idx_visitor_check_event_visit (visit_id, occurred_at),
  INDEX idx_visitor_check_event_type_time (event_type, occurred_at)
);

CREATE TABLE IF NOT EXISTS visitor_belonging (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  visit_id       CHAR(36)     NOT NULL,
  item_type      VARCHAR(80)  NOT NULL,
  description    VARCHAR(255),
  serial_number  VARCHAR(150),
  verified_out   TINYINT(1)   NOT NULL DEFAULT 0,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_visitor_belonging_visit FOREIGN KEY (visit_id) REFERENCES visitor_visit(id) ON DELETE CASCADE,
  INDEX idx_visitor_belonging_visit (visit_id)
);

CREATE TABLE IF NOT EXISTS visitor_vehicle (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  visit_id       CHAR(36)     NOT NULL,
  vehicle_number VARCHAR(30)  NOT NULL,
  vehicle_type   VARCHAR(40),
  parking_slot   VARCHAR(50),
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_visitor_vehicle_visit FOREIGN KEY (visit_id) REFERENCES visitor_visit(id) ON DELETE CASCADE,
  INDEX idx_visitor_vehicle_number (vehicle_number),
  INDEX idx_visitor_vehicle_visit (visit_id)
);

CREATE TABLE IF NOT EXISTS visitor_security_exception (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  visit_id        CHAR(36)     NOT NULL,
  exception_type  VARCHAR(80)  NOT NULL,
  severity        VARCHAR(20)  NOT NULL DEFAULT 'medium',
  status          VARCHAR(30)  NOT NULL DEFAULT 'open',
  description     VARCHAR(1000) NOT NULL,
  raised_by_user_id CHAR(36),
  resolved_by_user_id CHAR(36),
  resolved_at     DATETIME,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_visitor_exception_visit FOREIGN KEY (visit_id) REFERENCES visitor_visit(id) ON DELETE CASCADE,
  INDEX idx_visitor_exception_queue (status, severity, created_at)
);

CREATE TABLE IF NOT EXISTS visitor_configuration (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  branch_id    CHAR(36),
  scope_key    VARCHAR(36)  GENERATED ALWAYS AS (COALESCE(branch_id, 'global')) STORED,
  config_key   VARCHAR(100) NOT NULL,
  config_value JSON         NOT NULL,
  active_status TINYINT(1)  NOT NULL DEFAULT 1,
  updated_by_user_id CHAR(36),
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_visitor_config_branch FOREIGN KEY (branch_id) REFERENCES branch_master(id) ON DELETE CASCADE,
  UNIQUE KEY uq_visitor_config_scope (scope_key, config_key)
);
