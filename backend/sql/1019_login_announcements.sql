-- Login page announcements — HR-curated messages shown on the public login screen
-- No PII, no operational data. Admin/HR can post short text + optional emoji.
CREATE TABLE IF NOT EXISTS login_announcement (
  id           CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  message      VARCHAR(280)  NOT NULL,
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  pinned       TINYINT(1)    NOT NULL DEFAULT 0,
  created_by   CHAR(36),
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at   DATETIME
);

-- Seed a welcome message.
--
-- Guarded with NOT EXISTS so re-running this file cannot stack duplicate welcome banners on
-- the login screen. The CREATE above is already idempotent; the seed was not, and every
-- migration here is run by hand (production sets SKIP_MIGRATIONS=true), which makes an
-- accidental second run entirely plausible.
INSERT INTO login_announcement (id, message, active_status, pinned)
SELECT UUID(), '🎉 Welcome to MAS Callnet PeopleOS — your complete workforce hub', 1, 1
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM login_announcement WHERE message LIKE '%Welcome to MAS Callnet PeopleOS%'
);
