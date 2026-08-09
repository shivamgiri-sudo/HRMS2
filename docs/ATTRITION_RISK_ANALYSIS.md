# Attrition Risk & Performance Degradation Analysis

## Overview

This document describes the comprehensive attrition risk detection system integrated into MAS Callnet PeopleOS HRMS. The system identifies agents at risk of resignation through multi-factor analysis of performance, attendance, and engagement metrics.

**Status**: Production-ready analytics suite  
**Last Updated**: 2026-06-21  
**Scope**: BPO/Call Centre agents, supervisory staff

---

## 1. Analysis Dimensions

### 1.1 Performance Degradation (30-Day Rolling Average)
**SQL File**: `backend/scripts/attrition-risk-analysis.sql` (QUERY SET 1)  
**API Endpoint**: `GET /api/analytics/attrition-risk/performance-degradation`  
**Authorized Roles**: HR Admin, WFM Manager, Operations Manager

**Purpose**: Detect agents whose call quality is declining week-over-week, indicating possible disengagement, burnout, or departure risk.

**Metrics**:
- Weekly average quality score (30-day rolling)
- Week-over-week quality delta (current vs previous week)
- Trend classification: RISK (< -10%), WARNING (< -5%), WATCH (< 0%), STABLE

**Risk Thresholds**:
| Threshold | Classification | Score |
|-----------|----------------|-------|
| Delta < -15% | CRITICAL RISK | 85 |
| Delta < -10% | RISK | 70 |
| Delta < -5% | WARNING | 55 |
| Delta < 0% | WATCH | 30 |

**Output Columns**:
```
RISK_AGENT | agent_name | week_num | weekly_avg_quality | prev_week_avg_quality
quality_delta | performance_trend | call_count | tenure_months | INTERVENTION_PRIORITY
DEGRADATION_RATE | ATTRITION_RISK_SCORE
```

**Example Output**:
```
EMP001 | John Doe | 25 | 72.5 | 85.0 | -12.5 | RISK | 42 | 18 | CRITICAL
10 | 70
```

---

### 1.2 Absenteeism Correlation with Quality
**SQL File**: `backend/scripts/attrition-risk-analysis.sql` (QUERY SET 2)  
**API Endpoint**: `GET /api/analytics/attrition-risk/absenteeism-correlation`  
**Authorized Roles**: HR Admin, Operations Manager

**Purpose**: Correlate high absenteeism with quality degradation. Agents combining both factors are at heightened attrition risk (often indicating burnout or health issues leading to resignation).

**Metrics**:
- Attendance percentage (last 60 days)
- Absent days count
- Average quality score
- Composite risk score (attendance factor + quality factor)

**Risk Scoring Logic**:
```
ATTRITION_RISK_SCORE = Attendance_Risk_Factor + Quality_Risk_Factor

Attendance_Risk_Factor:
  < 75% attendance → 30 points
  < 85% attendance → 20 points
  < 90% attendance → 10 points
  Else           → 5 points

Quality_Risk_Factor:
  < 60% quality → 50 points
  < 70% quality → 40 points
  < 80% quality → 20 points
  Else         → 5 points

Total Score Range: 10-80 (higher = more risk)
```

**Intervention Priority**:
```
CRITICAL:
  attendance < 80% AND quality < 75%
  → Immediate: Workload review, health check, performance plan

HIGH_PRIORITY:
  attendance < 85% AND quality < 80%
  → Urgent: Enhanced monitoring, support structure

MEDIUM_PRIORITY:
  attendance < 90% OR quality < 70%
  → Standard: Regular coaching, attendance tracking
```

---

### 1.3 Compound Risk Profile (Multi-Factor Analysis)
**SQL File**: `backend/scripts/attrition-risk-analysis.sql` (QUERY SET 3)  
**API Endpoint**: `GET /api/analytics/attrition-risk/compound-risk`  
**Authorized Roles**: HR Admin, WFM Manager, Operations Manager

