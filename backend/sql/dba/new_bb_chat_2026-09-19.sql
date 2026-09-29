-- ============================================================================
-- db_masmis.new_bb_chat  --  Bellavita Chat, exactly the columns of the sheet
--
-- Run by someone with CREATE on db_masmis: the application user (shivam_user)
-- has only SELECT/INSERT/UPDATE/DELETE there (confirmed live 2026-09-19), same
-- as the other new-table uploaders (gnc_chat, neemans_chat). Deliberately NOT
-- registered in runPendingMigrations.ts, so it cannot run (and fail) by itself.
--
-- db_masmis.bb_chat is left completely untouched -- the Bellavita Chat
-- dashboard, the older Sales Upload module and the separate "My Dashboards"
-- tool keep working against it.
--
-- The 24 data columns follow the sheet left to right (the sheet has two "FRT"
-- columns: the first is `frt`, the second is `frt_2`). Numeric columns are
-- real DECIMAL/INT, the date is a real DATE, everything else is text as
-- uploaded.
-- ============================================================================

CREATE TABLE IF NOT EXISTS db_masmis.new_bb_chat (
  id                        INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,

  repeat_status             VARCHAR(50)   NULL,   -- Repeat Status
  repeat_status_on_assign_time VARCHAR(50) NULL,  -- Repeat Status on Assign Time
  frt                       DECIMAL(12,2) NULL,   -- FRT (first)
  resolution_time_in_min    DECIMAL(12,2) NULL,   -- Resolution Time (In Min)
  frt_tat                   VARCHAR(20)   NULL,   -- FRT TAT
  resolution_tat            VARCHAR(20)   NULL,   -- Resolution TAT
  phone_number1             VARCHAR(50)   NULL,   -- Phone Number1
  current_agent             VARCHAR(255)  NULL,   -- Current Agent
  email                     VARCHAR(255)  NULL,   -- Email
  chat_date                 DATE          NULL,   -- Date
  emp_id                    VARCHAR(50)   NULL,   -- ID
  lob                       VARCHAR(100)  NULL,   -- LOB
  week                      VARCHAR(20)   NULL,   -- Week
  count_1                   DECIMAL(10,2) NULL,   -- Count 1
  time_slot                 VARCHAR(20)   NULL,   -- Time Slot
  hour                      INT           NULL,   -- Hour
  tl_name                   VARCHAR(255)  NULL,   -- TL Name
  disposition               VARCHAR(255)  NULL,   -- Disposition
  day_shift_night_shift     VARCHAR(50)   NULL,   -- Day Shift/Night Shift
  unique_id                 VARCHAR(200)  NULL,   -- Unique ID
  fraud                     VARCHAR(50)   NULL,   -- Fraud
  frt_2                     VARCHAR(50)   NULL,   -- FRT (second, h:mm:ss)
  user_type                 VARCHAR(255)  NULL,   -- User Type
  repeat_chat               VARCHAR(100)  NULL,   -- Repeat/Chat

  uploaded_by               INT           NULL,
  upload_batch_id           VARCHAR(36)   NULL,
  inserted_at               DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY idx_new_bb_chat_batch     (upload_batch_id),
  KEY idx_new_bb_chat_date      (chat_date),
  KEY idx_new_bb_chat_emp       (emp_id),
  KEY idx_new_bb_chat_unique_id (unique_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
