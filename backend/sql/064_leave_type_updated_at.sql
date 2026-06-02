-- Add updated_at column to leave_type_master — required by PUT /api/leave/types/:id
ALTER TABLE leave_type_master
  ADD COLUMN IF NOT EXISTS updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP AFTER created_at;
