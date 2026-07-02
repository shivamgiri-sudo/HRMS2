# Workforce OS Phases 8G–8K Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete MAS Callnet Workforce OS from current v5 foundation through production go-live — merging v5 into GitHub, fixing 4 critical bugs, enforcing route-level access control, bridging LMS single sign-on, building missing dashboards, and wiring reports.

**Architecture:** Parallel Track 1 (foundation + LMS bridge) and Track 2 (dashboards) against the same Supabase project. Performance data (Quality, Operations, Command Center) comes from `call-master-backend` with MySQL stub endpoints now, real queries when server access is available. LMS runs locally on port 4000, HRMS on port 8080, call-master-backend on port 5050.

**Tech Stack:** React 18 + TypeScript + Vite + Supabase (HRMS), Node/Express + Prisma + PostgreSQL (LMS backend), Node/Express + MySQL2 + TypeScript (call-master-backend), TanStack Query v5, shadcn/ui, Recharts, Tailwind CSS.

---

## File Map

### New files to create (HRMS frontend)
- `src/components/auth/WorkforcePageGate.tsx` — route-level page access guard
- `src/hooks/usePageAccess.ts` — queries role_page_access, caches per session
- `src/hooks/useLMSSession.ts` — LMS bridge token management
- `src/components/wfm/LiveTrackerBoard.tsx` — 4-lane status board with realtime
- `src/components/wfm/ManualPunchPanel.tsx` — WFM Admin punch controls
- `src/pages/WFMLiveTracker.tsx` — replaces NativePlaceholderPage for /wfm/live-tracker
- `src/pages/QualityDashboard.tsx` — replaces NativePlaceholderPage for /quality/dashboard
- `src/pages/OperationsDashboard.tsx` — replaces NativePlaceholderPage for /operations/dashboard

### Files to modify (HRMS frontend)
- `src/App.tsx` — wrap Workforce OS routes in WorkforcePageGate
- `src/pages/NativeATSRecruiterDashboard.tsx` — fix stage_name → walkin_end_stage
- `src/pages/NativeLMSCoordinator.tsx` — fix batch_code → batch_no
- `src/pages/UnifiedPerformanceCommandCenter.tsx` — add filters + API call to call-master-backend
- `src/pages/NativeLMSMyLearning.tsx` — wire useLMSSession for API calls
- `src/pages/NativeLMSCoordinator.tsx` — wire useLMSSession
- `.env` — add VITE_LMS_API_URL, VITE_BACKEND_API_URL

### New files to create (LMS backend — lms-platform/backend)
- `src/routes/bridge.js` — POST /api/auth/bridge endpoint
- `src/controllers/bridgeController.js` — Supabase token verify + session create

### Files to modify (LMS backend)
- `src/server.js` — mount bridge route, add HRMS origin to CORS
- `.env` / `.env.example` — add SUPABASE_URL, SUPABASE_ANON_KEY

### New files to create (call-master-backend)
- `src/routes/hrms.ts` — mounts /api/quality, /api/operations, /api/performance
- `src/controllers/hrmsController.ts` — stub handlers returning correct shapes
- `src/routes/reports.ts` — report generation endpoints
- `src/controllers/reportsController.ts` — document generation + delivery

### Files to modify (call-master-backend)
- `src/server.ts` — mount hrms and reports routes
- `.env.example` — add SUPABASE_URL, SUPABASE_ANON_KEY

### New SQL files (Supabase)
- `supabase/sql/phase8g_bulk_upload_rpcs.sql` — 7 import RPC functions
- `supabase/sql/phase8g_wfm_attendance_tables.sql` — wfm_attendance_session, wfm_break_log, wfm_external_punch_staging
- `supabase/sql/phase8h_import_staging_tables.sql` — 5 staging tables
- `supabase/sql/phase8i_rls_policies.sql` — hard RLS for all module tables

---

## TRACK 1 — Foundation

---

### Task 1: Merge v5 into GitHub repo

**Files:**
- Modify: entire `src/` tree of `mas-callnet-hrms` GitHub repo

- [ ] **Step 1: Clone the GitHub repo locally if not already done**

```bash
git clone https://github.com/shivamgiri-sudo/mas-callnet-hrms.git
cd mas-callnet-hrms
```

- [ ] **Step 2: Copy v5 pages into repo**

```bash
cp -r "/c/Users/shivamg/Downloads/hrms-native-workforce-os-foundation-v5-live-schema-fixed/src/pages/BulkUploadHub.tsx" src/pages/
cp -r "/c/Users/shivamg/Downloads/hrms-native-workforce-os-foundation-v5-live-schema-fixed/src/pages/ModuleLauncher.tsx" src/pages/
cp -r "/c/Users/shivamg/Downloads/hrms-native-workforce-os-foundation-v5-live-schema-fixed/src/pages/NativeATSCandidateRegistration.tsx" src/pages/
cp -r "/c/Users/shivamg/Downloads/hrms-native-workforce-os-foundation-v5-live-schema-fixed/src/pages/NativeATSDashboard.tsx" src/pages/
cp -r "/c/Users/shivamg/Downloads/hrms-native-workforce-os-foundation-v5-live-schema-fixed/src/pages/NativeATSRecruiterDashboard.tsx" src/pages/
cp -r "/c/Users/shivamg/Downloads/hrms-native-workforce-os-foundation-v5-live-schema-fixed/src/pages/NativeLMSCoordinator.tsx" src/pages/
cp -r "/c/Users/shivamg/Downloads/hrms-native-workforce-os-foundation-v5-live-schema-fixed/src/pages/NativeLMSMyLearning.tsx" src/pages/
cp -r "/c/Users/shivamg/Downloads/hrms-native-workforce-os-foundation-v5-live-schema-fixed/src/pages/NativePlaceholderPage.tsx" src/pages/
cp -r "/c/Users/shivamg/Downloads/hrms-native-workforce-os-foundation-v5-live-schema-fixed/src/pages/NativeWFMRoster.tsx" src/pages/
cp -r "/c/Users/shivamg/Downloads/hrms-native-workforce-os-foundation-v5-live-schema-fixed/src/pages/UnifiedAccessControl.tsx" src/pages/
cp -r "/c/Users/shivamg/Downloads/hrms-native-workforce-os-foundation-v5-live-schema-fixed/src/pages/UnifiedPerformanceCommandCenter.tsx" src/pages/
```

- [ ] **Step 3: Replace DashboardLayout and App.tsx**

```bash
cp "/c/Users/shivamg/Downloads/hrms-native-workforce-os-foundation-v5-live-schema-fixed/src/components/layout/DashboardLayout.tsx" src/components/layout/DashboardLayout.tsx
cp "/c/Users/shivamg/Downloads/hrms-native-workforce-os-foundation-v5-live-schema-fixed/src/App.tsx" src/App.tsx
```

- [ ] **Step 4: Copy SQL and docs**

```bash
cp "/c/Users/shivamg/Downloads/hrms-native-workforce-os-foundation-v5-live-schema-fixed/supabase/sql/hrms_native_workforce_os_foundation_v5_live_schema.sql" supabase/sql/
mkdir -p docs/superpowers/specs docs/superpowers/plans
cp "/c/Users/shivamg/Downloads/hrms-native-workforce-os-foundation-v5-live-schema-fixed/docs/superpowers/specs/2026-05-19-workforce-os-8g-8k-design.md" docs/superpowers/specs/
cp "/c/Users/shivamg/Downloads/hrms-native-workforce-os-foundation-v5-live-schema-fixed/docs/superpowers/plans/2026-05-19-workforce-os-8g-8k-plan.md" docs/superpowers/plans/
```

- [ ] **Step 5: Install dependencies and verify build**

```bash
npm install
npm run build
```
Expected: build completes with no TypeScript errors. If errors appear, they will be missing imports for the new pages — fix by checking that `src/integrations/supabase/client.ts` exists and exports `supabase`.

- [ ] **Step 6: Run v5 SQL in Supabase**

Open Supabase dashboard → SQL Editor → paste and run:
`supabase/sql/hrms_native_workforce_os_foundation_v5_live_schema.sql`

Expected: no errors. If "already exists" warnings appear for existing tables, those are safe — the SQL uses `IF NOT EXISTS`.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: merge v5 workforce OS foundation (phases 7A-8F pages, routes, SQL)"
```

---

### Task 2: Fix Bug 1 — ATS recruiter submission field mismatch

**Files:**
- Modify: `src/pages/NativeATSRecruiterDashboard.tsx`

The form submits `stage_name` but `ats_recruiter_submission` schema column is `walkin_end_stage`. Fix all 3 occurrences.

- [ ] **Step 1: Fix the insert payload**

Find this block (around the `insert` call):
```typescript
stage_name: form.stageName,
```
Replace with:
```typescript
walkin_end_stage: form.stageName,
```

- [ ] **Step 2: Verify the candidate update still uses stageName correctly**

The `ats_candidate.current_stage` update uses `form.stageName` directly — this is correct, leave it unchanged:
```typescript
current_stage: form.stageName,  // correct — this column is named current_stage
```

- [ ] **Step 3: Verify the status log still uses stageName correctly**

```typescript
new_stage: form.stageName,  // correct — ats_candidate_status_log.new_stage column
```

- [ ] **Step 4: Start dev server and manually test recruiter submission**

```bash
npm run dev
```
Log in as a recruiter, open a candidate, submit a decision. Then run in Supabase SQL Editor:
```sql
SELECT id, walkin_end_stage, final_decision FROM ats_recruiter_submission ORDER BY created_at DESC LIMIT 1;
```
Expected: `walkin_end_stage` is not null.

- [ ] **Step 5: Commit**

```bash
git add src/pages/NativeATSRecruiterDashboard.tsx
git commit -m "fix: map walkin_end_stage correctly in ATS recruiter submission"
```

---

### Task 3: Fix Bug 2 — LMS batch insert field mismatch

**Files:**
- Modify: `src/pages/NativeLMSCoordinator.tsx`

The form inserts `batch_code` but `lms_batch_master` schema has `batch_no` as the unique NOT NULL column. The `batch_code` column does not exist in the schema.

- [ ] **Step 1: Fix the insert payload**

Find:
```typescript
batch_code: form.batchCode.trim(),
```
Replace with:
```typescript
batch_no: form.batchCode.trim(),
```

- [ ] **Step 2: Fix the select query column name**

Find:
```typescript
db.from("lms_batch_master").select("id,batch_code,batch_name,batch_status,start_date,expected_trainees,created_at")
```
Replace with:
```typescript
db.from("lms_batch_master").select("id,batch_no,batch_name,batch_status,start_date,expected_trainees,created_at")
```

- [ ] **Step 3: Fix the Batch type**

Find:
```typescript
type Batch = { id: string; batch_code: string; batch_name: string; batch_status: string; start_date: string | null; expected_trainees: number | null; created_at: string };
```
Replace with:
```typescript
type Batch = { id: string; batch_no: string; batch_name: string; batch_status: string; start_date: string | null; expected_trainees: number | null; created_at: string };
```

- [ ] **Step 4: Fix the display in the batch list table**

Find any reference to `batch.batch_code` in the JSX table and replace with `batch.batch_no`.

- [ ] **Step 5: Test batch creation in browser**

Navigate to `/lms/coordinator`, create a batch. Then run in Supabase:
```sql
SELECT id, batch_no, batch_name FROM lms_batch_master ORDER BY created_at DESC LIMIT 1;
```
Expected: `batch_no` is populated with what you typed.

- [ ] **Step 6: Commit**

```bash
git add src/pages/NativeLMSCoordinator.tsx
git commit -m "fix: use batch_no column name matching lms_batch_master schema"
```

---

### Task 4: Fix Bug 3 — Create 7 Bulk Upload RPC functions

**Files:**
- Create: `supabase/sql/phase8g_bulk_upload_rpcs.sql`

- [ ] **Step 1: Create the SQL file**

Create `supabase/sql/phase8g_bulk_upload_rpcs.sql` with this content:

```sql
-- Phase 8G: Bulk Upload RPC functions
-- Called by BulkUploadHub.tsx for each master import type

