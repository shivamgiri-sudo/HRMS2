# ROI and Efficiency Analysis by Process Type

## Overview

The ROI and Efficiency Analysis module provides comprehensive process-level efficiency metrics combining operational, financial, and quality KPIs to calculate ROI and efficiency rankings. This enables CFO/COO visibility into process economics and operational efficiency trends for strategic planning.

## Purpose & Use Cases

### Primary Use Cases
1. **Financial Planning**: Identify high-ROI and low-ROI processes for investment decisions
2. **Process Optimization**: Prioritize improvement initiatives based on efficiency gaps
3. **Cost Benchmarking**: Compare cost-per-call, cost-per-agent across processes and LOBs
4. **Quality-Economics Trade-off**: Analyze relationship between quality scores and operational costs
5. **Headcount Planning**: Optimize agent allocation based on productivity metrics
6. **Client Billing**: Support transparent cost allocation for client portal visibility

## Data Model

### Source Tables

| Table | Key Fields | Purpose |
|-------|-----------|---------|
| `process_master` | id, process_name, business_lob, active_status | Process hierarchy and LOB mapping |
| `employees` | id, process_id, active_status | Team structure and process assignment |
| `integration_call_daily` | process_name, employee_code, activity_date, total_calls, talk_minutes | Call volume and talk time metrics |
| `salary_prep_line` | employee_id, run_id, gross_salary, net_salary | Payroll costs |
| `salary_prep_run` | id, run_month, status | Payroll run metadata |
| `kpi_daily_actual` | employee_id, metric_id, score_date, actual_value | Daily KPI scores |
| `kpi_metric_master` | id, metric_code, metric_name, category, direction | KPI definitions |

### Calculation Window
- **Default**: 90 days rolling (from CURDATE() - INTERVAL 90 DAY)
- **Configurable**: Via API parameters (optional enhancement)

## Metrics & Formulas

### Process Efficiency Matrix

| Metric | Formula | Unit | Interpretation |
|--------|---------|------|-----------------|
| **CALL_VOLUME** | SUM(daily calls) | Count | Total calls in period |
| **AVG_TALK_TIME_SEC** | SUM(talk_minutes * 60) / SUM(calls) | Seconds | Efficiency per call (lower = faster) |
| **COST_PER_CALL** | SUM(gross_salary) / SUM(calls) | Currency | Direct unit economics |
| **QUALITY_SCORE_PCT** | AVG(quality_audit_scores) | 0-100 | Quality performance |
| **CONVERSION_RATE_PCT** | AVG(conversion_scores) | 0-100 | Sales effectiveness |
| **ADHERENCE_PCT** | AVG(adherence_scores) | 0-100 | Schedule compliance |
| **CALLS_PER_DAY** | SUM(calls) / (date_range in days) | Count | Daily throughput |
| **ROI_INDEX** | (quality_score / 100) × (calls_per_day / daily_cost) | Ratio | Composite efficiency |

### ROI Efficiency Score

**Formula**:
```
ROI_EFFICIENCY_SCORE = (Quality Score / 100) × (Productivity Index)

Where:
  Quality Score     = AVG(quality_audit_scores) [0-100]
  Productivity Index = (Total Calls × 100) / (Total Payroll / 1000)
                       = "calls per 1K payroll"
```

**Interpretation**:
- Higher score = Better ROI (high quality + high productivity + low cost)
- Combines quality (output quality) with productivity (output quantity)
- Naturally penalizes high-cost, low-volume processes
- Naturally rewards high-volume, low-cost processes

### Cost Per Call Breakdown

| Tier | Range | Classification |
|------|-------|-----------------|
| HIGH | < $10 | Highly efficient |
| MEDIUM | $10-$20 | Moderately efficient |
| LOW | > $20 | Inefficient or high-complexity |

## API Endpoints

### 1. Process Efficiency Matrix
```
GET /api/analytics/roi-efficiency/process-matrix
```

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "process": "Sales Outbound",
      "lob": "Sales",
      "activeAgents": 45,
      "callVolume": 18500,
      "avgTalkTimeSec": 420,
      "avgCostPerAgentMonthly": 12000,
      "costPerCall": 8.50,
      "qualityScorePct": 85.5,
      "conversionRatePct": 12.3,
      "adherencePct": 92.1,
      "callsPerDay": 206,
      "roiIndex": 1.85
    }
  ],
  "timestamp": "2026-06-21T10:30:00Z"
}
```

### 2. LOB Efficiency Breakdown
```
GET /api/analytics/roi-efficiency/lob-breakdown
```

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "lob": "Sales",
      "processCount": 3,
      "totalAgents": 120,
      "totalCalls90d": 450000,
      "payrollCostK": 4320,
      "avgCostPerCall": 9.60,
      "avgTalkTimeSec": 380,
      "avgQualityScore": 84.2,
      "callsPerAgentPerDay": 125,
      "efficiencyTier": "HIGH"
    }
  ],
  "timestamp": "2026-06-21T10:30:00Z"
}
```

