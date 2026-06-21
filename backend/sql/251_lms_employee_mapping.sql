-- LMS Employee Mapping with Fallback Strategy
-- Primary: mobile → Secondary: personal_email → Tertiary: official_email → Quaternary: employee_code

CREATE TABLE IF NOT EXISTS lms_employee_mapping (
  id CHAR(36) PRIMARY KEY,
  lms_employee_id VARCHAR(20) NOT NULL UNIQUE,
  hrms_employee_id CHAR(36),
  hrms_employee_code VARCHAR(20),
  hrms_mobile VARCHAR(20),
  hrms_personal_email VARCHAR(100),
  hrms_official_email VARCHAR(100),

  -- Mapping strategy used (which field matched first)
  mapping_source ENUM('mobile', 'personal_email', 'official_email', 'employee_code', 'manual') NOT NULL,
  mapping_confidence ENUM('high', 'medium', 'low') NOT NULL COMMENT 'high=primary field, medium=fallback, low=manual override',

  mapped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  mapped_by VARCHAR(100) COMMENT 'user_id or "system"',
  remarks TEXT,

  UNIQUE KEY (lms_employee_id),
  KEY (hrms_employee_id),
  KEY (mapping_source),
  KEY (mapping_confidence),
  KEY (mapped_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Mapping audit trail (tracks all mapping attempts and failures)
CREATE TABLE IF NOT EXISTS lms_mapping_audit (
  id CHAR(36) PRIMARY KEY,
  lms_employee_id VARCHAR(20) NOT NULL,
  attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  -- What we tried to match
  tried_mobile VARCHAR(20),
  tried_personal_email VARCHAR(100),
  tried_official_email VARCHAR(100),
  tried_employee_code VARCHAR(20),

  -- Results
  mobile_match_found BOOLEAN,
  email_personal_match_found BOOLEAN,
  email_official_match_found BOOLEAN,
  employee_code_match_found BOOLEAN,

  final_match_source ENUM('mobile', 'personal_email', 'official_email', 'employee_code', 'none'),
  final_hrms_employee_id CHAR(36),

  success BOOLEAN,
  error_reason TEXT,

  KEY (lms_employee_id),
  KEY (attempted_at),
  KEY (final_match_source),
  KEY (success)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
