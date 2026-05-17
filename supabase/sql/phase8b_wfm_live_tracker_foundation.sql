-- =============================================================
-- Phase 8B: Native WFM Live Tracker Foundation
-- Safe additive SQL for roster assignment, login/logout sessions and break logs.
-- =============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.wfm_shift_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_code text UNIQUE NOT NULL,
  shift_name text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  required_minutes integer NOT NULL DEFAULT 540,
  active_status boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wfm_shift_master ADD COLUMN IF NOT EXISTS required_minutes integer NOT NULL DEFAULT 540;
ALTER TABLE public.wfm_shift_master ADD COLUMN IF NOT EXISTS active_status boolean NOT NULL DEFAULT true;
ALTER TABLE public.wfm_shift_master ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.wfm_shift_master ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.wfm_shift_master ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.wfm_roster_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES public.employees(id) ON DELETE CASCADE,
  shift_id uuid REFERENCES public.wfm_shift_master(id) ON DELETE SET NULL,
  roster_date date NOT NULL,
  roster_status text NOT NULL DEFAULT 'Rostered',
  branch_name text,
  process_name text,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, roster_date)
);

CREATE TABLE IF NOT EXISTS public.wfm_attendance_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_assignment_id uuid REFERENCES public.wfm_roster_assignment(id) ON DELETE SET NULL,
  employee_id uuid REFERENCES public.employees(id) ON DELETE CASCADE,
  session_date date NOT NULL,
  login_time timestamptz,
  logout_time timestamptz,
  total_login_minutes integer NOT NULL DEFAULT 0,
  current_status text NOT NULL DEFAULT 'Rostered',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, session_date)
);

CREATE TABLE IF NOT EXISTS public.wfm_break_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.wfm_attendance_session(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.employees(id) ON DELETE CASCADE,
  break_start timestamptz NOT NULL,
  break_end timestamptz,
  duration_minutes integer NOT NULL DEFAULT 0,
  break_type text NOT NULL DEFAULT 'Break',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wfm_roster_assignment_date ON public.wfm_roster_assignment(roster_date);
CREATE INDEX IF NOT EXISTS idx_wfm_attendance_session_date ON public.wfm_attendance_session(session_date);
CREATE INDEX IF NOT EXISTS idx_wfm_break_log_employee_start ON public.wfm_break_log(employee_id, break_start DESC);

ALTER TABLE public.wfm_shift_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wfm_roster_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wfm_attendance_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wfm_break_log ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['wfm_shift_master','wfm_roster_assignment','wfm_attendance_session','wfm_break_log'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='authenticated_all_' || t) THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', 'authenticated_all_' || t, t);
    END IF;
  END LOOP;
END $$;

INSERT INTO public.wfm_shift_master (shift_code, shift_name, start_time, end_time, required_minutes)
VALUES
('MORNING','Morning Shift','09:00','18:00',540),
('AFTERNOON','Afternoon Shift','13:00','22:00',540),
('NIGHT','Night Shift','22:00','07:00',540)
ON CONFLICT (shift_code) DO UPDATE SET
  shift_name = EXCLUDED.shift_name,
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  required_minutes = EXCLUDED.required_minutes,
  active_status = true,
  updated_at = now();

INSERT INTO public.page_master (module_code, page_code, page_name, page_description, route_path, open_mode, icon_name, display_order, active_status)
VALUES
('WFM','WFM_ROSTER','WFM Roster','Shift master and roster planning','/wfm/roster','internal','CalendarDays',50,true),
('WFM','WFM_LIVE_TRACKER','WFM Live Tracker','Live login, logout and break tracker','/wfm/live-tracker','internal','Clock',51,true)
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
('admin','WFM_LIVE_TRACKER',true,true,true,true,true,true),
('hr','WFM_LIVE_TRACKER',true,true,true,false,true,true),
('manager','WFM_LIVE_TRACKER',true,true,true,false,true,true),
('employee','WFM_LIVE_TRACKER',false,false,false,false,false,true),
('admin','WFM_ROSTER',true,true,true,true,true,true),
('hr','WFM_ROSTER',true,true,true,false,true,true),
('manager','WFM_ROSTER',true,true,true,false,true,true)
ON CONFLICT (role_key, page_code) DO UPDATE SET
  can_view = EXCLUDED.can_view,
  can_create = EXCLUDED.can_create,
  can_edit = EXCLUDED.can_edit,
  can_delete = EXCLUDED.can_delete,
  can_export = EXCLUDED.can_export,
  active_status = true,
  updated_at = now();

COMMIT;

SELECT 'PHASE 8B NATIVE WFM LIVE TRACKER FOUNDATION INSTALLED' AS status;
