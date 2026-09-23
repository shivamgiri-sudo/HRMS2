-- 075_ff_verify_audit.sql
USE mas_hrms;

ALTER TABLE full_final_calculation
  ADD COLUMN verified_by         CHAR(36)     NULL AFTER is_ff_provisional,
  ADD COLUMN verified_by_name    VARCHAR(140) NULL AFTER verified_by,
  ADD COLUMN verified_at         DATETIME     NULL AFTER verified_by_name,
  ADD COLUMN verification_reason VARCHAR(700) NULL AFTER verified_at;