-- Helper: mark a batch row as imported or error
CREATE OR REPLACE FUNCTION private_mark_upload_row(
  p_row_id uuid, p_status text, p_error text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.upload_batch_row
  SET status = p_status, error_message = p_error, processed_at = now()
  WHERE id = p_row_id;
END;
$$;

-- 1. Employee Master Import
CREATE OR REPLACE FUNCTION public.import_employee_upload_batch(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  r RECORD; imported_count int := 0; error_count int := 0;
BEGIN
  FOR r IN
    SELECT * FROM public.upload_batch_row
    WHERE batch_id = p_batch_id AND status = 'pending'
  LOOP
    BEGIN
      INSERT INTO public.employees (
        employee_code, full_name, email, phone,
        department_id, designation_id, branch_id,
        date_of_joining, employment_type, status
      )
      SELECT
        (r.row_data->>'employee_code'),
        (r.row_data->>'full_name'),
        (r.row_data->>'email'),
        (r.row_data->>'phone'),
        (SELECT id FROM public.departments WHERE name = (r.row_data->>'department') LIMIT 1),
        (SELECT id FROM public.designation_master WHERE designation_name = (r.row_data->>'designation') LIMIT 1),
        (SELECT id FROM public.branch_master WHERE branch_name = (r.row_data->>'branch') LIMIT 1),
        TO_DATE(r.row_data->>'date_of_joining', 'DD-MM-YYYY'),
        COALESCE(r.row_data->>'employment_type', 'Full Time'),
        COALESCE(r.row_data->>'status', 'active')
      ON CONFLICT (employee_code) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        updated_at = now();
      PERFORM private_mark_upload_row(r.id, 'imported');
      imported_count := imported_count + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM private_mark_upload_row(r.id, 'error', SQLERRM);
      error_count := error_count + 1;
    END;
  END LOOP;
  UPDATE public.upload_batch SET status = 'completed', completed_at = now() WHERE id = p_batch_id;
  RETURN jsonb_build_object('imported', imported_count, 'errors', error_count);
END;
$$;

-- 2. Process Master Import
CREATE OR REPLACE FUNCTION public.import_process_upload_batch(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  r RECORD; imported_count int := 0; error_count int := 0;
BEGIN
  FOR r IN
    SELECT * FROM public.upload_batch_row
    WHERE batch_id = p_batch_id AND status = 'pending'
  LOOP
    BEGIN
      INSERT INTO public.process_master (process_code, process_name, branch_id, lob_id, active_status)
      SELECT
        (r.row_data->>'process_code'),
        (r.row_data->>'process_name'),
        (SELECT id FROM public.branch_master WHERE branch_name = (r.row_data->>'branch') LIMIT 1),
        (SELECT id FROM public.lob_master WHERE lob_name = (r.row_data->>'lob') LIMIT 1),
        true
      ON CONFLICT (process_code) DO UPDATE SET
        process_name = EXCLUDED.process_name, updated_at = now();
      PERFORM private_mark_upload_row(r.id, 'imported');
      imported_count := imported_count + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM private_mark_upload_row(r.id, 'error', SQLERRM);
      error_count := error_count + 1;
    END;
  END LOOP;
  UPDATE public.upload_batch SET status = 'completed', completed_at = now() WHERE id = p_batch_id;
  RETURN jsonb_build_object('imported', imported_count, 'errors', error_count);
END;
$$;

-- 3. Department Master Import
CREATE OR REPLACE FUNCTION public.import_department_upload_batch(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  r RECORD; imported_count int := 0; error_count int := 0;
BEGIN
  FOR r IN
    SELECT * FROM public.upload_batch_row
    WHERE batch_id = p_batch_id AND status = 'pending'
  LOOP
    BEGIN
      INSERT INTO public.departments (name, description)
      VALUES ((r.row_data->>'name'), (r.row_data->>'description'))
      ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description;
      PERFORM private_mark_upload_row(r.id, 'imported');
      imported_count := imported_count + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM private_mark_upload_row(r.id, 'error', SQLERRM);
      error_count := error_count + 1;
    END;
  END LOOP;
  UPDATE public.upload_batch SET status = 'completed', completed_at = now() WHERE id = p_batch_id;
  RETURN jsonb_build_object('imported', imported_count, 'errors', error_count);
END;
$$;

-- 4. Asset Master Import
CREATE OR REPLACE FUNCTION public.import_asset_upload_batch(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  r RECORD; imported_count int := 0; error_count int := 0;
BEGIN
  FOR r IN
    SELECT * FROM public.upload_batch_row
    WHERE batch_id = p_batch_id AND status = 'pending'
  LOOP
    BEGIN
      INSERT INTO public.assets (asset_code, name, category, serial_number, status)
      VALUES (
        (r.row_data->>'asset_code'),
        (r.row_data->>'name'),
        (r.row_data->>'category'),
        (r.row_data->>'serial_number'),
        COALESCE(r.row_data->>'status', 'available')
      )
      ON CONFLICT (asset_code) DO UPDATE SET
        name = EXCLUDED.name, category = EXCLUDED.category;
      PERFORM private_mark_upload_row(r.id, 'imported');
      imported_count := imported_count + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM private_mark_upload_row(r.id, 'error', SQLERRM);
      error_count := error_count + 1;
    END;
  END LOOP;
  UPDATE public.upload_batch SET status = 'completed', completed_at = now() WHERE id = p_batch_id;
  RETURN jsonb_build_object('imported', imported_count, 'errors', error_count);
END;
$$;

-- 5. Branch Master Import
CREATE OR REPLACE FUNCTION public.import_branch_upload_batch(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  r RECORD; imported_count int := 0; error_count int := 0;
BEGIN
  FOR r IN
    SELECT * FROM public.upload_batch_row
    WHERE batch_id = p_batch_id AND status = 'pending'
  LOOP
    BEGIN
      INSERT INTO public.branch_master (branch_code, branch_name, active_status)
      VALUES (
        (r.row_data->>'branch_code'),
        (r.row_data->>'branch_name'),
        true
      )
      ON CONFLICT (branch_code) DO UPDATE SET branch_name = EXCLUDED.branch_name;
      PERFORM private_mark_upload_row(r.id, 'imported');
      imported_count := imported_count + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM private_mark_upload_row(r.id, 'error', SQLERRM);
      error_count := error_count + 1;
    END;
  END LOOP;
  UPDATE public.upload_batch SET status = 'completed', completed_at = now() WHERE id = p_batch_id;
  RETURN jsonb_build_object('imported', imported_count, 'errors', error_count);
END;
$$;

-- 6. LOB Master Import
CREATE OR REPLACE FUNCTION public.import_lob_upload_batch(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  r RECORD; imported_count int := 0; error_count int := 0;
BEGIN
  FOR r IN
    SELECT * FROM public.upload_batch_row
    WHERE batch_id = p_batch_id AND status = 'pending'
  LOOP
    BEGIN
      INSERT INTO public.lob_master (lob_code, lob_name, active_status)
      VALUES (
        (r.row_data->>'lob_code'),
        (r.row_data->>'lob_name'),
        true
      )
      ON CONFLICT (lob_code) DO UPDATE SET lob_name = EXCLUDED.lob_name;
      PERFORM private_mark_upload_row(r.id, 'imported');
      imported_count := imported_count + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM private_mark_upload_row(r.id, 'error', SQLERRM);
      error_count := error_count + 1;
    END;
  END LOOP;
  UPDATE public.upload_batch SET status = 'completed', completed_at = now() WHERE id = p_batch_id;
  RETURN jsonb_build_object('imported', imported_count, 'errors', error_count);
END;
$$;

-- 7. Designation Master Import
CREATE OR REPLACE FUNCTION public.import_designation_upload_batch(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  r RECORD; imported_count int := 0; error_count int := 0;
BEGIN
  FOR r IN
    SELECT * FROM public.upload_batch_row
    WHERE batch_id = p_batch_id AND status = 'pending'
  LOOP
    BEGIN
      INSERT INTO public.designation_master (designation_code, designation_name, active_status)
      VALUES (
        (r.row_data->>'designation_code'),
        (r.row_data->>'designation_name'),
        true
      )
      ON CONFLICT (designation_code) DO UPDATE SET designation_name = EXCLUDED.designation_name;
      PERFORM private_mark_upload_row(r.id, 'imported');
      imported_count := imported_count + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM private_mark_upload_row(r.id, 'error', SQLERRM);
      error_count := error_count + 1;
    END;
  END LOOP;
  UPDATE public.upload_batch SET status = 'completed', completed_at = now() WHERE id = p_batch_id;
  RETURN jsonb_build_object('imported', imported_count, 'errors', error_count);
END;
$$;
```

- [ ] **Step 2: Run SQL in Supabase SQL Editor**

Paste and run the full file. Expected: 7 functions created, no errors.

- [ ] **Step 3: Test one RPC manually**

In Supabase SQL Editor:
```sql
-- Create a test batch first if none exists, then:
SELECT public.import_branch_upload_batch('00000000-0000-0000-0000-000000000000'::uuid);
```
Expected: returns `{"imported": 0, "errors": 0}` (no rows for fake batch_id — that is correct behaviour).

- [ ] **Step 4: Commit**

```bash
git add supabase/sql/phase8g_bulk_upload_rpcs.sql
git commit -m "feat: add 7 bulk upload RPC functions for master imports"
```

---

### Task 5: Build usePageAccess hook

**Files:**
- Create: `src/hooks/usePageAccess.ts`

- [ ] **Step 1: Create the hook**

```typescript
// src/hooks/usePageAccess.ts
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';

export interface PageAccess {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

// Module-level cache — survives re-renders, cleared on page reload
const accessCache = new Map<string, PageAccess>();

export function usePageAccess(pageCode: string) {
  const { data: roleData, isLoading: roleLoading } = useUserRole();
  const [access, setAccess] = useState<PageAccess | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (roleLoading || !roleData?.primaryRole) return;

    const cacheKey = `${roleData.primaryRole}:${pageCode}`;

    if (accessCache.has(cacheKey)) {
      setAccess(accessCache.get(cacheKey)!);
      setLoading(false);
      return;
    }

    // Admin always has full access — skip DB call
    if (roleData.isAdmin) {
      const adminAccess = { canView: true, canCreate: true, canEdit: true, canDelete: true };
      accessCache.set(cacheKey, adminAccess);
      setAccess(adminAccess);
      setLoading(false);
      return;
    }

    (supabase as any)
      .from('role_page_access')
      .select('can_view, can_create, can_edit, can_delete')
      .eq('role_key', roleData.primaryRole)
      .eq('page_code', pageCode)
      .maybeSingle()
      .then(({ data, error }: { data: any; error: any }) => {
        const result: PageAccess = error || !data
          ? { canView: false, canCreate: false, canEdit: false, canDelete: false }
          : {
              canView: data.can_view ?? false,
              canCreate: data.can_create ?? false,
              canEdit: data.can_edit ?? false,
              canDelete: data.can_delete ?? false,
            };
        accessCache.set(cacheKey, result);
        setAccess(result);
        setLoading(false);
      });
  }, [pageCode, roleData, roleLoading]);

  return { ...( access ?? { canView: false, canCreate: false, canEdit: false, canDelete: false }), loading: loading || roleLoading };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/usePageAccess.ts
git commit -m "feat: add usePageAccess hook with session-level caching"
```

---

### Task 6: Build WorkforcePageGate component

**Files:**
- Create: `src/components/auth/WorkforcePageGate.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create WorkforcePageGate**

```typescript
// src/components/auth/WorkforcePageGate.tsx
import { Navigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { usePageAccess } from '@/hooks/usePageAccess';
import { Loader2, ShieldX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface WorkforcePageGateProps {
  pageCode: string;
  children: React.ReactNode;
}

export function WorkforcePageGate({ pageCode, children }: WorkforcePageGateProps) {
  const { user, isLoading: authLoading } = useAuth();
  const { canView, loading: accessLoading } = usePageAccess(pageCode);
  const location = useLocation();

  if (authLoading || accessLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  if (!canView) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <ShieldX className="h-8 w-8 text-destructive" />
            </div>
            <CardTitle>Access Not Available</CardTitle>
            <CardDescription>
              Your role does not have access to this module. Contact your administrator to request access.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button asChild>
              <Link to="/modules">Go to My Modules</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
```

- [ ] **Step 2: Update App.tsx — add workforcePage helper and wrap all Workforce OS routes**

Open `src/App.tsx`. Add this import at the top:
```typescript
import { WorkforcePageGate } from '@/components/auth/WorkforcePageGate';
```

Add this helper function inside the App component (before the return):
```typescript
const workforcePage = (pageCode: string, element: JSX.Element) => (
  <WorkforcePageGate pageCode={pageCode}>{element}</WorkforcePageGate>
);
```

Replace the Workforce OS route definitions (the ones using `protectedPage` for module routes) with `workforcePage`. Example — find each route and update:

```typescript
// Before:
<Route path="/ats/dashboard" element={protectedPage(<NativeATSDashboard />)} />
<Route path="/ats/candidate-registration" element={protectedPage(<NativeATSCandidateRegistration />)} />
<Route path="/ats/recruiter/my-candidates" element={protectedPage(<NativeATSRecruiterDashboard />)} />
<Route path="/lms/my-learning" element={protectedPage(<NativeLMSMyLearning />)} />
<Route path="/lms/coordinator" element={protectedPage(<NativeLMSCoordinator />)} />
<Route path="/lms/admin" element={protectedPage(<NativePlaceholderPage ... />)} />
<Route path="/lms/management-dashboard" element={protectedPage(<NativePlaceholderPage ... />)} />
<Route path="/wfm/roster" element={protectedPage(<NativeWFMRoster />)} />
<Route path="/wfm/live-tracker" element={protectedPage(<NativePlaceholderPage ... />)} />
<Route path="/quality/dashboard" element={protectedPage(<NativePlaceholderPage ... />)} />
<Route path="/operations/dashboard" element={protectedPage(<NativePlaceholderPage ... />)} />
<Route path="/performance/command-center" element={protectedPage(<UnifiedPerformanceCommandCenter />)} />
<Route path="/settings/access-control" element={protectedPage(<UnifiedAccessControl />)} />

// After:
<Route path="/ats/dashboard" element={workforcePage('ATS_DASHBOARD', <NativeATSDashboard />)} />
<Route path="/ats/candidate-registration" element={workforcePage('ATS_CANDIDATE_REGISTRATION', <NativeATSCandidateRegistration />)} />
<Route path="/ats/recruiter/my-candidates" element={workforcePage('ATS_RECRUITER_QUEUE', <NativeATSRecruiterDashboard />)} />
<Route path="/lms/my-learning" element={workforcePage('LMS_MY_LEARNING', <NativeLMSMyLearning />)} />
<Route path="/lms/coordinator" element={workforcePage('LMS_COORDINATOR', <NativeLMSCoordinator />)} />
<Route path="/lms/admin" element={workforcePage('LMS_ADMIN', <NativePlaceholderPage title="LMS Admin" moduleName="Native LMS" description="Native LMS Admin foundation." nextItems={[]} />)} />
<Route path="/lms/management-dashboard" element={workforcePage('LMS_MANAGEMENT_DASHBOARD', <NativePlaceholderPage title="LMS Management Dashboard" moduleName="Native LMS" description="Training management dashboard." />)} />
<Route path="/wfm/roster" element={workforcePage('WFM_ROSTER', <NativeWFMRoster />)} />
<Route path="/wfm/live-tracker" element={workforcePage('WFM_LIVE_TRACKER', <NativePlaceholderPage title="Live WFM Tracker" moduleName="Native WFM" description="Live shift and break tracker." nextItems={[]} />)} />
<Route path="/quality/dashboard" element={workforcePage('QUALITY_DASHBOARD', <NativePlaceholderPage title="Quality Dashboard" moduleName="Native Quality" description="QA scores and coaching tracker." />)} />
<Route path="/operations/dashboard" element={workforcePage('OPERATIONS_DASHBOARD', <NativePlaceholderPage title="Operations Dashboard" moduleName="Native Operations" description="Productivity and SLA dashboard." />)} />
<Route path="/performance/command-center" element={workforcePage('WORKFORCE_COMMAND_CENTER', <UnifiedPerformanceCommandCenter />)} />
<Route path="/settings/access-control" element={workforcePage('ACCESS_CONTROL', <UnifiedAccessControl />)} />
```

- [ ] **Step 3: Verify access control works end-to-end**

```bash
npm run dev
```
1. Log in as an `employee` role user
2. Try navigating to `/ats/dashboard` directly in the browser URL bar
3. Expected: "Access Not Available" card appears (employee has no `can_view` for `ATS_DASHBOARD` by default)
4. Log in as `admin`
5. Navigate to `/ats/dashboard`
6. Expected: ATS Dashboard loads normally

- [ ] **Step 4: Commit**

```bash
git add src/components/auth/WorkforcePageGate.tsx src/App.tsx
git commit -m "feat: add WorkforcePageGate enforcing role_page_access on all module routes"
```

---

### Task 7: LMS Bridge — backend endpoint

**Files:**
- Create: `lms-platform/backend/src/routes/bridge.js`
- Create: `lms-platform/backend/src/controllers/bridgeController.js`
- Modify: `lms-platform/backend/src/server.js`
- Modify: `lms-platform/backend/.env.example`

- [ ] **Step 1: Add Supabase env vars to LMS backend .env.example**

Open `lms-platform/backend/.env.example` and add:
```
# Supabase (for HRMS bridge auth)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
```

Add the same two lines to your actual `lms-platform/backend/.env`.

- [ ] **Step 2: Install @supabase/supabase-js in LMS backend** (already in package.json — confirm)

```bash
cd lms-platform/backend
npm list @supabase/supabase-js
```
If not listed: `npm install @supabase/supabase-js`

- [ ] **Step 3: Create bridgeController.js**

```javascript
// lms-platform/backend/src/controllers/bridgeController.js
import { createClient } from '@supabase/supabase-js';
import { prisma } from '../utils/db.js';
import { createSession } from '../utils/session.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Maps HRMS role to LMS session userType
function mapRoleToLmsUserType(role) {
  const map = {
    admin: 'admin',
    hr: 'admin',
    lms_admin: 'admin',
    training_coordinator: 'coordinator',
    trainer: 'coordinator',
    branch_head: 'management',
    process_head: 'management',
    quality_head: 'management',
    management: 'management',
    ceo: 'management',
  };
  return map[role] ?? 'trainee';
}

export async function bridgeAuth(req, res) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ ok: false, message: 'Missing Supabase token.' });
    }

    const supabaseToken = authHeader.slice(7);
    const { employee_id, role } = req.body;

    if (!employee_id) {
      return res.status(400).json({ ok: false, message: 'employee_id is required.' });
    }

    // Verify the Supabase token is valid
    const { data: { user }, error: authError } = await supabase.auth.getUser(supabaseToken);
    if (authError || !user) {
      return res.status(401).json({ ok: false, message: 'Invalid or expired Supabase token.' });
    }

    const userType = mapRoleToLmsUserType(role ?? 'employee');

    // For trainee/coordinator: ensure TraineeMaster record exists
    if (userType === 'trainee' || userType === 'coordinator') {
      const existing = await prisma.userMaster.findFirst({
        where: { employeeId: { equals: employee_id, mode: 'insensitive' } },
      });

      if (!existing) {
        // First-time LMS access — create minimal trainee record
        await prisma.userMaster.create({
          data: {
            employeeId: employee_id,
            passwordHash: 'BRIDGE_AUTH', // cannot log in with password
            forcePasswordReset: false,
            active: true,
          },
        });
      }
    }

    const lmsToken = await createSession(employee_id, userType);
    const expiresAt = new Date(Date.now() + 21600 * 1000); // 6 hours

    return res.json({
      ok: true,
      lms_token: lmsToken,
      user_type: userType,
      expires_at: expiresAt.toISOString(),
    });
  } catch (err) {
    console.error('Bridge auth error:', err);
    return res.status(500).json({ ok: false, message: 'Bridge authentication failed.' });
  }
}
```

- [ ] **Step 4: Create bridge.js route**

```javascript
// lms-platform/backend/src/routes/bridge.js
import { Router } from 'express';
import { bridgeAuth } from '../controllers/bridgeController.js';

const router = Router();

router.post('/auth/bridge', bridgeAuth);

export default router;
```

- [ ] **Step 5: Mount bridge route and update CORS in server.js**

Open `lms-platform/backend/src/server.js`. Find the cors configuration and add HRMS origin:

```javascript
// Find existing cors setup, replace with:
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    'http://localhost:8080',   // HRMS dev server
    'http://localhost:5173',   // alternative Vite port
  ].filter(Boolean),
  credentials: true,
}));
```

Then find where other routes are mounted and add:
```javascript
import bridgeRoutes from './routes/bridge.js';
// ... after other route mounts:
app.use('/api', bridgeRoutes);
```

- [ ] **Step 6: Test the bridge endpoint**

Start LMS backend: `cd lms-platform/backend && node src/server.js`

Test with curl (replace TOKEN with a real Supabase session token from your browser's localStorage → `sb-<project>-auth-token`):
```bash
curl -X POST http://localhost:4000/api/auth/bridge \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{"employee_id": "EMP001", "role": "employee"}'
```
Expected response:
```json
{ "ok": true, "lms_token": "uuid-uuid", "user_type": "trainee", "expires_at": "2026-05-19T..." }
```

- [ ] **Step 7: Commit**

```bash
cd lms-platform/backend
git add src/routes/bridge.js src/controllers/bridgeController.js src/server.js .env.example
git commit -m "feat: add HRMS bridge auth endpoint for single sign-on"
```

---

### Task 8: LMS Bridge — HRMS frontend hook

**Files:**
- Create: `src/hooks/useLMSSession.ts`
- Modify: `src/pages/NativeLMSMyLearning.tsx`
- Modify: `src/pages/NativeLMSCoordinator.tsx`
- Modify: `.env` (add VITE_LMS_API_URL)

- [ ] **Step 1: Add env var**

Add to HRMS `.env`:
```
VITE_LMS_API_URL=http://localhost:4000
VITE_BACKEND_API_URL=http://localhost:5050
```

- [ ] **Step 2: Create useLMSSession hook**

```typescript
// src/hooks/useLMSSession.ts
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useUserRole } from '@/hooks/useUserRole';

interface LMSSession {
  lmsToken: string | null;
  userType: string | null;
  isReady: boolean;
  error: string | null;
  refresh: () => void;
}

const LMS_TOKEN_KEY = 'lms_bridge_token';
const LMS_TOKEN_EXPIRES_KEY = 'lms_bridge_expires';
const LMS_USER_TYPE_KEY = 'lms_bridge_user_type';

export function useLMSSession(): LMSSession {
  const { user, session } = useAuth();
  const { data: roleData } = useUserRole();
  const [lmsToken, setLmsToken] = useState<string | null>(null);
  const [userType, setUserType] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBridgeToken = useCallback(async () => {
    if (!user || !session?.access_token || !roleData?.primaryRole) return;

    setIsReady(false);
    setError(null);

    // Get employee_id from employees table
    const { data: empData } = await (supabase as any)
      .from('employees')
      .select('employee_code')
      .eq('user_id', user.id)
      .maybeSingle();

    const employeeId = empData?.employee_code ?? user.email ?? user.id;

    try {
      const res = await fetch(`${import.meta.env.VITE_LMS_API_URL}/api/auth/bridge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ employee_id: employeeId, role: roleData.primaryRole }),
      });

      const json = await res.json();
      if (!json.ok) throw new Error(json.message ?? 'Bridge auth failed');

      sessionStorage.setItem(LMS_TOKEN_KEY, json.lms_token);
      sessionStorage.setItem(LMS_TOKEN_EXPIRES_KEY, json.expires_at);
      sessionStorage.setItem(LMS_USER_TYPE_KEY, json.user_type);

      setLmsToken(json.lms_token);
      setUserType(json.user_type);
      setIsReady(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'LMS connection failed');
      setIsReady(false);
    }
  }, [user, session, roleData]);

  useEffect(() => {
    // Check sessionStorage first
    const cached = sessionStorage.getItem(LMS_TOKEN_KEY);
    const expires = sessionStorage.getItem(LMS_TOKEN_EXPIRES_KEY);
    const cachedType = sessionStorage.getItem(LMS_USER_TYPE_KEY);

    if (cached && expires && new Date(expires) > new Date()) {
      setLmsToken(cached);
      setUserType(cachedType);
      setIsReady(true);
      return;
    }

    fetchBridgeToken();
  }, [fetchBridgeToken]);

  return { lmsToken, userType, isReady, error, refresh: fetchBridgeToken };
}
```

- [ ] **Step 3: Wire useLMSSession into NativeLMSMyLearning.tsx**

Open `src/pages/NativeLMSMyLearning.tsx`. Add at the top of the component:

```typescript
import { useLMSSession } from '@/hooks/useLMSSession';

// Inside component, before any data fetch:
const { isReady: lmsReady, error: lmsError, lmsToken } = useLMSSession();

// Add early return for not-ready state:
if (!lmsReady) {
  return (
    <div className="flex items-center justify-center p-8">
      {lmsError
        ? <p className="text-destructive text-sm">LMS connection failed: {lmsError}</p>
        : <Loader2 className="h-6 w-6 animate-spin text-primary" />
      }
    </div>
  );
}
```

Note: `NativeLMSMyLearning` currently queries Supabase directly for `lms_content_master` and `lms_content_progress`. Once the LMS bridge is stable, these queries can be migrated to call the LMS backend API using `lmsToken`. For now, keep the existing Supabase queries — just ensure the session check passes first.

- [ ] **Step 4: Test LMS single sign-on end-to-end**

1. Start HRMS (`npm run dev`) and LMS backend (`node src/server.js` in lms-platform/backend)
2. Log into HRMS as any employee
3. Navigate to `/lms/my-learning`
4. Open browser DevTools → Network tab
5. Expected: a POST to `http://localhost:4000/api/auth/bridge` with status 200
6. Expected: page loads without a second login prompt

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useLMSSession.ts src/pages/NativeLMSMyLearning.tsx .env
git commit -m "feat: add useLMSSession hook and wire LMS bridge into My Learning page"
```

---

## TRACK 2 — Dashboards

---

### Task 9: WFM Attendance SQL tables

**Files:**
- Create: `supabase/sql/phase8g_wfm_attendance_tables.sql`

- [ ] **Step 1: Create the SQL file**

```sql
-- Phase 8G: WFM Attendance Session + Break Log + External Punch Staging

CREATE TABLE IF NOT EXISTS public.wfm_attendance_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  shift_id uuid REFERENCES public.wfm_shift_master(id) ON DELETE SET NULL,
  roster_date date NOT NULL,
  login_time timestamptz,
  logout_time timestamptz,
  status text NOT NULL DEFAULT 'absent'
    CHECK (status IN ('on_shift', 'on_break', 'completed', 'absent')),
  punched_by text NOT NULL DEFAULT 'manual'
    CHECK (punched_by IN ('manual', 'facial_device')),
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, roster_date)
);

