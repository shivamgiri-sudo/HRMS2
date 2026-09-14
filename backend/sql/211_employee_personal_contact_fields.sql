-- Migration 211: add personal_email and personal_phone to employees
-- These are separate from official_email (company domain) and mobile (primary work number)
-- MySQL 8.0 does not support ADD COLUMN IF NOT EXISTS — run once only

ALTER TABLE employees
  ADD COLUMN personal_email VARCHAR(255) NULL DEFAULT NULL AFTER official_email,
  ADD COLUMN personal_phone VARCHAR(20)  NULL DEFAULT NULL AFTER personal_email;
