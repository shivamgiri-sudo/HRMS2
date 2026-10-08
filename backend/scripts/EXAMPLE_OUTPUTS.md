# Cost Efficiency Analysis — Example Outputs & Interpretation

This document shows realistic example outputs from each query and how to interpret them for decision-making.

---

## Example 1: Agent-Level Cost Efficiency (Top 15 Ranked by ROI)

### Sample Output
```
EMPLOYEE_CODE | AGENT_NAME          | MONTHLY_SALARY | CALLS_30D | AVG_QUALITY | COST_PER_CALL | COST_PER_QP | RATING   | TENURE_MO
EMP001        | Alice Kumar         | 26,000         | 180       | 88.5%       | 144.44        | 163.40      | HIGH_ROI | 18
EMP002        | Bob Singh           | 24,000         | 160       | 85.0%       | 150.00        | 176.47      | HIGH_ROI | 14
EMP003        | Carol Mehta         | 25,000         | 170       | 82.3%       | 147.06        | 178.67      | GOOD_ROI | 12
EMP004        | Dave Patel          | 22,000         | 150       | 78.5%       | 146.67        | 186.62      | GOOD_ROI | 8
EMP005        | Eve Johnson         | 23,000         | 155       | 76.0%       | 148.39        | 195.26      | GOOD_ROI | 6
EMP006        | Frank Li            | 21,000         | 125       | 74.2%       | 168.00        | 226.28      | MEDIUM_ROI| 4
EMP007        | Grace Wong          | 28,000         | 140       | 68.5%       | 200.00        | 291.97      | MEDIUM_ROI| 2
EMP008        | Harry Brown         | 27,000         | 110       | 62.3%       | 245.45        | 433.44      | LOW_ROI  | 1
EMP009        | Iris Sharma         | 26,500         | 95        | 55.8%       | 279.00        | 474.91      | LOW_ROI  | 0.5
```

### Interpretation

**High Performers (HIGH_ROI - Alice, Bob):**
- Quality 85%+, cost per quality point <₹180
- These agents are tier-1 performers—consider them for:
  - Team lead / mentor roles
  - Complex case handling
  - Training new hires
- **Action:** Reward; retain; develop

**Good Performers (GOOD_ROI - Carol, Dave, Eve):**
- Quality 75-85%, cost per quality point ₹176-196
- Stable baseline; no immediate action
- Expected distribution: 40% of team
- **Action:** Monitor; provide routine coaching

**Medium Performers (MEDIUM_ROI - Frank, Grace):**
- Quality 65-75%, cost per quality point ₹225-291
- Need attention but still productive
- Tenure varies—onboarding gap if new
- **Action:** Identify bottleneck; assign mentor; set 30-day improvement target

**Low Performers (LOW_ROI - Harry, Iris):**
- Quality <65%, cost per quality point >₹430
- Urgent action needed; costly mistakes
- Iris just hired (0.5 mo)—expected ramp time; but Harry (1 mo) is concerning
- **Action:** Immediate coaching; consider probation; measure in 15 days

---

## Example 2: Process-Level ROI (Top 10 Ranked by Efficiency)

### Sample Output
```
PROCESS              | CALLS_30D | AGENTS | AVG_QUALITY | TOTAL_PAYROLL | COST_PER_CALL | COST_PER_QP | ROI_CLASS
Customer Service     | 5,000     | 45     | 82.1%       | 1,125,000     | 225.00        | 274.10      | GOOD_ROI
Tech Support         | 2,500     | 25     | 79.5%       | 625,000       | 250.00        | 314.47      | GOOD_ROI
Billing Queries      | 2,000     | 20     | 84.2%       | 500,000       | 250.00        | 296.91      | GOOD_ROI
Sales Outbound       | 1,500     | 15     | 87.3%       | 375,000       | 250.00        | 286.33      | PREMIUM_ROI
Collections          | 800       | 10     | 76.5%       | 250,000       | 312.50        | 408.50      | ACCEPTABLE
L2 Support           | 600       | 12     | 68.3%       | 300,000       | 500.00        | 731.48      | POOR_ROI
Retention Outreach   | 400       | 8      | 64.2%       | 200,000       | 500.00        | 778.50      | POOR_ROI
```

