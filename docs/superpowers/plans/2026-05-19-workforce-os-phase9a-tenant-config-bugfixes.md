# Phase 9A — Tenant Module Config & Route Bug Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire plug-and-play tenant module config so any module can be enabled/disabled per company, and fix 5 routes that incorrectly point to NativePlaceholderPage instead of real pages.

**Architecture:** A `tenant_module_config` Supabase table + `useTenantModules` React hook control which Workforce OS modules show in the sidebar and have routes rendered. DashboardLayout reads the hook and filters its navGroups. App.tsx route imports are already missing for 5 real pages — fix those imports and swap `NativePlaceholderPage` for the real components.

**Tech Stack:** Supabase PostgreSQL, React 18 + TypeScript + Vite, TanStack Query, `@/hooks/useUserRole` pattern.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `supabase/sql/phase9a_tenant_module_config.sql` | Create | Tables + seed data for module config |
| `src/hooks/useTenantModules.ts` | Create | Hook returning `isModuleEnabled(key)` |
| `src/components/layout/DashboardLayout.tsx` | Modify | Filter Workforce OS nav items by module config |
| `src/App.tsx` | Modify | Fix 5 placeholder routes, add module-gated routes |

---

### Task 1: Tenant Module Config SQL

**Files:**
- Create: `supabase/sql/phase9a_tenant_module_config.sql`

- [ ] **Step 1: Write the SQL file**

```sql
-- phase9a_tenant_module_config.sql
-- Plug-and-play tenant module configuration

CREATE TABLE IF NOT EXISTS tenant_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL UNIQUE DEFAULT 'default',
  company_name text,
  active_status boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_module_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL DEFAULT 'default',
  module_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  config_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_key, module_key)
);

ALTER TABLE tenant_module_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_config_select_all" ON tenant_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "tenant_module_config_select_all" ON tenant_module_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "tenant_module_config_write_admin" ON tenant_module_config FOR ALL TO authenticated
  USING (is_admin_or_hr(auth.uid()))
  WITH CHECK (is_admin_or_hr(auth.uid()));

-- Seed: default tenant with all modules enabled
INSERT INTO tenant_config (tenant_key, company_name) VALUES ('default', 'MAS Callnet') ON CONFLICT (tenant_key) DO NOTHING;

INSERT INTO tenant_module_config (tenant_key, module_key, enabled) VALUES
  ('default', 'ATS',        true),
  ('default', 'LMS',        true),
  ('default', 'WFM',        true),
  ('default', 'QUALITY',    true),
  ('default', 'OPERATIONS', true),
  ('default', 'PERFORMANCE',true),
  ('default', 'DIALER',     false),
  ('default', 'SALARY',     false),
  ('default', 'KPI',        false)
ON CONFLICT (tenant_key, module_key) DO NOTHING;
```

- [ ] **Step 2: Run in Supabase SQL Editor**
Open Supabase dashboard → SQL Editor → paste file → Run. Expect: no errors, tables created, 1 tenant_config row + 9 tenant_module_config rows.

- [ ] **Step 3: Commit**

```bash
git add supabase/sql/phase9a_tenant_module_config.sql
git commit -m "feat(phase9a): tenant_module_config table with default module seeds"
```

---

### Task 2: useTenantModules Hook

**Files:**
- Create: `src/hooks/useTenantModules.ts`

- [ ] **Step 1: Write the hook**

```typescript
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type TenantModuleRow = { module_key: string; enabled: boolean };

export const useTenantModules = (tenantKey = "default") => {
  const { data, isLoading } = useQuery({
    queryKey: ["tenant-module-config", tenantKey],
    queryFn: async (): Promise<TenantModuleRow[]> => {
      const { data, error } = await supabase
        .from("tenant_module_config")
        .select("module_key, enabled")
        .eq("tenant_key", tenantKey);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });

  const isModuleEnabled = useMemo(() => {
    if (!data) return (_key: string) => true; // default open while loading
    const map = new Map(data.map((r) => [r.module_key, r.enabled]));
    return (key: string) => map.get(key) ?? true;
  }, [data]);

  return { isModuleEnabled, isLoading };
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd C:/Users/shivamg/mas-callnet-hrms && npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useTenantModules.ts
git commit -m "feat(phase9a): useTenantModules hook for plug-and-play module gating"
```

