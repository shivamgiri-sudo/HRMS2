# Access Control Page Redesign - Design Specification

**Date**: 2026-06-16  
**Author**: Claude + Shuvam  
**Status**: Approved  
**Target**: `/settings/access-control` page simplification

---

## Executive Summary

Redesign the access control page from a complex 905-line, 6-tab interface into a streamlined 3-tab workflow hub with quick actions, visual permission indicators, and lazy loading. This addresses critical usability issues: excessive scrolling, confusing permission matrix, frequent tab switching, slow loading, and unclear role understanding.

**Key Metrics:**
- Reduce tabs: 6 → 3 (50% reduction)
- Reduce initial load time: ~5s → <2s (60% improvement)
- Reduce clicks for common task (assign role): 4 clicks → 2 clicks

---

## Problem Statement

### Current Issues

**Original Page Structure (905 lines, 6 tabs):**
1. Module Access - Read-only placeholder
2. Page Access - Large permission matrix with checkboxes
3. User Roles - Assign/revoke roles to users
4. RBAC Reconciliation - Sync MySQL with Supabase
5. Designation Roles - Link designations to roles
6. Access Requests - Approve/deny access requests

**Pain Points (from user):**
- **A: Too much scrolling** - Can't find what I need quickly
- **B: Confusing matrix** - Too many checkboxes (5 per page × 100+ pages)
- **C: Frequent tab switching** - Related tasks spread across tabs
- **D: Slow loading** - All 6 tabs' data loads upfront
- **E: Unclear roles** - Hard to understand what each role controls

### User Workflow

Primary workflow: "Create user → Assign roles → Done"
- Roles are pre-configured with correct permissions
- User assignment is the most frequent task
- Permission editing is occasional (setup phase)
- Access request approval is periodic (daily check)

---

## Solution: Hybrid Tabbed Workflow Hub

### Design Approach

**Hybrid of Approach A (Single-Page Workflow) + Approach B (Simplified Tabs):**

**Core Principles:**
1. **Task-based design** - Quick action cards for common workflows
2. **Progressive disclosure** - Expand details on demand
3. **Visual indicators** - Icons instead of checkbox grids
4. **Lazy loading** - Load data only when needed
5. **Logical grouping** - 3 tabs organized by purpose

---

## Detailed Design

### Tab Structure (3 Tabs)

