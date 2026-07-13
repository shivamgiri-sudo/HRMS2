# PeopleOS Org Navigator — Comprehensive Audit Report

**Date:** 2026-07-13  
**Status:** Audit Mode (No Code Changes)  
**Objective:** Build role-scoped org chart with data quality validation

---

## 1. CURRENT ARCHITECTURE AUDIT

### 1.1 Authentication & Authorization Layer

**Existing Components:**
- `backend/src/middleware/authMiddleware.ts` — JWT-based auth with demo token bypass
- `backend/src/middleware/requireRole.ts` — Role-based access control with aliases (process_manager ↔ manager, team_leader ↔ tl)
- `backend/src/modules/access/access.service.ts` — MySQL-authoritative RBAC (no Supabase)
- `backend/src/shared/accessGuard.ts` — Scope enforcement for process/branch/team workflows

**Key Patterns:**
- Single source of truth: MySQL `user_roles` table (role_key, active_status)
- Demo bypass for testing with `mock-token-{role}` tokens
- Role aliases for backward compatibility
- Scope types: `all`, `process`, `team`, `branch`

**Org Chart Fit:**
- ✅ Can leverage existing `requireAuth` + `requireRole` middleware
- ✅ Can use existing scope logic from `accessGuard.ts` (hasProcessScope, etc.)
- ⚠️ Scope assignment is via `user_assignment_scope` table (process_id, branch_id, scope_type)
- ⚠️ Need to audit which roles map to which scope types for org chart access

---

### 1.2 Employee Data Structure

**Master Table:** `employees`

**Key Columns:**
```
id (UUID, PK)
employee_code (VARCHAR 50, UNIQUE)
user_id (FK → auth_user.id, nullable)
first_name, last_name, full_name (GENERATED)
branch_id (FK → branch_master.id)
process_id (FK → process_master.id)
department_id (FK → department_master.id)
designation_id (FK → designation_master.id)
reporting_manager_id (CHAR(36), self-ref FK → employees.id)
employment_status ('Active', 'Inactive', etc.)
active_status (TINYINT, 0|1)
photo_url, avatar_url (nullable)
date_of_joining, date_of_exit
```

**Reporting Manager Mapping:**
- Primary: `reporting_manager_id` (self-referential FK)
- Fallback in code: `manager_id` (seen in employee.service.ts)
- **Data Quality Issue:** 369 of 1343 employees have NULL `reporting_manager_id` (27% of workforce)
  - Real roots (seniority ≤1, no manager): 8
  - Orphans (seniority >1, no manager): 361 (26% of data quality risk)

**Existing Indexes:**
- idx_emp_code, idx_emp_user, idx_emp_branch, idx_emp_process

**Org Chart Dependency:**
- ✅ Reporting manager chain is in place for 974 employees (72%)
- ⚠️ 369 employees are tree roots (orphans without explicit parent)
- ✅ Branch, process, department, designation data is available for filtering
- ✅ Active status and employment status can be used for visibility rules

---

### 1.3 Role and Scope Architecture

**Role Catalog Table:** `workforce_role_catalog`
- Defines all valid roles (super_admin, admin, hr, branch_head, process_manager, team_leader, employee, etc.)

**User Roles Mapping:** `user_roles`
- user_id → role_key (many-to-many)
- active_status (soft delete flag)
- A user can have multiple roles

**User Assignment Scope:** `user_assignment_scope`
- Links user to process_id, branch_id, or 'all' access
- scope_type: 'all', 'process', 'team', 'branch'
- Used by process managers, branch heads, WFM to scope their operations

**Org Chart Scope Matrix (from accessGuard.ts logic):**

| Role | Scope Type | Scope Rule |
|---|---|---|
| super_admin, admin | all | See entire company |
| ceo, hr | all (typically) | See entire company or mapped branch/process |
| branch_head | branch | See branch_id employees only |
| process_manager, manager | process | See process_id employees only |
| team_leader, tl | process or team | See process_id OR direct reports only |
| wfm, operations_manager | branch or process | See mapped scope |
| employee | self/team | See own reporting chain + direct reports |
| client | process (portal) | See process metrics only (NOT individual employees) |

