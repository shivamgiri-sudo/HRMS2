# Call Quality Anomaly Detection System

**Version**: 1.0  
**Status**: Production Ready  
**Last Updated**: 2026-06-21  

---

## Quick Start

### Run Full Analysis (90-day window)

```bash
# Generate complete anomaly report
mysql -h [host] -u [user] -p mas_hrms < backend/scripts/call-quality-anomaly-detection.sql > anomaly-report.txt

# Filter for critical alerts only
mysql -h [host] -u [user] -p mas_hrms < backend/scripts/call-quality-anomaly-detection.sql \
  | grep -E "CRITICAL|HIGH|OUTLIER|FATIGUE" > critical-alerts.txt
```

### Run Daily Quick Check

```bash
# Get today's alerts in 30 seconds
mysql -h [host] -u [user] -p mas_hrms < backend/scripts/call-quality-anomaly-quick-ref.sql
```

### Export to CSV

```bash
mysql -h [host] -u [user] -p mas_hrms < backend/scripts/call-quality-anomaly-detection.sql \
  -B --skip-column-names > anomaly-report.csv
```

---

## File Overview

### Core SQL Queries

| File | Purpose | Execution Time | Output Rows |
|------|---------|-----------------|------------|
| `call-quality-anomaly-detection.sql` | Complete 6-query analysis | 30-60s | 50-500 |
| `call-quality-anomaly-quick-ref.sql` | Daily alerts (7 queries, fast) | 10-20s | 20-100 |
| `attrition-risk-analysis.sql` | (Existing) Attrition risk + quality data | 60-90s | 100-1000 |
| `process-team-optimization.sql` | (Existing) Process + shift optimization | 45-60s | 200-400 |

### Documentation

| File | Purpose | Audience |
|------|---------|----------|
| `CALL_QUALITY_ANOMALY_GUIDE.md` | Detailed interpretation guide | Managers, Analysts |
| `ANOMALY_DETECTION_INTEGRATION.md` | Backend API implementation | Developers |
| `README_ANOMALY_DETECTION.md` | This file - quick navigation | Everyone |

---

## Anomaly Types Explained

### 1. Agent Outliers
**What**: Agents whose quality is >2σ from organizational average  
**Why**: Identifies both elite performers and underperformers  
**Action**: Elite = replicate practices; Underperformers = coaching  
**Query**: Query 1 of `call-quality-anomaly-detection.sql`  
**Quick Check**: Not in quick-ref (runs in full analysis only)

### 2. Fatigue Patterns
**What**: Quality degradation after consecutive work days  
**Why**: Identifies burnout risk and schedule issues  
**Action**: Break optimization, workload adjustment, health check  
**Query**: Query 2 of `call-quality-anomaly-detection.sql`  
**Quick Check**: `FATIGUE_PATTERN` query in quick-ref

### 3. Seasonal Patterns
**What**: Systematic quality variations by day of week  
**Why**: Identifies structural issues (weekend staffing, Friday fatigue)  
**Action**: Team composition changes, strategic resource allocation  
**Query**: Query 3 of `call-quality-anomaly-detection.sql`  
**Quick Check**: Not in quick-ref (part of full analysis)

### 4. Intraday Anomalies
**What**: Hour-by-hour quality patterns (lunch valley, shift decline)  
**Why**: Enables targeted break/workload optimization  
**Action**: Break timing, reduced call complexity during valleys  
**Query**: Query 4 of `call-quality-anomaly-detection.sql`  
**Quick Check**: `SHIFT_HOTSPOT` query in quick-ref

### 5. High Variability
**What**: Agents with stddev >2x organization average  
**Why**: Indicates lack of skill mastery or emotional instability  
**Action**: Diagnostic assessment, individualized training  
**Query**: Query 5 of `call-quality-anomaly-detection.sql`  
**Quick Check**: `HIGH_VARIABILITY_TODAY` in quick-ref

### 6. Sudden Performance Shifts
**What**: Week-over-week changes >5%  
**Why**: Detects crises (personal issues, attrition risk) or improvements  
**Action**: 1-on-1 follow-up, support/recognition  
**Query**: Query 6 of `call-quality-anomaly-detection.sql`  
**Quick Check**: `WEEKLY_DEGRADATION` in quick-ref

---

## Severity Levels

### CRITICAL
- **Quality**: <60% (Agent Outliers) or Quality <60% (Fatigue)
- **Variability**: StdDev >2x organization average
- **Performance Shift**: >10% week-over-week change
- **Response Time**: Immediate (within 24 hours)
- **Action**: Manager escalation, 1-on-1, potential intervention

### HIGH
- **Quality**: 2-3σ below/above mean (Agent Outliers) or 60-65% (Fatigue)
- **Pattern**: Systematic (Friday fatigue, end-of-shift decline)
- **Response Time**: Priority (48-72 hours)
- **Action**: Coaching, schedule review, close monitoring

### MEDIUM
- **Quality**: 1-2σ from mean or 65-70% (Fatigue)
- **Variability**: StdDev 1.5-2x organization average
- **Performance Shift**: 5-10% week-over-week
- **Response Time**: Standard (1 week)
- **Action**: Monitoring, performance conversation, training

