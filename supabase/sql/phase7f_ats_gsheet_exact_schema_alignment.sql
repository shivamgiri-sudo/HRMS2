-- =============================================================
-- Phase 7F: ATS GSheet Exact Schema Alignment
-- Source workbook: ATS_GSheet_Template_v5(2).xlsx
-- Purpose: preserve exact GSheet sheet/header contract for native ATS.
-- =============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.ats_gsheet_schema_column_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_name text NOT NULL,
  column_index integer NOT NULL,
  column_letter text NOT NULL,
  column_header text NOT NULL,
  active_status boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(sheet_name, column_index)
);

CREATE TABLE IF NOT EXISTS public.ats_gsheet_row_mirror (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_name text NOT NULL,
  source_row_no integer,
  business_key text,
  row_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_system text NOT NULL DEFAULT 'NATIVE_ATS',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ats_gsheet_row_mirror_sheet_key
ON public.ats_gsheet_row_mirror(sheet_name, business_key);

INSERT INTO public.ats_gsheet_schema_column_map (sheet_name, column_index, column_letter, column_header)
VALUES
('Candidate Intake',1,'A','Timestamp'),('Candidate Intake',2,'B','Name'),('Candidate Intake',3,'C','Mobile Number'),('Candidate Intake',4,'D','Email ID'),('Candidate Intake',5,'E','Address'),('Candidate Intake',6,'F','Education'),('Candidate Intake',7,'G','Experience'),('Candidate Intake',8,'H','Gender'),('Candidate Intake',9,'I','Role Applied'),('Candidate Intake',10,'J','Recruiter Name'),('Candidate Intake',11,'K','Branch'),('Candidate Intake',12,'L','Comfortable with Rotational Shift'),('Candidate Intake',13,'M','Leaves required in coming 3 months'),('Candidate Intake',14,'N','Preferred Shift Timing'),('Candidate Intake',15,'O','Comfortable with night shifts'),('Candidate Intake',16,'P','Own 2 wheeler'),('Candidate Intake',17,'Q','ID Proof availability'),('Candidate Intake',18,'R','Education proof availability'),('Candidate Intake',19,'S','Resume upload / Resume image (Optional)'),('Candidate Intake',20,'T','CandidateID'),('Candidate Intake',21,'U','Selfie Link'),
('Candidates',1,'A','CreatedDate'),('Candidates',2,'B','CreatedTime'),('Candidates',3,'C','CandidateID'),('Candidates',4,'D','QToken'),('Candidates',5,'E','FullName'),('Candidates',6,'F','Mobile'),('Candidates',7,'G','Email'),('Candidates',8,'H','Address'),('Candidates',9,'I','Education'),('Candidates',10,'J','Experience'),('Candidates',11,'K','Gender'),('Candidates',12,'L','RoleApplied'),('Candidates',13,'M','RecruiterSelected'),('Candidates',14,'N','Branch'),('Candidates',15,'O','LeavesNext3Months'),('Candidates',16,'P','PreferredShiftTiming'),('Candidates',17,'Q','NightShiftComfortable'),('Candidates',18,'R','RotationalShiftComfort'),('Candidates',19,'S','Own2Wheeler'),('Candidates',20,'T','IDProof'),('Candidates',21,'U','EduProof'),('Candidates',22,'V','ResumeLink'),('Candidates',23,'W','Total Time Consumed'),('Candidates',24,'X','SLA Breached ( 120 Mins)'),('Candidates',25,'Y','Process'),('Candidates',26,'Z','RecruiterAssignedName'),('Candidates',27,'AA','RecruiterEmail'),('Candidates',28,'AB','RecruiterMobile'),('Candidates',29,'AC','Walk-in EndStage'),('Candidates',30,'AD','Status'),('Candidates',31,'AE','UpdateFormLink'),('Candidates',32,'AF','Round1_Result'),('Candidates',33,'AG','Round1_VOC'),('Candidates',34,'AH','Round1_Remarks'),('Candidates',35,'AI','SkillTest_Typing'),('Candidates',36,'AJ','SkillTest_AI'),('Candidates',37,'AK','SkillTest_Result'),('Candidates',38,'AL','SkillTest_VOC'),('Candidates',39,'AM','SkillTest_Remarks'),('Candidates',40,'AN','Round2_Result'),('Candidates',41,'AO','Round2_VOC'),('Candidates',42,'AP','Round2_Remarks'),('Candidates',43,'AQ','Round3_Result'),('Candidates',44,'AR','Round3_VOC'),('Candidates',45,'AS','Round3_Remarks'),('Candidates',46,'AT','FinalDecision'),('Candidates',47,'AU','Offer_Salary'),('Candidates',48,'AV','Offer_DOJ'),('Candidates',49,'AW','Reporting_Shift'),('Candidates',50,'AX','Joining Confirmation'),('Candidates',51,'AY','Offer_PerformanceIncentive'),('Candidates',52,'AZ','CandidateConfirmLink'),('Candidates',53,'BA','BGVFormLink'),('Candidates',54,'BB','Day1DocFormLink'),('Candidates',55,'BC','LastUpdated'),('Candidates',56,'BD','HR Form Submition Time'),('Candidates',57,'BE','Walk- in SLOT'),('Candidates',58,'BF','AHT'),('Candidates',59,'BG','Rejection VOC'),('Candidates',60,'BH','Typing_Speed'),('Candidates',61,'BI','Typing_Accuracy'),('Candidates',62,'BJ','Typing_Score'),('Candidates',63,'BK','Typing_Test_Status'),('Candidates',64,'BL','Typing_Test_Attempts'),('Candidates',65,'BM','Typing_Best_Attempt_No'),('Candidates',66,'BN','Typing_Test_Last_Updated'),('Candidates',67,'BO','Comprehension Score'),
('Queue_View',1,'A','QToken'),('Queue_View',2,'B','CandidateID'),('Queue_View',3,'C','FullName'),('Queue_View',4,'D','Branch'),('Queue_View',5,'E','RoleApplied'),('Queue_View',6,'F','RecruiterAssignedName'),('Queue_View',7,'G','RecruiterMobile'),('Queue_View',8,'H','CurrentStage'),('Queue_View',9,'I','Status'),('Queue_View',10,'J','WaitingMinutes'),('Queue_View',11,'K','SLAFlag'),('Queue_View',12,'L','Email'),
('Recruiter Submission',1,'A','Timestamp'),('Recruiter Submission',2,'B','CandidateID'),('Recruiter Submission',3,'C','QToken'),('Recruiter Submission',4,'D','Walk-in End Stage'),('Recruiter Submission',5,'E','Round1 Result'),('Recruiter Submission',6,'F','Round1 VOC'),('Recruiter Submission',7,'G','Round1 Remarks'),('Recruiter Submission',8,'H','SkillTest Typing Score (WPM/Accuracy%)'),('Recruiter Submission',9,'I','SkillTest AI Score'),('Recruiter Submission',10,'J','SkillTest Result'),('Recruiter Submission',11,'K','SkillTest VOC'),('Recruiter Submission',12,'L','SkillTest Remarks'),('Recruiter Submission',13,'M','Round2 Result'),('Recruiter Submission',14,'N','Round2 VOC'),('Recruiter Submission',15,'O','Round2 Remarks'),('Recruiter Submission',16,'P','Round3 Result'),('Recruiter Submission',17,'Q','Round3 VOC'),('Recruiter Submission',18,'R','Round3 Remarks'),('Recruiter Submission',19,'S','Final Decision'),('Recruiter Submission',20,'T','Offer Salary'),('Recruiter Submission',21,'U','Date of Joining'),('Recruiter Submission',22,'V','Reporting Timing'),('Recruiter Submission',23,'W','Interviewed for Process'),('Recruiter Submission',24,'X','OT Details'),('Recruiter Submission',25,'Y','Update record'),('Recruiter Submission',26,'Z','Previous submitted time of form'),('Recruiter Submission',27,'AA','Last-Walk-in End Stage'),('Recruiter Submission',28,'AB','Last-Final Decision'),
('Recruiters',1,'A','Y'),('Recruiters',2,'B','Name'),('Recruiters',3,'C','Email'),('Recruiters',4,'D','Mobile'),('Recruiters',5,'E','Branch'),('Recruiters',6,'F','RoleCoverage'),('Recruiters',7,'G','AvailableToday (Y/N)'),('Recruiters',8,'H','DailyCapacity'),('Recruiters',9,'I','AssignedToday'),('Recruiters',10,'J','LastAssignedAt'),('Recruiters',11,'K','Notes'),('Recruiters',12,'L','Reporting Manager'),('Recruiters',13,'M','RecruiterCode'),('Recruiters',14,'N','PIN'),('Recruiters',15,'O','Branch head'),
('Config',1,'A','Setting'),('Config',2,'B','Value'),('Config',3,'C','Notes'),('VOC_Lookup',1,'A','Stages'),('VOC_Lookup',2,'B','VOC - Rejection'),('VOC_Lookup',3,'C','Conducted by'),('Dropdown_Lists',1,'A','ListName'),('Dropdown_Lists',2,'B','Value'),('Dropdown_Lists',3,'C','SortOrder'),('Dropdown_Lists',4,'D','Notes'),('Form_Field_Mapping',1,'A','FormName'),('Form_Field_Mapping',2,'B','Question Title (exact)'),('Form_Field_Mapping',3,'C','Section'),('Form_Field_Mapping',4,'D','Type'),('Form_Field_Mapping',5,'E','Required (Y/N)'),('Form_Field_Mapping',6,'F','Options/List Source'),('Form_Field_Mapping',7,'G','Maps To Candidates Column'),('Form_Field_Mapping',8,'H','Notes'),('Email_Templates',1,'A','TemplateCode'),('Email_Templates',2,'B','Trigger'),('Email_Templates',3,'C','Audience'),('Email_Templates',4,'D','Subject'),('Email_Templates',5,'E','Body'),('Forms_Catalog',1,'A','FormKey'),('Forms_Catalog',2,'B','FormTitle'),('Forms_Catalog',3,'C','Purpose'),('Forms_Catalog',4,'D','CreatedFormId'),('Forms_Catalog',5,'E','EditURL'),('Forms_Catalog',6,'F','LiveURL'),('Candidate Confirmation',1,'A','Timestamp'),('Candidate Confirmation',2,'B','CandidateID'),('Candidate Confirmation',3,'C','Will you join?'),('Candidate Confirmation',4,'D','Any query for HR?'),('Candidate Confirmation',5,'E','Candidate Name'),('Candidate Confirmation',6,'F','Recruiter Name'),('Candidate Confirmation',7,'G','Recruiter Email ID'),('Candidate Confirmation',8,'H','Process Name'),('BGV',1,'A','Timestamp'),('BGV',2,'B','Email Address'),('BGV',3,'C','BATCH NO'),('BGV',4,'D','PROCESS NAME'),('BGV',5,'E','Your Full Name'),('BGV',6,'F','Contact No.'),('BGV',7,'G','Emergency Contact No.'),('BGV',8,'H','DOB'),('BGV',9,'I','AADHAR NUMBER'),('BGV',10,'J','Fathers Name'),('BGV',11,'K','Husband name ( If Married ) only for Female Employee'),('BGV',12,'L','Is your Permanent address and current location address is same ?'),('BGV',13,'M','Permanent Address ( Mandatory to fill- House No,Building No, Street Name/Number., Landmark)'),('BGV',14,'N','Permanent Address -CITY'),('BGV',15,'O','Permanent Address - State'),('BGV',16,'P','Permanent Location - Pincode'),('BGV',17,'Q','Permanent Address - Landmark'),('BGV',18,'R','Current Address  ( Mandatory to fill- House No,Building No, Street Name/Number., Landmark)'),('BGV',19,'S','Current Address -CITY'),('BGV',20,'T','Current Address - State'),('BGV',21,'U','Current Location - Pincode'),('BGV',22,'V','Current Address - Landmark'),('Email_Log',1,'A','Timestamp'),('Email_Log',2,'B','CandidateID'),('Email_Log',3,'C','EmailType'),('Email_Log',4,'D','To'),('Email_Log',5,'E','CC'),('Email_Log',6,'F','Subject'),('Email_Log',7,'G','Status'),('Email_Log',8,'H','Notes'),('Audit_Log',1,'A','Timestamp'),('Audit_Log',2,'B','Actor'),('Audit_Log',3,'C','Action'),('Audit_Log',4,'D','CandidateID'),('Audit_Log',5,'E','Details')
ON CONFLICT (sheet_name, column_index) DO UPDATE SET
  column_letter = EXCLUDED.column_letter,
  column_header = EXCLUDED.column_header,
  active_status = true;

ALTER TABLE public.ats_candidate ADD COLUMN IF NOT EXISTS gsheet_candidate_intake_row jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.ats_candidate ADD COLUMN IF NOT EXISTS gsheet_candidates_row jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.ats_candidate ADD COLUMN IF NOT EXISTS joining_confirmation text;
ALTER TABLE public.ats_candidate ADD COLUMN IF NOT EXISTS candidate_confirm_link text;
ALTER TABLE public.ats_candidate ADD COLUMN IF NOT EXISTS bgv_form_link text;
ALTER TABLE public.ats_candidate ADD COLUMN IF NOT EXISTS day1_doc_form_link text;
ALTER TABLE public.ats_candidate ADD COLUMN IF NOT EXISTS walkin_slot text;
ALTER TABLE public.ats_candidate ADD COLUMN IF NOT EXISTS rejection_voc text;
ALTER TABLE public.ats_candidate ADD COLUMN IF NOT EXISTS typing_speed text;
ALTER TABLE public.ats_candidate ADD COLUMN IF NOT EXISTS typing_accuracy text;
ALTER TABLE public.ats_candidate ADD COLUMN IF NOT EXISTS typing_score text;
ALTER TABLE public.ats_candidate ADD COLUMN IF NOT EXISTS typing_test_status text;
ALTER TABLE public.ats_candidate ADD COLUMN IF NOT EXISTS typing_test_attempts text;
ALTER TABLE public.ats_candidate ADD COLUMN IF NOT EXISTS typing_best_attempt_no text;
ALTER TABLE public.ats_candidate ADD COLUMN IF NOT EXISTS typing_test_last_updated timestamptz;
ALTER TABLE public.ats_candidate ADD COLUMN IF NOT EXISTS comprehension_score text;

CREATE OR REPLACE VIEW public.ats_gsheet_queue_view_replica AS
SELECT
  COALESCE(NULLIF(c.q_token,''), c.metadata->>'qToken', '') AS "QToken",
  COALESCE(c.candidate_code, '') AS "CandidateID",
  COALESCE(c.full_name, '') AS "FullName",
  COALESCE(c.branch_name, a.branch_name, '') AS "Branch",
  COALESCE(c.role_applied, '') AS "RoleApplied",
  COALESCE(a.recruiter_name, c.recruiter_name, '') AS "RecruiterAssignedName",
  COALESCE(a.recruiter_mobile, '') AS "RecruiterMobile",
  COALESCE(c.walkin_end_stage, 'Arrival') AS "CurrentStage",
  COALESCE(c.status, 'Waiting') AS "Status",
  GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - c.created_at)) / 60))::integer AS "WaitingMinutes",
  CASE WHEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - c.created_at)) / 60))::integer > 120 THEN 'BREACH' ELSE 'OK' END AS "SLAFlag",
  COALESCE(c.email, '') AS "Email"
