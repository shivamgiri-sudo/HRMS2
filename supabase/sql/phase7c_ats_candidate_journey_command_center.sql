-- =============================================================
-- Phase 7C: ATS Candidate Journey Command Center
-- Adds safe journey support for /ats/dashboard candidate tracking.
-- =============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Make sure journey tables exist and have expected columns.
CREATE TABLE IF NOT EXISTS public.ats_candidate_status_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid REFERENCES public.ats_candidate(id) ON DELETE CASCADE,
  old_status text,
  new_status text NOT NULL,
  event_type text NOT NULL DEFAULT 'Journey Event',
  event_note text,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.ats_candidate_status_log ADD COLUMN IF NOT EXISTS candidate_id uuid;
ALTER TABLE public.ats_candidate_status_log ADD COLUMN IF NOT EXISTS old_status text;
ALTER TABLE public.ats_candidate_status_log ADD COLUMN IF NOT EXISTS new_status text NOT NULL DEFAULT 'Waiting';
ALTER TABLE public.ats_candidate_status_log ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'Journey Event';
ALTER TABLE public.ats_candidate_status_log ADD COLUMN IF NOT EXISTS event_note text;
ALTER TABLE public.ats_candidate_status_log ADD COLUMN IF NOT EXISTS changed_by uuid;
ALTER TABLE public.ats_candidate_status_log ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.ats_candidate_status_log ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_ats_candidate_status_log_candidate_created
ON public.ats_candidate_status_log(candidate_id, created_at DESC);

-- Optional lifecycle table for candidate-to-employee journey continuity.
CREATE TABLE IF NOT EXISTS public.ats_candidate_lifecycle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid REFERENCES public.ats_candidate(id) ON DELETE CASCADE,
  candidate_code text,
  lifecycle_stage text NOT NULL DEFAULT 'Candidate Registered',
  lifecycle_status text NOT NULL DEFAULT 'Open',
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  onboarding_id uuid,
  selected_at timestamptz,
  joined_at timestamptz,
  dropped_at timestamptz,
  remarks text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ats_candidate_lifecycle ADD COLUMN IF NOT EXISTS candidate_id uuid;
ALTER TABLE public.ats_candidate_lifecycle ADD COLUMN IF NOT EXISTS candidate_code text;
ALTER TABLE public.ats_candidate_lifecycle ADD COLUMN IF NOT EXISTS lifecycle_stage text NOT NULL DEFAULT 'Candidate Registered';
ALTER TABLE public.ats_candidate_lifecycle ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'Open';
ALTER TABLE public.ats_candidate_lifecycle ADD COLUMN IF NOT EXISTS employee_id uuid;
ALTER TABLE public.ats_candidate_lifecycle ADD COLUMN IF NOT EXISTS onboarding_id uuid;
ALTER TABLE public.ats_candidate_lifecycle ADD COLUMN IF NOT EXISTS selected_at timestamptz;
ALTER TABLE public.ats_candidate_lifecycle ADD COLUMN IF NOT EXISTS joined_at timestamptz;
ALTER TABLE public.ats_candidate_lifecycle ADD COLUMN IF NOT EXISTS dropped_at timestamptz;
ALTER TABLE public.ats_candidate_lifecycle ADD COLUMN IF NOT EXISTS remarks text;
ALTER TABLE public.ats_candidate_lifecycle ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.ats_candidate_lifecycle ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.ats_candidate_lifecycle ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS ats_candidate_lifecycle_candidate_uq
ON public.ats_candidate_lifecycle(candidate_id);

-- Backfill lifecycle for existing candidates.
INSERT INTO public.ats_candidate_lifecycle (candidate_id, candidate_code, lifecycle_stage, lifecycle_status, selected_at, metadata)
SELECT
  c.id,
  c.candidate_code,
  CASE
    WHEN s.final_decision = 'Selected' THEN 'Selected - Pending Onboarding'
    WHEN s.final_decision IS NOT NULL THEN 'Recruiter Decision Completed'
    ELSE 'Candidate Registered'
  END,
  CASE
    WHEN s.final_decision IN ('Rejected','No Show') THEN 'Closed'
    ELSE 'Open'
  END,
  CASE WHEN s.final_decision = 'Selected' THEN s.submitted_at ELSE NULL END,
  jsonb_build_object('source','phase7c_backfill')
FROM public.ats_candidate c
LEFT JOIN LATERAL (
  SELECT final_decision, submitted_at
  FROM public.ats_recruiter_submission rs
  WHERE rs.candidate_code = c.candidate_code
  ORDER BY rs.submitted_at DESC NULLS LAST
  LIMIT 1
) s ON true
ON CONFLICT (candidate_id) DO UPDATE SET
  candidate_code = EXCLUDED.candidate_code,
  lifecycle_stage = EXCLUDED.lifecycle_stage,
  lifecycle_status = EXCLUDED.lifecycle_status,
  selected_at = coalesce(public.ats_candidate_lifecycle.selected_at, EXCLUDED.selected_at),
  updated_at = now();

ALTER TABLE public.ats_candidate_status_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ats_candidate_lifecycle ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ats_candidate_status_log' AND policyname='authenticated_all_ats_candidate_status_log') THEN
    CREATE POLICY authenticated_all_ats_candidate_status_log ON public.ats_candidate_status_log FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ats_candidate_lifecycle' AND policyname='authenticated_all_ats_candidate_lifecycle') THEN
    CREATE POLICY authenticated_all_ats_candidate_lifecycle ON public.ats_candidate_lifecycle FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Add/repair ATS dashboard page metadata.
INSERT INTO public.page_master (module_code, page_code, page_name, page_description, route_path, open_mode, icon_name, display_order, active_status)
VALUES
('ATS','ATS_DASHBOARD','ATS Candidate Journey Command Center','Candidate master, journey timeline, recruiter assignment and interview decision tracking','/ats/dashboard','internal','LayoutDashboard',20,true)
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
('admin','ATS_DASHBOARD',true,true,true,true,true,true),
('hr','ATS_DASHBOARD',true,true,true,false,true,true),
('manager','ATS_DASHBOARD',true,false,false,false,true,true),
('recruiter','ATS_DASHBOARD',true,false,false,false,false,true)
ON CONFLICT (role_key, page_code) DO UPDATE SET
  can_view = EXCLUDED.can_view,
  can_create = EXCLUDED.can_create,
  can_edit = EXCLUDED.can_edit,
  can_delete = EXCLUDED.can_delete,
  can_export = EXCLUDED.can_export,
  active_status = true,
  updated_at = now();

COMMIT;

SELECT 'PHASE 7C ATS CANDIDATE JOURNEY COMMAND CENTER INSTALLED' AS status;
