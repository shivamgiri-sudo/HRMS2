-- One-click approve/decline links in approval emails. One row per (approver, request): the raw token is
-- only ever in the email; we keep its SHA-256. A link opens a confirm page (GET never changes anything)
-- and the decision is a POST. Single use, expiring.
CREATE TABLE IF NOT EXISTS approval_email_action (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  token_hash    CHAR(64)     NOT NULL,
  user_id       VARCHAR(64)  NOT NULL,
  approval_uid  VARCHAR(255) NOT NULL,
  kind          VARCHAR(64)  NOT NULL,
  expires_at    DATETIME     NOT NULL,
  used_at       DATETIME     NULL,
  used_action   VARCHAR(16)  NULL,
  used_ip       VARCHAR(64)  NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_approval_email_token (token_hash),
  KEY idx_approval_email_user (user_id, approval_uid),
  KEY idx_approval_email_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
