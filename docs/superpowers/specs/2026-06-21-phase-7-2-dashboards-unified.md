# Phase 7.2 + Enhanced Dashboards: Unified Specification

**Goal:** Build Phase 7.2 (multi-role quality dashboard) + 3 new executive dashboards (Operations, Management, Agent Performance).

**Architecture:** Extend Phase 7.1 foundation. Reuse query builders, cache, auth. Add role-based views.

**Tech Stack:** React 18 + TS + Tailwind + Recharts. Express + TS + MySQL. Same stack as Phase 7.1.

---

## Dashboards Overview

### 1. Phase 7.2: Quality Dashboard (Multi-Role + Multi-Process)

**Goal:** Extend Phase 7.1 (Agent view Inbound-only) to all roles + all processes.

**Scope:**
- **Agent view:** Phase 7.1 (completed) + Outbound/Chat/Email/Backoffice process tabs
- **RM/TL view:** Team performance (direct reports), drill-down capability
- **QA Manager view:** All-process quality audit, anomaly detection, risk matrix
- **CEO view:** Quality vs targets, quality trends, top/bottom performers

**Data:** Same db_audit.call_quality_assessment + Shivamgiri APR. Add process filtering.

**API changes:**
- Existing 4 endpoints stay same (agent view)
- Add: `/api/manager/team-quality` (RM/TL)
- Add: `/api/qa/quality-audit` (QA Manager)
- Add: `/api/executive/quality-summary` (CEO)

---

### 2. Operations Dashboard (WFM + Roster + Live Tracking)

**Goal:** Real-time operations visibility: roster, shrinkage, attrition risk, live status.

**Scope:**
- **Live status:** Agents logged in, in-call, on break, idle (real-time via WebSocket)
- **Roster:** Current vs planned allocation, utilization %, shrinkage forecast
- **Attrition risk:** At-risk agents (resignation signals), retention actions
- **Process metrics:** Calls queued, avg wait time, answer rate, abandonment %

**Data sources:** mas_hrms (employees), wfm_attendance_session (live), salary_prep_line (payroll), Shivamgiri APR (productivity)

**Key components:**
- Live agent status heatmap (grid: agents × status)
- Roster vs actual bar chart
- Shrinkage trend (7-day rolling)
- At-risk agent list (scores 0-100)
- Process queue metrics (real-time)

---

### 3. Management Dashboard (Team Performance + Payroll + Quality)

**Goal:** Manager view of team health: quality, productivity, payroll, retention.

**Scope:**
- **Team overview:** Headcount, utilization, cost, quality score
- **Individual metrics:** Each agent: quality %, cost, productivity, attendance, attrition risk
- **Payroll health:** Monthly cost, cost per quality point, over/under budget
- **Training gaps:** Agents needing upskilling (low quality + new joiners)

**Data sources:** mas_hrms (employees), salary_prep_line (payroll), db_audit (quality), Shivamgiri APR (productivity)

**Key components:**
- Team scorecard (key metrics summary)
- Agent performance table (quality, cost, risk, actions)
- Payroll trend chart (30-day cost projection)
- Training needs list (by skill gap)

---

### 4. Agent Performance Dashboard (Individual Agent Comprehensive View)

**Goal:** Agent self-monitoring (expanded beyond quality): quality, productivity, payroll, training, recognition.

**Scope:**
- **Quality deep-dive:** CQ% breakdown, weak areas, improvement plan
- **Productivity:** Calls handled, talk time, resolution rate, efficiency score
- **Earnings:** Monthly salary, incentives, deductions, net pay (aggregate view only, no PII)
- **Training:** Courses assigned, completion %, certifications, skill gaps
- **Recognition:** Performance badges, peer rankings, manager notes

**Data sources:** db_audit (quality), Shivamgiri APR (productivity), salary_prep_line (aggregates), LMS (training), mas_hrms (recognition)

**Key components:**
- Quality gauge + trend
- Productivity scorecard (calls, AHT, resolution)
- Earnings summary (monthly YTD)
- Training progress (courses, certifications)
- Badges + rankings

---

## Phase 7.2 Technical Details

### Enhanced Quality Dashboard APIs

**GET /api/manager/team-quality**
- Query: All calls for RM/TL's direct reports (last 7 days)
- Response: Team summary + per-agent breakdown
- Auth: requireRole('RM') or requireRole('TL')

**GET /api/qa/quality-audit**
- Query: All calls across all processes (configurable date range)
- Response: Quality metrics by process + anomalies + risk matrix
- Auth: requireRole('QA')

**GET /api/executive/quality-summary**
- Query: Org-wide quality + top/bottom performers
- Response: Quality vs targets, trend, top/bottom 10 agents
- Auth: requireRole('CEO') or requireRole('ADMIN')

### Multi-Process Support

**Existing code:** Filters by Campaign LIKE 'INBOUND%'

