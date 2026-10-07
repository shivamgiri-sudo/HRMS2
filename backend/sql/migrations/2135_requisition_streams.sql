-- 2135: Requisition source streams. A stream opens one source (live Meta campaign, old-data re-run, Hiring Engine pool) for a requisition
-- for N working days; exception days, an event log, planned days and first-touch match credits hang off it. Adds qualified_followup.owner
-- (pipeline | engine). No foreign keys. Additive and re-runnable (CREATE TABLE IF NOT EXISTS; the ALTERs are guarded through information_schema + PREPARE).
-- requisition_stream.version is the optimistic-lock counter bumped by every stream change (also added by ALTER for a table created before it existed).
-- requisition_stream.created_at is DATETIME(6): streams line up in creation order (ORDER BY created_at, id), so two streams created in the same
-- second must not fall back to the random id (also MODIFYed for a table created with second precision).
CREATE TABLE IF NOT EXISTS requisition_stream (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  requisition_id CHAR(36) NOT NULL,
  branch_name VARCHAR(150) NOT NULL,
  source_type ENUM('meta_live','meta_old','he') NOT NULL,
  origin_id VARCHAR(64) NOT NULL,
  origin_label VARCHAR(200) NOT NULL,
  open_from DATE NOT NULL,
  open_days SMALLINT UNSIGNED NOT NULL,
  daily_invites SMALLINT UNSIGNED NULL,
  status ENUM('draft','open','paused','closed') NOT NULL DEFAULT 'draft',
  closed_reason VARCHAR(40) NULL,
  version INT NOT NULL DEFAULT 0,
  created_by CHAR(36) NULL,
  created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_rs_origin (requisition_id, source_type, origin_id),
  KEY idx_rs_status (status, open_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS requisition_stream_day (
  stream_id CHAR(36) NOT NULL,
  day DATE NOT NULL,
  kind ENUM('add','skip') NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (stream_id, day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS requisition_stream_event (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  stream_id CHAR(36) NOT NULL,
  changed_by CHAR(36) NULL,
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  action VARCHAR(20) NOT NULL,
  old_open_from DATE NULL,
  old_open_days SMALLINT UNSIGNED NULL,
  new_open_days SMALLINT UNSIGNED NULL,
  old_status VARCHAR(10) NULL,
  new_status VARCHAR(10) NULL,
  day DATE NULL,
  reason VARCHAR(255) NULL,
  KEY idx_rse_stream (stream_id, changed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS requisition_stream_plan (
  stream_id CHAR(36) NOT NULL,
  drive_date DATE NOT NULL,
  drive_id CHAR(36) NOT NULL,
  lined INT NOT NULL DEFAULT 0,
  planned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (stream_id, drive_date),
  KEY idx_rsp_drive (drive_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS requisition_stream_match (
  match_id CHAR(36) NOT NULL PRIMARY KEY,
  stream_id CHAR(36) NOT NULL,
  drive_id CHAR(36) NULL,
  credited_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_rsm_stream (stream_id, drive_id),
  KEY idx_rsm_drive (drive_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'qualified_followup' AND COLUMN_NAME = 'owner') = 0, "ALTER TABLE qualified_followup ADD COLUMN owner ENUM('pipeline','engine') NOT NULL DEFAULT 'pipeline'", 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requisition_stream' AND COLUMN_NAME = 'version') = 0, "ALTER TABLE requisition_stream ADD COLUMN version INT NOT NULL DEFAULT 0 AFTER closed_reason", 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = IF((SELECT DATETIME_PRECISION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requisition_stream' AND COLUMN_NAME = 'created_at') = 0, "ALTER TABLE requisition_stream MODIFY COLUMN created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6), MODIFY COLUMN updated_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)", 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