**Existing Access Control Pattern:**
```typescript
// From accessGuard.ts
export async function hasProcessScope(
  userId: string,
  processId: string,
  branchId?: string | null
): Promise<boolean> {
  // Query user_assignment_scope
  // Returns true if user has matching scope
}
```

**Org Chart Implication:**
- ✅ Can reuse `hasProcessScope` for filtering
- ✅ Can detect user's employee record to find direct reports
- ⚠️ Scope assignment must be audited to ensure org chart respects the same rules
- ✅ Role aliases already handle process_manager ↔ manager variations

---

### 1.4 Existing Org Modules

**Module:** `backend/src/modules/org/`

**Files:**
- `org.routes.ts` — Masters (branch, process, department, designation, LOB, etc.)
- `org.service.ts` — CRUD for org masters
- `org_settings.routes.ts` — Org configuration
- `events.routes.ts` — Org event logging

**Current Scope:**
- Masters maintenance only (no employee reporting structure)
- No org chart visualization or tree building
- No data quality checks

**Org Chart Fit:**
- ✅ Can extend `org.service.ts` or create new `org-chart.service.ts` alongside
- ✅ Org masters (branch, process, department) are already modeled
- ✅ Can add org chart routes to existing module

---

### 1.5 Existing Employee Routes & Security

**Module:** `backend/src/modules/employees/`

**Key Routes:**
- `employee.routes.ts` — Main CRUD (list, create, update, get)
- `employee.secure.routes.ts` — Sensitive operations (salary, bank, tax)
- Other specialized routes (compliance, documents, photo, etc.)

**Existing Patterns:**
- All routes use `requireAuth` first
- Sensitive routes use `requireRole("admin", "hr")`
- Some use row-scope checks (via `accessGuard.ts`)

**Current Tree Endpoint (from earlier work):**
- `GET /api/employees/org-tree` — Returns org chart tree (role-scoped)
- Implemented in `employee.service.ts`
- **Issues:** Only shows explicit reporting_manager_id chains (428 roots when company-wide, 6 roots per process)

**Org Chart Fit:**
- ✅ Can extend with new endpoints under `/api/org-chart/` (separate from employees)
- ✅ Can reuse `requireAuth` and access patterns
- ⚠️ Must NOT return PII (salary, bank, tax, DOB, mobile, email)
- ✅ Can mask employee_code (show last 4 digits only)

---

### 1.6 Existing Frontend Architecture

**Stack:** React 18 + TypeScript + Vite + Tailwind + shadcn/ui

**Existing Pages:**
- `src/App.tsx` — Route definitions with lazy loading
- `src/pages/` — Existing pages (employees, dashboard, etc.)
- `src/components/` — Reusable components

**Navigation:**
- `src/components/layout/navConfig.tsx` — Route configuration for sidebar nav
- Page codes for access control (e.g., `pageCode: "ORG_CHART"`)

**Existing Patterns:**
- `useQuery` for data fetching
- Role-based route gating in `<ProtectedRoute>` + `<Gate pageCode="...">`
- Component-level auth with `useWorkforceAccess()` hook

**Org Chart Fit:**
- ✅ Can follow existing pattern: lazy import + route + nav item
- ✅ Can reuse `useWorkforceAccess()` for role detection
- ✅ Can use existing shadcn/ui components (Select, Input, Dialog, etc.)
- ⚠️ Graph visualization requires new library (D3, ELK, or custom SVG)

---

## 2. EXISTING TABLES & FIELDS AVAILABLE FOR ORG CHART

### Master Tables (Read-Only for Org Chart)

