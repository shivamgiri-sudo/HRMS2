-- 1612: Correct two more wrong 2026 dates in festival_calendar
--
-- 1226_fix_festival_calendar_2026.sql claimed these were verified against
-- officeholidays.com/prokerala.com, but a fresh cross-check against
-- drikpanchang.com (the authoritative Hindu panchang) and other festival
-- calendars on 2026-08-26 found two still wrong:
--
--   Raksha Bandhan: was 2026-08-26, real date is 2026-08-28
--     (Shravan Purnima spans 27-28 Aug; per Delhi panchang it is observed
--     on the 28th) -- the festival-greetings cron already fired on the
--     wrong day today, 2 days early. This only prevents it firing again.
--   Bhai Dooj:      was 2026-11-10, real date is 2026-11-11
--
-- Applied directly to production on 2026-08-26 (see festival_calendar rows);
-- this file documents that change and lets it reproduce on any other
-- environment. Idempotent: a WHERE clause that already lost its match is a
-- no-op, not an error.

UPDATE festival_calendar SET festival_date = '2026-08-28' WHERE festival_name = 'Raksha Bandhan' AND festival_date = '2026-08-26';
UPDATE festival_calendar SET festival_date = '2026-11-11' WHERE festival_name = 'Bhai Dooj'       AND festival_date = '2026-11-10';

SELECT '1612 applied — Raksha Bandhan/Bhai Dooj 2026 dates corrected' AS migration_status;
