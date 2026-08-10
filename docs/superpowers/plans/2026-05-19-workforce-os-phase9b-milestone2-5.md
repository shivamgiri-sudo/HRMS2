# Phase 9B — Milestones 2–5: Dialer, Leave, Salary, iSpark, Access Control, Roster, KPI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build all remaining Workforce OS milestone deliverables: iSpark employee migration staging, Dialer integration, native Leave management, native Salary prep, full Role Access Manager UI, employee Roster assignment, Salary Automation, and KPI Dashboard.

**Architecture:** All new pages follow the Native style pattern (DashboardLayout wrapper, white rounded-2xl cards, slate-950 headings). SQL goes in `supabase/sql/phase9x_*.sql`. Security constraint: credential fields use `secret_name` (Supabase Vault reference), NOT plain values. Migration data goes through staging tables with validation before production insert.

**Tech Stack:** Supabase PostgreSQL + RLS, React 18 + TypeScript + Vite, TanStack Query, `call-master-backend` MySQL stubs for performance data.

**PREREQUISITE:** Plan 9A (tenant_module_config + route fixes) must be complete before starting this plan.

---

## File Map

| File | Action |
|---|---|
| `supabase/sql/phase9b_ispark_migration_schema.sql` | Create |
| `supabase/sql/phase9c_dialer_integration.sql` | Create |
| `supabase/sql/phase9d_leave_management_native.sql` | Create |
| `supabase/sql/phase9e_salary_prep.sql` | Create |
| `supabase/sql/phase9f_kpi_snapshot.sql` | Create |
| `src/pages/NativeISParkMigration.tsx` | Create |
| `src/pages/NativeDialerIntegration.tsx` | Create |
| `src/pages/NativeSalaryValidation.tsx` | Create |
| `src/pages/NativeLeaveManagement.tsx` | Create |
| `src/pages/NativeSalaryPrep.tsx` | Create |
| `src/pages/NativeRoleAccessManager.tsx` | Create |
| `src/pages/NativeWFMRosterAssignment.tsx` | Create |
| `src/pages/NativeSalaryAutomation.tsx` | Create |
| `src/pages/NativeKPIDashboard.tsx` | Create |
| `src/App.tsx` | Modify (add 8 new routes) |
| `src/components/layout/DashboardLayout.tsx` | Modify (add new nav items) |

---

### Task 1: iSpark Migration Staging SQL

iSpark is the existing HR system. All employee data must be staged and validated before going to production tables (security constraint).

**Files:**
- Create: `supabase/sql/phase9b_ispark_migration_schema.sql`

- [ ] **Step 1: Write the SQL**

```sql
-- phase9b_ispark_migration_schema.sql
-- iSpark → HRMS employee data migration staging
-- RULE: All data enters staging tables first, validated, then promoted to production.

CREATE TABLE IF NOT EXISTS ispark_employee_staging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_ref text NOT NULL,
  raw_json jsonb NOT NULL,
  -- mapped fields (nullable until validated)
  emp_code text,
  first_name text,
  last_name text,
  email text,
  mobile text,
  department_name text,
  designation_name text,
  branch_name text,
  process_name text,
  doj date,
  -- validation
  validation_status text NOT NULL DEFAULT 'pending' CHECK (validation_status IN ('pending','valid','invalid','promoted')),
  validation_errors jsonb,
  promoted_employee_id uuid REFERENCES employees(id),
  promoted_at timestamptz,
  -- audit
  uploaded_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ispark_migration_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_ref text NOT NULL UNIQUE,
  source_file text,
  total_rows int NOT NULL DEFAULT 0,
  valid_rows int NOT NULL DEFAULT 0,
  invalid_rows int NOT NULL DEFAULT 0,
  promoted_rows int NOT NULL DEFAULT 0,
  batch_status text NOT NULL DEFAULT 'uploaded' CHECK (batch_status IN ('uploaded','validating','validated','promoting','promoted','failed')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ispark_employee_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE ispark_migration_batch ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ispark_staging_admin_all" ON ispark_employee_staging FOR ALL TO authenticated
  USING (is_admin_or_hr(auth.uid())) WITH CHECK (is_admin_or_hr(auth.uid()));
CREATE POLICY "ispark_batch_admin_all" ON ispark_migration_batch FOR ALL TO authenticated
  USING (is_admin_or_hr(auth.uid())) WITH CHECK (is_admin_or_hr(auth.uid()));

-- RPC: validate a batch (sets valid/invalid per row)
CREATE OR REPLACE FUNCTION validate_ispark_batch(p_batch_ref text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_valid int := 0;
  v_invalid int := 0;
  r RECORD;
  v_errors jsonb;
BEGIN
  IF NOT is_admin_or_hr(auth.uid()) THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  FOR r IN SELECT id, emp_code, first_name, email FROM ispark_employee_staging
           WHERE batch_ref = p_batch_ref AND validation_status = 'pending'
  LOOP
    v_errors := '[]'::jsonb;
    IF r.emp_code IS NULL OR r.emp_code = '' THEN
      v_errors := v_errors || '["emp_code required"]'::jsonb;
    END IF;
    IF r.first_name IS NULL OR r.first_name = '' THEN
      v_errors := v_errors || '["first_name required"]'::jsonb;
    END IF;
    IF r.email IS NULL OR r.email NOT LIKE '%@%' THEN
      v_errors := v_errors || '["valid email required"]'::jsonb;
    END IF;
    IF jsonb_array_length(v_errors) = 0 THEN
      UPDATE ispark_employee_staging SET validation_status = 'valid', validation_errors = NULL WHERE id = r.id;
      v_valid := v_valid + 1;
    ELSE
      UPDATE ispark_employee_staging SET validation_status = 'invalid', validation_errors = v_errors WHERE id = r.id;
      v_invalid := v_invalid + 1;
    END IF;
  END LOOP;
  UPDATE ispark_migration_batch SET valid_rows = v_valid, invalid_rows = v_invalid,
    batch_status = 'validated', updated_at = now() WHERE batch_ref = p_batch_ref;
  RETURN jsonb_build_object('ok', true, 'validRows', v_valid, 'invalidRows', v_invalid);
END;
$$;
```

- [ ] **Step 2: Run in Supabase SQL Editor and verify**
Expected: 2 tables created, 1 RPC created, no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/sql/phase9b_ispark_migration_schema.sql
git commit -m "feat(phase9b): iSpark employee migration staging tables + validate_ispark_batch RPC"
```

---

### Task 2: Dialer Integration SQL

**Files:**
- Create: `supabase/sql/phase9c_dialer_integration.sql`

- [ ] **Step 1: Write the SQL**

```sql
-- phase9c_dialer_integration.sql
-- Dialer session log: records login hours per agent per day from call dialer system

CREATE TABLE IF NOT EXISTS dialer_session_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code text NOT NULL,
  employee_id uuid REFERENCES employees(id),
  session_date date NOT NULL,
  login_minutes int NOT NULL DEFAULT 0,
  process_name text,
  branch_name text,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','api_import','file_import')),
  imported_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_code, session_date, source)
);

CREATE INDEX IF NOT EXISTS idx_dialer_session_employee_date ON dialer_session_log(employee_code, session_date);
CREATE INDEX IF NOT EXISTS idx_dialer_session_branch ON dialer_session_log(branch_name, session_date);

ALTER TABLE dialer_session_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dialer_session_admin_all" ON dialer_session_log FOR ALL TO authenticated
  USING (is_admin_or_hr(auth.uid())) WITH CHECK (is_admin_or_hr(auth.uid()));
CREATE POLICY "dialer_session_employee_own" ON dialer_session_log FOR SELECT TO authenticated
  USING (employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid()));
```

- [ ] **Step 2: Run in Supabase SQL Editor and verify**
Expected: table + indexes + RLS policies created.

- [ ] **Step 3: Commit**

```bash
git add supabase/sql/phase9c_dialer_integration.sql
git commit -m "feat(phase9c): dialer_session_log table for login hours import and salary validation"
```

---

### Task 3: Native Leave Management SQL

**Files:**
- Create: `supabase/sql/phase9d_leave_management_native.sql`

- [ ] **Step 1: Write the SQL**

```sql
-- phase9d_leave_management_native.sql
-- Native WFM-style leave management: type master, balance, request, approval log

