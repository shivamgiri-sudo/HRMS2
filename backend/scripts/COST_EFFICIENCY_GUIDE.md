# Cost Efficiency Analysis Guide

## Overview
This guide explains how to use the cost-efficiency analysis queries to identify cost optimization opportunities, track ROI by agent and process, and make data-driven decisions about payroll allocation.

**Database:** `mas_hrms` (with optional `db_audit.call_quality_assessment`)
**Data Source:** `salary_prep_line` (payroll) + `call_quality_assessment` (quality metrics)
**Timeframe:** Last 30-90 days (configurable in WHERE clauses)

---

## Query 1: Agent-Level Cost Efficiency

### Purpose
Calculate cost per call, cost per quality point, and ROI for each active agent.

### Key Metrics
| Metric | Formula | Interpretation |
|--------|---------|-----------------|
| **cost_per_call** | Monthly Salary / Calls Handled (30d) | How much each call costs to deliver |
| **cost_per_quality_point** | Monthly Salary / Avg Quality % | ROI metric—lower = better value |
| **efficiency_rating** | Based on avg_quality_pct | HIGH_ROI (≥85%), GOOD_ROI (≥75%), etc. |

### How to Use
1. **Sort by cost_per_quality_point ASC** → Agents delivering best value first
2. **Filter by efficiency_rating = 'LOW_ROI'** → Identify underperfomers
3. **Compare tenure_months** → Is tenure correlating with quality/cost?

### Example Output Interpretation
```
Agent: John (EMP123)
Monthly Salary: ₹25,000
Calls Handled (30d): 150
Avg Quality: 78%
Cost per Call: ₹166.67
Cost per Quality Point: ₹320.51
Efficiency Rating: GOOD_ROI
Tenure: 12 months

→ John delivers 150 calls/month at ₹166.67 each.
  Each quality point costs ₹320.51 to achieve.
  With 12-month tenure, this is acceptable performance.
```

### Actions
- **HIGH_ROI agents:** Potential mentors; consider for team lead roles
- **GOOD_ROI agents:** Maintain; monitor for improvement opportunities
- **MEDIUM_ROI agents:** Targeted coaching; review workload
- **LOW_ROI agents:** Performance improvement plan or reskilling

---

## Query 2: Process/Campaign-Level ROI Analysis

### Purpose
Determine which process/campaign delivers the best quality per rupee spent.

### Key Metrics
| Metric | Interpretation |
|--------|-----------------|
| **avg_process_quality** | Baseline quality for this process |
| **quality_consistency** | STDDEV—lower = more predictable outcomes |
| **cost_per_call** | Process-wide cost per call |
| **roi_classification** | PREMIUM_ROI, GOOD_ROI, ACCEPTABLE_ROI, POOR_ROI |

### How to Use
1. **Rank by ROI classification** → PREMIUM_ROI processes are underpriced for quality delivered
2. **Compare cost_per_call across processes** → Identify cost drivers (staffing, complexity, complexity)
3. **Review quality_consistency** → High STDDEV = inconsistent process; low = stable, predictable

### Example Output
```
Process: Customer Service
Total Calls (30d): 5,000
Agents: 45
Avg Quality: 82%
Total Payroll: ₹1,125,000
Cost per Call: ₹225
Cost per Quality Point: ₹274.39
ROI Classification: GOOD_ROI

Process: Tech Support
Total Calls (30d): 2,000
Agents: 25
Avg Quality: 74%
Total Payroll: ₹625,000
Cost per Call: ₹312.50
Cost per Quality Point: ₹422.30
ROI Classification: ACCEPTABLE_ROI

→ Customer Service is more cost-efficient. Consider shifting complex calls to it.
```

### Actions
- **PREMIUM_ROI:** Benchmark process; investigate success factors; consider scaling
- **GOOD_ROI:** Maintain; use as model for improvement of other processes
- **ACCEPTABLE_ROI:** Identify bottlenecks; implement training programs
- **POOR_ROI:** Deep-dive investigation; assess if low quality or overstaffing is the cause

---

## Query 3: Cost Efficiency Opportunities (Top 20 Savings)

### Purpose
Identify high-impact opportunities for cost reduction or quality improvement.

### Key Metrics
| Metric | Interpretation |
|--------|-----------------|
| **efficiency_rank** | Ranked from worst ROI (1) to best |
| **intervention_priority** | CRITICAL (< 60%), HIGH (< 70%), MEDIUM (< 75%), LOW |
| **potential_monthly_savings** | Estimated monthly reduction if issue resolved |
| **recommended_action** | Reskill, coaching, performance plan, or monitor |