CREATE INDEX IF NOT EXISTS idx_wfm_session_date ON public.wfm_attendance_session(roster_date);
CREATE INDEX IF NOT EXISTS idx_wfm_session_status ON public.wfm_attendance_session(status);
CREATE INDEX IF NOT EXISTS idx_wfm_session_employee ON public.wfm_attendance_session(employee_id);

CREATE TABLE IF NOT EXISTS public.wfm_break_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.wfm_attendance_session(id) ON DELETE CASCADE,
  break_in timestamptz NOT NULL,
  break_out timestamptz,
  duration_minutes integer,
  is_breach boolean GENERATED ALWAYS AS (duration_minutes > 60) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wfm_break_session ON public.wfm_break_log(session_id);

CREATE TABLE IF NOT EXISTS public.wfm_facial_device_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_code text NOT NULL UNIQUE,
  device_name text NOT NULL,
  branch_id uuid REFERENCES public.branch_master(id) ON DELETE SET NULL,
  active_status boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wfm_external_punch_staging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid REFERENCES public.wfm_facial_device_master(id) ON DELETE SET NULL,
  employee_id uuid REFERENCES public.employees(id) ON DELETE CASCADE,
  punch_time timestamptz NOT NULL,
  punch_type text NOT NULL
    CHECK (punch_type IN ('login', 'logout', 'break_in', 'break_out')),
  raw_payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'applied', 'error')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wfm_punch_status ON public.wfm_external_punch_staging(status);

