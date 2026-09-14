-- Fixes real Bellavita raw-file uploads being rejected outright by the
-- Bulk Upload Hub's client-side validator (validateRows() in
-- BulkUploadHub.tsx), which flags any column NOT listed in a template's
-- optional_columns as "Unknown column: X" and marks the whole row invalid.
--
-- Migration 1746 registered these 4 templates with only a small SAMPLE of
-- each real file's columns (9-11 out of the real 22-44), taken from the
-- description/sample_row rather than each *-masmis-bulk.service.ts file's
-- own full header list (BB_SALE_HEADERS / BB_APR_HEADERS / BB_CART_HEADERS,
-- and bb-chat's own get()/insert column list) -- which is what the importer
-- itself actually reads and already fully supports. A real Bellavita raw
-- export therefore had every row rejected before it ever reached the
-- importer, for columns the backend was already prepared to accept.
--
-- required_columns are left untouched -- they already match what each
-- importer enforces as mandatory (see the `if (!x) { ... required ...}`
-- guard at the top of each importer). Only optional_columns is widened to
-- each service's full real column set, so genuine file columns stop being
-- flagged as unknown.
UPDATE upload_template_master
   SET optional_columns = JSON_ARRAY(
     'Week', 'EMP ID', 'Emp_Name', 'TL', 'T1', 'T2', 'FHD', 'Days',
     'Phone Number', 'E-mail ID', 'Payment Status', 'Amount', 'Campaign',
     'Calling Status', 'Discount Code', 'Count', 'Current Status',
     'Final Status', 'Order Date&Time', 'State', 'Line Item Name', 'Pincode',
     'Order Date', '24Hrs&48hrs', 'Crazy Deal', 'Perfume', 'Size',
     'Order Pickup Date', 'RTO Initiated Date', 'Diff Hour', 'LOB',
     'Pincode Relevent', 'RTO Status', 'Draft Order', 'Sale Source Name', 'Shift'
   )
 WHERE upload_type_code = 'BB_SALE_MASMIS';

UPDATE upload_template_master
   SET optional_columns = JSON_ARRAY(
     'unique_id', 'week', 'noiid', 'num_calls_chat', 'lob', 'login_time',
     'wait_time', 'talk_time', 'dispo_time', 'pause_time', 'acht', 'lunch',
     'tea', 'tea1', 'washr', 'team_briefing_aux', 'net_pause', 'avg_dispo',
     'total_break', 'actual_login_hrs', 'downtime', 'login_duration',
     'logout_time', 'net_login_hrs', 'utilization', 'attendance_1', 'week_1',
     'mtd', 'team_leader', 'fhd', 'tenure', 'tenurity_week', 'sub_lob',
     'unique_count', 'attendance_2', 'capping', 'attendance_3'
   )
 WHERE upload_type_code = 'BB_APR_MASMIS';

UPDATE upload_template_master
   SET optional_columns = JSON_ARRAY(
     'inbox_id', 'inbox_name', 'ticket_status', 'agent_name', 'email_1',
     'phone_number', 'created_at', 'assigned_at', 'agent_frt_at', 'frt_1',
     'resolution_time_at', 'resolution_time', 'average_wait_time',
     'is_resolved', 'is_outside_working_hrs', 'level1_tags', 'level2_tags',
     'level3_tags', 'system_tags', 'chat_link', 'repeat_status',
     'repeat_status_on_assign', 'time_1406', 'resolution_time_min', 'frt_tat',
     'resolution_tat', 'phone_number1', 'current_agent', 'email_2',
     'chat_date', 'emp_id', 'lob', 'week', 'count_1', 'time_slot', 'hour',
     'tl_name', 'disposition', 'day_shift_night_shift', 'unique_id', 'froud',
     'frt_2', 'user_type'
   )
 WHERE upload_type_code = 'BB_CHAT_MASMIS';

UPDATE upload_template_master
   SET optional_columns = JSON_ARRAY(
     'CC', 'Source', 'SNo', 'Created At', 'Updated At', 'Customer Name',
     'Customer Address', 'Phone Number', 'Email ID', 'Line Items',
     'Variant Title', 'Abandoned Cart Link', 'Amount', 'Phone (10 Digit)',
     'Dates', 'Agent', 'Disposition', 'Sub Disposition', 'Call Date',
     'Same Day Connect', 'Status'
   )
 WHERE upload_type_code = 'BB_CART_MASMIS';
