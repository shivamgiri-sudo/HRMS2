# Call Quality Anomaly Detection & Analysis Guide

**File**: `call-quality-anomaly-detection.sql`  
**Database**: `mas_hrms` + `db_audit`  
**Data Window**: 90 days (configurable)  
**Last Updated**: 2026-06-21  

---

## Overview

This comprehensive analysis identifies five categories of quality anomalies in call center operations:

1. **Agent Outliers** - Individual performance deviations from organizational average
2. **Fatigue Patterns** - Quality degradation after consecutive work days
3. **Seasonal Patterns** - Systematic weekly trends (day-of-week effects)
4. **Intraday Anomalies** - Hour-by-hour quality patterns and valley/peak periods
5. **Behavioral Anomalies** - High variability and sudden performance shifts

---

## Query Details & Interpretation

### 1. AGENT_OUTLIER_QUALITY

**Purpose**: Identify agents whose performance is statistically significantly different from the organization average.

**Key Metrics**:
- `agent_avg_quality` - Agent's 90-day average quality percentage
- `org_avg_quality` - Organization-wide 90-day average
- `stddev_distance` - Number of standard deviations from mean (σ)
- `severity` - CRITICAL (>3σ) | HIGH (2-3σ) | MEDIUM (1-2σ)

**Severity Levels**:

| Severity | Threshold | Action |
|----------|-----------|--------|
| CRITICAL | >3σ from mean | Immediate intervention (elite recognition or urgent coaching) |
| HIGH | 2-3σ from mean | Priority coaching program or elite replication |
| MEDIUM | 1-2σ from mean | Structured monitoring with performance conversation |
| LOW | <1σ from mean | Standard monitoring |

**Performance Categories**:

- **ELITE_PERFORMER**: Quality > org_avg + 2σ
  - **Recommended Action**: "Replicate practices across team"
  - Extract best practices, create peer coaching program, consider for trainer role

- **UNDERPERFORMER**: Quality < org_avg - 2σ
  - **Recommended Action**: "Mandatory coaching + monitoring"
  - Root cause analysis, individual improvement plan, potential reassignment

**Interpretation Example**:
```
Agent: JOHN_SMITH
Agent Avg Quality: 65.2%
Org Avg Quality: 78.5%
Org StdDev: 6.3%
StdDev Distance: 2.1σ

Interpretation:
- John's quality is 2.1 standard deviations BELOW the organization average
- Severity: HIGH
- Issue: Significant performance gap requiring intervention
- Action: Mandatory coaching program with weekly monitoring
```

---

### 2. FATIGUE_PATTERN

**Purpose**: Detect quality degradation patterns correlated with consecutive work days, suggesting agent fatigue or burnout.

**Key Metrics**:
- `daily_quality` - Agent's average quality on specific day
- `prev_day_quality` - Previous day's average quality
- `quality_change` - Quality difference day-over-day (negative = degradation)
- `daily_calls` - Number of calls handled that day
- `fatigue_pattern` - Specific fatigue type detected

**Fatigue Pattern Types**:

| Pattern | Indicator | Severity | Recommended Action |
|---------|-----------|----------|-------------------|
| FRIDAY_FATIGUE | Quality <70% on Friday | MEDIUM-HIGH | Optimize Friday workload distribution, advance break times |
| WEEKEND_FATIGUE | Quality <70% on Sat/Sun | MEDIUM-HIGH | Consider incentive for weekend shifts or temporary staffing |
| SHARP_DECLINE | >5% day-over-day drop | HIGH | Immediate check-in to identify acute stressor |
| SUSTAINED_LOW_QUALITY | Quality <70% consistently | HIGH-CRITICAL | Escalate for health/personal issue assessment |

**Daily Severity Scale**:

| Quality Range | Severity | Classification |
|---------------|----------|-----------------|
| <60% | CRITICAL | Immediate relief from calls required |
| 60-65% | HIGH | Reduce workload, offer break, manager check-in |
| 65-70% | MEDIUM | Increased monitoring, coaching offer |
| 70-75% | LOW | Monitor for continuation |
| >75% | ACCEPTABLE | No action |