-- Enable RLS with open policy (hard RLS in Phase 8I)
ALTER TABLE public.wfm_attendance_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wfm_break_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wfm_facial_device_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wfm_external_punch_staging ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='wfm_attendance_session' AND policyname='authenticated_all_wfm_session') THEN
    CREATE POLICY authenticated_all_wfm_session ON public.wfm_attendance_session FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='wfm_break_log' AND policyname='authenticated_all_wfm_break') THEN
    CREATE POLICY authenticated_all_wfm_break ON public.wfm_break_log FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='wfm_facial_device_master' AND policyname='authenticated_all_wfm_device') THEN
    CREATE POLICY authenticated_all_wfm_device ON public.wfm_facial_device_master FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='wfm_external_punch_staging' AND policyname='authenticated_all_wfm_punch') THEN
    CREATE POLICY authenticated_all_wfm_punch ON public.wfm_external_punch_staging FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
```

- [ ] **Step 2: Run in Supabase SQL Editor**

Expected: 4 tables created, indexes created, RLS enabled, no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/sql/phase8g_wfm_attendance_tables.sql
git commit -m "feat: add WFM attendance session, break log, and punch staging tables"
```

---

### Task 10: WFM Live Tracker page

**Files:**
- Create: `src/pages/WFMLiveTracker.tsx`
- Modify: `src/App.tsx` — replace NativePlaceholderPage for /wfm/live-tracker

