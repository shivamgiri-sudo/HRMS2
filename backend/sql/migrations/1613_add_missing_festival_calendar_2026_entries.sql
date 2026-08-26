-- 1613: Add 10 real Indian festivals missing from festival_calendar entirely
--
-- 1072/1226 seeded and later corrected 20 festivals, but never covered these.
-- Found while validating dates against drikpanchang.com and other panchang
-- sources on 2026-08-26 (the same day it surfaced that Onam and Eid-e-Milad
-- BOTH fall on 2026-08-26 — neither existed in this table at all, so the
-- greeting cron said nothing for either on the actual day).
--
-- Onam/Eid-e-Milad were added too late for the 8 AM cron to catch them for
-- 2026 (a one-time miss for this year only); the rest are simply new for
-- future years. Lunar-date entries (Eid-e-Milad, Muharram) will need the
-- same yearly re-verification every other Islamic-calendar row here does.

INSERT IGNORE INTO festival_calendar (id, festival_name, festival_date, greeting_subject, greeting_body, emoji) VALUES
  (UUID(), 'Onam',             '2026-08-26', 'Happy Onam!',
   'On this joyous occasion of Onam, may the spirit of harmony, harvest and togetherness fill your home with prosperity and joy. Wishing you and your family a very Happy Onam!', '🌼'),

  (UUID(), 'Eid-e-Milad',      '2026-08-26', 'Eid-e-Milad Mubarak!',
   'On the occasion of Milad-un-Nabi, we celebrate the message of peace, compassion and brotherhood. Wishing you and your family a blessed and peaceful Eid-e-Milad!', '🌙'),

  (UUID(), 'Makar Sankranti',  '2026-01-14', 'Happy Makar Sankranti!',
   'May this harvest festival bring warmth, prosperity and sweetness into your life, just like til-gud. Wishing you and your family a joyful Makar Sankranti!', '🪁'),

  (UUID(), 'Lohri',            '2026-01-13', 'Happy Lohri!',
   'May the bonfire of Lohri burn away all negativity and bring warmth, happiness and prosperity to you and your family. Happy Lohri!', '🔥'),

  (UUID(), 'Ram Navami',       '2026-03-26', 'Happy Ram Navami!',
   'On the auspicious occasion of Lord Rama''s birth, may his ideals of truth, courage and righteousness guide and inspire you always. Happy Ram Navami!', '🏹'),

  (UUID(), 'Ugadi',            '2026-03-19', 'Happy Ugadi!',
   'May this new year bring fresh beginnings, prosperity and happiness into your life. Wishing you and your family a joyful Ugadi!', '🎉'),

  (UUID(), 'Mahavir Jayanti',  '2026-03-31', 'Happy Mahavir Jayanti!',
   'On the birth anniversary of Lord Mahavir, may his teachings of non-violence, truth and compassion inspire you towards a peaceful life. Happy Mahavir Jayanti!', '🙏'),

  (UUID(), 'Baisakhi',         '2026-04-14', 'Happy Baisakhi!',
   'May this harvest festival bring abundance, joy and prosperity to you and your family. Wishing you a very Happy Baisakhi!', '🌾'),

  (UUID(), 'Buddha Purnima',   '2026-05-01', 'Happy Buddha Purnima!',
   'On this sacred day, may the teachings of Lord Buddha guide you towards peace, compassion and enlightenment. Happy Buddha Purnima!', '☸️'),

  (UUID(), 'Muharram',         '2026-06-26', 'Muharram Observance',
   'On this solemn occasion of Muharram, we reflect on the values of sacrifice, patience and faith. Wishing you strength and peace on this day of remembrance.', '🌙');

SELECT '1613 applied — 10 missing 2026 festivals added' AS migration_status;
