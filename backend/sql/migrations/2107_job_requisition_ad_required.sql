-- Job requisition: persisted "run an ad?" decision. The raise form had an Ad/META toggle that was
-- never stored, so the marketing brief always went out and marketing could not tell whether an ad
-- was wanted. DEFAULT 1 keeps every existing requisition behaving as before (ad wanted).
-- Additive and re-runnable.
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'job_requisition' AND COLUMN_NAME = 'ad_required') = 0,
  'ALTER TABLE job_requisition ADD COLUMN ad_required TINYINT(1) NOT NULL DEFAULT 1',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