#### Tab 1: Users & Roles
**Purpose:** Manage user role assignments and view role summaries

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│ Quick Actions (2 cards):                                │
│ [➕ Assign Role to User]  [🔍 Find User by Role]       │
├─────────────────────────────────────────────────────────┤
│ Two-Column Layout:                                      │
│                                                         │
│ LEFT: User Search & List                                │
│ - Search input (debounced, 300ms)                      │
│ - User cards (expandable)                              │
│   - Shows: Name, email, roles, scope                   │
│   - Actions: [Add Role] [Edit] [Expand ▼]            │
│ - Pagination: 20 per page, infinite scroll             │
│                                                         │
│ RIGHT: Role Cards Grid                                  │
│ - Grid layout (3 columns on desktop, 1 on mobile)     │
│ - Role card shows:                                     │
│   - Role name + icon                                   │
│   - User count (👥 5)                                  │
│   - Page count (📄 45 pages)                           │
│   - [View Details ▼] button                           │
│ - Click to expand: Shows users with this role         │
│ - Lazy load: Expanded details fetched on click        │
└─────────────────────────────────────────────────────────┘
```

**API Calls:**
- Initial: `GET /api/access/roles/catalog` (cached 1 hour)
- On search: `GET /api/access/users?search={query}` (debounced)
- On user click: `GET /api/access/users/{userId}/roles`
- On role expand: `GET /api/access/roles/{roleKey}/summary`

**Components:**
- `UserSearchPanel` - Left column
- `RoleCardGrid` - Right column
- `AssignRoleModal` - Quick action modal
- `UserRoleCard` - Individual user display
- `RoleSummaryCard` - Individual role display

---

#### Tab 2: Permissions
**Purpose:** View and edit role-to-page permissions

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│ Quick Actions (3 cards):                                │
│ [📋 Apply Template] [🔍 Search Pages] [📊 View by Mod] │
├─────────────────────────────────────────────────────────┤
│ Role Selector + View Mode:                             │
│ Select Role: [Admin ▼]    View: [Grouped by Module ▼] │
├─────────────────────────────────────────────────────────┤
│ Permission Groups (collapsible modules):                │
│                                                         │
│ 📦 Payroll Module                                       │
│ ┌─────────────────────────────────────────────────────┐│
│ │ ▶ Payroll (6 pages) [✓ Full Access] [Edit]         ││
│ └─────────────────────────────────────────────────────┘│
│                                                         │
│ 📦 WFM Module (expanded)                               │
│ ┌─────────────────────────────────────────────────────┐│
│ │ ▼ WFM (8 pages)                                     ││
│ │   Page Name         | Access Level  | Actions       ││
│ │   ──────────────────|───────────────|──────────     ││
│ │   Roster Mgmt       | 👁️✏️ Editor  | [Change ▼]   ││
│ │   Attendance        | 👁️✏️ Editor  | [Change ▼]   ││
│ │   Overtime Mgmt     | 👁️➕ Creator | [Change ▼]   ││
│ │   Shift Config      | 🔒 No Access | [Change ▼]   ││
│ │   ... (4 more)      | [View All →] |              ││
│ └─────────────────────────────────────────────────────┘│
│                                                         │
│ 📦 HR Module                                            │
│ ┌─────────────────────────────────────────────────────┐│
│ │ ▶ HR (12 pages) [⚠️ Partial Access] [Edit]         ││
│ └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

**Visual Permission Levels:**
- 🔒 **No Access** - All permissions off
- 👁️ **View Only** - can_view only
- ✏️ **Editor** - can_view + can_edit
- ➕ **Creator** - can_view + can_create + can_edit
- 🗑️ **Full Access** - All permissions (view, create, edit, delete, export)

**Permission Templates:**
- "Full Access" - Enable all permissions
- "Read Only" - Enable view only
- "Editor" - Enable view + edit
- "None" - Disable all permissions

**Features:**
- **Group by module** (default view)
- **Collapsible sections** (only expand what you need)
- **Quick toggle** (click access level to cycle through common patterns)
- **Search pages** (filter across all modules)
- **Template apply** (set all pages in module to same level)
- **Bulk edit mode** (expand all, multi-select, batch update)

**API Calls:**
- On role select: `GET /api/access/roles/{roleKey}/permissions`
- On save: `PUT /api/access/roles/{roleKey}/permissions` (bulk update)

**Components:**
- `PermissionModuleGroup` - Collapsible module section
- `PermissionPageRow` - Individual page permission
- `PermissionTemplateDialog` - Apply template modal
- `AccessLevelBadge` - Visual permission indicator

---

#### Tab 3: Administration
**Purpose:** Handle requests, RBAC sync, and audit logs

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│ Quick Actions (3 cards):                                │
│ [📋 Pending Requests (3)] [🔄 Sync RBAC] [📊 Audit]   │
├─────────────────────────────────────────────────────────┤
│ Section 1: Access Requests                              │
│ ┌─────────────────────────────────────────────────────┐│
│ │ 📋 Access Requests (3 pending)                      ││
│ │                                                     ││
│ │ ┌─────────────────────────────────────────────────┐││
│ │ │ 👤 John Doe → Reports Page                      │││
│ │ │    "Need access for monthly analysis"           │││
│ │ │    Requested: 2 hours ago                       │││
│ │ │    [✅ Approve] [❌ Deny]                        │││
│ │ └─────────────────────────────────────────────────┘││
│ │ [... more requests]                                 ││
│ └─────────────────────────────────────────────────────┘│
│                                                         │
│ Section 2: RBAC Synchronization                         │
│ ┌─────────────────────────────────────────────────────┐│
│ │ 🔄 RBAC Sync Status                                 ││
│ │ ✅ All systems synced                               ││
│ │ Last sync: 5 minutes ago                            ││
│ │ MySQL ↔ Supabase: No conflicts                      ││
│ │ [Force Sync Now] [View Details]                    ││
│ └─────────────────────────────────────────────────────┘│
│                                                         │
│ Section 3: Activity Feed                                │
│ ┌─────────────────────────────────────────────────────┐│
│ │ 📈 Recent Activity (Last 24 hours)                  ││
│ │ • 10:30 AM - Admin assigned WFM role to 3 users    ││
│ │ • 09:15 AM - HR role permissions updated            ││
│ │ • Yesterday - Access request approved for Reports   ││
│ │ [View Full Audit Log →]                             ││
│ └─────────────────────────────────────────────────────┘│
│                                                         │
│ Section 4: Designation Roles (collapsed by default)    │
│ ┌─────────────────────────────────────────────────────┐│
│ │ ▶ Designation → Role Mappings [Expand]             ││
│ └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

**Features:**
- **Request queue** with one-click approve/deny
- **RBAC sync status** (clear indicators, auto-refresh 5 mins)
- **Activity feed** (infinite scroll, 10 initial items)
- **Designation roles** (moved here, less frequently used)
- **Audit log viewer** (detailed timeline with filters)

**API Calls:**
- Initial: `GET /api/access/requests?status=pending`
- On approve: `POST /api/access/requests/{id}/approve`
- On deny: `POST /api/access/requests/{id}/deny`
- RBAC status: `GET /api/access/rbac/status` (cached 5 mins)
- Activity: `GET /api/access/activity?limit=10&offset=0`

**Components:**
- `AccessRequestCard` - Individual request
- `RBACStatusPanel` - Sync status display
- `ActivityFeedItem` - Activity log entry
- `DesignationRoleManager` - Collapsed section

---

## Modal Workflows

### Modal 1: Assign Role to User

**Trigger:** Click "➕ Assign Role to User" quick action

**Layout:**
```
┌─────────────────────────────────────────┐
│ Assign Role to User                  [×]│
├─────────────────────────────────────────┤
│ Select User:                            │
│ [Search by name or email... ▼]          │
│ → Searchable dropdown, shows:           │
│    Name, email, current roles           │
│                                         │
│ Select Role:                            │
│ [Choose role... ▼]                      │
│ → Shows role name + description         │
│   "Admin - Full system access"          │
│   "WFM - Workforce management"          │
│                                         │
│ 📊 Permission Preview:                  │
│ ┌─────────────────────────────────────┐ │
│ │ This role grants access to:         │ │
│ │ • 12 pages across 4 modules         │ │
│ │ • WFM: Full access                  │ │
│ │ • Payroll: View only                │ │
│ │ • Reports: Create & Edit            │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ⚙️ Optional Scope Restrictions:         │
│ Branch: [All Branches ▼]                │
│ Department: [All Departments ▼]         │
│                                         │
│ [Cancel]              [Assign Role →]   │
└─────────────────────────────────────────┘
```

**Features:**
- **Live preview** - Shows what user will access before assigning
- **Searchable dropdowns** - Fast user/role finding
- **Scope filters** - Optional branch/dept restrictions
- **Validation** - Prevents duplicate role assignment

**API Calls:**
- On role select: `GET /api/access/roles/{roleKey}/summary`
- On submit: `POST /api/access/users/{userId}/roles`

---

### Modal 2: Edit Page Permissions (Detailed)

**Trigger:** Click "Edit" on a module in Permissions tab

**Layout:**
```
┌───────────────────────────────────────────────┐
│ Edit Permissions: Admin Role - Payroll    [×]│
├───────────────────────────────────────────────┤
│ Quick Apply Templates:                        │
│ [🗑️ Full Access] [✏️ Editor] [👁️ Read] [🔒 None]│
│                                               │
│ Permissions Grid:                             │
│ ┌─────────────────────────────────────────┐   │
│ │ Page            View Create Edit Delete │   │
│ │ ───────────────────────────────────────  │   │
│ │ Payroll         ☑    ☑     ☑    ☑      │   │
│ │ Payslips        ☑    ☐     ☐    ☐      │   │
│ │ Tax Declaration ☑    ☑     ☑    ☐      │   │
│ │ Overtime Mgmt   ☑    ☐     ☑    ☐      │   │
│ │ Salary Masters  ☑    ☑     ☑    ☑      │   │
│ │ Full & Final    ☑    ☐     ☑    ☐      │   │
│ └─────────────────────────────────────────┘   │
│                                               │
│ 💡 Smart Click:                               │
│    Click row to cycle permission levels:      │
│    None → View → Editor → Creator → Full      │
│                                               │
│ [Cancel]                    [Save Changes →]  │
└───────────────────────────────────────────────┘
```

**Features:**
- **Template quick apply** - Set all pages to same level
- **Smart row clicking** - Cycle through common permission patterns
- **Module-scoped** - Only show pages for one module
- **Visual grid** - Cleaner than scattered checkboxes
- **Keyboard navigation** - Arrow keys + Space to toggle

**API Calls:**
- On save: `PUT /api/access/roles/{roleKey}/permissions` (bulk update for module)

---

## Performance Optimizations

### Lazy Loading Strategy

**Tab 1 (Users & Roles):**
```javascript
Initial Mount:
  ✓ Load role catalog (cached 1 hour)
  ✗ Don't load user list (wait for search)
  ✗ Don't load user details (wait for click)