### Interpretation

**PREMIUM_ROI Process (Sales Outbound):**
- Quality 87.3% at ₹250/call
- **Finding:** Highest quality + moderate cost = most efficient
- **Strategy:** 
  - Document best practices
  - Use as training model for other teams
  - Consider expanding headcount
  - **Scaling:** 1 additional agent = ~₹25k additional spend + 150 calls + ₹12.5k value

**GOOD_ROI Processes (Customer Service, Billing):**
- Quality 79-82% at ₹225-250/call
- **Finding:** Baseline acceptable performance
- **Strategy:**
  - Monitor for deterioration
  - Implement peer coaching from Sales team
  - Expected outcome: +3-5% quality = ₹50-100k annual savings

**ACCEPTABLE ROI Process (Collections):**
- Quality 76.5% at ₹312.50/call
- **Finding:** Highest cost per call; quality acceptable
- **Investigation needed:**
  - Are calls longer due to complexity?
  - High agent turnover?
  - New process?
- **Strategy:**
  - Benchmark calls against GOOD_ROI teams
  - Identify process blockers (compliance, system delays)
  - Target: Reduce cost to ₹275/call (₹37.5k annual savings)

**POOR_ROI Processes (L2 Support, Retention):**
- Quality 64-68% at ₹500-778/call
- **Finding:** High cost + low quality = unacceptable
- **Immediate Actions:**
  - L2 Support: Are agent skill levels adequate? Reassess job level/pay.
  - Retention: Is process correct? Script effectiveness? Manager oversight?
- **Strategy:**
  - 2-week deep dive investigation
  - Option A: Improve (target: 75% quality, ₹350/call)
  - Option B: Consolidate into GOOD_ROI team (save ₹50k)
  - Option C: Outsource/automate (if feasible)

---

## Example 3: Top 20 Savings Opportunities (Ranked by Monthly Savings)

### Sample Output
```
RANK | AGENT_NAME | SALARY | QUALITY | CALLS | INT_PRIORITY | MONTHLY_SAVINGS | ACTION           | 12_MO_SAVINGS
1    | Harry Brown| 27,000 | 55.8%   | 110   | CRITICAL     | 8,100           | Reskill/Replace  | 97,200
2    | Iris Sharma| 26,500 | 62.3%   | 95    | CRITICAL     | 7,975           | Reskill/Replace  | 95,700
3    | Jack Kumar | 25,000 | 68.2%   | 105   | HIGH         | 3,750           | Targeted Coach   | 45,000
4    | Kelly Singh| 24,000 | 69.5%   | 100   | HIGH         | 3,600           | Targeted Coach   | 43,200
5    | Larry Gupta| 23,000 | 71.4%   | 98    | HIGH         | 3,450           | Targeted Coach   | 41,400
6    | Mary Khan  | 22,000 | 74.1%   | 108   | MEDIUM       | 2,200           | Performance Plan | 26,400
7    | Nancy Lee  | 21,000 | 72.8%   | 95    | MEDIUM       | 2,100           | Performance Plan | 25,200
8    | Oscar Ali  | 20,000 | 73.5%   | 90    | MEDIUM       | 2,000           | Performance Plan | 24,000
---
     |            |        |         |       |              | 32,775 TOTAL    |                  | 393,300/YEAR
```

### Implementation Strategy

**CRITICAL Priority (Rank 1-2: Harry, Iris)**
- Combined savings: ₹16,075/month or ₹193k/year
- **Action Plan:**
  - Week 1: Assessment call with manager + 1:1 coaching plan
  - Week 2-4: Intensive 2:1 mentoring (pair with High_ROI agent)
  - Day 30: Review—improvement? Reskilling? Exit?
  - Likely outcome: 40% recover to GOOD_ROI (save ₹6,400/mo), 60% exit (save ₹9,600/mo immediate)
- **Budget:** ₹2k/person × 2 = ₹4k coaching investment vs. ₹193k annual savings

