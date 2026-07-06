# Payroll HR Joining Documents Tracker - Design Specification

**Date:** 2026-07-06  
**Status:** Approved  
**Owner:** Payroll HR, HR Admin, Branch Head  

---

## 1. Overview

### Purpose
Create a dedicated dashboard for Payroll HR to track and manage employee joining documents at scale. Currently, Payroll HR must open individual employee pages to check document status. This tracker provides a centralized list view with filtering, bulk actions, and quick-triage capabilities.

### Problem Statement
- Payroll HR receives email notifications after branch head approval but has no overview of ALL employees' document status
- No way to see which employees need attention (overdue, needs correction, pending verification)
- No bulk actions (send reminders, assign tasks, set due dates)
- Manual click-through of 50+ employees to check status wastes 30+ minutes daily

### Success Criteria
- Payroll HR can see all employees' document status in one page
- Filter by branch, process, status, completion %, specific document types, overdue, recent activity
- Perform bulk actions (export, reminders, assign HR, set due dates, verify, download documents)
- Click employee row to expand inline checklist or open detail sheet
- Load 500 employees in <2 seconds

---

## 2. User Roles & Access

### Primary Users
1. **Payroll HR** (`payroll_hr` role) - Full access, primary user
2. **HR Admin** (`hr` role) - Full access
3. **Super Admin** (`super_admin`, `admin` roles) - Full access
4. **Branch Head** (`branch_head` role) - View-only, branch-scoped

### Access Matrix

| Action | Payroll HR | HR Admin | Super Admin | Branch Head |
|--------|-----------|----------|-------------|-------------|
| View tracker | ✓ | ✓ | ✓ | ✓ (own branch only) |
| Export CSV/Excel | ✓ | ✓ | ✓ | ✓ |
| Send reminder emails | ✓ | ✓ | ✓ | ✗ |
| Bulk assign HR | ✓ | ✓ | ✓ | ✗ |
| Bulk verify documents | ✓ | ✓ | ✓ | ✗ |
| Set due dates | ✓ | ✓ | ✓ | ✗ |
| Download documents (ZIP) | ✓ | ✓ | ✓ | ✗ |
| Generate checklists | ✓ | ✓ | ✓ | ✗ |

**Branch Head Restrictions:**
- Can only view employees from their assigned branch
- Can export data for reporting
- Cannot modify documents or send reminders (tooltip: "Contact HR to modify documents")

---

## 3. Architecture

### Component Structure

```
NativeJoiningDocumentsTracker.tsx (Frontend Page)
  ↓ fetches from
GET /api/ats/joining-documents-tracker (Backend API)
  ↓ queries
employees + employee_joining_document_checklist (Database)
```

### Data Flow

1. **Initial Load:** Fetch all employees with document summaries (employee info + completion % + key document statuses)
2. **Filtering:** Apply filters client-side for <500 rows; server-side for larger datasets
3. **Row Expansion:** Show pre-loaded checklist summary inline (included in initial payload)
4. **Sheet/Modal:** Open detail view with full checklist (fetches from existing `/employees/:id/joining-documents` endpoint)
5. **Bulk Actions:** Select rows → perform action → refetch affected employees

### Tech Stack
- **Frontend:** React 18 + TypeScript + Vite + Tailwind + shadcn/ui
- **Backend:** Express + TypeScript
- **Database:** MySQL (`employees` + `employee_joining_document_checklist` tables)
- **State:** React useState (no global state needed)

---

## 4. Backend API Design

### Primary Endpoint

**Route:** `GET /api/ats/joining-documents-tracker`

**Query Parameters:**
```typescript
interface TrackerQueryParams {
  branch_id?: string;           // Filter by branch
  process_id?: string;          // Filter by process/LOB
  status?: string;              // 5-stage status filter (see Status System below)
  completion_min?: number;      // e.g., 75 (for 75-99% range)
  completion_max?: number;      // e.g., 99
  document_code?: string;       // Filter by specific document type
  overdue_only?: boolean;       // Show only overdue documents
  updated_since?: string;       // ISO date for recent activity (e.g., "2026-07-01")
  search?: string;              // Search employee name/code (fuzzy match)
}
```

**Authorization:**
```typescript
requireAuth();
requireRole(['admin', 'super_admin', 'hr', 'payroll_hr', 'branch_head']);

// Branch Head scoping:
if (userRole === 'branch_head') {
  // Add WHERE clause: e.branch_id = (SELECT branch_id FROM employees WHERE user_id = ?)
}
```

