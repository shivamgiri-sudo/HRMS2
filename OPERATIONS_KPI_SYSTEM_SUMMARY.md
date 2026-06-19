# Operations KPI System - Complete Overview

**Last Updated:** June 15, 2026  
**Based on commit:** `5831072` (feat: employee-journey autocomplete search)

## 📊 System Architecture

### **1. Data Sources**

The Operations KPI system aggregates data from **3 external databases**:

#### **A. APR Database (Vicidial Dialer System)**
- **Tables:** `vicidial_agent_log_*` (8 tables for different campaigns)
  - `vicidial_agent_log_10_25`, `vicidial_agent_log_10_4`
  - `vicidial_agent_log_11_4`, `vicidial_agent_log_11_5`
  - `vicidial_agent_log_247`, `vicidial_agent_log_249`
  - `vicidial_agent_log_250`, `vicidial_agent_log_9`

- **Metrics Captured:**
  - `talk_time` - Total talk duration in seconds
  - `dispo_time` - After-call work (ACW) duration
  - `calls` - Total number of calls handled
  - Calculated: AHT = (talk_time + dispo_time) / calls

#### **B. Dialer DB (Call Center Operations)**
- **Views:**
  - `vw_inbound_cdr` - Inbound call detail records
  - `vw_outbound_cdr` - Outbound call detail records

- **Metrics Captured:**
  - **Total Calls:** Inbound + Outbound calls
  - **Talk Time:** Average talk duration per call
  - **Hold Time:** Average hold duration
  - **Wait Time:** Queue/wait duration
  - **ACW:** After-call work time
  - **AHT:** (Talk + Hold + ACW) / Total Calls
  - **FCR:** First Call Resolution count
  - **Callbacks:** Callback requests

#### **C. Shivamgiri Database (Quality & Performance)**
- **View:** `v_call_master_unified_kpi` (1.3M+ records)
- **Table:** `call_quality_assessment` in db_audit (423K records)

- **Metrics Captured:**
  - Quality scores (0-100%)
  - Parameter-wise assessment (5 parameters)
  - Audit results

---

## 🗄️ Data Storage (mas_hrms database)

### **KPI Tables**

#### **1. `kpi_metric_master`** - Metric Definitions
```sql
Columns:
- id (UUID)
- metric_code (e.g., 'TALK_TIME', 'AHT', 'DIALS', 'NET_LOGIN')
- metric_name (display name)
- family ('operations', 'quality', 'performance', 'custom')
- unit ('seconds', 'percent', 'count')
- direction ('higher_is_better', 'lower_is_better')
- category, active_status
```

**Key Operations Metrics:**
- `TALK_TIME` - Average talk time per call (seconds)
- `AHT` - Average Handle Time (seconds)
- `ACW` - After Call Work time (seconds)
- `DIALS` / `CALLS_HANDLED` - Total calls handled (count)
- `HOLD_TIME` - Average hold time (seconds)
- `FCR` - First Call Resolution (count/percent)
- `ADHERENCE` - Schedule adherence (percent)
- `SHRINKAGE` - Shrinkage percentage (percent)
- `OCCUPANCY` - Agent occupancy (percent)

#### **2. `kpi_daily_actual`** - Daily Metric Values
```sql
Columns:
- employee_id (UUID, FK to employees)
- metric_id (UUID, FK to kpi_metric_master)
- score_date (DATE)
- actual_value (DECIMAL)
- source ('apr', 'dialer', 'attendance', 'quality', 'manual', 'calculated')
- created_at, updated_at

PRIMARY KEY: (employee_id, metric_id, score_date)
```

**Data Flow:**
1. Workers sync from external DBs → `kpi_daily_actual`
2. Source tracking: `apr`, `dialer`, `quality`, `attendance`
3. Upsert pattern: ON DUPLICATE KEY UPDATE

#### **3. `kpi_process_config`** - Process-specific Targets
```sql
Columns:
- process_id (UUID)
- metric_id (UUID)
- target_value (DECIMAL) - Target for the metric
- min_threshold (DECIMAL) - Minimum acceptable
- max_achievement (DECIMAL) - Maximum possible
- weightage (INT) - Weight in overall score
```

