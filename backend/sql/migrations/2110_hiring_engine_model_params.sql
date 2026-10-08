-- 2110: learned model parameters (show-up base rates and multipliers today; more models later). One row per key,
-- rewritten by the nightly learning job from real drive outcomes. Additive and re-runnable.
CREATE TABLE IF NOT EXISTS he_model_param (
  param_key  VARCHAR(80)   NOT NULL PRIMARY KEY,
  value      DECIMAL(8,4)  NOT NULL,
  sample     INT UNSIGNED  NOT NULL DEFAULT 0,
  updated_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Aadhaar / PAN hashes as identities, so one person applying with two numbers is caught (flagged, never auto-merged).
SET @s = IF((SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_lead_identity' AND COLUMN_NAME = 'kind') NOT LIKE '%aadhaar_hash%',
  "ALTER TABLE he_lead_identity MODIFY kind ENUM('mobile','email','aadhaar_hash','pan_hash') NOT NULL", 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_identity_clash' AND COLUMN_NAME = 'kind') NOT LIKE '%aadhaar_hash%',
  "ALTER TABLE he_identity_clash MODIFY kind ENUM('mobile','email','aadhaar_hash','pan_hash') NOT NULL", 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
