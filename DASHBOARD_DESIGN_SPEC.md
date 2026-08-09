# HRMS Dashboard Architecture Specification v1.0

**Status:** COMPREHENSIVE DESIGN SPECIFICATION
**Created:** 2026-06-21
**Scope:** Role-specific dashboard views with unified KPI architecture
**Data Sources:** `apr` (quality), `salary_prep_line` (payroll), `wfm_attendance_session` (WFM)

---

## 1. EXECUTIVE SUMMARY

### Core Principle
Four role-specific dashboards unified by:
- **Single data model** (MySQL `mas_hrms` as source of truth)
- **Consistent data formats** (employee codes, process names, date ranges)
- **Role-based access control** (resolved scope at API layer)
- **Live drill-down capability** (3-level deep from summary → detail → call-level)

### Delivery Approach
Each dashboard is a **self-contained module** with:
- Frontend React component (`*.tsx`)
- Backend API routes (`*.routes.ts`) with lazy-loaded queries
- Shared utility layer (formatters, role resolvers, chart components)
- Database views/aggregations (materialized where needed for >500K rows)

---

## 2. ROLE DEFINITIONS & SCOPES

| Role | Access | Scope | Example KPI | Drill-Down |
|---|---|---|---|---|
| **Individual (Agent)** | Self-only | Own metrics | My Quality Score, Percentile Rank | My calls → scoring breakdown |
| **Team Lead / RM** | Team + self | Process + team members | Team Avg Quality, My vs Team | Team matrix → individual agent → calls |
| **QA Manager** | By process | All processes | Process comparison, risk flags | Process → teams → agents → calls |
| **CEO / Super Admin** | Enterprise | All org units | 4-widget cockpit | Widget → full module → drill details |

### Scope Resolution Logic
```
if (role in [admin, hr, ceo, qa, analyst]) return GLOBAL_ACCESS
else if (role == process_manager || role == manager)
  return { processes: [assigned_process_ids] }
else if (role == branch_head)
  return { agent_codes: [branch_employees] }
else if (role == employee)
  return { employee_code: [self_code] }
else return DENIED
```

---

## 3. DATA DISPLAY STANDARDS

### Employee Display Format
- **In tables/lists:** `CODE - Name` (e.g., `EMP001 - John Doe`)
- **In dropdowns with contact:** `Name (email)` (e.g., `John Doe (john@company.com)`)
- **In hero stats:** `John Doe` (name only, full context assumed)
- **Search:** Multi-column (name, code, email, designation)

### Process Display Format
- **Never show process code alone** (e.g., ❌ `CS_001`)
- **Always show process name** (e.g., ✅ `Customer Support`)
- **Optional code in subtitles:** `Customer Support (CS_001)` in detailed views only
- **Process dropdown:** `Process Name` sorted alphabetically

### Date Range Standards
- **Default:** First of current month → today
- **Selector:** Two date pickers (From / To) in filter bar
- **Display:** `YYYY-MM-DD` in exports; `MMM DD, YYYY` in UI

### Number Formatting
- **Currency:** `₹ 1,00,000.00` (INR symbol, thousands separator, 2 decimals)
- **Percentages:** `85.5%` (1-2 decimals), green ≥80%, yellow 70-79%, red <70%
- **Large numbers:** `1.2M calls`, `456K` (with abbreviated units)
- **Decimals:** AHT as `MM:SS`, quality scores as whole %.

### Filter Standards
- **Order:** Process → Date Range → Branch (if multi-branch) → Refresh
- **Process filter:** Dropdown showing process names (resolved from `process_master`)
- **Branch filter:** Visible only for CEO/Admin; others auto-scoped to their branch
- **Refresh:** Manual button (no auto-refresh) to preserve data continuity

---

## 4. INDIVIDUAL DASHBOARD

### Overview
**Path:** `/dashboard/individual`
**Audience:** All employees (agent/team-lead level viewing self)
**Purpose:** Personal KPI tracking, quality trend, percentile ranking

### Layout Structure
```
┌─────────────────────────────────────────┐
│  "Your Performance — Today & Trend"     │
├─────────────────────────────────────────┤
│  [My Avg Quality] [Calls Audited] [Percentile Rank]  ← Hero Stats (3 KPIs)
│
│  [Quality Trend — 30 Days] ← Line chart showing daily/weekly
│
│  [Quality Scoring Breakdown] ← Table: Scoring Category | Count | %
│
│  [My Call Details] ← Table: Date | Time | Client | Score | Notes
│  (Click row to drill into single call details modal)
└─────────────────────────────────────────┘
```

### Hero Stats (3-column grid, single row)
```
KPI 1: My Avg Quality Score
  - Value: 78%
  - Tone: emerald (≥80), yellow (70-79), red (<70)
  - Helper: "Based on 24 audited calls"
  - Icon: Target

KPI 2: Calls Audited
  - Value: 24
  - Tone: blue
  - Helper: "In this period"
  - Icon: BarChart2

KPI 3: Percentile Rank
  - Value: 72nd %ile
  - Tone: purple
  - Helper: "Within your process"
  - Icon: TrendingUp (or Users)
```

