# Phase 7.1: Individual Agent Quality Dashboard (Inbound Calls) — Design Specification

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task with two-stage review (spec compliance + code quality).

**Goal:** Build real-time quality insights dashboard enabling Inbound call agents to self-monitor performance, identify weaknesses, review problem calls, and track improvement trends.

**Architecture:** Modular REST API (4 endpoints) serving a responsive React dashboard. Data sourced from db_audit.call_quality_assessment + mas_hrms.employees. All calculations based on binary quality flags (no schema changes). Redis caching at 2-10 min TTL. Agent sees only own data; RM/TL/CEO override in Phase 7.2.

**Tech Stack:** React 18 + TypeScript + Tailwind + ApexCharts (frontend). Express + TypeScript + Redis (backend). MySQL (db_audit, mas_hrms).

---

## 1. System Architecture

### Data Flow
```
Frontend (React)
  ↓ (parallel load 4 APIs)
Backend (Express 4 endpoints)
  ↓ (check Redis cache, else query)
MySQL (db_audit + mas_hrms)
  ↓ (aggregations, LEFT JOINs)
Response → Frontend render
```

### Backend Services

**Quality Aggregation Service** (`backend/src/modules/quality-dashboard/quality-aggregation.service.ts`)
- Query builder for call_quality_assessment
- Binary flag → dimensional score calculations
- Agent rank/peer avg via window functions
- Redis caching layer

**Employee Mapping Service** (`backend/src/modules/quality-dashboard/employee-mapping.service.ts`)
- JOIN call_quality_assessment.User → mas_hrms.employees.employee_code
- Handle NULL/empty User field gracefully
- Return agent_name (full_name preferred, fallback to employee_code)

### Frontend Architecture

**Page:** `src/pages/AgentQualityDashboard.tsx`
- Auth gate: Only agents viewing own data
- Parallel fetch hook: `useAgentQualityData()`
- Error states: ScoringPending, NoCalls, DataError
- Loading states per section (hero, weakness, table)

**Components:** HeroCard, QuickWins, WeaknessPanel, TrendPanel, CallsTable, CallDetailModal

**Responsive:** Desktop = 2-col grid, Mobile = stacked vertical

---

## 2. API Contracts

### 2.1 GET /api/agent/cq-score

**Auth:** Requires agent role, only access own data

**Query:** Last 7 days Inbound calls for authenticated agent

**Response:**
```json
{
  "cq_score_current": 85,
  "cq_score_7day_avg": 83,
  "cq_score_30day_avg": 81,
  "cq_score_clean": 87,
  "rank": { "position": 15, "total_agents": 120 },
  "peer_avg": 82,
  "target": 90,
  "gap_pct": -5,
  "trend_7day": { "direction": "↗", "change_pct": 3 },
  "trend_30day": { "direction": "↘", "change_pct": -1 },
  "weekly": [
    { "day": "Monday", "avg": 80, "calls": 12 },
    { "day": "Tuesday", "avg": 84, "calls": 14 }
  ],
  "status": "On Track",
  "last_updated": "2026-05-30T14:47:00Z"
}
```

**Calculation Logic:**
- `cq_score_current` = AVG(quality_percentage) last 7 days
- `rank` = ROW_NUMBER() OVER (ORDER BY cq_score_current DESC) for all Inbound agents
- `peer_avg` = AVG(quality_percentage) all Inbound agents, same period
- `cq_score_clean` = AVG(quality_percentage) WHERE NOT (professionalism_maintained=0 AND active_listening=0)
- `weekly` = Day-wise breakdown Mon-Sun (rolling 7 days)

**Error Responses:**
- 403 Forbidden: Attempting to view peer's data
- 500 Service Down: Retry with cached data <5 min old

---

### 2.2 GET /api/agent/weakness-detail

**Response:**
```json
{
  "weakness_areas": [
    {
      "category": "Soft Skills",
      "score": 62,
      "peer_avg": 78,
      "gap": -16,
      "sub_metrics": [
        { "name": "Active Listening", "score": 58, "peer_avg": 75, "calls_weak": 8 },
        { "name": "Professionalism", "score": 65, "peer_avg": 80, "calls_weak": 6 }
      ],
      "related_calls": [
        { "call_id": "684407", "date": "2026-05-30", "cq_pct": 62, "weakness_score": 55 }
      ]
    }
  ],
  "last_updated": "2026-05-30T14:47:00Z"
}
```

**Calculation Logic:**
- **Opening %** = (call_answered_within_5_seconds) × 100
- **Soft Skills %** = (professionalism_maintained + active_listening + enthusiasm_and_no_fumbling) / 3 × 100
- **Hold Procedure %** = (proper_hold_procedure + dead_air_under_10_seconds) / 2 × 100
- **Resolution %** = (accurate_issue_probing + proper_grammar) / 2 × 100
- **Closing %** = (proper_call_closure + further_assistance_offered) / 2 × 100
- Return top 5 weakness areas (lowest scores first)
- For each, find 5 calls where that specific dimension failed