**SQL Query:**
```sql
SELECT 
  e.id,
  e.employee_code,
  e.full_name,
  e.branch_id,
  e.process_id,
  e.date_of_joining,
  e.joining_document_status,
  e.joining_document_completion_pct,
  b.branch_name,
  p.process_name,
  p.lob_name,
  
  -- Aggregate key documents (Appointment Letter, ID Proof, Bank Details, Address Proof)
  GROUP_CONCAT(
    CASE WHEN c.document_code IN ('APPOINTMENT_LETTER', 'ID_PROOF', 'BANK_DETAILS', 'ADDRESS_PROOF')
    THEN CONCAT(c.document_code, ':', c.status, ':', COALESCE(c.verification_status, 'null'))
    END SEPARATOR '||'
  ) AS key_documents_raw,
  
  -- Count stats
  COUNT(c.id) AS total_documents,
  SUM(CASE WHEN c.verification_status = 'verified' THEN 1 ELSE 0 END) AS verified_count,
  SUM(CASE WHEN c.status LIKE '%needs_correction%' THEN 1 ELSE 0 END) AS needs_correction_count,
  SUM(CASE WHEN c.due_at < NOW() AND c.verification_status IS NULL THEN 1 ELSE 0 END) AS overdue_count,
  MAX(c.updated_at) AS last_document_update,
  
  -- Assigned HR (if field exists, otherwise NULL)
  u.full_name AS assigned_hr_name

FROM employees e
LEFT JOIN branches b ON e.branch_id = b.id
LEFT JOIN processes p ON e.process_id = p.id
LEFT JOIN employee_joining_document_checklist c ON e.id = c.employee_id
LEFT JOIN auth_user u ON c.assigned_hr_user_id = u.id

WHERE e.active_status = 1
  AND e.employee_code IS NOT NULL
  [+ dynamic filters based on query params]

GROUP BY e.id
ORDER BY e.date_of_joining DESC
LIMIT 500;
```

**Response Format:**
```typescript
interface TrackerResponse {
  success: true;
  data: {
    employees: EmployeeDocumentRow[];
    summary: TrackerSummary;
  };
}

interface EmployeeDocumentRow {
  id: string;
  employee_code: string;
  full_name: string;
  branch_name: string;
  process_name: string;
  lob_name: string | null;
  date_of_joining: string; // ISO date
  joining_document_status: string | null; // Overall status
  joining_document_completion_pct: number; // 0-100
  total_documents: number;
  verified_count: number;
  needs_correction_count: number;
  overdue_count: number;
  last_document_update: string | null; // ISO timestamp
  assigned_hr_name: string | null;
  key_documents: KeyDocumentStatus[]; // Parsed from key_documents_raw
}

interface KeyDocumentStatus {
  code: 'APPOINTMENT_LETTER' | 'ID_PROOF' | 'BANK_DETAILS' | 'ADDRESS_PROOF';
  status: string; // Document status
  verification_status: string | null; // Verification status
}

interface TrackerSummary {
  total: number;
  complete: number;           // 100% completion
  pending_verification: number; // 75-99% completion
  in_progress: number;        // 1-74% completion
  not_started: number;        // 0% completion
  overdue: number;            // Count of employees with overdue documents
  needs_correction: number;   // Count of employees with documents needing correction
}
```

**Performance Considerations:**
- Query returns max 500 employees (pagination future enhancement)
- Index on: `employees(active_status, employee_code)`, `employee_joining_document_checklist(employee_id, document_code)`
- Key documents pre-aggregated (no N+1 queries)
- Full checklist fetched lazily (only when sheet opens)

---

### Bulk Action Endpoints

#### 1. Send Reminder Emails
**Route:** `POST /api/ats/joining-documents-tracker/bulk-remind`

**Body:**
```typescript
{
  employee_ids: string[];
  custom_message?: string; // Optional custom message to append
}
```

**Logic:**
- For each employee, send email with list of pending documents
- Template: "Dear [Name], Your joining documents are pending: [list]. Please upload by [due_date]. [custom_message]"
- Email sent to employee's `official_email` or `mobile` (SMS fallback if no email)

**Response:**
```typescript
{
  success: true;
  sent: 10,
  failed: 2,
  errors: [
    { employee_id: "...", employee_code: "EMP-042", error: "No email address" },
    { employee_id: "...", employee_code: "EMP-089", error: "SMTP timeout" }
  ]
}
```

#### 2. Generate Missing Checklists
**Route:** `POST /api/ats/joining-documents-tracker/bulk-generate-checklist`

**Body:**
```typescript
{
  employee_ids: string[];
}
```

**Logic:**
- Calls existing `generateJoiningDocumentChecklist(employeeId, actorUserId)` for each employee
- Only generates if no checklist exists yet (0% completion employees)

