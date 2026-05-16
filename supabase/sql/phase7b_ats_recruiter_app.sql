-- =============================================================
-- Phase 7B: Native ATS Recruiter Mobile App Full Replica
-- Live-schema safe SQL for Supabase
-- Source of truth: existing Apps Script Recruiter Mobile App
-- =============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -------------------------------------------------------------
-- Recruiter profile enhancements for same RecruiterCode + PIN flow
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ats_recruiter_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  recruiter_code text,
  recruiter_name text NOT NULL,
  email text,
  mobile text,
  branch_name text,
  available_today boolean NOT NULL DEFAULT true,
  active_status boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ats_recruiter_profile ADD COLUMN IF NOT EXISTS pin text;
ALTER TABLE public.ats_recruiter_profile ADD COLUMN IF NOT EXISTS available_today boolean NOT NULL DEFAULT true;
ALTER TABLE public.ats_recruiter_profile ADD COLUMN IF NOT EXISTS active_status boolean NOT NULL DEFAULT true;
ALTER TABLE public.ats_recruiter_profile ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.ats_recruiter_profile ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS ats_recruiter_profile_code_uq
ON public.ats_recruiter_profile (recruiter_code)
WHERE recruiter_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ats_recruiter_profile_name_branch
ON public.ats_recruiter_profile (lower(recruiter_name), lower(coalesce(branch_name,'')));

ALTER TABLE public.ats_recruiter_profile ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ats_recruiter_profile' AND policyname='public_read_active_recruiters') THEN
    CREATE POLICY public_read_active_recruiters ON public.ats_recruiter_profile FOR SELECT TO public USING (active_status = true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ats_recruiter_profile' AND policyname='authenticated_manage_recruiters') THEN
    CREATE POLICY authenticated_manage_recruiters ON public.ats_recruiter_profile FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- -------------------------------------------------------------
-- Candidate table enhancements for recruiter app details
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ats_candidate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_code text UNIQUE,
  full_name text,
  mobile text,
  email text,
  status text NOT NULL DEFAULT 'Waiting',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ats_candidate ADD COLUMN IF NOT EXISTS candidate_code text;
ALTER TABLE public.ats_candidate ADD COLUMN IF NOT EXISTS q_token text;
ALTER TABLE public.ats_candidate ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE public.ats_candidate ADD COLUMN IF NOT EXISTS mobile text;
ALTER TABLE public.ats_candidate ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.ats_candidate ADD COLUMN IF NOT EXISTS branch_name text;
ALTER TABLE public.ats_candidate ADD COLUMN IF NOT EXISTS role_applied text;
ALTER TABLE public.ats_candidate ADD COLUMN IF NOT EXISTS recruiter_name text;
ALTER TABLE public.ats_candidate ADD COLUMN IF NOT EXISTS walkin_end_stage text;
ALTER TABLE public.ats_candidate ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Waiting';
ALTER TABLE public.ats_candidate ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.ats_candidate ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.ats_candidate ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public'
      AND tablename='ats_candidate'
      AND indexname='ats_candidate_candidate_code_uq'
  ) THEN
    CREATE UNIQUE INDEX ats_candidate_candidate_code_uq
    ON public.ats_candidate(candidate_code)
    WHERE candidate_code IS NOT NULL;
  END IF;
END $$;

-- -------------------------------------------------------------
-- Candidate assignment table; candidate form Phase 7A also uses this
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ats_candidate_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.ats_candidate(id) ON DELETE CASCADE,
  recruiter_profile_id uuid REFERENCES public.ats_recruiter_profile(id) ON DELETE SET NULL,
  recruiter_name text,
  recruiter_email text,
  recruiter_mobile text,
  branch_name text,
  assignment_status text NOT NULL DEFAULT 'Waiting',
  assigned_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS ats_candidate_assignment_candidate_uq
ON public.ats_candidate_assignment (candidate_id);

ALTER TABLE public.ats_candidate_assignment ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ats_candidate_assignment' AND policyname='authenticated_all_ats_candidate_assignment') THEN
    CREATE POLICY authenticated_all_ats_candidate_assignment ON public.ats_candidate_assignment FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ats_candidate_assignment' AND policyname='public_read_ats_candidate_assignment') THEN
    CREATE POLICY public_read_ats_candidate_assignment ON public.ats_candidate_assignment FOR SELECT TO public USING (true);
  END IF;