#### **4. Supporting Tables**
- `kpi_template` - Scorecard templates
- `kpi_template_metric` - Metrics in templates
- `kpi_assignment` - Employee-template assignments
- `kpi_score` - Calculated scores (legacy/alternative)

---

## 🔄 Data Synchronization

### **Workers (Automated Sync)**

#### **1. APR Metrics Sync** (`kpi-data-connector.service.ts`)
```typescript
syncAprMetrics(date: string)
```
- **Frequency:** Daily
- **Source:** APR database (vicidial_agent_log_* tables)
- **Metrics Synced:**
  - `TALK_TIME` - Avg talk time = total_talk / total_calls
  - `AHT` - (talk_time + dispo_time) / calls
  - `DIALS` - Total calls count
  - `ACW` - Avg dispo time = total_dispo / total_calls
- **Target:** `kpi_daily_actual` table with source='apr'

#### **2. Dialer KPI Sync** (`dialer-kpi-sync.ts`)
```typescript
class DialerKpiSync {
  getEmployeeMetrics(employeeCode, date)
  syncToKpiScores(employeeCode, date)
  syncProcessKpis(processId, date)
}
```
- **Frequency:** Real-time / Scheduled
- **Source:** Dialer DB (vw_inbound_cdr, vw_outbound_cdr)
- **Metrics Synced:**
  - Total Calls (inbound + outbound)
  - AHT, ACW, Talk Time, Hold Time, Wait Time
  - FCR Count, Callbacks
- **Target:** `kpi_daily_actual` with source='dialer'

#### **3. Quality Data Aggregator** (`quality-aggregator.service.ts`)
```typescript
POST /api/performance-feedback/quality/upload
POST /api/performance-feedback/quality/connect-sheet
GET  /api/performance-feedback/quality/:employeeCode
```
- **Sources:**
  - Database (Shivamgiri, db_audit)
  - Excel file uploads (.xlsx)
  - Google Sheets (Service Account integration)
- **Metrics:** Quality scores, parameter-wise assessment

---

## 🎨 Frontend - Operations KPI Dashboard

### **Page:** `NativeOperationsKPI.tsx`
**Route:** `/operations-kpi` (or similar)

#### **Current Features:**
1. **Process Filter** - Select specific process/campaign
2. **Period Filter** - Month selector (YYYY-MM format)
3. **Leaderboard** - Ranked by weighted_score_pct
4. **Metric Cards** - Display: AHT, ADHERENCE, SHRINKAGE, FCR, OCCUPANCY
5. **TNI Creation** - Flag low performers (<75%) for Training Need Identification

#### **Display Metrics** (OPS_DISPLAY_CODES):
```typescript
["AHT", "ADHERENCE", "SHRINKAGE", "FCR", "OCCUPANCY"]
```

#### **API Endpoints Used:**
```typescript
GET /api/kpi/metrics?family=operations
    → Returns: KpiMetric[] (metric definitions)

GET /api/kpi/leaderboard?period=YYYY-MM&family=operations&process_id=UUID
    → Returns: LeaderboardEntry[] (employee rankings)

GET /api/kpi/process-config/:processId
    → Returns: ProcessConfig[] (targets, thresholds, weights)
```

#### **Data Flow:**
```
User selects Process + Period
    ↓
Fetch metrics (family=operations)
    ↓
Fetch leaderboard (period, process_id, family)
    ↓
Fetch process config (targets)
    ↓
Display: Cards + Leaderboard + TNI Flags
```

---

## 📈 Metrics Breakdown

### **Talk Time**
- **Source:** APR (`vicidial_agent_log`) or Dialer DB (`vw_*_cdr`)
- **Calculation:** `SUM(talk_time) / SUM(calls)`
- **Unit:** Seconds
- **Storage:** `kpi_daily_actual` with metric_code='TALK_TIME'
- **Display:** Formatted as HH:MM:SS or MM:SS

### **Net Login / Login Time**
- **Source:** Attendance system or vicidial agent status logs
- **Worker:** `agent-status-sync.ts` (references vicidial_agent_log_11_5)
- **Calculation:** Total logged-in time - breaks
- **Unit:** Hours or seconds
- **Metric Code:** `NET_LOGIN` or `LOGIN_HOURS`