| Table | Key Fields | Org Chart Use |
|---|---|---|
| employees | id, employee_code, first_name, last_name, reporting_manager_id, branch_id, process_id, department_id, designation_id, employment_status, active_status, avatar_url | Tree nodes, filtering, display |
| branch_master | id, branch_name, active_status | Node labels, filtering |
| process_master | id, process_name, active_status | Node labels, filtering |
| department_master | id, dept_name, active_status | Node labels, filtering |
| designation_master | id, designation_name, active_status | Node labels, hierarchy inference |
| user_roles | user_id, role_key, active_status | Role-based access control |
| user_assignment_scope | user_id, scope_type, process_id, branch_id | Scope-based filtering |
| auth_user | id, email | User identity matching |

### Audit/Logging Tables (Recommended New)

| Table | Purpose | Org Chart Impact |
|---|---|---|
| org_chart_snapshot | Cache org tree for performance | Optional, Phase 2+ |
| org_chart_access_log | Audit every view + export | Mandatory for compliance |
| org_chart_data_issue | Flag missing/invalid manager links | Mandatory for data quality |
| org_chart_override | Manual corrections (future) | Phase 3+, not Phase 1 |

---

## 3. ROUTE & PAGE DEPENDENCY MAPPING

### Existing Security Middleware

```
requireAuth
  ↓
requireRole("admin", "hr", "process_manager", ...)
  ↓
accessGuard.hasProcessScope(userId, processId, branchId)
```

### Proposed Org Chart Routes

```
GET  /api/org-chart/scopes
  → Lists available scopes for logged-in user (my-chain, my-team, process, branch, company)
  → Requires: requireAuth

GET  /api/org-chart/tree
  → Returns org tree for requested scope + filters
  → Query: ?scope=process&scope_id=...&employee_id=...
  → Requires: requireAuth + scope validation

GET  /api/org-chart/node/:employeeId
  → Returns single node detail (filtered by requestor's scope)
  → Requires: requireAuth + row-scope check

GET  /api/org-chart/search
  → Search employees by name/code within scope
  → Requires: requireAuth

GET  /api/org-chart/data-quality
  → Detect missing managers, orphans, mismatches
  → Requires: requireAuth + requireRole("admin", "hr")

POST /api/org-chart/rebuild-cache
  → Rebuild org tree snapshot cache (admin only)
  → Requires: requireAuth + requireRole("admin")

GET  /api/org-chart/export
  → Export tree as CSV/Excel (audit logged)
  → Requires: requireAuth + requireRole("admin", "hr")
```

### Existing Frontend Routes

- `/employees` → Employee list (existing)
- `/org-chart` → **NEW** Org chart main page
- `/org-chart/settings` → **NEW** Org chart config (admin only)

### Protected Routes Pattern

```typescript
<Route path="/org-chart" element={
  <ProtectedRoute>
    <Gate pageCode="ORG_CHART">
      <NativeOrgChart />
    </Gate>
  </ProtectedRoute>
} />
```

---

## 4. GAP ANALYSIS

### What Exists ✅

1. **Auth & Roles:** MySQL user_roles + role aliases + demo bypass
2. **Scope System:** user_assignment_scope table + hasProcessScope() logic
3. **Employee Master:** reporting_manager_id chain + branch/process/designation
4. **Frontend Stack:** React + shadcn/ui + role-based routing
5. **Org Masters:** branch, process, department, designation tables

### What's Missing ❌

1. **Org Chart Visualization:**
   - No tree layout algorithm (D3, ELK, or custom SVG)
   - No node card component for display
   - No zoom/pan/search/filter UI
   - No data quality warning display

2. **Backend Org Chart API:**
   - No `/api/org-chart/*` routes
   - No org chart builder (tree algorithm)
   - No scope enforcer for org chart (different from accessGuard)
   - No data quality validator
   - No audit logger for chart views

3. **Data Quality:**
   - No detection of missing managers (369 orphans)
   - No detection of circular references
   - No detection of cross-branch manager mismatches
   - No detection of unmapped employees

