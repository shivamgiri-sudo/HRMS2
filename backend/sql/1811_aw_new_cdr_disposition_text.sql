-- Appreciate Wealth "New CDR" import: the disposition field from the Ozontel export can be longer
-- than the 100 characters the column allows (e.g. "Yes__Callback__Customer disconnected the call__
-- Not Applicable__SIP amount deducted but units not allotted", 105 chars). Those rows fail with
-- "Data too long for column 'disposition'". Widening to TEXT keeps the full value and is additive:
-- no data is changed, and existing rows keep their values.
--
-- Run by a database admin: the application user has no ALTER on db_masmis. Not executed by HRMS2.

-- The same column on aw_inbound is varchar(100) too, so the same failure would hit that upload.
ALTER TABLE db_masmis.aw_new_cdr MODIFY COLUMN disposition TEXT NULL;
ALTER TABLE db_masmis.aw_inbound MODIFY COLUMN disposition TEXT NULL;
