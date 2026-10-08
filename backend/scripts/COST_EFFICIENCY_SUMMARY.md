# Cost Efficiency Analysis — Summary & Quick Reference

## Executive Summary

Query system for analyzing cost-per-quality-point efficiency across agents and processes using `mas_hrms.salary_prep_line` + `db_audit.call_quality_assessment`.

**Key Finding:** Costs are driven by both salary level AND quality achieved. This analysis identifies where rupees are misspent and where ROI is optimal.

---

## Files Generated

| File | Purpose |
|------|---------|
| `cost-efficiency-analysis.sql` | Raw SQL queries (5 main analyses) |
| `costEfficiency.service.ts` | TypeScript service class (database access layer) |
| `costEfficiency.routes.ts` | REST API endpoints for dashboard |
| `COST_EFFICIENCY_GUIDE.md` | Detailed interpretation guide |
| This file | Quick reference & implementation checklist |

---

## Quick Query Reference

### Query 1: Agent-Level Cost Efficiency (50 agents)
**Purpose:** ROI ranking by agent
**Output:** Agent code, salary, calls handled, quality %, cost/call, cost/quality-point, efficiency rating

```sql
SELECT employee_code, agent_name, monthly_salary, calls_handled_30d,
       avg_quality_pct, cost_per_call, cost_per_quality_point,
       efficiency_rating
FROM (Query 1)
ORDER BY cost_per_quality_point ASC
LIMIT 50;
```

**Action:** Focus on LOW_ROI and MEDIUM_ROI agents for coaching/intervention

---

### Query 2: Process-Level ROI (top 30 processes)
**Purpose:** Which process delivers best quality per rupee
**Output:** Process name, call volume, agents, avg quality, total payroll, ROI classification

```sql
SELECT process_name, total_calls_30d, agent_count, avg_process_quality,
       total_process_payroll, cost_per_call, cost_per_quality_point,
       roi_classification
FROM (Query 2)
ORDER BY cost_per_quality_point ASC
LIMIT 30;
```

**Action:** Scale PREMIUM_ROI processes; optimize POOR_ROI processes

---

### Query 3: Top 20 Savings Opportunities
**Purpose:** Immediate cost reduction targets
**Output:** Agent, salary, quality, potential monthly savings, recommended action

```sql
SELECT efficiency_rank, agent_name, monthly_salary, quality_score,
       potential_monthly_savings, intervention_priority,
       recommended_action
FROM (Query 3)
ORDER BY potential_monthly_savings DESC
LIMIT 20;
```

**Example Output:**
```
RANK | AGENT  | SALARY | QUALITY | MONTHLY_SAVINGS | ACTION
1    | Bob    | ₹28k   | 55%     | ₹8,400          | Reskill or replace
2    | Carol  | ₹25k   | 62%     | ₹3,750          | Coaching
3    | Dave   | ₹22k   | 68%     | ₹2,200          | Performance plan
─────────────────────────────────────────────────────────────────
     TOTAL   |        |         | ₹45,000/month   | ₹540k/year
```

**Action:** Start with Rank 1-3; allocate coaching/reskilling budget; expect 30-50% recovery rate

---

### Query 4: Salary-Quality Correlation (4 quartiles)
**Purpose:** Validate that salary ladder correlates with quality outcome

```sql
SELECT salary_bracket, salary_min, salary_max, agent_count,
       avg_quality_in_bracket, excellence_pct, underperforming_pct
FROM (Query 4)
ORDER BY salary_bracket ASC;
```

**Expected Pattern (healthy):**
| Quartile | Salary | Agents | Avg Quality | Excellence % |
|----------|--------|--------|-------------|--------------|
| Q1 | ₹18-22k | 40 | 72% | 10% |
| Q2 | ₹23-26k | 42 | 78% | 20% |
| Q3 | ₹27-30k | 38 | 82% | 35% |
| Q4 | ₹31-45k | 35 | 85% | 50% |

**Red Flags:**
- Inverted: Q4 worse than Q1 → Overpaid seniors or weak juniors
- Flat: All quartiles similar quality → Salary compression issue
- High Q4 variance: Senior inconsistency → Leadership gap

---

### Query 5: Annual Forecast
**Purpose:** Project year-end ROI and model health

```sql
SELECT active_agents, annual_payroll_at_current_rate,
       projected_annual_calls, avg_quality_maintained,
       projected_annual_cost_per_call,
       projected_annual_cost_per_quality_point,
       model_health
FROM (Query 5);
```