**Purpose**: Holistic risk assessment combining tenure, team load, quality volatility, and attendance. Agents with multiple concurrent risk factors are prioritized for intervention.

**Factors Evaluated**:

| Factor | Weight | Risk Bands |
|--------|--------|-----------|
| Quality Score | 40 pts | < 60% (40), < 70% (30), < 75% (15), Else (5) |
| Attendance % | 30 pts | < 75% (30), < 85% (20), < 90% (10), Else (5) |
| Tenure Months | 15 pts | < 3mo (15), < 6mo (10), Else (0) |
| Team Size | 10 pts | > 15 (10), > 12 (5), Else (0) |
| Quality Volatility | 10 pts | > 20 (10), > 15 (5), Else (0) |

**Risk Level Determination**:
```
CRITICAL:
  quality < 65% AND attendance < 80% AND tenure < 6mo AND team_size > 12
  → Immediate coaching + workload reduction + close monitoring

HIGH:
  quality < 70% AND volatility > 15%
  → Stability support + performance plan

MEDIUM:
  (quality < 75% AND tenure < 6mo) OR (attendance < 85% AND quality < 75%)
  → Enhanced monitoring + accelerated ramp program

LOW:
  All else
  → Standard monitoring
```

**Output**:
```
RISK_AGENT | agent_name | designation | process | branch | tenure_months
experience_level | team_size | team_load_level | avg_quality | quality_volatility
attendance_pct | risk_level | ATTRITION_RISK_SCORE | DEGRADATION_RATE | INTERVENTION_PRIORITY
```

---

### 1.4 Quality Velocity (Trend Acceleration Detection)
**SQL File**: `backend/scripts/attrition-risk-analysis.sql` (QUERY SET 4)  
**API Endpoint**: `GET /api/analytics/attrition-risk/quality-velocity`  
**Authorized Roles**: HR Admin, WFM Manager

**Purpose**: Detect rapid quality deterioration (velocity indicator). Week-over-week declines are early signals of disengagement; sustained declines indicate high risk.

**Metrics**:
- Current week quality
- Weekly quality 1, 2, 3 weeks ago
- Delta for each week
- Average degradation rate (3-week moving average)

**Trend Patterns**:
```
RAPID_DECLINE:
  Single-week drop > -15% OR prior week drop > -15%
  DEGRADATION_RATE: 80
  INTERVENTION_PRIORITY: CRITICAL
  Action: Emergency coaching + workload review

SUSTAINED_DECLINE:
  3-week average decline > -8%
  DEGRADATION_RATE: 65
  INTERVENTION_PRIORITY: HIGH_PRIORITY
  Action: Enhanced support + weekly check-ins

RECENT_DECLINE:
  2-week average decline > -5%
  DEGRADATION_RATE: 50
  INTERVENTION_PRIORITY: MEDIUM_PRIORITY
  Action: Coaching + weekly monitoring

STABLE:
  All else
  DEGRADATION_RATE: 20
  INTERVENTION_PRIORITY: ROUTINE
  Action: Standard monitoring
```

---

### 1.5 Early Warning Indicators (Predictive Signals)
**SQL File**: `backend/scripts/attrition-risk-analysis.sql` (QUERY SET 5)  
**API Endpoint**: `GET /api/analytics/attrition-risk/early-warning`  
**Authorized Roles**: HR Admin, Operations Manager

**Purpose**: Identify leading indicators of attrition before quality/attendance fully deteriorate. Agents showing combined signals of disengagement (absence spike + audit drop + mood swings) should be proactively engaged.

**Early Warning Signals**:

| Signal | Detection | Risk Score | Action |
|--------|-----------|-----------|--------|
| Absence Spike | 30-day absences > prior 30-day + 2 days | 30 pts | Health check, workload review |
| Audit Decline | Recent audits < 70% of prior period | 25 pts | Engagement review, career discussion |
| Quality Volatility | Recent stddev > 20% (mood swings) | 20 pts | Stability assessment, support plan |
| Volatility Moderate | Recent stddev > 15% | 15 pts | Monitoring intensification |

**Intervention Triggers**:
```
CRITICAL:
  Absence Spike (> 2) AND Audit Decline (< 70% of prior) 
  Score: 55+
  → HR + Manager 1:1: Health, home situation, career fit, burnout assessment

HIGH_PRIORITY:
  Absence Spike (> 1) 
  Score: 40+
  → Manager: Attendance review + support offer

MEDIUM_PRIORITY:
  Quality Volatility (> 15%) 
  Score: 30+
  → Manager: Weekly check-in + performance coaching
```

---

### 1.6 Consolidated Risk Report
**SQL File**: `backend/scripts/attrition-risk-analysis.sql` (SUMMARY REPORT)  
**API Endpoint**: `GET /api/analytics/attrition-risk/consolidated`  
**Authorized Roles**: HR Admin, WFM Manager, Operations Manager

**Purpose**: Single-view high-risk agent roster across all analyses for management review and intervention coordination.

**Inclusion Criteria**:
- At least 5 quality audits in last 90 days
- At least 20 attendance records in last 60 days
- Quality < 75% OR Attendance < 90%

**Output**:
```
RISK_AGENT | agent_name | designation | process | branch | tenure_months
current_quality_score | total_audits_90d | quality_volatility | attendance_pct
absent_days_60d | team_size | ATTRITION_RISK_SCORE | DEGRADATION_RATE | INTERVENTION_PRIORITY
```

---

## 2. API Endpoints

### Base URL
```
http://[backend-host]/api/analytics/attrition-risk
```

### Authentication
All endpoints require:
- Valid JWT token in `Authorization: Bearer <token>`
- Appropriate role assignment (see each endpoint)

### Endpoints

#### 1. Performance Degradation
```
GET /api/analytics/attrition-risk/performance-degradation
Query Parameters:
  limit (optional): 1-100, default 50
  daysBack (optional): 1-365, default 90

Response:
{
  "success": true,
  "analysis_type": "PERFORMANCE_DEGRADATION",
  "count": 23,
  "data": [
    {
      "RISK_AGENT": "EMP001",
      "agent_name": "John Doe",
      "week_num": 25,
      "weekly_avg_quality": 72.5,
      "prev_week_avg_quality": 85.0,
      "quality_delta": -12.5,
      "performance_trend": "RISK",
      "call_count": 42,
      "tenure_months": 18,
      "designation_name": "Support Agent",
      "process_name": "Tech Support",
      "branch_name": "Mumbai",
      "DEGRADATION_RATE": 70,
      "INTERVENTION_PRIORITY": "CRITICAL"
    }
  ],
  "timestamp": "2026-06-21T10:30:00Z"
}
```

#### 2. Absenteeism Correlation
```
GET /api/analytics/attrition-risk/absenteeism-correlation
Query Parameters:
  limit (optional): 1-100, default 50
  daysBack (optional): 30-90, default 60

Response:
{
  "success": true,
  "analysis_type": "ABSENTEEISM_CORRELATION",
  "count": 15,
  "data": [
    {
      "RISK_AGENT": "EMP002",
      "agent_name": "Jane Smith",
      "present_days": 35,
      "total_days": 50,
      "DEGRADATION_RATE": 70.0,
      "absent_days": 12,
      "avg_quality_score": 68.5,
      "audited_calls": 28,
      "ATTRITION_RISK_SCORE": 65,
      "INTERVENTION_PRIORITY": "HIGH_PRIORITY",
      "tenure_months": 12
    }
  ],
  "timestamp": "2026-06-21T10:30:00Z"
}
```