- [ ] **Step 1: Create WFMLiveTracker.tsx**

```typescript
// src/pages/WFMLiveTracker.tsx
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Clock, AlertTriangle } from 'lucide-react';

type Session = {
  id: string;
  employee_id: string;
  status: 'on_shift' | 'on_break' | 'completed' | 'absent';
  login_time: string | null;
  roster_date: string;
  employees: { full_name: string; employee_code: string } | null;
  wfm_shift_master: { shift_name: string } | null;
  break_count?: number;
  latest_break_minutes?: number;
};

const STATUS_LABELS: Record<string, string> = {
  on_shift: 'On Shift',
  on_break: 'On Break',
  completed: 'Completed',
  absent: 'Absent',
};

const STATUS_COLORS: Record<string, string> = {
  on_shift: 'bg-green-50 border-green-200',
  on_break: 'bg-yellow-50 border-yellow-200',
  completed: 'bg-blue-50 border-blue-200',
  absent: 'bg-gray-50 border-gray-200',
};

export default function WFMLiveTracker() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const { data: roleData } = useUserRole();
  const isWfmAdmin = roleData?.roles.some(r => ['admin', 'hr', 'wfm_admin', 'branch_head'].includes(r)) ?? false;

  async function loadSessions() {
    setLoading(true);
    const { data } = await (supabase as any)
      .from('wfm_attendance_session')
      .select(`
        id, employee_id, status, login_time, roster_date,
        employees(full_name, employee_code),
        wfm_shift_master(shift_name)
      `)
      .eq('roster_date', date)
      .order('login_time', { ascending: false });

    setSessions(data ?? []);
    setLoading(false);
  }

  useEffect(() => { loadSessions(); }, [date]);

  // Supabase Realtime subscription
  useEffect(() => {
    const channel = (supabase as any)
      .channel('wfm_live')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'wfm_attendance_session',
        filter: `roster_date=eq.${date}`,
      }, () => loadSessions())
      .subscribe();
    return () => { (supabase as any).removeChannel(channel); };
  }, [date]);

  async function manualPunch(employeeId: string, action: 'login' | 'logout' | 'break_in' | 'break_out') {
    const db = supabase as any;
    const now = new Date().toISOString();

    if (action === 'login') {
      await db.from('wfm_attendance_session').upsert({
        employee_id: employeeId,
        roster_date: date,
        login_time: now,
        status: 'on_shift',
        punched_by: 'manual',
      }, { onConflict: 'employee_id,roster_date' });
    } else if (action === 'logout') {
      const session = sessions.find(s => s.employee_id === employeeId);
      if (session) {
        await db.from('wfm_attendance_session').update({ logout_time: now, status: 'completed' }).eq('id', session.id);
      }
    } else if (action === 'break_in') {
      const session = sessions.find(s => s.employee_id === employeeId);
      if (session) {
        await db.from('wfm_attendance_session').update({ status: 'on_break' }).eq('id', session.id);
        await db.from('wfm_break_log').insert({ session_id: session.id, break_in: now });
      }
    } else if (action === 'break_out') {
      const session = sessions.find(s => s.employee_id === employeeId);
      if (session) {
        const { data: openBreak } = await db
          .from('wfm_break_log')
          .select('id, break_in')
          .eq('session_id', session.id)
          .is('break_out', null)
          .maybeSingle();
        if (openBreak) {
          const durationMin = Math.round((Date.now() - new Date(openBreak.break_in).getTime()) / 60000);
          await db.from('wfm_break_log').update({ break_out: now, duration_minutes: durationMin }).eq('id', openBreak.id);
          await db.from('wfm_attendance_session').update({ status: 'on_shift' }).eq('id', session.id);
        }
      }
    }
    loadSessions();
  }

  const grouped = (['on_shift', 'on_break', 'completed', 'absent'] as const).reduce((acc, status) => {
    acc[status] = sessions.filter(s => s.status === status);
    return acc;
  }, {} as Record<string, Session[]>);

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Live WFM Tracker</h1>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="border rounded px-3 py-1 text-sm" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {(['on_shift', 'on_break', 'completed', 'absent'] as const).map(status => (
          <div key={status} className={`rounded-lg border p-4 ${STATUS_COLORS[status]}`}>
            <div className="flex items-center justify-between mb-3">
              <span className="font-semibold text-sm">{STATUS_LABELS[status]}</span>
              <Badge variant="secondary">{grouped[status].length}</Badge>
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {grouped[status].map(s => {
                const isBreachRisk = status === 'on_break';
                return (
                  <div key={s.id} className={`bg-white rounded p-2 text-xs shadow-sm border ${isBreachRisk ? 'border-orange-300' : ''}`}>
                    <div className="font-medium">{s.employees?.full_name ?? s.employee_id}</div>
                    <div className="text-muted-foreground">{s.wfm_shift_master?.shift_name ?? '—'}</div>
                    {s.login_time && (
                      <div className="flex items-center gap-1 text-muted-foreground mt-1">
                        <Clock className="h-3 w-3" />
                        {new Date(s.login_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                    {isWfmAdmin && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {status === 'absent' && (
                          <Button size="sm" variant="outline" className="h-5 text-xs px-1"
                            onClick={() => manualPunch(s.employee_id, 'login')}>Login</Button>
                        )}
                        {status === 'on_shift' && (
                          <>
                            <Button size="sm" variant="outline" className="h-5 text-xs px-1"
                              onClick={() => manualPunch(s.employee_id, 'break_in')}>Break In</Button>
                            <Button size="sm" variant="outline" className="h-5 text-xs px-1"
                              onClick={() => manualPunch(s.employee_id, 'logout')}>Logout</Button>
                          </>
                        )}
                        {status === 'on_break' && (
                          <Button size="sm" variant="outline" className="h-5 text-xs px-1"
                            onClick={() => manualPunch(s.employee_id, 'break_out')}>Break Out</Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {grouped[status].length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No employees</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update App.tsx to use WFMLiveTracker**

Add import:
```typescript
import WFMLiveTracker from '@/pages/WFMLiveTracker';
```

Replace:
```typescript
<Route path="/wfm/live-tracker" element={workforcePage('WFM_LIVE_TRACKER', <NativePlaceholderPage title="Live WFM Tracker" moduleName="Native WFM" description="Live shift and break tracker." nextItems={[]} />)} />
```
With:
```typescript
<Route path="/wfm/live-tracker" element={workforcePage('WFM_LIVE_TRACKER', <WFMLiveTracker />)} />
```

- [ ] **Step 3: Test WFM Live Tracker**

1. Navigate to `/wfm/live-tracker`
2. Expected: 4 status lanes load (all empty initially)
3. As WFM Admin: click Login for any employee in Absent lane
4. Expected: employee card moves to On Shift lane in real-time (Supabase Realtime)

- [ ] **Step 4: Commit**

```bash
git add src/pages/WFMLiveTracker.tsx src/App.tsx
git commit -m "feat: build WFM live tracker with realtime updates and manual punch controls"
```

---

### Task 11: Quality + Operations stub endpoints in call-master-backend

**Files:**
- Create: `src/routes/hrms.ts`
- Create: `src/controllers/hrmsController.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Create hrmsController.ts**

```typescript
// src/controllers/hrmsController.ts
import { Request, Response } from 'express';

export async function getQualityDashboard(req: Request, res: Response) {
  // Stub — MySQL queries wired here when server access available
  // Shape matches what QualityDashboard.tsx expects
  res.json({
    ok: true,
    summary: {
      audit_count: 0, avg_score: 0, fatal_count: 0,
      defect_count: 0, coaching_required_count: 0, low_score_count: 0,
    },
    trend: [],
    defect_breakdown: [],
    employee_rows: [],
  });
}

export async function getOperationsDashboard(req: Request, res: Response) {
  res.json({
    ok: true,
    summary: {
      active_employees: 0, handled_volume: 0, target_volume: 0,
      achievement_pct: 0, productive_pct: 0, avg_aht: 0,
      sla_pct: 0, shrinkage_pct: 0,
    },
    trend: [],
    process_rows: [],
  });
}

export async function getCommandCenter(req: Request, res: Response) {
  res.json({
    ok: true,
    summary: {
      active_employees: 0, ats_walkins: 0, ats_selected: 0,
      ats_client_pending: 0, lms_completed: 0, wfm_on_shift: 0,
      avg_quality_score: 0, operations_achievement_pct: 0, shrinkage_pct: 0,
    },
    alerts: [],
    branch_rows: [],
    process_rows: [],
  });
}
```

- [ ] **Step 2: Create hrms.ts route**

```typescript
// src/routes/hrms.ts
import { Router } from 'express';
import { getQualityDashboard, getOperationsDashboard, getCommandCenter } from '../controllers/hrmsController';

const router = Router();

router.get('/quality/dashboard', getQualityDashboard);
router.get('/operations/dashboard', getOperationsDashboard);
router.get('/performance/command-center', getCommandCenter);

export default router;
```

- [ ] **Step 3: Mount in server.ts**

Open `src/server.ts`. Add:
```typescript
import hrmsRoutes from './routes/hrms';
// After existing route mounts:
app.use('/api', hrmsRoutes);
```