4. **Export & Audit:**
   - No export functionality
   - No access log for org chart views
   - No masking rules for sensitive fields

5. **Frontend Components:**
   - No org chart page
   - No search/filter/scope selector UI
   - No data quality panel
   - No node details drawer
   - No settings page

---

## 5. EXACT FILE LIST TO CREATE/MODIFY

### Backend New Files

```
backend/src/modules/org-chart/
├── org-chart.routes.ts          — API routes
├── org-chart.service.ts         — Business logic (tree builder, API responses)
├── org-chart.builder.ts         — Tree algorithm (build nodes + edges)
├── org-chart.scope.ts           — Scope validation (role-based access)
├── org-chart.validation.ts      — Input validation + data quality checks
├── org-chart.audit.ts           — Audit logging (views, exports)
└── org-chart.types.ts           — TypeScript interfaces
```

### Backend Modified Files

```
backend/src/app.ts              — Add org-chart router
backend/sql/XXX_org_chart_tables.sql  — New tables (snapshots, audit, issues)
```

### Frontend New Files

```
src/pages/
├── NativeOrgChart.tsx           — Main org chart page
└── OrgChartSettings.tsx         — Admin settings page

src/components/org-chart/
├── OrgChartCanvas.tsx           — SVG/D3 canvas
├── OrgNodeCard.tsx              — Single node component
├── OrgScopeSelector.tsx         — Scope dropdown
├── OrgSearchBar.tsx             — Search input
├── OrgMiniMap.tsx               — Overview mini-map
├── OrgDataQualityPanel.tsx      — Data issues display
├── OrgNodeDetailsDrawer.tsx     — Node details on click
├── OrgChartFilters.tsx          — Branch/process/dept/status filters
└── OrgChartExportButton.tsx     — Export dialog

src/types/
└── org-chart.ts                 — TypeScript types for frontend
```

### Frontend Modified Files

```
src/App.tsx                      — Add lazy route
src/components/layout/navConfig.tsx  — Add nav item
```

---

## 6. DATABASE MIGRATION PLAN

### Phase 1 (Audit Only) — NO SQL

### Phase 2+ (Additive Only)

**New Tables (if approved):**

```sql
-- Snapshot cache for performance
CREATE TABLE org_chart_snapshot (
  id CHAR(36) PRIMARY KEY,
  scope_type ENUM('my-chain', 'my-team', 'process', 'branch', 'company'),
  scope_id CHAR(36),  -- process_id or branch_id or NULL for company
  user_id CHAR(36),
  snapshot_data LONGTEXT (JSON),  -- { nodes: [...], edges: [...], tree: [...] }
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,
  KEY (user_id, scope_type, scope_id),
  FOREIGN KEY (user_id) REFERENCES auth_user(id)
);

-- Audit log for views + exports
CREATE TABLE org_chart_access_log (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  action ENUM('view', 'export', 'filter') NOT NULL,
  scope_type VARCHAR(50),
  scope_id CHAR(36),
  filters JSON,  -- { branch_id, process_id, designation_id, ... }
  exported_count INT,  -- if action='export'
  ip_address VARCHAR(45),
  user_agent VARCHAR(500),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY (user_id, created_at),
  FOREIGN KEY (user_id) REFERENCES auth_user(id)
);

-- Data quality issues
CREATE TABLE org_chart_data_issue (
  id CHAR(36) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  issue_type ENUM(
    'missing_manager',
    'inactive_manager',
    'circular_reference',
    'cross_branch_mismatch',
    'process_mismatch',
    'unmapped_employee',
    'duplicate_reporting'
  ) NOT NULL,
  severity ENUM('warning', 'error') NOT NULL,
  details JSON,
  flagged_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME,
  KEY (employee_id, issue_type),
  KEY (resolved_at),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

-- Future: manual overrides (Phase 3)
CREATE TABLE org_chart_override (
  id CHAR(36) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  override_type ENUM('reporting_manager', 'scope_visibility', 'display_name'),
  override_value JSON,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  active_status TINYINT DEFAULT 1,
  UNIQUE KEY (employee_id, override_type),
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (created_by) REFERENCES auth_user(id)
);
```

