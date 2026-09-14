-- Rebaseline the recorded checksum for 436_pnl_people_classification_seed.sql.
--
-- 436 ran on 2026-07-31 and was edited afterwards: the INSERT gained a rule_name
-- column and a CONCAT that populates it. So the recorded checksum describes a version
-- of the file that no longer exists, and the runner has warned about it on every boot
-- since.
--
-- Rebaselining a checksum is normally the WRONG fix, because it cannot distinguish
-- "the file gained a comment" from "the file gained SQL the database never ran" — and
-- the second case is real schema drift that a rebaseline would bury permanently. This
-- one was checked against live data rather than assumed:
--
--   SELECT COUNT(*), SUM(rule_name IS NULL OR TRIM(rule_name) = '')
--     FROM pnl_cost_classification_rule WHERE scope_type = 'department' AND priority = 50;
--   -> 13 rows, 0 missing rule_name
--
-- Every row the edited statement would create already carries its rule_name, so the
-- newer version of this migration has in fact been applied — by hand, without the
-- ledger being updated. Nothing is outstanding; only the record is stale.
--
-- Guarded on the old value, so it is a no-op anywhere the checksum is already correct
-- or differs for some other reason. Verified on production: stored
-- 341a443d... , file e8352838... .

UPDATE schema_migrations
   SET checksum_sha256 = 'e8352838974bf724caf0f5aaf0628b4c98e6ede2f8b62715758e0506349247bf'
 WHERE filename = '436_pnl_people_classification_seed.sql'
   AND checksum_sha256 = '341a443d74379fc1eb81bfa913a46ef3cbfc6c78b9f7e1a8d45df4af69467a2f';
