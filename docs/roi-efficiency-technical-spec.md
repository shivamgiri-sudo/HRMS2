# ROI & Efficiency Analysis — Technical Specification

## Executive Summary

This document provides the technical specification for the ROI and Efficiency Analysis module—a data-driven analytics layer that calculates process-level efficiency metrics combining operational, financial, and quality KPIs for CFO/COO visibility.

**Scope**: SQL queries, TypeScript service, REST API endpoints, and frontend integration patterns.  
**Effort**: 4-6 hours implementation + testing + documentation  
**Risk Level**: Low (read-only analytics, no state changes)

---

## Artifacts Delivered

### 1. SQL Analysis Script
**File**: `/backend/scripts/roi-efficiency-analysis.sql`

**Content**:
- 4 main queries (Process Matrix, LOB Breakdown, ROI Analysis, Performance Categories)
- 90-day rolling window analysis
- Comprehensive JOIN logic across 7 tables
- ~400 lines of well-documented SQL

**Usage**:
```bash
# Run in MySQL 8.0+ against mas_hrms database
mysql -h [host] -u [user] -p [password] mas_hrms < roi-efficiency-analysis.sql
```

### 2. TypeScript Service
**File**: `/backend/src/services/roi-efficiency.service.ts`

**Exports**:
- `ROIEfficiencyService` class with 4 async methods
- Type definitions for all response structures
- Express Router with 4 GET endpoints
- Snake_case ↔ camelCase conversion utilities

**Methods**:
```typescript
getProcessEfficiencyMatrix(): Promise<ProcessEfficiencyMetrics[]>
getLOBEfficiencyBreakdown(): Promise<LOBEfficiencyMetrics[]>
getProcessROIAnalysis(): Promise<ProcessROIAnalysis[]>
getPerformanceCategories(): Promise<PerformanceCategory[]>
```

**Size**: ~500 lines

### 3. REST API Routes
**Mount Point**: `/api/analytics/roi-efficiency`

**Endpoints**:
| Path | Method | Returns | Rows |
|------|--------|---------|------|
| `/process-matrix` | GET | ProcessEfficiencyMetrics[] | ~1 per process |
| `/lob-breakdown` | GET | LOBEfficiencyMetrics[] | ~1 per LOB |
| `/process-roi` | GET | ProcessROIAnalysis[] | ~1 per process |
| `/performance-categories` | GET | PerformanceCategory[] | ~10 (top 5 + bottom 5) |

**Response Format**:
```json
{
  "success": true,
  "data": [...],
  "timestamp": "2026-06-21T10:30:00Z"
}
```

### 4. Documentation
- **User Guide**: `/docs/roi-efficiency-analysis.md` (~300 lines)
- **Technical Spec**: This file

---

## Data Architecture

### Source Table Dependencies

```
process_master
  ├─ process_name, business_lob, id, active_status
  │
employees
  ├─ id, process_id, active_status
  │
integration_call_daily
  ├─ process_name, employee_code, activity_date, total_calls, talk_minutes
  │
salary_prep_line + salary_prep_run
  ├─ employee_id, gross_salary, run_id, run_month
  │
kpi_daily_actual + kpi_metric_master
  └─ employee_id, metric_id, score_date, actual_value, metric_code
```

### Join Logic

**Primary Path**:
1. Start with `process_master` (all active processes)
2. LEFT JOIN `employees` on process_id (all agents in each process)
3. LEFT JOIN `integration_call_daily` on process_name + activity_date (operational metrics)
4. LEFT JOIN `salary_prep_line` on employee_id (cost data)
5. LEFT JOIN `kpi_daily_actual` for each KPI category (quality/conversion/adherence)

**Filtering**:
- `process_master.active_status = 1`
- `integration_call_daily.activity_date >= CURDATE() - INTERVAL 90 DAY`
- `salary_prep_run.run_month >= DATE_FORMAT(CURDATE() - INTERVAL 90 DAY, '%Y-%m')`
- `kpi_daily_actual.score_date >= CURDATE() - INTERVAL 90 DAY`

