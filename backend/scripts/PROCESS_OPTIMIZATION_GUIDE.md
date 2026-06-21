# Process Quality Ranking & Optimal Team Composition Guide

## Executive Summary

This analysis identifies the best process combinations and optimal team composition for maximizing call quality and agent productivity. The framework evaluates three critical dimensions:

1. **Process Quality Ranking** - Which processes are best trained/managed
2. **Fatigue Cycle Analysis** - Weekly and hourly quality degradation patterns
3. **Shift Timing Optimization** - Peak performance windows and recovery periods

---

## Output Format

### Standard Output: PROCESS | QUALITY_RANK | VARIANCE | OPTIMAL_SHIFT | FATIGUE_FACTOR

| Field | Description | Range | Interpretation |
|-------|-------------|-------|-----------------|
| **PROCESS** | Campaign/process name | String | Identifies the business process or campaign |
| **QUALITY_RANK** | Ranked position by quality | 1-N (1=Best) | Lower number = higher average quality; use to prioritize resources |
| **AVG_QUALITY** | Average quality percentage | 0-100% | Overall performance; 85%+ = Elite, 70-75% = At-risk |
| **VARIANCE** | Standard deviation of quality | 0-50 | Consistency metric; <8 = Stable, 8-12 = Moderate, >12 = Volatile |
| **VARIANCE_STATUS** | Classification of variance | STABLE/MODERATE/VOLATILE | Indicates team consistency and predictability |
| **OPTIMAL_SHIFT** | Best-performing shift window | Morning/Afternoon/Evening/Night | Route complex work to this shift |
| **FATIGUE_FACTOR** | Weekly fatigue indicator | 1-3 | 1 = Mid-week (best), 2 = Friday, 3 = Weekend (worst) |
| **PROCESS_TIER** | Strategic classification | TIER_1_ELITE through TIER_5_AT_RISK | Guides resource allocation decisions |

---

## Analysis Components

### 1. Process Quality Ranking

**Purpose**: Identify which processes have the strongest teams, best training, or most effective management.

**Key Metrics**:
- Average quality score (primary ranking metric)
- Quality variance (consistency indicator)
- Excellence rate (% calls >= 85%)
- Poor rate (% calls < 70%)

**Interpretation**:
```
TIER_1_ELITE    (Rank 1-3):   Avg Quality >= 85%, Variance < 10
  → Action: Expand allocation, use as training model for other processes

TIER_2_HIGH     (Rank 4-5):   Avg Quality >= 80%, Variance < 12
  → Action: Maintain allocation, monitor for any degradation

TIER_3_GOOD     (Rank 6-10):  Avg Quality >= 75%
  → Action: Monitor closely, document best practices

TIER_4_DEVELOPING (Rank 11+): Avg Quality 70-75%
  → Action: Implement development program, increase coaching

TIER_5_AT_RISK  (Rank N):     Avg Quality < 70%
  → Action: IMMEDIATE - workload reduction, team restructuring, or suspension
```