**Response:**
```typescript
{
  success: true;
  generated: 8,
  skipped: 2, // Already had checklists
  errors: []
}
```

#### 3. Bulk Download Documents (ZIP)
**Route:** `POST /api/ats/joining-documents-tracker/bulk-download`

**Body:**
```typescript
{
  employee_ids: string[];
  document_codes?: string[]; // Optional: filter to specific documents
}
```

**Logic:**
- Streams ZIP file with folder structure: `EMP-001-JohnDoe/appointment_letter.pdf`
- Includes all verified documents (or filtered by `document_codes`)

**Response:** Binary stream (ZIP file)

**Filename:** `joining-documents-[timestamp].zip`

#### 4. Bulk Assign HR
**Route:** `POST /api/ats/joining-documents-tracker/bulk-assign`

**Body:**
```typescript
{
  employee_ids: string[];
  assigned_hr_user_id: string;
}
```

**Logic:**
- Updates `assigned_hr_user_id` field on `employee_joining_document_checklist` records
- **Schema Addition Required:** Add `assigned_hr_user_id CHAR(36) NULL` column to `employee_joining_document_checklist` table

**Response:**
```typescript
{
  success: true;
  updated: 12
}
```

#### 5. Bulk Set Due Dates
**Route:** `POST /api/ats/joining-documents-tracker/bulk-set-due-date`

**Body:**
```typescript
{
  employee_ids: string[];
  due_date: string; // ISO date
  document_codes?: string[]; // Optional: apply to specific documents only
}
```

**Logic:**
- Updates `due_at` field for all or specified documents for selected employees

**Response:**
```typescript
{
  success: true;
  updated: 45 // Number of checklist records updated
}
```

#### 6. Bulk Verify Documents
**Route:** `POST /api/ats/joining-documents-tracker/bulk-verify`

**Body:**
```typescript
{
  employee_ids: string[];
}
```

**Logic:**
- Only enabled if all selected employees have `joining_document_status = 'pending_verification'`
- Sets `verification_status = 'verified'` for all documents with status = 'uploaded_pending_review'
- Recalculates employee-level completion % and overall status
- Logs each verification to `employee_joining_document_audit_log`

**Authorization:** Requires `hr` or `payroll_hr` role (not branch_head)

**Response:**
```typescript
{
  success: true;
  verified: 8,
  errors: []
}
```

---

## 5. Status System (5 Stages)

### Status Definitions

| Status | Code | Completion % | Description | Color |
|--------|------|--------------|-------------|-------|
| **Not Started** | `not_started` | 0% | No documents uploaded | Gray (slate-100/slate-500) |
| **In Progress** | `in_progress` | 1-74% | Some documents uploaded, incomplete | Blue (blue-50/blue-700) |
| **Pending Verification** | `pending_verification` | 75-99% | Most documents uploaded, awaiting HR review | Amber (amber-50/amber-700) |
| **Needs Correction** | `needs_correction` | Any % | HR rejected documents, needs re-upload | Red (rose-50/rose-700) |
| **Verified & Complete** | `verified_complete` | 100% | All documents verified | Green (emerald-50/emerald-700) |

### Status Calculation Logic

```typescript
function calculateOverallStatus(employee: EmployeeDocumentRow): string {
  const pct = employee.joining_document_completion_pct;
  const needsCorrection = employee.needs_correction_count > 0;
  
  if (needsCorrection) return 'needs_correction';
  if (pct === 100) return 'verified_complete';
  if (pct >= 75) return 'pending_verification';
  if (pct > 0) return 'in_progress';
  return 'not_started';
}
```

### Key Document Icons

| Document | Icon | Verified | Pending | Needs Correction | Not Started |
|----------|------|----------|---------|------------------|-------------|
| Appointment Letter | FileText | ✓ Green | ⏳ Amber | ✗ Red | ○ Gray |
| ID Proof | CreditCard | ✓ Green | ⏳ Amber | ✗ Red | ○ Gray |
| Bank Details | Building | ✓ Green | ⏳ Amber | ✗ Red | ○ Gray |
| Address Proof | MapPin | ✓ Green | ⏳ Amber | ✗ Red | ○ Gray |

---

## 6. Frontend Component Structure

### Page Component
**File:** `src/pages/NativeJoiningDocumentsTracker.tsx`

### Component Hierarchy

