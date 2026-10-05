-- 2104: log of branch-HR arrival alerts ("N candidates expected within 30 min"). UNIQUE (drive_id, window_start)
-- makes the 5-minute tick send at most one alert per drive per 30-minute window, even across restarts.
CREATE TABLE IF NOT EXISTS he_hr_alert (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  drive_id      CHAR(36)     NOT NULL,
  window_start  DATETIME     NOT NULL,
  expected      INT          NOT NULL,
  confirmed     INT          NOT NULL,
  live          INT          NOT NULL,
  recipients    INT          NOT NULL DEFAULT 0,
  channels_json JSON         NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_he_hr_alert (drive_id, window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
