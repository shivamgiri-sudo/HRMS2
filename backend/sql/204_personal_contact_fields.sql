-- Migration: Add personal contact fields to employees table
-- Date: 2026-06-17
-- Description: Add personal_email and personal_mobile fields for employees to maintain separate personal contact info

ALTER TABLE employees 
ADD COLUMN IF NOT EXISTS personal_email VARCHAR(255) NULL COMMENT 'Employee personal email address',
ADD COLUMN IF NOT EXISTS personal_mobile VARCHAR(20) NULL COMMENT 'Employee personal mobile number';

-- Add index for personal email for faster lookups
CREATE INDEX IF NOT EXISTS idx_employees_personal_email ON employees(personal_email);