```
NativeJoiningDocumentsTracker
├── DashboardLayout
├── Header
│   ├── H1: "Joining Documents Tracker"
│   ├── Auto-refresh toggle (every 2 min, pauseable)
│   └── Manual refresh button
├── SummaryCards (8 cards in 2 rows)
│   ├── Row 1: Total | Complete 100% | Pending Verification 75-99% | In Progress 1-74%
│   └── Row 2: Not Started 0% | Overdue | Needs Correction | (placeholder for future metric)
├── FilterBar (collapsible)
│   ├── Search input (employee name/code)
│   ├── Branch Select
│   ├── Process/LOB Select
│   ├── Status Select (5 stages multi-select)
│   ├── Completion Range Select (0-25%, 26-50%, 51-75%, 76-100%)
│   ├── Document Type Select (APPOINTMENT_LETTER, ID_PROOF, etc.)
│   ├── Overdue Toggle
│   ├── Updated Since Select (Last 24h, 7 days, 30 days, custom)
│   ├── "Active Filters" chips (with X to remove)
│   └── "Clear All Filters" button
├── BulkActionBar (sticky bottom, visible when rows selected)
│   ├── "12 employees selected" text
│   ├── Export CSV button
│   ├── Export Excel button
│   ├── Send Reminders button
│   ├── Assign HR button
│   ├── Set Due Dates button
│   ├── Bulk Verify button (only if all selected = pending_verification)
│   ├── Download Documents (ZIP) button
│   └── Clear Selection button
├── EmployeeDocumentsTable
│   ├── Column: Checkbox (bulk select)
│   ├── Column: Employee Code (sortable)
│   ├── Column: Name (sortable, searchable)
│   ├── Column: Branch (filterable)
│   ├── Column: Process/LOB (filterable)
│   ├── Column: DOJ (sortable)
│   ├── Column: Status Badge (color-coded, filterable)
│   ├── Column: Progress Bar (completion %, visual bar + text)
│   ├── Column: Key Documents (4 icons with hover tooltips)
│   ├── Column: Last Updated (relative time, e.g., "2 hours ago")
│   ├── Column: Assigned HR (name or "Unassigned")
│   ├── Column: Actions Dropdown
│   │   ├── View Details (opens sheet)
│   │   ├── Open Full Page (navigates to /employees/:id/joining-documents)
│   │   ├── Send Reminder
│   │   ├── Assign to Me
│   │   └── Download Documents
│   └── ExpandableRow (inline nested table)
│       ├── Shows document checklist (document name | status | verification status | due date)
│       └── Click row again to collapse
└── EmployeeDocumentSheet (shadcn Sheet modal, slide-in from right)
    ├── Sheet Header
    │   ├── Employee Code + Name (text-2xl font-black)
    │   ├── Branch + Process badges
    │   ├── DOJ + Status badge
    │   └── Close button (X)
    ├── Sheet Content (scrollable)
    │   ├── Progress Section (circular progress chart + stats)
    │   ├── Document Checklist Table
    │   │   ├── Columns: Document Name | Status | Verification | Due Date | Actions
    │   │   ├── Row actions: View File, Verify, Request Correction, Set Due Date
    │   │   └── Expandable rows: show verification remarks, uploaded files
    │   ├── Assigned HR Section
    │   │   ├── Current assignee (if any)
    │   │   └── [Assign to Me] / [Change Assignment] buttons
    │   └── Activity Timeline (last 5 activities)
    │       └── "Generated checklist" / "Uploaded ID Proof" / "Verified by HR" with timestamps
    └── Sheet Footer
        ├── [Send Reminder Email] button
        ├── [Open Full Page] button (navigates to full document page)
        └── [Close] button
```

### State Management

```typescript
interface TrackerState {
  employees: EmployeeDocumentRow[];
  summary: TrackerSummary | null;
  filters: Filters;
  selectedIds: Set<string>;
  expandedRowId: string | null;
  sheetEmployeeId: string | null;
  loading: boolean;
  error: string | null;
  autoRefresh: boolean;
}

const [employees, setEmployees] = useState<EmployeeDocumentRow[]>([]);
const [summary, setSummary] = useState<TrackerSummary | null>(null);
const [filters, setFilters] = useState<Filters>({});
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
const [sheetEmployeeId, setSheetEmployeeId] = useState<string | null>(null);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);
const [autoRefresh, setAutoRefresh] = useState(true);
```

### Key Interactions

| User Action | Behavior |
|-------------|----------|
| Click summary card | Auto-set filter + refetch table |
| Apply filter | Refetch with query params (or filter client-side if <500 rows) |
| Search input (debounced 300ms) | Filter table by employee name/code |
| Click table row | Expand inline (show checklist), collapse if already expanded |
| Click "View Details" button | Open sheet modal with full checklist |
| Click "Open Full Page" | Navigate to `/employees/:id/joining-documents` |
| Select checkbox | Add to `selectedIds` Set, show bulk action bar |
| Click bulk action | Confirm modal → API call → refetch affected employees |
| Auto-refresh (every 2 min) | Silent refetch in background, update table |
| Manual refresh button | Full refetch with loading spinner |