**No migrations for Phase 1** — read-only from existing tables only.

---

## 7. API CONTRACT

### Response Format (All Endpoints)

```json
{
  "success": true,
  "data": { ... },
  "error": null,
  "timestamp": "2026-07-13T10:30:00Z"
}
```

### GET /api/org-chart/scopes

**Purpose:** List available scopes for logged-in user

**Response:**
```json
{
  "success": true,
  "data": {
    "user_id": "uuid",
    "employee_id": "uuid",
    "available_scopes": [
      {
        "scope_type": "my-chain",
        "label": "My Reporting Chain",
        "description": "Me + my manager chain + my direct reports"
      },
      {
        "scope_type": "my-team",
        "label": "My Team",
        "description": "All direct reports under me"
      },
      {
        "scope_type": "process",
        "processes": [
          { "id": "uuid", "name": "Onfido", "employee_count": 173 },
          { "id": "uuid", "name": "Housing.com", "employee_count": 87 }
        ]
      },
      {
        "scope_type": "branch",
        "branches": [
          { "id": "uuid", "name": "Noida", "employee_count": 450 }
        ]
      },
      {
        "scope_type": "company",
        "label": "Full Company",
        "employee_count": 1343
      }
    ]
  }
}
```

### GET /api/org-chart/tree

**Query Params:**
- `scope_type` (required): 'my-chain' | 'my-team' | 'process' | 'branch' | 'company'
- `scope_id` (conditional): UUID of process/branch (required if scope_type is process/branch)
- `filters` (optional): JSON { branch_id, process_id, department_id, designation_id, status, search_term }

**Response:**
```json
{
  "success": true,
  "data": {
    "scope": {
      "scope_type": "process",
      "scope_id": "uuid",
      "scope_name": "Onfido"
    },
    "nodes": [
      {
        "id": "uuid",
        "employee_code_masked": "EMP****123",
        "display_name": "Visible Name (based on scope)",
        "avatar_url": "optional-photo-url",
        "designation": "Process Manager",
        "branch": "Noida",
        "process": "Onfido",
        "department": "Operations",
        "employment_status": "Active",
        "manager_id": "uuid-or-null",
        "direct_report_count": 6,
        "total_report_count": 84,
        "role_key": "process_manager",
        "badges": [],
        "warnings": []  // e.g., ["missing_manager", "inactive_manager"]
      }
    ],
    "edges": [
      {
        "id": "edge-uuid",
        "source": "manager-uuid",
        "target": "employee-uuid",
        "relationship_type": "reporting_line"
      }
    ],
    "tree_root_ids": ["uuid1", "uuid2"],  // IDs of root nodes
    "data_quality": {
      "confidence_score": 92,
      "total_nodes": 173,
      "orphan_count": 0,
      "issue_count": 1,
      "issues_by_type": {
        "missing_manager": 0,
        "inactive_manager": 1,
        "circular_reference": 0
      }
    }
  }
}
```

### GET /api/org-chart/node/:employeeId