**Change:** Add process parameter to queries
- `process` param: 'INBOUND' | 'OUTBOUND' | 'CHAT' | 'EMAIL' | 'BACKOFFICE'
- Default: 'INBOUND' (backward compat)
- UI: Process tabs on dashboard

### Frontend Enhancements

**Role-based routing:**
- `/quality/my-dashboard` (Agent - Phase 7.1)
- `/quality/team` (RM/TL)
- `/quality/audit` (QA Manager)
- `/quality/executive` (CEO)

**Process tabs:** All views have process selector (dropdown/buttons)

---

## Operations Dashboard Technical Details

### APIs

**GET /api/operations/live-status**
- Query: wfm_attendance_session (live), employees (agent names)
- Response: {agent_id, agent_name, status (in_call|on_break|idle|logged_out), duration, call_id}
- Refresh: 10-second polling or WebSocket

**GET /api/operations/roster-vs-actual**
- Query: wfm_roster_master (planned), wfm_attendance_session (actual)
- Response: {process, planned_allocation, current_allocation, utilization_pct, shrinkage_forecast}
- Refresh: 5-minute (less volatile)

**GET /api/operations/attrition-risk**
- Query: Custom scoring model (mas_hrms + metrics)
- Response: {agent_id, agent_name, risk_score (0-100), signals: [resignation_letter, attendance_drop, quality_decline], retention_action}
- Refresh: 1-hour (stable metric)

**GET /api/operations/process-queue**
- Query: db_external (CallDetails - live call queue from dialer)
- Response: {process, calls_queued, avg_wait_sec, answer_rate_pct, abandonment_pct}
- Refresh: 10-second

### Frontend Components

**LiveStatusHeatmap:** Agent grid, color-coded by status (green=in-call, yellow=break, gray=idle, red=offline)

**RosterChart:** Stacked bar (planned vs actual allocation)

**AttritionRiskList:** Sortable table (risk score DESC)

**QueueMetrics:** KPI cards (queued, wait time, answer rate, abandonment)

---

## Management Dashboard Technical Details

### APIs

**GET /api/manager/team-overview**
- Response: {team_size, utilization_pct, avg_quality, monthly_cost, at_risk_count}

**GET /api/manager/agent-performance**
- Response: Array of {agent_id, agent_name, quality_pct, cost_per_call, calls_handled, talk_time_avg, resolution_rate, attendance_pct, risk_score, action_needed}

**GET /api/manager/payroll-projection**
- Response: {current_month_cost, ytd_cost, monthly_projection, budget_status (on_track|over|under), cost_per_quality_point}

**GET /api/manager/training-needs**
- Response: Array of {agent_id, agent_name, skill_gaps: [skill, gap_level], courses_recommended, priority}

### Frontend Components

**TeamScorecard:** KPI cards (headcount, utilization, quality, cost)

**AgentPerformanceTable:** Sortable (quality, cost, risk, actions)

**PayrollChart:** Line chart (cost trend) + projection

**TrainingList:** Skill gaps + recommended courses

---

## Agent Performance Dashboard Technical Details

### APIs

**GET /api/agent/comprehensive-performance**
- Response: {quality_summary, productivity_metrics, earnings_aggregate, training_progress, recognition}

**GET /api/agent/productivity-detail**
- Response: {calls_handled, talk_time_avg, after_call_work, resolution_rate, efficiency_score}

**GET /api/agent/training-progress**
- Response: {courses: [{course_id, course_name, progress_pct, completion_date}], certifications: [...]}

**GET /api/agent/recognition**
- Response: {badges: [...], ranking_vs_peers, manager_notes}

### Frontend Components

**QualityGauge:** Same as Phase 7.1 HeroCard

**ProductivityScorecard:** Calls, AHT, resolution, efficiency

**EarningsSummary:** Monthly salary, YTD, incentives (no PII)

**TrainingProgress:** Course cards with progress bars

**RecognitionBadges:** Visual badges + peer ranking

---

## Implementation Tracks

**Track A (Phase 7.2 APIs):** 2-3 days
**Track B (Operations Dashboard):** 3-4 days  
**Track C (Management Dashboard):** 2-3 days
**Track D (Agent Performance Dashboard):** 2-3 days
**Integration + Testing:** 2 days

**Parallel execution:** A+B+C+D = ~5 days wall-clock (vs 12 serial)

---

## Success Criteria

- ✅ All 12+ new APIs functional
- ✅ All 4 dashboards responsive (mobile-tested)
- ✅ Auth enforcement (role-based routing)
- ✅ Real-time updates (10-60 sec polling or WebSocket)
- ✅ <3s page load (caching + optimization)
- ✅ 100+ new tests (unit + E2E)
- ✅ 0 TypeScript errors
- ✅ No schema migrations (existing tables)

---

**Ready to implement in parallel tracks?**