---

## 7. UI/UX Design Details

### Design Tokens (Following Existing Standards)

**Colors:**
- Primary text: `slate-950`, `slate-900`
- Secondary text: `slate-600`, `slate-500`
- Borders: `slate-200`, `slate-100`
- Success: `emerald-600`, `emerald-50/emerald-700`
- Error: `rose-600`, `rose-50/rose-700`
- Warning: `amber-500`, `amber-50/amber-700`
- Info: `blue-600`, `blue-50/blue-700`
- Neutral: `slate-500`, `slate-100/slate-500`

**Border Radius:**
- Inputs/cards: `rounded-xl` (12px)
- Badges/chips: `rounded-2xl` (16px)
- Large panels: `rounded-3xl` (24px)

**Typography:**
- Page H1: `text-3xl font-black tracking-tight`
- Section header: `text-2xl font-black`
- Card title: `text-base font-bold`
- Body: `text-sm`
- Labels: `text-xs font-bold uppercase tracking-wider`

**Spacing:**
- Use `p-3`, `p-4`, `p-5`, `p-6` (no arbitrary values)
- Consistent `gap-4` between elements

### Summary Cards Layout

```
┌─────────────┬─────────────┬─────────────┬─────────────┐
│   Total     │  Complete   │  Pending    │ In Progress │
│   Employees │   100%      │ Verification│   1-74%     │
│     150     │     45      │     30      │     60      │
└─────────────┴─────────────┴─────────────┴─────────────┘
┌─────────────┬─────────────┬─────────────┬─────────────┐
│ Not Started │  Overdue    │   Needs     │   (Future)  │
│     0%      │  Documents  │ Correction  │             │
│     15      │     12      │      8      │             │
└─────────────┴─────────────┴─────────────┴─────────────┘
```

**Card Interaction:**
- Hover: subtle bg change (`hover:bg-slate-50`)
- Click: apply filter + visual highlight (blue border)
- Shows count + percentage (e.g., "45 (30%)")

### Table Design

**Layout:**
- Sticky header (scrollable body)
- Zebra striping (alternate row colors: `even:bg-slate-50`)
- Hover highlight (`hover:bg-blue-50`)
- 44px minimum row height (WCAG AA tap target)
- Expandable rows: nested table with indentation

**Responsive:**
- Desktop (>1024px): All columns visible
- Tablet (768-1024px): Hide "Last Updated" and "Assigned HR" columns
- Mobile (<768px): Horizontal scroll, collapse to card view (future enhancement)

**Columns:**
1. **Checkbox:** 44px width, centered
2. **Employee Code:** 100px, sortable, link to full page
3. **Name:** 180px, sortable, bold
4. **Branch:** 120px, filterable dropdown
5. **Process/LOB:** 140px, filterable dropdown
6. **DOJ:** 100px, sortable, date format (DD MMM YYYY)
7. **Status:** 140px, badge with color-coded background
8. **Progress:** 120px, progress bar + percentage text
9. **Key Docs:** 140px, 4 icons (hover tooltip shows document name + status)
10. **Last Updated:** 120px, relative time (e.g., "2h ago")
11. **Assigned HR:** 120px, name or "Unassigned"
12. **Actions:** 80px, dropdown menu (3-dot icon)

**Expandable Row Content:**
- Nested table (indented 20px)
- Columns: Document Name | Status | Verification Status | Due Date
- Max 5 documents shown inline (rest: "View all in sheet")

### Filter Bar

**Collapsible:** Click "Filters" to expand/collapse (default: expanded)

**Layout:**
```
┌────────────────────────────────────────────────────────────┐
│  🔍 Search: [________________]                              │
│  Branch: [Select...] Process: [Select...] Status: [Select..]│
│  Completion: [Select...] Doc Type: [Select...] Overdue: [ ]│
│  Updated: [Select...] [Clear All Filters]                   │
└────────────────────────────────────────────────────────────┘
Active Filters: [Branch: HQ ×] [Status: Pending ×]
```

**Active Filters Chips:**
- Show below filter bar
- Each chip: label + X button to remove
- "Clear All" removes all chips

### Bulk Action Bar

**Position:** Sticky at bottom of viewport (only when selections active)

**Layout:**
```
┌────────────────────────────────────────────────────────────┐
│  ✓ 12 employees selected  [Export CSV] [Export Excel]      │
│  [Send Reminders] [Assign HR] [Set Due Dates] [Bulk Verify]│
│  [Download ZIP] [Clear Selection]                          │
└────────────────────────────────────────────────────────────┘
```