### LOW
- **Quality**: <1σ from mean
- **Response Time**: Routine (2+ weeks)
- **Action**: Observation, no immediate intervention

---

## Interpretation Examples

### Example 1: Elite Performer
```
Agent: Sarah Johnson
Avg Quality: 87.3%
Org Avg: 78.5%
StdDev Distance: 2.8σ
Severity: CRITICAL (elite)
Performance: ELITE_PERFORMER

Action: Replicate practices across team
- Review her call techniques
- Create peer coaching program
- Consider for trainer/mentor role
- Document best practices
```

### Example 2: Underperformer
```
Agent: John Smith
Avg Quality: 65.2%
Org Avg: 78.5%
StdDev Distance: 2.1σ
Severity: HIGH
Performance: UNDERPERFORMER

Action: Mandatory coaching + monitoring
- Immediate manager 1-on-1
- Call review to identify gaps
- Skill assessment
- 30-day improvement plan
- Daily check-ins
```

### Example 3: Friday Fatigue
```
Agent: Mike Brown
Friday Quality: 68.5%
Thursday Quality: 76.2%
Drop: -7.7%
Severity: MEDIUM
Pattern: FRIDAY_FATIGUE

Action: Optimize Friday workload
- Shift calls to earlier in week
- Advance Friday break times
- Reduce call complexity Friday afternoon
- Weekend incentive program
```

### Example 4: Lunch Valley
```
Hour: 12:00-13:00
Avg Quality: 72.3%
Org Avg: 78.5%
Delta: -6.2%
Severity: HIGH
Pattern: LUNCH_VALLEY_DIP

Action: Optimize break timing
- Stagger lunch breaks (11:30-12:30, 12:30-13:30)
- Reduce complex calls 12-13
- Provide nutrition/hydration
- Consider different break rotation
```

### Example 5: Sudden Drop
```
Agent: Jennifer Williams
Last Week: 81.8%
This Week: 72.4%
Change: -9.4% (-11.5%)
Severity: CRITICAL
Direction: PERFORMANCE_DEGRADATION

Action: Immediate intervention
- Manager 1-on-1 within 24 hours
- Assess personal/professional stress
- Rule out health concerns
- Identify specific trigger
- Daily check-ins for 2 weeks
- Monitor for continued decline (attrition risk)
```

---

## Operational Workflows

### Daily Morning Check (5 minutes)

1. Run quick-ref query: `call-quality-anomaly-quick-ref.sql`
2. Look for:
   - `TODAY_ALERTS`: Agents below 70% today
   - `CRITICAL` severity in any query
   - `PROCESS_HOTSPOT`: Processes struggling
3. Actions:
   - Flag agents for 1-on-1s
   - Notify process managers
   - Check for systemic issues

### Weekly Analysis (30 minutes)

1. Run full query: `call-quality-anomaly-detection.sql`
2. Focus on:
   - `SUDDEN_PERFORMANCE_SHIFT`: Week-over-week changes
   - `AGENT_OUTLIER_QUALITY`: New or changing outliers
   - `SEASONAL_WEEKLY_PATTERN`: Day-of-week trends
3. Actions:
   - Update coaching programs
   - Adjust schedules based on patterns
   - Plan interventions for following week

### Monthly Leadership Review (1 hour)

1. Consolidate:
   - Trends across all anomaly types
   - Process-level patterns
   - Resource allocation recommendations
2. Focus on:
   - Process optimization
   - Team composition
   - Strategic resource planning
3. Outcomes:
   - Updated forecasts
   - Process improvement initiatives
   - Training program enhancements

---

## Integration with Other Systems

### Call Master Integration
- `db_audit.call_quality_assessment` is synced from Call Master
- Data lag: 1-4 hours (verify with your sync schedule)
- Quality percentage: 0-100, calculated by Call Master

### Attrition Risk Analysis
- Combine SUDDEN_PERFORMANCE_SHIFT with ATTRITION_RISK_ANALYSIS_SUMMARY.md
- Quality degradation + high attrition indicators = retention urgency

### Process Optimization
- Use INTRADAY_ANOMALY insights with `process-team-optimization.sql`
- Match high-variability agents to specific processes
- Optimize shift assignments based on performance patterns

### Training & Development
- AGENT_OUTLIER_QUALITY feeds into mentor assignments
- HIGH_VARIABILITY_ANOMALY feeds into skill gap analysis
- SEASONAL_PATTERNS inform optimal call routing training

---

## Dashboard Integration

### Quick Status Widget
```
Organization Quality Status
├─ 7-Day Average: 77.2%
├─ Today's Calls: 2,847
├─ Active Agents: 145
├─ Critical Alerts: 3
└─ Agents Below Target: 12
```

### Alert Cards (Prioritized)
```
CRITICAL: Sarah (SUDDEN_SHIFT) - Quality down 11.5% from baseline
HIGH: John (OUTLIER) - Quality 2.1σ below org average
HIGH: Lunch Valley Dip - 12-13 hrs quality down 6.2%
MEDIUM: Friday Fatigue - All agents -3.7% on Friday
```