---

### 2.3 GET /api/agent/calls-review?limit=10&offset=0&sort=date|cq|fatal

**Query Params:**
- `limit` (default 10, max 50)
- `offset` (pagination)
- `sort` (date DESC, cq ASC, fatal DESC)

**Response:**
```json
{
  "total_calls": 145,
  "page": { "limit": 10, "offset": 0, "has_next": true },
  "calls": [
    {
      "call_id": "684407",
      "date": "2026-05-30T14:23:00Z",
      "lead_id": "684407",
      "lead_name": "Acme Corp",
      "scenario": "Query",
      "cq_pct": 62,
      "has_fatal": true,
      "fatal_reason": "active_listening=0 AND cq<50",
      "duration_sec": 1440,
      "agent_name": "CHHAVI KAPOOR"
    }
  ],
  "last_updated": "2026-05-30T14:47:00Z"
}
```

**Fatal Definition:**
```
has_fatal = (quality_percentage < 50) AND (professionalism_maintained = 0 OR active_listening = 0)
```

---

### 2.4 GET /api/agent/call/:callId/detail

**Response:**
```json
{
  "call_id": "684407",
  "date": "2026-05-30T14:23:00Z",
  "lead": { "id": "684407", "name": "Acme Corp" },
  "duration_sec": 1440,
  "scenario": "Query",
  "cq_pct": 62,
  "has_fatal": true,
  "sub_scores": {
    "opening": 75,
    "soft_skills": 58,
    "hold_procedure": 70,
    "resolution": 70,
    "closing": 65
  },
  "recording": {
    "url": "https://recordings.internal/call_684407",
    "duration_sec": 1440
  },
  "transcript": {
    "text": "[full transcript or preview]"
  },
  "feedback": "Customer objection not acknowledged. Try empathetic response...",
  "peer_comparison": {
    "same_scenario_avg": 72,
    "your_score": 62,
    "gap": -10,
    "peer_note": "Raj handled similar call 684399 (78%)"
  }
}
```

