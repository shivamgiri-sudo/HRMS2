-- Agent master changes for Housing Owner and Housing Premium.
--
-- Lives in mas_hrms (the writable PeopleOS database) because the app user cannot ALTER or
-- CREATE in db_masmis. Additive only.
--
-- agent_target_change_log : one row per changed field (name, TL, AM, target, status) with the
--                           old and new value, whether it came from a manual edit or an upload.
-- pre_agent_am            : Housing Premium's AM per employee. db_masmis.pre_agent_details has no
--                           AM column and the app user cannot add one. When an admin adds
--                           pre_agent_details.am, this table can be migrated and dropped.

CREATE TABLE IF NOT EXISTS mas_hrms.agent_target_change_log (
  id           CHAR(36)     NOT NULL,
  process_key  VARCHAR(40)  NOT NULL,
  agent_key    VARCHAR(50)  NOT NULL,
  field_name   VARCHAR(40)  NOT NULL,
  old_value    VARCHAR(200) NULL,
  new_value    VARCHAR(200) NULL,
  source       VARCHAR(20)  NOT NULL,
  batch_id     CHAR(36)     NULL,
  changed_by   VARCHAR(64)  NULL,
  changed_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_agent_change_agent (process_key, agent_key, changed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mas_hrms.pre_agent_am (
  emp_id      VARCHAR(50)  NOT NULL,
  am          VARCHAR(100) NULL,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by  VARCHAR(64)  NULL,
  PRIMARY KEY (emp_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
