-- Migration 1831: Interview slot columns on meta_lead_raw
-- Stores the auto-assigned interview date/time when a qualified lead is notified.
-- Slot is assigned per-branch, 10:00–18:00, 30-min intervals, Mon–Sat.

ALTER TABLE meta_lead_raw
  ADD COLUMN interview_date DATE NULL AFTER walkin_reply_at,
  ADD COLUMN interview_time TIME NULL AFTER interview_date,
  ADD COLUMN interview_slot_assigned_at DATETIME NULL AFTER interview_time;