**HIGH Priority (Rank 3-5: Jack, Kelly, Larry)**
- Combined savings: ₹10,800/month or ₹129.6k/year
- **Action Plan:**
  - Assign each to PREMIUM_ROI mentor (Sales Outbound team)
  - Weekly skill training; daily shadowing
  - 30-day milestones; measured improvement
  - Likely outcome: 70% recover to GOOD_ROI (save ₹7,560/mo), 30% stay flat (continue coaching)
- **Budget:** ₹500/person coaching vs. ₹129.6k annual savings

**MEDIUM Priority (Rank 6-8: Mary, Nancy, Oscar)**
- Combined savings: ₹6,300/month or ₹75.6k/year
- **Action Plan:**
  - Structured 60-day performance improvement plan
  - Clear metrics; documented expectations
  - Weekly check-ins; bi-weekly reviews
  - Likely outcome: 60% improve (save ₹3,780/mo), 40% plateau (continue monitoring)
- **Budget:** Low-cost internal program vs. ₹75.6k potential savings

**Total Opportunity:** ₹32.8k/month = **₹393k/year**
**Investment:** ₹10-15k in coaching
**ROI:** 26:1 (₹393k savings / ₹15k investment)

---

## Example 4: Salary-Quality Correlation (Healthy Vs. Problematic Patterns)

### Healthy Pattern (Ideal)

```
SALARY_BRACKET | SALARY_RANGE    | AGENTS | AVG_QUALITY | EXCELLENCE% | UNDERPERFORMING%
Q1_Lowest25%   | 18,000-22,000   | 48     | 72.3%       | 12%         | 22%
Q2_Mid_Low     | 23,000-26,000   | 45     | 78.2%       | 25%         | 15%
Q3_Mid_High    | 27,000-30,000   | 40     | 83.1%       | 40%         | 8%
Q4_Highest25%  | 31,000-45,000   | 32     | 87.5%       | 60%         | 3%
```

**Interpretation:**
- Clean positive correlation: ₹ spent = quality received
- Q4 is worth the premium: 85% higher quality than Q1, 30% higher salary
- **Finding:** Salary ladder is correctly calibrated
- **Action:** Maintain; use as model; promote from Q3→Q4 based on performance

### Problematic Pattern 1: Inverted Correlation

```
SALARY_BRACKET | AGENTS | AVG_QUALITY | EXCELLENCE% | UNDERPERFORMING%
Q1_Lowest25%   | 48     | 78.5%       | 30%         | 10%
Q2_Mid_Low     | 45     | 81.2%       | 35%         | 8%
Q3_Mid_High    | 40     | 79.3%       | 28%         | 12%
Q4_Highest25%  | 32     | 72.1%       | 15%         | 28%  ← PROBLEM
```

**Diagnosis:** Q4 agents performing WORSE than Q1
- **Possible causes:**
  - Q4 = senior/burned out; retention problem masking under-performance
  - Misclassified roles (should be team leads, not frontline)
  - Quality criteria changed; Q4 hired under old standards
- **Action:**
  - Audit Q4 sample (5-10 calls each)
  - Separate issue: Team lead vs. frontline contributor
  - Decision: Reclassify, reskill, or exit

### Problematic Pattern 2: Salary Compression

```
SALARY_BRACKET | AGENTS | AVG_QUALITY | EXCELLENCE% |
Q1             | 48     | 72.8%       | 12%
Q2             | 45     | 74.2%       | 14%
Q3             | 40     | 75.5%       | 16%  ← Flat
Q4             | 32     | 76.9%       | 18%  ← Flat
```

**Diagnosis:** Very flat salary band (Q1 ₹18k, Q4 ₹22k) but quality only +4%
- **Possible causes:**
  - No merit-based progression
  - Across-the-board increases regardless of performance
  - Quality ceiling hit; salary differential needed for leadership
- **Action:**
  - Implement performance-based pay increase (link to quality %)
  - Create clear Q4→Team Lead career path with ₹30k salary step
  - Audit: Who's in Q4? Are they underutilized senior talent?

### Problematic Pattern 3: High Q4 Variance

```
SALARY_BRACKET | AVG_QUALITY | QUALITY_VARIANCE |
Q4_Highest25%  | 85.2%       | 18.5%           ← HIGH
```