### Quality Trend Chart
- **Type:** Line chart (recharts)
- **X-axis:** Date (YYYY-MM-DD)
- **Y-axis:** Quality % (0-100), reference lines at 80% (green) and 50% (red)
- **Data:** 30 days rolling, one point per day (or per week if sparse)
- **Interactivity:** Hover to see exact date/score

### Quality Scoring Breakdown Table
- **Columns:** Category | Count | % | Status (green/yellow/red)
- **Row data:** Call Opening, Professionalism, Active Listening, Call Closure, Accuracy
- **Sorting:** None (fixed order as above)
- **Drill-down:** Click category name → filtered call list for that category

### My Call Details Table
- **Columns:** Date | Time | Client | Score | Duration | Status | Notes
- **Sorting:** By Date desc (latest first)
- **Pagination:** Top 20 recent, link to "View All Calls"
- **Drill-down:** Click row → modal with full call transcript (if available) + detailed scoring breakdown
- **Refresh:** Manual via "Refresh" button in filter bar

### API Contract
```
GET /api/dashboard/individual/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
{
  my_avg_quality: 78,
  calls_audited: 24,
  percentile_rank: 72,
  process_name: "Customer Support"
}

GET /api/dashboard/individual/trend?from=YYYY-MM-DD&to=YYYY-MM-DD&granularity=day|week
{
  trend: [
    { date: "2026-06-21", quality: 78, calls: 3 },
    ...
  ]
}

GET /api/dashboard/individual/breakdown?from=YYYY-MM-DD&to=YYYY-MM-DD
{
  breakdown: [
    { category: "Call Opening", count: 5, percentage: 20.8, status: "green" },
    ...
  ]
}

GET /api/dashboard/individual/calls?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=20
{
  calls: [
    { id, date, time, client_name, quality_score, duration_sec, status, notes },
    ...
  ]
}
```

