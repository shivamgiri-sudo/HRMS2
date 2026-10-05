-- Migration 2101: Hiring Engine capture + analysis layer.
-- he_message_event: every delivery/engagement event per outbound message (WhatsApp sent/delivered/read,
--   email sent/delivered/opened/clicked/bounced/replied) so engagement is analysable per channel.
-- he_call: one row per voice call with the BRD checkpoints (identity, email received, assessment done,
--   slot answers) and the structured outcome.
-- he_signal: typed datapoints extracted from any interaction (reply intent, decline reason, objection,
--   language, preferred shift, sentiment...). Append-only, with source + confidence, so analysis and
--   re-matching can use them and every value stays traceable to the message/call it came from.
-- he_lead_insight: derived, recomputable per-lead rollup (engagement score, best channel/hour,
--   reliability, objections, next best action). CREATE TABLE IF NOT EXISTS only, no FKs.

CREATE TABLE IF NOT EXISTS he_message_event (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  message_id  CHAR(36)     NOT NULL,
  lead_id     CHAR(36)     NULL,
  channel     VARCHAR(20)  NOT NULL,
  event_type  ENUM('queued','sent','delivered','read','opened','clicked','bounced','failed','replied','unsubscribed') NOT NULL,
  detail      VARCHAR(300) NULL,
  occurred_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_he_mevt_msg (message_id, event_type),
  KEY idx_he_mevt_lead (lead_id, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS he_call (
  id                    CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  lead_id               CHAR(36)     NOT NULL,
  match_id              CHAR(36)     NULL,
  provider_call_id      VARCHAR(120) NULL,
  attempt_no            TINYINT UNSIGNED NOT NULL DEFAULT 1,
  started_at            DATETIME     NULL,
  ended_at              DATETIME     NULL,
  duration_s            INT          NULL,
  identity_confirmed    ENUM('yes','no','unclear') NULL,
  language_used         VARCHAR(10)  NULL,
  email_received        ENUM('yes','no','resent','unknown') NULL,
  assessment_done       ENUM('yes','no','reminded','unknown') NULL,
  original_slot_answer  ENUM('yes','no') NULL,
  offered_slot_at       DATETIME     NULL,
  offered_slot_answer   ENUM('yes','no') NULL,
  outcome               VARCHAR(60)  NULL,
  decline_reason        VARCHAR(30)  NULL,
  sentiment             ENUM('positive','neutral','negative') NULL,
  handoff_reason        VARCHAR(200) NULL,
  transcript            MEDIUMTEXT   NULL,
  summary               VARCHAR(1000) NULL,
  recording_url         VARCHAR(500) NULL,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_he_call_lead (lead_id, created_at),
  KEY idx_he_call_provider (provider_call_id),
  KEY idx_he_call_outcome (outcome, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS he_signal (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  lead_id      CHAR(36)     NOT NULL,
  signal_key   VARCHAR(40)  NOT NULL,
  signal_value VARCHAR(200) NOT NULL,
  confidence   TINYINT UNSIGNED NOT NULL DEFAULT 100,
  source       ENUM('whatsapp','email','voice','location','branch','import','system') NOT NULL,
  source_ref   VARCHAR(60)  NULL,
  observed_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_he_signal_lead (lead_id, signal_key, observed_at),
  KEY idx_he_signal_key (signal_key, signal_value)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS he_lead_insight (
  lead_id            CHAR(36)     NOT NULL PRIMARY KEY,
  engagement_score   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  reliability_score  TINYINT UNSIGNED NULL,
  best_channel       VARCHAR(20)  NULL,
  best_hour_ist      TINYINT UNSIGNED NULL,
  language_pref      VARCHAR(10)  NULL,
  email_valid        TINYINT(1)   NULL,
  wa_reachable       TINYINT(1)   NULL,
  touches_total      INT          NOT NULL DEFAULT 0,
  replies_total      INT          NOT NULL DEFAULT 0,
  no_show_count      INT          NOT NULL DEFAULT 0,
  objections_json    JSON         NULL,
  next_action        VARCHAR(40)  NULL,
  next_action_reason VARCHAR(300) NULL,
  computed_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_he_insight_action (next_action, engagement_score)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
