-- 414_finance_grn_sequence.sql
-- Prevents duplicate GRN numbers during concurrent branch submissions while
-- preserving the existing Mas/<branch-seq>/<yy>/<sequence> format.

CREATE TABLE IF NOT EXISTS finance_grn_sequence (
  branch_id CHAR(36) NOT NULL,
  financial_year VARCHAR(10) NOT NULL,
  next_sequence BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (branch_id, financial_year),
  INDEX idx_finance_grn_sequence_fy (financial_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed the next value from all existing GRNs. The suffix is numeric in the
-- current number format. Invalid or legacy formats safely fall back to count+1.
INSERT INTO finance_grn_sequence (branch_id, financial_year, next_sequence)
SELECT
  branch_id,
  financial_year,
  GREATEST(
    COALESCE(MAX(CAST(SUBSTRING_INDEX(grn_number, '/', -1) AS UNSIGNED)), 0),
    COUNT(*)
  ) + 1 AS next_sequence
FROM grn_request
WHERE branch_id IS NOT NULL
  AND financial_year IS NOT NULL
GROUP BY branch_id, financial_year
ON DUPLICATE KEY UPDATE
  next_sequence = GREATEST(finance_grn_sequence.next_sequence, VALUES(next_sequence));

-- Add a database guarantee only when historical data has no duplicate non-null
-- GRN numbers. The sequence allocator prevents all future duplicates even when
-- an old duplicate must first be reviewed manually.
SET @duplicate_grn_number_count = (
  SELECT COUNT(*) FROM (
    SELECT grn_number
      FROM grn_request
     WHERE grn_number IS NOT NULL AND grn_number <> ''
     GROUP BY grn_number
    HAVING COUNT(*) > 1
  ) duplicate_grn_numbers
);
SET @sql = IF(
  @duplicate_grn_number_count = 0
  AND (SELECT COUNT(*)
         FROM information_schema.statistics
        WHERE table_schema = DATABASE()
          AND table_name = 'grn_request'
          AND index_name = 'uq_grn_number') = 0,
  'ALTER TABLE grn_request ADD UNIQUE KEY uq_grn_number (grn_number)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '414_finance_grn_sequence.sql applied' AS migration_status;