CREATE TABLE IF NOT EXISTS leave_type_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_code text NOT NULL UNIQUE,
  leave_name text NOT NULL,
  max_days_per_year int NOT NULL DEFAULT 0,
  carry_forward boolean NOT NULL DEFAULT false,
  requires_approval boolean NOT NULL DEFAULT true,
  active_status boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leave_balance_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id uuid NOT NULL REFERENCES leave_type_master(id),
  balance_year int NOT NULL,
  allocated_days numeric(6,2) NOT NULL DEFAULT 0,
  used_days numeric(6,2) NOT NULL DEFAULT 0,
  adjusted_days numeric(6,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, leave_type_id, balance_year)
);

CREATE TABLE IF NOT EXISTS leave_request_native (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  leave_type_id uuid NOT NULL REFERENCES leave_type_master(id),
  from_date date NOT NULL,
  to_date date NOT NULL,
  total_days numeric(6,2) NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  applied_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leave_approval_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_request_id uuid NOT NULL REFERENCES leave_request_native(id),
  action text NOT NULL CHECK (action IN ('approved','rejected','cancelled')),
  action_by uuid NOT NULL REFERENCES auth.users(id),
  action_at timestamptz NOT NULL DEFAULT now(),
  remarks text
);

ALTER TABLE leave_type_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_balance_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_request_native ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_approval_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leave_type_select_all" ON leave_type_master FOR SELECT TO authenticated USING (true);
CREATE POLICY "leave_type_write_admin" ON leave_type_master FOR ALL TO authenticated
  USING (is_admin_or_hr(auth.uid())) WITH CHECK (is_admin_or_hr(auth.uid()));

CREATE POLICY "leave_balance_select_own_or_admin" ON leave_balance_ledger FOR SELECT TO authenticated
  USING (is_admin_or_hr(auth.uid()) OR employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid()));
CREATE POLICY "leave_balance_write_admin" ON leave_balance_ledger FOR ALL TO authenticated
  USING (is_admin_or_hr(auth.uid())) WITH CHECK (is_admin_or_hr(auth.uid()));

CREATE POLICY "leave_request_select_own_or_admin" ON leave_request_native FOR SELECT TO authenticated
  USING (is_admin_or_hr(auth.uid()) OR employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid()));
CREATE POLICY "leave_request_insert_own" ON leave_request_native FOR INSERT TO authenticated
  WITH CHECK (employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid()));
CREATE POLICY "leave_request_update_admin" ON leave_request_native FOR UPDATE TO authenticated
  USING (is_admin_or_hr(auth.uid()));

CREATE POLICY "leave_approval_select_admin" ON leave_approval_log FOR SELECT TO authenticated
  USING (is_admin_or_hr(auth.uid()));
CREATE POLICY "leave_approval_insert_admin" ON leave_approval_log FOR INSERT TO authenticated
  WITH CHECK (is_admin_or_hr(auth.uid()));

-- Seed standard leave types
INSERT INTO leave_type_master (leave_code, leave_name, max_days_per_year, carry_forward, requires_approval) VALUES
  ('CL', 'Casual Leave',    12, false, true),
  ('SL', 'Sick Leave',       7, false, true),
  ('EL', 'Earned Leave',    15, true,  true),
  ('ML', 'Maternity Leave', 90, false, true),
  ('PL', 'Paternity Leave',  5, false, true),
  ('LWP','Leave Without Pay', 0, false, true)
ON CONFLICT (leave_code) DO NOTHING;
```

- [ ] **Step 2: Run in Supabase SQL Editor**
Expected: 4 tables, RLS policies, 6 leave type seeds.

- [ ] **Step 3: Commit**

```bash
git add supabase/sql/phase9d_leave_management_native.sql
git commit -m "feat(phase9d): native leave management tables — type master, balance ledger, request, approval log"
```

---

### Task 4: Salary Prep SQL

**Files:**
- Create: `supabase/sql/phase9e_salary_prep.sql`

- [ ] **Step 1: Write the SQL**

```sql
-- phase9e_salary_prep.sql
-- Monthly salary preparation: run → lines per employee → deduction rules

CREATE TABLE IF NOT EXISTS salary_prep_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_month text NOT NULL,  -- format: YYYY-MM
  branch_filter text,
  process_filter text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','processing','reviewed','approved','locked')),
  total_employees int NOT NULL DEFAULT 0,
  total_gross numeric(12,2) NOT NULL DEFAULT 0,
  total_deductions numeric(12,2) NOT NULL DEFAULT 0,
  total_net numeric(12,2) NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id),
  approved_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_month, branch_filter, process_filter)
);

CREATE TABLE IF NOT EXISTS salary_prep_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES salary_prep_run(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  employee_code text NOT NULL,
  present_days numeric(6,2) NOT NULL DEFAULT 0,
  leave_days numeric(6,2) NOT NULL DEFAULT 0,
  lwp_days numeric(6,2) NOT NULL DEFAULT 0,
  dialer_hours numeric(8,2),
  gross_salary numeric(10,2) NOT NULL DEFAULT 0,
  total_deductions numeric(10,2) NOT NULL DEFAULT 0,
  net_salary numeric(10,2) NOT NULL DEFAULT 0,
  remarks text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','reviewed','approved')),
  UNIQUE(run_id, employee_id)
);

CREATE TABLE IF NOT EXISTS salary_deduction_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name text NOT NULL,
  rule_type text NOT NULL CHECK (rule_type IN ('lwp_per_day','late_mark','dialer_shortfall','fixed','percentage')),
  applies_to text NOT NULL DEFAULT 'all',  -- 'all', branch code, or process code
  value numeric(10,4) NOT NULL DEFAULT 0,
  active_status boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE salary_prep_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_prep_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_deduction_rule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "salary_run_admin_all" ON salary_prep_run FOR ALL TO authenticated
  USING (is_admin_or_hr(auth.uid())) WITH CHECK (is_admin_or_hr(auth.uid()));
CREATE POLICY "salary_line_admin_all" ON salary_prep_line FOR ALL TO authenticated
  USING (is_admin_or_hr(auth.uid())) WITH CHECK (is_admin_or_hr(auth.uid()));
CREATE POLICY "salary_deduction_rule_admin_all" ON salary_deduction_rule FOR ALL TO authenticated
  USING (is_admin_or_hr(auth.uid())) WITH CHECK (is_admin_or_hr(auth.uid()));
```

- [ ] **Step 2: Run in Supabase SQL Editor**
Expected: 3 tables with RLS created.

- [ ] **Step 3: Commit**

```bash
git add supabase/sql/phase9e_salary_prep.sql
git commit -m "feat(phase9e): salary_prep_run, salary_prep_line, salary_deduction_rule tables"
```

---

### Task 5: KPI Snapshot SQL

**Files:**
- Create: `supabase/sql/phase9f_kpi_snapshot.sql`

- [ ] **Step 1: Write the SQL**

```sql
-- phase9f_kpi_snapshot.sql
-- Role-aware KPI snapshot: daily/weekly snapshots per employee + targets per role

CREATE TABLE IF NOT EXISTS kpi_target_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key text NOT NULL,  -- e.g. 'tl', 'qa', 'analyst', 'manager', 'branch_head'
  kpi_name text NOT NULL,
  kpi_code text NOT NULL,
  target_value numeric(10,4),
  unit text,
  active_status boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(role_key, kpi_code)
);

CREATE TABLE IF NOT EXISTS role_kpi_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  snapshot_date date NOT NULL,
  role_key text NOT NULL,
  kpi_code text NOT NULL,
  actual_value numeric(10,4),
  target_value numeric(10,4),
  achievement_pct numeric(6,2),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','system','api')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, snapshot_date, kpi_code)
);