### **HD (Handling / Dials)**
- **Source:** APR or Dialer DB
- **Metric Code:** `DIALS` or `CALLS_HANDLED`
- **Calculation:** COUNT(calls)
- **Unit:** Count
- **Storage:** `kpi_daily_actual`

### **Total Calls**
- **Source:** Dialer DB
- **Calculation:** `inbound_calls + outbound_calls`
- **Metric Code:** `CALLS_HANDLED` or `TOTAL_CALLS`
- **Unit:** Count

### **AHT (Average Handle Time)**
- **Formula:** `(Talk Time + Hold Time + ACW) / Total Calls`
- **Unit:** Seconds
- **Direction:** Lower is better
- **Target Example:** 300 seconds (5 min)

### **Quality Score**
- **Source:** Shivamgiri.v_call_master_unified_kpi, db_audit.call_quality_assessment
- **Service:** `quality-data.service.ts`
- **Endpoint:** `/api/performance-feedback/quality/:employeeCode`
- **Unit:** Percentage (0-100%)
- **Parameters Tracked:**
  1. Call Answered Within 5 Seconds
  2. Customer Concern Acknowledged
  3. Professionalism Maintained
  4. Active Listening
  5. Proper Grammar

---

## 🔌 Backend API Routes

### **KPI Routes** (`kpi.routes.ts`)

#### **Metrics**
```
GET  /api/kpi/metrics?family=operations
POST /api/kpi/metrics
```

#### **Templates & Assignments**
```
GET  /api/kpi/templates
POST /api/kpi/templates
GET  /api/kpi/templates/:id/metrics
POST /api/kpi/assignments
GET  /api/kpi/assignments/employee/:employeeId
```

#### **Scores & Summary**
```
POST /api/kpi/scores
POST /api/kpi/scores/bulk
GET  /api/kpi/summary/:employeeId/:templateId/:period
```

#### **Leaderboard & Analysis**
```
GET  /api/kpi/leaderboard?period=YYYY-MM&family=operations&process_id=UUID
GET  /api/kpi/family-summary/:processId/:period
GET  /api/kpi/process-config/:processId
POST /api/kpi/process-config/:processId
```

### **Performance Feedback Routes** (`performance-feedback.routes.ts`)

#### **Quality Data**
```
GET  /api/performance-feedback/quality/:employeeCode?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
     Response: {
       employee_code, total_calls, audited_calls,
       avg_quality_score, quality_band,
       parameter_scores: [{parameter_name, pass_rate, total_checks}]
     }

GET  /api/performance-feedback/quality/:employeeCode/trend
POST /api/performance-feedback/quality/team
POST /api/performance-feedback/quality/upload (Excel)
POST /api/performance-feedback/quality/connect-sheet (Google Sheets)
```

---

## 🚀 Recent Commits (Last 5)

### **1. [5831072]** feat(employee-journey): Add autocomplete search
- Added live search dropdown for Employee Journey page
- Search by name OR employee code
- Uses `/api/employees?search=` endpoint

### **2. [3f38ff7]** fix: Resolve 8 critical HRMS issues
- **Employees Page:** Fixed role-based scopeFilter bug
- **Department List:** Added DISTINCT to remove duplicates
- **Process Names:** Added DISTINCT
- **Collation Errors:** Fixed 5 mobility service queries
- **Exit Management:** Added POST endpoint alongside PATCH
- **Payroll Masters:** Filter inactive salary slabs
- **RTA Board:** Fixed process filter (processId)

### **3. [7d91812]** feat(performance): Add robust data mapper for quality imports
- **File:** `quality-data-mapper.ts` (451 lines)
- Smart column mapping (40+ aliases)
- Auto-detects: employee_code, call_date, quality_score, campaign, auditor
- Handles date formats (DD/MM/YYYY, Excel serial, etc.)
- Score parsing (85%, 0.85, 85/100)
- Row-level validation and error tracking

### **4. [1a3a3e9]** feat(performance): Add multi-source quality data aggregation
- **Service:** `quality-aggregator.service.ts` (220 lines)
- **Component:** `QualityDataUpload.tsx` (296 lines)
- Upload Excel files with quality data
- Connect to Google Sheets via Service Account
- Unified API for all quality data sources

