-- 073_exit_fsm_lwd.sql
USE mas_hrms;

ALTER TABLE exit_request
  ADD COLUMN lwd_override        DATE         NULL AFTER last_working_day_confirmed,
  ADD COLUMN lwd_override_reason VARCHAR(700) NULL AFTER lwd_override,
  ADD COLUMN return_reason       VARCHAR(700) NULL AFTER lwd_override_reason;
