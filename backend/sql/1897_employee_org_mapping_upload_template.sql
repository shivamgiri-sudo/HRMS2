-- 1897_employee_org_mapping_upload_template.sql
-- The EMPLOYEE_LOB_MAPPING bulk-upload type (seeded by 1853/1854 as employee_code + lob_code)
-- becomes the single "Employee Process / Cost Centre / LOB Mapping" upload: four required
-- columns, employee_code, cost_centre_code, process_code and lob_code. The importer
-- (backend/src/modules/bulk-upload/employee-lob-bulk.service.ts) sets employees.cost_centre_id,
-- process_id and lob_id together and rejects the whole row unless the employee, process, cost
-- centre and LOB each pass their master checks and the process<->LOB pair is mapped.
--
-- Same upload_type_code and import rpc, so role gating, routes and the Hub wiring are
-- unchanged. No batch of this type has ever been created (verified 2026-09-26), so no staged
-- rows are affected. Only this template row's descriptive/column fields are updated.
-- Additive and replay-safe: re-running writes the same values.
-- Rollback: re-run 1854's INSERT values via
--   UPDATE upload_template_master SET upload_type_name = 'Employee LOB Mapping',
--     required_columns = JSON_ARRAY('employee_code','lob_code') WHERE upload_type_code = 'EMPLOYEE_LOB_MAPPING';

UPDATE upload_template_master
   SET upload_type_name = 'Employee Process / Cost Centre / LOB Mapping',
       description = 'Assign each employee a cost centre, process and LOB in one sheet. Each of cost_centre_code, process_code and lob_code accepts the master code (or its exact name when unique). A row is rejected as a whole unless: the employee is active and in your scope; the process is active, in your scope and in the employee''s branch; the cost centre is an open MAS Callnet cost centre in the employee''s branch; and the LOB is mapped to that process in Process LOB Mapping. Blank cells are rejected; this upload does not clear a value.',
       required_columns = JSON_ARRAY('employee_code', 'cost_centre_code', 'process_code', 'lob_code'),
       optional_columns = JSON_ARRAY(),
       sample_row = JSON_OBJECT('employee_code', 'MAS00001', 'cost_centre_code', 'BSS/BO/NOIDA-2/576', 'process_code', 'ONFIDO', 'lob_code', 'POA'),
       updated_at = NOW()
 WHERE upload_type_code = 'EMPLOYEE_LOB_MAPPING';