**Purpose:** Get single node details + validation that requestor has scope

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "employee_code_masked": "EMP****123",
    "display_name": "...",
    "designation": "...",
    "branch": "...",
    "process": "...",
    "department": "...",
    "employment_status": "Active",
    "manager_info": {
      "id": "uuid",
      "name": "Manager Name",
      "designation": "..."
    },
    "direct_reports": [
      { "id": "uuid", "name": "...", "designation": "..." }
    ],
    "data_quality_warnings": []
  }
}
```

### GET /api/org-chart/search

**Query Params:**
- `scope_type`, `scope_id` (same as /tree)
- `q` (search term): name, code, designation
- `limit` (default 20)

**Response:**
```json
{
  "success": true,
  "data": {
    "query": "string",
    "results": [
      { "id": "uuid", "name": "...", "designation": "...", "branch": "...", "process": "..." }
    ]
  }
}
```

### GET /api/org-chart/data-quality

**Query Params:**
- `scope_type`, `scope_id` (optional, default to user's default scope)

**Requires:** requireRole("admin", "hr")

**Response:**
```json
{
  "success": true,
  "data": {
    "scope": { "scope_type": "...", "scope_id": "..." },
    "confidence_score": 92,
    "issues": [
      {
        "type": "missing_manager",
        "count": 3,
        "affected_employees": ["uuid1", "uuid2", "uuid3"],
        "severity": "warning"
      },
      {
        "type": "inactive_manager",
        "count": 1,
        "affected_employees": ["uuid4"],
        "severity": "error"
      }
    ],
    "recommendations": [
      "3 employees have no reporting manager — assign managers to improve hierarchy",
      "1 employee has inactive manager — reassign or mark employee as inactive"
    ]
  }
}
```

---

## 8. UI DESIGN PLAN

### Main Page: `/org-chart`

**Layout (3-panel):**

```
┌─────────────────────────────────────────────────────────┐
│ TOOLBAR                                                 │
│ [Scope Selector] [Search] [Filter...] [Export] [Zoom]  │
└─────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────┐
│                                                          │
│                    ORG CHART CANVAS                      │
│                   (D3 / SVG / Custom)                    │
│                                                          │
│  [Nodes with connectors, collapse/expand, hover info]   │
│                                                          │
│                                                          │
└──────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────┐
│ LEGEND | DATA QUALITY WARNINGS (if any)                 │
└──────────────────────────────────────────────────────────┘
```

**Toolbar:**
- Scope Selector (dropdown): "My Team" / "Onfido" / "Noida Branch" / "Full Company"
- Search (text input + autocomplete)
- Filter (branch / process / department / status)
- Export button (CSV, Excel, PDF) — admin only
- Zoom controls (+ / fit / -)

**Canvas:**
- Vertical top-down flow (parent at top, children below)
- Nodes are cards with:
  - Avatar (initials or photo)
  - Name
  - Designation
  - Branch (compact badge)
  - Process (compact badge)
  - Employee count (if manager)
  - Warnings (⚠️ badge if data issue)
- Connectors: solid lines between manager → reports
- Collapse/expand: chevron icon on nodes with children
- Click node → open details drawer

**Details Drawer (right side, slide-in):**
- Full employee info (masked/filtered)
- Manager info
- Direct reports list
- Department, process, branch
- Employment status
- Warnings/issues

**Data Quality Panel (bottom):**
- "92% Data Confidence"
- Issues summary: "3 missing managers, 1 inactive manager"
- Link to "View All Issues" (admin only)

---

## 9. SCOPE & SECURITY MATRIX

### Access Control Rules

| User Role | Sees In Org Chart | Scope Options | Can Export | Can See Data Quality |
|---|---|---|---|---|
| super_admin | All employees (full company) | Company, Branch, Process, My Team, My Chain | ✅ | ✅ |
| admin | All employees (full company) | Company, Branch, Process, My Team, My Chain | ✅ | ✅ |
| ceo | All employees (full company) | Company, Branch, Process, My Team, My Chain | ✅ | ⚠️ view only |
| hr | All employees (scoped to assigned branches/processes if configured) | All (or scoped) | ✅ | ✅ |
| branch_head | Branch employees only | Branch, My Team, My Chain | ⚠️ limited | ❌ |
| process_manager | Process employees only | Process, My Team, My Chain | ❌ | ❌ |
| team_leader | Own team + manager chain | My Team, My Chain | ❌ | ❌ |
| employee | Self + manager chain + own team (if any) | My Team, My Chain | ❌ | ❌ |
| client (portal) | ❌ NO org chart (process metrics only) | N/A | ❌ | ❌ |

### Data Masking Rules

**Always Hidden:**
- Salary, CTC, bank account, IFSC, NEFT details
- PAN, Aadhaar
- DOB, mobile phone, email (shown only to own employee or manager)
- Document URLs, internal file paths
- PF/UAN/ESIC details
- Payroll history

**Masked by Scope:**
- Employee Code: Show last 4 digits only (EMP****1234)
- Name: Full name only to managers/HR; first name only to peers
- Contact: Hidden except to self, manager, HR

**Visible to All (in org chart context):**
- Designation
- Branch (aggregate name, not ID)
- Process (aggregate name, not ID)
- Department (aggregate name, not ID)
- Employment status
- Direct report count (not names, just count)
- Warnings/data quality badges

---

## 10. TEST PLAN

### Phase 1 (Audit) — Manual Inspection

1. **Data Quality Audit**
   - Query for orphan employees (reporting_manager_id IS NULL)
   - Verify 369 orphans exist
   - Identify manager chains by process
   - Detect circular references (if any)

2. **Security Audit**
   - Verify `requireAuth` is applied to all endpoints
   - Verify role-based access (admin/hr can export, employee cannot)
   - Verify scope filtering (process_manager sees only own process)
   - Verify no PII leaks (salary, bank, tax hidden)

3. **Access Control Audit**
   - Verify `user_assignment_scope` table exists and is used
   - Verify role aliases work (process_manager ↔ manager)
   - Verify demo bypass works for testing

### Phase 2 (Implementation) — Unit Tests

1. **Builder Tests**
   - Test tree algorithm with sample data
   - Test orphan handling
   - Test circular reference detection

2. **Scope Tests**
   - Test scope validation for each role
   - Test row-level filtering

3. **Data Quality Tests**
   - Test missing manager detection
   - Test inactive manager detection
   - Test unmapped employee detection

### Phase 3 (Integration) — E2E Tests

1. **API Tests**
   - GET /api/org-chart/scopes — verify available scopes
   - GET /api/org-chart/tree — verify tree structure
   - GET /api/org-chart/search — verify search results
   - GET /api/org-chart/data-quality — verify issue detection

2. **Frontend Tests**
   - Render org chart with mock data
   - Test scope selector
   - Test search + filter
   - Test node click → details drawer
   - Test export (admin only)

---

## 11. ROLLBACK PLAN

### Phase 1 (Audit) — No Rollback Needed
- Read-only queries only
- No database changes
- No code committed

### Phase 2 (Code Implementation) — Git-Based Rollback

```bash
# If implementation has issues, reset to main
git reset --hard main

