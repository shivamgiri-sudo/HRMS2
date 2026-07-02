# Feature Discovery Guide

**Last Updated:** 2026-06-20

## Problem

The system has **124+ built pages** but many aren't discoverable through the main navigation because they're not explicitly linked in menus.

## Solution

### Dashboard Quick Actions (Entry Points)

#### For Admin/HR Users
1. **Add Employee** → `/onboarding` — Create onboarding entries
2. **Manage Assets** → `/assets` — Assign and track assets
3. **View Payroll** → `/payroll` — Payroll workspace
4. **Employee Journey** → `/employee-stat-card` — Lifecycle milestones
5. **Employee Directory** → `/employees` — Employee profiles
6. **Work Inbox** → `/work-inbox` — Pending HR actions
7. **Bulk Upload** → `/bulk-upload` — Mass import employee data
8. **All Modules** → `/modules` — Explore all system features ⭐

#### For Employee Users
1. **Request Leave** → `/leaves` — Apply for time off
2. **My KPIs** → `/performance` — Performance metrics
3. **View Attendance** → `/attendance` — Attendance status
4. **My Profile** → `/profile` — Update details and photo
5. **My Payslips** → `/profile?tab=payslips` — Salary statements
6. **My Journey** → `/profile?tab=journey` — Milestones and recognition
7. **My Modules** → `/modules` — Access all available features ⭐

### Module Launcher (`/modules`)

**The primary discovery tool** — shows all modules accessible to your role:

- **HRMS** — Employee self-service, lifecycle, profiles, leave, attendance, payroll
- **ATS** — Recruitment, candidate management, hiring pipeline
- **LMS** — Learning management, training, certifications
- **WFM** — Workforce management, rostering, scheduling, auto-allocation
- **QUALITY** — Quality assurance, call scoring, compliance
- **OPERATIONS** — Operations management, KPI tracking, real-time adherence
- **PERFORMANCE** — Performance feedback, appraisals, goals, development plans
- **SETTINGS** — System configuration, master data, integrations

Each module shows **all pages you have permission to access**.

## Complete Feature Map (124+ Pages)

### Core HRMS (Employee Self-Service)
- Employee Profile + Payslips
- Leave Management
- Attendance & Regularization
- Resignation & Exit
- Lifecycle Milestones
- My KPIs & Performance

### ATS & Recruitment
- Candidate Registration (Public Web Form)
- Recruitment Workspace
- Candidate Master
- Waiting Queue
- BGV Verification
- Onboarding Bridge
- Offer Letter Generation

### LMS Integration
- My Learning
- Coordinator Dashboard
- Admin Dashboard
- Integration Admin

### WFM & Rostering
- Auto-Roster Engine
- Planning Rules & Slot Requirements
- Week-Off Preferences & Rules
- Roster Management Queue
- Manager Approvals
- Live Tracker (Real-Time Adherence)
- Biometric Integration

### Attendance & Compliance
- Attendance Disputes (Phase 3)
- Manual Attendance Overrides (Phase 4)
- Attendance Exception Engine
- Cosec Sync Monitoring
- Biometric Command Center

### Payroll & Finance
- Payslip Center
- Full & Final Settlement
- Tax Declaration
- Statutory Compliance
- Payroll Readiness
- Payroll Masters
- Salary Packages

### Quality & Compliance
- Quality Dashboard
- Quality Agents Leaderboard
- Compliance Tracking (DPDP, Labour, etc.)
- Maternity Leave Management

### Operations & KPI
- Operations Dashboard
- Real-Time Adherence (RTA) Board
- KPI Configuration
- Agent Performance Dashboard
- Leaderboard

### Management & Command Centers
- CEO Command Center
- Management Dashboard
- Quality Command Center
- Operations Command Center
- Business Action Queue
- Grievance Command Center
- People Experience Center
- Support Command Center

### HR Operations
- Bulk Upload Hub
- Migration Console
- Integration Hub
- Assets Management
- Document Verification
- Letters & Communications
- Helpdesk
- Workflow Admin
- IT Provisioning Tracker

