-- 1226: Correct festival_calendar dates for 2026
-- Source: officeholidays.com + prokerala.com verified 2026-08-17
-- Eight existing rows had wrong dates (lunar/Islamic festivals were not recalculated
-- from 2025; Diwali/Dussehra were off by ~2 weeks).
-- Four missing festivals added: Maha Shivratri, Raksha Bandhan, Chhath Puja,
-- Guru Nanak Jayanti.

-- ─── Correct existing wrong dates ────────────────────────────────────────────

UPDATE festival_calendar SET festival_date = '2026-03-04' WHERE festival_name = 'Holi'             AND festival_date = '2026-03-21';
UPDATE festival_calendar SET festival_date = '2026-03-20' WHERE festival_name = 'Eid-ul-Fitr'     AND festival_date = '2026-03-30';
UPDATE festival_calendar SET festival_date = '2026-05-27' WHERE festival_name = 'Eid-ul-Adha'     AND festival_date = '2026-06-06';
UPDATE festival_calendar SET festival_date = '2026-09-04' WHERE festival_name = 'Janmashtami'     AND festival_date = '2026-08-16';
UPDATE festival_calendar SET festival_date = '2026-09-14' WHERE festival_name = 'Ganesh Chaturthi' AND festival_date = '2026-08-22';
UPDATE festival_calendar SET festival_date = '2026-10-11' WHERE festival_name = 'Navratri'        AND festival_date = '2026-09-28';
UPDATE festival_calendar SET festival_date = '2026-10-20' WHERE festival_name = 'Dussehra'        AND festival_date = '2026-10-07';
UPDATE festival_calendar SET festival_date = '2026-11-08' WHERE festival_name = 'Diwali'          AND festival_date = '2026-10-20';
UPDATE festival_calendar SET festival_date = '2026-11-10' WHERE festival_name = 'Bhai Dooj'       AND festival_date = '2026-10-22';

-- ─── Add missing festivals ────────────────────────────────────────────────────

INSERT IGNORE INTO festival_calendar (id, festival_name, festival_date, greeting_subject, greeting_body, emoji) VALUES
  (UUID(), 'Maha Shivratri',    '2026-02-15', 'Happy Maha Shivratri!',
   'On this sacred night, may Lord Shiva shower you and your family with blessings of health, peace and prosperity. Har Har Mahadev!', '🙏'),

  (UUID(), 'Raksha Bandhan',    '2026-08-26', 'Happy Raksha Bandhan!',
   'On this beautiful occasion that celebrates the bond of love and protection between siblings, wishing you warmth, joy and cherished moments with your loved ones. Happy Raksha Bandhan!', '🪢'),

  (UUID(), 'Chhath Puja',       '2026-11-15', 'Happy Chhath Puja!',
   'On the auspicious occasion of Chhath Puja, may the blessings of Surya Dev bring health, happiness and prosperity to you and your family. Chhath Maiya ki Jai!', '🌅'),

  (UUID(), 'Guru Nanak Jayanti','2026-11-24', 'Happy Guru Nanak Jayanti!',
   'On the auspicious occasion of Guru Nanak Dev Ji''s Prakash Purab, may the teachings of truth, compassion and equality guide us always. Waheguru Ji Ka Khalsa, Waheguru Ji Ki Fateh!', '🙏');

SELECT '1226 applied — festival calendar dates corrected for 2026' AS migration_status;
