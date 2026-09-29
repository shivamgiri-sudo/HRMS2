-- Registers upload_template_master entries for LP Feedback (APR, CDR)
-- and LP Onboarding (APR, CDR) -- the 4 new upload types sql/1772's
-- tables serve. Required/optional columns are the real headers confirmed
-- directly against the files the user supplied. Applied ahead of the
-- tables existing (same pattern as sql/1767/1769/1771) -- harmless;
-- uploads will fail with a table-not-found error until sql/1772 is run.
INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'LP_FEEDBACK_APR_MASMIS', 'LP Feedback — lp_feedback_apr (writes to db_masmis.lp_feedback_apr)', 'db_masmis.lp_feedback_apr',
   'lp_feedback_apr export -- writes into a new table.',
   JSON_ARRAY('LoginId'),
   JSON_ARRAY('CalLDate','Interval','Agent','Total_Calls','Dialer_Calls','Outbound_Calls','Manual_Calls','Transfered_Calls','Login_Time','Net_LoginTime','Break_Count','Tea','Lunch','Meeting','BIO_Break','Unsolicted','Total_Break_Duration','Handle_Duration','Average_Handle_Duration','Idle_Duration','Average_Idle_Duration','Idle_Block_Duration','Ring_Duration','Average_Ring_Duration','Talk_Duration','Average_Talk_Duration','Hold_Duration','Average_Hold_Duration','Wrapup_Duration','Average_Wrapup_Duration'),
   JSON_OBJECT('LoginId', 'SAMPLE'),
   1),
  (UUID(), 'LP_FEEDBACK_CDR_MASMIS', 'LP Feedback — lp_feedback_cdr (writes to db_masmis.lp_feedback_cdr)', 'db_masmis.lp_feedback_cdr',
   'lp_feedback_cdr export -- writes into a new table.',
   JSON_ARRAY('Call_Number'),
   JSON_ARRAY('S_No','Date','Interval','Service','Agent','Login_Id','Start_Time','End_Time','Extension','Remarks','Dni','Cli','Desposition','Lead_Id','Batch','Dialer_Type','Duration','Ivr_Duration','Ring_Duration','Talk_Duration','Wrapup_Duration','Hold_Duration','Call_Status','Hangup_By','Child_CallNumbr','Ivr_Terminal','Unque','Disposition Status','Attempt','Service_1'),
   JSON_OBJECT('Call_Number', 'SAMPLE'),
   1),
  (UUID(), 'LP_ONBOARDING_APR_MASMIS', 'LP Onboarding — lp_onboarding_apr (writes to db_masmis.lp_onboarding_apr)', 'db_masmis.lp_onboarding_apr',
   'lp_onboarding_apr export -- writes into a new table.',
   JSON_ARRAY('LoginId'),
   JSON_ARRAY('CalLDate','Interval','Agent','Total_Calls','Dialer_Calls','Outbound_Calls','Manual_Calls','Transfered_Calls','Login_Time','Net_LoginTime','Break_Count','Tea','Lunch','Meeting','BIO_Break','Unsolicted','Total_Break_Duration','Handle_Duration','Average_Handle_Duration','Idle_Duration','Average_Idle_Duration','Idle_Block_Duration','Ring_Duration','Average_Ring_Duration','Talk_Duration','Average_Talk_Duration','Hold_Duration','Average_Hold_Duration','Wrapup_Duration','Average_Wrapup_Duration'),
   JSON_OBJECT('LoginId', 'SAMPLE'),
   1),
  (UUID(), 'LP_ONBOARDING_CDR_MASMIS', 'LP Onboarding — lp_onboarding_cdr (writes to db_masmis.lp_onboarding_cdr)', 'db_masmis.lp_onboarding_cdr',
   'lp_onboarding_cdr export -- writes into a new table.',
   JSON_ARRAY('Call_Number'),
   JSON_ARRAY('S_No','Date','Interval','Service','Agent','Login_Id','Start_Time','End_Time','Extension','Remarks','Dni','Cli','Desposition','Lead_Id','Batch','Dialer_Type','Duration','Ivr_Duration','Ring_Duration','Talk_Duration','Wrapup_Duration','Hold_Duration','Call_Status','Hangup_By','Child_CallNumbr','Ivr_Terminal','Unque','Disposition Status','Attempt','Service_1'),
   JSON_OBJECT('Call_Number', 'SAMPLE'),
   1);