**Diagnosis:** Q4 agents are inconsistent (some 95%, some 68%)
- **Possible causes:**
  - Different roles grouped together (senior agents + specialists)
  - Lack of standardized process; heroes vs. strugglers
  - Inadequate Q4 manager oversight
- **Action:**
  - Disaggregate: Separate specialized roles
  - Peer mentoring: Pair 95% performer with 68%
  - Weekly quality calibration meetings

---

## Example 5: Annual Forecast & Model Health

### Scenario A: Sustainable Model (80%+ Quality)

```
Active Agents: 180
Annual Payroll: ₹54,000,000
Projected Annual Calls: 900,000
Avg Quality: 82.1%
Annual Cost per Call: ₹60
Annual Cost per Quality Point: ₹73.08
MODEL_HEALTH: Sustainable Model - Scale Recommended

Benchmarks:
┌─────────────────────────────────────────┐
│ Model Performance vs. Benchmarks        │
├─────────────────────────────────────────┤
│ Quality 82% vs. Target 80%: ✓ ABOVE    │
│ Cost/call ₹60 vs. Benchmark ₹65: ✓ BELOW
│ Cost/QP ₹73 vs. Benchmark ₹80: ✓ BELOW │
│ Agent productivity: ✓ STRONG            │
└─────────────────────────────────────────┘

Recommendation: SCALE
- Add 20 agents (₹600k payroll increase)
- Projected revenue impact: ₹3.5M (5,000+ calls/month)
- Payback period: <2 months
```

### Scenario B: Acceptable Model (70-79% Quality)

```
Active Agents: 180
Annual Payroll: ₹54,000,000
Projected Annual Calls: 900,000
Avg Quality: 76.3%
Annual Cost per Call: ₹60
Annual Cost per Quality Point: ₹78.63
MODEL_HEALTH: Acceptable Model - Optimize Recommended

Optimization Opportunities:
┌─────────────────────────────────────────┐
│ Improvement Scenario 1: Coaching        │
├─────────────────────────────────────────┤
│ Cost: ₹100k training                    │
│ Quality Target: 82% (from 76.3%)        │
│ Cost/QP Improvement: ₹73.08             │
│ Annual Savings: ₹540k                   │
│ ROI: 5.4x                               │
├─────────────────────────────────────────┤
│ Improvement Scenario 2: Process Change  │
│ Cost: ₹200k system upgrade              │
│ Quality Target: 80% (from 76.3%)        │
│ Cost/QP Improvement: ₹75.00             │
│ Annual Savings: ₹360k                   │
│ ROI: 1.8x                               │
├─────────────────────────────────────────┤
│ Improvement Scenario 3: Combined        │
│ Cost: ₹250k total (coaching + tools)    │
│ Quality Target: 83% (from 76.3%)        │
│ Cost/QP Improvement: ₹65.06             │
│ Annual Savings: ₹780k                   │
│ ROI: 3.1x                               │
└─────────────────────────────────────────┘

Recommendation: COMBINED APPROACH
- Phase 1 (Month 1-2): Coaching (₹100k, +3% quality)
- Phase 2 (Month 3-4): System upgrade (₹200k, +3% quality)
- Phase 3 (Month 5+): Monitor and optimize
- Expected outcome: ₹780k annual savings, 83% quality target
```

### Scenario C: At-Risk Model (<70% Quality)