On Search Input:
  ✓ Debounce 300ms
  ✓ Load matching users (20 per page)
  ✓ Infinite scroll for more results

On User Card Click:
  ✓ Load user's roles
  ✓ Expand card to show details

On Role Card Click:
  ✓ Load users with this role
  ✓ Load page count & permissions summary
```

**Tab 2 (Permissions):**
```javascript
Initial Mount:
  ✓ Load page catalog (cached 30 mins)
  ✗ Don't load permissions (wait for role select)

On Role Select:
  ✓ Load all permissions for selected role
  ✓ Group by module (client-side, no API call)
  ✗ Modules collapsed by default

On Module Expand:
  ✓ Show pages for that module
  ✓ No additional API call (already loaded)
```

**Tab 3 (Administration):**
```javascript
Initial Mount:
  ✓ Load pending requests (typically <20)
  ✓ Load RBAC status (cached 5 mins)
  ✓ Load activity feed (10 initial items)

On Scroll:
  ✓ Infinite scroll for activity feed
  ✓ Load 10 more items at a time
```

### Caching Strategy

```javascript
// React Query cache times
const CACHE_CONFIG = {
  roleCatalog: 60 * 60 * 1000,      // 1 hour
  pageCatalog: 30 * 60 * 1000,      // 30 mins
  userList: 5 * 60 * 1000,          // 5 mins
  userRoles: 5 * 60 * 1000,         // 5 mins
  rolePermissions: 5 * 60 * 1000,   // 5 mins (invalidate on save)
  rbacStatus: 5 * 60 * 1000,        // 5 mins (auto-refresh)
  activityFeed: 2 * 60 * 1000,      // 2 mins
  pendingRequests: 1 * 60 * 1000,   // 1 min (frequent updates)
};