### Calculation Window
- **Default**: 90 days
- **Rationale**: Captures seasonal variance, recent trends, sufficient data points
- **Future**: Make configurable via API parameters

---

## Metric Formulas

### QUERY 1: Process Efficiency Matrix

| Column | Formula | Notes |
|--------|---------|-------|
| PROCESS | pm.process_name | String identifier |
| LOB | pm.business_lob | Business line grouping |
| ACTIVE_AGENTS | COUNT(DISTINCT e.id) | Headcount |
| CALL_VOLUME | SUM(icd.total_calls) | 90-day aggregate |
| AVG_TALK_TIME_SEC | AVG(icd.talk_minutes * 60 / icd.total_calls) | Per-call average |
| AVG_COST_PER_AGENT_MONTHLY | SUM(spl.gross_salary) / COUNT(DISTINCT e.id) / 3 | Normalized to month |
| COST_PER_CALL | SUM(spl.gross_salary) / SUM(icd.total_calls) | Direct unit economics |
| QUALITY_SCORE_PCT | AVG(kda_quality.actual_value) | 0-100 scale, defaults to 0 if NULL |
| CONVERSION_RATE_PCT | AVG(kda_conversion.actual_value) | 0-100 scale, defaults to 0 if NULL |
| ADHERENCE_PCT | AVG(kda_adherence.actual_value) | 0-100 scale, defaults to 0 if NULL |
| CALLS_PER_DAY | SUM(icd.total_calls) / (date_range days) | Daily throughput |
| ROI_INDEX | (quality / 100) × (calls_per_day / daily_cost) | Composite score |

### QUERY 2: LOB Efficiency Breakdown

**Aggregation Level**: By business_lob

**Key Formulas**:
- PAYROLL_COST_K: `SUM(spl.gross_salary) / 1000`
- CALLS_PER_AGENT_PER_DAY: `(SUM(icd.total_calls) / COUNT(DISTINCT e.id)) / 90`
- EFFICIENCY_TIER: Bucketed by cost_per_call thresholds ($10, $20)

### QUERY 3: ROI Analysis (Weighted Composite)

**Primary Metric**: `ROI_EFFICIENCY_SCORE`

**Formula**:
```
ROI_EFFICIENCY_SCORE = (QUALITY_SCORE / 100) × PRODUCTIVITY_INDEX

Where:
  QUALITY_SCORE = AVG(kda_quality.actual_value)  [0-100]
  PRODUCTIVITY_INDEX = (TOTAL_CALLS × 100) / (TOTAL_PAYROLL_K)
                     = Calls generated per 1K of payroll spent
```

**Interpretation**:
- Combines output quality (quality_score) with output quantity (productivity)
- Naturally penalizes expensive, low-volume processes
- Rewards efficient, high-volume processes
- Bounded by data quality (where QUALITY_SCORE defaults to 75 if NULL)

**Example**:
- Process A: Quality=85%, Productivity=1200 → ROI = 0.85 × 1200 = 1,020
- Process B: Quality=90%, Productivity=800 → ROI = 0.90 × 800 = 720
- Process A is more efficient despite lower quality (higher volume offsets)

### QUERY 4: Performance Categories

**Top Performers**: Top 5 by ROI_EFFICIENCY_SCORE  
**Improvement Targets**: Bottom 5 by ROI_EFFICIENCY_SCORE  
**Action**: Predefined recommendation text

---

## Implementation Steps

### Phase 1: Database Validation (30 min)
```sql
-- Verify required tables exist
SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = 'mas_hrms'
AND TABLE_NAME IN (
  'process_master', 'employees', 'integration_call_daily',
  'salary_prep_line', 'salary_prep_run', 'kpi_daily_actual', 'kpi_metric_master'
);

-- Verify KPI metrics are seeded
SELECT COUNT(*) FROM kpi_metric_master
WHERE metric_code IN ('QUALITY_SCORE', 'CONVERSION_RATE', 'ADHERENCE', 'DIALS', 'TALK_TIME');

-- Verify recent data exists in key tables
SELECT
  (SELECT MAX(activity_date) FROM integration_call_daily) as call_data_latest,
  (SELECT MAX(run_month) FROM salary_prep_run) as payroll_latest,
  (SELECT MAX(score_date) FROM kpi_daily_actual) as kpi_latest;
```

