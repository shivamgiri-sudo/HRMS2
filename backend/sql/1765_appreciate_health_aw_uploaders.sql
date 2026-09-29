-- No CREATE TABLE here. Registers upload_template_master entries for
-- Appreciate Health's 5 upload types, per explicit user request. All 5
-- target tables (aw_billing, aw_inbound, aw_mandate, aw_new_cdr, aw_out)
-- confirmed ALREADY LIVE on db_masmis via SHOW COLUMNS, already carrying
-- real data (474/107/4/3/34 rows respectively, uploaded_by=7,
-- upload_batch_id populated) -- inserted by the separate My Dashboards
-- tool, confirmed no existing HRMS2 code path wrote to any of them before
-- this migration's matching services (aw-billing-bulk.service.ts etc.).
--
-- No real Excel export has been seen for any of these 5 (unlike GNC's,
-- built from real error messages), so required_columns/optional_columns
-- here are exact DB column names -- safe to do because both this
-- uploader's frontend pre-check (BellavitaMasmisUploader.tsx's
-- getNormalized) and each aw-*-bulk.service.ts backend importer now match
-- headers by normalizing away case/spacing/separators rather than exact
-- string equality, so "Agent ID"/"agent_id"/"AgentID" all resolve to the
-- same column regardless of which literal spelling this catalog uses.
INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'AW_BILLING_MASMIS', 'Appreciate Health — Billing (writes to db_masmis.aw_billing)', 'db_masmis.aw_billing',
   'Appreciate Health''s agent productivity/billing export -- writes into the same live table My Dashboards already uses.',
   JSON_ARRAY('agent_id'),
   JSON_ARRAY('call_date','agent_name','total_calls','connected_calls','not_connected_calls','total_talk_time',
     'total_wrapup_time','total_pause_time','total_idle_time','pickup_time','total_login_time','first_login_time',
     'last_logout_time','customer_disconnect','uuid','emp_id','lob','week','month','bio','bio_break','lunch','tea',
     'tea_break','inbound_aux','meeting_aux','meeting','ticket_work','whatsapp_chat','technical_cc','technical_dialer',
     'email_work','training','sip_disconnected','sip_unregistered','technical_issue_dialer','technical_issue_cc',
     'change_mode','technical_issue_crm','qa_feedback','video_kyc_aux','net_login_hrs','actual_mandays','shift_time',
     'roster_count','shift_start_time','late_login_status','ontime_login_status','late_login_count','ontime_login_count',
     'acht_with_picked_up_time','acht','occupancy_pct','calling_target','break_exceed_count','net_occupancy_pct','lob2',
     'billing_type','actual_versant','billing_in_number'),
   JSON_OBJECT('agent_id', '84104541363', 'agent_name', 'Rahul Kumar', 'call_date', '46269', 'total_calls', '16'),
   1),
  (UUID(), 'AW_INBOUND_MASMIS', 'Appreciate Health — Inbound (writes to db_masmis.aw_inbound)', 'db_masmis.aw_inbound',
   'Appreciate Health''s inbound CDR export -- writes into the same live table My Dashboards already uses.',
   JSON_ARRAY('call_id'),
   JSON_ARRAY('call_type','campaign','location','caller_no','caller_e164','skill','call_date','queue_time',
     'start_time','time_to_answer','end_time','talk_time','hold_time','duration','call_flow','dialed_number','agent',
     'disposition','wrapup_duration','handling_time','status','dial_status','customer_dial_status',
     'agent_dial_status','hangup_by','transfer_details','uui','comments','feedback','customer_ring_time',
     'recording_url','agent_id','ratings','rating_comments','dynamic_did','did','dial_count','dial_did'),
   JSON_OBJECT('call_id', '20812178857899600', 'agent', 'Anshu X', 'disposition', 'Not Connected'),
   1),
  (UUID(), 'AW_MANDATE_MASMIS', 'Appreciate Health — Mandate (writes to db_masmis.aw_mandate)', 'db_masmis.aw_mandate',
   'Appreciate Health''s billing mandate config -- writes into the same live table My Dashboards already uses.',
   JSON_ARRAY('billing_type'),
   JSON_ARRAY('mandate','per_fe_rate','login_hours_per_fte','month'),
   JSON_OBJECT('billing_type', 'New Commercial', 'mandate', '7', 'per_fe_rate', '42000'),
   1),
  (UUID(), 'AW_NEW_CDR_MASMIS', 'Appreciate Health — New CDR (writes to db_masmis.aw_new_cdr)', 'db_masmis.aw_new_cdr',
   'Appreciate Health''s outbound/new CDR export -- writes into the same live table My Dashboards already uses.',
   JSON_ARRAY('call_id'),
   JSON_ARRAY('call_type','campaign','location','caller_no','skill','call_date','start_time','time_to_answer',
     'end_time','talk_time','hold_time','duration','call_flow','dialed_number','agent','disposition',
     'wrapup_duration','handling_time','status','dial_status','customer_dial_status','agent_dial_status',
     'hangup_by','transfer_details','uui','comments','feedback','customer_ring_time','recording_url','agent_id',
     'ratings','rating_comments','dynamic_did','did','sub_lob','partner','slot'),
   JSON_OBJECT('call_id', '35672178861442800', 'agent', 'Sunil Kumar', 'disposition', 'No__Call disconnected'),
   1),
  (UUID(), 'AW_OUT_MASMIS', 'Appreciate Health — Outbound (writes to db_masmis.aw_out)', 'db_masmis.aw_out',
   'Appreciate Health''s outbound agent productivity/conversion export -- writes into the same live table My Dashboards already uses.',
   JSON_ARRAY('agent_id'),
   JSON_ARRAY('call_date','agent_name','total_calls','connected_calls','not_connected_calls','total_talk_time',
     'total_wrapup_time','total_pause_time','total_idle_time','pickup_time','total_login_time','first_login_time',
     'last_logout_time','customer_disconnect','uuid','emp_id','lob','sub_lob','centre_mcn_or_enser','week','month',
     'bio','lunch','tea','meeting_aux','training','sip_disconnected','sip_unregistered','technical_issue_dialer',
     'technical_issue_cc','change_mode','technical_issue_crm','qa_feedback','unused_col','net_login_hrs',
     'actual_mandays','conversion_target','conversion','shift_time','roster_count','shift_start_time',
     'late_login_status','ontime_login_status','late_login_count','ontime_login_count','acht_with_picked_up_time',
     'acht','occupancy_on_calls','calling_target','break_exceed_count','net_occupancy','idle_on_manual',
     'idle_on_blended','agent_disconnect','wrap_exceed_count','lrs_target','lrs_count','lrs_amount','trade_target',
     'trade_count','trade_amount','mf_target','mf_count','mf_amount'),
   JSON_OBJECT('agent_id', '70000138991', 'agent_name', 'Shivam Rawat', 'call_date', '46270'),
   1);