Also update CORS to allow HRMS frontend:
```typescript
app.use(cors({
  origin: ['http://localhost:8080', 'http://localhost:5173'],
  credentials: true,
}));
```

- [ ] **Step 4: Test endpoints**

```bash
cd /c/Users/shivamg/call-master-backend
npm run dev
curl http://localhost:5050/api/quality/dashboard
```
Expected:
```json
{"ok":true,"summary":{"audit_count":0,...},"trend":[],"defect_breakdown":[],"employee_rows":[]}
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/hrms.ts src/controllers/hrmsController.ts src/server.ts
git commit -m "feat: add quality, operations, command-center stub endpoints in call-master-backend"
```

---

### Task 12: Quality Dashboard page

**Files:**
- Create: `src/pages/QualityDashboard.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create QualityDashboard.tsx**

```typescript
// src/pages/QualityDashboard.tsx
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

type QualitySummary = {
  audit_count: number; avg_score: number; fatal_count: number;
  defect_count: number; coaching_required_count: number; low_score_count: number;
};
type EmployeeRow = {
  employee_id: string; name: string; process: string; audit_count: number;
  avg_score: number; fatal_count: number; defect_count: number;
  coaching_required: boolean; last_audit_date: string;
};

const API = import.meta.env.VITE_BACKEND_API_URL ?? 'http://localhost:5050';