#### 3. Compound Risk Profile
```
GET /api/analytics/attrition-risk/compound-risk
Query Parameters:
  limit (optional): 1-100, default 50

Response:
{
  "success": true,
  "analysis_type": "COMPOUND_RISK_PROFILE",
  "count": 42,
  "data": [
    {
      "RISK_AGENT": "EMP003",
      "agent_name": "Kumar Patel",
      "designation_name": "Junior Agent",
      "process_name": "Customer Service",
      "branch_name": "Bangalore",
      "tenure_months": 4.5,
      "experience_level": "Onboarding (< 3mo)",
      "team_size": 18,
      "team_load_level": "Overloaded",
      "avg_quality": 62.0,
      "quality_volatility": 16.5,
      "attendance_pct": 82.0,
      "risk_level": "CRITICAL",
      "ATTRITION_RISK_SCORE": 80,
      "DEGRADATION_RATE": 28.5,
      "INTERVENTION_PRIORITY": "CRITICAL"
    }
  ],
  "timestamp": "2026-06-21T10:30:00Z"
}
```

#### 4. Quality Velocity
```
GET /api/analytics/attrition-risk/quality-velocity
Query Parameters:
  limit (optional): 1-100, default 50

Response:
{
  "success": true,
  "analysis_type": "QUALITY_VELOCITY",
  "count": 8,
  "data": [
    {
      "RISK_AGENT": "EMP004",
      "agent_name": "Raj Kumar",
      "current_week_quality": 65.0,
      "week_1_ago": 78.5,
      "week_2_ago": 82.0,
      "week_3_ago": 80.5,
      "delta_week_1": -13.5,
      "delta_week_2": -17.0,
      "delta_week_3": -15.5,
      "trend_pattern": "RAPID_DECLINE",
      "DEGRADATION_RATE": 80,
      "INTERVENTION_PRIORITY": "CRITICAL"
    }
  ],
  "timestamp": "2026-06-21T10:30:00Z"
}
```

#### 5. Early Warning Indicators
```
GET /api/analytics/attrition-risk/early-warning
Query Parameters:
  limit (optional): 1-100, default 50

Response:
{
  "success": true,
  "analysis_type": "EARLY_WARNING",
  "count": 6,
  "data": [
    {
      "RISK_AGENT": "EMP005",
      "agent_name": "Priya Singh",
      "designation_name": "Senior Agent",
      "process_name": "Sales",
      "branch_name": "Delhi",
      "recent_absent_30d": 8,
      "prior_absent_30d": 2,
      "recent_audit_count": 12,
      "prior_audit_count": 28,
      "recent_quality_volatility": 22.5,
      "tenure_months": 24,
      "ATTRITION_RISK_SCORE": 55,
      "INTERVENTION_PRIORITY": "CRITICAL",
      "recommended_action": "Review absence spike + engagement metrics for workload/burnout"
    }
  ],
  "timestamp": "2026-06-21T10:30:00Z"
}
```

#### 6. Consolidated Risk Report
```
GET /api/analytics/attrition-risk/consolidated
Query Parameters:
  limit (optional): 1-200, default 100

Response:
{
  "success": true,
  "analysis_type": "CONSOLIDATED_RISK_REPORT",
  "count": 87,
  "data": [
    {
      "RISK_AGENT": "EMP001",
      "agent_name": "John Doe",
      "designation_name": "Support Agent",
      "process_name": "Tech Support",
      "branch_name": "Mumbai",
      "tenure_months": 18,
      "current_quality_score": 68.5,
      "total_audits_90d": 87,
      "quality_volatility": 14.2,
      "attendance_pct": 86.5,
      "absent_days_60d": 8,
      "team_size": 14,
      "ATTRITION_RISK_SCORE": 70,
      "DEGRADATION_RATE": "HIGH",
      "INTERVENTION_PRIORITY": "HIGH_PRIORITY - Enhanced monitoring & support"
    }
  ],
  "timestamp": "2026-06-21T10:30:00Z"
}
```

