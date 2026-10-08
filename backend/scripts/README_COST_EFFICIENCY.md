# Cost Efficiency Analysis System

## Overview

A comprehensive cost efficiency analysis system for MAS Callnet HRMS that correlates payroll (`salary_prep_line`) with call quality metrics (`call_quality_assessment`) to identify cost optimization opportunities and measure ROI by agent and process.

**Objective:** Answer the question: "Are we spending money efficiently on call center operations?"

**Key Metrics:**
- Cost per call (₹/call)
- Cost per quality point (₹/%)
- Cost efficiency rating (HIGH_ROI, GOOD_ROI, MEDIUM_ROI, LOW_ROI)
- Process-level ROI classification (PREMIUM_ROI, GOOD_ROI, ACCEPTABLE_ROI, POOR_ROI)
- Potential monthly savings by agent/process

---

## Files in This Package

### SQL Queries
- **`cost-efficiency-analysis.sql`** — 5 core SQL queries + 1 validation query
  - Query 1: Agent-level cost efficiency (50 agents, ranked by ROI)
  - Query 2: Process-level ROI analysis (top 30 processes)
  - Query 3: Top 20 savings opportunities (ranked by potential savings)
  - Query 4: Salary-quality correlation analysis (4 salary quartiles)
  - Query 5: Annual cost forecast & model health assessment

### TypeScript Backend
- **`costEfficiency.service.ts`** — Core service class with 6 methods:
  - `getAgentCostEfficiency()` — Query 1 wrapper
  - `getProcessROI()` — Query 2 wrapper
  - `getSavingsOpportunities()` — Query 3 wrapper
  - `getSalaryQualityCorrelation()` — Query 4 wrapper
  - `getAnnualForecast()` — Query 5 wrapper
  - `getDashboard()` — All 5 in one call (parallel execution)

- **`costEfficiency.routes.ts`** — REST API endpoints
  - `GET /api/admin/cost-efficiency/agents`
  - `GET /api/admin/cost-efficiency/processes`
  - `GET /api/admin/cost-efficiency/opportunities`
  - `GET /api/admin/cost-efficiency/salary-quality`
  - `GET /api/admin/cost-efficiency/forecast`
  - `GET /api/admin/cost-efficiency/dashboard`
  - `GET /api/admin/cost-efficiency/export/:report` (CSV export)

### Documentation
- **`COST_EFFICIENCY_GUIDE.md`** — Detailed interpretation guide (5 pages)
  - Query-by-query explanation
  - How to interpret results
  - Action items by rating
  - Implementation roadmap
  - Database schema reference
  - Troubleshooting guide

- **`EXAMPLE_OUTPUTS.md`** — Real-world examples (7 pages)
  - Sample output for each query
  - Interpretation walkthrough
  - Scenario analysis (healthy vs. problematic patterns)
  - Annual forecast scenarios (A/B/C)
  - Decision framework
  - Excel/dashboard visualization tips

- **`COST_EFFICIENCY_SUMMARY.md`** — Quick reference (3 pages)
  - Quick query reference
  - REST API usage examples
  - Implementation checklist
  - Metrics glossary
  - Common issues & fixes

- **This file** — Overview & setup guide

---

## Quick Start (5 minutes)

### Option 1: Direct SQL Execution
```bash
# From command line
mysql -h localhost -u root -p mas_hrms < backend/scripts/cost-efficiency-analysis.sql

# Output: Tab-separated results for each query
# Import into Excel/Tableau for analysis
```

### Option 2: Backend API (Recommended)
```bash
# 1. Copy files to backend
cp backend/scripts/costEfficiency.service.ts backend/src/modules/admin/
cp backend/scripts/costEfficiency.routes.ts backend/src/modules/admin/

# 2. Register routes in App.tsx
import costEfficiencyRouter from './modules/admin/costEfficiency.routes';
app.use('/api/admin/cost-efficiency', costEfficiencyRouter);

# 3. Test endpoint
curl "http://localhost:5000/api/admin/cost-efficiency/dashboard?daysBack=30"

# Output: JSON with all 5 queries + summary metrics
```

### Option 3: Scheduled Reports
```bash
# Add to cron for weekly Monday morning reports
0 6 * * MON /usr/bin/mysql -h localhost -u root -p mas_hrms < \
  backend/scripts/cost-efficiency-analysis.sql > \
  /var/reports/cost-efficiency-$(date +\%Y\%m\%d).csv
```

