# Employee Journey Pages - Comparison Analysis
**Date:** 2026-07-14  
**Purpose:** Compare `/employee-journey` vs `/employee-stat-card` to determine if they serve same or different objectives

---

## Quick Answer

**DIFFERENT OBJECTIVES** - These are **two separate pages** serving **distinct purposes**:

1. **`/employee-journey`** = **Timeline View** (Lifecycle storytelling)
2. **`/employee-stat-card`** = **Dashboard View** (Current stats & metrics)

---

## Detailed Comparison

### `/employee-journey` - Employee Journey Timeline

**Purpose:** Visual storytelling of employee's career progression and lifecycle events

**What it shows:**
- **Timeline visualization** with events chronologically ordered
- **Lifecycle events:** Promotions, transfers, training, achievements, appraisals
- **Career progression:** From-to designations, salary changes, department moves
- **Historical narrative:** "Where have they been? How did they grow?"

**Data fetched:**
- Journey events from `/api/employees/me/journey`
- Promotions from `/api/employees/me/promotions`
- Transfers from `/api/employees/me/transfers`

**UI Components:**
- Vertical timeline with colored event icons
- Event cards showing:
  - Event type (Promotion, Transfer, Training, etc.)
  - Date of event
  - Description (Old → New values)
  - Salary changes (for promotions)
  - Location changes (for transfers)

**Example events displayed:**
```
📈 PROMOTION | June 15, 2025
   Associate → Senior Associate (+15% salary)

📍 TRANSFER | March 10, 2024  
   Sales Dept → Operations Dept | Mumbai → Delhi

🎓 TRAINING | January 5, 2024
   Completed Leadership Development Program

⭐ ACHIEVEMENT | November 20, 2023
   Awarded Employee of the Month
```

**Use case:** 
- Employee wants to see their career growth journey
- Manager reviewing employee's progression history
- HR tracking career milestones for appraisal/promotion decisions

---

### `/employee-stat-card` - Employee Statistics Dashboard

**Purpose:** Comprehensive dashboard showing **current status and metrics** across all modules

**What it shows:**
- **Overview tab:** Profile summary, tenure, department, contact info
- **Documents tab:** Document verification status, pending/missing docs
- **Attendance tab:** Monthly attendance records (clock in/out, hours, status)
- **Leave tab:** Current leave balances + request history
- **Payslips tab:** Recent payslips download
- **Assets tab:** Assigned assets list
- **Journey tab:** Recent lifecycle events (mini timeline)

**Data fetched:**
- Employee profile from `/api/employees/stat-card/:id`
- Leave balances
- Attendance summary
- Performance scores
- Assets count
- Documents status
- Journey events (summary)
- Gamification tier

**UI Components:**
- Tabbed interface with 7 tabs
- **Overview cards:**
  - Profile card with photo, designation, contact
  - Attendance % for current month
  - Leave balances summary
  - Performance score
  - Assets & documents count
- **Detailed tabs:**
  - Month-by-month attendance grid
  - Leave request history with status
  - Payslip download links
  - Assets list with serial numbers

**Example data displayed:**
```
OVERVIEW TAB:
- Name: John Doe | Emp Code: E12345
- Designation: Senior Associate | Tenure: 2 yrs 3 mos
- Attendance: 95% | Leave: 12.5 days remaining
- Performance: 4.2/5.0 | Assets: 3 active
- Documents: 2 pending verification

ATTENDANCE TAB:
Date        Clock In  Clock Out  Hours  Status
Jul 14      09:15     18:30     9.25h  Present
Jul 13      09:00     18:00     9.00h  Present
Jul 12      —         —         —      Absent

LEAVE TAB:
Casual Leave: 8.5 available (3.5 used)
Sick Leave: 4.0 available (2.0 used)
```

**Use case:**
- Employee checking their current status (attendance, leave balance, assets)
- Manager quickly viewing team member's profile and stats
- HR reviewing employee's document/asset status
- Self-service for payslip downloads

---

## Side-by-Side Comparison

| Aspect | `/employee-journey` | `/employee-stat-card` |
|--------|-------------------|---------------------|
| **Primary Focus** | Career progression timeline | Current status dashboard |
| **Time Orientation** | **Historical** (past events) | **Current** (present state) |
| **Data Type** | Lifecycle events, milestones | Metrics, balances, records |
| **View Type** | Timeline/Narrative | Dashboard/Tabs |
| **Key Question** | "How did I get here?" | "Where am I now?" |
| **Updates** | Occasional (on promotions/transfers) | Daily/Monthly (attendance, leave) |
| **User Intent** | Review career growth | Check current stats |
| **Visual Style** | Vertical timeline with event cards | Multi-tab dashboard with KPI cards |