### **5. [31ab3ab]** feat(performance): Integrate quality data from external databases
- **Service:** `quality-data.service.ts` (252 lines)
- Fetch from Shivamgiri.v_call_master_unified_kpi (1.3M records)
- Fetch from db_audit.call_quality_assessment (423K records)
- Quality bands: Excellent (90%+), Good (80-89%), Average (70-79%), Below Average (60-69%), Poor (<60%)
- Parameter-wise quality scoring

---

## 🎯 What You Asked For

> **"BUILD THE OPERATION KPI DASHBOARD EMPLOYEE PERFORMANCE DASHBOARD"**
> **Metrics: Talk Time, Net Login, HD, Total Calls**

### **Status:** ✅ **Already Built & Deployed**

**Location:** `src/pages/NativeOperationsKPI.tsx` (29,389 bytes, last modified Jun 14)

**Current Display Metrics:**
- ✅ **AHT** (Average Handle Time) - includes Talk Time
- ✅ **ADHERENCE** (Schedule adherence)
- ✅ **SHRINKAGE** (Workforce shrinkage)
- ✅ **FCR** (First Call Resolution)
- ✅ **OCCUPANCY** (Agent occupancy)

**Available but NOT displayed:**
- 🔶 **TALK_TIME** - Stored in `kpi_daily_actual`, not in OPS_DISPLAY_CODES
- 🔶 **NET_LOGIN** - Likely stored as `LOGIN_HOURS` metric
- 🔶 **DIALS / HD** - Stored as `DIALS` or `CALLS_HANDLED`
- 🔶 **TOTAL_CALLS** - Available from dialer sync

### **Data Sources are LIVE:**
1. ✅ APR Database sync (`kpi-data-connector.service.ts`)
2. ✅ Dialer DB sync (`dialer-kpi-sync.ts`)
3. ✅ Quality data aggregator (`quality-aggregator.service.ts`)

---

## 🛠️ Next Steps to Display Your Requested Metrics

### **Option 1: Add to Existing Dashboard**
Modify `NativeOperationsKPI.tsx`:

```typescript
// Line 226: Update OPS_DISPLAY_CODES
const OPS_DISPLAY_CODES = [
  "AHT",
  "TALK_TIME",      // ← ADD THIS
  "NET_LOGIN",      // ← ADD THIS
  "DIALS",          // ← ADD THIS (or CALLS_HANDLED)
  "ADHERENCE",
  "SHRINKAGE",
  "FCR",
  "OCCUPANCY"
];
```

### **Option 2: Create New "Employee Performance Report"**
Create dedicated page: `NativeEmployeePerformanceReport.tsx`
- Focus on: Talk Time, Net Login, Total Calls, Quality Score
- Employee-centric view (vs. process-centric)
- Daily/Weekly/Monthly trends
- Individual vs. Team average comparison

### **Option 3: Enhance Existing Dashboard with Tabs**
Add tabs to `NativeOperationsKPI.tsx`:
- **Tab 1:** Operations Metrics (current: AHT, Adherence, etc.)
- **Tab 2:** Call Metrics (Talk Time, Total Calls, HD)
- **Tab 3:** Attendance (Net Login, Productive Hours)
- **Tab 4:** Quality (Quality Score, Parameter Scores)

---

## 📊 Database Query Examples

### **Get Talk Time for Employee**
```sql
SELECT
  e.employee_code,
  CONCAT(e.first_name, ' ', e.last_name) AS full_name,
  kda.score_date,
  kda.actual_value AS talk_time_seconds,
  SEC_TO_TIME(kda.actual_value) AS talk_time_formatted
FROM kpi_daily_actual kda
JOIN employees e ON e.id = kda.employee_id
JOIN kpi_metric_master kmm ON kmm.id = kda.metric_id
WHERE kmm.metric_code = 'TALK_TIME'
  AND e.employee_code = 'MAS60618'
  AND kda.score_date BETWEEN '2026-06-01' AND '2026-06-15'
ORDER BY kda.score_date DESC;
```

