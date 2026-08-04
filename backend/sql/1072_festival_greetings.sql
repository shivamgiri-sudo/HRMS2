-- 1072: Festival greetings config table
-- Stores fixed-date and configurable-date festivals so the cron can greet
-- employees on Diwali, Holi, Eid, Independence Day, Christmas, etc.
-- Lunar-date festivals are seeded with placeholder dates that HR updates each year.

CREATE TABLE IF NOT EXISTS festival_calendar (
  id            VARCHAR(36)   NOT NULL,
  festival_name VARCHAR(120)  NOT NULL,
  festival_date DATE          NOT NULL,          -- YYYY-MM-DD for the current/next occurrence
  greeting_subject VARCHAR(255) NOT NULL,
  greeting_body TEXT NOT NULL,                   -- plain-text body shown in feed post
  emoji         VARCHAR(20)   NOT NULL DEFAULT '🎉',
  is_active     TINYINT(1)    NOT NULL DEFAULT 1,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_festival_date (festival_name, festival_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed: 2026 calendar (fixed-date + best-estimate lunar dates for 2026)
-- HR should update the lunar dates each year via the HRMS admin panel or directly.
INSERT IGNORE INTO festival_calendar (id, festival_name, festival_date, greeting_subject, greeting_body, emoji) VALUES
  (UUID(), 'New Year',           '2026-01-01', 'Happy New Year 2026!',              'Wishing you and your family a wonderful New Year filled with success, health and happiness. Here''s to new beginnings and a remarkable 2026!', '🎆'),
  (UUID(), 'Republic Day',       '2026-01-26', 'Happy Republic Day!',               'On this proud day, we celebrate the spirit of our Constitution and the unity of our nation. Jai Hind! 🇮🇳 Thank you for being the backbone of MAS Callnet.', '🇮🇳'),
  (UUID(), 'Holi',               '2026-03-21', 'Happy Holi — Festival of Colours!', 'May the colours of Holi fill your life with joy, laughter and vibrant energy. Wishing you and your loved ones a colourful and cheerful celebration!', '🎨'),
  (UUID(), 'Eid-ul-Fitr',        '2026-03-30', 'Eid Mubarak!',                      'Eid Mubarak! May this blessed occasion bring peace, happiness and prosperity to you and your family. Wishing you a joyous celebration!', '🌙'),
  (UUID(), 'Good Friday',        '2026-04-03', 'Good Friday Greetings',             'On this solemn and reflective day, we pause to acknowledge the values of compassion, sacrifice and love. Wishing you peace and reflection today.', '✝️'),
  (UUID(), 'Easter',             '2026-04-05', 'Happy Easter!',                     'May the joy of Easter fill your heart with hope, renewal and warmth. Wishing you and your family a blessed and happy Easter!', '🐣'),
  (UUID(), 'Eid-ul-Adha',        '2026-06-06', 'Eid-ul-Adha Mubarak!',             'On the occasion of Eid-ul-Adha, we celebrate the values of sacrifice, gratitude and togetherness. Eid Mubarak to you and your loved ones!', '🌙'),
  (UUID(), 'Independence Day',   '2026-08-15', 'Happy Independence Day!',           'On the 80th Independence Day of India, we salute the spirit of freedom and unity. Your hard work and dedication represent the true spirit of a rising India. Jai Hind! 🇮🇳', '🇮🇳'),
  (UUID(), 'Janmashtami',        '2026-08-16', 'Happy Janmashtami!',                'May the divine blessings of Lord Krishna guide you towards joy, wisdom and prosperity. Wishing you and your family a joyful Janmashtami!', '🦚'),
  (UUID(), 'Ganesh Chaturthi',   '2026-08-22', 'Happy Ganesh Chaturthi!',           'May Lord Ganesha remove every obstacle from your path and bless you with wisdom, success and happiness. Ganpati Bappa Morya!', '🐘'),
  (UUID(), 'Navratri',           '2026-09-28', 'Happy Navratri!',                   'May the nine days of Navratri fill your life with divine energy, positivity and the blessings of Goddess Durga. Wishing you a joyful and prosperous celebration!', '🕯️'),
  (UUID(), 'Dussehra',           '2026-10-07', 'Happy Dussehra!',                   'May the victory of good over evil inspire you to overcome every challenge with courage and positivity. Wishing you and your family a happy Dussehra!', '🏹'),
  (UUID(), 'Diwali',             '2026-10-20', 'Happy Diwali — Festival of Lights!','May the glittering lights of Diwali illuminate every corner of your life with happiness, prosperity and good health. Wishing you and your family a sparkling Diwali! 🪔', '🪔'),
  (UUID(), 'Bhai Dooj',          '2026-10-22', 'Happy Bhai Dooj!',                  'On this special day that celebrates the bond between siblings, wishing everyone warmth, love and togetherness. Happy Bhai Dooj!', '🤝'),
  (UUID(), 'Christmas',          '2026-12-25', 'Merry Christmas!',                  'May the magic of Christmas fill your home with warmth, joy and the spirit of giving. Wishing you and your loved ones a very Merry Christmas and a Happy New Year!', '🎄'),
  (UUID(), 'New Year (2027)',     '2027-01-01', 'Happy New Year 2027!',              'Wishing you and your family a wonderful New Year filled with success, health and happiness. Here''s to new beginnings and a remarkable 2027!', '🎆');

INSERT IGNORE INTO worker_config (worker_name, enabled, description)
VALUES ('festival-greetings', 1, 'Daily check for festivals; sends email and creates company feed post');

SELECT '1072 applied' AS migration_status;
