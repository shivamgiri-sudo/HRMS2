# Missing Report Pages Analysis
**Date:** 2026-07-14  
**Purpose:** Identify all report pages that exist but are missing from sidebar navigation

---

## Summary

Found **3 report pages** that exist as routes but are NOT in the sidebar navigation:

1. ❌ **LMS Progress Dashboard** (`/lms/progress-dashboard`) - CRITICAL
2. ❌ **Compliance Audit Report** (`/compliance/audit-report`) - CRITICAL  
3. ⚠️ **Employee Journey** (`/employee-journey`) - Confusing naming issue

---

## Detailed Findings

### 1. LMS Progress Dashboard ❌ MISSING

**Route:** `/lms/progress-dashboard`  
**Component:** `LMSProgressDashboard`  
**Purpose:** Training completion and progress analytics

**What it shows:**
- Employee training progress tracking
- Course completion rates
- Learning path analytics
- Training effectiveness metrics

**Why it's critical:**
- Management needs visibility into training completion
- HR needs to track mandatory training compliance
- Managers need to see team training status

**Where to add:** Workforce → Learning section

**Suggested entry:**
```typescript
{ label: "Progress Dashboard", 
  href: "/lms/progress-dashboard", 
  icon: ic(BarChart3), 
  pageCode: "LMS_PROGRESS_DASHBOARD", 
  roles: ["admin","hr","manager","lms_coordinator","super_admin"], 
  description: "Training progress analytics" }
```

---

### 2. Compliance Audit Report ❌ MISSING

**Route:** `/compliance/audit-report`  
**Component:** `NativeComplianceAuditReport`  
**Purpose:** Comprehensive compliance audit reporting

**What it shows:**
- Statutory compliance status (EPF, ESI, PT, etc.)
- Labour law compliance tracking
- DPDP (data privacy) compliance
- Audit findings and remediation status

**Why it's critical:**
- Required for regulatory audits
- Finance and HR teams need access
- Legal compliance verification
- Management oversight

**Where to add:** Operations → Payroll section (after "Labour Compliance")

**Suggested entry:**
```typescript
{ label: "Compliance Audit Report", 
  href: "/compliance/audit-report", 
  icon: ic(FileCheck), 
  roles: ["admin","hr","super_admin"], 
  description: "Comprehensive compliance audit" }
```

---

### 3. Employee Journey ⚠️ NAMING CONFUSION

**Issue:** There are TWO different employee journey-related pages:

#### Route A: `/employee-journey`
- **Component:** `EmployeeJourney`
- **Purpose:** Timeline visualization of employee lifecycle events
- **Shows:** Promotions, transfers, designation changes, lifecycle milestones
- **Status:** Route exists but NOT in sidebar

#### Route B: `/employee-stat-card`
- **Component:** `NativeEmployeeStatCard`
- **Purpose:** Employee statistics and KPI dashboard
- **Shows:** Attendance metrics, performance scores, current stats
- **Status:** IN sidebar but labeled as "Employee Journey"

**Problem:**
- Sidebar says "Employee Journey" but links to `/employee-stat-card`
- The actual `/employee-journey` route is orphaned
- Confusing for users expecting timeline but getting stats dashboard

**Recommendation:** Add both with clear distinction:

**Option A: Keep both (recommended):**
```typescript
// In Lifecycle section
{ label: "Employee Stat Card", 
  href: "/employee-stat-card", 
  icon: ic(Users), 
  description: "Employee metrics & KPIs" },
{ label: "Employee Journey Timeline", 
  href: "/employee-journey", 
  icon: ic(TrendingUp), 
  description: "Lifecycle timeline view" }
```

**Option B: Consolidate (if they serve same purpose):**
- Merge functionality into one component
- Redirect one route to the other
- Update sidebar label to match actual functionality

---

## Reports Already in Sidebar ✅

These report pages are correctly included:

### Overview Section:
- ✅ Reports Center (`/reports`) - Master reports hub

