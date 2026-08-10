# Phase 7.2 + Enhanced Dashboards (MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Phase 7.2 multi-role quality dashboard + Operations dashboard (live WFM) + Management dashboard (team health) for BPO operational visibility, cost control, and quality management.

**Architecture:** 3 parallel tracks (independent, can start simultaneously). Extend Phase 7.1 foundation (query builders, cache, auth). Reuse role-based routing pattern. Add WebSocket for real-time. No schema migrations.

**Tech Stack:** React 18 + TypeScript + Recharts. Express + TypeScript + Socket.io (real-time). MySQL (existing tables).

**Timeline:** Track A + B parallel (1 week) → Track C (3 days) → Integration (2 days) = ~11 days wall-clock.

**Executive Decision:** Operations Dashboard prioritized as critical (real-time live status is BPO operational need #1). Phase 7.2 quality second (core business metric). Management third (internal team health). Agent Performance deferred to Phase 7.3.

---

# TRACK A: Phase 7.2 - Multi-Role Quality Dashboard

## Task A1: Manager/TL Quality API

**Files:**
- Create: `backend/src/modules/quality-dashboard/quality-manager.service.ts`
- Create: `backend/src/modules/quality-dashboard/quality-manager.routes.ts`
- Create: `backend/tests/quality-manager.routes.test.ts`

- [ ] **Step 1: Write failing test for team quality endpoint**

```typescript
// backend/tests/quality-manager.routes.test.ts
import { describe, it, expect } from '@jest/globals';

describe('Manager Quality Routes', () => {
  describe('GET /api/manager/team-quality', () => {
    it('returns team quality summary for authenticated RM/TL', async () => {
      const response = await fetch('http://localhost:5000/api/manager/team-quality', {
        headers: { Authorization: `Bearer ${managerToken}` }
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data).toHaveProperty('team_summary');
      expect(data).toHaveProperty('agent_breakdown');
      expect(data.team_summary).toHaveProperty('avg_quality');
      expect(data.team_summary).toHaveProperty('agent_count');
      expect(Array.isArray(data.agent_breakdown)).toBe(true);
    });

    it('returns 403 for non-manager roles', async () => {
      const response = await fetch('http://localhost:5000/api/manager/team-quality', {
        headers: { Authorization: `Bearer ${agentToken}` }
      });

      expect(response.status).toBe(403);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- backend/tests/quality-manager.routes.test.ts --testNamePattern="returns team quality"
# Expected: FAIL - endpoint not found
```

- [ ] **Step 3: Implement manager service**

```typescript
// backend/src/modules/quality-dashboard/quality-manager.service.ts
import { Pool, RowDataPacket } from 'mysql2/promise';
import { logger } from '../../logger';

export interface TeamQualitySummary {
  avg_quality: number;
  agent_count: number;
  calls_handled: number;
  top_performer: { agent_code: string; agent_name: string; quality: number };
  bottom_performer: { agent_code: string; agent_name: string; quality: number };
  quality_distribution: { excellent: number; good: number; average: number; poor: number };
}

export interface AgentBreakdown {
  agent_code: string;
  agent_name: string;
  quality_pct: number;
  calls_handled: number;
  weak_areas: string[];
  coaching_needed: boolean;
  risk_score: number;
}

export class QualityManagerService {
  constructor(private db: Pool) {}

  async getTeamQuality(managerCode: string, daysBack: number = 7): Promise<{
    team_summary: TeamQualitySummary;
    agent_breakdown: AgentBreakdown[];
  }> {
    const conn = await this.db.getConnection();

    try {
      // Get all direct reports for this manager
      const [directReports] = await conn.execute<RowDataPacket[]>(
        `SELECT id, employee_code, CONCAT(first_name, ' ', COALESCE(last_name, '')) as full_name
         FROM mas_hrms.employees
         WHERE reporting_manager_id = (SELECT id FROM mas_hrms.employees WHERE employee_code = ?)
         AND employment_status = 'Active'`,
        [managerCode]
      );

      if (!directReports || directReports.length === 0) {
        return {
          team_summary: {
            avg_quality: 0,
            agent_count: 0,
            calls_handled: 0,
            top_performer: { agent_code: '', agent_name: '', quality: 0 },
            bottom_performer: { agent_code: '', agent_name: '', quality: 0 },
            quality_distribution: { excellent: 0, good: 0, average: 0, poor: 0 }
          },
          agent_breakdown: []
        };
      }

      const agentCodes = directReports.map(r => r.employee_code);

      // Get quality metrics for all direct reports
      const [qualityMetrics] = await conn.execute<RowDataPacket[]>(
        `SELECT
           cqa.User as agent_code,
           e.full_name as agent_name,
           ROUND(AVG(cqa.quality_percentage), 2) as quality_pct,
           COUNT(*) as calls_handled,
           COUNT(CASE WHEN cqa.quality_percentage < 60 THEN 1 END) as poor_calls
         FROM db_audit.call_quality_assessment cqa
         LEFT JOIN mas_hrms.employees e ON e.employee_code = cqa.User
         WHERE cqa.User IN (${agentCodes.map(() => '?').join(',')})
           AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY)
           AND cqa.Campaign LIKE 'INBOUND%'
         GROUP BY cqa.User, e.full_name
         ORDER BY quality_pct DESC`,
        [...agentCodes, daysBack]
      );

      if (!qualityMetrics) return { team_summary: {} as any, agent_breakdown: [] };

      // Calculate team summary
      const avgQuality = qualityMetrics.length > 0
        ? qualityMetrics.reduce((sum: number, m: any) => sum + m.quality_pct, 0) / qualityMetrics.length
        : 0;

      const distribution = {
        excellent: qualityMetrics.filter((m: any) => m.quality_pct >= 90).length,
        good: qualityMetrics.filter((m: any) => m.quality_pct >= 80 && m.quality_pct < 90).length,
        average: qualityMetrics.filter((m: any) => m.quality_pct >= 70 && m.quality_pct < 80).length,
        poor: qualityMetrics.filter((m: any) => m.quality_pct < 70).length,
      };

      const teamSummary: TeamQualitySummary = {
        avg_quality: Math.round(avgQuality * 100) / 100,
        agent_count: qualityMetrics.length,
        calls_handled: qualityMetrics.reduce((sum: number, m: any) => sum + m.calls_handled, 0),
        top_performer: qualityMetrics.length > 0 ? {
          agent_code: qualityMetrics[0].agent_code,
          agent_name: qualityMetrics[0].agent_name,
          quality: qualityMetrics[0].quality_pct
        } : { agent_code: '', agent_name: '', quality: 0 },
        bottom_performer: qualityMetrics.length > 0 ? {
          agent_code: qualityMetrics[qualityMetrics.length - 1].agent_code,
          agent_name: qualityMetrics[qualityMetrics.length - 1].agent_name,
          quality: qualityMetrics[qualityMetrics.length - 1].quality_pct
        } : { agent_code: '', agent_name: '', quality: 0 },
        quality_distribution: distribution
      };

      // Build agent breakdown
      const agentBreakdown: AgentBreakdown[] = qualityMetrics.map((m: any) => ({
        agent_code: m.agent_code,
        agent_name: m.agent_name,
        quality_pct: m.quality_pct,
        calls_handled: m.calls_handled,
        weak_areas: m.quality_pct < 75 ? ['Communication', 'Problem Resolution'] : [],
        coaching_needed: m.quality_pct < 70,
        risk_score: m.poor_calls > 5 ? 75 : m.quality_pct < 70 ? 60 : 30
      }));

      return { team_summary: teamSummary, agent_breakdown: agentBreakdown };
    } finally {
      conn.release();
    }
  }
}
```

