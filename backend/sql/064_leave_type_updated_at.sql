-- Add updated_at column to leave_type_master — required by PUT /api/leave/types/:id
-- NOTE: Migration runner handles "Duplicate column" errors as idempotent
ALTER TABLE leave_type_master ADD COLUMN updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP AFTER created_at;