### Operations → Payroll:
- ✅ Payroll Variance Report
- ✅ Payroll Audit Trail
- ✅ Statutory Filing Tracker
- ✅ Cost Summary
- ✅ EPF Compliance

### Operations → Performance:
- ✅ Team Reports (Performance feedback)
- ✅ Agent Performance Dashboard

### People & Hiring → ATS:
- ✅ BGV Reports
- ✅ ATS Sourcing Analysis
- ✅ Hiring Dashboard

### Operations → Call Master:
- ✅ Call Master Dashboard
- ✅ Inbound Dashboard

### Operations → Brand Sales:
- ✅ Brand Analytics

### My Space → Engage:
- ✅ Feedback (My performance reports)

### Expenses:
- ✅ Expense Reports

---

## NativeReportsCenter Analysis

The `/reports` route leads to `NativeReportsCenter.tsx` which is a **comprehensive reports hub** with **150+ reports** organized into categories:

### Report Categories Available:
1. **HR & Workforce** (13 reports)
   - Headcount, org structure, employee movement, lifecycle events
2. **Attendance** (14 reports)
   - Daily/monthly attendance, shift adherence, overtime, shrinkage
3. **Leave** (9 reports)
   - Leave balance, utilization, LWP reconciliation
4. **Payroll** (12 reports)
   - Salary register, variance, statutory compliance
5. **Recruitment** (8 reports)
   - ATS pipeline, source effectiveness, interview analytics
6. **Performance** (7 reports)
   - Appraisal, feedback, PIP tracking
7. **Exit** (5 reports)
   - Resignation, exit interviews, attrition analysis
8. **Compliance** (6 reports)
   - Labour law, DPDP, statutory filings
9. **Training** (4 reports)
   - LMS completion, training effectiveness
10. **Operations** (5 reports)
    - Quality, productivity, shrinkage

**Note:** NativeReportsCenter is the master reports catalog. The sidebar link to `/reports` gives access to all these reports. Individual report pages like LMS Progress Dashboard and Compliance Audit Report are **standalone detailed dashboards** separate from the reports center.

---

## Recommended Implementation

### Add 3 Missing Pages to Sidebar:

**1. Add to Workforce → Learning section:**
```typescript
{
  label: "Learning",     href: "/lms/my-learning", icon: ic(GraduationCap), pageCode: "LMS_MY_LEARNING", description: "LMS & training",
  children: [
    { label: "My Learning",    href: "/lms/my-learning",  icon: ic(GraduationCap), pageCode: "LMS_MY_LEARNING",  description: "LMS" },
    { label: "Team Training",  href: "/lms/team-training",icon: ic(Users),         pageCode: "LMS_TEAM_TRAINING",roles: ["manager","admin","hr"], description: "Team training" },
    { label: "Training Admin", href: "/lms/admin",        icon: ic(Settings),      pageCode: "LMS_ADMIN",        roles: ["admin","hr"], description: "LMS admin" },
    // ADD THIS:
    { label: "Progress Dashboard", href: "/lms/progress-dashboard", icon: ic(BarChart3), pageCode: "LMS_PROGRESS_DASHBOARD", roles: ["admin","hr","manager","lms_coordinator","super_admin"], description: "Training progress analytics" },
  ],
},
```

**2. Add to Operations → Payroll section:**
```typescript
{
  label: "Payroll", href: "/payroll", icon: ic(CreditCard), roles: ["admin","hr","finance","payroll"], description: "Payroll & statutory",
  children: [
    // ... existing items ...
    { label: "Labour Compliance",     href: "/compliance/labour",            icon: ic(Landmark),   pageCode: "LABOUR_COMPLIANCE", roles: ["admin","hr","finance"], description: "Labour" },
    // ADD THIS:
    { label: "Compliance Audit Report", href: "/compliance/audit-report", icon: ic(FileCheck), roles: ["admin","hr","super_admin"], description: "Comprehensive compliance audit" },
    // ... rest of items ...
  ],
},
```

