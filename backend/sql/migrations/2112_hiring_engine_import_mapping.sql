-- 2112: remembered column mappings for candidate uploads, keyed by the file's header layout. The first WorkIndia /
-- Naukri / Apna export is confirmed by HR once; every later export with the same headers maps itself.
CREATE TABLE IF NOT EXISTS he_import_mapping (
  signature   CHAR(40)     NOT NULL PRIMARY KEY,
  source      VARCHAR(30)  NOT NULL,
  headers     JSON         NOT NULL,
  mapping     JSON         NOT NULL,
  uses        INT UNSIGNED NOT NULL DEFAULT 0,
  updated_by  CHAR(36)     NULL,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_he_map_source (source, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