# Or revert specific commits
git revert <commit-hash>
```

### Phase 2+ (Database Migration) — Additive Only

**New tables added:** Can be dropped safely if needed

```sql
-- Cleanup (only if necessary)
DROP TABLE IF EXISTS org_chart_access_log;
DROP TABLE IF EXISTS org_chart_data_issue;
DROP TABLE IF EXISTS org_chart_snapshot;
-- org_chart_override not created in Phase 1
```

**No existing tables modified** — backward compatible.

---

## 12. APPROVAL CHECKLIST

Before proceeding to Phase 1 implementation, confirm:

- [ ] Audit findings are accurate (369 orphan employees, 72% data completeness)
- [ ] Role-scoped access model is correct (org chart respects user_assignment_scope)
- [ ] API contract is acceptable (node masking, data quality schema)
- [ ] UI/UX design is acceptable (scope selector, filters, export)
- [ ] Security matrix is complete (PII masking, role-based export)
- [ ] New tables are approved (snapshots, audit logs, data issues)
- [ ] Rollback plan is clear (no breaking changes)
- [ ] Ready to proceed to Phase 1: Backend API + Frontend page (read-only, no edit/export yet)

---

**Next Steps:**

1. **User Approval:** Review this audit report and confirm requirements
2. **Phase 1 Implementation:** Build backend API + basic frontend page
3. **Phase 2+:** Add data quality panel, export, settings, manual overrides

