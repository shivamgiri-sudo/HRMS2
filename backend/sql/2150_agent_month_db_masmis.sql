-- Agent details by month, all in db_masmis. Run by a database admin (the app user has no
-- ALTER or CREATE on db_masmis). Additive except the unique key, which is created only after
-- the existing rows have a month set.
--
-- Each agent gets one row per month. The uploaded file's "Month" column (for example Oct'26)
-- goes into `month` as 'YYYY-MM'. The Process Details page and the dashboards read the rows for
-- the selected month.

-- 1. Month column on both agent tables.
ALTER TABLE db_masmis.owner_agent_details ADD COLUMN month CHAR(7) NULL AFTER mas_id;
ALTER TABLE db_masmis.pre_agent_details   ADD COLUMN month CHAR(7) NULL AFTER emp_id;

-- 2. Premium's AM column (currently kept in mas_hrms.pre_agent_am).
ALTER TABLE db_masmis.pre_agent_details   ADD COLUMN am VARCHAR(100) NULL AFTER tl_name;

-- 3. Existing rows: they were uploaded as the current roster, so set them to the current month.
--    Check the value before running: it must be the month the roster was for.
UPDATE db_masmis.owner_agent_details SET month = DATE_FORMAT(CURDATE(), '%Y-%m') WHERE month IS NULL;
UPDATE db_masmis.pre_agent_details   SET month = DATE_FORMAT(CURDATE(), '%Y-%m') WHERE month IS NULL;

-- 4. One row per agent per month. Replaces the single-row-per-agent key from the earlier change.
ALTER TABLE db_masmis.owner_agent_details ADD UNIQUE KEY uk_owner_agent_month (mas_id, month);
ALTER TABLE db_masmis.pre_agent_details   ADD UNIQUE KEY uk_pre_agent_month (emp_id, month);

-- 5. After step 2 is confirmed, the AM side table in mas_hrms is no longer needed. Its rows can
--    be copied into pre_agent_details.am by the app, then the table dropped by the admin.