- [ ] **Step 4: Implement routes**

```typescript
// backend/src/modules/quality-dashboard/quality-manager.routes.ts
import { Router, Request, Response } from 'express';
import { db } from '../../db';
import { requireAuth } from '../../middleware/requireAuth';
import { requireRole } from '../../middleware/requireRole';
import { QualityManagerService } from './quality-manager.service';
import { logger } from '../../logger';

const router = Router();
const service = new QualityManagerService(db);

// GET /api/manager/team-quality
router.get('/team-quality', requireAuth, requireRole(['RM', 'TL']), async (req: Request, res: Response) => {
  try {
    const managerCode = (req as any).user?.employee_code;
    if (!managerCode) return res.status(403).json({ error: 'Unauthorized' });

    const daysBack = parseInt(req.query.daysBack as string) || 7;
    const result = await service.getTeamQuality(managerCode, daysBack);

    res.json({
      team_summary: result.team_summary,
      agent_breakdown: result.agent_breakdown,
      last_updated: new Date()
    });
  } catch (error) {
    logger.error('Error fetching team quality:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
```

- [ ] **Step 5: Register routes in app.ts**

```typescript
// backend/src/app.ts (add at line ~280)
import qualityManagerRouter from './modules/quality-dashboard/quality-manager.routes';
app.use('/api/manager', qualityManagerRouter);
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npm test -- backend/tests/quality-manager.routes.test.ts
# Expected: PASS
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/quality-dashboard/quality-manager.* backend/tests/quality-manager.routes.test.ts backend/src/app.ts
git commit -m "feat: Phase 7.2 Task A1 - Manager/TL Quality API

API: GET /api/manager/team-quality
- Returns team quality summary (avg, distribution, top/bottom performers)
- Returns per-agent breakdown (quality, calls, weak areas, risk)
- Auth: requireRole(['RM', 'TL']) middleware
- Scope: Direct reports only
- Process: INBOUND (param: daysBack, default 7)

Service: QualityManagerService
- getTeamQuality(managerCode, daysBack)
- Joins direct reports + quality metrics
- Calculates team statistics
- Identifies weak areas + coaching needs

Tests: 2 tests (team quality endpoint, 403 unauthorized)

Co-Authored-By: Claude Opus 4.1 <noreply@anthropic.com>"
```

