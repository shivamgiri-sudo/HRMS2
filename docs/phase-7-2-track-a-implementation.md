# Phase 7.2 Track A - Multi-Role Quality Dashboard APIs Implementation

**Status:** COMPLETE  
**Date:** 2026-06-21  
**Implementation:** TDD (Test-Driven Development)

---

## Summary

Implemented 3 role-based quality dashboard APIs for BPO operational visibility and quality management. All APIs use MySQL `db_audit.call_quality_assessment` table + `mas_hrms.employees` for agent data. Multi-process support via query parameters. No schema migrations required.

---

## Task A1: Manager/TL Quality API ✓

**Endpoint:** `GET /api/manager/team-quality`

**Auth:** `requireRole(['process_manager', 'team_leader'])`

**Query Parameters:**
- `daysBack` (1-365, default 7): Historical lookback period
- `process` (default INBOUND): Process filter (INBOUND|OUTBOUND|CHAT|EMAIL|BACKOFFICE)

**Response Structure:**
```json
{
  "success": true,
  "data": {
    "team_summary": {
      "avg_quality": 82.5,
      "agent_count": 12,
      "calls_handled": 1250,
      "top_performer": { "agent_code": "AG001", "agent_name": "John Doe", "quality": 95.5 },
      "bottom_performer": { "agent_code": "AG012", "agent_name": "Jane Smith", "quality": 68.3 },
      "quality_distribution": { "excellent": 5, "good": 4, "average": 2, "poor": 1 }
    },
    "agent_breakdown": [
      {
        "agent_code": "AG001",
        "agent_name": "John Doe",
        "quality_pct": 95.5,
        "calls_handled": 105,
        "weak_areas": [],
        "coaching_needed": false,
        "risk_score": 30
      }
    ],
    "last_updated": "2026-06-21T09:35:00Z",
    "filter": { "daysBack": 7, "process": "INBOUND" }
  }
}
```

**Implementation Files:**
- Service: `backend/src/modules/quality-dashboard/quality-manager.service.ts`
- Routes: `backend/src/modules/quality-dashboard/quality-manager.routes.ts`
- Tests: `backend/tests/quality-manager.routes.test.ts` (7 tests)

**Key Features:**
- Retrieves direct reports via reporting_manager_id join
- Calculates team statistics (avg, distribution, performers)
- Identifies weak areas (Communication, Problem Resolution, Consistency)
- Risk scoring: <70%=80, <75%=65, <80%=50, <85%=35, else 30
- Returns per-agent breakdown for detailed visibility

---

## Task A2: QA Manager Quality Audit API ✓

**Endpoint:** `GET /api/qa/quality-audit`

**Auth:** `requireRole(['qa'])`

**Query Parameters:**
- `daysBack` (1-365, default 7): Historical lookback period
- `process` (optional): Process filter

**Response Structure:**
```json
{
  "success": true,
  "data": {
    "summary": {
      "total_calls_audited": 5240,
      "avg_quality_score": 81.2,
      "compliance_rate": 82,
      "audit_period": {
        "start_date": "2026-06-14",
        "end_date": "2026-06-21"
      }
    },
    "process_metrics": [
      {
        "process": "INBOUND",
        "avg_quality": 83.5,
        "call_count": 2100,
        "agent_count": 45,
        "quality_distribution": { "excellent": 850, "good": 700, "average": 400, "poor": 150 },
        "anomalies": [],
        "risk_level": "Low"
      }
    ],
    "anomalies": [
      {
        "type": "quality_drop",
        "severity": "High",
        "agent_code": "AG025",
        "agent_name": "Robert Johnson",
        "description": "Quality score dropped from 85% to 62%",
        "metric_value": 62,
        "expected_value": 85,
        "deviation_pct": 27
      }
    ],
    "risk_matrix": {
      "high_risk_count": 2,
      "medium_risk_count": 3,
      "low_risk_count": 4
    },
    "last_updated": "2026-06-21T09:35:00Z",
    "filter": { "daysBack": 7, "process": "All" }
  }
}
```

**Implementation Files:**
- Service: `backend/src/modules/quality-dashboard/quality-qa.service.ts`
- Routes: `backend/src/modules/quality-dashboard/quality-qa.routes.ts`
- Tests: `backend/tests/quality-qa.routes.test.ts` (5 tests)

**Key Features:**
- Org-wide quality metrics across all processes
- Process-level breakdown with risk classification
- Anomaly detection: quality drop, high error rate, outlier performance
- Severity levels: Low/Medium/High based on deviation
- Risk matrix: counts by severity level
- Compliance rate: % of calls meeting quality threshold

---

## Task A3: CEO/Executive Quality Summary API ✓

**Endpoint:** `GET /api/executive/quality-summary`

**Auth:** `requireRole(['ceo', 'super_admin'])`

