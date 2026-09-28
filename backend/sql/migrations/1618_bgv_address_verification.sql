-- Migration 1618: BGV Address Verification via geo-tagged selfie
-- Allows HR to send a one-time link to a candidate. The candidate opens the
-- link on their phone, takes a selfie, and the browser submits the photo
-- plus GPS coordinates. The system computes the Haversine distance to the
-- geocoded declared address and auto-passes if within 10 m; otherwise HR
-- decides. Max 3 attempts per candidate — after 3 failures the address BGV
-- check is auto-failed. HR can unblock with an audit note.

CREATE TABLE IF NOT EXISTS candidate_bgv_address_verification (
  id              CHAR(36)      NOT NULL DEFAULT (UUID()),
  candidate_id    CHAR(36)      NOT NULL,
  token           CHAR(36)      NOT NULL,
  declared_address TEXT         NOT NULL,
  ref_latitude    DECIMAL(10,7) NULL,    -- geocoded from declared address (Nominatim)
  ref_longitude   DECIMAL(10,7) NULL,
  attempt_number  TINYINT       NOT NULL DEFAULT 1,
  sent_via        VARCHAR(20)   NOT NULL DEFAULT 'link',
  sent_at         DATETIME      NOT NULL DEFAULT NOW(),
  expires_at      DATETIME      NOT NULL,
  unblocked_by    CHAR(36)      NULL,   -- employee_id of HR who unblocked
  unblock_note    TEXT          NULL,

  -- Submission fields (NULL until candidate submits)
  submitted_at    DATETIME      NULL,
  selfie_path     VARCHAR(500)  NULL,
  gps_latitude    DECIMAL(10,7) NULL,
  gps_longitude   DECIMAL(10,7) NULL,
  gps_accuracy_m  DECIMAL(8,2)  NULL,
  gps_distance_m  DECIMAL(8,2)  NULL,   -- Haversine distance from ref coords
  ip_address      VARCHAR(64)   NULL,
  device_info     VARCHAR(500)  NULL,

  -- Decision
  status          ENUM('pending','submitted','verified','failed','expired')
                    NOT NULL DEFAULT 'pending',
  auto_verified   TINYINT(1)    NOT NULL DEFAULT 0,
  hr_decision     ENUM('pass','fail','review') NULL,
  hr_notes        TEXT          NULL,
  hr_decided_by   CHAR(36)      NULL,
  hr_decided_at   DATETIME      NULL,

  created_at      DATETIME      NOT NULL DEFAULT NOW(),
  updated_at      DATETIME      NOT NULL DEFAULT NOW() ON UPDATE NOW(),

  PRIMARY KEY (id),
  UNIQUE  KEY uq_addr_verif_token    (token),
  INDEX         idx_addr_verif_cand  (candidate_id),
  INDEX         idx_addr_verif_status(status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