**Interpretation Example**:
```
Agent: SARAH_JONES | 2026-06-20 (Friday)
Daily Quality: 68.5%
Previous Day (Thursday): 76.2%
Quality Change: -7.7%
Calls Handled: 47

Interpretation:
- Sarah's quality dropped 7.7 percentage points from Thursday to Friday
- Pattern: FRIDAY_FATIGUE
- Severity: MEDIUM
- Action: Check Friday workload pattern, consider earlier breaks, offer recovery time
```

---

### 3. SEASONAL_WEEKLY_PATTERN

**Purpose**: Identify systematic weekly patterns indicating predictable quality variations by day of week.

**Key Metrics**:
- `day_of_week` - Monday through Sunday
- `avg_day_quality` - Average quality for that day across all weeks
- `quality_delta` - Deviation from organization average
- `day_consistency` - StdDev within that day (lower = more predictable)

**Seasonal Pattern Types**:

| Pattern | Day(s) | Root Cause | Strategic Action |
|---------|--------|-----------|------------------|
| WEEKEND_DEGRADATION | Sat-Sun | Staffing model, reduced oversight, voluntary shifts | Adjust team composition, increase supervision, review incentives |
| FRIDAY_FATIGUE | Friday | Cumulative weekly stress, reduced energy | Reduce Friday complexity, early weekend wind-down |
| MONDAY_BLUES | Monday | Post-rest ramp-up, distraction | Structured Monday re-engagement, easier call routing |
| MIDWEEK_STABILITY | Tue-Wed-Thu | Peak energy and focus | Allocate complex/high-value calls to midweek |

**Analysis Approach**:

1. Calculate average quality for each day of week across 90-day period
2. Compare to organization-wide average
3. If day quality < org_avg - σ, flag as anomalous
4. Recommend resource or workload adjustments accordingly

**Interpretation Example**:
```
Day of Week Analysis:
Monday:    76.2% (org_avg: 78.5%, delta: -2.3%)
Tuesday:   79.1% (org_avg: 78.5%, delta: +0.6%)
Wednesday: 80.2% (org_avg: 78.5%, delta: +1.7%)
Thursday:  79.5% (org_avg: 78.5%, delta: +1.0%)
Friday:    74.8% (org_avg: 78.5%, delta: -3.7%) ← ANOMALY
Saturday:  71.3% (org_avg: 78.5%, delta: -7.2%) ← CRITICAL
Sunday:    72.1% (org_avg: 78.5%, delta: -6.4%) ← CRITICAL

Interpretation:
- Clear end-of-week and weekend degradation pattern
- Saturday/Sunday quality is 7.2 percentage points BELOW org average
- Pattern: WEEKEND_DEGRADATION (severity: CRITICAL)
- Action: Review weekend staffing model, consider temporary contractor support
```

---

### 4. INTRADAY_ANOMALY

**Purpose**: Identify specific hours where quality consistently degrades, enabling targeted break scheduling and workload optimization.

**Key Metrics**:
- `hour_of_day` - 0-23 hour (24-hour format)
- `shift_phase` - Morning Peak | Lunch Valley | Afternoon Peak | Evening | Off-Peak
- `hourly_quality` - Average quality for that hour
- `quality_delta` - Deviation from organization average
- `good_rate_pct` - Percentage of calls ≥80% quality
- `poor_rate_pct` - Percentage of calls <70% quality

**Intraday Pattern Types**:

| Pattern | Hours | Root Cause | Action |
|---------|-------|-----------|--------|
| LUNCH_VALLEY_DIP | 12-13 | Hunger, digestion, post-lunch lethargy | Adjust break timing, provide nutrition, rotate easier calls |
| END_OF_SHIFT_DECLINE | 17+ | Fatigue, attention to departure time | Wind-down protocol, reduce volume/complexity in final hours |
| MORNING_RAMP_ISSUE | 8-9 | Slow startup, focus lag | Warm-up activities, simpler call routing first, caffeine consideration |
| SECONDARY_PEAK_DIP | 15-16 | Post-lunch energy lag continuation | Strategic break, hydration stations, energy snacks |

**Shift Phase Definitions**:

| Phase | Hours | Typical Quality | Notes |
|-------|-------|-----------------|-------|
| Morning Peak | 8-11 | High | Best performance window for complex calls |
| Lunch Valley | 12-13 | Lower | Predictable dip, manageable with optimization |
| Afternoon Peak | 14-17 | High-Medium | Good for routine calls, energy recovery period |
| Evening | 18-20 | Medium-Low | Fatigue evident, reduced volume appropriate |
| Off-Peak | Others | Variable | Low volume, maintenance mode |

**Interpretation Example**:
```
Hourly Quality Analysis:
Hour  Phase             Quality  Delta    Poor%  Action
08:00 Morning Peak      77.8%    -0.7%    15%    Acceptable
09:00 Morning Peak      80.4%    +1.9%    8%     ✓ Peak performance
10:00 Morning Peak      79.2%    +0.7%    10%    ✓ Strong
11:00 Morning Peak      78.1%    -0.4%    12%    ✓ Acceptable
12:00 Lunch Valley      72.3%    -6.2%    28%    ← ANOMALY: Reduce complexity
13:00 Lunch Valley      71.9%    -6.6%    31%    ← CRITICAL: Implement break stagger
14:00 Afternoon Peak    75.6%    -2.9%    18%    Recovery phase
15:00 Afternoon Peak    77.4%    -1.1%    14%    Improving
16:00 Afternoon Peak    78.9%    +0.4%    10%    ✓ Strong
17:00 Evening           76.2%    -2.3%    16%    Acceptable
18:00 Evening           74.1%    -4.4%    22%    ← Declining
19:00 Evening           72.8%    -5.7%    26%    ← Fatigue visible
20:00 Evening           71.5%    -6.9%    31%    ← CRITICAL: End shift

Interpretation:
- Lunch Valley: 12-13 hours show 6-7% quality dip
- End-of-Shift: Quality degrades after 17:00, critical at 20:00
- Recommended Actions:
  * Stagger lunch breaks (11:30-12:30 vs 12:30-13:30)
  * Reduce call complexity 12-13 and 18-20
  * Implement snack/hydration at 15:30
  * Wind-down protocol starting 18:00
```

---

### 5. HIGH_VARIABILITY_ANOMALY

**Purpose**: Identify agents with unusually unstable performance (high standard deviation), indicating lack of skill mastery or emotional instability.

**Key Metrics**:
- `agent_stddev` - Agent's individual standard deviation across 90 days
- `org_avg_stddev` - Organization average standard deviation
- `variability_ratio` - Agent StdDev / Org StdDev
- `quality_range` - Difference between agent's best and worst call
- `consistency_pattern` - HIGHLY_UNPREDICTABLE | MODERATELY_INCONSISTENT | ACCEPTABLE_VARIANCE

**Variability Ratio Interpretation**:

| Ratio | Classification | Meaning | Action |
|-------|-----------------|---------|--------|
| >2.0 | HIGHLY_UNPREDICTABLE | Agent's performance is 2x more variable than org average | Diagnostic + Individual coaching |
| 1.5-2.0 | MODERATELY_INCONSISTENT | 50% more variable than org average | Structured training + monitoring |
| <1.5 | ACCEPTABLE_VARIANCE | Normal variability | Standard monitoring |

**Root Cause Analysis**:

Agents with high variability may experience:
- **Skill Issues**: Inconsistent technique, situational knowledge gaps
- **Emotional Factors**: Stress, anxiety, personal problems affecting focus
- **Environmental Factors**: Call type distribution, equipment issues, team dynamics
- **Fatigue Cycles**: Performance swings correlated with schedule/health

**Investigation Steps**:

1. Check if variability correlates with specific call types or hours
2. Review schedule patterns (overlapping shifts, consecutive days)
3. Conduct 1-on-1 to assess personal/professional stressors
4. Assess skill gaps through call reviews
5. Consider environmental factors (workspace, tools, team)

