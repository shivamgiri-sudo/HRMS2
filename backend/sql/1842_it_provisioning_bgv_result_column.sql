-- 1842_it_provisioning_bgv_result_column.sql
--
-- Adds a nullable Red/Green result flag to it_provisioning_request, for the new
-- HR_BGV_INITIATION join task (backend/src/modules/it-provisioning/it-provisioning.service.ts's
-- JOIN_TASKS). The task's free-text completion note reuses the existing evidence_note
-- column — this migration only adds the structured result, which nothing existing reads or
-- writes, so it cannot change behavior for any of the other 4 task types.
--
-- Additive, idempotent. NOT EXECUTED against production (CLAUDE.md rule 4).

SET @col_exists = (
  SELECT COUNT(*)
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'it_provisioning_request'
     AND COLUMN_NAME = 'bgv_result'
);

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE it_provisioning_request
   ADD COLUMN bgv_result ENUM(''red'',''green'') NULL
     COMMENT ''HR_BGV_INITIATION task outcome only; NULL for every other task_code''
     AFTER evidence_note',
  'SELECT ''it_provisioning_request.bgv_result already exists'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT '✓ Migration 1842_it_provisioning_bgv_result_column.sql complete' AS status;