FROM public.ats_candidate c
LEFT JOIN public.ats_candidate_assignment a ON a.candidate_id = c.id
WHERE COALESCE(c.status, 'Waiting') = 'Waiting'
  AND NOT EXISTS (SELECT 1 FROM public.ats_recruiter_submission rs WHERE rs.candidate_code = c.candidate_code AND COALESCE(rs.final_decision, '') <> '');

CREATE OR REPLACE VIEW public.ats_gsheet_recruiter_submission_replica AS
SELECT
  rs.submitted_at AS "Timestamp", rs.candidate_code AS "CandidateID", rs.q_token AS "QToken", rs.walkin_end_stage AS "Walk-in End Stage", rs.round1_result AS "Round1 Result", rs.round1_voc AS "Round1 VOC", rs.round1_remarks AS "Round1 Remarks", rs.skill_typing_score AS "SkillTest Typing Score (WPM/Accuracy%)", rs.skill_ai_score AS "SkillTest AI Score", rs.skill_result AS "SkillTest Result", rs.skill_voc AS "SkillTest VOC", rs.skill_remarks AS "SkillTest Remarks", rs.round2_result AS "Round2 Result", rs.round2_voc AS "Round2 VOC", rs.round2_remarks AS "Round2 Remarks", rs.round3_result AS "Round3 Result", rs.round3_voc AS "Round3 VOC", rs.round3_remarks AS "Round3 Remarks", rs.final_decision AS "Final Decision", rs.offer_salary AS "Offer Salary", rs.offer_doj AS "Date of Joining", rs.reporting_timing AS "Reporting Timing", rs.interviewed_for_process AS "Interviewed for Process", rs.ot_details AS "OT Details", CASE WHEN rs.previous_submitted_time IS NULL THEN 'New' ELSE 'Updated' END AS "Update record", rs.previous_submitted_time AS "Previous submitted time of form", rs.last_walkin_end_stage AS "Last-Walk-in End Stage", rs.last_final_decision AS "Last-Final Decision"