### Drill-Down Views
- Agent Detail: All anomalies for single agent
- Process Detail: All anomalies for single process
- Hour-by-Hour: Intraday pattern with recommendations
- Week Comparison: This week vs. previous 4 weeks

---

## Performance & Optimization

### Query Performance
- Single agent outlier: ~150ms
- Dashboard summary: ~300ms
- Full 6-query analysis: ~45-60s
- Create indexes first (see ANOMALY_DETECTION_INTEGRATION.md)

### Caching Strategy
- Outliers: Cache 5 minutes (update frequently)
- Seasonal patterns: Cache 1 hour (stable)
- Dashboard summary: Cache 15 minutes (real-time view)
- Invalidate cache when new quality data arrives

### Database Optimization
```sql
-- Must-have indexes for performance
CREATE INDEX idx_quality_calldate ON db_audit.call_quality_assessment(CallDate);
CREATE INDEX idx_quality_user ON db_audit.call_quality_assessment(User);
CREATE INDEX idx_quality_user_date ON db_audit.call_quality_assessment(User, CallDate);
CREATE INDEX idx_quality_campaign ON db_audit.call_quality_assessment(Campaign);
```

---

## Troubleshooting

### "No anomalies detected"
- Check: Is `db_audit.call_quality_assessment` populated?
- Verify: Call Master sync is running
- Check date range: Last 90 days has data?

### "Query takes >60 seconds"
- Check: Are indexes created? (see above)
- Verify: MySQL not under load
- Consider: Reduce date window to 30 days for testing

### "High variability agents don't seem problematic"
- Remember: High variability doesn't mean low average quality
- Check: Mix of call types? Different hours?
- Action: Do call review across their shift pattern

### "I'm not seeing Friday fatigue in my data"
- Check: Your organization's work schedule (Monday-Friday?)
- Verify: Sufficient Friday data (n>30 calls)
- Consider: Your customer base might have different patterns

### "Outlier quality seems wrong"
- Verify: `org_stddev` is calculated correctly (check raw query output)
- Check: Are there agents with <20 calls skewing the average?
- Consider: Process-specific analysis (QUERY 1 filters by Campaign)

---

## Advanced Customization

### Change Statistical Threshold
In queries, modify:
```sql
-- Default: 2σ
WHEN ABS(avg - org_avg) > (2 * org_stddev) THEN 'HIGH'

-- Custom: 1.5σ (more sensitive)
WHEN ABS(avg - org_avg) > (1.5 * org_stddev) THEN 'HIGH'
```

### Extend Analysis Period
In all queries, modify:
```sql
-- Default: 90 days
WHERE CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)

-- Custom: 180 days (longer trend analysis)
WHERE CallDate >= DATE_SUB(NOW(), INTERVAL 180 DAY)
```

### Filter by Process
Add to WHERE clause:
```sql
AND Campaign = 'Billing'  -- Single process
AND Campaign IN ('Billing', 'Collections')  -- Multiple
```

### Filter by Agent
Add to WHERE clause:
```sql
AND e.employee_code = 'EMP001'  -- Single agent
AND e.employee_code IN ('EMP001', 'EMP002')  -- Multiple
```

---

## Compliance & Audit

### Data Privacy
- Query results contain employee PII (names, codes)
- Restrict query access to authorized roles only
- Audit all exports for compliance

### Retention
- Raw quality data: 2+ years (per regulatory requirement)
- Analysis reports: 1 year
- Alert logs: Permanent (audit trail)

### Audit Logging
- Log all: Query executions, exports, 1-on-1 conversations
- Track: Who accessed what data, when, for what reason
- Report: Weekly audit summary to compliance

---

## Support & Escalation

### Getting Help
1. Check `CALL_QUALITY_ANOMALY_GUIDE.md` for interpretation
2. Review integration docs: `ANOMALY_DETECTION_INTEGRATION.md`
3. See troubleshooting section above
4. Contact: [Engineering Team]

### Reporting Issues
- Query performance: [Database Admin]
- Dashboard display: [Frontend Team]
- Data accuracy: [Call Master Integration]
- Alert notifications: [DevOps]

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-06-21 | Initial release: 6 anomaly types, quick-ref queries, full analysis guide |

---

## Files Manifest

```
backend/scripts/
├── call-quality-anomaly-detection.sql         (Main analysis - 6 queries)
├── call-quality-anomaly-quick-ref.sql         (Daily checks - 7 fast queries)
├── CALL_QUALITY_ANOMALY_GUIDE.md              (Interpretation guide)
├── ANOMALY_DETECTION_INTEGRATION.md           (Backend API implementation)
└── README_ANOMALY_DETECTION.md                (This file)
```

---

**Next Steps**:
1. Run quick-ref query to test connectivity
2. Review CALL_QUALITY_ANOMALY_GUIDE.md for interpretation
3. Set up daily monitoring with quick-ref queries
4. Plan backend API integration (see ANOMALY_DETECTION_INTEGRATION.md)
5. Deploy dashboard widgets
6. Train managers on responding to anomalies

---

**Report Generated**: 2026-06-21  
**Status**: Production Ready  
**Last Updated**: 2026-06-21