// Invalidation rules
On role assigned: Invalidate ['user-roles', 'rbac-status']
On permission saved: Invalidate ['role-permissions', 'role-summary']
On request approved: Invalidate ['pending-requests', 'activity-feed']
```

### Expected Performance

**Current (905-line, 6-tab page):**
- Initial load: ~5 seconds (loads all 6 tabs' data)
- Tab switch: ~1 second (React re-render + data fetch)
- Search: ~800ms (no debounce, client-side filter)
- Permission save: ~2 seconds (re-fetches entire matrix)

**New (3-tab, lazy-loaded page):**
- Initial load: <2 seconds (only Tab 1 data, cached catalogs)
- Tab switch: <500ms (lazy load on demand)
- Search: <300ms (debounced, server-side filter)
- Permission save: <1 second (optimistic update + background sync)

**Improvement:**
- 60% faster initial load
- 50% faster tab switching
- 62% faster search
- 50% faster saves

---

## Data Flow & API Design

### API Endpoints

**Users & Roles:**
```typescript
// User management
GET  /api/access/users?search={query}&limit=20&offset=0
     → { data: UserOption[], total: number }

GET  /api/access/users/{userId}/roles
     → { data: UserRole[] }

POST /api/access/users/{userId}/roles
     Body: { role_key: string, branch_id?: string, dept_id?: string }
     → { success: boolean }

DELETE /api/access/users/{userId}/roles/{roleKey}
       → { success: boolean }

// Role catalog
GET  /api/access/roles/catalog
     → { data: CatalogRole[] }

GET  /api/access/roles/{roleKey}/summary
     → { 
         role_key: string,
         role_name: string,
         user_count: number,
         page_count: number,
         modules: { name: string, access_level: string }[]
       }
```

**Permissions:**
```typescript
// Role permissions
GET  /api/access/roles/{roleKey}/permissions
     → { data: RolePageRow[] }

PUT  /api/access/roles/{roleKey}/permissions
     Body: { 
       updates: { 
         page_code: string, 
         permissions: { can_view, can_create, can_edit, can_delete, can_export }
       }[] 
     }
     → { success: boolean, updated_count: number }

// Page catalog
GET  /api/access/pages/catalog
     → { data: PageCatalogEntry[] }
```

**Administration:**
```typescript
// Access requests
GET  /api/access/requests?status=pending&limit=50
     → { data: AccessRequestRow[] }

POST /api/access/requests/{id}/approve
     Body: { review_note?: string }
     → { success: boolean }

POST /api/access/requests/{id}/deny
     Body: { review_note: string }
     → { success: boolean }

// RBAC sync
GET  /api/access/rbac/status
     → { 
         synced: boolean,
         last_sync: string,
         conflicts: RbacMismatch[],
         mysql_count: number,
         supabase_count: number
       }

POST /api/access/rbac/sync
     → { success: boolean, synced_count: number }

// Activity feed
GET  /api/access/activity?limit=10&offset=0
     → { data: ActivityRow[], total: number }
```

### State Management

**React Query:**
```typescript
// Query keys structure
['role-catalog']                    // All roles
['user-search', searchQuery]        // User search results
['user-roles', userId]              // User's assigned roles
['role-summary', roleKey]           // Role card data
['role-permissions', roleKey]       // Role's page permissions
['page-catalog']                    // All pages
['pending-requests']                // Access requests
['rbac-status']                     // Sync status
['activity-feed', limit, offset]    // Activity log
```

**Local State:**
```typescript
// Modal states
const [assignRoleModalOpen, setAssignRoleModalOpen] = useState(false);
const [editPermissionsModalOpen, setEditPermissionsModalOpen] = useState(false);

