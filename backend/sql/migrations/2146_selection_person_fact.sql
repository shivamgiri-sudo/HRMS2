-- 2146: Selection criteria (plan 2026-10-09, S9). selection_person_fact: the per-person facts cache the criteria preview reads
-- (one row per person and source kind: Live Meta, Old Meta, Hiring Engine pool). Facts are rebuilt by refreshFactCache in chunks;
-- facts_hash changes only when the facts do. Holds facts only, never criteria. Re-runnable (CREATE TABLE IF NOT EXISTS), no foreign keys.
CREATE TABLE IF NOT EXISTS selection_person_fact (
  mobile10 CHAR(10) NOT NULL,
  source_kind VARCHAR(12) NOT NULL COMMENT 'meta_live | meta_old | he',
  sub_source VARCHAR(24) NOT NULL,
  source_ref VARCHAR(64) NULL COMMENT 'he_lead.id or meta_lead_raw.id the facts were read from',
  facts_json JSON NOT NULL,
  facts_hash CHAR(64) NOT NULL,
  refreshed_at DATETIME NOT NULL,
  PRIMARY KEY (mobile10, source_kind),
  KEY idx_spf_source (source_kind, mobile10, sub_source),
  KEY idx_spf_refreshed (source_kind, refreshed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