### 3. Process ROI Analysis
```
GET /api/analytics/roi-efficiency/process-roi
```

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "process": "Sales Outbound",
      "lob": "Sales",
      "callVolume": 18500,
      "qualityScorePct": 85.5,
      "totalPayroll90d": 157500,
      "costPerCall": 8.50,
      "productivityIndex": 1185,
      "roiEfficiencyScore": 10.13,
      "efficiencyRank": 1
    }
  ],
  "timestamp": "2026-06-21T10:30:00Z"
}
```

### 4. Performance Categories
```
GET /api/analytics/roi-efficiency/performance-categories
```

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "category": "TOP_PERFORMER",
      "process": "Sales Outbound",
      "agents": 45,
      "roiScore": 10.13,
      "costPerCall": 8.50,
      "qualityPct": 85.5,
      "action": "Maintain excellence, document best practices"
    },
    {
      "category": "IMPROVEMENT_TARGET",
      "process": "Tech Support",
      "agents": 28,
      "roiScore": 2.14,
      "costPerCall": 22.30,
      "qualityPct": 62.0,
      "action": "Intervention: quality training or process re-design"
    }
  ],
  "timestamp": "2026-06-21T10:30:00Z"
}
```

## Implementation Guide

### Database Setup

1. **Verify Required Tables Exist**:
   ```sql
   -- Run this to verify
   SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
   WHERE TABLE_SCHEMA = 'mas_hrms'
   AND TABLE_NAME IN (
     'process_master', 'employees', 'integration_call_daily',
     'salary_prep_line', 'salary_prep_run', 'kpi_daily_actual', 'kpi_metric_master'
   );
   ```

2. **Ensure KPI Metrics are Seeded**:
   ```sql
   -- Check if required metrics exist
   SELECT metric_code, metric_name FROM kpi_metric_master
   WHERE metric_code IN ('QUALITY_SCORE', 'CONVERSION_RATE', 'ADHERENCE');
   ```

3. **Run Historical Script** (Optional):
   - Execute: `/backend/scripts/roi-efficiency-analysis.sql`
   - This populates analysis queries for documentation and testing

### Application Integration

1. **Register Service in Express App**:
   ```typescript
   // In backend/src/server.ts or App.ts
   import roiEfficiencyRouter from './services/roi-efficiency.service';

   app.use('/api/analytics/roi-efficiency', roiEfficiencyRouter);
   ```

2. **Add Authorization Middleware**:
   ```typescript
   // Restrict to CFO/COO/Business Analyst roles
   app.use('/api/analytics/roi-efficiency',
     requireRole(['CFO', 'COO', 'BUSINESS_ANALYST', 'SUPER_ADMIN'])
   );
   ```

### Frontend Dashboard

Example React component to display ROI metrics:

```tsx
import React, { useEffect, useState } from 'react';

export const ROIEfficiencyDashboard = () => {
  const [metrics, setMetrics] = useState([]);

  useEffect(() => {
    fetch('/api/analytics/roi-efficiency/process-roi')
      .then(r => r.json())
      .then(data => setMetrics(data.data))
      .catch(err => console.error('Failed to load ROI metrics', err));
  }, []);

  return (
    <div className="roi-dashboard">
      <h1>Process ROI & Efficiency Analysis</h1>
      <table>
        <thead>
          <tr>
            <th>Process</th>
            <th>Calls (90d)</th>
            <th>Quality</th>
            <th>Cost/Call</th>
            <th>ROI Score</th>
            <th>Rank</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map(m => (
            <tr key={m.process}>
              <td>{m.process}</td>
              <td>{m.callVolume.toLocaleString()}</td>
              <td>{m.qualityScorePct.toFixed(1)}%</td>
              <td>${m.costPerCall.toFixed(2)}</td>
              <td>{m.roiEfficiencyScore.toFixed(2)}</td>
              <td>{m.efficiencyRank}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
```