**Example:**
```
Active Agents: 180
Annual Payroll: ₹54,000,000
Projected Annual Calls: 900,000
Avg Quality: 76%
Annual Cost per Call: ₹60
Model Health: Acceptable Model - Optimize Recommended

→ Target: Improve quality to 82% without adding staff = ₹540k savings/year
```

---

## REST API Endpoints

### Base URL
```
http://localhost:5000/api/admin/cost-efficiency
```

### Authentication
Requires role: `super_admin`, `hr_admin`, or `finance_admin`

### Endpoints

#### 1. GET /agents
Agent-level cost efficiency (top 50)
```bash
curl "http://localhost:5000/api/admin/cost-efficiency/agents?daysBack=30&limit=50"
```

Response:
```json
{
  "success": true,
  "meta": {
    "daysBack": 30,
    "limit": 50,
    "count": 45,
    "timestamp": "2026-06-21T10:30:00Z"
  },
  "data": [
    {
      "employee_code": "EMP001",
      "agent_name": "Alice Kumar",
      "monthly_salary": 26000,
      "calls_handled_30d": 180,
      "avg_quality_pct": 88.5,
      "cost_per_call": 144.44,
      "cost_per_quality_point": 163.40,
      "efficiency_rating": "HIGH_ROI",
      "tenure_months": 18
    },
    ...
  ]
}
```

#### 2. GET /processes
Process-level ROI analysis
```bash
curl "http://localhost:5000/api/admin/cost-efficiency/processes?daysBack=30&limit=30"
```

#### 3. GET /opportunities
Top N savings opportunities
```bash
curl "http://localhost:5000/api/admin/cost-efficiency/opportunities?daysBack=30&topN=20"
```

Response:
```json
{
  "success": true,
  "meta": {
    "daysBack": 30,
    "topN": 20,
    "count": 15,
    "totalMonthlySavings": 45000,
    "totalAnnualSavings": 540000
  },
  "data": [...]
}
```

#### 4. GET /salary-quality
Salary vs quality correlation
```bash
curl "http://localhost:5000/api/admin/cost-efficiency/salary-quality?daysBack=30"
```

#### 5. GET /forecast
Annual cost forecast
```bash
curl "http://localhost:5000/api/admin/cost-efficiency/forecast?daysBack=30"
```

#### 6. GET /dashboard
Complete dashboard (all metrics in one call)
```bash
curl "http://localhost:5000/api/admin/cost-efficiency/dashboard?daysBack=30"
```

Response:
```json
{
  "success": true,
  "data": {
    "summary": {
      "total_active_agents": 180,
      "high_roi_agents": 45,
      "low_roi_agents": 28,
      "premium_roi_processes": 3,
      "total_monthly_savings_opportunity": 45000
    },
    "agentMetrics": [...],
    "processROI": [...],
    "opportunities": [...],
    "salaryQualityCorrelation": [...],
    "annualForecast": {...}
  }
}
```

#### 7. GET /export/:report
Export data as CSV
```bash
# Export agent data as CSV
curl "http://localhost:5000/api/admin/cost-efficiency/export/agents?daysBack=30" \
  > agent-cost-efficiency.csv

# Export opportunities as CSV
curl "http://localhost:5000/api/admin/cost-efficiency/export/opportunities?daysBack=30" \
  > opportunities.csv
```

---

## Implementation Checklist

### Phase 1: Setup (Day 1)
- [ ] Copy `cost-efficiency-analysis.sql` to `backend/scripts/`
- [ ] Copy `costEfficiency.service.ts` to `backend/src/modules/admin/`
- [ ] Copy `costEfficiency.routes.ts` to `backend/src/modules/admin/`
- [ ] Verify `mas_hrms` database connectivity
- [ ] Verify `db_audit.call_quality_assessment` table has data

### Phase 2: API Integration (Day 2)
- [ ] Register routes in Express app (import costEfficiency.routes)
- [ ] Add route: `app.use('/api/admin/cost-efficiency', costEfficiencyRouter);`
- [ ] Test endpoints locally: `/api/admin/cost-efficiency/dashboard`
- [ ] Verify role-based access control works

### Phase 3: Data Validation (Day 3)
- [ ] Query 1: Compare manual agent selection vs top 10 HIGH_ROI agents
- [ ] Query 2: Benchmark PREMIUM_ROI process against known best performers
- [ ] Query 3: Validate potential_monthly_savings calculations (spot-check 3 agents)
- [ ] Query 4: Confirm salary quartile distribution matches payroll data