### Performance & Development
- Performance Feedback
- Development Plans
- Appraisals
- Goals Management
- Career Planning
- PIP Management

### Engagement & Recognition
- Kudos & Recognition
- Badges & Achievements
- Surveys
- Leaderboards

### Administration
- Organization Masters
- Process Configuration
- Call Centre Configuration
- Location Policy Masters
- Client Master
- Portal Data Manager
- Audit Log
- Access Control
- Role Management

## How to Access Hidden Features

### Method 1: Go to /modules (Recommended)
```
https://yourdomain.com/modules
```
Shows all features you have permission to access, grouped by module.

### Method 2: Dashboard Quick Actions
Click "All Modules" or "My Modules" on the main dashboard.

### Method 3: Direct URL (If You Know the Path)
```
/bulk-upload
/attendance/disputes
/audit-log
/payroll/masters
/quality-dashboard
/rta/board
/wfm/auto-roster
etc.
```

### Method 4: Browser Console (Developer)
```javascript
// Get all routed paths
fetch('/api/access/pages/my-catalog')
  .then(r => r.json())
  .then(d => console.table(d.data))
```

## What Determines Access?

Every page is gated by **role-based access control**:

| Role | Modules | Typical Pages |
|------|---------|---------------|
| **admin** | All | All 124+ pages |
| **super_admin** | All | All 124+ pages |
| **payroll_head** | HRMS, Payroll, Audit | Payroll, Tax, F&F, Audit Log, Manual Overrides |
| **hr** | HRMS, ATS, LMS, Payroll | Recruitment, Onboarding, Bulk Upload, Payroll, Learning |
| **wfm** | WFM, Attendance, Quality | Rostering, Auto-Allocation, Live Tracker, Disputes |
| **manager** | HRMS, WFM, Performance | Team roster, Leave approval, Performance feedback |
| **employee** | HRMS, LMS, Performance | Self-service only: profile, leave, attendance, payslips, learning |

## Feature Visibility Rules

1. **No page is "hidden"** — all 124+ pages are routed and functional
2. **All pages are role-gated** — `/modules` shows only what you can access
3. **Direct URL access is controlled** — accessing a page you lack permission for returns 403
4. **Admin/Super Admin see everything** — no restrictions

## Recent Additions (Not Yet in Main Navigation)

These features exist and are fully functional but added recently:

- **Bulk Upload** — Admin/HR quick action (Phase 2 completion)
- **Attendance Disputes** — WFM module (Phase 3 completion)
- **Manual Attendance Overrides** — Payroll module (Phase 4 completion)
- **Audit Log + CSV Export** — Admin/Payroll module (Phase 5 completion)
- **Module Launcher** — Universal discovery tool (all roles)

## How to Add Features to Quick Actions

If you want a feature to appear in the main dashboard menu:

**File:** `src/pages/Index.tsx`

**Add to `quickActions` array:**

```typescript
{
  title: "Feature Name",
  description: "Short description",
  path: "/route-path",
  icon: <IconName className="h-4 w-4" />,
}
```

**For Admin/HR:** Add before line 289 (in first array)  
**For Employees:** Add before line 327 (in second array)

## Testing Discovery

After deployment:

1. ✅ Dashboard loads quick actions without errors
2. ✅ "All Modules" / "My Modules" button visible
3. ✅ Clicking takes you to `/modules`
4. ✅ Module launcher shows all your role's features
5. ✅ Clicking a feature loads the page (or returns permission error if revoked)

## Support

If a feature you expect doesn't appear in `/modules`:

1. Check your role permission (ask admin to verify)
2. Clear browser cache (Ctrl+Shift+Delete)
3. Refresh page (Ctrl+F5)
4. Check admin access log (`/audit-log`) for permission revocations
5. Contact system admin if still missing

---

**Note:** This document lists features as of the MVP completion date. New features are added regularly — check `/modules` for the most current list.
