-- 1825_mcn_content_builder_request.sql
--
-- "MCN Content Builder" — tooling-link worklist for OpenMAIC content authoring.
-- Tracks that a coordinator asked for LMS content to be authored via OpenMAIC,
-- pasted back an informational builder_url/export_reference once built, and
-- eventually linked the real skill_content_mapping row after manually uploading
-- the export into the LMS.
--
-- No write path into mcn_lms. builder_url is never fetched server-side.
-- Same CS-04 boundary as 1822_training_assignment_lms_provisioning.sql.

CREATE TABLE IF NOT EXISTS mcn_content_builder_request (
  id                              VARCHAR(36)  NOT NULL PRIMARY KEY,
  skill_category_id               VARCHAR(36)  NOT NULL,
  requested_by                    VARCHAR(36)  NOT NULL,
  status                          ENUM('requested','in_progress','built','mapped','cancelled')
                                               NOT NULL DEFAULT 'requested',
  brief                           TEXT         NULL,
  builder_url                     TEXT         NULL,
  export_reference                TEXT         NULL,
  resulting_content_mapping_id    VARCHAR(36)  NULL,
  cancelled_reason                TEXT         NULL,
  created_at                      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                               ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mcb_skill_category (skill_category_id),
  INDEX idx_mcb_requested_by   (requested_by),
  INDEX idx_mcb_status         (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
