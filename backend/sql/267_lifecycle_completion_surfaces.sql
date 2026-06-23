DELIMITER $$

DROP PROCEDURE IF EXISTS _m267_salary_exception_proposal $$
CREATE PROCEDURE _m267_salary_exception_proposal()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_exception_proposal'
  ) THEN
    CREATE TABLE salary_exception_proposal (
      id                    CHAR(36)       NOT NULL,
      candidate_id          CHAR(36)       NOT NULL,
      salary_slab_id        CHAR(36)       NOT NULL,
      proposed_gross_salary DECIMAL(12,2)  NOT NULL,
      proposal_reason       TEXT           NOT NULL,
      proposed_by           CHAR(36)       NOT NULL,
      status                ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
      approved_by           CHAR(36)       NULL,
      approved_at           DATETIME       NULL,
      rejection_reason      TEXT           NULL,
      created_at            DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at            DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_salary_exception_candidate (candidate_id),
      INDEX idx_salary_exception_status (status),
      INDEX idx_salary_exception_slab (salary_slab_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  END IF;
END $$
CALL _m267_salary_exception_proposal() $$
DROP PROCEDURE IF EXISTS _m267_salary_exception_proposal $$

DROP PROCEDURE IF EXISTS _m267_appointment_letter_request $$
CREATE PROCEDURE _m267_appointment_letter_request()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'appointment_letter_request'
  ) THEN
    CREATE TABLE appointment_letter_request (
      id                       CHAR(36)      NOT NULL,
      employee_id              CHAR(36)      NOT NULL,
      candidate_id             CHAR(36)      NULL,
      template_id              CHAR(36)      NULL,
      document_url             VARCHAR(500)  NULL,
      aadhaar_esign_status     ENUM('not_sent','sent','candidate_signed','failed','manual_completed') NOT NULL DEFAULT 'not_sent',
      company_signature_status ENUM('pending','signed','failed','manual_completed') NOT NULL DEFAULT 'pending',
      final_pdf_url            VARCHAR(500)  NULL,
      status                   ENUM('draft','sent_for_esign','candidate_signed','company_signed','completed','blocked') NOT NULL DEFAULT 'draft',
      sent_at                  DATETIME      NULL,
      candidate_signed_at      DATETIME      NULL,
      company_signed_at        DATETIME      NULL,
      completed_at             DATETIME      NULL,
      created_at               DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at               DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_appointment_employee (employee_id),
      INDEX idx_appointment_candidate (candidate_id),
      INDEX idx_appointment_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  END IF;
END $$
CALL _m267_appointment_letter_request() $$
DROP PROCEDURE IF EXISTS _m267_appointment_letter_request $$

DELIMITER ;
