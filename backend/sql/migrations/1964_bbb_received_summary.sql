-- Migration 1964: BBB Received Data read model.
-- The dashboard summed bla_dash_received on every page load. With 126,612 rows (120,577 in one month) that aggregate
-- takes ~80 s on the production database, so the page timed out. These two small tables are what the pages read
-- instead; the application refreshes them when data changes (upload, trash, restore), never at request time.
-- New tables only: instant, no data statements. Existing data is summarised by a background task after startup.

CREATE TABLE IF NOT EXISTS bla_dash_received_daily (
  report_date     DATE         NOT NULL,
  lob             VARCHAR(64)  NOT NULL,
  fresh_base      INT          NOT NULL DEFAULT 0,
  fresh_workable  INT          NOT NULL DEFAULT 0,
  total_workable  INT          NOT NULL DEFAULT 0,
  dnd             INT          NOT NULL DEFAULT 0,
  unique_attempt  INT          NOT NULL DEFAULT 0,
  connected       INT          NOT NULL DEFAULT 0,
  le30            INT          NOT NULL DEFAULT 0,
  lt1m            INT          NOT NULL DEFAULT 0,
  ge1m            INT          NOT NULL DEFAULT 0,
  total_rows      INT          NOT NULL DEFAULT 0,
  nc_rows         INT          NOT NULL DEFAULT 0,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (report_date, lob)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bbb_upload_batch (
  batch_id      CHAR(36)     NOT NULL,
  kind          VARCHAR(16)  NOT NULL DEFAULT 'received',
  uploaded_by   VARCHAR(64)  NULL,
  uploaded_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  live_rows     INT          NOT NULL DEFAULT 0,
  trashed_rows  INT          NOT NULL DEFAULT 0,
  date_from     DATE         NULL,
  date_to       DATE         NULL,
  trashed_at    DATETIME     NULL,
  trashed_by    VARCHAR(64)  NULL,
  -- 'ready' once Fresh/NC and the daily summary reflect this batch; 'updating' while that runs in the background.
  state         VARCHAR(16)  NOT NULL DEFAULT 'ready',
  PRIMARY KEY (batch_id),
  KEY idx_bbb_batch_at (uploaded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