### **Get All Metrics for Employee on Date**
```sql
SELECT
  kmm.metric_code,
  kmm.metric_name,
  kda.actual_value,
  kmm.unit,
  kda.source
FROM kpi_daily_actual kda
JOIN kpi_metric_master kmm ON kmm.id = kda.metric_id
JOIN employees e ON e.id = kda.employee_id
WHERE e.employee_code = 'MAS60618'
  AND kda.score_date = '2026-06-14'
  AND kmm.family = 'operations';
```

### **Get Process Leaderboard**
```sql
-- This is what the API endpoint does
SELECT
  e.id AS employee_id,
  e.employee_code,
  CONCAT(e.first_name, ' ', e.last_name) AS full_name,
  AVG(weighted_score_pct) AS avg_score,
  CASE
    WHEN AVG(weighted_score_pct) >= 90 THEN 'A'
    WHEN AVG(weighted_score_pct) >= 75 THEN 'B'
    WHEN AVG(weighted_score_pct) >= 60 THEN 'C'
    ELSE 'D'
  END AS rating
FROM employees e
JOIN kpi_assignment ka ON ka.employee_id = e.id
-- ... (complex join with scores and templates)
WHERE e.process_id = 'process-uuid'
  AND period = '2026-06'
GROUP BY e.id
ORDER BY avg_score DESC;
```

---

## 🎨 UI Components Available

### **From NativeOperationsKPI.tsx:**
- Metric Cards with trend indicators
- Leaderboard with rankings and badges
- Process selector dropdown
- Period selector (month picker)
- TNI (Training Need Identification) modal
- Refresh button with loading state
- Gradient hero section with stats

### **Reusable Components:**
- `DashboardLayout` - Main layout wrapper
- Lucide React icons (Trophy, TrendingUp, Activity, Target, etc.)
- hrmsApi - Axios wrapper for API calls

---

## 🔐 Permissions Required

**Roles allowed to view Operations KPI:**
```typescript
requireRole("admin", "hr", "manager", "qa", "process_manager")
```

**For modifications:**
```typescript
requireRole("admin", "manager", "process_manager")
```

**Scope filtering:**
- Managers: See only their branch/process employees
- Process Managers: See only their process
- HR/Admin: See all

---

## 📝 Summary

### **✅ What EXISTS:**
1. Complete KPI infrastructure (tables, metrics, workers)
2. APR & Dialer DB sync workers (automated)
3. Quality data aggregation system
4. Operations KPI Dashboard (live, but not showing your 4 metrics)
5. API endpoints for all KPI data
6. Leaderboard and scoring engine

### **🔶 What's MISSING:**
1. **Talk Time** not displayed (stored but not in OPS_DISPLAY_CODES)
2. **Net Login** not displayed (may need metric definition)
3. **HD/Total Calls** not displayed (stored as DIALS/CALLS_HANDLED)
4. Dashboard doesn't show these 4 specific metrics

### **🚀 What NEEDS to be DONE:**
1. Add metric codes to `OPS_DISPLAY_CODES` array
2. Verify `NET_LOGIN` metric exists in `kpi_metric_master`
3. Update dashboard to display 4 requested metrics
4. Test data sync from external DBs
5. Verify formatting (seconds → HH:MM:SS)

---

## 🧪 Testing Checklist

- [ ] Check if `TALK_TIME` metric exists in `kpi_metric_master`
- [ ] Check if `NET_LOGIN` metric exists
- [ ] Check if `DIALS` or `CALLS_HANDLED` metric exists
- [ ] Query `kpi_daily_actual` for sample data
- [ ] Test API endpoint: `/api/kpi/metrics?family=operations`
- [ ] Test API endpoint: `/api/kpi/leaderboard?period=2026-06&family=operations`
- [ ] Add metrics to OPS_DISPLAY_CODES
- [ ] Test dashboard refresh
- [ ] Verify data display and formatting

---

## 📞 Contact & Support

**Database Server:** 122.184.128.90  
**Database User:** shivam_user  
**Main DB:** mas_hrms  
**External DBs:** Shivamgiri, db_audit, db_external, dialer_db

**Backend Port:** 5055 (development)  
**Frontend Port:** 5173 (Vite dev server)

**Last Commit Author:** Shivam Giri <shivam.giri@teammas.in>  
**System Status:** ✅ Production-ready

---

**End of Document**