// Tab state (persisted in URL)
const [activeTab, setActiveTab] = useState<'users' | 'permissions' | 'admin'>('users');

// Selection states
const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
const [selectedRoleKey, setSelectedRoleKey] = useState<string | null>(null);

// Pending edits (optimistic updates)
const [pendingPermissionEdits, setPendingPermissionEdits] = useState<Map<string, Permissions>>();
```

**URL State (Bookmarkable):**
```
/settings/access-control?tab=users
/settings/access-control?tab=permissions&role=admin
/settings/access-control?tab=admin&request=abc-123
```

---

## Error Handling & Edge Cases

### Scenario 1: User Has No Roles
```
┌─────────────────────────────────┐
│ 👤 John Doe                     │
│    john@company.com             │
│                                 │
│    ⚠️ No roles assigned         │
│    This user cannot access      │
│    any pages in the system.     │
│                                 │
│    [Assign Role →]              │
└─────────────────────────────────┘
```
**Action:** Prominent "Assign Role" button, different visual style (amber background)

---

### Scenario 2: Role Has No Permissions
```
┌─────────────────────────────────┐
│ 🎭 Custom Role                  │
│    👥 0 users                   │
│    📄 0 pages                   │
│                                 │
│    ⚠️ No permissions configured │
│    This role has no access      │
│    to any pages.                │
│                                 │
│    [Add Permissions →]          │
└─────────────────────────────────┘
```
**Action:** Show warning badge, provide quick link to permissions tab

---

### Scenario 3: RBAC Sync Conflict
```
┌─────────────────────────────────────┐
│ ⚠️ Sync Conflict Detected           │
│                                     │
│ 3 users have roles in MySQL but    │
│ not in Supabase. This may cause    │
│ authentication issues.              │
│                                     │
│ Affected users:                     │
│ • john@company.com (admin)          │
│ • jane@company.com (wfm)            │
│ • bob@company.com (hr)              │
│                                     │
│ [View Details] [Auto-Resolve]      │
└─────────────────────────────────────┘
```
**Action:** Alert panel with details, offer auto-resolve or manual review

---

### Scenario 4: Permission Save Fails
```
Toast Notification:
┌─────────────────────────────────────┐
│ ❌ Failed to save permissions       │
│                                     │
│ Some pages may be locked by another │
│ admin or a system process.          │
│                                     │
│ Conflicting pages:                  │
│ • Payroll (locked by Jane Smith)   │
│ • Reports (system lock active)      │
│                                     │
│ [Retry]  [View Conflicts]  [Dismiss]│
└─────────────────────────────────────┘
```
**Action:** Show detailed error, offer retry, show conflicts

---

### Scenario 5: Concurrent Edits
```
Modal Warning:
┌─────────────────────────────────────┐
│ ⚠️ Concurrent Edit Detected          │
│                                     │
│ Another admin (Jane Smith) is       │
│ currently editing permissions for   │
│ the "Admin" role.                   │
│                                     │
│ Last modified: 30 seconds ago       │
│                                     │
│ What would you like to do?          │
│                                     │
│ [Cancel & Reload]                   │
│ [Continue Anyway (may conflict)]    │
│ [View Their Changes]                │
└─────────────────────────────────────┘
```
**Action:** Detect concurrent edits via timestamp, offer safe options

---

### Scenario 6: Empty States

**No Users Found:**
```
┌─────────────────────────────────────┐
│         🔍                          │
│                                     │
│    No users found matching          │
│    your search.                     │
│                                     │
│    Try different keywords or        │
│    check spelling.                  │
│                                     │
│    [Clear Search]                   │
└─────────────────────────────────────┘
```

**No Pending Requests:**
```
┌─────────────────────────────────────┐
│         ✓                           │
│                                     │
│    All caught up!                   │
│    No pending access requests.      │
│                                     │
│    New requests will appear here.   │
└─────────────────────────────────────┘
```

**No Activity:**
```
┌─────────────────────────────────────┐
│         📊                          │
│                                     │
│    No recent activity.              │
│                                     │
│    Activity will appear here once   │
│    users or admins make changes.    │
└─────────────────────────────────────┘
```

---

## Testing Strategy

### Unit Tests

**Component Tests:**
```typescript
// UserRoleCard.test.tsx
- Renders user name and email correctly
- Shows all assigned roles
- "Add Role" button opens modal
- "Edit" button enables inline editing
- Expands to show full details on click