**Behavior:**
- Slide up animation when first selection
- Sticky (stays visible on scroll)
- "Clear Selection" button on far right

### Sheet/Modal Detail View

**Trigger:** Click "View Details" in actions dropdown

**Dimensions:**
- Desktop: 600px wide, full height, slide-in from right
- Mobile: Full-screen overlay

**Content:**
- Header: Employee info (code, name, branch, process, DOJ, status badge)
- Progress section: Circular chart (e.g., "8 of 12 documents verified")
- Document checklist table: Same columns as inline expanded view + action buttons
- Assigned HR section: Current assignee + "Assign to Me" button
- Activity timeline: Last 5 actions with timestamps

**Footer Actions:**
- [Send Reminder Email] - Opens confirmation modal
- [Open Full Page] - Navigates to `/employees/:id/joining-documents`
- [Close] - Closes sheet

---

## 8. Error Handling & Loading States

### Loading States

| State | UI Behavior |
|-------|-------------|
| **Initial Load** | Full-page skeleton (8 card skeletons + table skeleton with 10 rows) |
| **Filter/Refresh** | Spinner overlay on table + disable filter inputs |
| **Bulk Action** | Disable action buttons + spinner on clicked button |
| **Row Expansion** | Inline spinner if checklist not pre-loaded |
| **Sheet Open** | Spinner overlay inside sheet while fetching full checklist |

### Error States

| Error | Display | Recovery |
|-------|---------|----------|
| **Network failure** | Red banner: "Failed to load employees. Check your connection." + [Retry] button | Retry button refetches |
| **403 Forbidden** | Full-page error: "You don't have permission to view this page." | No recovery (contact admin) |
| **500 Server Error** | Red banner: "Server error. Please try again later." + [Retry] button | Retry after 5 seconds |
| **Bulk action partial failure** | Toast: "8 of 10 successful. 2 failed: [reasons]" | User can retry failed items |
| **Bulk action complete failure** | Error banner above table with details + [Retry] button | Retry action |

### Empty States

| Scenario | Display |
|----------|---------|
| **No employees** | Empty state card: Large icon (Users) + "No employees found" + "Employees will appear here once activated" |
| **No results after filtering** | Empty state: "No employees match your filters" + [Clear Filters] button |
| **No documents for employee** | In expanded row: "No documents checklist generated" + [Generate Checklist] button |
| **No selections** | Bulk action bar hidden |

### Data Refresh Strategy

| Trigger | Behavior |
|---------|----------|
| **Auto-refresh (every 2 min)** | Silent background fetch, update table if data changed |
| **Manual refresh button** | Full refetch with loading spinner overlay |
| **After bulk action** | Refetch affected employees only (or full refresh if >20 affected) |
| **After sheet close** | Refetch that employee's row data only |
| **Optimistic updates** | Assign HR → update UI immediately, rollback on error |

---

## 9. Route, Navigation & Security

### Route Registration

**File:** `src/App.tsx`

**Location:** Around line 352, with other ATS routes

```tsx
<Route 
  path="/ats/joining-documents-tracker" 
  element={
    <ProtectedRoute roles={['admin', 'super_admin', 'hr', 'payroll_hr', 'branch_head']}>
      <Gate pageCode="ATS_JOINING_DOCUMENTS_TRACKER">
        <NativeJoiningDocumentsTracker />
      </Gate>
    </ProtectedRoute>
  } 
/>
```

### Navigation Access Points

1. **Main Navigation Menu:**
   - Section: ATS/HR
   - Position: After "Onboarding Requests", before "Payroll HR Validation"
   - Label: "Joining Documents Tracker"
   - Icon: FileCheck

2. **Quick Links:**
   - From `NativeHROnboardingRequests.tsx`: Add button at top: "View Joining Documents Tracker →"
   - From `NativePayrollHRValidation.tsx`: Add button at top: "Track Employee Documents →"

3. **Direct URL:** `/ats/joining-documents-tracker` (shareable, bookmarkable)

### Security Layers

**1. Route-Level (Frontend):**
```tsx
ProtectedRoute: roles={['admin', 'super_admin', 'hr', 'payroll_hr', 'branch_head']}
```

**2. Gate (Page-Level Permission):**
```tsx
Gate: pageCode="ATS_JOINING_DOCUMENTS_TRACKER"
```
- Add page permission to `page_permissions` table:
```sql
INSERT INTO page_permissions (page_code, page_name, module, roles_allowed)
VALUES ('ATS_JOINING_DOCUMENTS_TRACKER', 'Joining Documents Tracker', 'ATS', 'admin,super_admin,hr,payroll_hr,branch_head');
```