---

### Task 3: Wire DashboardLayout to Module Config

**Files:**
- Modify: `src/components/layout/DashboardLayout.tsx`

The Workforce OS section `navGroups` items need a `module` field so the sidebar can filter by `isModuleEnabled`. Each nav item already has a `pageCode` field. Add a `module` field to `NavItem` and populate it for Workforce OS items, then filter in `filteredNavGroups`.

- [ ] **Step 1: Add `module` field to NavItem interface**

In `DashboardLayout.tsx`, find the `NavItem` interface (line ~48) and add `module?: string`:

```typescript
interface NavItem {
  label: string;
  href: string;
  icon: ReactNode;
  badge?: number;
  adminOnly?: boolean;
  employeeOnly?: boolean;
  pageCode?: string;
  module?: string;
  description?: string;
}
```

- [ ] **Step 2: Add module keys to Workforce OS navGroup items**

Find the Workforce OS navGroup items (lines ~109-122) and add `module` to each:

```typescript
{
  title: "Workforce OS",
  items: [
    { label: "ATS Dashboard",             href: "/ats/dashboard",                  icon: <UserPlus className="h-4 w-4" />,   pageCode: "ATS_DASHBOARD",             module: "ATS",         description: "Recruitment command center" },
    { label: "My Candidate Queue",         href: "/ats/recruiter/my-candidates",    icon: <ClipboardList className="h-4 w-4" />, pageCode: "ATS_RECRUITER_QUEUE",    module: "ATS",         description: "Assigned recruitment queue" },
    { label: "My Learning",               href: "/lms/my-learning",                icon: <BookOpen className="h-4 w-4" />,   pageCode: "LMS_MY_LEARNING",           module: "LMS",         description: "Learning path and assigned modules" },
    { label: "LMS Coordinator",           href: "/lms/coordinator",                icon: <Users className="h-4 w-4" />,      pageCode: "LMS_COORDINATOR",           module: "LMS",         description: "Training batch and trainee coordination" },
    { label: "LMS Admin",                 href: "/lms/admin",                      icon: <BookOpen className="h-4 w-4" />,   pageCode: "LMS_ADMIN",                 module: "LMS",         description: "Curriculum, content and rules" },
    { label: "LMS Management",            href: "/lms/management-dashboard",       icon: <BarChart3 className="h-4 w-4" />,  pageCode: "LMS_MANAGEMENT_DASHBOARD",  module: "LMS",         description: "Training management dashboard" },
    { label: "Roster Planning",           href: "/wfm/roster",                     icon: <Clock className="h-4 w-4" />,      pageCode: "WFM_ROSTER",                module: "WFM",         description: "WFM roster and shift planning" },
    { label: "WFM Live Tracker",          href: "/wfm/live-tracker",               icon: <Clock className="h-4 w-4" />,      pageCode: "WFM_LIVE_TRACKER",          module: "WFM",         description: "Live shift and break tracker" },
    { label: "Quality Dashboard",         href: "/quality/dashboard",              icon: <ShieldCheck className="h-4 w-4" />, pageCode: "QUALITY_DASHBOARD",        module: "QUALITY",     description: "Quality, defects and coaching" },
    { label: "Operations Dashboard",      href: "/operations/dashboard",           icon: <Activity className="h-4 w-4" />,   pageCode: "OPERATIONS_DASHBOARD",      module: "OPERATIONS",  description: "Process productivity and SLA" },
    { label: "Performance Command Center", href: "/performance/command-center",    icon: <BarChart3 className="h-4 w-4" />,  pageCode: "WORKFORCE_COMMAND_CENTER",  module: "PERFORMANCE", description: "Unified workforce intelligence" },
    { label: "Access Control",            href: "/settings/access-control",        icon: <Settings className="h-4 w-4" />,   pageCode: "ACCESS_CONTROL",            adminOnly: true,       description: "Role and page access management" },
  ],
},
```

- [ ] **Step 3: Import useTenantModules and filter by module**

At top of file, add import after line 43 (`import { useIsAdminOrHR, useWorkforceAccess } from "@/hooks/useUserRole";`):

```typescript
import { useTenantModules } from "@/hooks/useTenantModules";
```