**Query Parameters:**
- `daysBack` (1-365, default 30): Historical lookback period

**Response Structure:**
```json
{
  "success": true,
  "data": {
    "metrics": {
      "overall_quality_score": 81.2,
      "target_quality_score": 85,
      "gap_pct": 3.8,
      "status": "At Risk",
      "trend_7day": { "direction": "↗", "change_pct": 2.3 },
      "trend_30day": { "direction": "↘", "change_pct": -1.5 }
    },
    "top_performers": [
      {
        "rank": 1,
        "agent_code": "AG001",
        "agent_name": "John Doe",
        "quality_score": 95.8,
        "calls_handled": 520,
        "process": "INBOUND"
      }
    ],
    "bottom_performers": [
      {
        "rank": 1,
        "agent_code": "AG025",
        "agent_name": "Robert Johnson",
        "quality_score": 58.2,
        "calls_handled": 145,
        "process": "OUTBOUND"
      }
    ],
    "process_performance": [
      {
        "process": "INBOUND",
        "avg_quality": 83.5,
        "agent_count": 45,
        "calls_handled": 2100,
        "status": "On Track"
      }
    ],
    "risk_summary": {
      "critical_agents_count": 3,
      "at_risk_agents_count": 8,
      "coaching_priority_count": 15
    },
    "org_benchmarks": {
      "avg_quality": 81.2,
      "median_quality": 82.1,
      "std_deviation": 8.7
    },
    "last_updated": "2026-06-21T09:35:00Z",
    "filter": { "daysBack": 30 }
  }
}
```

**Implementation Files:**
- Service: `backend/src/modules/quality-dashboard/quality-executive.service.ts`
- Routes: `backend/src/modules/quality-dashboard/quality-executive.routes.ts`
- Tests: `backend/tests/quality-executive.routes.test.ts` (6 tests)

**Key Features:**
- Org-wide KPIs with target vs actual
- 7-day and 30-day trend analysis (direction + change %)
- Top 10 and Bottom 10 performers
- Process performance scorecard
- Risk matrix: critical/at-risk/coaching priority counts
- Organization benchmarks: mean, median, std deviation
- Status tracking: On Track / At Risk / Critical

---

## API Registration

All three routers registered in `backend/src/app.ts`:

```typescript
import { qualityManagerRouter } from "./modules/quality-dashboard/quality-manager.routes.js";
import { qualityQARouter } from "./modules/quality-dashboard/quality-qa.routes.js";
import { qualityExecutiveRouter } from "./modules/quality-dashboard/quality-executive.routes.js";

app.use("/api/manager", qualityManagerRouter);
app.use("/api/qa", qualityQARouter);
app.use("/api/executive", qualityExecutiveRouter);
```

---

## Security & Authorization

All APIs enforce role-based access control:

| Endpoint | Roles | Scope |
|----------|-------|-------|
| `/api/manager/team-quality` | process_manager, team_leader | Direct reports only |
| `/api/qa/quality-audit` | qa | Organization-wide |
| `/api/executive/quality-summary` | ceo, super_admin | Organization-wide |

All endpoints require Bearer token auth via `requireAuth` middleware. Super Admin role bypasses role checks.

---

## Data Sources

- **Primary:** `db_audit.call_quality_assessment` (call quality scores)
- **Secondary:** `mas_hrms.employees` (agent names, reporting relationships)
- **Joins:** employee_code = User (agent lookup)

---

## Test Coverage

| Task | Test File | Test Count | Coverage |
|------|-----------|-----------|----------|
| A1 | quality-manager.routes.test.ts | 7 | Happy path, auth, roles, params |
| A2 | quality-qa.routes.test.ts | 5 | Happy path, auth, roles, params |
| A3 | quality-executive.routes.test.ts | 6 | Happy path, auth, roles, params, performers |

Total: **18 tests**

---

## Query Performance Notes

- Manager API: Indexed lookups on reporting_manager_id + CallDate + User
- QA API: GROUP BY Campaign, full org scan (aggregate)
- Executive API: Multiple aggregations (consider caching for large datasets)

---

## Future Enhancements

1. Caching layer for executive summary (refresh every 5 mins)
2. WebSocket real-time updates for anomalies
3. Predictive risk scoring (trend-based)
4. Agent coaching action recommendations
5. Process-level drill-down dashboards

---

## Known Limitations

1. Risk scores are heuristic-based (quality % thresholds) - consider ML-based scoring
2. Anomaly detection uses static baselines - consider dynamic baselines
3. Top/bottom performers limited to 10 each - consider pagination
4. All timestamps in database timezone - ensure sync with frontend

---

**Commits:** 3 (one per task)

**Build Status:** Ready for integration testing

**Ready for:** Phase 7.2 Track B (Operations Dashboard) and Track C (Management Dashboard)
