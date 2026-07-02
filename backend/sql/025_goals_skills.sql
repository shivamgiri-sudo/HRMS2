USE mas_hrms;

CREATE TABLE IF NOT EXISTS goal (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)     NOT NULL,
  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  goal_type       ENUM('individual','team','department','company') NOT NULL DEFAULT 'individual',
  period          VARCHAR(9)   NOT NULL COMMENT 'Format: YYYY-MM or YYYY-Q1',
  target_value    DECIMAL(10,2),
  actual_value    DECIMAL(10,2),
  weightage       DECIMAL(5,2) NOT NULL DEFAULT 100,
  status          ENUM('draft','active','completed','cancelled') NOT NULL DEFAULT 'active',
  created_by      CHAR(36),
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_goal_emp (employee_id),
  INDEX idx_goal_period (period)
);

CREATE TABLE IF NOT EXISTS appraisal_cycle (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  cycle_name      VARCHAR(128) NOT NULL,
  period          VARCHAR(9)   NOT NULL,
  start_date      DATE         NOT NULL,
  end_date        DATE         NOT NULL,
  status          ENUM('draft','active','closed') NOT NULL DEFAULT 'draft',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS appraisal_rating (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  cycle_id        CHAR(36)     NOT NULL,
  employee_id     CHAR(36)     NOT NULL,
  self_rating     DECIMAL(3,1),
  manager_rating  DECIMAL(3,1),
  final_rating    DECIMAL(3,1),
  self_comments   TEXT,
  manager_comments TEXT,
  status          ENUM('pending','self_done','manager_done','calibrated','closed') NOT NULL DEFAULT 'pending',
  rated_by        CHAR(36),
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_appraisal (cycle_id, employee_id),
  INDEX idx_appr_emp (employee_id),
  FOREIGN KEY (cycle_id) REFERENCES appraisal_cycle(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS skill_master (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  skill_name      VARCHAR(128) NOT NULL UNIQUE,
  skill_category  VARCHAR(64),
  description     TEXT,
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS employee_skill (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)     NOT NULL,
  skill_id        CHAR(36)     NOT NULL,
  proficiency     ENUM('beginner','intermediate','advanced','expert') NOT NULL DEFAULT 'beginner',
  certified       TINYINT(1)   NOT NULL DEFAULT 0,
  assessed_date   DATE,
  notes           TEXT,
  UNIQUE KEY uq_emp_skill (employee_id, skill_id),
  INDEX idx_empskill_emp (employee_id),
  FOREIGN KEY (skill_id) REFERENCES skill_master(id) ON DELETE CASCADE
);