**3. Fix Employee Journey naming in Lifecycle section:**
```typescript
{
  label: "Lifecycle", href: "/employee-lifecycle", icon: ic(Users), pageCode: "EMPLOYEE_LIFECYCLE", description: "Employee lifecycle",
  children: [
    // CHANGE FROM:
    { label: "Employee Journey", href: "/employee-stat-card", icon: ic(Users), description: "Journey" },
    // TO:
    { label: "Employee Stat Card", href: "/employee-stat-card", icon: ic(Users), description: "Employee metrics & KPIs" },
    { label: "Employee Journey Timeline", href: "/employee-journey", icon: ic(TrendingUp), description: "Lifecycle timeline view" },
    // ... rest of items ...
  ],
},
```

---

## Database Migration Required

Add page catalog entries for the new pages:

```sql
INSERT INTO page_catalog (page_code, page_name, module, active_status) VALUES
  ('LMS_PROGRESS_DASHBOARD', 'LMS Progress Dashboard', 'Learning', 1),
  ('COMPLIANCE_AUDIT_REPORT', 'Compliance Audit Report', 'Compliance', 1)
ON DUPLICATE KEY UPDATE active_status = 1;

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit) VALUES
  ('admin', 'LMS_PROGRESS_DASHBOARD', 1, 0, 0),
  ('hr', 'LMS_PROGRESS_DASHBOARD', 1, 0, 0),
  ('manager', 'LMS_PROGRESS_DASHBOARD', 1, 0, 0),
  ('super_admin', 'LMS_PROGRESS_DASHBOARD', 1, 0, 0),
  ('admin', 'COMPLIANCE_AUDIT_REPORT', 1, 0, 1),
  ('hr', 'COMPLIANCE_AUDIT_REPORT', 1, 0, 0),
  ('super_admin', 'COMPLIANCE_AUDIT_REPORT', 1, 0, 1)
ON DUPLICATE KEY UPDATE can_view = 1;
```

---

## Impact Assessment

### Users Affected:

**LMS Progress Dashboard:**
- **Managers:** Can finally track team training completion
- **HR:** Can monitor training compliance
- **Admins:** Can analyze training effectiveness
- **Impact:** HIGH - Critical for training management

**Compliance Audit Report:**
- **Finance:** Can access compliance status for audits
- **HR:** Can verify statutory compliance
- **Legal/Compliance:** Can track audit findings
- **Impact:** HIGH - Required for regulatory compliance

**Employee Journey Clarification:**
- **All Users:** Will understand difference between stat card and timeline
- **Impact:** MEDIUM - Reduces confusion, improves UX

---

## Implementation Priority

**Phase 1: Add Critical Reports (Immediate)**
1. LMS Progress Dashboard - Add to Learning section
2. Compliance Audit Report - Add to Payroll section

**Phase 2: Fix Employee Journey (Next)**
3. Clarify Employee Journey vs Stat Card naming
4. Add both with distinct labels

**Effort Estimate:**
- Sidebar updates: 30 minutes
- Database migration: 10 minutes
- Testing: 20 minutes
- **Total:** ~1 hour

---

## Files to Modify

1. **src/components/layout/navConfig.tsx**
   - Add LMS Progress Dashboard to Learning section
   - Add Compliance Audit Report to Payroll section
   - Fix Employee Journey naming

2. **backend/sql/add_missing_report_pages.sql** (NEW FILE)
   - Insert 2 page catalog entries
   - Grant role permissions

---

## Summary

**Total Missing Report Pages:** 3
- 2 genuinely missing (LMS Progress, Compliance Audit)
- 1 naming confusion (Employee Journey)

**Recommendation:** Implement Phase 1 immediately to add critical missing reports.

**Next Steps:**
1. User approval to proceed
2. Update navConfig.tsx
3. Create database migration
4. Test with different roles
5. Deploy to production