**3. Backend API Authorization:**
```typescript
requireAuth();
requireRole(['admin', 'super_admin', 'hr', 'payroll_hr', 'branch_head']);
```

**4. Branch-Level Data Scoping:**
```typescript
if (userRole === 'branch_head') {
  // Query: WHERE e.branch_id = (SELECT branch_id FROM employees WHERE user_id = ?)
  // Only return employees from user's branch
}
```

**5. Action-Level Permissions:**
```typescript
const canModify = hasAnyRole(actorUserId, ['admin', 'super_admin', 'hr', 'payroll_hr']);

// Branch heads can only view + export
if (userRole === 'branch_head') {
  // Block: bulk verify, assign HR, send reminders, set due dates
  // Allow: export CSV/Excel
}
```

### Audit Logging

**All bulk actions logged to:** `employee_joining_document_audit_log`

**Log Entry Fields:**
- `action_type`: e.g., "BULK_VERIFY", "BULK_REMIND", "BULK_ASSIGN"
- `actor_user_id`: User who performed action
- `employee_ids`: JSON array of affected employee IDs
- `remarks`: JSON payload with action details
- `timestamp`: `created_at`

**Individual Actions Logged:**
- Each document verification (even in bulk) logs separately
- Format: `{ "action": "verified", "document_code": "ID_PROOF", "employee_id": "..." }`

---

## 10. Database Schema Changes

### New Column: `assigned_hr_user_id`

**Table:** `employee_joining_document_checklist`

**Migration File:** `backend/sql/363_joining_document_assigned_hr.sql`

```sql
-- Add assigned_hr_user_id column for HR task assignment
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'employee_joining_document_checklist'
      AND COLUMN_NAME = 'assigned_hr_user_id') = 0,
  'ALTER TABLE employee_joining_document_checklist 
     ADD COLUMN assigned_hr_user_id CHAR(36) NULL AFTER verified_at,
     ADD INDEX idx_ejdc_assigned_hr (assigned_hr_user_id)',
  'SELECT ''employee_joining_document_checklist.assigned_hr_user_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
```

**Purpose:** Track which HR person is responsible for each employee's document checklist

**Usage:**
- Bulk Assign HR action updates this field
- Displayed in "Assigned HR" column on tracker table
- Filter by assigned HR

---

## 11. Testing Requirements

### Unit Tests

| Component | Test Cases |
|-----------|------------|
| **Status Calculation** | Verify `calculateOverallStatus()` returns correct status for all 5 stages |
| **Key Documents Parser** | Parse `key_documents_raw` string correctly into array of objects |
| **Filter Logic** | Client-side filtering works for each filter type |
| **Bulk Selection** | Select all, deselect all, individual selection logic |

### Integration Tests

| Scenario | Expected Behavior |
|----------|-------------------|
| **Load tracker as Payroll HR** | 200 OK, sees all branches |
| **Load tracker as Branch Head** | 200 OK, sees only own branch employees |
| **Filter by branch** | Returns only employees from selected branch |
| **Filter by overdue** | Returns only employees with `overdue_count > 0` |
| **Bulk verify documents** | Updates `verification_status` for all documents, logs audit entries |
| **Bulk send reminders** | Sends emails to all selected employees, returns success/failure counts |
| **Export CSV** | Downloads CSV with correct columns and data |

### Manual QA Checklist

- [ ] Summary cards show correct counts
- [ ] Clicking summary card applies filter
- [ ] All filters work (branch, process, status, completion %, document type, overdue, updated since)
- [ ] Search input filters by employee name/code (case-insensitive)
- [ ] Active filter chips display and remove correctly
- [ ] "Clear All Filters" resets all filters
- [ ] Table rows expand/collapse on click
- [ ] Inline expanded row shows document checklist
- [ ] "View Details" opens sheet modal
- [ ] Sheet modal shows full checklist + actions
- [ ] "Open Full Page" navigates to correct employee page
- [ ] Bulk select checkboxes work (select all, deselect all, individual)
- [ ] Bulk action bar appears when selections made
- [ ] Export CSV downloads correct data
- [ ] Send reminders sends emails (check `ats_email_log` table)
- [ ] Bulk assign HR updates `assigned_hr_user_id`
- [ ] Bulk set due dates updates `due_at`
- [ ] Bulk verify updates `verification_status` (only for pending_verification)
- [ ] Auto-refresh updates table every 2 minutes
- [ ] Manual refresh button refetches data
- [ ] Loading states display correctly
- [ ] Error states display correctly
- [ ] Empty states display correctly
- [ ] Branch Head sees only their branch (data scoping)
- [ ] Branch Head cannot perform modify actions (tooltips explain why)
- [ ] Responsive layout works on tablet/mobile