END $$;

-- -------------------------------------------------------------
-- Recruiter submission native table: exact mapped fields from sheet
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ats_recruiter_submission (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid REFERENCES public.ats_candidate(id) ON DELETE SET NULL,
  candidate_code text NOT NULL,
  q_token text,
  recruiter_profile_id uuid REFERENCES public.ats_recruiter_profile(id) ON DELETE SET NULL,
  recruiter_name text,
  submitted_at timestamptz NOT NULL DEFAULT now(),

  walkin_end_stage text,
  round1_result text,
  round1_voc text,
  round1_remarks text,

  skill_typing_score text,
  skill_ai_score text,
  skill_result text,
  skill_voc text,
  skill_remarks text,

  round2_result text,
  round2_voc text,
  round2_remarks text,

  round3_result text,
  round3_voc text,
  round3_remarks text,

  final_decision text,
  offer_salary text,
  offer_doj date,
  reporting_timing time,
  interviewed_for_process text,
  ot_details text,
  performance_incentives text,

  previous_submitted_time timestamptz,
  last_walkin_end_stage text,
  last_final_decision text,

  source_system text NOT NULL DEFAULT 'NATIVE_ATS_RECRUITER_APP',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ats_recruiter_submission ADD COLUMN IF NOT EXISTS previous_submitted_time timestamptz;
ALTER TABLE public.ats_recruiter_submission ADD COLUMN IF NOT EXISTS last_walkin_end_stage text;
ALTER TABLE public.ats_recruiter_submission ADD COLUMN IF NOT EXISTS last_final_decision text;

CREATE UNIQUE INDEX IF NOT EXISTS ats_recruiter_submission_candidate_token_uq
ON public.ats_recruiter_submission(candidate_code, coalesce(q_token,''));

ALTER TABLE public.ats_recruiter_submission ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ats_recruiter_submission' AND policyname='authenticated_all_ats_recruiter_submission') THEN
    CREATE POLICY authenticated_all_ats_recruiter_submission ON public.ats_recruiter_submission FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- -------------------------------------------------------------
-- Audit/event log
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ats_candidate_status_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid REFERENCES public.ats_candidate(id) ON DELETE CASCADE,
  old_status text,
  new_status text NOT NULL,
  event_type text NOT NULL DEFAULT 'Recruiter Update',
  event_note text,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.ats_candidate_status_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ats_candidate_status_log' AND policyname='authenticated_all_ats_candidate_status_log') THEN
    CREATE POLICY authenticated_all_ats_candidate_status_log ON public.ats_candidate_status_log FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- -------------------------------------------------------------
-- Functions
-- -------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.native_ats_get_recruiter_app_config()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'ok', true,
    'processOptions', jsonb_build_array('Onfido', 'Reginald', 'BBB', 'GS1', 'GPI', 'FF', 'DRA'),
    'decisionOptions', jsonb_build_array('Selected', 'Rejected', 'Hold', 'Client Round - Pending', 'No Show'),
    'stageOptions', jsonb_build_array('Arrival', 'Round 1- HR Screening', 'Interview - Skill Test', 'Round 2- Op''s', 'Round 3- Client', 'Selection Discussion'),
    'vocOptions', jsonb_build_array(
      'Undergraduate / Qualification Issue',
      'Poor Communication Skill',
      'Poor Reading / Comprehension',
      'Salary Issue',
      'Shift / Timing Issue',
      'Location / Travel Issue',
      'Stability Concern',
      'Documentation Issue',
      'Role / Process Mismatch',
      'Candidate Not Interested',
      'No Show',
      'Age Barrier'
    ),
    'skillVocOptions', jsonb_build_array(
      'Typing Speed Issue',
      'Typing Accuracy Issue',
      'Pehchan Score Low',
      'Poor Sales Skill',
      'Vocabulary / Grammar Issue',
      'Computer / System Skill Gap',
      'Assessment Incomplete / Failed'
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.native_ats_validate_recruiter(
  p_recruiter_code text,
  p_pin text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec public.ats_recruiter_profile%ROWTYPE;
BEGIN
  p_recruiter_code := trim(coalesce(p_recruiter_code,''));
  p_pin := trim(coalesce(p_pin,''));

  IF p_recruiter_code = '' OR p_pin = '' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Recruiter Code and PIN are required.');
  END IF;

  SELECT *
  INTO v_rec
  FROM public.ats_recruiter_profile
  WHERE coalesce(recruiter_code,'') = p_recruiter_code
    AND coalesce(pin,'') = p_pin
    AND active_status = true
  LIMIT 1;

  IF v_rec.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Invalid Recruiter Code or PIN.');
  END IF;

  IF coalesce(v_rec.available_today, true) = false THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Recruiter is inactive today.');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'recruiterProfileId', v_rec.id,
    'recruiterCode', v_rec.recruiter_code,
    'recruiterName', v_rec.recruiter_name,
    'branch', v_rec.branch_name
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.native_ats_get_pending_candidates(
  p_recruiter_code text,
  p_pin text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth jsonb;
  v_recruiter_name text;
  v_candidates jsonb;
BEGIN
  v_auth := public.native_ats_validate_recruiter(p_recruiter_code, p_pin);

  IF coalesce((v_auth->>'ok')::boolean, false) = false THEN
    RETURN v_auth;
  END IF;

  v_recruiter_name := v_auth->>'recruiterName';

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'candidateId', c.candidate_code,
      'qToken', coalesce(c.q_token, c.metadata->>'qToken', ''),
      'fullName', coalesce(c.full_name, ''),
      'mobile', coalesce(c.mobile, ''),
      'email', coalesce(c.email, ''),
      'branch', coalesce(c.branch_name, a.branch_name, ''),
      'roleApplied', coalesce(c.role_applied, ''),
      'stage', coalesce(c.walkin_end_stage, 'Arrival'),
      'status', coalesce(c.status, 'Waiting'),
      'pendingMinutes', greatest(0, floor(extract(epoch from (now() - c.created_at)) / 60))::int
    )
    ORDER BY greatest(0, floor(extract(epoch from (now() - c.created_at)) / 60)) ASC
  ), '[]'::jsonb)
  INTO v_candidates
  FROM public.ats_candidate c
  LEFT JOIN public.ats_candidate_assignment a
    ON a.candidate_id = c.id
  WHERE lower(trim(coalesce(a.recruiter_name, c.recruiter_name, ''))) = lower(trim(v_recruiter_name))
    AND coalesce(c.status, 'Waiting') = 'Waiting';

  RETURN jsonb_build_object(
    'ok', true,
    'recruiterName', v_recruiter_name,
    'candidates', v_candidates
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.native_ats_get_candidate_details(
  p_recruiter_code text,
  p_pin text,
  p_candidate_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth jsonb;
  v_recruiter_name text;
  v_candidate public.ats_candidate%ROWTYPE;
  v_assignment public.ats_candidate_assignment%ROWTYPE;
BEGIN
  v_auth := public.native_ats_validate_recruiter(p_recruiter_code, p_pin);

  IF coalesce((v_auth->>'ok')::boolean, false) = false THEN
    RETURN v_auth;
  END IF;

  v_recruiter_name := v_auth->>'recruiterName';

  SELECT * INTO v_candidate
  FROM public.ats_candidate
  WHERE trim(coalesce(candidate_code,'')) = trim(coalesce(p_candidate_code,''))
  LIMIT 1;

  IF v_candidate.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Candidate not found.');
  END IF;

  SELECT * INTO v_assignment
  FROM public.ats_candidate_assignment
  WHERE candidate_id = v_candidate.id
  LIMIT 1;

  IF lower(trim(coalesce(v_assignment.recruiter_name, v_candidate.recruiter_name, ''))) <> lower(trim(v_recruiter_name)) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'This candidate is not assigned to this recruiter.');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'candidate', jsonb_build_object(
      'candidateId', coalesce(v_candidate.candidate_code, ''),
      'qToken', coalesce(v_candidate.q_token, v_candidate.metadata->>'qToken', ''),
      'fullName', coalesce(v_candidate.full_name, ''),
      'mobile', coalesce(v_candidate.mobile, ''),
      'email', coalesce(v_candidate.email, ''),
      'branch', coalesce(v_candidate.branch_name, v_assignment.branch_name, ''),
      'roleApplied', coalesce(v_candidate.role_applied, ''),
      'stage', coalesce(v_candidate.walkin_end_stage, 'Arrival'),
      'status', coalesce(v_candidate.status, ''),
      'recruiterName', coalesce(v_assignment.recruiter_name, v_candidate.recruiter_name, '')
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.native_ats_submit_interview_update(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth jsonb;
  v_recruiter_name text;
  v_recruiter_profile_id uuid;
  v_candidate public.ats_candidate%ROWTYPE;
  v_assignment public.ats_candidate_assignment%ROWTYPE;
  v_existing public.ats_recruiter_submission%ROWTYPE;
  v_candidate_code text := trim(coalesce(payload->>'candidateId',''));
  v_q_token text;
  v_process_name text := trim(coalesce(payload->>'processName',''));
  v_final_decision text := trim(coalesce(payload->>'finalDecision',''));
  v_stage_name text := trim(coalesce(payload->>'stageName',''));
  v_stage_rank integer;
  v_round1_result text;
  v_skill_result text := trim(coalesce(payload->>'skillResult',''));
  v_round2_result text;
  v_round3_result text;
  v_is_selected boolean;
  v_offer_doj date;
  v_reporting_timing time;
BEGIN
  v_auth := public.native_ats_validate_recruiter(payload->>'recruiterCode', payload->>'pin');

  IF coalesce((v_auth->>'ok')::boolean, false) = false THEN
    RETURN v_auth;
  END IF;

  v_recruiter_name := v_auth->>'recruiterName';
  v_recruiter_profile_id := nullif(v_auth->>'recruiterProfileId','')::uuid;

  SELECT * INTO v_candidate
  FROM public.ats_candidate
  WHERE trim(coalesce(candidate_code,'')) = v_candidate_code
  LIMIT 1;

  IF v_candidate.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Candidate not found.');
  END IF;

  SELECT * INTO v_assignment
  FROM public.ats_candidate_assignment
  WHERE candidate_id = v_candidate.id
  LIMIT 1;

  IF lower(trim(coalesce(v_assignment.recruiter_name, v_candidate.recruiter_name, ''))) <> lower(trim(v_recruiter_name)) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'This candidate is not assigned to this recruiter.');
  END IF;

  IF v_process_name = '' THEN RETURN jsonb_build_object('ok', false, 'message', 'Interviewed for Process is required.'); END IF;
  IF v_final_decision = '' THEN RETURN jsonb_build_object('ok', false, 'message', 'Final Decision is required.'); END IF;
  IF v_stage_name = '' THEN RETURN jsonb_build_object('ok', false, 'message', 'Walk-in End Stage is required.'); END IF;

  v_stage_rank := CASE v_stage_name
    WHEN 'Arrival' THEN 0
    WHEN 'Round 1- HR Screening' THEN 1
    WHEN 'Interview - Skill Test' THEN 2
    WHEN 'Round 2- Op''s' THEN 3
    WHEN 'Round 3- Client' THEN 4
    WHEN 'Selection Discussion' THEN 5
    ELSE NULL
  END;

  IF v_stage_rank IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Invalid Walk-in End Stage.');
  END IF;

  v_is_selected := v_final_decision = 'Selected';

  v_round1_result := CASE WHEN v_is_selected THEN 'Selected' ELSE trim(coalesce(payload->>'round1Result','')) END;
  v_round2_result := CASE WHEN v_is_selected AND v_stage_rank >= 3 THEN 'Selected' ELSE trim(coalesce(payload->>'round2Result','')) END;
  v_round3_result := CASE WHEN v_is_selected AND v_stage_rank >= 4 THEN 'Selected' ELSE trim(coalesce(payload->>'round3Result','')) END;

  IF v_stage_rank >= 1 AND v_round1_result = '' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Round1 Result is required for the selected stage.');
  END IF;

  IF v_stage_rank >= 3 AND v_round2_result = '' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Round2 Result is required for the selected stage.');
  END IF;

  IF v_stage_rank >= 4 AND v_round3_result = '' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Round3 Result is required for the selected stage.');
  END IF;

  IF v_is_selected THEN
    IF trim(coalesce(payload->>'offerSalary','')) = '' THEN
      RETURN jsonb_build_object('ok', false, 'message', 'Offer Salary is required when Final Decision is Selected.');
    END IF;
    IF trim(coalesce(payload->>'offerDoj','')) = '' THEN
      RETURN jsonb_build_object('ok', false, 'message', 'Date of Joining is required when Final Decision is Selected.');
    END IF;
    IF trim(coalesce(payload->>'reportingTiming','')) = '' THEN
      RETURN jsonb_build_object('ok', false, 'message', 'Reporting Timing is required when Final Decision is Selected.');
    END IF;
  END IF;

  IF v_round1_result = 'Rejected' AND trim(coalesce(payload->>'round1Voc','')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Round1 VOC is required when Round1 Result is Rejected.');
  END IF;

  -- AI Skill Test is optional. Only rejection needs VOC.
  IF v_skill_result = 'Rejected' AND trim(coalesce(payload->>'skillVoc','')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'SkillTest VOC is required when SkillTest Result is Rejected.');
  END IF;

  IF v_round2_result = 'Rejected' AND trim(coalesce(payload->>'round2Voc','')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Round2 VOC is required when Round2 Result is Rejected.');
  END IF;

  IF v_round3_result = 'Rejected' AND trim(coalesce(payload->>'round3Voc','')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Round3 VOC is required when Round3 Result is Rejected.');
  END IF;

  v_q_token := coalesce(v_candidate.q_token, v_candidate.metadata->>'qToken', '');

  IF trim(coalesce(payload->>'offerDoj','')) <> '' THEN
    v_offer_doj := (payload->>'offerDoj')::date;
  END IF;

  IF trim(coalesce(payload->>'reportingTiming','')) <> '' THEN
    v_reporting_timing := (payload->>'reportingTiming')::time;
  END IF;

  SELECT * INTO v_existing
  FROM public.ats_recruiter_submission
  WHERE candidate_code = v_candidate_code
    AND coalesce(q_token,'') = coalesce(v_q_token,'')
  ORDER BY submitted_at DESC
  LIMIT 1;

  IF v_existing.id IS NULL THEN
    INSERT INTO public.ats_recruiter_submission (
      candidate_id, candidate_code, q_token, recruiter_profile_id, recruiter_name,
      walkin_end_stage,
      round1_result, round1_voc, round1_remarks,
      skill_typing_score, skill_ai_score, skill_result, skill_voc, skill_remarks,
      round2_result, round2_voc, round2_remarks,
      round3_result, round3_voc, round3_remarks,
      final_decision, offer_salary, offer_doj, reporting_timing, interviewed_for_process,
      ot_details, performance_incentives
    ) VALUES (
      v_candidate.id, v_candidate_code, v_q_token, v_recruiter_profile_id, v_recruiter_name,
      v_stage_name,
      v_round1_result, trim(coalesce(payload->>'round1Voc','')), trim(coalesce(payload->>'round1Remarks','')),
      trim(coalesce(payload->>'skillTypingScore','')), trim(coalesce(payload->>'skillAiScore','')), v_skill_result, trim(coalesce(payload->>'skillVoc','')), trim(coalesce(payload->>'skillRemarks','')),
      v_round2_result, trim(coalesce(payload->>'round2Voc','')), trim(coalesce(payload->>'round2Remarks','')),
      v_round3_result, trim(coalesce(payload->>'round3Voc','')), trim(coalesce(payload->>'round3Remarks','')),
      v_final_decision, trim(coalesce(payload->>'offerSalary','')), v_offer_doj, v_reporting_timing, v_process_name,
      trim(coalesce(payload->>'otDetails','')), trim(coalesce(payload->>'performanceIncentives',''))
    );
  ELSE
    UPDATE public.ats_recruiter_submission
    SET previous_submitted_time = submitted_at,
        last_walkin_end_stage = walkin_end_stage,
        last_final_decision = final_decision,
        submitted_at = now(),
        recruiter_profile_id = v_recruiter_profile_id,
        recruiter_name = v_recruiter_name,
        walkin_end_stage = v_stage_name,
        round1_result = v_round1_result,
        round1_voc = trim(coalesce(payload->>'round1Voc','')),
        round1_remarks = trim(coalesce(payload->>'round1Remarks','')),
        skill_typing_score = trim(coalesce(payload->>'skillTypingScore','')),
        skill_ai_score = trim(coalesce(payload->>'skillAiScore','')),
        skill_result = v_skill_result,
        skill_voc = trim(coalesce(payload->>'skillVoc','')),
        skill_remarks = trim(coalesce(payload->>'skillRemarks','')),
        round2_result = v_round2_result,
        round2_voc = trim(coalesce(payload->>'round2Voc','')),
        round2_remarks = trim(coalesce(payload->>'round2Remarks','')),
        round3_result = v_round3_result,
        round3_voc = trim(coalesce(payload->>'round3Voc','')),
        round3_remarks = trim(coalesce(payload->>'round3Remarks','')),
        final_decision = v_final_decision,
        offer_salary = trim(coalesce(payload->>'offerSalary','')),
        offer_doj = v_offer_doj,
        reporting_timing = v_reporting_timing,
        interviewed_for_process = v_process_name,
        ot_details = trim(coalesce(payload->>'otDetails','')),
        performance_incentives = trim(coalesce(payload->>'performanceIncentives','')),
        updated_at = now()
    WHERE id = v_existing.id;
  END IF;

  INSERT INTO public.ats_candidate_status_log (
    candidate_id,
    old_status,
    new_status,
    event_type,
    event_note,
    metadata
  ) VALUES (
    v_candidate.id,
    coalesce(v_candidate.status, 'Waiting'),
    coalesce(v_candidate.status, 'Waiting'),
    CASE WHEN v_existing.id IS NULL THEN 'RECRUITER_MOBILE_SUBMISSION' ELSE 'RECRUITER_MOBILE_SUBMISSION_UPDATED' END,
    CASE WHEN v_existing.id IS NULL
      THEN 'Written to Recruiter Submission; Final Decision=' || v_final_decision
      ELSE 'Updated existing Recruiter Submission row; Final Decision=' || v_final_decision
    END,
    jsonb_build_object(
      'candidate_code', v_candidate_code,
      'recruiter_name', v_recruiter_name,
      'final_decision', v_final_decision,
      'stage', v_stage_name
    )
  );

  RETURN jsonb_build_object('ok', true, 'message', 'Update submitted successfully.');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'message', SQLERRM);
END;
$$;

-- -------------------------------------------------------------
-- Route/access registration
-- -------------------------------------------------------------
INSERT INTO public.page_master (module_code, page_code, page_name, page_description, route_path, open_mode, icon_name, display_order, active_status)
VALUES
('ATS','ATS_RECRUITER_QUEUE','Recruiter Candidate Queue','Native recruiter mobile app full replica','/ats/recruiter/my-candidates','internal','ClipboardList',30,true)
ON CONFLICT (page_code) DO UPDATE SET
  module_code = EXCLUDED.module_code,
  page_name = EXCLUDED.page_name,
  page_description = EXCLUDED.page_description,
  route_path = EXCLUDED.route_path,
  open_mode = EXCLUDED.open_mode,
  icon_name = EXCLUDED.icon_name,
  display_order = EXCLUDED.display_order,
  active_status = true,
  updated_at = now();

INSERT INTO public.role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
('recruiter','ATS_RECRUITER_QUEUE',true,true,true,false,false,true),
('admin','ATS_RECRUITER_QUEUE',true,true,true,true,true,true),
('hr','ATS_RECRUITER_QUEUE',true,true,true,false,true,true)
ON CONFLICT (role_key, page_code) DO UPDATE SET
  can_view = EXCLUDED.can_view,
  can_create = EXCLUDED.can_create,
  can_edit = EXCLUDED.can_edit,
  can_delete = EXCLUDED.can_delete,
  can_export = EXCLUDED.can_export,
  active_status = true,
  updated_at = now();

COMMIT;

SELECT 'PHASE 7B NATIVE ATS RECRUITER MOBILE APP REPLICA INSTALLED' AS status;