Inside `DashboardLayout` function (after line 143 `const { canViewPage, visiblePageCodes } = useWorkforceAccess();`), add:

```typescript
const { isModuleEnabled } = useTenantModules();
```

In `filteredNavGroups` useMemo, add module check to the filter (after the `pageCode` check block):

```typescript
const filteredNavGroups = useMemo(() => {
  const visibleSet = new Set(visiblePageCodes);
  return navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.module && !isModuleEnabled(item.module)) return false;
        if (item.pageCode) {
          return visibleSet.has(item.pageCode) || canViewPage(item.pageCode);
        }
        if (item.adminOnly && !isAdminOrHR) return false;
        if (item.employeeOnly && isAdminOrHR) return false;
        return true;
      }),
    }))
    .filter((group) => group.items.length > 0);
}, [isAdminOrHR, canViewPage, visiblePageCodes, isModuleEnabled]);
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd C:/Users/shivamg/mas-callnet-hrms && npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/DashboardLayout.tsx
git commit -m "feat(phase9a): filter Workforce OS sidebar items by tenant module config"
```

---

### Task 4: Fix Route Bug — 5 Placeholder Routes

**Files:**
- Modify: `src/App.tsx`

Five routes currently point to `NativePlaceholderPage` instead of real pages that already exist:
1. `/wfm/live-tracker` → `NativeWFMLiveTracker`
2. `/quality/dashboard` → `NativeQualityDashboard`
3. `/operations/dashboard` → `NativeOperationsDashboard`
4. `/lms/admin` → `NativeLMSAdmin`
5. `/lms/management-dashboard` → `NativeLMSManagementDashboard`

- [ ] **Step 1: Add missing imports to App.tsx**

After line 45 (`import NativeWFMRoster from "./pages/NativeWFMRoster";`), add:

```typescript
import NativeWFMLiveTracker from "./pages/NativeWFMLiveTracker";
import NativeQualityDashboard from "./pages/NativeQualityDashboard";
import NativeOperationsDashboard from "./pages/NativeOperationsDashboard";
import NativeLMSAdmin from "./pages/NativeLMSAdmin";
import NativeLMSManagementDashboard from "./pages/NativeLMSManagementDashboard";
```

- [ ] **Step 2: Replace placeholder routes with real components**

Replace line 109 (`/lms/admin`):
```typescript
<Route path="/lms/admin" element={<ProtectedRoute><Gate pageCode="LMS_ADMIN"><NativeLMSAdmin /></Gate></ProtectedRoute>} />
```

Replace line 110 (`/lms/management-dashboard`):
```typescript
<Route path="/lms/management-dashboard" element={<ProtectedRoute><Gate pageCode="LMS_MANAGEMENT_DASHBOARD"><NativeLMSManagementDashboard /></Gate></ProtectedRoute>} />
```

Replace line 112 (`/wfm/live-tracker`):
```typescript
<Route path="/wfm/live-tracker" element={<ProtectedRoute><Gate pageCode="WFM_LIVE_TRACKER"><NativeWFMLiveTracker /></Gate></ProtectedRoute>} />
```

Replace line 113 (`/quality/dashboard`):
```typescript
<Route path="/quality/dashboard" element={<ProtectedRoute><Gate pageCode="QUALITY_DASHBOARD"><NativeQualityDashboard /></Gate></ProtectedRoute>} />
```

Replace line 114 (`/operations/dashboard`):
```typescript
<Route path="/operations/dashboard" element={<ProtectedRoute><Gate pageCode="OPERATIONS_DASHBOARD"><NativeOperationsDashboard /></Gate></ProtectedRoute>} />
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd C:/Users/shivamg/mas-callnet-hrms && npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "fix(routes): wire NativeWFMLiveTracker, NativeQualityDashboard, NativeOperationsDashboard, NativeLMSAdmin, NativeLMSManagementDashboard — replace placeholder routes"
```

---

## Plan complete

After all 4 tasks pass TypeScript check and are committed:
- `tenant_module_config` SQL is in Supabase
- `useTenantModules` hook provides `isModuleEnabled(key)`
- Sidebar hides modules that are disabled per tenant
- All 5 previously-broken routes now load real pages

Continue with `2026-05-19-workforce-os-phase9b-milestone2-5.md` for the remaining milestone deliverables.