### Example Output
```
Rank | Agent | Salary | Quality | Monthly Savings | Action
1    | Bob   | ₹28k   | 55%     | ₹8,400          | Reskill or replace
2    | Carol | ₹25k   | 62%     | ₹3,750          | Targeted coaching
3    | Dave  | ₹22k   | 68%     | ₹2,200          | Performance plan
```

### How to Interpret
- **CRITICAL Priority agents cost ~30% of salary in lost productivity** → Immediate action needed
- **HIGH Priority agents cost ~15% of salary** → Coaching + monitoring
- **MEDIUM Priority agents cost ~10% of salary** → Structured improvement plan

### Total Opportunity
Sum of "potential_monthly_savings" = **estimated monthly cost reduction possible**

**Example:** Top 20 opportunities total ₹45,000/month = ₹540,000 annually

### Actions
1. **Reskill or Replace (CRITICAL):** Failed onboarding; assess fit; exit if persists
2. **Targeted Coaching (HIGH):** Pair with mentor; weekly check-ins; 4-week review
3. **Performance Plan (MEDIUM):** Document expectations; daily feedback; 30-day review
4. **Monitor (LOW):** Routine management; flagged for next quarterly review

---

## Query 4: Salary-Quality Correlation Analysis

### Purpose
Determine if higher salaries correlate with better quality (should be linear).

### Expected Pattern
- **Q1 (Lowest 25%):** New/junior agents; variable quality (high STDDEV)
- **Q2-Q3 (Mid 50%):** Maturing agents; improving quality
- **Q4 (Highest 25%):** Senior agents; consistently high quality

### Red Flag Patterns
- **Inverted correlation:** Q4 agents have worse quality than Q1 → Overpaid seniors or weak juniors
- **High Q4 STDDEV:** Senior agents are inconsistent → Leadership/mentoring gaps
- **All quartiles similar quality:** Salary not aligned with performance → Compression

### Example Output
```
Quartile | Salary Range | Agent Count | Avg Quality | Underperforming %
Q1       | ₹18k-₹22k   | 40          | 72%         | 20%
Q2       | ₹23k-₹26k   | 42          | 78%         | 12%
Q3       | ₹27k-₹30k   | 38          | 82%         | 8%
Q4       | ₹31k-₹45k   | 35          | 85%         | 5%

→ Clean positive correlation. Salary ladder is working as intended.
```

### Actions
- **If inverted:** Audit senior agent performance; potential reorganization
- **If flat:** Compress salary bands; tie increases to quality achievement
- **If steep:** Leverage Q4 as mentors; create Q3→Q4 pathway

---

## Query 5: Annual Cost Efficiency Forecast

### Purpose
Project annual ROI and operational sustainability at current staffing and quality levels.

### Key Output
| Field | Meaning |
|-------|---------|
| **annual_payroll_at_current_rate** | ₹ spent on salaries annually |
| **projected_annual_calls** | Expected call volume if trend continues |
| **projected_annual_cost_per_quality_point** | Annual cost metric for benchmarking |
| **model_health** | Sustainable, Acceptable, or At-Risk |

### Example
```
Active Agents: 180
Annual Payroll: ₹54,000,000
Projected Annual Calls: 900,000
Avg Quality: 76%
Annual Cost per Call: ₹60
Annual Cost per Quality Point: ₹78.95
Model Health: Acceptable Model - Optimize Recommended

→ With 180 agents handling 5,000 calls/day at 76% quality,
  we're spending ₹54M annually.
  Opportunity: Improve quality to 82% without adding staff = ₹540k savings/year.
```

### Actions by Model Health
- **Sustainable (≥80% quality):** Continue; consider scaling; invest in growth
- **Acceptable (70-79% quality):** Optimize processes; coach bottom 20%; review staffing
- **At-Risk (<70% quality):** Urgent intervention; assess hiring quality; implement rapid reskilling

---

## Running the Queries

### Option 1: Direct MySQL Execution (Recommended for Exploration)
```bash
mysql -h localhost -u root -p mas_hrms < cost-efficiency-analysis.sql
```

### Option 2: Export to CSV for Analysis
```bash
mysql -h localhost -u root -p mas_hrms < cost-efficiency-analysis.sql > cost-efficiency-results.csv
# Import into Excel/Tableau for visualization
```

