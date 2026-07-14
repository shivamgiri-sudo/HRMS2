# My Team Page Investigation Report

**Date:** 2026-07-14  
**Issue:** `/my-team` page missing HRMS sidebar and data not loading properly  
**APR Table Check:** Investigating whether `apr` table exists and is being used

---

## Issue 1: Missing Sidebar in My Team Page

### Root Cause
[MyTeamPage.tsx:76-140](src/pages/MyTeamPage.tsx#L76-L140) does NOT wrap its content in `DashboardLayout` or `CompactDashboardLayout`.

The page returns raw JSX with a custom gradient header and tabs, but no layout wrapper that provides the HRMS sidebar.

### Comparison with Other Pages
- **EmployeeSelfDashboard** ([src/pages/dashboards/EmployeeSelfDashboard.tsx:1-40](src/pages/dashboards/EmployeeSelfDashboard.tsx#L1-L40)): Uses `RoleDashboardShell` component
- **Index page** (Dashboard): Wrapped in layout via App.tsx route structure
- **All other HRMS pages**: Get sidebar automatically through App.tsx routing

### Current MyTeamPage Structure
```tsx
export default function MyTeamPage() {
  // ... auth checks ...
  
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Custom gradient header */}
      <div className="bg-gradient-to-br from-slate-900...">
        {/* Tabs and content - NO SIDEBAR */}
      </div>
    </div>
  );
}
```

### Fix Required
Wrap the entire page content in `DashboardLayout`:

```tsx
import { DashboardLayout } from "@/components/layout/DashboardLayout";

export default function MyTeamPage() {
  // ... existing code ...
  
  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50">
        {/* existing content */}
      </div>
    </DashboardLayout>
  );
}
```

---

## Issue 2: Data Not Loading Properly

### Backend API Status
The following endpoints are defined in [backend/src/modules/management/management.routes.ts](backend/src/modules/management/management.routes.ts):

1. **`GET /api/management/team-overview`** ([management.routes.ts:199-220](backend/src/modules/management/management.routes.ts#L199-L220))
   - ✅ Endpoint exists
   - Returns: `{ headcount, utilization_pct, avg_quality_score, monthly_cost }`
   - Requires role: `admin`, `hr`, `manager`, `branch_head`, `ceo`, `process_manager`

2. **`GET /api/management/alerts`** ([management.routes.ts:66-76](backend/src/modules/management/management.routes.ts#L66-L76))
   - ✅ Endpoint exists
   - Used by MyTeamPage for action badges
   - Role-based scope resolution (managers see only their team)

3. **`GET /api/leave/requests?status=pending`**
   - ✅ Leave module endpoint (separate module)
   - Used for leave badge count

### Data Flow Check
[MyTeamPage.tsx:37-47](src/pages/MyTeamPage.tsx#L37-L47):
```tsx
const { data: alertsData } = useQuery({
  queryKey: ["management", "alerts", "unack"],
  queryFn: () => hrmsApi.get<any>("/api/management/alerts?acknowledged=false"),
});
const { data: leaveData } = useQuery({
  queryKey: ["team-leaves", "pending"],
  queryFn: () => hrmsApi.get<any>("/api/leave/requests?status=pending&limit=200"),
});
```

### Potential Issues
1. **Missing Layout**: Without `DashboardLayout`, the page doesn't get proper positioning/padding
2. **API Authentication**: All `/api/management/*` endpoints require `requireAuth` middleware
3. **Role Scope**: Non-admin managers only see data for their direct reports
4. **Data Transform**: `TeamOverviewTab` component may have incorrect data field mapping

---

## Issue 3: APR Table Usage

### What is APR?
APR stands for **Agent Performance Records** from the Vicidial dialer system. It's an **external database** connection, NOT a table in `mas_hrms`.

### Architecture
1. **External DB Config** ([backend/src/db/aprDb.ts](backend/src/db/aprDb.ts#L1-L8)):
   - Uses `getPoolForKey('apr_productivity')` to connect to external database
   - Connection managed via `external_db_credentials` table in `mas_hrms`

2. **APR Tables Referenced** ([backend/src/modules/kpi/kpi-data-connector.service.ts:5-14](backend/src/modules/kpi/kpi-data-connector.service.ts#L5-L14)):
   ```typescript
   const APR_TABLES = [
     'vicidial_agent_log_10_25',
     'vicidial_agent_log_10_4',
     'vicidial_agent_log_11_4',
     'vicidial_agent_log_11_5',
     'vicidial_agent_log_247',
     'vicidial_agent_log_249',
     'vicidial_agent_log_250',
     'vicidial_agent_log_9',
   ];
   ```

3. **Migration 101** ([backend/sql/migrations/101_apr_enrich_columns.sql](backend/sql/migrations/101_apr_enrich_columns.sql)):
   - Adds enrichment columns to APR table: `employee_name`, `process_name`, `branch_name`, `reporting_manager`, `cost_centre`
   - This assumes an `apr` table exists in an **external database**

### Is APR Table Being Used?
✅ **YES** - APR data is actively used for:
- KPI sync via [kpi-data-connector.service.ts](backend/src/modules/kpi/kpi-data-connector.service.ts)
- Attendance tracking for Operations/APR employees ([attendance-engine.service.ts](backend/src/modules/wfm/attendance-engine.service.ts))
- Talk time, dial count, ACW metrics
- Synced into `mas_hrms.kpi_daily_actual` table

### Connection Status
⚠️ **Requires Configuration**:
- APR connection must be configured in `external_db_credentials` table
- Environment variables or DB credentials required
- If connection fails, KPI sync silently skips APR data ([kpi-data-connector.service.ts:105-108](backend/src/modules/kpi/kpi-data-connector.service.ts#L105-L108))

---

## Recommended Fixes

### Priority 1: Fix Missing Sidebar
**File:** [src/pages/MyTeamPage.tsx](src/pages/MyTeamPage.tsx)

```diff
+ import { DashboardLayout } from "@/components/layout/DashboardLayout";

  export default function MyTeamPage() {
    // ... existing code ...
    
    return (
+     <DashboardLayout>
        <div className="min-h-screen bg-slate-50">
          {/* ── Rich gradient page header ── */}
          <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 px-4 pb-0 pt-6 sm:px-6">
            {/* ... existing tabs and content ... */}
          </div>
        </div>
+     </DashboardLayout>
    );
  }
```

### Priority 2: Verify API Data Flow
1. Check browser DevTools Network tab for failed API calls
2. Verify JWT token is being sent in Authorization header
3. Check if user has required role (`manager`, `process_manager`, etc.)
4. Verify `TeamOverviewTab` component data prop mapping

### Priority 3: APR Connection Verification
If team performance data is missing:

1. **Check external DB config**:
   ```sql
   SELECT * FROM mas_hrms.external_db_credentials WHERE connection_key = 'apr_productivity';
   ```

2. **Verify APR tables exist** in external database (not in `mas_hrms`)

3. **Check KPI sync logs** for APR connection errors

---

## Summary

| Issue | Status | Action Required |
|-------|--------|----------------|
| Missing sidebar in `/my-team` | 🔴 **CONFIRMED** | Wrap page in `DashboardLayout` |
| Data not loading | 🟡 **NEEDS TESTING** | Check API auth + role scope |
| APR table usage | ✅ **ACTIVE** | External DB, working as designed |
| APR in `mas_hrms` | ❌ **NOT APPLICABLE** | APR is external database, not local table |

**Next Steps:**
1. Apply sidebar layout fix to MyTeamPage.tsx
2. Test page with authenticated manager account
3. Verify all tab data loads correctly
4. Optional: Check APR external DB connection if KPI metrics are missing
