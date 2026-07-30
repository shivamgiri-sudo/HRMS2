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

-- Seed a welcome message
INSERT INTO login_announcement (id, message, active_status, pinned)
VALUES (UUID(), '🎉 Welcome to MAS Callnet PeopleOS — your complete workforce hub', 1, 1);
