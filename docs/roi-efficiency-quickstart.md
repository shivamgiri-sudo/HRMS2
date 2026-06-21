# ROI & Efficiency Analysis — Quick Start Guide

## 5-Minute Setup

### Step 1: Add Service to Express App
```typescript
// backend/src/App.ts or server.ts

import roiEfficiencyRouter from './services/roi-efficiency.service';

// Add this line before catch-all routes:
app.use('/api/analytics/roi-efficiency', roiEfficiencyRouter);

// Optional: Add role-based access control
import { requireRole } from './middleware/requireRole';
app.use('/api/analytics/roi-efficiency',
  requireRole(['CFO', 'COO', 'SUPER_ADMIN', 'BUSINESS_ANALYST'])
);
```

### Step 2: Verify Database Tables
```bash
# SSH into database server
mysql -h [your-host] -u [user] -p[password] mas_hrms

# Run this to verify required tables exist:
USE mas_hrms;
SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_NAME IN (
  'process_master', 'employees', 'integration_call_daily',
  'salary_prep_line', 'salary_prep_run', 'kpi_daily_actual', 'kpi_metric_master'
);
```

### Step 3: Build and Test
```bash
cd backend
npm run build
npm start

# In another terminal, test the endpoints:
curl http://localhost:3000/api/analytics/roi-efficiency/process-matrix
curl http://localhost:3000/api/analytics/roi-efficiency/process-roi
```

---

## API Examples

### Get Process Efficiency Matrix
```bash
curl -H "Authorization: Bearer [token]" \
  http://localhost:3000/api/analytics/roi-efficiency/process-matrix | jq .
```

**Sample Response**:
```json
{
  "success": true,
  "data": [
    {
      "process": "Sales Outbound - FMCG",
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
    },
    {
      "process": "Tech Support - Enterprise",
      "lob": "Support",
      "activeAgents": 28,
      "callVolume": 8200,
      "avgTalkTimeSec": 650,
      "avgCostPerAgentMonthly": 11500,
      "costPerCall": 22.30,
      "qualityScorePct": 62.0,
      "conversionRatePct": 0,
      "adherencePct": 88.3,
      "callsPerDay": 91,
      "roiIndex": 0.32
    }
  ],
  "timestamp": "2026-06-21T10:30:00Z"
}
```

### Get LOB Efficiency Breakdown
```bash
curl http://localhost:3000/api/analytics/roi-efficiency/lob-breakdown | jq .
```