// RoleSummaryCard.test.tsx
- Displays role name and icon
- Shows correct user count
- Shows correct page count
- Expands to show users and pages
- Lazy loads details on first expand

// PermissionPageRow.test.tsx
- Renders page name and module
- Shows correct access level badge
- Click cycles through permission levels
- Save button appears when edited
- Resets on cancel

// AccessRequestCard.test.tsx
- Renders request details correctly
- Approve button triggers approval
- Deny button requires reason
- Shows approval status correctly
```

**Hook Tests:**
```typescript
// usePermissionGroups.test.ts
- Groups pages by module correctly
- Handles empty module name
- Sorts modules alphabetically
- Preserves page order within module

// useAccessLevelBadge.test.ts
- Returns correct icon for permission set
- "No Access" when all false
- "View Only" when only can_view
- "Editor" when view + edit
- "Creator" when view + create + edit
- "Full Access" when all true
```

### Integration Tests

**Workflow Tests:**
```typescript
// Assign Role Workflow
1. Click "Assign Role" quick action
2. Search for user "John Doe"
3. Select user from dropdown
4. Select role "WFM"
5. Verify permission preview shows correct data
6. Click "Assign Role"
7. Verify toast notification appears
8. Verify user card updates with new role
9. Verify role card user count increments

// Edit Permissions Workflow
1. Navigate to Permissions tab
2. Select role "Admin"
3. Expand "Payroll" module
4. Click "Payroll" page row (cycle to "Read Only")
5. Click "Save" button
6. Verify toast notification
7. Verify badge updates to "View Only"
8. Re-expand module
9. Verify changes persisted

// Approve Request Workflow
1. Navigate to Administration tab
2. Verify pending requests count badge
3. Click first request card
4. Read request details
5. Click "Approve" button
6. Verify request disappears from list
7. Verify badge count decrements
8. Verify activity feed shows approval
```

### Performance Tests

**Metrics to Measure:**
```typescript
// Initial Load
- Time to First Contentful Paint (FCP)
- Time to Interactive (TTI)
- Total Bundle Size
- API calls count on mount

Target: FCP < 1.5s, TTI < 2s, <5 API calls

// Tab Switch
- Time to render new tab content
- API call latency
- Perceived performance (loading states)

Target: Render < 300ms, API < 500ms

// Search
- Debounce delay effectiveness
- Results rendering time
- API response time

Target: Debounce 300ms, Render < 200ms, API < 400ms

// Save Operations
- Optimistic update speed
- Background sync time
- Error recovery time

Target: Optimistic < 100ms, Sync < 1s
```

### Accessibility Tests

**WCAG 2.1 AA Compliance:**
```typescript
// Keyboard Navigation
- Tab through all interactive elements
- Enter/Space activates buttons
- Escape closes modals
- Arrow keys navigate lists
- No keyboard traps

// Screen Reader
- All images have alt text
- Buttons have aria-labels
- Form inputs have labels
- Status messages announced
- Loading states announced

// Visual
- Minimum 4.5:1 contrast ratio (AA)
- Focus indicators visible
- Text resizable to 200%
- No content loss at 400% zoom
- Motion can be disabled

// Forms
- Labels associated with inputs
- Error messages announced
- Required fields indicated
- Validation messages clear
- Success feedback provided
```

---

## Migration Plan

### Phase 1: Parallel Implementation (Week 1)
1. Create new page at `/settings/access-control-v2`
2. Implement Tab 1 (Users & Roles)
3. Implement core modals (Assign Role)
4. Test with limited users

### Phase 2: Complete Features (Week 2)
1. Implement Tab 2 (Permissions)
2. Implement Tab 3 (Administration)
3. Migrate all functionality from old page
4. Performance optimization

### Phase 3: User Testing (Week 3)
1. Beta release to admin users
2. Gather feedback
3. Fix bugs and adjust UX
4. Finalize documentation

### Phase 4: Rollout (Week 4)
1. Replace old page at `/settings/access-control`
2. Archive old page as backup
3. Monitor for issues
4. Iterate based on feedback

### Rollback Plan
If critical issues discovered:
1. Revert route to old page
2. Keep new page at `/settings/access-control-v2`
3. Fix issues
4. Re-test and re-deploy

---

## Success Metrics

### Quantitative Metrics
| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Initial load time | ~5s | <2s | Lighthouse |
| Tab switch time | ~1s | <500ms | Chrome DevTools |
| Search response | ~800ms | <300ms | Network tab |
| Clicks to assign role | 4 clicks | 2 clicks | User flow |
| Lines of code | 905 | <500 | File size |
| API calls on load | 8+ | <5 | Network monitor |

### Qualitative Metrics
- User satisfaction survey (5-point scale)
  - Target: Average > 4.0
- Task completion rate
  - Target: >95% complete task without help
- Time to complete common task (assign role)
  - Target: <30 seconds
- Support tickets related to access control
  - Target: 50% reduction

---

## Technical Debt & Future Improvements

### Known Limitations (OK for V1)
1. **Permission matrix** could still be large (100+ pages)
   - Mitigation: Module grouping, search, "show only granted" filter
   - Future: Add "frequently used pages" section

2. **Concurrent edit detection** is timestamp-based
   - Mitigation: Warn users of potential conflicts
   - Future: Implement proper optimistic locking

3. **Designation roles** moved to Admin tab
   - Current: Collapsed section, less discoverable
   - Future: Improve workflow if usage increases

### Future Enhancements (Post-V1)
1. **Bulk role assignment** - Assign role to multiple users at once
2. **Role templates** - Create new roles from templates
3. **Permission comparison** - Compare two roles side-by-side
4. **Role inheritance** - Child roles inherit parent permissions
5. **Temporary access** - Time-limited role assignments
6. **Approval workflows** - Multi-stage approval for sensitive roles
7. **Excel export/import** - Bulk permission management
8. **Role analytics** - Usage patterns, audit reports

---

## Component Architecture

### File Structure
```
src/pages/
  UnifiedAccessControlV2.tsx          # Main page (replaces 905-line file)

