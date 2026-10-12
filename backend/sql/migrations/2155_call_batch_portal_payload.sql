-- 2155: the rows of each calling file are kept until the portal accepted them, so an upload that did not reach the portal (sign-in refused,
-- portal unreachable) is retried by the worker instead of waiting for a person. Additive and re-runnable.
CREATE TABLE IF NOT EXISTS qualified_followup_call_payload (
  batch_id     CHAR(36)     NOT NULL PRIMARY KEY,
  rows_json    LONGTEXT     NOT NULL,
  attempts     INT          NOT NULL DEFAULT 0,
  last_message VARCHAR(200) NULL,
  uploaded_at  DATETIME     NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