---

## 3. Error Handling

All endpoints return consistent error responses:

```json
{
  "success": false,
  "error": "Failed to fetch [analysis type] data",
  "timestamp": "2026-06-21T10:30:00Z"
}
```

Common HTTP Status Codes:
- `200 OK`: Analysis successful
- `401 Unauthorized`: Missing or invalid JWT token
- `403 Forbidden`: Insufficient role permissions
- `500 Internal Server Error`: Database or query error

---

## 4. Implementation Guide

### 4.1 Backend Setup

1. **File Locations**:
   ```
   backend/scripts/attrition-risk-analysis.sql         # SQL queries
   backend/src/modules/analytics/attritionRisk.service.ts  # TypeScript service
   backend/src/modules/analytics/attritionRisk.routes.ts   # Express routes
   ```

2. **Database Prerequisites**:
   - MySQL `mas_hrms` database with tables:
     - `employees`
     - `attendance_daily_record`
     - `designation_master`
     - `process_master`
     - `branch_master`
   - External `db_audit.call_quality_assessment` table (read-only)

3. **API Integration**:
   ```typescript
   // In backend/src/App.tsx or main router
   import attritionRiskRoutes from './modules/analytics/attritionRisk.routes';
   
   app.use('/api/analytics/attrition-risk', attritionRiskRoutes);
   ```

4. **Environment Variables**:
   ```
   DB_HOST=localhost
   DB_USER=root
   DB_PASSWORD=***
   DB_NAME=mas_hrms
   DB_AUDIT_NAME=db_audit    # External audit database
   ```

### 4.2 Frontend Integration (React)

```typescript
// Example React hook
const useAttritionAnalytics = () => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);

  const fetchPerformanceDegradation = async (limit = 50) => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/analytics/attrition-risk/performance-degradation?limit=${limit}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );
      const result = await response.json();
      setData(result.data);
    } finally {
      setLoading(false);
    }
  };

  return { loading, data, fetchPerformanceDegradation };
};
```

### 4.3 Dashboard Components

Suggested UI components for results presentation:

```
AttritionRiskDashboard
├── KPI Cards (Summary Stats)
│   ├── Total High-Risk Agents
│   ├── Critical Priority Count
│   └── Average Risk Score
├── Tabs
│   ├── Performance Degradation (Table + Chart)
│   ├── Absenteeism Correlation (Scatter + Table)
│   ├── Compound Risk (Sortable Table)
│   ├── Quality Velocity (Line Chart + Table)
│   ├── Early Warnings (Alert List)
│   └── Consolidated Report (Master List + Export)
└── Actions
    ├── Export to CSV
    ├── Drill-down Agent Profile
    └── Intervention Log
```

---

## 5. Operational Guidelines

### 5.1 Frequency & Governance

| Analysis | Refresh Frequency | Owner | Review Cadence |
|----------|------------------|-------|----------------|
| Performance Degradation | Daily | WFM Manager | Weekly |
| Absenteeism Correlation | Daily | HR Admin | Bi-weekly |
| Compound Risk Profile | Daily | HR + WFM | Weekly |
| Quality Velocity | Daily | WFM Manager | Daily (critical only) |
| Early Warnings | Daily | HR Admin | Weekly |
| Consolidated Report | Daily | Operations Manager | Weekly |

### 5.2 Intervention Workflow

```
Agent Flagged (CRITICAL)
  ↓
Auto-notify Manager + HR Admin (within 4 hours)
  ↓
Manager 1:1 (scheduled within 48 hours)
  → Assess: workload, health, career fit, burnout
  → Offer: coaching, workload adjustment, resources
  → Log: outcome, action items, follow-up date
  ↓
Follow-up (7 days)
  → Monitor: attendance, quality, engagement
  → Escalate if: no improvement or risk increase
  ↓
Exit Risk Assessment (14 days)
  → If improving: weekly check-ins continue
  → If declining: career counseling, exit planning?
```