### Option 3: Schedule as Periodic Reporting (Every Monday)
```sql
-- Add to your cron/scheduler
0 6 * * MON /usr/bin/mysql -h localhost -u root -p mas_hrms < cost-efficiency-analysis.sql > /var/reports/cost-efficiency-$(date +\%Y\%m\%d).csv
```

### Option 4: Integrate into Backend Dashboard
```typescript
// backend/src/modules/admin/costEfficiency.service.ts
const results = await db.query('SELECT * FROM (/* Query 1-5 as views */)');
res.json(results);
```

---

## Implementation Steps

### Week 1: Data Validation
- [ ] Run Query 6 (all analyses) on 30-day data
- [ ] Compare results with known agents (mentor/underperformer validation)
- [ ] Verify salary_prep_line and call_quality_assessment data completeness

### Week 2: Agent Benchmarking
- [ ] Run Query 1 and identify Q1 savings opportunities
- [ ] Validate with managers; confirm intervention priorities
- [ ] Initiate coaching/reskilling for top 10 CRITICAL priority agents

### Week 3: Process Optimization
- [ ] Run Query 2 and identify PREMIUM_ROI processes
- [ ] Benchmark POOR_ROI processes against GOOD_ROI
- [ ] Document best practices from PREMIUM_ROI process

### Week 4: Portfolio Review
- [ ] Run Query 5; assess annual forecast
- [ ] Present dashboard to leadership
- [ ] Plan next quarter's cost optimization initiatives

### Ongoing (Monthly)
- [ ] Re-run all queries on rolling 30-day window
- [ ] Track cost_per_quality_point trend
- [ ] Monitor potential_monthly_savings realization

---

## Database Tables Reference

### salary_prep_line
```sql
CREATE TABLE salary_prep_line (
  id INT PRIMARY KEY AUTO_INCREMENT,
  employee_id INT NOT NULL,
  run_id INT NOT NULL,
  month INT,
  year INT,
  gross_salary DECIMAL(12,2),
  basic DECIMAL(12,2),
  hra DECIMAL(12,2),
  special_allowance DECIMAL(12,2),
  tds DECIMAL(10,2),
  status ENUM('draft', 'processed', 'approved', 'final'),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);
```

### call_quality_assessment (db_audit)
```sql
CREATE TABLE call_quality_assessment (
  id INT PRIMARY KEY AUTO_INCREMENT,
  User VARCHAR(50),                    -- Employee code
  Campaign VARCHAR(100),              -- Process/LOB name
  CallDate DATETIME,
  quality_percentage DECIMAL(5,2),
  auditor_id INT,
  audit_notes TEXT,
  ...
);
```

---

## Common Questions

### Q: Why might cost_per_quality_point be high even with good quality?
**A:** High salary relative to call volume. Investigate:
- Is the agent handling fewer calls due to specialization?
- Are they handling complex calls that need more time?
- Is there untracked work (e.g., follow-ups, documentation)?

### Q: Can we improve cost_per_quality_point without cutting salaries?
**A:** Yes—increase quality or call volume:
- **Quality improvement:** Coaching, process simplification, tooling
- **Volume increase:** More efficient call routing, reduce hold time, reduce after-call work

### Q: How often should we run these analyses?
**A:** Minimum monthly; ideally weekly for real-time dashboarding. Daily for real-time alerts on Q1 performers.

### Q: Is cost_per_quality_point the only metric we should optimize?
**A:** No. Also monitor:
- **Quality alone:** Some agents may prefer depth over speed
- **Customer satisfaction:** Quality % doesn't capture customer sentiment
- **Agent retention:** Low pay + high targets = attrition
- **Sustainability:** Is the model sustainable long-term?

---

## Safety Notes
- **Do not reduce salaries without documented improvement plan first**
- **Do not replace agents based solely on 30-day data; use 90-day rolling average**
- **Do not ignore external factors** (seasonality, process changes, staffing changes)
- **Do validate findings with managers before acting** on recommendations

---

## Next Steps
1. Schedule Query 1 to run weekly; alert if any agent's efficiency_rank increases by >50%
2. Create live dashboard showing top 10 HIGH_ROI and LOW_ROI agents
3. Implement automated coaching triggers when quality_score < 70%
4. Establish quarterly business review to review Query 5 forecasts

---

**Questions?** Refer to the SQL comments in `cost-efficiency-analysis.sql` for query-specific details.