---

## Data Source Comparison

### Employee Journey fetches:
```typescript
GET /api/employees/me/journey       // Lifecycle events
GET /api/employees/me/promotions    // Promotion records
GET /api/employees/me/transfers     // Transfer records
```

### Employee Stat Card fetches:
```typescript
GET /api/employees/stat-card/:id           // Profile + summary
GET /api/wfm/attendance/daily?employeeId=  // Attendance details
GET /api/leave/requests?employeeId=        // Leave requests
GET /api/payroll/payslips/employee/:id     // Payslips
GET /api/assets/employee/:id               // Assets
GET /api/documents/employee/:id            // Documents
```

**Overlap:** Both fetch "journey events" but use them differently:
- Journey page: **Primary content** (full timeline display)
- Stat Card: **One tab among many** (mini summary view)

---

## Use Case Examples

### Scenario 1: Employee Annual Appraisal
**Manager needs:**
- **Journey page:** To review promotions, achievements, training over past year
- **Stat Card:** To check current performance score, attendance %, active assets

### Scenario 2: Employee Self-Service
**Employee wants:**
- **Journey page:** "Show me my career milestones and growth trajectory"
- **Stat Card:** "What's my leave balance? Can I download last month's payslip?"

### Scenario 3: HR Document Verification
**HR needs:**
- **Journey page:** Not relevant
- **Stat Card:** See documents tab for pending verifications

### Scenario 4: Promotion Decision
**Management needs:**
- **Journey page:** Review previous promotions, time since last increment
- **Stat Card:** Check performance score, attendance consistency

---

## Current Sidebar Issue

**Problem:** Sidebar labels `/employee-stat-card` as "**Employee Journey**"

**Why it's confusing:**
- Users expect timeline view when clicking "Employee Journey"
- They get a dashboard instead
- Actual journey timeline page is not accessible via sidebar

**Impact:**
- Journey timeline page (`/employee-journey`) is orphaned
- Users don't discover the rich timeline visualization
- Naming mismatch creates UX confusion

---

## Recommendation

### Keep Both Pages - They Serve Different Purposes ✅

**Add to Lifecycle section in sidebar:**

```typescript
{
  label: "Lifecycle", 
  href: "/employee-lifecycle", 
  icon: ic(Users), 
  pageCode: "EMPLOYEE_LIFECYCLE", 
  description: "Employee lifecycle",
  children: [
    // CHANGE FROM:
    { label: "Employee Journey", href: "/employee-stat-card", icon: ic(Users), description: "Journey" },
    
    // TO:
    { label: "Employee Stat Card", 
      href: "/employee-stat-card", 
      icon: ic(Users), 
      description: "Employee metrics dashboard" },
      
    { label: "Employee Journey Timeline", 
      href: "/employee-journey", 
      icon: ic(TrendingUp), 
      description: "Career progression timeline" },
      
    // ... rest of items
  ],
},
```

**Alternative naming options:**

**Option A: Descriptive (Recommended)**
- "Employee Dashboard" + "Career Timeline"

**Option B: Role-focused**
- "My Stats" + "My Journey"

**Option C: Technical**
- "Employee Stat Card" + "Journey Timeline"

---

## Summary

### Objectives:

**`/employee-journey`:**
- ✅ Show **historical career progression**
- ✅ Timeline visualization of promotions, transfers, achievements
- ✅ Storytelling: "How did the employee grow?"

**`/employee-stat-card`:**
- ✅ Show **current status across all modules**
- ✅ Dashboard with tabs: attendance, leave, payslips, assets, documents
- ✅ Self-service: "What's my current state?"

### Conclusion:

**These are DIFFERENT pages** serving **complementary purposes**:
- Journey = Past (career story)
- Stat Card = Present (current snapshot)

**Both should be in sidebar with clear, distinct labels.**

---

## Implementation Required

1. **Rename** sidebar item from "Employee Journey" → "Employee Stat Card"
2. **Add** new sidebar item "Employee Journey Timeline" → `/employee-journey`
3. **Ensure** both have appropriate roles/pageCode
4. **Update** descriptions to clarify purpose

**Effort:** 10 minutes (sidebar update only, no code changes needed)