```
Active Agents: 180
Annual Payroll: ₹54,000,000
Projected Annual Calls: 900,000
Avg Quality: 64.2%
Annual Cost per Call: ₹60
Annual Cost per Quality Point: ₹93.46
MODEL_HEALTH: At-Risk Model - Urgent Intervention

CRISIS INDICATORS:
┌─────────────────────────────────────────┐
│ ❌ Quality 64% vs. Target 80%: 16pp gap │
│ ❌ Cost/QP ₹93 vs. Benchmark ₹80: 16% over
│ ❌ Agent turnover likely high (stress)  │
│ ❌ Customer satisfaction at risk        │
│ ❌ Regulatory/compliance risk           │
└─────────────────────────────────────────┘

URGENT ACTION PLAN (Next 30 Days):
1. Emergency Manager Huddle (Day 1)
   - Root cause analysis: hiring, training, process, incentives?
   
2. Immediate Interventions (Week 1)
   - Reduce workload: 20-30% load shedding to stabilize
   - Hire external coaching: ₹500k emergency investment
   - Daily quality huddles (15 min)
   
3. Diagnostic Deep-Dive (Week 2-3)
   - Call audit: 50 calls from bottom 20% agents
   - Manager capability assessment
   - Process/system bottleneck analysis
   
4. Corrective Actions (Week 4)
   - Action plan with quarterly targets:
     - Q1 (30 days): 64% → 70% (stop bleeding)
     - Q2 (60 days): 70% → 76% (recovery)
     - Q3 (90 days): 76% → 80% (stabilization)
     - Q4: 80%+ (new normal)
   
5. Success Metrics & Accountability
   - Weekly tracking vs. targets
   - Manager/agent bonuses tied to quality improvement
   - Exit plan for bottom 10% if no improvement in 60 days

INVESTMENT & PAYBACK:
- Emergency coaching: ₹500k
- Process improvements: ₹300k
- Total: ₹800k
- Recovery benefit (each 1% = ₹646k): 2% recovery = ₹1.29M
- Net: ₹490k profit in 90 days
```

---

## Decision Framework: What to Do With Each Result

### If cost_per_quality_point is >₹500
**High cost, low quality = money wasted**

| Finding | Action | Timeline |
|---------|--------|----------|
| New hire (<6 mo) | Extend onboarding; assign mentor | 30 days |
| Tenure >12 mo | Performance improvement plan | 15 days |
| Complex role | Assess role/person fit; reclassify or exit | 30 days |
| Process issue | Bypass agent; investigate system bottleneck | 5 days |

### If cost_per_call is <₹120 but quality 65%
**Cost-effective but quality concerns**

| Finding | Action | Timeline |
|---------|--------|----------|
| High call volume | Reduce workload to improve quality | 7 days |
| Low call volume | Increase utilization; add complexity | 14 days |
| Compliance risk | Immediate audit; possibly remove from floor | 3 days |

### If Q4 quality <Q1 quality
**Salary ladder inverted = urgent review**

| Finding | Action | Timeline |
|---------|--------|----------|
| Data error | Validate data; check call audit sample | 3 days |
| Burnout | Career path review; consider lead role | 30 days |
| Misclassification | Separate frontline from leadership | 15 days |

### If PREMIUM_ROI process <5% of volume
**Underutilized high-efficiency process**

| Finding | Action | Timeline |
|---------|--------|----------|
| Capacity available | Shift calls from POOR_ROI process | 7 days |
| Skills differ | Create training pathway from other teams | 30 days |
| Resource constrained | Add budget to scale | 14 days |

---

## Excel/Dashboard Visualization Tips

### Chart 1: Agent Scatter (Cost vs. Quality)
- X-axis: Cost per Call (₹100-500)
- Y-axis: Quality % (40-95%)
- Size: Call volume
- Color: Efficiency rating (High/Good/Medium/Low)
- Quadrants:
  - Upper-left (High quality, Low cost) = STARS ⭐
  - Upper-right (High quality, High cost) = VALUABLE
  - Lower-left (Low quality, Low cost) = DEVELOPING
  - Lower-right (Low quality, High cost) = PROBLEM ❌

### Chart 2: Process ROI Waterfall
- X-axis: Process names
- Y-axis: Cost per Quality Point (₹150-800)
- Bars color: Green (PREMIUM), Yellow (GOOD/ACCEPTABLE), Red (POOR)
- Trend line: Industry benchmark (₹400)

### Chart 3: Savings Opportunity Pareto
- X-axis: Agent names (top 20)
- Y-axis: Monthly savings potential (₹0-10k)
- Bars: Stacked by intervention type (Coaching, Reskill, Replace)
- Cumulative line: Show 80/20 rule

### Chart 4: Salary-Quality Regression
- X-axis: Monthly salary (₹15k-50k)
- Y-axis: Quality % (50-95%)
- Points: Individual agents
- Trend line: Expected correlation
- Outliers: Highlight star performers and problem cases

---

**End of Examples**

For more details on interpretation, refer to COST_EFFICIENCY_GUIDE.md.
For technical execution questions, refer to cost-efficiency-analysis.sql comments.
