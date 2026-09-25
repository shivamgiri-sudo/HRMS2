-- Company policies with per-employee acknowledgement (POSH, emergency guidance, integrity, dress code, do's and don'ts).
--   company_policy               one row per published VERSION of a policy (policy_key groups the versions);
--                                only the latest version of a key is active.
--   company_policy_acknowledgement  one row per (policy version, employee) - the proof an employee has read it.
-- HR publishes the wording; nothing is seeded. Collation matches employees (utf8mb4_unicode_ci). Additive and idempotent.

CREATE TABLE IF NOT EXISTS company_policy (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  policy_key VARCHAR(60) NOT NULL,
  version INT NOT NULL DEFAULT 1,
  category VARCHAR(40) NOT NULL,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  effective_from DATE NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  published_by CHAR(36) NULL,
  published_by_name VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_company_policy_version (policy_key, version),
  KEY idx_company_policy_active (is_active, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS company_policy_acknowledgement (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  policy_id CHAR(36) NOT NULL,
  employee_id CHAR(36) NOT NULL,
  acknowledged_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_company_policy_ack (policy_id, employee_id),
  KEY idx_company_policy_ack_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
