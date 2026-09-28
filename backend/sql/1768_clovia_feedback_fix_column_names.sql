-- 1768_clovia_feedback_fix_column_names.sql
--
-- The real "Clvia Feedback.xlsx" export uses space-separated and slash-delimited
-- column names ("Call Date", "Advisor Id", "Phone Number", "C-SAT/D-SAT") rather
-- than the underscore/no-separator variants that were hard-coded when the template
-- was first seeded ("Call_Date", "Advisor_Id", "Phone_Number", "CSAT_DSAT").
-- The mismatch caused the frontend header-validation to find 0 matching columns
-- and stage 0 rows, leaving every CLOVIA_FEEDBACK batch stuck at 'uploaded'.
--
-- This migration corrects upload_template_master to match the actual file.

UPDATE upload_template_master
SET
  required_columns = JSON_ARRAY('Unique', 'Call Date', 'Date'),
  optional_columns = JSON_ARRAY('Advisor Id', 'Phone Number', 'Language', 'Option', 'C-SAT/D-SAT'),
  updated_at = NOW()
WHERE upload_type_code = 'CLOVIA_FEEDBACK';