---

## Usage Examples

### API Call 1: Get Top ROI Agents
```bash
curl "http://localhost:5000/api/admin/cost-efficiency/agents?daysBack=30&limit=50"
```
**Use:** Identify HIGH_ROI and LOW_ROI performers for targeted action

### API Call 2: Get Process ROI Rankings
```bash
curl "http://localhost:5000/api/admin/cost-efficiency/processes?daysBack=30&limit=30"
```
**Use:** Determine which process delivers best ROI; prioritize optimization efforts

### API Call 3: Get Savings Opportunities
```bash
curl "http://localhost:5000/api/admin/cost-efficiency/opportunities?daysBack=30&topN=20"
```
**Use:** Identify top 20 agents for immediate coaching/intervention; calculate total opportunity

### API Call 4: Get Annual Forecast
```bash
curl "http://localhost:5000/api/admin/cost-efficiency/forecast?daysBack=30"
```
**Use:** Assess model health; determine if business is sustainable or at-risk

### API Call 5: Get Everything (Dashboard)
```bash
curl "http://localhost:5000/api/admin/cost-efficiency/dashboard?daysBack=30"
```
**Use:** Complete operational dashboard; all metrics in one call

### API Call 6: Export to CSV
```bash
curl "http://localhost:5000/api/admin/cost-efficiency/export/agents?daysBack=30" \
  > agent-cost-efficiency.csv
```
**Use:** Import into Excel for further analysis; share with management

---

## Key Concepts

### Cost per Quality Point (₹/%)
The primary ROI metric. Divide agent salary by average quality percentage achieved.

**Example:**
- Agent salary: ₹26,000/month
- Quality: 85%
- Cost per quality point: ₹26,000 ÷ 85 = **₹305.88**

**Interpretation:**
- Lower = better ROI
- Benchmark: <₹400 is ideal
- >₹500 = problem case requiring intervention

### Efficiency Rating
Classification based on quality percentage achieved:

| Rating | Quality Range | Action |
|--------|---------------|--------|
| HIGH_ROI | ≥85% | Mentor others; reward |
| GOOD_ROI | 75-84% | Maintain; routine monitoring |
| MEDIUM_ROI | 65-74% | Coaching needed; 30-day review |
| LOW_ROI | <65% | Urgent intervention; probation |

### Process ROI Classification
Similar to agent ratings but at process level:

| Classification | Quality Range | Implication |
|---|---|---|
| PREMIUM_ROI | ≥80% quality, <₹80/call cost | Scale this process |
| GOOD_ROI | ≥75% quality | Use as benchmark |
| ACCEPTABLE_ROI | ≥65% quality | Needs optimization |
| POOR_ROI | <65% quality | Urgent deep-dive required |

---

## Data Sources

### Required Tables

**1. mas_hrms.employees**
```sql
SELECT id, employee_code, first_name, last_name, 
       date_of_joining, employment_status, active_status,
       reporting_manager_id
FROM employees;
```

**2. mas_hrms.salary_prep_line**
```sql
SELECT id, employee_id, month, year, gross_salary, status
FROM salary_prep_line
WHERE status = 'processed' 
  AND month = MONTH(NOW()) 
  AND year = YEAR(NOW());
```

**3. db_audit.call_quality_assessment** (from Shivamgiri/Call Master)
```sql
SELECT id, User (employee_code), Campaign (process name),
       CallDate, quality_percentage
FROM call_quality_assessment
WHERE CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY);
```

### Data Integration Points

| System | Table | Field | Purpose |
|--------|-------|-------|---------|
| HRMS | employees | employee_code | Join key |
| HRMS | salary_prep_line | gross_salary | Cost metric |
| Call Master/Dialer | call_quality_assessment | quality_percentage | Quality metric |
| Call Master/Dialer | call_quality_assessment | Campaign | Process grouping |

---

## Implementation Roadmap

### Week 1: Setup & Validation
- [ ] Copy SQL file to `backend/scripts/`
- [ ] Test queries locally; validate data completeness
- [ ] Spot-check results against known agents
- [ ] Document data freshness & lag

