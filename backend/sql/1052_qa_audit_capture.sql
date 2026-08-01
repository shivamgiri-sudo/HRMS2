-- 1052_qa_audit_capture.sql
--
-- Manual QA audit capture.
--
-- WHY
-- ---
-- There is no quality schema in mas_hrms at all. An exhaustive search for
-- scorecard, evaluation, calibration, fatal-error or CSAT tables returns
-- nothing; every table matching "audit" is a system audit log. The Quality
-- dashboards read the upstream AI scorer (db_audit.call_quality_assessment)
-- directly, which works for the processes that system covers and leaves every
-- manually-audited process with nowhere to record a score.
--
-- The intent was there long before the tables. 102_role_page_access_seed.sql
-- grants QA_EVALUATION and QA_CALIBRATION to qa, manager and branch_head, and
-- neither page code has ever had a route or a table behind it.
--
-- DESIGN
-- ------
-- Forms are per process and versioned, because processes score different things
-- under different names — the same reason 1047 exists. A parameter points at a
-- process_metric_definition row where one fits, so a manual audit and an
-- automated feed can land on the same metric and be compared. Where nothing
-- fits, parameter_text stands alone.
--
-- Audits are immutable once submitted: corrections raise a new audit rather than
-- editing the old one, so an agent cannot find their score silently changed
-- after they acknowledged it. That is why there is no updated_at on the score
-- rows.
--
-- ADDITIVE. Four new tables. Alters nothing.
--
-- DEPENDS ON 1047_process_metric_definition.sql for the parameter FK. The
-- manifest orders 1047 first; applying this alone will fail on that constraint.
--
-- ROLLBACK (reverse order, FKs)
--   DROP TABLE IF EXISTS qa_audit_parameter_score;
--   DROP TABLE IF EXISTS qa_audit;
--   DROP TABLE IF EXISTS qa_audit_form_parameter;
--   DROP TABLE IF EXISTS qa_audit_form;

CREATE TABLE IF NOT EXISTS qa_audit_form (
  id                CHAR(36)      NOT NULL,
  process_id        CHAR(36)      NOT NULL,
  form_name         VARCHAR(255)  NOT NULL,
  version_no        INT UNSIGNED  NOT NULL DEFAULT 1,
  -- draft -> active -> retired. A retired form keeps its audits readable.
  status            ENUM('draft','active','retired') NOT NULL DEFAULT 'draft',
  effective_from    DATE          NOT NULL,
  effective_to      DATE              NULL,
  created_by        CHAR(36)          NULL,
  approved_by       CHAR(36)          NULL,
  approved_at       DATETIME          NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_qaf_process_version (process_id, form_name, version_no),
  KEY idx_qaf_active (process_id, status, effective_from, effective_to),
  CONSTRAINT fk_qaf_process FOREIGN KEY (process_id)
    REFERENCES process_master (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qa_audit_form_parameter (
  id                CHAR(36)      NOT NULL,
  form_id           CHAR(36)      NOT NULL,
  -- Links this parameter to the process's metric definition where one applies,
  -- so a manual score and an automated feed can meet on the same metric.
  -- NULL when the parameter is purely local to the form.
  process_metric_definition_id CHAR(36) NULL,
  section           VARCHAR(100)      NULL,
  parameter_text    VARCHAR(500)  NOT NULL,
  max_score         DECIMAL(8,2)  NOT NULL DEFAULT 1.00,
  weightage         DECIMAL(5,2)  NOT NULL DEFAULT 100.00,
  -- A fatal parameter zeroes the whole audit regardless of every other score.
  is_fatal          TINYINT(1)    NOT NULL DEFAULT 0,
  display_order     INT           NOT NULL DEFAULT 100,
  active_status     TINYINT(1)    NOT NULL DEFAULT 1,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_qafp_form (form_id, active_status, display_order),
  CONSTRAINT fk_qafp_form FOREIGN KEY (form_id)
    REFERENCES qa_audit_form (id) ON DELETE CASCADE,
  CONSTRAINT fk_qafp_metric_def FOREIGN KEY (process_metric_definition_id)
    REFERENCES process_metric_definition (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qa_audit (
  id                CHAR(36)      NOT NULL,
  form_id           CHAR(36)      NOT NULL,
  -- The version scored against, copied rather than joined: a form revised next
  -- month must not change what this audit says it measured.
  form_version_no   INT UNSIGNED  NOT NULL,
  employee_id       CHAR(36)      NOT NULL,
  process_id        CHAR(36)      NOT NULL,
  audit_date        DATE          NOT NULL,
  -- Free-form because call identifiers differ per source (dialer id, CRM
  -- ticket, recording filename) and forcing one shape would lose evidence.
  call_reference    VARCHAR(255)      NULL,
  evidence_url      VARCHAR(1000)     NULL,
  auditor_user_id   CHAR(36)      NOT NULL,
  total_score       DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  max_score         DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  quality_percentage DECIMAL(7,4)     NULL,
  fatal_triggered   TINYINT(1)    NOT NULL DEFAULT 0,
  status            ENUM('draft','submitted','disputed','calibrated','closed')
                    NOT NULL DEFAULT 'draft',
  remarks           TEXT              NULL,
  submitted_at      DATETIME          NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_qa_employee_date (employee_id, audit_date),
  KEY idx_qa_process_date (process_id, audit_date),
  KEY idx_qa_status (status, audit_date),
  CONSTRAINT fk_qa_form FOREIGN KEY (form_id)
    REFERENCES qa_audit_form (id) ON DELETE RESTRICT,
  CONSTRAINT fk_qa_employee FOREIGN KEY (employee_id)
    REFERENCES employees (id) ON DELETE RESTRICT,
  CONSTRAINT fk_qa_process FOREIGN KEY (process_id)
    REFERENCES process_master (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qa_audit_parameter_score (
  id                CHAR(36)      NOT NULL,
  audit_id          CHAR(36)      NOT NULL,
  form_parameter_id CHAR(36)      NOT NULL,
  score             DECIMAL(8,2)      NULL,
  -- NULL score means not applicable to this call, which is different from
  -- zero. Averaging the two together is how an unassessed parameter starts
  -- looking like a failed one.
  not_applicable    TINYINT(1)    NOT NULL DEFAULT 0,
  remark            VARCHAR(1000)     NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_qaps_audit_parameter (audit_id, form_parameter_id),
  CONSTRAINT fk_qaps_audit FOREIGN KEY (audit_id)
    REFERENCES qa_audit (id) ON DELETE CASCADE,
  CONSTRAINT fk_qaps_parameter FOREIGN KEY (form_parameter_id)
    REFERENCES qa_audit_form_parameter (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