FROM public.ats_recruiter_submission rs;

CREATE OR REPLACE VIEW public.ats_gsheet_candidates_replica AS
SELECT
  (c.created_at AT TIME ZONE 'Asia/Kolkata')::date AS "CreatedDate", (c.created_at AT TIME ZONE 'Asia/Kolkata')::time AS "CreatedTime", COALESCE(c.candidate_code, '') AS "CandidateID", COALESCE(NULLIF(c.q_token,''), c.metadata->>'qToken', '') AS "QToken", COALESCE(c.full_name, '') AS "FullName", COALESCE(c.mobile, '') AS "Mobile", COALESCE(c.email, '') AS "Email", COALESCE(c.address, '') AS "Address", COALESCE(c.education, '') AS "Education", COALESCE(c.experience, '') AS "Experience", COALESCE(c.gender, '') AS "Gender", COALESCE(c.role_applied, '') AS "RoleApplied", COALESCE(c.recruiter_name, '') AS "RecruiterSelected", COALESCE(c.branch_name, a.branch_name, '') AS "Branch", COALESCE(c.leaves_required, '') AS "LeavesNext3Months", COALESCE(c.preferred_shift, '') AS "PreferredShiftTiming", COALESCE(c.night_shift_comfort, '') AS "NightShiftComfortable", COALESCE(c.rotational_shift, '') AS "RotationalShiftComfort", COALESCE(c.own_two_wheeler, '') AS "Own2Wheeler", COALESCE(c.id_proof_available, '') AS "IDProof", COALESCE(c.education_proof_available, '') AS "EduProof", COALESCE(c.resume_url, '') AS "ResumeLink", GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (COALESCE(rs.submitted_at, now()) - c.created_at)) / 60))::integer AS "Total Time Consumed", CASE WHEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (COALESCE(rs.submitted_at, now()) - c.created_at)) / 60))::integer > 120 THEN 'Yes' ELSE 'No' END AS "SLA Breached ( 120 Mins)", COALESCE(rs.interviewed_for_process, c.role_applied, '') AS "Process", COALESCE(a.recruiter_name, c.recruiter_name, rs.recruiter_name, '') AS "RecruiterAssignedName", COALESCE(a.recruiter_email, '') AS "RecruiterEmail", COALESCE(a.recruiter_mobile, '') AS "RecruiterMobile", COALESCE(rs.walkin_end_stage, c.walkin_end_stage, 'Arrival') AS "Walk-in EndStage", COALESCE(c.status, 'Waiting') AS "Status", COALESCE(c.metadata->>'update_form_link', '') AS "UpdateFormLink", COALESCE(rs.round1_result, '') AS "Round1_Result", COALESCE(rs.round1_voc, '') AS "Round1_VOC", COALESCE(rs.round1_remarks, '') AS "Round1_Remarks", COALESCE(rs.skill_typing_score, '') AS "SkillTest_Typing", COALESCE(rs.skill_ai_score, '') AS "SkillTest_AI", COALESCE(rs.skill_result, '') AS "SkillTest_Result", COALESCE(rs.skill_voc, '') AS "SkillTest_VOC", COALESCE(rs.skill_remarks, '') AS "SkillTest_Remarks", COALESCE(rs.round2_result, '') AS "Round2_Result", COALESCE(rs.round2_voc, '') AS "Round2_VOC", COALESCE(rs.round2_remarks, '') AS "Round2_Remarks", COALESCE(rs.round3_result, '') AS "Round3_Result", COALESCE(rs.round3_voc, '') AS "Round3_VOC", COALESCE(rs.round3_remarks, '') AS "Round3_Remarks", COALESCE(rs.final_decision, '') AS "FinalDecision", COALESCE(rs.offer_salary, '') AS "Offer_Salary", rs.offer_doj AS "Offer_DOJ", rs.reporting_timing AS "Reporting_Shift", COALESCE(c.joining_confirmation, '') AS "Joining Confirmation", COALESCE(rs.performance_incentives, '') AS "Offer_PerformanceIncentive", COALESCE(c.candidate_confirm_link, '') AS "CandidateConfirmLink", COALESCE(c.bgv_form_link, '') AS "BGVFormLink", COALESCE(c.day1_doc_form_link, '') AS "Day1DocFormLink", COALESCE(rs.submitted_at, c.updated_at, c.created_at) AS "LastUpdated", rs.submitted_at AS "HR Form Submition Time", COALESCE(c.walkin_slot, '') AS "Walk- in SLOT", GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (COALESCE(rs.submitted_at, now()) - c.created_at)) / 60))::integer AS "AHT", COALESCE(c.rejection_voc, rs.round1_voc, rs.skill_voc, rs.round2_voc, rs.round3_voc, '') AS "Rejection VOC", COALESCE(c.typing_speed, '') AS "Typing_Speed", COALESCE(c.typing_accuracy, '') AS "Typing_Accuracy", COALESCE(c.typing_score, '') AS "Typing_Score", COALESCE(c.typing_test_status, '') AS "Typing_Test_Status", COALESCE(c.typing_test_attempts, '') AS "Typing_Test_Attempts", COALESCE(c.typing_best_attempt_no, '') AS "Typing_Best_Attempt_No", c.typing_test_last_updated AS "Typing_Test_Last_Updated", COALESCE(c.comprehension_score, '') AS "Comprehension Score"
FROM public.ats_candidate c
LEFT JOIN public.ats_candidate_assignment a ON a.candidate_id = c.id
LEFT JOIN LATERAL (SELECT * FROM public.ats_recruiter_submission s WHERE s.candidate_code = c.candidate_code ORDER BY s.submitted_at DESC NULLS LAST, s.created_at DESC NULLS LAST LIMIT 1) rs ON true;

COMMIT;

SELECT 'PHASE 7F ATS GSHEET EXACT SCHEMA ALIGNMENT INSTALLED' AS status;
