-- Migration 1510: Add legacy parity fields to cost_centre_master
-- These fields exist in db_bill.cost_master but were missing from HRMS2.

-- Additional address lines (legacy has 5 lines, HRMS2 had 3)
ALTER TABLE cost_centre_master
  ADD COLUMN bill_to_address4 VARCHAR(255) NULL AFTER bill_to_address3,
  ADD COLUMN bill_to_address5 VARCHAR(255) NULL AFTER bill_to_address4,
  ADD COLUMN ship_to_address4 VARCHAR(255) NULL AFTER ship_to_address3,
  ADD COLUMN ship_to_address5 VARCHAR(255) NULL AFTER ship_to_address4;

-- Grouping / categorization fields
ALTER TABLE cost_centre_master
  ADD COLUMN group_cost_center VARCHAR(500) NULL COMMENT 'Groups multiple cost centres under one billing umbrella',
  ADD COLUMN cost_center_type  VARCHAR(100) NULL COMMENT 'e.g. Voice, Non-Voice, BackOffice',
  ADD COLUMN dialdee_type      VARCHAR(100) NULL DEFAULT 'shared' COMMENT 'shared or dedicated';

-- Procurement fields tied to billing
ALTER TABLE cost_centre_master
  ADD COLUMN jcc_no      VARCHAR(200)  NULL COMMENT 'JCC number for procurement',
  ADD COLUMN grn         VARCHAR(200)  NULL COMMENT 'GRN reference',
  ADD COLUMN po_required TINYINT(1)    NULL DEFAULT 0 COMMENT 'Whether PO is required for billing';