### Phase 2: Service Implementation (1 hour)
1. Copy `roi-efficiency.service.ts` to `/backend/src/services/`
2. Verify TypeScript compilation: `npm run build`
3. Run type check: `npm run type-check`

### Phase 3: Route Registration (15 min)
```typescript
// In backend/src/App.ts or server.ts:
import roiEfficiencyRouter from './services/roi-efficiency.service';

// Before route catch-all:
app.use('/api/analytics/roi-efficiency', roiEfficiencyRouter);

// Optional: Add authorization
import { requireRole } from './middleware/requireRole';
app.use('/api/analytics/roi-efficiency',
  requireRole(['CFO', 'COO', 'SUPER_ADMIN', 'BUSINESS_ANALYST'])
);
```

### Phase 4: Testing (45 min)
```bash
# Test each endpoint
curl http://localhost:3000/api/analytics/roi-efficiency/process-matrix
curl http://localhost:3000/api/analytics/roi-efficiency/lob-breakdown
curl http://localhost:3000/api/analytics/roi-efficiency/process-roi
curl http://localhost:3000/api/analytics/roi-efficiency/performance-categories

# Verify response structure
# Verify data types match TypeScript interfaces
# Check for NULL/undefined handling
```

### Phase 5: Frontend Integration (1-2 hours)
1. Create React component to consume endpoints
2. Add to admin/CFO dashboard
3. Implement filtering, sorting, export
4. Add charts/visualizations (optional)

---

## Performance Characteristics

### Query Performance

**Current Dataset Scale** (assumed):
- processes_master: ~50 rows
- employees: ~5,000 rows
- integration_call_daily: ~500K rows (5K calls/day × 100 days)
- salary_prep_line: ~100K rows (all 5K employees × 20 months)
- kpi_daily_actual: ~500K rows (multiple metrics per employee per day)

**Expected Query Times** (MySQL 8.0 on standard hardware):
- QUERY 1 (Matrix): ~500-800ms
- QUERY 2 (LOB): ~300-500ms
- QUERY 3 (ROI): ~400-600ms
- QUERY 4 (Categories): ~600-1000ms

### Optimization Opportunities

**Current State**: No specific optimization applied (relies on FK indexes)

**If Needed**:
1. Add composite index: `integration_call_daily(process_name, activity_date)`
2. Add composite index: `kpi_daily_actual(employee_id, score_date, metric_id)`
3. Add index: `salary_prep_run(run_month, status)`
4. Consider materialized view for cached results (daily refresh)

### Caching Strategy

**For Production**:
```typescript
// Cache results for 1 hour (ROI doesn't change frequently)
const CACHE_TTL_MS = 60 * 60 * 1000;

router.get('/process-matrix', 
  async (req: Request, res: Response) => {
    const cacheKey = 'roi:process-matrix';
    const cached = await cache.get(cacheKey);
    if (cached) return res.json(cached);
    
    const result = await service.getProcessEfficiencyMatrix();
    await cache.set(cacheKey, result, CACHE_TTL_MS);
    res.json(result);
  }
);
```

---

## Error Handling & Edge Cases

### Data Gaps

**Scenario**: Process has employees but no call data  
**Handling**: 
- SUM/COUNT aggregates return 0 or NULL
- COALESCE defaults apply (e.g., QUALITY_SCORE defaults to 75)
- Process still appears in results with zero/default metrics

**Scenario**: Employee has calls but no salary data  
**Handling**:
- Cost metrics compute with available salary data
- NULL values excluded from SUM
- May result in artificially low cost_per_call

### NULL Handling

```typescript
// Service masks NULLs in results:
private toCamelCase(obj: any): any {
  const result: any = {};
  for (const key in obj) {
    const val = obj[key];
    result[key] = val === null ? 0 : val;  // Convert NULL to 0
  }
  return result;
}
```

### Authorization

**Current**: No authorization applied at service level  
**Recommended**: Restrict to roles:
- CFO
- COO
- Business Analyst
- Super Admin

