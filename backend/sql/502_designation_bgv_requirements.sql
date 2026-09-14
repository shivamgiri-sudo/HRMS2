-- Migration: 502_designation_bgv_requirements.sql
-- Purpose: Add BGV requirements to designation_master and
--          create the candidate_documents table if missing
-- Date: 2026-07-16

-- ============================================================================
-- 1. Add bgv_requirements JSON column to designation_master
-- ============================================================================

SET @bgv_col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'designation_master'
    AND COLUMN_NAME = 'bgv_requirements'
);

SET @sql = IF(@bgv_col_exists = 0,
  'ALTER TABLE designation_master
   ADD COLUMN bgv_requirements JSON NULL
   COMMENT ''Role-based BGV check requirements''',
  'SELECT ''bgv_requirements column already exists'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- 2. Populate BGV requirements based on designation name patterns
-- ============================================================================

-- Entry-level roles (Telecaller, Agent, Associate)
UPDATE designation_master
SET bgv_requirements = JSON_OBJECT(
  'pan', TRUE, 'aadhaar', TRUE, 'bank', TRUE,
  'uan_employment', FALSE, 'criminal', FALSE, 'aml', FALSE, 'documents', TRUE
)
WHERE LOWER(designation_name) REGEXP 'telecaller|agent|associate|executive'
  AND bgv_requirements IS NULL;

-- Team Leaders
UPDATE designation_master
SET bgv_requirements = JSON_OBJECT(
  'pan', TRUE, 'aadhaar', TRUE, 'bank', TRUE,
  'uan_employment', TRUE, 'criminal', FALSE, 'aml', FALSE, 'documents', TRUE
)
WHERE LOWER(designation_name) REGEXP 'team leader|team lead| tl |^tl$|sr\\..*agent|senior.*agent'
  AND bgv_requirements IS NULL;

-- Quality Analysts and Trainers
UPDATE designation_master
SET bgv_requirements = JSON_OBJECT(
  'pan', TRUE, 'aadhaar', TRUE, 'bank', TRUE,
  'uan_employment', TRUE, 'criminal', FALSE, 'aml', FALSE, 'documents', TRUE
)
WHERE LOWER(designation_name) REGEXP 'quality|qa|trainer|training'
  AND bgv_requirements IS NULL;

-- Managers and Process Managers
UPDATE designation_master
SET bgv_requirements = JSON_OBJECT(
  'pan', TRUE, 'aadhaar', TRUE, 'bank', TRUE,
  'uan_employment', TRUE, 'criminal', TRUE, 'aml', FALSE, 'documents', TRUE
)
WHERE LOWER(designation_name) REGEXP 'manager|process manager|operations manager'
  AND bgv_requirements IS NULL;

-- Finance / Payroll (highest non-head risk)
UPDATE designation_master
SET bgv_requirements = JSON_OBJECT(
  'pan', TRUE, 'aadhaar', TRUE, 'bank', TRUE,
  'uan_employment', TRUE, 'criminal', TRUE, 'aml', TRUE, 'documents', TRUE
)
WHERE LOWER(designation_name) REGEXP 'finance|payroll|accounts|accountant'
  AND bgv_requirements IS NULL;

-- HR and Recruitment
UPDATE designation_master
SET bgv_requirements = JSON_OBJECT(
  'pan', TRUE, 'aadhaar', TRUE, 'bank', TRUE,
  'uan_employment', TRUE, 'criminal', TRUE, 'aml', FALSE, 'documents', TRUE
)
WHERE LOWER(designation_name) REGEXP '^hr|human resource|recruiter|recruitment'
  AND bgv_requirements IS NULL;

-- IT Admin
UPDATE designation_master
SET bgv_requirements = JSON_OBJECT(
  'pan', TRUE, 'aadhaar', TRUE, 'bank', TRUE,
  'uan_employment', TRUE, 'criminal', TRUE, 'aml', FALSE, 'documents', TRUE
)
WHERE LOWER(designation_name) REGEXP 'it admin|it support|system admin|network'
  AND bgv_requirements IS NULL;

-- Senior Management (Branch Head, Director, Head)
UPDATE designation_master
SET bgv_requirements = JSON_OBJECT(
  'pan', TRUE, 'aadhaar', TRUE, 'bank', TRUE,
  'uan_employment', TRUE, 'criminal', TRUE, 'aml', TRUE, 'documents', TRUE
)
WHERE LOWER(designation_name) REGEXP 'branch head|director|head|vp|vice president|ceo|coo|cfo'
  AND bgv_requirements IS NULL;

-- Admin roles
UPDATE designation_master
SET bgv_requirements = JSON_OBJECT(
  'pan', TRUE, 'aadhaar', TRUE, 'bank', TRUE,
  'uan_employment', FALSE, 'criminal', FALSE, 'aml', FALSE, 'documents', TRUE
)
WHERE LOWER(designation_name) REGEXP 'admin|office assistant|receptionist'
  AND bgv_requirements IS NULL;

-- Default: apply medium-risk requirements to anything still NULL
UPDATE designation_master
SET bgv_requirements = JSON_OBJECT(
  'pan', TRUE, 'aadhaar', TRUE, 'bank', TRUE,
  'uan_employment', TRUE, 'criminal', FALSE, 'aml', FALSE, 'documents', TRUE
)
WHERE bgv_requirements IS NULL;

-- ============================================================================
-- 3. Ensure candidate_documents table has document_type column
-- ============================================================================

SET @doc_type_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'candidate_documents'
    AND COLUMN_NAME = 'document_type'
);

SET @sql = IF(@doc_type_exists = 0,
  'ALTER TABLE candidate_documents
   ADD COLUMN document_type VARCHAR(80) NULL
   COMMENT ''Normalised document type code'' AFTER candidate_id',
  'SELECT ''document_type already exists'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- 4. Ensure salary_exception_proposal has candidate_id column
-- ============================================================================

SET @sep_cand_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'salary_exception_proposal'
    AND COLUMN_NAME = 'candidate_id'
);

SET @sql = IF(@sep_cand_exists = 0,
  'ALTER TABLE salary_exception_proposal
   ADD COLUMN candidate_id CHAR(36) NULL
   COMMENT ''Link back to ATS candidate'' AFTER id',
  'SELECT ''candidate_id already exists in salary_exception_proposal'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- 5. Ensure ats_branch_head_approval has candidate_id column
-- ============================================================================

SET @bha_cand_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ats_branch_head_approval'
    AND COLUMN_NAME = 'candidate_id'
);

SET @sql = IF(@bha_cand_exists = 0,
  'ALTER TABLE ats_branch_head_approval
   ADD COLUMN candidate_id CHAR(36) NULL
   COMMENT ''Link back to ATS candidate'' AFTER id',
  'SELECT ''candidate_id already exists in ats_branch_head_approval'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- Validation
-- ============================================================================

SELECT
  CASE WHEN COUNT(*) > 0 THEN '✓ BGV requirements populated'
       ELSE '✗ No designations updated'
  END AS result
FROM designation_master
WHERE bgv_requirements IS NOT NULL;

SELECT
  designation_name,
  JSON_EXTRACT(bgv_requirements, '$.criminal') AS criminal_check,
  JSON_EXTRACT(bgv_requirements, '$.aml') AS aml_check
FROM designation_master
ORDER BY designation_name
LIMIT 20;

SELECT '✓ Migration 502_designation_bgv_requirements.sql complete' AS status;