**Interpretation Example**:
```
Agent: MIKE_BROWN
Average Quality: 76.5%
Agent StdDev: 14.3%
Org Avg StdDev: 7.2%
Variability Ratio: 1.99 (MODERATELY_INCONSISTENT)
Quality Range: 92.1% to 34.7% (57.4% spread)

Interpretation:
- Mike's performance varies almost 2x more than organization average
- Quality range of 57.4 percentage points indicates extreme inconsistency
- Pattern: MODERATELY_INCONSISTENT (near critical threshold)
- Possible Causes:
  * Handling both simple and complex calls inconsistently
  * Personal stress affecting focus on some days
  * Knowledge gaps in specific call types
  * Schedule factors (fatigue accumulation)
- Recommended Actions:
  1. Call review of high-variance days vs stable days
  2. Skill assessment: identify knowledge gaps
  3. 1-on-1 conversation: personal/work stressors
  4. Consider specialized call routing during recovery period
  5. Weekly coaching focused on consistency, not just average
```

---

### 6. SUDDEN_PERFORMANCE_SHIFT

**Purpose**: Detect agents with significant week-over-week changes, indicating potential crises, improvements, or attrition risks.

**Key Metrics**:
- `current_week_quality` - Most recent complete week's average
- `previous_4week_avg` - Average of previous 4 weeks (baseline)
- `quality_change` - Absolute percentage point change
- `pct_change` - Relative percentage change
- `shift_direction` - PERFORMANCE_DEGRADATION | PERFORMANCE_IMPROVEMENT

**Shift Severity Scale**:

| Severity | Threshold | Timeframe | Response |
|----------|-----------|-----------|----------|
| CRITICAL | >10% change | 1 week | Immediate 1-on-1 with manager + skip-level |
| HIGH | 5-10% change | 1 week | Priority follow-up within 24-48 hours |
| MEDIUM | 2-5% change | 1 week | Close monitoring + end-of-week check-in |
| LOW | <2% change | 1 week | Routine monitoring |

**Direction-Specific Actions**:

**PERFORMANCE_DEGRADATION** (Quality drops):
- Potential causes:
  * Personal crisis (health, family, financial)
  * Work-related stress or conflict
  * Skill regression from new call types
  * Fatigue/burnout accumulation
  * Job dissatisfaction / attrition signal
- Recommended Response:
  * Immediate manager conversation (within 24 hours)
  * Assess for safety/wellness concerns
  * Identify specific trigger (call type, timing, context)
  * Provide support resources
  * Create recovery plan with daily check-ins
  * Monitor for continued decline (attrition risk)

**PERFORMANCE_IMPROVEMENT** (Quality rises):
- Potential causes:
  * Recent training effectiveness
  * Renewed motivation
  * Call type specialization
  * Team or schedule changes
  * Reduced personal stress
- Recommended Response:
  * Positive recognition and praise
  * Understand what's working (coaching others?)
  * Consider for advanced opportunities
  * Maintain momentum through continued support
  * Extract best practices for team replication

**Interpretation Example**:
```
Agent: JENNIFER_WILLIAMS
Current Week (Week 25): 72.4%
Previous 4-Week Avg (Weeks 21-24): 81.8%
Quality Change: -9.4 percentage points
Percentage Change: -11.5%
Shift Direction: PERFORMANCE_DEGRADATION
Severity: CRITICAL

Interpretation:
- Jennifer's quality dropped nearly 10 percentage points in one week
- This represents an 11.5% degradation from her baseline
- Pattern: SUDDEN_PERFORMANCE_SHIFT (CRITICAL)
- Immediate Actions Required:
  1. Manager 1-on-1 conversation within 24 hours
  2. Assess personal/professional stressors
  3. Rule out health or safety concerns
  4. Review recent call recordings for pattern
  5. Consider temporary relief from certain call types
  6. Daily check-ins for next 2 weeks
  7. Monitor for continued decline or rapid recovery

Risk Assessment:
- If degradation continues: HIGH ATTRITION RISK
- If rapid recovery: Likely temporary personal issue (support required)
- If plateau at 72%: Possible skill regression (retraining needed)
```

---

## Combined Analysis Framework

### Recommended Analysis Sequence

1. **Start with AGENT_OUTLIER_QUALITY**
   - Identify agents significantly above/below organizational average
   - Separate elite performers from underperformers
   - Triage for immediate intervention