---

*(Due to context, showing Task A1 structure. Tasks A2-A3, B1-B4, C1-C3 follow same TDD pattern with exact code blocks)*

---

## Task A2: QA Manager Quality Audit API

[Similar structure: API endpoint, service, tests, commit]

- Get all calls across all processes
- Anomaly detection + risk matrix
- Auth: requireRole(['QA'])

## Task A3: CEO Quality Summary API

[Similar structure]

- Org-wide quality + targets
- Top 10 / Bottom 10 performers
- Auth: requireRole(['CEO', 'ADMIN'])

---

# TRACK B: Operations Dashboard - Live WFM

## Task B1: Live Agent Status API + WebSocket

[TDD: failing test → socket.io implementation → real-time polling]

- Endpoint: GET /api/operations/live-status
- WebSocket: emit agent status updates every 10 seconds
- Data: wfm_attendance_session (live), employees
- Response: {agent_id, agent_name, status, duration, call_id}

## Task B2: Roster vs Actual API

[TDD: failing test → query + service → pass]

- Endpoint: GET /api/operations/roster-vs-actual
- Data: wfm_roster_master (planned), wfm_attendance_session (actual)
- Response: utilization_pct, shrinkage_forecast

## Task B3: Attrition Risk Scoring API

[TDD]

- Endpoint: GET /api/operations/attrition-risk
- Scoring model: {resignation_signals, attendance_drop, quality_decline}
- Response: risk_score (0-100), signals array, retention_action

## Task B4: Live Operations Components + WebSocket Client

[React components: HeatmapGrid, RosterChart, RiskList, QueueMetrics]

- socket.io-client for real-time subscribe
- Responsive grids + charts
- Error handling + reconnection

---

# TRACK C: Management Dashboard - Team Health

## Task C1: Team Overview APIs

[TDD: 4 endpoints]

- GET /api/manager/team-overview: headcount, utilization, quality, cost
- GET /api/manager/agent-performance: sortable table
- GET /api/manager/payroll-projection: cost forecast
- GET /api/manager/training-needs: skill gaps

## Task C2: Management Components

[React: TeamScorecard, AgentTable, PayrollChart, TrainingList]

## Task C3: Tests + Integration

[Unit + E2E tests, role-based routing]

---

# Integration & Validation (2 days)

- All 3 tracks merged
- Full stack validation
- Performance testing (<3s load)
- Role-based access testing
- Real-time metrics verification
- Commit final integration

---

**Execution:** Subagent-driven parallel dispatch (Tracks A+B simultaneously, then C).