src/components/access-control/
  tabs/
    UsersRolesTab.tsx                 # Tab 1
    PermissionsTab.tsx                # Tab 2
    AdministrationTab.tsx             # Tab 3
  
  user-management/
    UserSearchPanel.tsx               # User search + list
    UserRoleCard.tsx                  # Individual user card
    AssignRoleModal.tsx               # Assign role workflow
  
  role-management/
    RoleCardGrid.tsx                  # Role cards container
    RoleSummaryCard.tsx               # Individual role card
    RoleDetailPanel.tsx               # Expanded role details
  
  permissions/
    PermissionModuleGroup.tsx         # Collapsible module section
    PermissionPageRow.tsx             # Individual page permission
    PermissionTemplateDialog.tsx      # Apply template modal
    AccessLevelBadge.tsx              # Visual permission indicator
    EditPermissionsModal.tsx          # Detailed edit modal
  
  administration/
    AccessRequestCard.tsx             # Individual request
    RBACStatusPanel.tsx               # Sync status display
    ActivityFeedItem.tsx              # Activity log entry
    DesignationRoleManager.tsx        # Designation mappings
  
  shared/
    QuickActionCard.tsx               # Reusable action card
    EmptyState.tsx                    # Empty state component
    LoadingSpinner.tsx                # Loading indicator

src/hooks/
  useAccessControl.ts                 # API calls + React Query
  usePermissionGroups.ts              # Group pages by module
  useAccessLevelBadge.ts              # Determine access level icon
  useDebounce.ts                      # Debounce search input
```

### Shared Types
```typescript
// src/types/access-control.ts

export type AccessLevel = 
  | 'no-access'
  | 'view-only'
  | 'editor'
  | 'creator'
  | 'full-access';

export interface UserWithRoles {
  id: string;
  email: string;
  full_name: string;
  roles: RoleInfo[];
  scopes: ScopeInfo[];
}

export interface RoleInfo {
  role_key: string;
  role_name: string;
  role_description?: string;
}

export interface RoleSummary {
  role_key: string;
  role_name: string;
  user_count: number;
  page_count: number;
  modules: ModuleAccessSummary[];
}

export interface ModuleAccessSummary {
  module_name: string;
  page_count: number;
  access_level: AccessLevel;
}

export interface PermissionSet {
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_export: boolean;
}

export interface PagePermission {
  page_code: string;
  page_name: string;
  module: string;
  permissions: PermissionSet;
}

export interface GroupedPermissions {
  module: string;
  pages: PagePermission[];
  summary: AccessLevel;
}
```

---

## Accessibility Specifications

### Keyboard Navigation Map
```
Tab Navigation Order:
1. Quick Action Cards (Tab 1, 2, 3...)
2. Main content area (search input)
3. Results list (focusable cards)
4. Action buttons (Edit, Delete, etc.)
5. Next tab navigation

Key Bindings:
- Tab: Move to next focusable element
- Shift+Tab: Move to previous element
- Enter/Space: Activate button/link
- Escape: Close modal/cancel action
- Arrow keys: Navigate within lists
- Home/End: Jump to first/last item
- Ctrl+F: Focus search input (custom)
- Ctrl+S: Save changes (when editing)
```

### ARIA Labels
```typescript
// Quick action cards
<button aria-label="Assign role to user. Opens dialog.">
  