**Note:** Recording URL is mock for Phase 7.1 (https://recordings.internal/call_{callId}). Real integration Phase 7.2.

---

## 3. Database Schema (No Changes Required)

**Table: db_audit.call_quality_assessment**

Existing columns used:
- `id` (INT) — unique call ID
- `User` (VARCHAR) — agent code (e.g., 'EMP-STF-001')
- `quality_percentage` (DECIMAL) — overall score 0-100
- `CallDate` (DATETIME) — call timestamp
- `Campaign` (VARCHAR) — process/campaign code (e.g., 'INBOUND_SUPPORT')
- Binary flags (TINYINT 0/1):
  - `call_answered_within_5_seconds`
  - `professionalism_maintained`
  - `active_listening`
  - `enthusiasm_and_no_fumbling`
  - `proper_hold_procedure`
  - `dead_air_under_10_seconds`
  - `accurate_issue_probing`
  - `proper_grammar`
  - `proper_call_closure`
  - `further_assistance_offered`

**Table: mas_hrms.employees**

Used for name mapping:
- `employee_code` (VARCHAR, UNIQUE) — matches User field
- `full_name` (VARCHAR GENERATED) — display name
- `first_name`, `last_name`
- `process_id` (CHAR) — process assignment
- `reporting_manager_id` (CHAR) — RM for drill-down Phase 7.2

**Joins:**
```sql
LEFT JOIN mas_hrms.employees e ON e.employee_code = cqa.User
WHERE cqa.Campaign LIKE 'INBOUND%'
  AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)
  AND cqa.User = ?  -- auth: agent's own code
```

---

## 4. Frontend Components

### HeroCard
- **Input:** cq_score_current, rank, target, trend_7day, status
- **Output:** Gauge chart (0-100) + KPI cards
- **Chart:** ApexCharts RadialBar (gauge)
- **Colors:** Green ≥80, Yellow 70-79, Red <70
- **Responsive:** Full width

### QuickWins
- **Input:** calls awaiting review count, coaching flags, top weakness, etc
- **Output:** 6 action pill buttons
- **Actions:** View reviews, View coaching, View weakness, etc
- **Responsive:** Wrap on mobile

### WeaknessPanel
- **Input:** weakness_areas array, weekly breakdown, 7d/30d trend
- **Layout:** Left 60% (weakness detail) + Right 40% (trends)
- **Charts:** 7d line chart (ApexCharts), 30d bar (you vs peer), weekly bars
- **Mobile:** Stack vertical

### CallsTable
- **Input:** paginated calls array, sort option
- **Columns:** Date, Lead, CQ%, Flags (has_fatal badge), Action
- **Interactions:** Row click → CallDetailModal (lazy load)
- **Pagination:** 10 per page, next/prev buttons
- **Sorting:** Click header to sort date/cq/fatal

### CallDetailModal
- **Input:** call detail object
- **Sections:**
  1. Header: Lead | Date | Duration | CQ%
  2. Recording: Mock player + duration
  3. Sub-scores: 5 gauges (Opening, Soft Skills, Hold, Resolution, Closing)
  4. Feedback: Coach comment
  5. Peer comparison: Similar call reference
- **Close button:** [X] or backdrop click

### Empty States
- **NoCalls:** "Your first calls will appear here" + link to training
- **ScoringPending:** "1 call pending quality review" + estimated time
- **DataError:** "Quality data unavailable, retry in 5 min" + contact support

---

## 5. Caching Strategy

**Redis TTL by endpoint:**

| Endpoint | TTL | Rationale |
|----------|-----|-----------|
| `/cq-score` | 5 min | Expensive aggregation (window functions) |
| `/weakness-detail` | 10 min | Less frequently changing |
| `/calls-review` | 2 min | Updates frequently as new calls scored |
| `/call/:id/detail` | No cache | Single row, direct fetch |

**Cache key pattern:**
```
agent_quality:cq_score:{employee_code}:{date}
agent_quality:weakness:{employee_code}:{date}
agent_quality:calls_review:{employee_code}:{sort}:{limit}:{offset}
```

**Invalidation:** On new call score created/updated (fire event → invalidate keys)

---

## 6. Authorization & Data Access

**Auth checks:**
- Agent role required
- Only access own employee_code
- Process filter: WHERE Campaign LIKE 'INBOUND%'

**Error handling:**
- 403: Unauthorized agent attempt
- 500: Service failure + fallback to cached data <5 min old
- 404: Call not found

**Audit:**
- Log all dashboard views (employee_code, timestamp, IP) for compliance

---

## 7. Error Handling & Fallback

**Service Down:**
- Return 503 + cached response if <5 min old
- Show banner: "Quality data temporarily unavailable, using cached data from X time ago"
- Retry button: Refresh dashboard

**No Data:**
- 200 response with empty arrays (not error)
- Show empty state component (NoCalls, ScoringPending, etc)

**NULL User field:**
- Queries filter: WHERE User IS NOT NULL AND User != ''
- Unscored calls excluded from aggregations

---

## 8. Data Freshness & Latency

**Scoring lag:** <2 hours assumed (from call_quality_assessment schema design)
- Call recorded 2:00 PM → Scored 3:30 PM → Dashboard updated 3:35 PM (Redis refresh)
- Display note: "Last updated ~1 hour ago (updated hourly)"

**Weekly breakdown:** Mon-Sun rolling (not calendar week)

**Trend calculation:** 7-day uses AVG, not sum (normalized per agent's call volume)

---

## 9. Testing Strategy

**Unit tests:**
- Calculation logic: dimensional scores from binary flags
- Rank/peer avg calculation
- Null handling in agent name mapping
- Cache key generation

**Integration tests:**
- Full API flow: cq-score → weakness-detail → calls-review → call detail
- Auth gate (agent can't view peer)
- Error responses (service down, no data, invalid sort)
- Empty states (NoCalls, ScoringPending)

**E2E tests (post-Phase 7.1):**
- Agent opens dashboard → sees hero + weakness → clicks call → modal opens
- Mobile responsive: stacked layout, charts simplified
- Data freshness: "Last updated X ago" displays correctly

---

## 10. Known Limitations & Phase 7.2 Blockers

1. **Recording URLs mock:** Real integration requires storage connector
2. **Feedback comments mock:** Real feedback from coaching team TBD
3. **Peer name/comparison detailed:** Shows only score, not full context
4. **No multi-process:** Phase 7.1 is Inbound only; Phase 7.2 adds Outbound/Chat/Email/Backoffice
5. **No RM override:** RM/TL viewing team data Phase 7.2

---

## 11. Success Criteria

- ✅ Agent sees own CQ% + rank + peer avg in hero card
- ✅ Dashboard displays top 5 weakness areas with drill-down
- ✅ Calls table paginated, sortable, tappable for detail
- ✅ Detail modal shows recording (mock) + sub-scores + feedback (mock)
- ✅ Mobile responsive (stacked, charts simplified)
- ✅ <2 second page load (caching + parallel API fetch)
- ✅ Auth gate: agent can't see peer data
- ✅ All 4 APIs return correct shapes per contract
- ✅ Error states render gracefully (ScoringPending, NoCalls, DataError)
- ✅ Data freshness note displays ("Last updated X ago")

---

**Status:** Ready for implementation. Invoke writing-plans skill to generate Phase 7.1 task breakdown.