### Filters
- **Date Range:** From / To (defaults: first of month → today)
- **Granularity (Trend only):** Day / Week toggle
- **No process filter** (scoped to agent's assigned process)

### Drill-Down Depth
1. **Level 1:** Hero stats & charts (summary overview)
2. **Level 2:** Call details table (list view with 20-call window)
3. **Level 3:** Single call modal (transcript, detailed scoring, manager notes)

---

## 5. TEAM LEAD / RM DASHBOARD

### Overview
**Path:** `/dashboard/team-lead` or `/dashboard/rm`
**Audience:** Team Leads, Relationship Managers, Process Managers
**Purpose:** Team performance oversight, agent ranking, peer comparison

### Layout Structure
```
┌──────────────────────────────────────────────┐
│  "Team Performance — Overview & Matrix"      │
├──────────────────────────────────────────────┤
│  [Team Avg Score] [Team Size] [Process Count] ← Hero Stats (3 KPIs)
│
│  [My vs Team vs Org Baseline] ← Bar chart: My | Team Avg | Org Avg
│
│  [Team Performance Matrix] ← Table: Agent | Quality | Calls | Conversion | Rank
│  (Sortable by any column; heatmap coloring for quality)
│
│  [Team Trend vs Org] ← Dual-line chart
└──────────────────────────────────────────────┘
```

### Hero Stats (3-column grid)
```
KPI 1: Team Avg Quality Score
  - Value: 75%
  - Tone: yellow (calculation logic: mean of team members' quality)
  - Helper: "Across 8 team members"
  - Icon: Users

KPI 2: Team Size
  - Value: 8
  - Tone: blue
  - Helper: "Active agents in this period"
  - Icon: Users

KPI 3: Processes
  - Value: 2
  - Tone: purple
  - Helper: "Assigned processes"
  - Icon: Layers
```

### My vs Team Comparison Bar Chart
- **Type:** Bar chart (horizontal)
- **Categories:** My Score | Team Avg | Org Avg
- **Y-axis:** Quality % (0-100)
- **Color coding:** My=blue, Team=emerald, Org=slate
- **Value labels on bars**

### Team Performance Matrix Table
- **Columns:** Rank | Agent (CODE - Name) | Quality | Calls | Conversion | Shrinkage | Calls/Hour | Overall Score
- **Sort on click:** Any column (asc/desc toggle)
- **Heatmap coloring:** Green (80+), Yellow (70-79), Red (<70) on Quality column
- **Drill-down:** Click agent row → individual agent dashboard (showing that agent's details, callable by team lead)

### Team Trend Chart
- **Type:** Dual-line chart
- **Series 1:** Team Avg Quality (line, left Y-axis)
- **Series 2:** Org Avg Quality (line, left Y-axis, dashed)
- **X-axis:** Date
- **Legend:** Team Avg | Org Avg
- **Hover:** Show exact values for both series

### API Contract
```
GET /api/dashboard/team-lead/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
{
  team_avg_quality: 75,
  team_size: 8,
  process_count: 2,
  my_quality: 78,
  org_avg_quality: 73
}

GET /api/dashboard/team-lead/matrix?from=YYYY-MM-DD&to=YYYY-MM-DD
{
  matrix: [
    {
      agent_code: "EMP001",
      agent_name: "John Doe",
      quality: 78,
      calls: 42,
      conversion_pct: 5.2,
      shrinkage_pct: 18,
      calls_per_hour: 12.5,
      overall_score: 82,
      rank: 1
    },
    ...
  ]
}

GET /api/dashboard/team-lead/trend?from=YYYY-MM-DD&to=YYYY-MM-DD
{
  trend: [
    { date: "2026-06-21", team_avg: 75, org_avg: 73 },
    ...
  ]
}
```

### Filters
- **Date Range:** From / To
- **Process:** Dropdown (shows only assigned processes for TL; shows all for PM/Manager)
- **No Branch filter** (scoped to team lead's assigned branch/process)

### Drill-Down Depth
1. **Level 1:** Team overview with hero stats & comparison charts
2. **Level 2:** Matrix table (agent list with ranking, click to expand)
3. **Level 3:** Individual agent dashboard (quality trend, breakdown, calls)
4. **Level 4:** Single call modal (if drilling further)

---

## 6. QA MANAGER DASHBOARD

### Overview
**Path:** `/dashboard/qa-manager`
**Audience:** QA Managers, Quality Analysts, Compliance Leads
**Purpose:** Process-level quality oversight, anomaly detection, risk identification

### Layout Structure
```
┌────────────────────────────────────────────────────┐
│  "Quality Management — Process Intelligence"       │
├────────────────────────────────────────────────────┤
│  [Process Selector: ⬇ Customer Support]           ← Filter bar
│  [Date Range] [Branch] [Refresh]
│
│  [Avg Quality] [At-Risk Agents] [Anomalies]      ← Hero Stats (3 KPIs, dynamic per process)
│
│  [Process Quality Trend] ← Line chart
│
│  [Process Comparison] ← Bar chart (all processes, single metric)
│
│  [Quality Risk Matrix] ← Scatter plot (call volume vs quality score)
│  (Bubble size = agent call count; red zone = <70% quality)
│
│  [Top Performers] [Bottom 5 At-Risk] ← Two side-by-side tables
│
│  [Anomaly Detection] ← Alert list (>10% drop flagged RED)
└────────────────────────────────────────────────────┘
```

### Hero Stats (3-column grid, dynamic per selected process)
```
KPI 1: Process Avg Quality
  - Value: 72%
  - Tone: yellow
  - Helper: "Across 16 agents"
  - Icon: Target

KPI 2: At-Risk Agents
  - Value: 3
  - Tone: red
  - Helper: "Quality <70% or declining"
  - Icon: AlertTriangle

KPI 3: Anomalies Flagged
  - Value: 1
  - Tone: orange
  - Helper: ">10% drop vs baseline"
  - Icon: Zap
```

### Process Quality Trend Chart
- **Type:** Line chart
- **Series:** Quality % for selected process
- **Reference lines:** 80% (green), 50% (red)
- **X-axis:** Date
- **Hover tooltip:** Date | Quality % | Call count

### Process Comparison Bar Chart
- **Type:** Bar chart (vertical)
- **X-axis:** Process names (all processes in org)
- **Y-axis:** Quality % (0-100)
- **Color:** Green (80+), Yellow (70-79), Red (<70)
- **Click to filter:** Click a bar to update dashboard to that process

### Quality Risk Matrix (Scatter Plot)
- **X-axis:** Quality Score % (0-100)
- **Y-axis:** Call Volume per agent
- **Bubble size:** Proportional to call count
- **Bubble color:** Green (quality≥75) | Yellow (65-74) | Red (<65)
- **Quadrants:**
  - Top-Left (High volume, low quality): **RED ZONE** — risky
  - Top-Right (High volume, high quality): **GREEN ZONE** — ideal
  - Bottom-Left (Low volume, low quality): **TRAINING NEEDED**
  - Bottom-Right (Low volume, high quality): **EMERGING TALENT**
- **Hover:** Agent name | Quality % | Call count
- **Click bubble:** Drill to individual agent dashboard

### Top Performers Table
- **Columns:** Rank | Agent (CODE - Name) | Quality | Calls | Conversion
- **Data:** Top 10 by quality in selected process
- **Sorting:** Fixed (by quality desc)
- **Colors:** Green backgrounds (≥80%)

### Bottom 5 At-Risk Table
- **Columns:** Rank | Agent (CODE - Name) | Quality | Calls | Risk Reason
- **Data:** Bottom 5 by quality in selected process
- **Sorting:** Fixed (by quality asc)
- **Colors:** Red backgrounds (<70%)
- **Risk Reason:** "Declining", "Consistently Low", "Unstable", "Critical"

### Anomaly Detection Alert List
- **Trigger:** >10% drop vs 30-day baseline, OR >5 critical calls in 1 day
- **Alert card format:**
  - Icon (Alert/Zap)
  - Title: Agent name + anomaly type
  - Message: "Quality dropped from 82% to 71% — recommend review"
  - Timestamp: When detected
  - Action: "View Details" link
- **Sorting:** By severity (critical first), then by recency

### API Contract
```
GET /api/dashboard/qa-manager/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&process_id=<id>
{
  process_name: "Customer Support",
  avg_quality: 72,
  at_risk_agents: 3,
  anomalies_flagged: 1,
  agent_count: 16
}

GET /api/dashboard/qa-manager/processes
{
  processes: [
    { id: "proc-001", name: "Customer Support" },
    ...
  ]
}

GET /api/dashboard/qa-manager/trend?from=YYYY-MM-DD&to=YYYY-MM-DD&process_id=<id>
{
  trend: [
    { date: "2026-06-21", quality: 72, calls: 120 },
    ...
  ]
}

GET /api/dashboard/qa-manager/process-comparison?from=YYYY-MM-DD&to=YYYY-MM-DD
{
  processes: [
    { name: "Customer Support", avg_quality: 72 },
    { name: "Technical Support", avg_quality: 68 },
    ...
  ]
}

GET /api/dashboard/qa-manager/risk-matrix?from=YYYY-MM-DD&to=YYYY-MM-DD&process_id=<id>
{
  agents: [
    {
      agent_code: "EMP001",
      agent_name: "John Doe",
      quality: 78,
      call_volume: 45,
      risk_level: "green"
    },
    ...
  ]
}

GET /api/dashboard/qa-manager/top-performers?from=YYYY-MM-DD&to=YYYY-MM-DD&process_id=<id>&limit=10
{
  performers: [
    {
      rank: 1,
      agent_code: "EMP001",
      agent_name: "John Doe",
      quality: 85,
      calls: 50,
      conversion_pct: 6.2
    },
    ...
  ]
}

GET /api/dashboard/qa-manager/at-risk?from=YYYY-MM-DD&to=YYYY-MM-DD&process_id=<id>&limit=5
{
  at_risk: [
    {
      rank: 1,
      agent_code: "EMP015",
      agent_name: "Jane Smith",
      quality: 58,
      calls: 32,
      risk_reason: "Declining Fast"
    },
    ...
  ]
}

GET /api/dashboard/qa-manager/anomalies?from=YYYY-MM-DD&to=YYYY-MM-DD
{
  anomalies: [
    {
      id: "anom-001",
      agent_name: "John Doe",
      type: "quality_drop",
      message: "Quality dropped from 82% to 71%",
      severity: "critical",
      detected_at: "2026-06-21T10:30:00Z",
      baseline_quality: 82,
      current_quality: 71
    },
    ...
  ]
}
```

### Filters
- **Process:** Dropdown (required, defaults to first assigned process)
- **Date Range:** From / To
- **Branch:** Dropdown (for multi-branch orgs; QA Manager may be branch-scoped or global)
- **Refresh:** Manual button

### Drill-Down Depth
1. **Level 1:** Process overview with trend & risk matrix
2. **Level 2:** Agent details (click bubble in scatter or row in table)
3. **Level 3:** Individual agent dashboard (full performance view)
4. **Level 4:** Single call modal (if drilling into call list)

---

## 7. CEO / EXECUTIVE DASHBOARD

### Overview
**Path:** `/dashboard/ceo` or `/dashboard/executive`
**Audience:** CEO, CFO, COO, Super Admin
**Purpose:** Enterprise-wide KPI cockpit, 4-widget overview, drill-down capability

### Layout Structure
```
┌───────────────────────────────────────────────────┐
│  "Executive Cockpit — MAS Callnet Performance"    │
├───────────────────────────────────────────────────┤
│  [Date Range] [Branch] [Refresh]                 ← Filter bar
│
│  [Quality Widget]       [Payroll Widget]
│  [Avg Quality] [↓]     [Total Net] [↓]
│
│  [Attendance Widget]    [WFM Widget]
│  [Overall %] [↓]       [Sched Accuracy] [↓]
│
│  [All Process Comparison] ← Bar chart: all processes by quality
│
│  [4-Week Trend] ← Multi-line chart (Quality, Attendance, Payroll accrual)
└───────────────────────────────────────────────────┘
```

### 4-Widget Cockpit Layout (2×2 grid, clickable cards)

#### Widget 1: Quality Intelligence
```
┌──────────────────────────┐
│ QUALITY PERFORMANCE      │
├──────────────────────────┤
│                          │
│     79 %                 │
│  Org Avg Quality         │
│  ↑ 2.1% vs prev period   │
│                          │
│  Best: Cust Support 82%  │
│  Worst: Tech Sup 68%     │
│                          │
│  [→ Open Full Dashboard] │
└──────────────────────────┘
```
- **Data:** Org-wide avg quality, top 2 processes, trend arrow
- **Click action:** Navigate to `/dashboard/quality` (full QA Manager view)

#### Widget 2: Payroll & Financials
```
┌──────────────────────────┐
│ PAYROLL & TAX            │
├──────────────────────────┤
│                          │
│   ₹ 24,50,000            │
│  Total Net (This Month)  │
│                          │
│  Headcount: 125          │
│  Avg per emp: ₹ 1,96,000 │
│  TDS Reserve: ₹ 3,12,000 │
│                          │
│  [→ Open Full Payroll]   │
└──────────────────────────┘
```
- **Data:** Total net pay, headcount, tax reserve, avg salary
- **Click action:** Navigate to `/dashboard/payroll`

#### Widget 3: Attendance Tracking
```
┌──────────────────────────┐
│ ATTENDANCE HEALTH        │
├──────────────────────────┤
│                          │
│     92.5 %               │
│  Overall Attendance      │
│  ↑ 0.8% vs prev period   │
│                          │
│  By Process:             │
│  CS: 93% | TS: 90%       │
│  Leaves Approved: 18     │
│                          │
│  [→ Open Attendance]     │
└──────────────────────────┘
```
- **Data:** Org-wide attendance %, top processes, approved leaves
- **Click action:** Navigate to `/dashboard/attendance`

#### Widget 4: WFM & Staffing
```
┌──────────────────────────┐
│ WORKFORCE MANAGEMENT     │
├──────────────────────────┤
│                          │
│     94 %                 │
│  Scheduling Accuracy     │
│  ↑ 1.2% vs prev period   │
│                          │
│  Staffing Gaps: 3        │
│  Avg Utilization: 78%    │
│  Forecast Risk: Low      │
│                          │
│  [→ Open WFM Dashboard]  │
└──────────────────────────┘
```
- **Data:** Scheduling accuracy %, staffing gaps, utilization, forecast
- **Click action:** Navigate to `/dashboard/wfm`

### All Process Comparison Bar Chart
- **Type:** Bar chart (vertical)
- **X-axis:** Process names (all processes in org)
- **Y-axis:** Quality % (0-100)
- **Color:** Green (80+), Yellow (70-79), Red (<70)
- **Data label on bars:** Process name + % value

### 4-Week Trend Multi-Line Chart
- **Type:** Line chart (dual/triple Y-axis)
- **Series 1:** Org Avg Quality (Y-axis left, 0-100%)
- **Series 2:** Org Attendance % (Y-axis left, 0-100%)
- **Series 3:** Payroll accrual burn % (Y-axis right, 0-100%)
- **X-axis:** Week ending date (4 weeks rolling)
- **Legend:** Quality | Attendance | Payroll Accrual
- **Hover:** Show all 3 values for the week

### API Contract
```
GET /api/dashboard/ceo/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&branch_id=<opt>
{
  quality: {
    org_avg: 79,
    trend_pct: 2.1,
    best_process: { name: "Customer Support", quality: 82 },
    worst_process: { name: "Technical Support", quality: 68 }
  },
  payroll: {
    total_net: 2450000,
    headcount: 125,
    avg_per_emp: 196000,
    tds_reserve: 312000
  },
  attendance: {
    overall_pct: 92.5,
    trend_pct: 0.8,
    by_process: [
      { process: "Customer Support", pct: 93 },
      { process: "Technical Support", pct: 90 }
    ],
    approved_leaves: 18
  },
  wfm: {
    scheduling_accuracy: 94,
    trend_pct: 1.2,
    staffing_gaps: 3,
    avg_utilization: 78,
    forecast_risk: "low"
  }
}

GET /api/dashboard/ceo/process-comparison?from=YYYY-MM-DD&to=YYYY-MM-DD
{
  processes: [
    { name: "Customer Support", quality: 82 },
    { name: "Technical Support", quality: 68 },
    ...
  ]
}

GET /api/dashboard/ceo/trend?from=YYYY-MM-DD&to=YYYY-MM-DD&granularity=week
{
  trend: [
    {
      date: "2026-06-21",
      quality_pct: 79,
      attendance_pct: 92.5,
      payroll_accrual_pct: 45.2
    },
    ...
  ]
}
```

### Filters
- **Date Range:** From / To (defaults: 4 weeks rolling)
- **Branch:** Dropdown (CEO sees all branches; filter to one if multi-branch org)
- **Refresh:** Manual button

### Drill-Down Depth
1. **Level 1:** Executive cockpit (4 widgets + comparison charts)
2. **Level 2:** Widget click → full module dashboard (QA, Payroll, Attendance, WFM)
3. **Level 3+:** Module-specific drill-down (per module spec)

---

## 8. SHARED COMPONENT LIBRARY

### 1. Hero Stat Card Component
**Location:** `src/components/dashboard/HeroStatCard.tsx`
```typescript
interface HeroStatCardProps {
  label: string;
  value: string | number;
  helperText?: string;
  icon: React.ReactNode;
  tone: "emerald" | "blue" | "yellow" | "red" | "purple" | "slate";
  trend?: number; // % change
  animate?: boolean;
}

// Usage:
<HeroStatCard
  label="My Avg Quality"
  value={78}
  helperText="Based on 24 audited calls"
  icon={<Target className="h-5 w-5" />}
  tone="emerald"
  animate={true}
/>
```

### 2. KPI Card Component
**Location:** `src/components/dashboard/KpiCard.tsx`
Similar to HeroStatCard but compact (used in widget headers).

### 3. Score Pill Component
**Location:** `src/components/dashboard/ScorePill.tsx`
```typescript
interface ScorePillProps {
  score: number; // 0-100
  label?: string;
}

// Color logic:
// ≥80: emerald, 70-79: yellow, 60-69: orange, <60: red
```

### 4. Filter Bar Component
**Location:** `src/components/dashboard/FilterBar.tsx`
```typescript
interface FilterBarProps {
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (date: string) => void;
  onDateToChange: (date: string) => void;
  process?: {
    value: string;
    options: Array<{ id: string; name: string }>;
    onChange: (id: string) => void;
  };
  branch?: {
    value: string;
    options: Array<{ id: string; name: string }>;
    onChange: (id: string) => void;
  };
  onRefresh: () => void;
  isLoading?: boolean;
}
```

### 5. Sortable Table Component
**Location:** `src/components/dashboard/SortableTable.tsx`
```typescript
interface SortableTableProps<T> {
  columns: Array<{
    key: keyof T;
    label: string;
    sortable?: boolean;
    render?: (row: T) => React.ReactNode;
    width?: string;
  }>;
  data: T[];
  sortField?: keyof T;
  sortDir?: "asc" | "desc";
  onSort?: (field: keyof T) => void;
  onRowClick?: (row: T) => void;
  expandable?: {
    isExpanded: (row: T) => boolean;
    renderExpanded: (row: T) => React.ReactNode;
    onToggle: (row: T) => void;
  };
  pagination?: {
    limit: number;
    offset: number;
    total: number;
    onPageChange: (page: number) => void;
  };
}
```

### 6. Risk Status Badge Component
**Location:** `src/components/dashboard/RiskBadge.tsx`
```typescript
type RiskStatus = 
  | "declining_fast" | "declining" | "improving" | "unstable"
  | "consistently_poor" | "top_performer" | "stable";

interface RiskBadgeProps {
  status: RiskStatus;
}

// Predefined color/label mapping:
const RISK_MAP = {
  declining_fast: { label: "Declining Fast", color: "red-700" },
  declining: { label: "Declining", color: "orange-700" },
  improving: { label: "Improving", color: "emerald-700" },
  unstable: { label: "Unstable", color: "yellow-700" },
  consistently_poor: { label: "Consistently Poor", color: "red-700" },
  top_performer: { label: "Top Performer", color: "blue-700" },
  stable: { label: "Stable", color: "slate-600" },
};
```

### 7. Insight Card Component
**Location:** `src/components/dashboard/InsightCard.tsx`
```typescript
type InsightType = "success" | "warning" | "critical" | "opportunity";

interface InsightCardProps {
  type: InsightType;
  title: string;
  message: string;
  action?: string;
  onAction?: () => void;
}
```

### 8. Chart Wrapper with Loading/Error States
**Location:** `src/components/dashboard/ChartContainer.tsx`
```typescript
interface ChartContainerProps {
  title: string;
  subtitle?: string;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string;
  children: React.ReactNode;
}
```

---

## 9. API LAYER STANDARDS

### Base Pattern
```typescript
// All dashboard endpoints require auth + role check
router.use(requireAuth);

// Each endpoint resolves caller scope:
async function resolveScope(req: AuthenticatedRequest) {
  const userId = req.authUser!.id;
  if (admin/hr/ceo) return GLOBAL;
  if (process_manager) return { processes: [...] };
  if (branch_head) return { branch: ... };
  if (employee) return { self_only: true };
  return DENIED;
}

// Response always includes:
{
  success: true,
  data: { ... },
  _meta: {
    scope: "global" | "process" | "branch" | "self",
    execution_time_ms: 120,
    cache_ttl_seconds: 300 (optional)
  }
}
```

### Error Handling
```typescript
// All errors are 400+ with consistent structure:
{
  success: false,
  error: {
    code: "UNAUTHORIZED" | "INVALID_PARAMS" | "NOT_FOUND" | "INTERNAL_ERROR",
    message: "User lacks QA_MANAGER role",
    details: { required_role: "qa_manager" } (optional)
  }
}
```

### Pagination
```typescript
// For large result sets:
{
  data: [...],
  pagination: {
    limit: 20,
    offset: 0,
    total: 342,
    has_next: true,
    has_prev: false
  }
}
```

---

## 10. DATABASE VIEWS & AGGREGATIONS

### Required Materialized Views

#### 1. `v_dashboard_agent_daily_quality`
```sql
SELECT
  e.id as employee_id,
  e.employee_code,
  e.first_name,
  e.last_name,
  pm.id as process_id,
  pm.process_name,
  DATE(apr.audit_date) as audit_date,
  AVG(apr.quality_score) as quality_score,
  COUNT(*) as call_count,
  SUM(CASE WHEN apr.quality_score >= 80 THEN 1 ELSE 0 END) as calls_above_80,
  SUM(CASE WHEN apr.quality_score < 50 THEN 1 ELSE 0 END) as calls_below_50
FROM employees e
JOIN process_master pm ON pm.id = e.process_id
JOIN apr ON apr.user_id = e.id
WHERE e.active_status = 1 AND apr.audit_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
GROUP BY e.id, e.employee_code, e.first_name, e.last_name, pm.id, pm.process_name, DATE(apr.audit_date)
```

#### 2. `v_dashboard_process_daily_summary`
```sql
SELECT
  pm.id as process_id,
  pm.process_name,
  DATE(apr.audit_date) as summary_date,
  COUNT(DISTINCT apr.user_id) as agent_count,
  AVG(apr.quality_score) as avg_quality,
  SUM(apr.call_duration) as total_duration,
  COUNT(*) as total_calls
FROM process_master pm
JOIN employees e ON e.process_id = pm.id
JOIN apr ON apr.user_id = e.id
WHERE pm.active_status = 1 AND e.active_status = 1
  AND apr.audit_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
GROUP BY pm.id, pm.process_name, DATE(apr.audit_date)
```

#### 3. `v_dashboard_payroll_summary`
```sql
SELECT
  pm.id as process_id,
  pm.process_name,
  ps.salary_month,
  SUM(ps.basic + ps.da + ps.hra + ps.conveyance) as total_gross,
  SUM(ps.net_pay) as total_net,
  SUM(ps.income_tax) as total_tax,
  COUNT(DISTINCT ps.employee_id) as employee_count,
  AVG(ps.net_pay) as avg_net_pay
FROM process_master pm
JOIN employees e ON e.process_id = pm.id
JOIN salary_prep_line ps ON ps.employee_id = e.id
WHERE pm.active_status = 1 AND e.active_status = 1
GROUP BY pm.id, pm.process_name, ps.salary_month
```

#### 4. `v_dashboard_attendance_daily`
```sql
SELECT
  pm.id as process_id,
  pm.process_name,
  b.id as branch_id,
  DATE(was.attendance_date) as attendance_date,
  COUNT(DISTINCT e.id) as total_employees,
  SUM(CASE WHEN was.status = 'present' THEN 1 ELSE 0 END) as present_count,
  SUM(CASE WHEN was.status = 'absent' THEN 1 ELSE 0 END) as absent_count,
  SUM(CASE WHEN was.status = 'leave' THEN 1 ELSE 0 END) as leave_count,
  ROUND(SUM(CASE WHEN was.status = 'present' THEN 1 ELSE 0 END) * 100 / COUNT(DISTINCT e.id), 2) as attendance_pct
FROM branches b
JOIN employees e ON e.branch_id = b.id
JOIN process_master pm ON pm.id = e.process_id
LEFT JOIN wfm_attendance_session was ON was.employee_id = e.id
WHERE b.active_status = 1 AND e.active_status = 1
GROUP BY pm.id, pm.process_name, b.id, DATE(was.attendance_date)
```

### Index Requirements
```sql
CREATE INDEX idx_apr_user_date ON apr(user_id, audit_date);
CREATE INDEX idx_apr_quality_score ON apr(quality_score);
CREATE INDEX idx_salary_prep_employee_month ON salary_prep_line(employee_id, salary_month);
CREATE INDEX idx_wfm_attendance_emp_date ON wfm_attendance_session(employee_id, attendance_date);
CREATE INDEX idx_employee_process ON employees(process_id, active_status);
```

---

## 11. IMPLEMENTATION ROADMAP

### Phase 1: Shared Infrastructure (Week 1)
- [ ] Create `src/components/dashboard/` component library
- [ ] Create `src/lib/dashboard-utils.ts` (formatters, helpers)
- [ ] Create `backend/src/shared/dashboard.scope.ts` (access control)
- [ ] Create materialized views (database)
- [ ] Set up React Query hooks for each dashboard data source

### Phase 2: Individual Dashboard (Week 2)
- [ ] Build `src/pages/dashboard/IndividualDashboard.tsx`
- [ ] Build `/api/dashboard/individual/*` endpoints
- [ ] Add route gating in `navConfig.tsx`
- [ ] Test with sample employee data

### Phase 3: Team Lead Dashboard (Week 3)
- [ ] Build `src/pages/dashboard/TeamLeadDashboard.tsx`
- [ ] Build `/api/dashboard/team-lead/*` endpoints
- [ ] Build drill-down to individual agent view
- [ ] Test with manager account

### Phase 4: QA Manager Dashboard (Week 4)
- [ ] Build `src/pages/dashboard/QaManagerDashboard.tsx`
- [ ] Build `/api/dashboard/qa-manager/*` endpoints
- [ ] Implement anomaly detection service
- [ ] Build risk matrix scatter plot

### Phase 5: CEO Executive Dashboard (Week 5)
- [ ] Build `src/pages/dashboard/CeoDashboard.tsx`
- [ ] Build `/api/dashboard/ceo/*` endpoints
- [ ] Aggregate data from payroll, attendance, WFM modules
- [ ] Build 4-widget cockpit layout

### Phase 6: Refinement & Testing (Week 6)
- [ ] Performance testing (>100K rows, <500ms response)
- [ ] UAT with real users per role
- [ ] Polish UI/UX, fix edge cases
- [ ] Document API in Postman

---

## 12. TESTING CHECKLIST

### Per-Dashboard Testing
- [ ] **Auth:** Unauthenticated user → 401 Unauthorized
- [ ] **Role:** Non-authorized role (e.g., employee viewing QA dashboard) → 403 Forbidden
- [ ] **Scope:** Manager sees only their team, CEO sees all
- [ ] **Date range:** Invalid dates (from > to) → error handling
- [ ] **Empty data:** No calls in period → show "No data" message
- [ ] **Pagination:** >100 rows → pagination works, link to "View All"
- [ ] **Drill-down:** Click → navigates to correct child dashboard
- [ ] **Mobile responsiveness:** Charts scale, tables scroll, layout adapts
- [ ] **Loading states:** Skeletons shown during API calls
- [ ] **Error states:** API failure → error banner with retry button

### Data Accuracy Tests
- [ ] Quality score calculation matches audit database
- [ ] Employee name format = "CODE - Name" in all tables
- [ ] Process name (not code) shown in dropdowns and charts
- [ ] Percentage formatting: 78%, not 0.78
- [ ] Currency formatting: ₹1,00,000, not 100000
- [ ] Date formatting consistent (YYYY-MM-DD in exports, MMM DD in UI)

### Performance Tests
- [ ] Individual dashboard loads <1s with 30-day data
- [ ] QA Manager dashboard loads <2s with 1000+ agents
- [ ] CEO cockpit loads <3s with all org data
- [ ] Filter/sort operations respond <500ms
- [ ] Charts render smooth without lag (60fps on 2020+ devices)

---

## 13. DELIVERABLES SUMMARY

### Frontend Deliverables
```
src/
├── pages/
│   └── dashboard/
│       ├── IndividualDashboard.tsx
│       ├── TeamLeadDashboard.tsx
│       ├── QaManagerDashboard.tsx
│       └── CeoDashboard.tsx
├── components/
│   └── dashboard/
│       ├── HeroStatCard.tsx
│       ├── KpiCard.tsx
│       ├── ScorePill.tsx
│       ├── FilterBar.tsx
│       ├── SortableTable.tsx
│       ├── RiskBadge.tsx
│       ├── InsightCard.tsx
│       └── ChartContainer.tsx
└── lib/
    └── dashboard-utils.ts
```

### Backend Deliverables
```
backend/src/
├── modules/
│   └── dashboard-v2/
│       ├── dashboard.routes.ts (main router)
│       ├── individual.routes.ts
│       ├── team-lead.routes.ts
│       ├── qa-manager.routes.ts
│       ├── ceo.routes.ts
│       ├── dashboard.scope.ts (access control)
│       ├── dashboard.service.ts (shared queries)
│       └── anomaly.detector.ts (QA Manager)
└── sql/
    └── dashboard/
        ├── 001_materialized_views.sql
        ├── 002_indexes.sql
        └── 003_stored_procedures.sql
```

### Documentation
- [ ] This spec (DASHBOARD_DESIGN_SPEC.md)
- [ ] API Documentation (Postman collection)
- [ ] Component Library Guide (Storybook or README)
- [ ] Data Model Diagram (ER diagram for dashboard tables)
- [ ] UI/UX Wireframes (Figma or similar)

---

## 14. OUTPUT FORMAT (FOR REPORTING)

When reporting on any dashboard:

```
ROLE           | LAYOUT                  | KPI_COUNT | FILTER_OPTIONS           | DRILL_DOWN_DEPTH
Individual     | Hero 3 + Chart + Table  | 3         | Date Range, Granularity  | 3 (summary → calls → detail)
Team Lead      | Hero 3 + Bar + Matrix   | 3         | Process, Date Range      | 4 (team → matrix → agent → call)
QA Manager     | Hero 3 + Scatter + Dual | 3         | Process, Date, Branch    | 4 (process → agents → detail → call)
CEO            | 4-Widget Cockpit        | 12        | Date Range, Branch       | 5 (widgets → modules → details)
```

---

## 15. KNOWN LIMITATIONS & FUTURE ENHANCEMENTS

### Current Limitations (v1.0)
- No real-time updates (manual refresh button only)
- Call transcripts not included (placeholder for future)
- No custom report builder
- No scheduled email digests
- No integration with external BI tools (Tableau, Power BI)

### Future Enhancements (v2.0+)
- Real-time WebSocket updates for quality dashboards
- ML-powered anomaly detection (replacing rule-based alerts)
- Custom KPI dashboard builder (no-code for admins)
- Scheduled email reports & SMS alerts
- BI tool integrations (Looker, Qlik)
- Mobile app (React Native) with offline capability

---

**END OF SPECIFICATION**

Version: 1.0
Status: Ready for Implementation
Last Updated: 2026-06-21
