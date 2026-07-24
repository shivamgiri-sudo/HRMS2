-- Migration 411: Add GPS coordinates to branch_master for live location travel-time feature
ALTER TABLE branch_master
  ADD COLUMN latitude  DECIMAL(10, 7) NULL AFTER address,
  ADD COLUMN longitude DECIMAL(10, 7) NULL AFTER latitude;