### Performance Benchmarks

| Metric | Target |
|--------|--------|
| **Initial load (500 employees)** | <2 seconds |
| **Filter application (client-side)** | <100ms |
| **Bulk action (10 employees)** | <5 seconds |
| **Export CSV (500 rows)** | <1 second |
| **Sheet modal open** | <500ms |

---

## 12. Implementation Checklist

### Backend Tasks

- [ ] Create `GET /api/ats/joining-documents-tracker` endpoint
- [ ] Add query parameter parsing and validation
- [ ] Implement SQL query with aggregates and joins
- [ ] Add branch-level scoping for branch_head role
- [ ] Implement response summary calculation
- [ ] Create `POST /api/ats/joining-documents-tracker/bulk-remind` endpoint
- [ ] Create `POST /api/ats/joining-documents-tracker/bulk-generate-checklist` endpoint
- [ ] Create `POST /api/ats/joining-documents-tracker/bulk-download` endpoint (ZIP streaming)
- [ ] Create `POST /api/ats/joining-documents-tracker/bulk-assign` endpoint
- [ ] Create `POST /api/ats/joining-documents-tracker/bulk-set-due-date` endpoint
- [ ] Create `POST /api/ats/joining-documents-tracker/bulk-verify` endpoint
- [ ] Add database migration for `assigned_hr_user_id` column
- [ ] Add audit logging for all bulk actions
- [ ] Write backend unit tests
- [ ] Write integration tests for all endpoints

### Frontend Tasks

- [ ] Create `src/pages/NativeJoiningDocumentsTracker.tsx` page component
- [ ] Implement summary cards with click-to-filter
- [ ] Implement filter bar with all filter types
- [ ] Implement active filter chips
- [ ] Implement employee table with all columns
- [ ] Implement expandable row inline checklist
- [ ] Implement bulk selection logic (checkboxes)
- [ ] Implement bulk action bar (sticky bottom)
- [ ] Implement export CSV/Excel functionality
- [ ] Implement send reminders modal + API call
- [ ] Implement bulk assign HR modal + API call
- [ ] Implement bulk set due dates modal + API call
- [ ] Implement bulk verify confirmation + API call
- [ ] Implement bulk download documents (ZIP) API call
- [ ] Implement sheet/modal detail view component
- [ ] Implement auto-refresh (every 2 min, pauseable)
- [ ] Implement manual refresh button
- [ ] Implement all loading states (skeletons, spinners)
- [ ] Implement all error states (banners, toasts)
- [ ] Implement all empty states
- [ ] Add route to `App.tsx`
- [ ] Add navigation menu item
- [ ] Add quick links from other pages
- [ ] Add page permission to database
- [ ] Write frontend unit tests (status calculation, filter logic)
- [ ] Perform manual QA testing

### Documentation Tasks

- [ ] Update CLAUDE.md with tracker page details
- [ ] Add user guide for Payroll HR (how to use tracker)
- [ ] Document bulk action workflows
- [ ] Document security/permissions model

---

## 13. Future Enhancements (Out of Scope for v1)

1. **Pagination:** Support >500 employees with server-side pagination
2. **Advanced Reporting:** Generate PDF summary reports, charts/analytics
3. **Scheduled Reports:** Email daily/weekly summaries to Payroll HR
4. **Custom Views:** Save filter combinations as named views
5. **Bulk Upload:** Upload documents for multiple employees via CSV
6. **Document Templates:** Manage document templates from tracker
7. **E-sign Integration:** Trigger bulk e-sign from tracker
8. **Mobile App:** Native mobile view (currently desktop-first)
9. **Real-time Updates:** WebSocket/SSE for live status updates
10. **AI Assistance:** Auto-categorize documents, OCR for validation

---

## 14. Success Metrics (Post-Launch)

| Metric | Baseline | Target (30 days post-launch) |
|--------|----------|------------------------------|
| Time to triage 50 employees | 30 minutes | <5 minutes |
| Payroll HR satisfaction score | N/A | >8/10 |
| Documents verified per day | ~20 | >50 |
| Overdue documents | 15% | <5% |
| Bulk actions usage | 0 | >20 per week |
| Page load time (500 employees) | N/A | <2 seconds |
| Error rate | N/A | <1% |

---

## 15. Revision History

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2026-07-06 | 1.0 | Claude Sonnet 4.5 | Initial design specification approved by user |

---

**End of Design Specification**
