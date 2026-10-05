-- 2111: the lead pool list orders by updated_at; without an index every page sorted all leads (8 s on 38k rows in production).
SET @s = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_lead' AND INDEX_NAME = 'idx_he_lead_updated') = 0,
  'ALTER TABLE he_lead ADD INDEX idx_he_lead_updated (updated_at), ALGORITHM=INPLACE, LOCK=NONE', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