**Sample Response**:
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
    },
    {
      "lob": "Support",
      "processCount": 2,
      "totalAgents": 55,
      "totalCalls90d": 65000,
      "payrollCostK": 1540,
      "avgCostPerCall": 23.70,
      "avgTalkTimeSec": 620,
      "avgQualityScore": 71.5,
      "callsPerAgentPerDay": 39,
      "efficiencyTier": "LOW"
    }
  ],
  "timestamp": "2026-06-21T10:30:00Z"
}
```

### Get ROI Analysis (Ranked)
```bash
curl http://localhost:3000/api/analytics/roi-efficiency/process-roi | jq .
```

**Sample Response**:
```json
{
  "success": true,
  "data": [
    {
      "process": "Sales Outbound - FMCG",
      "lob": "Sales",
      "callVolume": 18500,
      "qualityScorePct": 85.5,
      "totalPayroll90d": 157500,
      "costPerCall": 8.50,
      "productivityIndex": 1185,
      "roiEfficiencyScore": 10.13,
      "efficiencyRank": 1
    },
    {
      "process": "Sales Inbound - Telecom",
      "lob": "Sales",
      "callVolume": 15200,
      "qualityScorePct": 82.0,
      "totalPayroll90d": 135000,
      "costPerCall": 8.88,
      "productivityIndex": 1126,
      "roiEfficiencyScore": 9.23,
      "efficiencyRank": 2
    },
    {
      "process": "Tech Support - Enterprise",
      "lob": "Support",
      "callVolume": 8200,
      "qualityScorePct": 62.0,
      "totalPayroll90d": 95000,
      "costPerCall": 11.59,
      "productivityIndex": 639,
      "roiEfficiencyScore": 3.96,
      "efficiencyRank": 5
    }
  ],
  "timestamp": "2026-06-21T10:30:00Z"
}
```

### Get Top Performers & Improvement Targets
```bash
curl http://localhost:3000/api/analytics/roi-efficiency/performance-categories | jq .
```

**Sample Response**:
```json
{
  "success": true,
  "data": [
    {
      "category": "TOP_PERFORMER",
      "process": "Sales Outbound - FMCG",
      "agents": 45,
      "roiScore": 10.13,
      "costPerCall": 8.50,
      "qualityPct": 85.5,
      "action": "Maintain excellence, document best practices"
    },
    {
      "category": "TOP_PERFORMER",
      "process": "Sales Inbound - Telecom",
      "agents": 38,
      "roiScore": 9.23,
      "costPerCall": 8.88,
      "qualityPct": 82.0,
      "action": "Maintain excellence, document best practices"
    },
    {
      "category": "TOP_PERFORMER",
      "process": "Collections - Auto Finance",
      "agents": 22,
      "roiScore": 8.15,
      "costPerCall": 9.20,
      "qualityPct": 78.5,
      "action": "Maintain excellence, document best practices"
    },
    {
      "category": "TOP_PERFORMER",
      "process": "Quality Assurance - Sales",
      "agents": 12,
      "roiScore": 7.42,
      "costPerCall": 11.50,
      "qualityPct": 92.0,
      "action": "Maintain excellence, document best practices"
    },
    {
      "category": "TOP_PERFORMER",
      "process": "HR Helpdesk - HRIS",
      "agents": 8,
      "roiScore": 6.89,
      "costPerCall": 12.75,
      "qualityPct": 88.0,
      "action": "Maintain excellence, document best practices"
    },
    {
      "category": "IMPROVEMENT_TARGET",
      "process": "Tech Support - Enterprise",
      "agents": 28,
      "roiScore": 3.96,
      "costPerCall": 11.59,
      "qualityPct": 62.0,
      "action": "Intervention: quality training or process re-design"
    },
    {
      "category": "IMPROVEMENT_TARGET",
      "process": "Customer Service - Legacy",
      "agents": 35,
      "roiScore": 3.42,
      "costPerCall": 13.80,
      "qualityPct": 58.5,
      "action": "Intervention: quality training or process re-design"
    },
    {
      "category": "IMPROVEMENT_TARGET",
      "process": "Back Office - Claims",
      "agents": 18,
      "roiScore": 2.71,
      "costPerCall": 16.50,
      "qualityPct": 55.0,
      "action": "Intervention: quality training or process re-design"
    },
    {
      "category": "IMPROVEMENT_TARGET",
      "process": "Tech Support - Onboarding",
      "agents": 12,
      "roiScore": 2.15,
      "costPerCall": 18.90,
      "qualityPct": 50.5,
      "action": "Intervention: quality training or process re-design"
    },
    {
      "category": "IMPROVEMENT_TARGET",
      "process": "Data Entry - Finance",
      "agents": 15,
      "roiScore": 1.84,
      "costPerCall": 21.20,
      "qualityPct": 48.0,
      "action": "Intervention: quality training or process re-design"
    }
  ],
  "timestamp": "2026-06-21T10:30:00Z"
}
```

---

## React Dashboard Component

Quick example to display ROI metrics in React:

```tsx
// frontend/src/components/ROIDashboard.tsx

import React, { useEffect, useState } from 'react';
import axios from 'axios';

interface ProcessROI {
  process: string;
  lob: string;
  callVolume: number;
  qualityScorePct: number;
  costPerCall: number;
  roiEfficiencyScore: number;
  efficiencyRank: number;
}