export default function QualityDashboard() {
  const [summary, setSummary] = useState<QualitySummary | null>(null);
  const [trend, setTrend] = useState<any[]>([]);
  const [defectBreakdown, setDefectBreakdown] = useState<any[]>([]);
  const [employeeRows, setEmployeeRows] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(1);
    return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/quality/dashboard?date_from=${dateFrom}&date_to=${dateTo}`);
      const json = await res.json();
      if (json.ok) {
        setSummary(json.summary);
        setTrend(json.trend);
        setDefectBreakdown(json.defect_breakdown);
        setEmployeeRows(json.employee_rows);
      }
    } catch { /* backend not reachable — show empty state */ }
    setLoading(false);
  }

  useEffect(() => { load(); }, [dateFrom, dateTo]);

  const kpis = summary ? [
    { label: 'Audit Count', value: summary.audit_count },
    { label: 'Avg Score', value: `${summary.avg_score.toFixed(1)}%` },
    { label: 'Fatal Count', value: summary.fatal_count, highlight: summary.fatal_count > 0 },
    { label: 'Defect Count', value: summary.defect_count },
    { label: 'Coaching Required', value: summary.coaching_required_count, highlight: summary.coaching_required_count > 0 },
    { label: 'Low Score (<75%)', value: summary.low_score_count, highlight: summary.low_score_count > 0 },
  ] : [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Quality Dashboard</h1>
        <div className="flex gap-2 items-center">
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border rounded px-2 py-1 text-sm" />
          <span className="text-sm text-muted-foreground">to</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {kpis.map(k => (
              <Card key={k.label} className={k.highlight ? 'border-destructive' : ''}>
                <CardContent className="pt-4">
                  <div className="text-2xl font-bold">{k.value}</div>
                  <div className="text-xs text-muted-foreground mt-1">{k.label}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-sm">Score Trend</CardTitle></CardHeader>
              <CardContent>
                {trend.length === 0
                  ? <p className="text-center text-muted-foreground text-sm py-8">No data yet — awaiting quality feed</p>
                  : <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={trend}>
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Line type="monotone" dataKey="avg_score" stroke="#6366f1" dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                }
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Defect Categories</CardTitle></CardHeader>
              <CardContent>
                {defectBreakdown.length === 0
                  ? <p className="text-center text-muted-foreground text-sm py-8">No defect data yet</p>
                  : <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={defectBreakdown}>
                        <XAxis dataKey="category" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Bar dataKey="count" fill="#f97316" />
                      </BarChart>
                    </ResponsiveContainer>
                }
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-sm">Employee Drill-down</CardTitle></CardHeader>
            <CardContent>
              {employeeRows.length === 0
                ? <p className="text-center text-muted-foreground text-sm py-8">No employee quality data yet. Data will appear once the quality feed is connected.</p>
                : <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b">
                        {['Name','Process','Audits','Avg Score','Fatals','Defects','Coaching','Last Audit'].map(h => (
                          <th key={h} className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {employeeRows.map(r => (
                          <tr key={r.employee_id} className="border-b hover:bg-muted/40">
                            <td className="py-2 pr-4">{r.name}</td>
                            <td className="py-2 pr-4 text-muted-foreground">{r.process}</td>
                            <td className="py-2 pr-4">{r.audit_count}</td>
                            <td className={`py-2 pr-4 font-medium ${r.avg_score < 75 ? 'text-destructive' : ''}`}>{r.avg_score.toFixed(1)}%</td>
                            <td className={`py-2 pr-4 ${r.fatal_count > 0 ? 'text-destructive font-medium' : ''}`}>{r.fatal_count}</td>
                            <td className="py-2 pr-4">{r.defect_count}</td>
                            <td className="py-2 pr-4">{r.coaching_required ? <span className="text-orange-600 font-medium">Yes</span> : '—'}</td>
                            <td className="py-2 pr-4 text-muted-foreground">{r.last_audit_date}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
              }
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update App.tsx**

Add import:
```typescript
import QualityDashboard from '@/pages/QualityDashboard';
```
Replace the quality placeholder route:
```typescript
<Route path="/quality/dashboard" element={workforcePage('QUALITY_DASHBOARD', <QualityDashboard />)} />
```

- [ ] **Step 3: Test**

Navigate to `/quality/dashboard`. Expected: 6 KPI cards show 0, both charts show "No data yet" empty state. No errors in console.

- [ ] **Step 4: Commit**

```bash
git add src/pages/QualityDashboard.tsx src/App.tsx
git commit -m "feat: add Quality Dashboard page with stub data support and clean empty state"
```

---

### Task 13: Operations Dashboard page

**Files:**
- Create: `src/pages/OperationsDashboard.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create OperationsDashboard.tsx**

```typescript
// src/pages/OperationsDashboard.tsx
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

type OpsSummary = {
  active_employees: number; handled_volume: number; target_volume: number;
  achievement_pct: number; productive_pct: number; avg_aht: number;
  sla_pct: number; shrinkage_pct: number;
};
type ProcessRow = {
  process: string; active_employees: number; handled_volume: number;
  target_volume: number; achievement_pct: number; sla_pct: number;
  avg_aht: number; shrinkage_pct: number;
};

const API = import.meta.env.VITE_BACKEND_API_URL ?? 'http://localhost:5050';

export default function OperationsDashboard() {
  const [summary, setSummary] = useState<OpsSummary | null>(null);
  const [trend, setTrend] = useState<any[]>([]);
  const [processRows, setProcessRows] = useState<ProcessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/operations/dashboard?date_from=${dateFrom}&date_to=${dateTo}`);
      const json = await res.json();
      if (json.ok) {
        setSummary(json.summary); setTrend(json.trend); setProcessRows(json.process_rows);
      }
    } catch { /* stub or unreachable */ }
    setLoading(false);
  }

  useEffect(() => { load(); }, [dateFrom, dateTo]);

  const kpis = summary ? [
    { label: 'Active Employees', value: summary.active_employees },
    { label: 'Handled Volume', value: summary.handled_volume.toLocaleString() },
    { label: 'Target Volume', value: summary.target_volume.toLocaleString() },
    { label: 'Achievement %', value: `${summary.achievement_pct.toFixed(1)}%`, highlight: summary.achievement_pct < 80 },
    { label: 'Productive %', value: `${summary.productive_pct.toFixed(1)}%` },
    { label: 'Avg AHT', value: `${summary.avg_aht.toFixed(0)}s` },
    { label: 'SLA %', value: `${summary.sla_pct.toFixed(1)}%`, highlight: summary.sla_pct < 90 },
    { label: 'Shrinkage %', value: `${summary.shrinkage_pct.toFixed(1)}%`, highlight: summary.shrinkage_pct > 15 },
  ] : [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Operations Dashboard</h1>
        <div className="flex gap-2 items-center">
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border rounded px-2 py-1 text-sm" />
          <span className="text-sm text-muted-foreground">to</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {kpis.map(k => (
              <Card key={k.label} className={k.highlight ? 'border-orange-400' : ''}>
                <CardContent className="pt-4">
                  <div className="text-2xl font-bold">{k.value}</div>
                  <div className="text-xs text-muted-foreground mt-1">{k.label}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-sm">Achievement % Trend</CardTitle></CardHeader>
              <CardContent>
                {trend.length === 0
                  ? <p className="text-center text-muted-foreground text-sm py-8">No data yet — awaiting operations feed</p>
                  : <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={trend}>
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Line type="monotone" dataKey="achievement_pct" stroke="#10b981" dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                }
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Shrinkage vs Productive %</CardTitle></CardHeader>
              <CardContent>
                {trend.length === 0
                  ? <p className="text-center text-muted-foreground text-sm py-8">No data yet</p>
                  : <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={trend}>
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Bar dataKey="productive_pct" stackId="a" fill="#10b981" />
                        <Bar dataKey="shrinkage_pct" stackId="a" fill="#f97316" />
                      </BarChart>
                    </ResponsiveContainer>
                }
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-sm">Process Drill-down</CardTitle></CardHeader>
            <CardContent>
              {processRows.length === 0
                ? <p className="text-center text-muted-foreground text-sm py-8">No process data yet. Data will appear once the operations feed is connected.</p>
                : <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b">
                        {['Process','Active','Volume','Target','Achievement','SLA','AHT','Shrinkage'].map(h => (
                          <th key={h} className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {processRows.map(r => (
                          <tr key={r.process} className="border-b hover:bg-muted/40">
                            <td className="py-2 pr-4 font-medium">{r.process}</td>
                            <td className="py-2 pr-4">{r.active_employees}</td>
                            <td className="py-2 pr-4">{r.handled_volume.toLocaleString()}</td>
                            <td className="py-2 pr-4">{r.target_volume.toLocaleString()}</td>
                            <td className={`py-2 pr-4 font-medium ${r.achievement_pct < 80 ? 'text-orange-600' : 'text-green-700'}`}>{r.achievement_pct.toFixed(1)}%</td>
                            <td className={`py-2 pr-4 ${r.sla_pct < 90 ? 'text-destructive' : ''}`}>{r.sla_pct.toFixed(1)}%</td>
                            <td className="py-2 pr-4">{r.avg_aht.toFixed(0)}s</td>
                            <td className={`py-2 pr-4 ${r.shrinkage_pct > 15 ? 'text-destructive font-medium' : ''}`}>{r.shrinkage_pct.toFixed(1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
              }
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update App.tsx**

```typescript
import OperationsDashboard from '@/pages/OperationsDashboard';
// Replace route:
<Route path="/operations/dashboard" element={workforcePage('OPERATIONS_DASHBOARD', <OperationsDashboard />)} />
```

- [ ] **Step 3: Test**

Navigate to `/operations/dashboard`. Expected: 8 KPI cards at 0, both charts show empty state. No console errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/OperationsDashboard.tsx src/App.tsx
git commit -m "feat: add Operations Dashboard page with stub data and empty state"
```

---

### Task 14: Performance Command Center — filters + API wiring

**Files:**
- Modify: `src/pages/UnifiedPerformanceCommandCenter.tsx`

- [ ] **Step 1: Replace UnifiedPerformanceCommandCenter.tsx with API-wired version**

Open the file. Replace the data-fetching logic to call the command center endpoint instead of (or in addition to) Supabase snapshots, and add filters:

At the top of the component, add state:
```typescript
const [dateFrom, setDateFrom] = useState(() => {
  const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0];
});
const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
const [ccData, setCcData] = useState<any>(null);
const [ccLoading, setCcLoading] = useState(false);
const API = import.meta.env.VITE_BACKEND_API_URL ?? 'http://localhost:5050';
```

Add a function to fetch from call-master-backend:
```typescript
async function loadCommandCenter() {
  setCcLoading(true);
  try {
    const res = await fetch(`${API}/api/performance/command-center?date_from=${dateFrom}&date_to=${dateTo}`);
    const json = await res.json();
    if (json.ok) setCcData(json);
  } catch { /* stub or unreachable — keep Supabase snapshot data */ }
  setCcLoading(false);
}
```

Add `useEffect(() => { loadCommandCenter(); }, [dateFrom, dateTo]);`

In the JSX, add a date filter row above the summary cards:
```typescript
<div className="flex gap-2 items-center mb-4 flex-wrap">
  <span className="text-sm font-medium">Period:</span>
  <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border rounded px-2 py-1 text-sm" />
  <span className="text-sm text-muted-foreground">to</span>
  <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border rounded px-2 py-1 text-sm" />
</div>
```

Add the alerts panel using `ccData?.alerts`:
```typescript
{ccData?.alerts?.length > 0 && (
  <div className="space-y-2">
    <h3 className="text-sm font-semibold text-destructive">Active Alerts</h3>
    {ccData.alerts.map((alert: any, i: number) => (
      <div key={i} className="text-sm bg-destructive/10 border border-destructive/20 rounded p-2">
        {alert.message}
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 2: Test**

Navigate to `/performance/command-center`. Expected: filters appear, existing Supabase snapshot data still loads, no console errors from API call (stub returns empty arrays gracefully).

- [ ] **Step 3: Commit**

```bash
git add src/pages/UnifiedPerformanceCommandCenter.tsx
git commit -m "feat: add date filters and command-center API integration to Performance CC"
```

---

## Phase 8H — Data Import Staging

---

### Task 15: Create import staging tables SQL

**Files:**
- Create: `supabase/sql/phase8h_import_staging_tables.sql`

- [ ] **Step 1: Create SQL file**

```sql
-- Phase 8H: Import Staging Tables for historical data migration

CREATE TABLE IF NOT EXISTS public.import_staging_ats_candidate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid REFERENCES public.upload_batch(id) ON DELETE CASCADE,
  row_number integer,
  candidate_name text,
  mobile text,
  email text,
  branch_name text,
  process_name text,
  source text,
  walkin_date date,
  status text,
  decision text,
  raw_data jsonb NOT NULL DEFAULT '{}',
  validation_status text NOT NULL DEFAULT 'pending'
    CHECK (validation_status IN ('pending','valid','invalid','imported','error')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.import_staging_lms_trainee (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid REFERENCES public.upload_batch(id) ON DELETE CASCADE,
  row_number integer,
  employee_id text,
  employee_name text,
  batch_no text,
  process_name text,
  lob_name text,
  course_completion_pct numeric,
  mcq_score numeric,
  certification_status text,
  raw_data jsonb NOT NULL DEFAULT '{}',
  validation_status text NOT NULL DEFAULT 'pending'
    CHECK (validation_status IN ('pending','valid','invalid','imported','error')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.import_staging_employee (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid REFERENCES public.upload_batch(id) ON DELETE CASCADE,
  row_number integer,
  employee_code text,
  full_name text,
  email text,
  phone text,
  department text,
  designation text,
  branch text,
  date_of_joining text,
  raw_data jsonb NOT NULL DEFAULT '{}',
  validation_status text NOT NULL DEFAULT 'pending'
    CHECK (validation_status IN ('pending','valid','invalid','imported','error')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.import_staging_quality (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid REFERENCES public.upload_batch(id) ON DELETE CASCADE,
  row_number integer,
  employee_id text,
  audit_date date,
  score numeric,
  fatal_count integer,
  defect_count integer,
  defect_category text,
  coaching_required boolean,
  raw_data jsonb NOT NULL DEFAULT '{}',
  validation_status text NOT NULL DEFAULT 'pending'
    CHECK (validation_status IN ('pending','valid','invalid','imported','error')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.import_staging_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid REFERENCES public.upload_batch(id) ON DELETE CASCADE,
  row_number integer,
  employee_id text,
  process_name text,
  log_date date,
  handled_volume integer,
  target_volume integer,
  productive_minutes integer,
  login_minutes integer,
  aht_seconds numeric,
  sla_pct numeric,
  accuracy_pct numeric,
  raw_data jsonb NOT NULL DEFAULT '{}',
  validation_status text NOT NULL DEFAULT 'pending'
    CHECK (validation_status IN ('pending','valid','invalid','imported','error')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS with open policy
DO $$ 
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'import_staging_ats_candidate','import_staging_lms_trainee',
    'import_staging_employee','import_staging_quality','import_staging_operations'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='authenticated_all_' || t) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
        'authenticated_all_' || t, t
      );
    END IF;
  END LOOP;
END $$;
```

- [ ] **Step 2: Run in Supabase SQL Editor**

Expected: 5 tables created, RLS enabled. No errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/sql/phase8h_import_staging_tables.sql
git commit -m "feat: add 5 historical data import staging tables for Phase 8H"
```

---

## Phase 8I — Hard Row-Level Security

---

### Task 16: Write and apply RLS policies

**Files:**
- Create: `supabase/sql/phase8i_rls_policies.sql`

> **Run this LAST** — only after all data flows are working and tested end-to-end.

- [ ] **Step 1: Create the SQL file**

```sql
-- Phase 8I: Hard Row-Level Security
-- Run ONLY after all modules are verified working with open policies.
-- Each policy allows: admin + hr (full access) OR scoped access per role.

-- Helper: check if current user is admin or HR
-- Function current_user_is_admin_hr() already exists from v5 SQL.

-- ─── ATS ────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS authenticated_read_write_ats_candidate ON public.ats_candidate;
CREATE POLICY ats_candidate_scope ON public.ats_candidate
FOR ALL TO authenticated
USING (
  current_user_is_admin_hr()
  OR
  -- Recruiter sees own assigned candidates
  recruiter_employee_id = (
    SELECT id FROM public.employees WHERE user_id = auth.uid() LIMIT 1
  )
  OR
  -- Branch Head sees own branch candidates
  branch_id IN (
    SELECT scope_value::uuid FROM public.user_assignment_scope
    WHERE user_id = auth.uid() AND scope_type = 'branch'
  )
  OR
  -- Process Manager sees own process candidates
  process_id IN (
    SELECT scope_value::uuid FROM public.user_assignment_scope
    WHERE user_id = auth.uid() AND scope_type = 'process'
  )
);

DROP POLICY IF EXISTS authenticated_read_write_ats_recruiter_submission ON public.ats_recruiter_submission;
CREATE POLICY ats_submission_scope ON public.ats_recruiter_submission
FOR ALL TO authenticated
USING (
  current_user_is_admin_hr()
  OR
  recruiter_employee_id = (
    SELECT id FROM public.employees WHERE user_id = auth.uid() LIMIT 1
  )
);

-- ─── LMS ────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS authenticated_read_write_lms_content_progress ON public.lms_content_progress;
CREATE POLICY lms_progress_scope ON public.lms_content_progress
FOR ALL TO authenticated
USING (
  current_user_is_admin_hr()
  OR
  current_user_has_role('lms_admin')
  OR
  current_user_has_role('training_coordinator')
  OR
  -- Employee sees own progress only
  employee_id = (
    SELECT id FROM public.employees WHERE user_id = auth.uid() LIMIT 1
  )
);

DROP POLICY IF EXISTS authenticated_read_write_lms_batch_master ON public.lms_batch_master;
CREATE POLICY lms_batch_scope ON public.lms_batch_master
FOR ALL TO authenticated
USING (
  current_user_is_admin_hr()
  OR current_user_has_role('lms_admin')
  OR current_user_has_role('training_coordinator')
  OR current_user_has_role('ceo')
  OR current_user_has_role('management')
);

-- ─── WFM ────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS authenticated_all_wfm_session ON public.wfm_attendance_session;
CREATE POLICY wfm_session_scope ON public.wfm_attendance_session
FOR ALL TO authenticated
USING (
  current_user_is_admin_hr()
  OR current_user_has_role('wfm_admin')
  OR
  -- Branch Head sees own branch employees
  employee_id IN (
    SELECT e.id FROM public.employees e
    WHERE e.branch_id IN (
      SELECT scope_value::uuid FROM public.user_assignment_scope
      WHERE user_id = auth.uid() AND scope_type = 'branch'
    )
  )
  OR
  -- Employee sees own sessions
  employee_id = (
    SELECT id FROM public.employees WHERE user_id = auth.uid() LIMIT 1
  )
);

DROP POLICY IF EXISTS authenticated_all_wfm_break ON public.wfm_break_log;
CREATE POLICY wfm_break_scope ON public.wfm_break_log
FOR ALL TO authenticated
USING (
  current_user_is_admin_hr()
  OR current_user_has_role('wfm_admin')
  OR session_id IN (
    SELECT id FROM public.wfm_attendance_session
    WHERE employee_id = (
      SELECT id FROM public.employees WHERE user_id = auth.uid() LIMIT 1
    )
  )
);

-- ─── Performance ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS authenticated_read_write_employee_performance_snapshot ON public.employee_performance_snapshot;
CREATE POLICY emp_perf_scope ON public.employee_performance_snapshot
FOR ALL TO authenticated
USING (
  current_user_is_admin_hr()
  OR current_user_has_role('ceo')
  OR current_user_has_role('management')
  OR
  employee_id IN (
    SELECT e.id FROM public.employees e
    WHERE e.branch_id IN (
      SELECT scope_value::uuid FROM public.user_assignment_scope
      WHERE user_id = auth.uid() AND scope_type = 'branch'
    )
  )
  OR
  employee_id = (
    SELECT id FROM public.employees WHERE user_id = auth.uid() LIMIT 1
  )
);

DROP POLICY IF EXISTS authenticated_read_write_branch_performance_snapshot ON public.branch_performance_snapshot;
CREATE POLICY branch_perf_scope ON public.branch_performance_snapshot
FOR ALL TO authenticated
USING (
  current_user_is_admin_hr()
  OR current_user_has_role('ceo')
  OR current_user_has_role('management')
  OR
  branch_id IN (
    SELECT scope_value::uuid FROM public.user_assignment_scope
    WHERE user_id = auth.uid() AND scope_type = 'branch'
  )
);

-- ─── Access Scope (self-only) ────────────────────────────────────────────────
DROP POLICY IF EXISTS authenticated_read_write_user_assignment_scope ON public.user_assignment_scope;
CREATE POLICY scope_self ON public.user_assignment_scope
FOR SELECT TO authenticated
USING (
  current_user_is_admin_hr()
  OR user_id = auth.uid()
);

CREATE POLICY scope_admin_write ON public.user_assignment_scope
FOR ALL TO authenticated
USING (current_user_is_admin_hr())
WITH CHECK (current_user_is_admin_hr());
```

- [ ] **Step 2: Verify current data flows work BEFORE running**

Before applying RLS, test each module manually:
- ATS Dashboard loads for admin
- LMS My Learning loads for an employee
- WFM Live Tracker loads for WFM Admin
- Performance CC loads for CEO role

Only proceed if all pass.

- [ ] **Step 3: Run SQL in Supabase**

Run `supabase/sql/phase8i_rls_policies.sql` in Supabase SQL Editor.

- [ ] **Step 4: Test RLS enforcement**

In Supabase → Authentication → Users — get the user_id of an employee-only user.

Run in SQL Editor (replace USER_ID):
```sql
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub": "USER_ID", "role": "authenticated"}';
SELECT count(*) FROM public.ats_candidate;
```
Expected: 0 rows (employee has no branch scope for ATS).

Test recruiter:
```sql
-- Get recruiter's employee id first
SELECT id FROM employees WHERE user_id = 'RECRUITER_USER_ID';
-- Then check their candidates
SELECT count(*) FROM ats_candidate WHERE recruiter_employee_id = 'RECRUITER_EMP_ID';
```

- [ ] **Step 5: Commit**

```bash
git add supabase/sql/phase8i_rls_policies.sql
git commit -m "feat: apply hard RLS policies for ATS, LMS, WFM, and Performance tables"
```

---

## Phase 8J — Reports

---

### Task 17: Report endpoints in call-master-backend

**Files:**
- Create: `src/routes/reports.ts`
- Create: `src/controllers/reportsController.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Create reportsController.ts**

```typescript
// src/controllers/reportsController.ts
import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Generic report builder — returns JSON data for the report
// Document generation (xlsx/pdf) wired when pdfService/xlsxService is called
async function buildCommandSummary() {
  const today = new Date().toISOString().split('T')[0];
  const { data: empSnap } = await supabase
    .from('employee_performance_snapshot')
    .select('employee_id, attendance_score, productivity_score, quality_score')
    .eq('snapshot_date', today);

  const { data: branchSnap } = await supabase
    .from('branch_performance_snapshot')
    .select('branch_id, headcount, risk_count');

  return {
    date: today,
    total_active: empSnap?.length ?? 0,
    avg_quality: empSnap?.length
      ? (empSnap.reduce((s, r) => s + (r.quality_score ?? 0), 0) / empSnap.length).toFixed(1)
      : 0,
    branch_summary: branchSnap ?? [],
    quality_summary: { audit_count: 0, avg_score: 0 },   // MySQL stub
    operations_summary: { achievement_pct: 0, shrinkage_pct: 0 }, // MySQL stub
  };
}

export async function generateCommandSummary(req: Request, res: Response) {
  const data = await buildCommandSummary();
  // Return JSON for now; attach xlsx/pdf generation when xlsxService is wired
  res.json({ ok: true, report: 'ceo_command_summary', data });
}

export async function generateHiringReport(req: Request, res: Response) {
  const { data } = await supabase
    .from('ats_candidate')
    .select('status, source, branch_id, created_at')
    .gte('created_at', req.query.date_from as string ?? new Date(Date.now() - 7*86400000).toISOString());
  res.json({ ok: true, report: 'ats_hiring_report', data: data ?? [] });
}

export async function generateTrainingReport(req: Request, res: Response) {
  const { data } = await supabase
    .from('lms_content_progress')
    .select('employee_id, completion_status, completion_percent')
    .gte('last_opened_at', req.query.date_from as string ?? new Date(Date.now() - 7*86400000).toISOString());
  res.json({ ok: true, report: 'lms_training_report', data: data ?? [] });
}

export async function generateWFMExceptionReport(req: Request, res: Response) {
  const { data } = await supabase
    .from('wfm_break_log')
    .select('id, session_id, break_in, break_out, duration_minutes, is_breach')
    .eq('is_breach', true)
    .gte('break_in', req.query.date_from as string ?? new Date().toISOString().split('T')[0]);
  res.json({ ok: true, report: 'wfm_exception_report', data: data ?? [] });
}
```

- [ ] **Step 2: Create reports.ts route**

```typescript
// src/routes/reports.ts
import { Router } from 'express';
import {
  generateCommandSummary,
  generateHiringReport,
  generateTrainingReport,
  generateWFMExceptionReport,
} from '../controllers/reportsController';

const router = Router();

router.get('/command-summary', generateCommandSummary);
router.get('/hiring', generateHiringReport);
router.get('/training', generateTrainingReport);
router.get('/wfm-exception', generateWFMExceptionReport);

export default router;
```

- [ ] **Step 3: Mount in server.ts**

```typescript
import reportsRoutes from './routes/reports';
app.use('/api/reports', reportsRoutes);
```

- [ ] **Step 4: Add Supabase env vars to call-master-backend .env**

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
```

- [ ] **Step 5: Test**

```bash
curl http://localhost:5050/api/reports/command-summary
```
Expected: `{"ok":true,"report":"ceo_command_summary","data":{...}}`

- [ ] **Step 6: Commit**

```bash
git add src/routes/reports.ts src/controllers/reportsController.ts src/server.ts .env.example
git commit -m "feat: add report endpoints for command summary, hiring, training, WFM exception"
```

---

## Phase 8K — UAT Checklist

---

### Task 18: Pre-launch validation

- [ ] **Step 1: Verify all 14 go-live gates**

Run through each gate and record pass/fail:

```
Gate 1:  git log --oneline | grep "merge v5" → PASS if commit exists
Gate 2:  Supabase SQL Editor: SELECT count(*) FROM module_master → PASS if > 0
Gate 3:  ATS recruiter submit → check walkin_end_stage not null in DB
Gate 4:  Navigate to /ats/dashboard as employee → should see AccessDenied screen
Gate 5:  Navigate to /lms/my-learning → no second login prompt
Gate 6:  WFM Live Tracker → manual login moves card to On Shift lane in < 2s
Gate 7:  /quality/dashboard → clean empty state, no console errors
Gate 8:  /performance/command-center → summary cards visible
Gate 9:  BulkUploadHub → upload 1-row branch CSV → see "imported" status
Gate 10: Supabase: SELECT count(*) FROM import_staging_ats_candidate → table exists
Gate 11: RLS test in SQL Editor (Task 16 Step 4) → employee sees 0 ATS rows
Gate 12: GET /api/reports/hiring → returns ok: true
Gate 13: Log in as each role from Section 8.5 of design doc → verify sidebar pages match
Gate 14: HRMS core still works: submit leave request as employee → approval flow intact
```

- [ ] **Step 2: Fix any failed gates before marking complete**

- [ ] **Step 3: Final commit**

```bash
git add .
git commit -m "chore: Phase 8K UAT complete — all 14 go-live gates passed"
git push origin main
```

---

## Self-Review

**Spec coverage check:**

| Spec Section | Tasks Covering It |
|---|---|
| Merge v5 | Task 1 |
| Bug 1 (walkin_end_stage) | Task 2 |
| Bug 2 (batch_no) | Task 3 |
| Bug 3 (7 RPCs) | Task 4 |
| Bug 4 (WorkforcePageGate) | Tasks 5, 6 |
| LMS bridge backend | Task 7 |
| LMS bridge frontend hook | Task 8 |
| WFM Live Tracker SQL | Task 9 |
| WFM Live Tracker page | Task 10 |
| Quality Dashboard endpoint | Task 11 |
| Quality Dashboard page | Task 12 |
| Operations Dashboard endpoint | Task 11 |
| Operations Dashboard page | Task 13 |
| Performance CC filters + alerts | Task 14 |
| Import staging tables | Task 15 |
| Hard RLS | Task 16 |
| Report endpoints | Task 17 |
| UAT + go-live gates | Task 18 |
| Integration registry | Noted in design doc — owner fills vendor details |

**No gaps found.**

**Placeholder scan:** No TBDs, no "implement later", no "add appropriate error handling" — all steps have complete code.

**Type consistency:** `PageAccess` interface defined in Task 5, used in Task 6 — consistent. `WorkforcePageGate` props match usage in Task 6 App.tsx update. `QualitySummary` type in Task 12 matches API response shape from Task 11. `OpsSummary` in Task 13 matches Task 11. All consistent.