### Phase 4: Dashboard Build (Days 4-5)
- [ ] Create frontend component: `CostEfficiencyDashboard.tsx`
- [ ] Add charts:
  - Cost/quality scatter by agent (X: cost_per_call, Y: avg_quality_pct)
  - Process ROI bar chart (PREMIUM/GOOD/ACCEPTABLE/POOR)
  - Savings opportunity bar chart (top 20 agents)
  - Salary-quality correlation line chart
- [ ] Add filters: date range, process, efficiency rating
- [ ] Add CSV export button
- [ ] Deploy to Vercel

### Phase 5: Monitoring & Alerts (Week 2)
- [ ] Set up weekly email with top 10 opportunities
- [ ] Create alert if cost_per_quality_point increases >10%
- [ ] Set up dashboard refresh every 4 hours
- [ ] Log all dashboard views for audit

### Phase 6: Operationalization (Week 3+)
- [ ] Weekly management report (top 5 actions)
- [ ] Monthly review with HR & Finance leads
- [ ] Quarterly strategy session using Query 5 forecast
- [ ] Annual rebalance of salary bands based on efficiency trends

---

## Metrics Glossary

| Term | Definition | Formula | Unit | Benchmark |
|------|-----------|---------|------|-----------|
| **cost_per_call** | Monthly salary ÷ calls handled in month | ₹ / call | Varies by process | <₹200 ideal |
| **cost_per_quality_point** | Monthly salary ÷ avg quality % | ₹ / % | Varies by process | <₹400 ideal |
| **efficiency_rating** | Classification of ROI | Based on quality % | Categorical | HIGH_ROI = ≥85% quality |
| **potential_monthly_savings** | Estimated cost reduction if issue fixed | Salary × adjustment % | ₹ / month | Sum = opportunity |
| **tenure_months** | Months since employee joined | (Today - DOJ) / 30 | Months | Correlates with quality |
| **quality_consistency** | Standard deviation of quality scores | STDDEV(quality %) | % | Lower = more predictable |
| **roi_classification** | Process-level efficiency category | Based on cost + quality | Categorical | PREMIUM_ROI prioritized |

---

## Troubleshooting

### Issue: No call_quality_assessment data
**Cause:** `db_audit` database not configured or call quality audit system not active
**Fix:** 
1. Check if `db_audit.call_quality_assessment` exists: `SHOW TABLES IN db_audit;`
2. If not, check Shivamgiri integration setup
3. Fallback: Run query with only salary_prep_line (Query 1 will show "NO_CALL_DATA")

### Issue: Salary data is NULL
**Cause:** Current month's payroll not yet processed
**Fix:**
1. Check `salary_prep_line.status = 'processed'` for current month
2. Run query for previous month: `WHERE spl.month = MONTH(NOW()) - 1`
3. Use 90-day rolling average if no current month data

### Issue: Query times out
**Cause:** Large dataset or missing indexes
**Fix:**
1. Add index: `CREATE INDEX idx_cqa_calldate_user ON call_quality_assessment(CallDate, User);`
2. Reduce `daysBack` to 30 (default)
3. Increase database query timeout: `SET GLOBAL max_execution_time = 300000;`

### Issue: Some agents have "NO_CALL_DATA"
**Cause:** No calls recorded for agent in period
**Status:** Expected for new hires or specialized roles
**Action:** Exclude from analysis or set manual quality baseline

---

## Next Steps

1. **Immediate (This Week):**
   - Set up API endpoints and test in sandbox
   - Validate top 5 savings opportunities with managers
   - Start coaching for top 3 CRITICAL priority agents

2. **Short-term (This Month):**
   - Build live dashboard
   - Implement weekly alerts
   - Conduct process benchmarking sessions

3. **Medium-term (This Quarter):**
   - Establish cost efficiency KPI for each process
   - Implement salary-quality correlation policy
   - Launch performance improvement plans for bottom 20%

4. **Long-term (Annual):**
   - Rebalance salary bands based on efficiency trends
   - Scale PREMIUM_ROI processes
   - Reduce headcount in POOR_ROI areas (with redeployment)

---

**Last Updated:** 2026-06-21
**Author:** Claude Code
**Contact:** For questions, refer to COST_EFFICIENCY_GUIDE.md or consult SQL comments in cost-efficiency-analysis.sql