export const ROIDashboard = () => {
  const [metrics, setMetrics] = useState<ProcessROI[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMetrics();
  }, []);

  const fetchMetrics = async () => {
    try {
      const res = await axios.get(
        '/api/analytics/roi-efficiency/process-roi',
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`
          }
        }
      );
      setMetrics(res.data.data);
    } catch (error) {
      console.error('Failed to fetch ROI metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">Process ROI & Efficiency</h1>
      
      <table className="w-full border-collapse border border-gray-300">
        <thead className="bg-gray-200">
          <tr>
            <th className="border p-2 text-left">Rank</th>
            <th className="border p-2 text-left">Process</th>
            <th className="border p-2 text-left">LOB</th>
            <th className="border p-2 text-right">Calls (90d)</th>
            <th className="border p-2 text-right">Quality %</th>
            <th className="border p-2 text-right">Cost/Call</th>
            <th className="border p-2 text-right">ROI Score</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr
              key={m.process}
              className={
                m.roiEfficiencyScore > 8
                  ? 'bg-green-50'
                  : m.roiEfficiencyScore > 4
                  ? 'bg-yellow-50'
                  : 'bg-red-50'
              }
            >
              <td className="border p-2">{m.efficiencyRank}</td>
              <td className="border p-2 font-medium">{m.process}</td>
              <td className="border p-2">{m.lob}</td>
              <td className="border p-2 text-right">
                {m.callVolume.toLocaleString()}
              </td>
              <td className="border p-2 text-right">
                {m.qualityScorePct.toFixed(1)}%
              </td>
              <td className="border p-2 text-right">
                ${m.costPerCall.toFixed(2)}
              </td>
              <td className="border p-2 text-right font-bold">
                {m.roiEfficiencyScore.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
```

---

## Interpreting the Results

### ROI Score: What It Means

**ROI Score > 8**
- **Status**: Excellent efficiency
- **Action**: Maintain, document best practices, use as benchmark

**ROI Score 4-8**
- **Status**: Good efficiency
- **Action**: Monitor trends, identify optimization opportunities

**ROI Score 2-4**
- **Status**: Moderate efficiency
- **Action**: Targeted improvements needed (training, process redesign)

**ROI Score < 2**
- **Status**: Poor efficiency
- **Action**: Urgent intervention required

### Cost Per Call Analysis

| Cost Per Call | Tier | Interpretation |
|---------------|------|-----------------|
| < $5 | Very High Efficiency | High-volume, commoditized work |
| $5-$10 | High Efficiency | Well-optimized process |
| $10-$20 | Medium Efficiency | Moderate optimization potential |
| $20-$50 | Low Efficiency | High-complexity or low-volume |
| > $50 | Very Low Efficiency | Requires investigation |

### Quality vs. Cost Trade-off

**High Quality + Low Cost = BEST**
- Invest in scaling these processes
- Document and replicate best practices

**High Quality + High Cost = INVESTIGATE**
- Can this be automated/optimized?
- Are you over-investing for the complexity?

**Low Quality + Low Cost = IMPROVE**
- Invest in training/tools
- Quality shortfalls will hurt retention/client satisfaction

**Low Quality + High Cost = URGENT**
- Root cause analysis required
- Consider process redesign or staffing change

---

## Using the Data for Decisions

### Staffing Optimization
```
IF Calls Per Agent > [LOB Average] AND Quality >= [Target]
THEN Consider recruiting/training more for this process
ELSE Consider consolidation or process automation
```

### Cost Allocation (for client billing)
```
Client Cost = (Process Call Volume × Cost Per Call) × Markup
Example: 1000 calls × $9.50 × 1.25 = $11,875
```

### ROI Improvement Initiatives
```
For each IMPROVEMENT_TARGET process:
1. Calculate current ROI: [baseline]
2. Set target improvement: +0.5 points
3. Estimate impact of intervention (training, tools, etc.)
4. Prioritize by improvement potential × cost
```

---

## Common Questions

**Q: Why is my ROI score NULL?**  
A: Missing data in integration_call_daily or salary_prep_line. Verify:
```sql
SELECT process_name, MAX(activity_date) FROM integration_call_daily
GROUP BY process_name;
```

**Q: How often is data updated?**  
A: The analysis uses current data (90-day rolling window). Data freshness depends on:
- integration_call_daily: Updated daily from dialer
- salary_prep_line: Updated monthly after payroll run
- kpi_daily_actual: Updated daily (depends on audit scheduling)

**Q: Can I compare to last month?**  
A: Currently, the analysis is point-in-time. For trending, we recommend exporting results monthly and comparing externally (Phase 2 enhancement would add trending).

**Q: Why do some processes show default quality=75?**  
A: If kpi_daily_actual is not populated for QUALITY_SCORE metric, the service uses 75 as a conservative default. Populate quality audit data to get accurate scores.

**Q: How do I export this to Excel?**  
A: Copy the JSON response and paste into a spreadsheet, or use:
```bash
curl http://localhost:3000/api/analytics/roi-efficiency/process-matrix | \
  jq -r '.data | .[0] | keys | @csv' > metrics.csv && \
  jq -r '.data | .[] | [.process, .lob, .callVolume, .costPerCall, .roiIndex] | @csv' >> metrics.csv
```

---

## Support

**Module Owner**: CFO/Business Analyst  
**Technical Contact**: Backend Team  
**Documentation**: `/docs/roi-efficiency-analysis.md`  
**Technical Spec**: `/docs/roi-efficiency-technical-spec.md`  
**Source Code**: `/backend/src/services/roi-efficiency.service.ts`  
**SQL Queries**: `/backend/scripts/roi-efficiency-analysis.sql`

---

**Last Updated**: 2026-06-21  
**Status**: Ready to Deploy