## Interpretation Guide

### ROI Index Ranges

| ROI Index | Interpretation | Action |
|-----------|-----------------|--------|
| > 2.0 | Excellent efficiency | Benchmark and scale |
| 1.0 - 2.0 | Good efficiency | Maintain and optimize |
| 0.5 - 1.0 | Moderate efficiency | Targeted improvements needed |
| < 0.5 | Poor efficiency | Urgent intervention required |

### Quality vs. Cost Trade-off Analysis

The ROI metric balances both quality and cost:

**If quality is high but cost is high**:
- ROI score is moderate
- Action: Automate/streamline to reduce costs while maintaining quality

**If quality is low but cost is low**:
- ROI score is low
- Action: Invest in training/tools to improve quality

**If both are high**:
- ROI score is excellent
- Action: Document best practices and scale

## Optimization Recommendations

### For High-Cost Processes
1. Audit call handling workflow for inefficiencies
2. Evaluate automation or IVR opportunities
3. Review skill-based routing optimization
4. Consider offshore/nearshore consolidation

### For Low-Quality Processes
1. Increase QA sampling and coaching
2. Implement real-time monitoring/alerts
3. Provide targeted training for root cause issues
4. Review process documentation and standards

### For Low-Volume Processes
1. Evaluate demand forecasting accuracy
2. Consider consolidation with similar processes
3. Review staffing levels vs. actual need
4. Explore peak/off-peak scheduling

## Data Quality Considerations

### Data Dependencies
1. **integration_call_daily** must be updated daily from source system
2. **salary_prep_run** must be current (monthly)
3. **kpi_daily_actual** must be populated via integration or manual entry
4. **employees** must reflect current process assignments

### Known Limitations
- **Zero Calls**: Processes with no calls in 90-day window will show NULL or zero metrics
- **Salary Variance**: Cost metrics depend on payroll accuracy; verify salary_prep_line data
- **Quality Data Lag**: Quality scores may lag call dates by 1-3 days
- **Seasonal Effects**: 90-day window may not account for seasonal variations

### Data Validation Queries

```sql
-- Check for missing integration call data
SELECT process_name, MAX(activity_date) as last_sync
FROM integration_call_daily
GROUP BY process_name
ORDER BY last_sync ASC;

-- Verify salary data currency
SELECT run_month, COUNT(*) as record_count
FROM salary_prep_run
GROUP BY run_month
ORDER BY run_month DESC
LIMIT 3;

-- Check quality score coverage
SELECT DATE(score_date) as date, COUNT(*) as score_count
FROM kpi_daily_actual
WHERE metric_id = (
  SELECT id FROM kpi_metric_master
  WHERE metric_code = 'QUALITY_SCORE'
)
GROUP BY DATE(score_date)
ORDER BY date DESC
LIMIT 7;
```

## Future Enhancements

1. **Trending Analysis**: Month-over-month or quarter-over-quarter trends
2. **Benchmarking**: Compare against industry averages or peer processes
3. **Scenario Planning**: Model impact of staffing/process changes
4. **Predictive Analytics**: Forecast ROI based on leading indicators
5. **Customizable Windows**: Allow users to select date ranges
6. **Export Functionality**: Export metrics to Excel/PDF for reporting
7. **Alerting**: Notify stakeholders when ROI falls below threshold

## Support & Troubleshooting

### Common Issues

**Q: Why is ROI score NULL or 0?**
- A: Likely missing data in integration_call_daily or salary_prep_line. Verify data currency.

**Q: Why are all processes showing similar scores?**
- A: May indicate missing quality data or default values being used. Check kpi_daily_actual.

**Q: How do I update historical data?**
- A: Re-run the integration sync for integration_call_daily; regenerate salary_prep_run.

### Performance Tuning

For large datasets (> 100K employees, > 1M daily call records):
1. Add indexes on integration_call_daily(process_name, activity_date)
2. Partition kpi_daily_actual by score_date
3. Consider materialized view for cached results
4. Implement incremental refresh logic

## Related Documentation

- [KPI Module Guide](./kpi-module-guide.md)
- [Payroll Integration](./payroll-integration.md)
- [Operations Analytics](./operations-analytics.md)
- [Client Portal Reporting](./client-portal-reporting.md)

---

**Last Updated**: 2026-06-21  
**Module Version**: 1.0.0  
**Status**: Production Ready