ALTER TABLE kpi_target_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_kpi_snapshot ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kpi_target_select_all" ON kpi_target_master FOR SELECT TO authenticated USING (true);
CREATE POLICY "kpi_target_write_admin" ON kpi_target_master FOR ALL TO authenticated
  USING (is_admin_or_hr(auth.uid())) WITH CHECK (is_admin_or_hr(auth.uid()));

CREATE POLICY "kpi_snapshot_select_own_or_admin" ON role_kpi_snapshot FOR SELECT TO authenticated
  USING (is_admin_or_hr(auth.uid()) OR employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid()));
CREATE POLICY "kpi_snapshot_write_admin" ON role_kpi_snapshot FOR ALL TO authenticated
  USING (is_admin_or_hr(auth.uid())) WITH CHECK (is_admin_or_hr(auth.uid()));

-- Seed standard KPI targets per role
INSERT INTO kpi_target_master (role_key, kpi_name, kpi_code, target_value, unit) VALUES
  ('tl',         'Team AHT (seconds)',       'TEAM_AHT',      300, 'seconds'),
  ('tl',         'Team CSAT Score',          'TEAM_CSAT',      90, 'percent'),
  ('tl',         'Attendance %',             'ATTENDANCE_PCT', 95, 'percent'),
  ('qa',         'Audits Per Day',           'AUDITS_PER_DAY',  8, 'count'),
  ('qa',         'Fatal Error Rate',         'FATAL_RATE',       2, 'percent'),
  ('analyst',    'Reports Published',        'REPORTS_PUB',      1, 'count'),
  ('manager',    'Process SLA Achievement',  'SLA_ACH',         95, 'percent'),
  ('manager',    'Shrinkage %',              'SHRINKAGE',       10, 'percent'),
  ('branch_head','Branch Headcount Fill %',  'HEADCOUNT_FILL',  90, 'percent'),
  ('branch_head','Branch CSAT Average',      'BRANCH_CSAT',     88, 'percent')
ON CONFLICT (role_key, kpi_code) DO NOTHING;
```

- [ ] **Step 2: Run in Supabase SQL Editor**
Expected: 2 tables, RLS, 10 KPI target seeds.

- [ ] **Step 3: Commit**

```bash
git add supabase/sql/phase9f_kpi_snapshot.sql
git commit -m "feat(phase9f): kpi_target_master + role_kpi_snapshot tables with role seeds"
```

---

### Task 6: NativeISParkMigration Page

**Files:**
- Create: `src/pages/NativeISParkMigration.tsx`

- [ ] **Step 1: Write the page**

```typescript
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { Upload, CheckCircle, AlertCircle } from "lucide-react";

