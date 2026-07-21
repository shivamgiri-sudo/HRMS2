-- ============================================================
-- Migration: 462_company_post_media_file_id_length.sql
-- Purpose  : Expand file_id column to accommodate filename with extension
-- Issue    : Upload returns uuid.ext (~40 chars), but file_id was char(36)
-- ============================================================

ALTER TABLE company_post_media
  MODIFY COLUMN file_id varchar(255) NOT NULL;