**Best Practice Processes** (Quality Rank #1):
- Study their:
  - Team composition (size, tenure, experience mix)
  - Manager behavior (coaching frequency, recognition patterns)
  - Quality frameworks (call scripts, processes, tools)
  - Training approach (onboarding depth, ramp duration)
- Replicate practices in lower-ranked processes

---

### 2. Fatigue Cycle Analysis (Day-of-Week & Hour Patterns)

**Purpose**: Identify when quality degrades due to agent fatigue, and when it peaks.

**Expected Pattern** (Industry Standard):
```
MONDAY Morning      → 78-80%  (Post-weekend restart, moderate fatigue)
TUESDAY-WEDNESDAY  → 82-84%  (Peak performance, well-rested)
THURSDAY           → 80-82%  (Mid-fatigue cycle)
FRIDAY             → 75-78%  (Friday fatigue, weekend anticipation)
SATURDAY-SUNDAY    → 70-75%  (High fatigue, reduced staffing typically)

HOUR-OF-DAY PATTERN:
  9:00-11:00 AM    → Morning Peak (highest quality)
  12:00-13:00      → Lunch Valley (lowest quality - hunger, attention dip)
  14:00-16:00 PM   → Afternoon Recovery (secondary peak)
  17:00-18:00      → Evening Decline (end-of-shift fatigue)
  18:00-20:00 PM   → Evening Secondary (swing shift fresh)
```

**Fatigue Factor Scoring**:
- **1** (Best): Tuesday-Thursday mid-morning/mid-afternoon
- **2** (Elevated): Friday, early morning, late evening
- **3** (High): Saturday-Sunday, lunch hour, end-of-day

**Action Items by Fatigue Level**:

| Fatigue Level | Time Window | Avg Quality | Recommendation |
|---------------|-------------|-------------|-----------------|
| 1 (Low) | Tue-Thu 9-11am, 2-4pm | 80%+ | Route high-complexity/high-value calls |
| 2 (Moderate) | Mon, Fri, 8am, 5pm | 75-80% | Mixed work: routine + medium-complexity |
| 3 (High) | Sat-Sun, 12-1pm, 6-10pm | <75% | Routine/low-complexity work only |

---

### 3. Shift Timing Optimization (Peak Performance Windows)

**Purpose**: Maximize efficiency by routing appropriate work to optimal shift windows.

**Shift Windows** (Global Standard, adjust for local timezone):

#### Morning Shift (8:00 AM - 12:00 PM)
- **Typical Quality**: 80-84%
- **Characteristics**: High energy, peak cognitive function, fewest distractions
- **Best For**: Complex technical issues, high-value negotiations, new agent training
- **Staffing**: Senior agents, SMEs, complex-work specialists

#### Afternoon Shift (1:00 PM - 5:00 PM)
- **Typical Quality**: 78-82%
- **Characteristics**: Post-lunch energy dip (12-1pm), recovery 2-5pm
- **Best For**: Balanced work (routine + medium-complexity)
- **Staffing**: Mid-tier and senior agents

#### Evening Shift (6:00 PM - 10:00 PM)
- **Typical Quality**: 75-80%
- **Characteristics**: Lower volume, fresh swing-shift start, fatigue by 9-10pm
- **Best For**: Overflow, after-hours support, lower-skill work
- **Staffing**: Junior agents (training opportunity), experienced backup

#### Night Shift (11:00 PM - 7:00 AM)
- **Typical Quality**: 70-75% (if used)
- **Characteristics**: Low volume, high fatigue, retention risk
- **Best For**: Emergency support only or fully automated
- **Staffing**: Minimal, or outsource

**Optimal Shift Allocation Strategy**:

```
Priority 1 (High-Value):   Route to Morning Peak (9-11 AM)
  → Complex issues, high-value customers, strategic accounts
  → Expected Quality: 83-85%

Priority 2 (Standard):     Route to Afternoon (2-4 PM)
  → Routine + mixed-complexity work
  → Expected Quality: 80-82%

Priority 3 (Low-Risk):     Route to Evening (6-8 PM)
  → Routine transactions, low-complexity
  → Expected Quality: 76-79%

Priority 4 (Auto/Defer):   Route to Lunch Hour or Night
  → Automated IVR, email, or defer to next peak window
  → Expected Quality: 70%
```

---

### 4. Process + Shift Combination Matrix

**Purpose**: For each process, determine which shift performs best and should receive priority allocation.

**Interpretation**:

```
BEST COMBINATION (Example: Process_A + Morning Shift)
  Avg Quality: 86%
  Allocation: PRIMARY_ALLOCATION (100% of complex work for Process_A goes to Morning shift)

SECONDARY COMBINATION (Example: Process_A + Afternoon Shift)
  Avg Quality: 82%
  Allocation: SECONDARY_ALLOCATION (overflow & medium-complexity from Process_A)

AVOID (Example: Process_B + Night Shift)
  Avg Quality: 68%
  Allocation: AVOID (do not assign; use automation or defer)
```

**Use Case: Roster Planning**

```
Scenario: You have 50 agents across 3 shifts; 2 critical processes (A, B)

Current State:
  Morning: 20 agents (16 on Process_A, 4 on Process_B)
  Afternoon: 20 agents (10 on Process_A, 10 on Process_B)
  Evening: 10 agents (4 on Process_A, 6 on Process_B)

Analysis Shows:
  Process_A + Morning: 87% (OPTIMAL)
  Process_B + Morning: 78% (GOOD)
  Process_B + Afternoon: 85% (OPTIMAL)
  Process_A + Afternoon: 79% (GOOD)
  Process_B + Evening: 68% (AVOID)

Recommended State:
  Morning: 18 on Process_A, 2 on Process_B  → +80-90% quality
  Afternoon: 8 on Process_A, 12 on Process_B → +85% quality
  Evening: 6 on Process_A, 4 on Process_B  → +4% quality
  Result: Overall quality +8-12%, reduced evening overload
```

---

### 5. Team Composition Optimization

**Purpose**: Right-size teams per process/shift to maximize quality without over-extension.

**Team Load Classifications**:

| Load Status | Team Size | Avg Quality | Recommendation | Example Actions |
|-------------|-----------|-------------|-----------------|-----------------|
| LEAN | 1-5 agents | Typically 82%+ | Monitor for workload stress | Add 1-2 agents if >85 calls/agent/day |
| OPTIMAL | 6-10 agents | 80-85% | Maintain current structure | Stable operation; minimal changes |
| STRETCHED | 11-15 agents | 75-80% | At threshold; monitor closely | Consider split into 2 teams of 6-8 |
| OVER_EXTENDED | 16+ agents | <75% | RESTRUCTURE REQUIRED | Split team, add manager, increase training |

**Quality vs. Team Size Correlation** (General Pattern):

```
QUALITY TRENDS BY TEAM SIZE (Span of Control):
  1-3 agents:   88% (but risk: low resilience, single point of failure)
  4-5 agents:   85% (ideal for specialist/complex work)
  6-10 agents:  82% (standard for most operations)
  11-15 agents: 77% (stretched; visible quality decline)
  16-25 agents: 72% (over-extended; management breakdown)
  26+ agents:   <70% (crisis; restructure immediately)
```

**Team Restructuring Logic**:

```
IF avg_quality < 75% AND team_size > 12:
  → Action: Split into two teams (8 + 4) or (10 + 2)
  → Expected Quality Gain: +8-12%
  → Add: 1 additional team lead (junior/aspiring)

IF avg_quality < 70%:
  → Action: Immediate intervention:
    1. Reduce team size by 25% (off-peak reallocation)
    2. Increase coaching frequency (1-on-1 daily)
    3. Implement daily quality huddles
    4. Flag for manager capability review
  → Expected Quality Gain: +5-8%
  → Timeframe: 14-30 days to stabilize
```

---

## Implementation Roadmap

### Week 1: Analysis & Planning
```
Step 1: Run all 5 queries (process-team-optimization.sql)
Step 2: Generate scorecard (optimization_scorecard output)
Step 3: Identify top 3 priorities:
  - Highest variance processes
  - Lowest quality processes
  - Worst process-shift combinations
Step 4: Schedule stakeholder meeting (HR, Operations, Managers)
```

### Week 2-3: Quick Wins
```
Action 1: Rebalance roster per process-shift matrix
  - Move 10-20% of staff from POOR combinations to OPTIMAL
  - Expected: +5-8% quality lift, minimal disruption

Action 2: Implement fatigue-aware call routing
  - Route high-value calls to morning peak windows
  - Defer routine calls to evening/recovery periods
  - Expected: +3-5% quality for routed calls

Action 3: Begin benchmarking top-tier processes
  - Document TIER_1 team: size, tenure, training, scripts
  - Schedule manager interviews with top 3 processes
  - Identify replicable practices
```

### Week 4-6: Structural Changes
```
Action 4: Restructure over-extended teams
  - Split teams >14 agents into two teams
  - Promote high-performers to team leads
  - Expected: +8-12% quality, +3-5% retention

Action 5: Implement competency-based allocation
  - Map agents to process-shift combinations
  - Create "primary" + "backup" assignments
  - Expected: +4-6% quality, improved cross-training

Action 6: Deploy daily micro-huddles
  - 5-min pre-shift quality huddle (focus on morning peak)
  - Share hourly quality metrics
  - Celebrate shift goals
```

### Month 2+: Continuous Optimization
```
Ongoing:
  - Weekly quality trending (fatigue patterns)
  - Monthly team health reviews (variance > threshold?)
  - Quarterly best-practice replication
  - Bi-annual skill alignment to process tiers
```

---

## Key Formulas & Calculations

### Variance Classification
```
Variance < 8:     STABLE      (Highly predictable, low variance)
Variance 8-12:    MODERATE    (Typical, acceptable variance)
Variance > 12:    VOLATILE    (High variance, consistency issues)
```

### Process Tier Assignment
```
Tier 1 (Elite):       Rank 1-3,   Quality >= 85%, Variance < 10
Tier 2 (High):        Rank 4-5,   Quality >= 80%, Variance < 12
Tier 3 (Good):        Rank 6-10,  Quality >= 75%
Tier 4 (Developing):  Rank 11+,   Quality 70-75%
Tier 5 (At-Risk):     Rank N,     Quality < 70%
```

### Fatigue Factor Score
```
BEST HOURS:        9-11 AM, 2-4 PM (Fatigue Factor = 1)
MID HOURS:         8 AM, 12-1 PM, 5-6 PM (Fatigue Factor = 2)
WORST HOURS:       12-1 PM lunch, 6+ PM evening, 6-7 AM early (Fatigue Factor = 3)

BEST DAYS:         Tue-Wed-Thu (Fatigue Factor = 1)
MID DAYS:          Mon, Fri (Fatigue Factor = 2)
WORST DAYS:        Sat, Sun (Fatigue Factor = 3)

COMBINED FATIGUE SCORE = Day_Factor + Hour_Factor (1-6 scale)
Optimal: Score 2-3 (e.g., Tuesday 9 AM = 1+1 = 2)
Avoid:   Score 5-6 (e.g., Saturday 1 PM = 3+3 = 6)
```

### Team Composition Formula
```
Optimal Team Size = CEILING(Daily_Call_Volume / 40)
  (Assuming ~40 calls/agent/day, 8-hour shift)

Max Stable Team Size = 12 agents per manager
  (Span of control: exceeding 12 triggers quality decline)

Quality Impact of Restructuring:
  Quality_Gain = (Base_Quality × 0.08) for team > 14 agents
  Expected: 5-12% improvement within 30 days
```

---

## Risk Factors & Mitigation

### Risk 1: High Variance in ELITE Process
**Problem**: Process ranked #1 in quality but with high variance (>10%)
**Risk**: Unpredictable performance; hidden weaker team members
**Mitigation**:
  - Conduct agent-level analysis to identify weak performers
  - Increase coaching frequency for below-average agents
  - Implement daily quality huddles
  - Review call calibration and QA process

### Risk 2: Process Performs Well in ONE Shift Only
**Problem**: Process A averages 82% but only 78% in optimal shift
**Risk**: Fragile process; dependent on specific agents/managers
**Mitigation**:
  - Cross-train secondary team
  - Implement knowledge transfer sessions
  - Create redundancy in optimal shift
  - Reduce single-point-of-failure risk

### Risk 3: Evening/Night Shift Quality Collapse
**Problem**: Quality drops >10% in evening/night shifts
**Risk**: Cannot scale volume to off-peak times
**Mitigation**:
  - Implement offshore/remote teams for evening shifts
  - Automate routine calls for off-peak periods
  - Rotate senior agents to evening for mentoring
  - Hire and train evening specialists

### Risk 4: Fatigue-Driven Friday Decline
**Problem**: Quality drops 5-8% on Fridays
**Risk**: Week-end pattern; predictable but expensive to fix
**Mitigation**:
  - Shorter Friday shifts (6 hours instead of 8)
  - Pause training/difficult work on Fridays
  - Rotate staff (some teams get Thursday off)
  - Increase Friday incentives for performance

---

## Queries Reference

### Query 1: Process Quality Ranking
```sql
-- Identifies best/worst processes
-- Use for: Resource allocation, training priorities, benchmarking
-- Output: process_name, quality_rank, variance, tier
```

### Query 2: Fatigue Cycle Analysis
```sql
-- Day-of-week and hour-of-day quality patterns
-- Use for: Shift scheduling, call routing, break timing
-- Output: day_of_week, hour, quality, fatigue_factor
```

### Query 3: Shift Timing Optimization
```sql
-- Peak performance windows per shift
-- Use for: Complex task allocation, high-value call routing
-- Output: shift_window, quality, recommended_workload
```

### Query 4: Process + Shift Matrix
```sql
-- Which process-shift combination is best
-- Use for: Roster planning, agent allocation strategy
-- Output: process, shift, quality, allocation_priority
```

### Query 5: Team Composition
```sql
-- Right-sizing teams per process/shift
-- Use for: Org restructuring, span of control analysis
-- Output: process, shift, team_size, quality_impact
```

---

## Appendix: Sample Output Interpretation

### Example Scorecard Result:

```
PROCESS          QUALITY_RANK  AVG_QUALITY  VARIANCE  VARIANCE_STATUS  OPTIMAL_SHIFT  FATIGUE_FACTOR  TIER
Collections_A    1             86.2         7.8       STABLE           Morning        1               TIER_1_ELITE
Sales_Prime      2             84.5         9.2       STABLE           Afternoon      1               TIER_1_ELITE
Tech_Support     3             82.1         10.5      STABLE           Morning        2               TIER_2_HIGH
Order_Mgmt       4             79.8         11.3      MODERATE         Morning        2               TIER_2_HIGH
CS_Retention     5             77.2         14.2      VOLATILE         Morning        2               TIER_3_GOOD
Billing_INQ      6             75.4         15.8      VOLATILE         Afternoon      2               TIER_3_GOOD
Complaints       7             72.3         18.5      VOLATILE         Morning        3               TIER_4_DEVELOPING
LowValue_Promo   8             68.9         22.1      VOLATILE         Night          3               TIER_5_AT_RISK
```

**Interpretation**:

1. **Collections_A & Sales_Prime** are TIER_1_ELITE
   - Action: Use as training models; allocate best staff
   - Study their processes, scripts, management style

2. **Tech_Support & Order_Mgmt** are TIER_2_HIGH
   - Action: Maintain + monitor; replicate TIER_1 practices
   - Expected quality gain: 2-4%

3. **Billing_INQ & CS_Retention** show HIGH VARIANCE
   - Action: Conduct agent-level QA; increase coaching
   - Risk: Hidden performance disparities

4. **Complaints & LowValue_Promo** are AT-RISK
   - Action: IMMEDIATE restructuring required
   - Recommended: Reduce team size by 20-30%, increase training

---

## Contact & Support

For questions on:
- **Data Accuracy**: Verify call_quality_assessment data freshness
- **Query Optimization**: Check MySQL execution plans if timeout
- **Result Interpretation**: Escalate to Operations/Analytics team
- **Implementation**: Coordinate with HR and Process Managers

---

**Generated**: 2026-06-21
**Valid For**: 90-day data lookback period
**Next Review**: 2026-09-21
