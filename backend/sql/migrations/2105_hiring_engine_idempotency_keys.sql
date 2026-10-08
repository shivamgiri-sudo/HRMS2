-- 2105: make webhook/call idempotency a database guarantee instead of a check-then-insert race.
-- A provider retry (or a burst of the same webhook) used to be able to store the same inbound message or the same
-- voice call more than once, because "have I seen this id?" and the INSERT were two statements. NULL ids (messages
-- with no provider id) stay unconstrained. Guarded so it is safe to re-run. Pre-existing duplicates (none in a fresh
-- deploy) are removed first, keeping one row per id.
-- Compared by id, not created_at: duplicates written in the same second have identical timestamps.
DELETE m1 FROM he_message m1 JOIN he_message m2
  ON m1.provider_message_id = m2.provider_message_id AND m1.direction = m2.direction AND m1.id > m2.id
 WHERE m1.provider_message_id IS NOT NULL;
DELETE c1 FROM he_call c1 JOIN he_call c2
  ON c1.provider_call_id = c2.provider_call_id AND c1.id > c2.id
 WHERE c1.provider_call_id IS NOT NULL;

SET @s1 := IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'he_message' AND index_name = 'uq_he_msg_provider_dir') = 0,
  'ALTER TABLE he_message ADD UNIQUE KEY uq_he_msg_provider_dir (provider_message_id, direction)', 'SELECT 1');
PREPARE p1 FROM @s1; EXECUTE p1; DEALLOCATE PREPARE p1;

SET @s2 := IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'he_call' AND index_name = 'uq_he_call_provider') = 0,
  'ALTER TABLE he_call ADD UNIQUE KEY uq_he_call_provider (provider_call_id)', 'SELECT 1');
PREPARE p2 FROM @s2; EXECUTE p2; DEALLOCATE PREPARE p2;