### Week 2: Backend Integration
- [ ] Copy TypeScript files to `backend/src/modules/admin/`
- [ ] Register routes in Express app
- [ ] Test API endpoints; verify permissions
- [ ] Set up logging & error handling

### Week 3: Frontend Dashboard
- [ ] Build React dashboard component
- [ ] Add charts (scatter, bar, waterfall)
- [ ] Add filters (date, process, rating)
- [ ] Add CSV export button
- [ ] Deploy to Vercel

### Week 4: Operationalization
- [ ] Set up weekly automated email report
- [ ] Create alerts for High_ROI agents (poach prevention) and Low_ROI agents (coaching trigger)
- [ ] Brief management on dashboard
- [ ] Start 1:1 coaching interventions for top 10 opportunities

### Week 5+: Continuous Improvement
- [ ] Monitor cost_per_quality_point trend over 4-week baseline
- [ ] Quarterly business review with forecast scenarios
- [ ] Annual salary band rebalancing based on efficiency

---

## Sample Metrics Dashboard (Desired Output)

```
EXECUTIVE SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Active Agents: 180
Total Payroll (monthly): ₹54,000,000
Total Payroll (annual): ₹648,000,000
Call Volume (30d): 900,000 calls
Average Quality: 76.3%

KEY METRICS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Cost per Call: ₹60
Cost per Quality Point: ₹78.63
Model Health: Acceptable Model - Optimize Recommended

AGENT PERFORMANCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
High ROI Agents: 45 (25%)
Good ROI Agents: 82 (46%)
Medium ROI Agents: 34 (19%)
Low ROI Agents: 19 (11%) ← Focus here

PROCESS PERFORMANCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Premium ROI Processes: 3
Good ROI Processes: 4
Acceptable ROI Processes: 6
Poor ROI Processes: 2 ← Urgent action

OPPORTUNITIES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Monthly Savings Potential: ₹32,775
Annual Savings Potential: ₹393,300
Investment Required: ₹15,000 (coaching)
Expected ROI: 26:1
```

---

## Security & Permissions

### Required Role
Endpoint: `requireRole(['super_admin', 'hr_admin', 'finance_admin'])`

Only users with HR Admin or Finance Admin role can access cost efficiency data.

### Data Classification
- Cost efficiency metrics: **CONFIDENTIAL**
- Agent salaries: **RESTRICTED** (do not export to unconfidential reports)
- Process-level only: **SHAREABLE** (safe for client portal visibility if anonymized)

---

## Troubleshooting

### Issue: Query returns no data
**Check:**
1. Does `salary_prep_line` have processed records for current month?
2. Does `call_quality_assessment` have records for last 30 days?
3. Are employee_code fields matching between tables?

**Fix:** Run data validation query in `cost-efficiency-analysis.sql` (Query 6)

### Issue: Timeout on large dataset
**Fix:** Add indexes
```sql
CREATE INDEX idx_cqa_calldate_user ON call_quality_assessment(CallDate, User);
CREATE INDEX idx_spl_employee_month ON salary_prep_line(employee_id, month, year);
```

### Issue: Some agents show NULL salary
**Cause:** Current month payroll not yet processed
**Fix:** Use previous month or 90-day rolling average

---

## Next Steps

1. **Read:** COST_EFFICIENCY_GUIDE.md (detailed interpretation)
2. **Review:** EXAMPLE_OUTPUTS.md (realistic scenarios)
3. **Setup:** Copy files to backend; run first query
4. **Validate:** Compare top 5 agents with actual performance data
5. **Implement:** Register REST API; build dashboard
6. **Operate:** Weekly review; monthly deep-dives; quarterly forecasts

---

## Support & Questions

| Topic | Reference |
|-------|-----------|
| Query interpretation | COST_EFFICIENCY_GUIDE.md § Query X |
| Example scenarios | EXAMPLE_OUTPUTS.md § Scenario Y |
| API usage | costEfficiency.routes.ts comments |
| SQL details | cost-efficiency-analysis.sql line comments |
| Implementation | COST_EFFICIENCY_SUMMARY.md § Implementation Checklist |
| Troubleshooting | COST_EFFICIENCY_GUIDE.md § Troubleshooting |

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-06-21 | Initial release: 5 queries, service, routes, docs |

---

**Last Updated:** 2026-06-21  
**Maintainer:** Claude Code  
**Status:** Production Ready