### 5.3 Data Privacy & Compliance

- **Access Control**: All data behind role-based authorization
- **Audit Trail**: Store intervention logs in `employee_intervention_log` (recommended)
- **PII Protection**: Never export personal data externally
- **Data Retention**: Retain analytics summaries for 12 months, raw intervention logs for 3 years (per labor law)

---

## 6. Interpretation Guide

### High-Risk Agent Profile Example

```
Agent: EMP001 (John Doe)
Tenure: 18 months
Process: Tech Support
Branch: Mumbai

PERFORMANCE DEGRADATION:
  Week 24 Quality: 85.0%
  Week 25 Quality: 72.5%
  Delta: -12.5% (RISK)
  → Coaching + performance plan recommended

ABSENTEEISM:
  Attendance: 86.5%
  Absent Days (60d): 8
  Quality: 68.5%
  → Combined stress/health signal

COMPOUND RISK:
  Risk Level: HIGH
  Attrition Score: 70/100
  Team Size: 14 (optimal load)
  Quality Volatility: 14.2% (moderate)
  → Multiple converging factors

VELOCITY:
  Trend: Recent Decline (-5% avg 2-week)
  Pattern: RECENT_DECLINE
  → Monitoring urgency: MEDIUM_PRIORITY

INTERVENTION:
  Priority: HIGH_PRIORITY
  Action: Enhanced monitoring & support
  Manager Touchpoint: This week
  HR Follow-up: Weekly check-ins
  Expected Outcome: Quality stabilization within 2-3 weeks
```

---

## 7. FAQ & Troubleshooting

### Q: Why is an agent not showing in any risk report?
**A**: Inclusion criteria require:
- 5+ quality audits (last 90 days)
- 20+ attendance records (last 60 days)
- Quality < 75% OR Attendance < 90%

If none of these are met, agent is not at risk or insufficient data.

### Q: Can I customize risk thresholds?
**A**: Yes. Edit the CASE statements in SQL queries or service functions. Key parameters:
- `quality_delta < -10` for RISK (tweak based on business tolerance)
- `attendance_pct < 85` for correlation risk (adjust per policy)
- Volatility `> 15` for mood swings (adjust sensitivity)

### Q: What if an agent has no call quality data?
**A**: Analysis relies on external `db_audit.call_quality_assessment`. If missing:
- Backend staff without audit assignment won't appear in quality-based analyses
- Attendance + tenure data still valid (Compound Risk includes them)
- Consider adding agents to audit sampling pool

### Q: How do I export results?
**A**: Add CSV export endpoint:
```typescript
router.get('/export', requireAuth, requireRole(['HR_ADMIN']), async (req, res) => {
  const [rows] = await pool.query('SELECT ... FROM ...');
  const csv = convert(rows);
  res.setHeader('Content-Type', 'text/csv');
  res.send(csv);
});
```

---

## 8. Future Enhancements

- **Predictive Modeling**: ML-based probability of resignation within 30/90 days
- **Cohort Analysis**: Compare risk profiles across tenure/designation/process/branch
- **Intervention Tracking**: Log outcomes of manager interventions; measure effectiveness
- **Burnout Score**: Incorporate sentiment analysis from feedback, surveys
- **Retention Bonus**: AI-suggested retention interventions based on peer retention success
- **Attrition Cost**: Estimate financial impact of potential resignations

---

## 9. Support & Escalation

**Questions**: Contact HR Admin or Analytics Team  
**Data Gaps**: Verify `db_audit.call_quality_assessment` data freshness  
**Performance**: For large result sets, use pagination (limit parameter)  
**Bugs**: Log in JIRA under "Analytics" epic with query type and date range

---

**Document Version**: 1.0  
**Last Updated**: 2026-06-21  
**Next Review**: 2026-09-21