// Role cards
<div role="article" aria-label="Admin role. 5 users, 45 pages.">

// Permission checkboxes
<input 
  type="checkbox" 
  aria-label="Allow view access for Payroll page"
  aria-describedby="payroll-page-description"
/>

// Loading states
<div role="status" aria-live="polite" aria-busy="true">
  Loading permissions...
</div>

// Success/error messages
<div role="alert" aria-live="assertive">
  Role assigned successfully
</div>
```

### Focus Management
```typescript
// On modal open
- Move focus to modal title
- Trap focus within modal
- Restore focus on close

// On tab switch
- Preserve scroll position
- Don't reset focus (stay on tab button)
- Announce tab change to screen readers

// On search
- Keep focus in search input
- Announce result count
- Allow arrow keys to navigate results

// On error
- Move focus to error message
- Provide clear recovery action
- Announce error to screen readers
```

---

## Design Decisions & Rationale

### Why Hybrid Over Pure Single-Page?
- **User feedback:** Power users prefer tabs for mental organization
- **Performance:** Tabs enable better lazy loading boundaries
- **Bookmarkability:** URL state (`?tab=permissions`) aids navigation
- **Scalability:** Easier to add new sections as tabs vs endless scroll

### Why 3 Tabs Instead of 2 or 4?
- **3 matches mental model:** Users/Roles, Permissions, Admin
- **2 too few:** Would overload tabs (Users+Perms+Admin in 2 tabs)
- **4+ too many:** Brings back original problem (6 tabs was overwhelming)
- **Rule of 7±2:** Cognitive load research supports 3-5 major sections

### Why Visual Icons Over Checkboxes?
- **Reduced cognitive load:** One icon vs scanning 5 checkboxes
- **Faster recognition:** Brain processes icons faster than text
- **Space efficient:** Icons take less visual space
- **Accessibility:** Icons have proper ARIA labels + text fallbacks

### Why Module Grouping Over Flat List?
- **Context:** Pages make more sense within their module
- **Navigation:** Collapsible sections reduce scrolling 80%+
- **Performance:** Render only expanded modules (virtual scrolling)
- **Mental model:** Users think in modules ("I need WFM access")

### Why Quick Actions Over Buried in Tabs?
- **Task-based design:** Matches how users work (assign role, check requests)
- **Efficiency:** Most common task (assign role) is 1 click away
- **Discoverability:** New users see available actions immediately
- **Consistency:** Same pattern across all 3 tabs

---

## Appendix: Design System

### Color Palette
```typescript
// Access level colors
const ACCESS_COLORS = {
  noAccess: 'text-slate-400 bg-slate-50',
  viewOnly: 'text-blue-600 bg-blue-50',
  editor: 'text-green-600 bg-green-50',
  creator: 'text-purple-600 bg-purple-50',
  fullAccess: 'text-indigo-600 bg-indigo-50',
};

// Status colors
const STATUS_COLORS = {
  pending: 'text-amber-600 bg-amber-50',
  approved: 'text-green-600 bg-green-50',
  denied: 'text-red-600 bg-red-50',
  synced: 'text-emerald-600 bg-emerald-50',
  conflict: 'text-orange-600 bg-orange-50',
};
```

### Typography
```typescript
// Heading hierarchy
h1: text-2xl font-bold text-slate-900
h2: text-xl font-semibold text-slate-900
h3: text-lg font-semibold text-slate-800
h4: text-base font-medium text-slate-700

// Body text
body: text-sm text-slate-700
small: text-xs text-slate-500
caption: text-xs text-slate-400
```

### Spacing Scale
```typescript
// Consistent spacing
const SPACING = {
  xs: '0.25rem',   // 4px
  sm: '0.5rem',    // 8px
  md: '1rem',      // 16px
  lg: '1.5rem',    // 24px
  xl: '2rem',      // 32px
  '2xl': '3rem',   // 48px
};
```

### Component Sizes
```typescript
// Quick action cards
card: 'p-6 min-h-[120px]'

// Role cards
roleCard: 'p-4 min-h-[100px] w-full md:w-[250px]'

// User cards
userCard: 'p-3 border-b'

// Buttons
buttonSm: 'h-8 px-3 text-xs'
buttonMd: 'h-10 px-4 text-sm'
buttonLg: 'h-12 px-6 text-base'
```

---

## Sign-Off

**Designed by:** Claude (AI Assistant) + Shuvam (Product Owner)  
**Approved by:** Shuvam  
**Date:** 2026-06-16

**Next Steps:**
1. Write implementation plan (using `writing-plans` skill)
2. Create component stubs
3. Implement Tab 1 (Users & Roles)
4. Iterate based on feedback

---

**END OF DESIGN SPECIFICATION**