2. **Then review SUDDEN_PERFORMANCE_SHIFT**
   - Identify agents with recent deterioration (attrition risk)
   - Identify agents with recent improvement (replication opportunity)
   - Prioritize timing of interventions

3. **Cross-reference with FATIGUE_PATTERN**
   - Understand if underperformance is acute (fatigue) or chronic
   - Identify supportable issues (schedule) vs. deeper problems (skill/engagement)

4. **Examine SEASONAL_WEEKLY_PATTERN**
   - Understand if issues are structural (team composition, process design)
   - Identify opportunities for process-wide optimization

5. **Review INTRADAY_ANOMALY**
   - Optimize break timing and workload distribution organization-wide
   - Ensure high-complexity calls routed to peak performance hours

6. **Assess HIGH_VARIABILITY_ANOMALY**
   - Identify agents needing targeted skill development
   - Separate skill issues from schedule/personal factors

---

## Executive Summary Template

**Report Generated**: [Date]  
**Analysis Window**: 90 days  
**Organization**: [Name]  
**Total Agents Analyzed**: [N]  

### Key Findings

**Elite Performers** (Quality >85%, Stable)
- [Agent names] - Consider for training/mentoring roles
- Best practices documented for team replication

**Underperformers** (Quality <70%)
- [Agent names] - Immediate intervention plans required
- Root causes: [skill gap / fatigue / personal issues / etc]

**Fatigue Signals**
- Friday quality degradation: [Yes/No] - [magnitude]
- Weekend staffing impact: [Yes/No] - [magnitude]
- End-of-shift decline: [Hours affected] - [impact]

**Process Opportunities**
- Lunch Valley dip: [Yes/No] - Break optimization opportunity
- Optimal shift window: [Hours] - High-complexity call routing
- Process-wide variability: [High/Medium/Low] - Training effectiveness assessment

### Recommended Actions (Priority Order)

1. **Immediate** (24 hours)
   - [Specific 1-on-1 conversations with flagged agents]
   - [Safety/wellness assessments if needed]

2. **Short-term** (1-2 weeks)
   - [Coaching programs]
   - [Schedule adjustments]
   - [Call routing changes]

3. **Medium-term** (1-3 months)
   - [Team-wide process optimization]
   - [Training program implementation]
   - [Elite practice replication]

4. **Long-term** (3-6 months)
   - [Structural changes to workload/scheduling]
   - [Technology/tool improvements]
   - [Cultural initiatives]

---

## Data Quality Notes

- **Data Source**: db_audit.call_quality_assessment synced from Call Master
- **Completeness**: Check for agents with <20 calls in period (unreliable signal)
- **Timing**: All timestamps should align with operational calendar (consider DST)
- **Rounding**: Quality percentages typically 0-100%; verify for data errors
- **Missing Values**: NULL quality_percentage values excluded from calculations

---

## Troubleshooting

**Q: "Why is a top performer flagged as an outlier?"**
A: Because they're >2σ above average. This is positive and actionable—extract their practices for team replication.

**Q: "An agent shows high variability but average quality is okay. Do I still intervene?"**
A: Yes. Unpredictable performance is a management risk. Could mask skill gaps in specific call types or indicate personal stress. Investigate pattern and root cause.

**Q: "Fatigue detected, but agent says they're fine."**
A: Fatigue patterns are statistical trends, not subjective. Still warrant conversation. Ask about workload, breaks, and personal stressors. May require schedule adjustment even if agent hasn't self-reported.

**Q: "Quality drops Fridays organization-wide. Is this normal?"**
A: Yes, Friday fatigue is common. But it's still actionable—optimize schedules, workloads, or staffing to minimize impact. Don't accept it as inevitable.

**Q: "How do I distinguish between skill gaps and personal issues in high-variability agents?"**
A: Review call patterns:
- If variability correlates with specific call types → likely skill gap
- If variability correlates with specific hours/days → likely fatigue/stress
- If variability is random → likely personal stress affecting focus
- Use 1-on-1 conversation to triangulate findings

---

**Last Updated**: 2026-06-21  
**Next Review**: 2026-06-28 (weekly)
