-- 001_core_org.sql
CREATE DATABASE IF NOT EXISTS mas_hrms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE mas_hrms;

CREATE TABLE IF NOT EXISTS tenant_config (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  tenant_key    VARCHAR(100) NOT NULL UNIQUE DEFAULT 'default',
  company_name  VARCHAR(255),
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  config_json   JSON,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tenant_module_config (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  tenant_key    VARCHAR(100) NOT NULL DEFAULT 'default',
  module_key    VARCHAR(100) NOT NULL,
  enabled       TINYINT(1)   NOT NULL DEFAULT 1,
  config_json   JSON,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_module (tenant_key, module_key)
);

CREATE TABLE IF NOT EXISTS branch_master (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  branch_code   VARCHAR(50)  NOT NULL UNIQUE,
  branch_name   VARCHAR(255) NOT NULL,
  city          VARCHAR(100),
  state         VARCHAR(100),
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS department_master (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  dept_code     VARCHAR(50)  NOT NULL UNIQUE,
  dept_name     VARCHAR(255) NOT NULL,
  branch_id     CHAR(36),
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branch_master(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS process_master (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  process_code  VARCHAR(50)  NOT NULL UNIQUE,
  process_name  VARCHAR(255) NOT NULL,
  business_lob  VARCHAR(100),
  branch_id     CHAR(36),
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branch_master(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS lob_master (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  lob_code      VARCHAR(50)  NOT NULL UNIQUE,
  lob_name      VARCHAR(255) NOT NULL,
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS designation_master (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  designation_code  VARCHAR(50)  NOT NULL UNIQUE,
  designation_name  VARCHAR(255) NOT NULL,
  grade             VARCHAR(50),
  active_status     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO tenant_config (tenant_key, company_name) VALUES ('default', 'MAS Callnet')
  ON DUPLICATE KEY UPDATE company_name = VALUES(company_name);

INSERT INTO tenant_module_config (tenant_key, module_key, enabled) VALUES
  ('default', 'ATS',         1),
  ('default', 'LMS',         1),
  ('default', 'WFM',         1),
  ('default', 'QUALITY',     1),
  ('default', 'OPERATIONS',  1),
  ('default', 'PERFORMANCE', 1),
  ('default', 'DIALER',      1),
  ('default', 'SALARY',      1),
  ('default', 'KPI',         1),
  ('default', 'INTEGRATION', 1)
ON DUPLICATE KEY UPDATE enabled = VALUES(enabled);