export default function NativeISParkMigration() {
  const qc = useQueryClient();
  const [activeBatch, setActiveBatch] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const { data: batches = [] } = useQuery({
    queryKey: ["ispark-batches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ispark_migration_batch")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: stagingRows = [] } = useQuery({
    queryKey: ["ispark-staging", activeBatch],
    enabled: !!activeBatch,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ispark_employee_staging")
        .select("id,emp_code,first_name,last_name,email,validation_status,validation_errors")
        .eq("batch_ref", activeBatch!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const validateMutation = useMutation({
    mutationFn: async (batchRef: string) => {
      const { data, error } = await supabase.rpc("validate_ispark_batch", { p_batch_ref: batchRef });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (result) => {
      setMessage(`Validation complete — ${result.validRows} valid, ${result.invalidRows} invalid`);
      qc.invalidateQueries({ queryKey: ["ispark-batches"] });
      qc.invalidateQueries({ queryKey: ["ispark-staging", activeBatch] });
    },
    onError: (err: any) => setMessage(err.message),
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-950">iSpark Migration</h1>
          <p className="mt-1 text-slate-600">Stage, validate, and promote iSpark employee records to HRMS. All data goes through validation before promotion.</p>
        </div>

        {message && (
          <div className="rounded-2xl border bg-blue-50 px-5 py-3 text-sm text-blue-800">{message}</div>
        )}

        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-950">Migration Batches</h2>
          {batches.length === 0 ? (
            <div className="mt-4 flex items-center gap-3 rounded-xl border-2 border-dashed p-6 text-slate-500">
              <Upload className="h-5 w-5" />
              <span className="text-sm">No batches yet. Upload employee data via Bulk Upload Hub to create a migration batch.</span>
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {batches.map((b: any) => (
                <div
                  key={b.id}
                  onClick={() => setActiveBatch(b.batch_ref)}
                  className={`cursor-pointer rounded-xl border p-4 transition-colors ${activeBatch === b.batch_ref ? "border-slate-950 bg-slate-50" : "hover:bg-slate-50"}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-slate-950">{b.batch_ref}</p>
                      <p className="text-xs text-slate-500">{b.total_rows} rows · {b.valid_rows} valid · {b.invalid_rows} invalid</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${b.batch_status === 'validated' ? 'bg-green-100 text-green-800' : b.batch_status === 'promoted' ? 'bg-slate-900 text-white' : 'bg-amber-100 text-amber-800'}`}>
                      {b.batch_status}
                    </span>
                  </div>
                  {activeBatch === b.batch_ref && b.batch_status === 'uploaded' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); validateMutation.mutate(b.batch_ref); }}
                      disabled={validateMutation.isPending}
                      className="mt-3 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {validateMutation.isPending ? "Validating..." : "Run Validation"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {activeBatch && stagingRows.length > 0 && (
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-slate-950">Staging Rows — {activeBatch}</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs font-semibold uppercase text-slate-500">
                    <th className="pb-2 pr-4">Emp Code</th>
                    <th className="pb-2 pr-4">Name</th>
                    <th className="pb-2 pr-4">Email</th>
                    <th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stagingRows.map((r: any) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono text-xs">{r.emp_code ?? "—"}</td>
                      <td className="py-2 pr-4">{[r.first_name, r.last_name].filter(Boolean).join(" ") || "—"}</td>
                      <td className="py-2 pr-4 text-slate-600">{r.email ?? "—"}</td>
                      <td className="py-2">
                        <span className={`flex items-center gap-1 text-xs font-medium ${r.validation_status === 'valid' ? 'text-green-700' : r.validation_status === 'invalid' ? 'text-red-700' : 'text-amber-700'}`}>
                          {r.validation_status === 'valid' ? <CheckCircle className="h-3.5 w-3.5" /> : r.validation_status === 'invalid' ? <AlertCircle className="h-3.5 w-3.5" /> : null}
                          {r.validation_status}
                        </span>
                        {r.validation_errors && (
                          <p className="mt-0.5 text-xs text-red-600">{(r.validation_errors as string[]).join(", ")}</p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd C:/Users/shivamg/mas-callnet-hrms && npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/NativeISParkMigration.tsx
git commit -m "feat(phase9b): NativeISParkMigration page — batch list, validation, staging row review"
```

---

### Task 7: NativeDialerIntegration Page

**Files:**
- Create: `src/pages/NativeDialerIntegration.tsx`

- [ ] **Step 1: Write the page**

```typescript
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { Phone } from "lucide-react";

export default function NativeDialerIntegration() {
  const today = new Date().toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(today);

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ["dialer-sessions", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dialer_session_log")
        .select("id,employee_code,session_date,login_minutes,process_name,branch_name,source")
        .gte("session_date", fromDate)
        .lte("session_date", toDate)
        .order("session_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const totalHours = sessions.reduce((sum: number, s: any) => sum + (s.login_minutes ?? 0), 0) / 60;
  const uniqueAgents = new Set(sessions.map((s: any) => s.employee_code)).size;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-950">Dialer Integration</h1>
          <p className="mt-1 text-slate-600">View and manage agent login hours imported from the call dialer. Used for salary validation.</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 rounded-xl border bg-white px-4 py-2">
            <label className="text-xs font-medium text-slate-600">From</label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="text-sm" />
          </div>
          <div className="flex items-center gap-2 rounded-xl border bg-white px-4 py-2">
            <label className="text-xs font-medium text-slate-600">To</label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="text-sm" />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">Total Sessions</p>
            <p className="mt-1 text-3xl font-bold text-slate-950">{sessions.length}</p>
          </div>
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">Total Login Hours</p>
            <p className="mt-1 text-3xl font-bold text-slate-950">{totalHours.toFixed(1)}</p>
          </div>
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">Unique Agents</p>
            <p className="mt-1 text-3xl font-bold text-slate-950">{uniqueAgents}</p>
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-950">Session Log</h2>
          {isLoading ? (
            <p className="mt-4 text-sm text-slate-500">Loading...</p>
          ) : sessions.length === 0 ? (
            <div className="mt-4 flex items-center gap-3 rounded-xl border-2 border-dashed p-6 text-slate-500">
              <Phone className="h-5 w-5" />
              <span className="text-sm">No dialer sessions found for this period. Import via Bulk Upload Hub.</span>
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs font-semibold uppercase text-slate-500">
                    <th className="pb-2 pr-4">Emp Code</th>
                    <th className="pb-2 pr-4">Date</th>
                    <th className="pb-2 pr-4">Login Mins</th>
                    <th className="pb-2 pr-4">Process</th>
                    <th className="pb-2">Branch</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s: any) => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono text-xs">{s.employee_code}</td>
                      <td className="py-2 pr-4">{s.session_date}</td>
                      <td className="py-2 pr-4">{s.login_minutes} <span className="text-slate-400">({(s.login_minutes / 60).toFixed(1)}h)</span></td>
                      <td className="py-2 pr-4 text-slate-600">{s.process_name ?? "—"}</td>
                      <td className="py-2 text-slate-600">{s.branch_name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd C:/Users/shivamg/mas-callnet-hrms && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/NativeDialerIntegration.tsx
git commit -m "feat(phase9c): NativeDialerIntegration page — session log with date filter and summary cards"
```

---

### Task 8: NativeSalaryValidation Page

**Files:**
- Create: `src/pages/NativeSalaryValidation.tsx`

Cross-references attendance records against dialer login hours to highlight discrepancies.

- [ ] **Step 1: Write the page**

```typescript
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle } from "lucide-react";

export default function NativeSalaryValidation() {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);

  const fromDate = `${month}-01`;
  const toDate = new Date(new Date(fromDate).setMonth(new Date(fromDate).getMonth() + 1) - 1).toISOString().slice(0, 10);

  const { data: dialerData = [], isLoading: dialerLoading } = useQuery({
    queryKey: ["salary-val-dialer", month],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dialer_session_log")
        .select("employee_code, login_minutes")
        .gte("session_date", fromDate)
        .lte("session_date", toDate);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Aggregate dialer hours per employee
  const dialerMap = (dialerData as any[]).reduce((acc: Record<string, number>, row) => {
    acc[row.employee_code] = (acc[row.employee_code] ?? 0) + row.login_minutes;
    return acc;
  }, {} as Record<string, number>);

  const discrepancies = Object.entries(dialerMap)
    .map(([empCode, minutes]) => ({
      empCode,
      dialerHours: (minutes as number) / 60,
      // 8 hours/day × working days — placeholder until attendance join
      expectedHours: 176,
      diff: (minutes as number) / 60 - 176,
    }))
    .filter((r) => Math.abs(r.diff) > 8)
    .sort((a, b) => a.diff - b.diff);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-950">Salary Validation</h1>
          <p className="mt-1 text-slate-600">Compare attendance hours against dialer login hours. Flag discrepancies before salary prep.</p>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-slate-700">Month</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-xl border px-4 py-2 text-sm" />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">Employees with Dialer Data</p>
            <p className="mt-1 text-3xl font-bold text-slate-950">{Object.keys(dialerMap).length}</p>
          </div>
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">Discrepancies (&gt;8h diff)</p>
            <p className={`mt-1 text-3xl font-bold ${discrepancies.length > 0 ? "text-red-600" : "text-green-700"}`}>
              {dialerLoading ? "..." : discrepancies.length}
            </p>
          </div>
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">Total Dialer Hours</p>
            <p className="mt-1 text-3xl font-bold text-slate-950">
              {(Object.values(dialerMap).reduce((s: number, v) => s + (v as number), 0) / 60).toFixed(0)}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-950">Discrepancy Report</h2>
          {discrepancies.length === 0 ? (
            <div className="mt-4 flex items-center gap-3 rounded-xl border-2 border-dashed p-6 text-slate-500">
              <AlertTriangle className="h-5 w-5" />
              <span className="text-sm">{dialerLoading ? "Loading..." : "No significant discrepancies found for this month."}</span>
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs font-semibold uppercase text-slate-500">
                    <th className="pb-2 pr-4">Emp Code</th>
                    <th className="pb-2 pr-4">Dialer Hours</th>
                    <th className="pb-2 pr-4">Expected Hours</th>
                    <th className="pb-2">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {discrepancies.map((r) => (
                    <tr key={r.empCode} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono text-xs">{r.empCode}</td>
                      <td className="py-2 pr-4">{r.dialerHours.toFixed(1)}h</td>
                      <td className="py-2 pr-4">{r.expectedHours}h</td>
                      <td className={`py-2 font-medium ${r.diff < 0 ? "text-red-600" : "text-green-700"}`}>
                        {r.diff > 0 ? "+" : ""}{r.diff.toFixed(1)}h
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd C:/Users/shivamg/mas-callnet-hrms && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/NativeSalaryValidation.tsx
git commit -m "feat(phase9c): NativeSalaryValidation — attendance vs dialer discrepancy view"
```

---

### Task 9: NativeLeaveManagement Page

**Files:**
- Create: `src/pages/NativeLeaveManagement.tsx`

- [ ] **Step 1: Write the page**

```typescript
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdminOrHR } from "@/hooks/useUserRole";
import { useAuth } from "@/contexts/AuthContext";

export default function NativeLeaveManagement() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { isAdminOrHR } = useIsAdminOrHR();
  const [activeTab, setActiveTab] = useState<"requests" | "types" | "balances">("requests");
  const [message, setMessage] = useState("");

  const { data: leaveTypes = [] } = useQuery({
    queryKey: ["leave-types"],
    queryFn: async () => {
      const { data, error } = await supabase.from("leave_type_master").select("*").eq("active_status", true).order("leave_code");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: requests = [] } = useQuery({
    queryKey: ["leave-requests", isAdminOrHR],
    queryFn: async () => {
      let q = supabase
        .from("leave_request_native")
        .select("id,from_date,to_date,total_days,status,reason,applied_at,leave_type_id,employee_id")
        .order("applied_at", { ascending: false });
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "approved" | "rejected" }) => {
      const { error: statusErr } = await supabase.from("leave_request_native").update({ status: action }).eq("id", id);
      if (statusErr) throw statusErr;
      const { error: logErr } = await supabase.from("leave_approval_log").insert({ leave_request_id: id, action, action_by: user!.id });
      if (logErr) throw logErr;
    },
    onSuccess: () => { setMessage("Action recorded."); qc.invalidateQueries({ queryKey: ["leave-requests"] }); },
    onError: (err: any) => setMessage(err.message),
  });

  const typeNameMap = Object.fromEntries((leaveTypes as any[]).map((t: any) => [t.id, t.leave_name]));

  const tabs = [
    { key: "requests", label: "Leave Requests" },
    { key: "types", label: "Leave Types" },
  ] as const;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-950">Leave Management</h1>
          <p className="mt-1 text-slate-600">Native leave type master, balance tracking, and approval workflow.</p>
        </div>

        {message && <div className="rounded-2xl border bg-blue-50 px-5 py-3 text-sm text-blue-800">{message}</div>}

        <div className="flex gap-2 border-b">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${activeTab === t.key ? "border-b-2 border-slate-950 text-slate-950" : "text-slate-500 hover:text-slate-800"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === "requests" && (
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-slate-950">Leave Requests</h2>
            <div className="mt-4 space-y-3">
              {requests.length === 0 ? (
                <p className="text-sm text-slate-500">No leave requests found.</p>
              ) : (
                (requests as any[]).map((r) => (
                  <div key={r.id} className="rounded-xl border p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-medium text-slate-950">{typeNameMap[r.leave_type_id] ?? "Leave"}</p>
                        <p className="text-sm text-slate-600">{r.from_date} → {r.to_date} · {r.total_days} day(s)</p>
                        {r.reason && <p className="mt-1 text-xs text-slate-500">{r.reason}</p>}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className={`rounded-full px-3 py-1 text-xs font-medium ${r.status === "approved" ? "bg-green-100 text-green-800" : r.status === "rejected" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                          {r.status}
                        </span>
                        {isAdminOrHR && r.status === "pending" && (
                          <div className="flex gap-2">
                            <button onClick={() => approveMutation.mutate({ id: r.id, action: "approved" })} className="rounded-lg bg-green-700 px-3 py-1 text-xs font-semibold text-white">Approve</button>
                            <button onClick={() => approveMutation.mutate({ id: r.id, action: "rejected" })} className="rounded-lg bg-red-700 px-3 py-1 text-xs font-semibold text-white">Reject</button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === "types" && (
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-slate-950">Leave Type Master</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs font-semibold uppercase text-slate-500">
                    <th className="pb-2 pr-4">Code</th>
                    <th className="pb-2 pr-4">Name</th>
                    <th className="pb-2 pr-4">Max Days/Year</th>
                    <th className="pb-2 pr-4">Carry Forward</th>
                    <th className="pb-2">Requires Approval</th>
                  </tr>
                </thead>
                <tbody>
                  {(leaveTypes as any[]).map((t) => (
                    <tr key={t.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono text-xs font-semibold">{t.leave_code}</td>
                      <td className="py-2 pr-4">{t.leave_name}</td>
                      <td className="py-2 pr-4">{t.max_days_per_year}</td>
                      <td className="py-2 pr-4">{t.carry_forward ? "Yes" : "No"}</td>
                      <td className="py-2">{t.requires_approval ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd C:/Users/shivamg/mas-callnet-hrms && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/NativeLeaveManagement.tsx
git commit -m "feat(phase9d): NativeLeaveManagement — requests, approval, leave type master tabs"
```

---

### Task 10: NativeSalaryPrep Page

**Files:**
- Create: `src/pages/NativeSalaryPrep.tsx`

- [ ] **Step 1: Write the page**

```typescript
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export default function NativeSalaryPrep() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [message, setMessage] = useState("");

  const { data: runs = [] } = useQuery({
    queryKey: ["salary-runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("salary_prep_run")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const [activeRun, setActiveRun] = useState<string | null>(null);

  const { data: lines = [] } = useQuery({
    queryKey: ["salary-lines", activeRun],
    enabled: !!activeRun,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("salary_prep_line")
        .select("*")
        .eq("run_id", activeRun!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const createRunMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("salary_prep_run")
        .insert({ run_month: month, created_by: user!.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (run) => {
      setMessage(`Run created: ${run.id.slice(0, 8)}`);
      setActiveRun(run.id);
      qc.invalidateQueries({ queryKey: ["salary-runs"] });
    },
    onError: (err: any) => setMessage(err.message),
  });

  const existingRun = (runs as any[]).find((r) => r.run_month === month);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-950">Salary Prep</h1>
          <p className="mt-1 text-slate-600">Monthly salary preparation — attendance deductions, leave deductions, and net salary calculation.</p>
        </div>

        {message && <div className="rounded-2xl border bg-blue-50 px-5 py-3 text-sm text-blue-800">{message}</div>}

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Month</label>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-xl border px-4 py-2 text-sm" />
          </div>
          {!existingRun && (
            <button
              onClick={() => createRunMutation.mutate()}
              disabled={createRunMutation.isPending}
              className="rounded-xl bg-slate-950 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {createRunMutation.isPending ? "Creating..." : "Create Salary Run"}
            </button>
          )}
        </div>

        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-950">Salary Runs</h2>
          {(runs as any[]).length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No salary runs yet. Select a month and create a run.</p>
          ) : (
            <div className="mt-4 space-y-2">
              {(runs as any[]).map((r) => (
                <div
                  key={r.id}
                  onClick={() => setActiveRun(r.id)}
                  className={`cursor-pointer rounded-xl border p-4 transition-colors ${activeRun === r.id ? "border-slate-950 bg-slate-50" : "hover:bg-slate-50"}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-slate-950">{r.run_month}</p>
                      <p className="text-xs text-slate-500">{r.total_employees} employees · Net ₹{(r.total_net ?? 0).toLocaleString()}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${r.status === "approved" ? "bg-green-100 text-green-800" : r.status === "locked" ? "bg-slate-900 text-white" : "bg-amber-100 text-amber-800"}`}>
                      {r.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {activeRun && (
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-slate-950">Salary Lines</h2>
            {(lines as any[]).length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">No lines yet. Lines are generated when the run is processed.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs font-semibold uppercase text-slate-500">
                      <th className="pb-2 pr-4">Emp Code</th>
                      <th className="pb-2 pr-4">Present Days</th>
                      <th className="pb-2 pr-4">LWP Days</th>
                      <th className="pb-2 pr-4">Gross</th>
                      <th className="pb-2 pr-4">Deductions</th>
                      <th className="pb-2">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(lines as any[]).map((l) => (
                      <tr key={l.id} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-mono text-xs">{l.employee_code}</td>
                        <td className="py-2 pr-4">{l.present_days}</td>
                        <td className="py-2 pr-4">{l.lwp_days}</td>
                        <td className="py-2 pr-4">₹{(l.gross_salary ?? 0).toLocaleString()}</td>
                        <td className="py-2 pr-4 text-red-600">-₹{(l.total_deductions ?? 0).toLocaleString()}</td>
                        <td className="py-2 font-semibold text-slate-950">₹{(l.net_salary ?? 0).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd C:/Users/shivamg/mas-callnet-hrms && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/NativeSalaryPrep.tsx
git commit -m "feat(phase9e): NativeSalaryPrep — create salary run, view prep lines per employee"
```

---

### Task 11: NativeRoleAccessManager Page

Replaces the 38-line read-only `UnifiedAccessControl.tsx` with a full admin UI.

**Files:**
- Create: `src/pages/NativeRoleAccessManager.tsx`

- [ ] **Step 1: Write the page**

```typescript
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { Shield } from "lucide-react";

const PAGE_CODES = [
  "ATS_DASHBOARD","ATS_RECRUITER_QUEUE","LMS_MY_LEARNING","LMS_COORDINATOR",
  "LMS_ADMIN","LMS_MANAGEMENT_DASHBOARD","WFM_ROSTER","WFM_LIVE_TRACKER",
  "QUALITY_DASHBOARD","OPERATIONS_DASHBOARD","WORKFORCE_COMMAND_CENTER","ACCESS_CONTROL",
  "DIALER_INTEGRATION","LEAVE_MANAGEMENT","SALARY_PREP","KPI_DASHBOARD","ISPARK_MIGRATION",
];

export default function NativeRoleAccessManager() {
  const qc = useQueryClient();
  const [selectedRole, setSelectedRole] = useState("");
  const [message, setMessage] = useState("");

  const { data: roles = [] } = useQuery({
    queryKey: ["workforce-roles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_page_access")
        .select("role_key")
        .eq("active_status", true);
      if (error) throw error;
      const keys = Array.from(new Set((data ?? []).map((r: any) => r.role_key)));
      return keys.sort();
    },
  });

  const { data: accessRows = [] } = useQuery({
    queryKey: ["role-access-matrix", selectedRole],
    enabled: !!selectedRole,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_page_access")
        .select("id,page_code,can_view,can_create,can_edit,can_delete,can_export")
        .eq("role_key", selectedRole)
        .eq("active_status", true);
      if (error) throw error;
      return data ?? [];
    },
  });

  const accessMap: Record<string, any> = Object.fromEntries(
    (accessRows as any[]).map((r) => [r.page_code, r])
  );

  const toggleMutation = useMutation({
    mutationFn: async ({ pageCode, field, value }: { pageCode: string; field: string; value: boolean }) => {
      const existing = accessMap[pageCode];
      if (existing) {
        const { error } = await supabase
          .from("role_page_access")
          .update({ [field]: value })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("role_page_access")
          .insert({ role_key: selectedRole, page_code: pageCode, [field]: value, active_status: true });
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["role-access-matrix", selectedRole] }); },
    onError: (err: any) => setMessage(err.message),
  });

  const fields = ["can_view", "can_create", "can_edit", "can_delete", "can_export"] as const;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-950">Role Access Manager</h1>
          <p className="mt-1 text-slate-600">Configure page-level permissions per role. Changes take effect immediately.</p>
        </div>

        {message && <div className="rounded-2xl border bg-red-50 px-5 py-3 text-sm text-red-800">{message}</div>}

        <div className="flex flex-wrap gap-2">
          {(roles as string[]).map((role) => (
            <button
              key={role}
              onClick={() => setSelectedRole(role)}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${selectedRole === role ? "bg-slate-950 text-white" : "border bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              {role}
            </button>
          ))}
        </div>

        {!selectedRole && (
          <div className="flex items-center gap-3 rounded-2xl border-2 border-dashed p-8 text-slate-500">
            <Shield className="h-6 w-6" />
            <span>Select a role above to configure its page access.</span>
          </div>
        )}

        {selectedRole && (
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-slate-950">Permissions — {selectedRole}</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs font-semibold uppercase text-slate-500">
                    <th className="pb-2 pr-6 w-48">Page</th>
                    {fields.map((f) => <th key={f} className="pb-2 pr-4 text-center">{f.replace("can_", "")}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {PAGE_CODES.map((pageCode) => {
                    const row = accessMap[pageCode];
                    return (
                      <tr key={pageCode} className="border-b last:border-0">
                        <td className="py-2 pr-6 font-mono text-xs text-slate-700">{pageCode}</td>
                        {fields.map((field) => {
                          const val = row?.[field] ?? false;
                          return (
                            <td key={field} className="py-2 pr-4 text-center">
                              <input
                                type="checkbox"
                                checked={val}
                                onChange={(e) => toggleMutation.mutate({ pageCode, field, value: e.target.checked })}
                                className="h-4 w-4 cursor-pointer accent-slate-950"
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd C:/Users/shivamg/mas-callnet-hrms && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/NativeRoleAccessManager.tsx
git commit -m "feat(phase9-access): NativeRoleAccessManager — full admin UI for role page access matrix"
```

---

### Task 12: NativeWFMRosterAssignment Page

Extends NativeWFMRoster (102 lines, shift master only) — adds employee-to-shift assignment by date range.

**Files:**
- Create: `src/pages/NativeWFMRosterAssignment.tsx`

- [ ] **Step 1: Check existing wfm_roster_assignment columns**

Run in Supabase SQL Editor:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'wfm_roster_assignment' ORDER BY ordinal_position;
```
Note the column names before implementing. Expected: `id`, `employee_id`, `shift_id`, `start_date`, `end_date`, `active_status`, `created_at`.

- [ ] **Step 2: Write the page**

```typescript
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { CalendarDays } from "lucide-react";

export default function NativeWFMRosterAssignment() {
  const qc = useQueryClient();
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ employee_id: "", shift_id: "", start_date: "", end_date: "" });

  const { data: employees = [] } = useQuery({
    queryKey: ["employees-basic"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id,employee_code,first_name,last_name")
        .eq("active_status", true)
        .order("first_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: shifts = [] } = useQuery({
    queryKey: ["wfm-shifts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wfm_shift_master")
        .select("id,shift_name,start_time,end_time")
        .eq("active_status", true);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: assignments = [] } = useQuery({
    queryKey: ["wfm-assignments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wfm_roster_assignment")
        .select("id,employee_id,shift_id,start_date,end_date,active_status")
        .eq("active_status", true)
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const empMap: Record<string, string> = Object.fromEntries(
    (employees as any[]).map((e: any) => [e.id, `${e.first_name} ${e.last_name} (${e.employee_code})`])
  );
  const shiftMap: Record<string, string> = Object.fromEntries(
    (shifts as any[]).map((s: any) => [s.id, `${s.shift_name} ${s.start_time}–${s.end_time}`])
  );

  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!form.employee_id || !form.shift_id || !form.start_date) throw new Error("Employee, shift, and start date are required");
      const { error } = await supabase.from("wfm_roster_assignment").insert({
        employee_id: form.employee_id,
        shift_id: form.shift_id,
        start_date: form.start_date,
        end_date: form.end_date || null,
        active_status: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setMessage("Shift assigned successfully.");
      setForm({ employee_id: "", shift_id: "", start_date: "", end_date: "" });
      qc.invalidateQueries({ queryKey: ["wfm-assignments"] });
    },
    onError: (err: any) => setMessage(err.message),
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-950">Roster Assignment</h1>
          <p className="mt-1 text-slate-600">Assign employees to shifts for a date range. Coverage view shows current active assignments.</p>
        </div>

        {message && <div className="rounded-2xl border bg-blue-50 px-5 py-3 text-sm text-blue-800">{message}</div>}

        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-950">Assign Shift</h2>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <select
              value={form.employee_id}
              onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))}
              className="rounded-xl border px-4 py-3 text-sm"
            >
              <option value="">Select Employee</option>
              {(employees as any[]).map((e: any) => (
                <option key={e.id} value={e.id}>{e.first_name} {e.last_name} ({e.employee_code})</option>
              ))}
            </select>
            <select
              value={form.shift_id}
              onChange={(e) => setForm((f) => ({ ...f, shift_id: e.target.value }))}
              className="rounded-xl border px-4 py-3 text-sm"
            >
              <option value="">Select Shift</option>
              {(shifts as any[]).map((s: any) => (
                <option key={s.id} value={s.id}>{s.shift_name} ({s.start_time}–{s.end_time})</option>
              ))}
            </select>
            <input type="date" placeholder="Start date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} className="rounded-xl border px-4 py-3 text-sm" />
            <input type="date" placeholder="End date (optional)" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} className="rounded-xl border px-4 py-3 text-sm" />
          </div>
          <button
            onClick={() => assignMutation.mutate()}
            disabled={assignMutation.isPending}
            className="mt-4 rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-50"
          >
            {assignMutation.isPending ? "Assigning..." : "Assign Shift"}
          </button>
        </div>

        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-950">Active Assignments</h2>
          {(assignments as any[]).length === 0 ? (
            <div className="mt-4 flex items-center gap-3 rounded-xl border-2 border-dashed p-6 text-slate-500">
              <CalendarDays className="h-5 w-5" />
              <span className="text-sm">No active roster assignments. Assign shifts above.</span>
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs font-semibold uppercase text-slate-500">
                    <th className="pb-2 pr-4">Employee</th>
                    <th className="pb-2 pr-4">Shift</th>
                    <th className="pb-2 pr-4">From</th>
                    <th className="pb-2">To</th>
                  </tr>
                </thead>
                <tbody>
                  {(assignments as any[]).map((a) => (
                    <tr key={a.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">{empMap[a.employee_id] ?? a.employee_id.slice(0, 8)}</td>
                      <td className="py-2 pr-4">{shiftMap[a.shift_id] ?? a.shift_id.slice(0, 8)}</td>
                      <td className="py-2 pr-4">{a.start_date}</td>
                      <td className="py-2">{a.end_date ?? <span className="text-slate-400">ongoing</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd C:/Users/shivamg/mas-callnet-hrms && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/NativeWFMRosterAssignment.tsx
git commit -m "feat(phase9-wfm): NativeWFMRosterAssignment — employee-to-shift assignment with date range"
```

---

### Task 13: NativeSalaryAutomation Page

**Files:**
- Create: `src/pages/NativeSalaryAutomation.tsx`

Monthly payroll run that aggregates attendance + leave + dialer data.

- [ ] **Step 1: Write the page**

```typescript
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Play, Lock } from "lucide-react";

export default function NativeSalaryAutomation() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [message, setMessage] = useState("");

  const { data: runs = [] } = useQuery({
    queryKey: ["salary-automation-runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("salary_prep_run")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (runId: string) => {
      const { error } = await supabase
        .from("salary_prep_run")
        .update({ status: "approved", approved_by: user!.id, updated_at: new Date().toISOString() })
        .eq("id", runId);
      if (error) throw error;
    },
    onSuccess: () => { setMessage("Run approved."); qc.invalidateQueries({ queryKey: ["salary-automation-runs"] }); },
    onError: (err: any) => setMessage(err.message),
  });

  const lockMutation = useMutation({
    mutationFn: async (runId: string) => {
      const { error } = await supabase
        .from("salary_prep_run")
        .update({ status: "locked", updated_at: new Date().toISOString() })
        .eq("id", runId);
      if (error) throw error;
    },
    onSuccess: () => { setMessage("Run locked. Salary finalized."); qc.invalidateQueries({ queryKey: ["salary-automation-runs"] }); },
    onError: (err: any) => setMessage(err.message),
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-950">Salary Automation</h1>
          <p className="mt-1 text-slate-600">Review, approve, and lock monthly payroll runs. Locked runs are final and ready for disbursement.</p>
        </div>

        {message && <div className="rounded-2xl border bg-blue-50 px-5 py-3 text-sm text-blue-800">{message}</div>}

        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-950">Payroll Runs</h2>
          {(runs as any[]).length === 0 ? (
            <div className="mt-4 flex items-center gap-3 rounded-xl border-2 border-dashed p-6 text-slate-500">
              <Play className="h-5 w-5" />
              <span className="text-sm">No payroll runs. Create one in Salary Prep first.</span>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {(runs as any[]).map((r) => (
                <div key={r.id} className="rounded-xl border p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-medium text-slate-950">{r.run_month}</p>
                      <p className="text-sm text-slate-600">{r.total_employees} employees · Gross ₹{(r.total_gross ?? 0).toLocaleString()} · Net ₹{(r.total_net ?? 0).toLocaleString()}</p>
                      <p className="mt-1 text-xs text-slate-400">Deductions ₹{(r.total_deductions ?? 0).toLocaleString()}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className={`rounded-full px-3 py-1 text-xs font-medium ${r.status === "locked" ? "bg-slate-900 text-white" : r.status === "approved" ? "bg-green-100 text-green-800" : r.status === "reviewed" ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800"}`}>
                        {r.status}
                      </span>
                      {r.status === "reviewed" && (
                        <button onClick={() => approveMutation.mutate(r.id)} disabled={approveMutation.isPending} className="rounded-lg bg-green-700 px-3 py-1 text-xs font-semibold text-white">
                          Approve
                        </button>
                      )}
                      {r.status === "approved" && (
                        <button onClick={() => lockMutation.mutate(r.id)} disabled={lockMutation.isPending} className="flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
                          <Lock className="h-3 w-3" /> Lock & Finalize
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd C:/Users/shivamg/mas-callnet-hrms && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/NativeSalaryAutomation.tsx
git commit -m "feat(phase9e): NativeSalaryAutomation — approve and lock monthly payroll runs"
```

---

### Task 14: NativeKPIDashboard Page

**Files:**
- Create: `src/pages/NativeKPIDashboard.tsx`

- [ ] **Step 1: Write the page**

```typescript
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export default function NativeKPIDashboard() {
  const { roleKeys, employeeId } = useWorkforceAccess();

  const { data: targets = [] } = useQuery({
    queryKey: ["kpi-targets", roleKeys],
    enabled: roleKeys.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kpi_target_master")
        .select("*")
        .in("role_key", roleKeys)
        .eq("active_status", true);
      if (error) throw error;
      return data ?? [];
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const { data: snapshots = [] } = useQuery({
    queryKey: ["kpi-snapshots", employeeId],
    enabled: !!employeeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_kpi_snapshot")
        .select("*")
        .eq("employee_id", employeeId!)
        .gte("snapshot_date", sevenDaysAgo)
        .lte("snapshot_date", today)
        .order("snapshot_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const snapshotMap: Record<string, any> = {};
  (snapshots as any[]).forEach((s) => {
    if (!snapshotMap[s.kpi_code]) snapshotMap[s.kpi_code] = s;
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-950">KPI Dashboard</h1>
          <p className="mt-1 text-slate-600">Role-aware KPI view — targets and actuals for your assigned roles.</p>
        </div>

        {roleKeys.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed p-8 text-center text-slate-500">
            <p>No roles assigned. Contact your admin to configure access.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {roleKeys.filter((k) => k !== "employee").map((k) => (
                <span key={k} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{k}</span>
              ))}
            </div>

            {(targets as any[]).length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed p-8 text-center text-slate-500">
                <p className="text-sm">No KPI targets configured for your roles yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {(targets as any[]).map((t) => {
                  const snap = snapshotMap[t.kpi_code];
                  const actual = snap?.actual_value ?? null;
                  const achievement = snap?.achievement_pct ?? null;
                  const trend = actual !== null && t.target_value !== null
                    ? actual >= t.target_value ? "up" : "down"
                    : "none";
                  return (
                    <div key={t.id} className="rounded-2xl border bg-white p-5 shadow-sm">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-xs font-semibold uppercase text-slate-400">{t.role_key}</p>
                          <p className="mt-1 font-semibold text-slate-950">{t.kpi_name}</p>
                        </div>
                        {trend === "up" && <TrendingUp className="h-5 w-5 text-green-600" />}
                        {trend === "down" && <TrendingDown className="h-5 w-5 text-red-500" />}
                        {trend === "none" && <Minus className="h-5 w-5 text-slate-300" />}
                      </div>
                      <div className="mt-4">
                        <p className="text-3xl font-bold text-slate-950">
                          {actual !== null ? `${actual}${t.unit === "percent" ? "%" : ""}` : "—"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          Target: {t.target_value}{t.unit === "percent" ? "%" : ` ${t.unit ?? ""}`}
                          {achievement !== null && ` · ${achievement.toFixed(0)}% achieved`}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd C:/Users/shivamg/mas-callnet-hrms && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/NativeKPIDashboard.tsx
git commit -m "feat(phase9f): NativeKPIDashboard — role-aware KPI targets and actuals with trend indicators"
```

---

### Task 15: Wire All New Routes + Sidebar

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/layout/DashboardLayout.tsx`

- [ ] **Step 1: Add imports to App.tsx**

After line 47 (`import UnifiedAccessControl from "./pages/UnifiedAccessControl";`), add:

```typescript
import NativeISParkMigration from "./pages/NativeISParkMigration";
import NativeDialerIntegration from "./pages/NativeDialerIntegration";
import NativeSalaryValidation from "./pages/NativeSalaryValidation";
import NativeLeaveManagement from "./pages/NativeLeaveManagement";
import NativeSalaryPrep from "./pages/NativeSalaryPrep";
import NativeRoleAccessManager from "./pages/NativeRoleAccessManager";
import NativeWFMRosterAssignment from "./pages/NativeWFMRosterAssignment";
import NativeSalaryAutomation from "./pages/NativeSalaryAutomation";
import NativeKPIDashboard from "./pages/NativeKPIDashboard";
```

- [ ] **Step 2: Add new routes to App.tsx**

After the `/settings/access-control` route (line 116), add:

```typescript
<Route path="/settings/role-access" element={<ProtectedRoute><Gate pageCode="ACCESS_CONTROL"><NativeRoleAccessManager /></Gate></ProtectedRoute>} />
<Route path="/wfm/roster-assignment" element={<ProtectedRoute><Gate pageCode="WFM_ROSTER"><NativeWFMRosterAssignment /></Gate></ProtectedRoute>} />
<Route path="/hr/ispark-migration" element={<ProtectedRoute><Gate pageCode="ACCESS_CONTROL"><NativeISParkMigration /></Gate></ProtectedRoute>} />
<Route path="/dialer/integration" element={<ProtectedRoute><Gate pageCode="DIALER_INTEGRATION"><NativeDialerIntegration /></Gate></ProtectedRoute>} />
<Route path="/salary/validation" element={<ProtectedRoute><Gate pageCode="SALARY_PREP"><NativeSalaryValidation /></Gate></ProtectedRoute>} />
<Route path="/salary/prep" element={<ProtectedRoute><Gate pageCode="SALARY_PREP"><NativeSalaryPrep /></Gate></ProtectedRoute>} />
<Route path="/salary/automation" element={<ProtectedRoute><Gate pageCode="SALARY_PREP"><NativeSalaryAutomation /></Gate></ProtectedRoute>} />
<Route path="/leave/management" element={<ProtectedRoute><Gate pageCode="LEAVE_MANAGEMENT"><NativeLeaveManagement /></Gate></ProtectedRoute>} />
<Route path="/kpi/dashboard" element={<ProtectedRoute><Gate pageCode="KPI_DASHBOARD"><NativeKPIDashboard /></Gate></ProtectedRoute>} />
```

- [ ] **Step 3: Add new nav items to DashboardLayout.tsx Workforce OS section**

Add to the Workforce OS navGroup items (after "Access Control" entry):

```typescript
{ label: "Role Access Manager",  href: "/settings/role-access",    icon: <Shield className="h-4 w-4" />,       pageCode: "ACCESS_CONTROL",    adminOnly: true,       description: "Configure role permissions per page" },
{ label: "Roster Assignment",    href: "/wfm/roster-assignment",   icon: <CalendarDays className="h-4 w-4" />,  pageCode: "WFM_ROSTER",        module: "WFM",         description: "Assign employees to shifts" },
{ label: "iSpark Migration",     href: "/hr/ispark-migration",     icon: <Upload className="h-4 w-4" />,        pageCode: "ACCESS_CONTROL",    adminOnly: true,       description: "Stage and validate iSpark employee data" },
{ label: "Dialer Integration",   href: "/dialer/integration",      icon: <Phone className="h-4 w-4" />,         pageCode: "DIALER_INTEGRATION", module: "DIALER",     description: "Dialer login hours import and view" },
{ label: "Salary Validation",    href: "/salary/validation",       icon: <AlertTriangle className="h-4 w-4" />, pageCode: "SALARY_PREP",       module: "SALARY",      description: "Attendance vs dialer discrepancy" },
{ label: "Salary Prep",          href: "/salary/prep",             icon: <CreditCard className="h-4 w-4" />,   pageCode: "SALARY_PREP",       module: "SALARY",      description: "Monthly salary preparation run" },
{ label: "Salary Automation",    href: "/salary/automation",       icon: <CreditCard className="h-4 w-4" />,   pageCode: "SALARY_PREP",       module: "SALARY",      description: "Approve and lock payroll runs" },
{ label: "Leave Management",     href: "/leave/management",        icon: <CalendarDays className="h-4 w-4" />,  pageCode: "LEAVE_MANAGEMENT",  description: "Native leave requests and approvals" },
{ label: "KPI Dashboard",        href: "/kpi/dashboard",           icon: <BarChart3 className="h-4 w-4" />,    pageCode: "KPI_DASHBOARD",     module: "KPI",         description: "Role-aware KPI targets and actuals" },
```

Add missing icon imports to DashboardLayout.tsx (add to lucide-react import):
`AlertTriangle, CalendarDays, Phone, Shield, Upload` — check that each is not already imported before adding.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd C:/Users/shivamg/mas-callnet-hrms && npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/layout/DashboardLayout.tsx
git commit -m "feat(phase9): wire all new routes and sidebar nav items for Milestone 2-5 pages"
```

---

### Task 16: Update page_code access for new pages in role_page_access

New page codes added: `DIALER_INTEGRATION`, `LEAVE_MANAGEMENT`, `SALARY_PREP`, `KPI_DASHBOARD`, `ISPARK_MIGRATION`.

- [ ] **Step 1: Insert access rows for admin role**

Run in Supabase SQL Editor:

```sql
-- Grant admin access to all new page codes
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  ('admin', 'DIALER_INTEGRATION', true, true, true, true, true, true),
  ('admin', 'LEAVE_MANAGEMENT',   true, true, true, true, true, true),
  ('admin', 'SALARY_PREP',        true, true, true, true, true, true),
  ('admin', 'KPI_DASHBOARD',      true, true, false, false, true, true),
  ('admin', 'ISPARK_MIGRATION',   true, true, true, true, true, true),
  ('hr',    'DIALER_INTEGRATION', true, true, true, false, true, true),
  ('hr',    'LEAVE_MANAGEMENT',   true, true, true, false, true, true),
  ('hr',    'SALARY_PREP',        true, true, true, false, true, true),
  ('hr',    'KPI_DASHBOARD',      true, false, false, false, true, true),
  ('manager','DIALER_INTEGRATION',true, false, false, false, true, true),
  ('manager','LEAVE_MANAGEMENT',  true, true, false, false, false, true),
  ('manager','KPI_DASHBOARD',     true, false, false, false, false, true),
  ('employee','LEAVE_MANAGEMENT', true, true, false, false, false, true),
  ('employee','KPI_DASHBOARD',    true, false, false, false, false, true)
ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Verify rows inserted**

```sql
SELECT role_key, page_code, can_view FROM role_page_access
WHERE page_code IN ('DIALER_INTEGRATION','LEAVE_MANAGEMENT','SALARY_PREP','KPI_DASHBOARD','ISPARK_MIGRATION')
ORDER BY role_key, page_code;
```
Expected: 14 rows.

- [ ] **Step 3: Commit**

Create a new SQL file for this seed data:

```bash
cat > supabase/sql/phase9g_new_page_access_seeds.sql << 'EOF'
-- phase9g_new_page_access_seeds.sql
-- Access grants for Phase 9 new page codes
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  ('admin', 'DIALER_INTEGRATION', true, true, true, true, true, true),
  ('admin', 'LEAVE_MANAGEMENT',   true, true, true, true, true, true),
  ('admin', 'SALARY_PREP',        true, true, true, true, true, true),
  ('admin', 'KPI_DASHBOARD',      true, true, false, false, true, true),
  ('admin', 'ISPARK_MIGRATION',   true, true, true, true, true, true),
  ('hr',    'DIALER_INTEGRATION', true, true, true, false, true, true),
  ('hr',    'LEAVE_MANAGEMENT',   true, true, true, false, true, true),
  ('hr',    'SALARY_PREP',        true, true, true, false, true, true),
  ('hr',    'KPI_DASHBOARD',      true, false, false, false, true, true),
  ('manager','DIALER_INTEGRATION',true, false, false, false, true, true),
  ('manager','LEAVE_MANAGEMENT',  true, true, false, false, false, true),
  ('manager','KPI_DASHBOARD',     true, false, false, false, false, true),
  ('employee','LEAVE_MANAGEMENT', true, true, false, false, false, true),
  ('employee','KPI_DASHBOARD',    true, false, false, false, false, true)
ON CONFLICT DO NOTHING;
EOF
git add supabase/sql/phase9g_new_page_access_seeds.sql
git commit -m "feat(phase9g): role_page_access seeds for new Phase 9 page codes"
```

---

## Plan Complete

When all 16 tasks are committed:

**Milestone 2 deliverables complete:**
- iSpark migration staging + validation RPC
- Dialer session log + NativeDialerIntegration page
- NativeSalaryValidation page (attendance vs dialer discrepancy)
- NativeLeaveManagement page (type master, requests, approvals)
- NativeSalaryPrep page (monthly run creation + line view)

**Milestone 3 deliverables complete:**
- NativeRoleAccessManager (full admin permission matrix)
- NativeWFMRosterAssignment (employee → shift assignment with date range)
- NativeSalaryAutomation (approve + lock payroll runs)
- KPI tables + NativeKPIDashboard (role-aware KPI targets + actuals)

**Cross-cutting (from Plan 9A):**
- Tenant module config gating (ATS/LMS/WFM/QUALITY/OPERATIONS/PERFORMANCE/DIALER/SALARY/KPI)
- All 5 placeholder routes fixed

**Remaining for Milestone 4-5 (out of scope for this plan):**
- UAT checklist document (8 roles)
- WFM Stabilization: centralized SQL for process data sync
- Database migration: Supabase → MySQL + teammas.in deployment