**Implementation**:
```typescript
router.get('/process-matrix',
  requireRole(['CFO', 'COO', 'SUPER_ADMIN']),
  async (req, res) => { ... }
);
```

---

## Data Quality Requirements

### For Accurate ROI Calculation

| Data Source | Requirement | Frequency | Impact if Missing |
|-------------|-------------|-----------|-------------------|
| integration_call_daily | Daily sync from dialer/pbx | Daily | Calls/productivity metrics = 0 |
| salary_prep_line | Monthly payroll data | Monthly | Cost metrics = NULL |
| kpi_daily_actual | Quality/performance scores | Daily or per-audit | Quality defaults to 75 |
| process_master | Active processes mapped to LOB | Static | LOB breakdown breaks |
| employees | Employee-to-process mapping, active_status | Updated on change | Duplicate agents or exclusions |

### Validation Queries

```sql
-- Check data currency and coverage
SELECT 
  'integration_call_daily' as table_name,
  MAX(activity_date) as latest_date,
  DATEDIFF(CURDATE(), MAX(activity_date)) as days_stale,
  COUNT(*) as record_count
FROM integration_call_daily
WHERE activity_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)

UNION ALL

SELECT 
  'salary_prep_run',
  MAX(run_month),
  DATEDIFF(CURDATE(), STR_TO_DATE(CONCAT(MAX(run_month), '-01'), '%Y-%m-%d')),
  COUNT(*)
FROM salary_prep_run

UNION ALL

SELECT 
  'kpi_daily_actual',
  MAX(score_date),
  DATEDIFF(CURDATE(), MAX(score_date)),
  COUNT(*)
FROM kpi_daily_actual
WHERE score_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY);
```

---

## Deployment Checklist

- [ ] Verify all required tables exist and have data
- [ ] Run SQL analysis script in test environment
- [ ] Copy TypeScript service file
- [ ] Verify `npm run build` succeeds
- [ ] Register routes in Express app
- [ ] Add authorization middleware
- [ ] Test all 4 endpoints with curl/Postman
- [ ] Verify response data types match TypeScript interfaces
- [ ] Add frontend component (or document manual integration)
- [ ] Deploy to staging for UAT
- [ ] Document in runbook (if applicable)
- [ ] Communicate availability to CFO/COO

---

## Maintenance & Support

### Monitoring

**KPIs to monitor**:
- API response times (should be < 1s)
- Query execution times (should be < 500ms each)
- Data freshness (integration_call_daily should be < 1 day old)
- Null/zero rates (should be < 5% of rows)

### Common Issues & Resolutions

| Issue | Cause | Resolution |
|-------|-------|-----------|
| All metrics are 0 | Missing integration_call_daily data | Verify dialer/pbx sync is running |
| Cost metrics are very high | Salary data includes bonuses/adjustments | Verify gross_salary is base only |
| Quality score is 75 for all | Missing kpi_daily_actual records | Run quality audit sync job |
| Slow queries (> 2s) | Large dataset, missing indexes | Add recommended indexes or implement caching |

### Runbook Entry

**Module**: ROI & Efficiency Analysis  
**Owner**: CFO / Business Analyst  
**SLA**: No SLA (analytics, not operational)  
**Alerting**: None configured (manual checks only)  
**Escalation**: If data is stale (> 3 days), check integration_call_daily sync job

---

## Future Enhancements

### Phase 2 Roadmap
1. **Trending**: Add month-over-month and quarter-over-quarter change metrics
2. **Forecasting**: Predict next month ROI based on leading indicators
3. **Alerts**: Notify stakeholders when ROI falls below threshold
4. **Exports**: CSV/PDF export functionality
5. **Customizable Windows**: Date range picker for users
6. **Drill-down**: Process → Agent-level drill-down detail view
7. **Benchmarking**: Compare against industry/peer benchmarks

---

## Sign-Off

| Role | Name | Date | Notes |
|------|------|------|-------|
| Finance Lead | TBD | | |
| Tech Lead | TBD | | |
| QA Lead | TBD | | |

---

**Document Version**: 1.0  
**Last Updated**: 2026-06-21  
**Status**: Ready for Implementation
