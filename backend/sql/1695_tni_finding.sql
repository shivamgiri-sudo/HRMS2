-- Training Needs Identification, derived from real audit data.
--
-- Every quality parameter audited on db_audit.call_quality_assessment already
-- has a proven pass/scored definition (see kpi_studio_source_field for
-- CALL_AUDIT_SHARED) and is live and current. A Training Need is not a form
-- someone fills in — it is what falls out when an agent, or a whole process,
-- keeps failing the SAME parameter across enough audits to rule out chance.
-- This table is where that derivation lands, not another manual entry point.
--
-- One row is one finding: an agent (subject_type='employee') or a whole process
-- (subject_type='process', employee_id NULL) chronically failing one parameter
-- over a rolling window. Findings carry their own evidence (sample/fail counts,
-- the window they were computed over) so a trainer can defend the number without
-- re-deriving it, and a lifecycle (OPEN -> ... -> VERIFIED_EFFECTIVE /
-- VERIFIED_INEFFECTIVE) so "did the coaching work" — TNI efficacy, the second
-- half of the BOPT sheet's "TNI identification/TNI efficacy" task — is answerable
-- from this table alone, by re-scanning the same parameter after the target
-- completion date and comparing fail rates.
--
-- employee_code and employee_name are denormalized onto the row rather than
-- requiring a join back to employees for every read — standing rule: any
-- dashboard identifying a person shows both the name and the code, never one
-- alone (2026-09-08).

CREATE TABLE IF NOT EXISTS tni_finding (
  id                  CHAR(36) NOT NULL PRIMARY KEY,

  subject_type        ENUM('employee','process') NOT NULL,
  employee_id         CHAR(36) NULL,
  employee_code       VARCHAR(32) NULL,
  employee_name       VARCHAR(255) NULL,
  process_id          CHAR(36) NOT NULL,
  process_name        VARCHAR(255) NULL,

  -- The audited parameter this finding is about: accuracy, closure, concern,
  -- empathy, listening, probing (skill gaps, rate-based) or profanity (conduct,
  -- occurrence-based). Matches the CALL_AUDIT_SHARED field naming exactly so a
  -- finding can be traced straight back to the KPI Studio metric it came from.
  parameter_key       VARCHAR(64) NOT NULL,
  tni_category        ENUM('PROCESS_KNOWLEDGE','SOFT_SKILLS','CALL_HANDLING','CONDUCT','PROCESS_ISSUE') NOT NULL,
  coaching_type       ENUM('ONE_ON_ONE','GROUP_SESSION','CONTENT_GAP_REVIEW','OPS_ESCALATION') NOT NULL,
  -- EXTREME_REVIEW: fail rate so high (>=90% on 20+ scored calls) that a
  -- calibration or scoring-template problem is at least as likely as a genuine
  -- agent failure — flagged for a supervisor to look at the source audits
  -- before anyone is coached on it, not auto-assigned like a normal finding.
  severity            ENUM('MEDIUM','HIGH','EXTREME_REVIEW') NOT NULL DEFAULT 'MEDIUM',

  window_from         DATE NOT NULL,
  window_to           DATE NOT NULL,
  sample_count        INT NOT NULL,
  fail_count          INT NOT NULL,
  fail_rate           DECIMAL(6,4) NULL,
  evidence_note       VARCHAR(500) NOT NULL,

  status              ENUM('OPEN','ASSIGNED','IN_PROGRESS','COMPLETED',
                            'VERIFIED_EFFECTIVE','VERIFIED_INEFFECTIVE','DISMISSED')
                        NOT NULL DEFAULT 'OPEN',
  assigned_to         CHAR(36) NULL,
  target_completion_date DATE NULL,
  completed_at        DATETIME NULL,
  verified_at         DATETIME NULL,
  -- The same parameter's fail rate re-measured after target_completion_date.
  -- NULL until an efficacy check has actually run.
  verification_fail_rate DECIMAL(6,4) NULL,
  dismissal_reason    VARCHAR(500) NULL,

  raised_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by          CHAR(36) NULL,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_tni_finding_employee (employee_id, parameter_key, status),
  KEY idx_tni_finding_process  (process_id, parameter_key, status),
  KEY idx_tni_finding_status   (status),
  KEY idx_tni_finding_raised   (raised_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
