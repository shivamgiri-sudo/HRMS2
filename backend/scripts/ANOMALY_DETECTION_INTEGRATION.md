# Call Quality Anomaly Detection - Integration Guide

**Status**: Ready for backend implementation  
**Target**: Express.js API + Dashboard  
**Database**: mas_hrms + db_audit  
**Last Updated**: 2026-06-21

---

## Overview

This document outlines how to integrate the call quality anomaly detection queries into the HRMS backend as operational APIs and real-time monitoring dashboards.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Frontend Dashboard                             │
│  (Real-time alerts, anomaly widget, drill-down views)             │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                    API Endpoints
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
    ┌───▼─────┐        ┌──▼──────┐      ┌───▼────────┐
    │ Outliers│        │ Fatigue │      │ Seasonal   │
    │ API     │        │ API     │      │ Patterns   │
    │         │        │         │      │ API        │
    └────┬────┘        └────┬────┘      └────┬───────┘
         │                  │                 │
         └──────────────────┼─────────────────┘
                    │
          ┌─────────▼────────────┐
          │   Query Layer        │
          │ (SQL Optimization)   │
          └─────────┬────────────┘
                    │
        ┌───────────┼───────────┐
        │           │           │
    ┌───▼──┐    ┌──▼──┐   ┌───▼──┐
    │MySQL │    │ db_ │   │Cache │
    │      │    │audit│   │Layer │
    └──────┘    └─────┘   └──────┘
```

## API Endpoints to Create

### 1. GET `/api/quality/anomalies/outliers`

**Purpose**: Get agents with significantly deviant quality scores

**Query Parameters**:
```
GET /api/quality/anomalies/outliers?severity=HIGH&limit=20&offset=0
```

**Response**:
```json
{
  "status": "success",
  "data": {
    "anomalies": [
      {
        "employee_code": "EMP001",
        "agent_name": "John Smith",
        "process": "Billing",
        "agent_avg_quality": 65.2,
        "org_avg_quality": 78.5,
        "stddev_distance": 2.1,
        "severity": "HIGH",
        "performance_category": "UNDERPERFORMER",
        "sample_calls": 247,
        "min_quality": 34.2,
        "max_quality": 89.5,
        "recommended_action": "Mandatory coaching + monitoring",
        "period_start": "2026-03-22",
        "period_end": "2026-06-20"
      }
    ],
    "total_count": 5,
    "filters_applied": ["severity=HIGH"],
    "generated_at": "2026-06-21T14:32:00Z"
  }
}
```

**Backend Implementation**:
```typescript
// src/modules/quality/controllers/outlierController.ts
export async function getOutlierAgents(req: Request, res: Response) {
  const { severity = 'HIGH', limit = 20, offset = 0 } = req.query;
  
  // Call the anomaly detection query
  const query = `
    SELECT * FROM (
      [QUERY 1: AGENT_OUTLIER_QUALITY]
    ) outliers
    WHERE severity IN ('${severity.split(',').join("','")}')
    LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
  `;
  
  const results = await mysql.query(query);
  res.json({ status: 'success', data: results });
}
```

### 2. GET `/api/quality/anomalies/fatigue`

**Purpose**: Get fatigue patterns for this week/month

**Query Parameters**:
```
GET /api/quality/anomalies/fatigue?period=week&severity=HIGH&agent_code=EMP001
```

**Response**:
```json
{
  "status": "success",
  "data": {
    "fatigue_patterns": [
      {
        "employee_code": "EMP002",
        "agent_name": "Sarah Jones",
        "work_date": "2026-06-20",
        "work_day": "Friday",
        "daily_quality": 68.5,
        "prev_day_quality": 76.2,
        "quality_change": -7.7,
        "daily_calls": 47,
        "severity": "MEDIUM",
        "fatigue_pattern": "FRIDAY_FATIGUE",
        "recommended_action": "Optimize Friday workload distribution + break timing"
      }
    ],
    "total_alerts": 3,
    "generated_at": "2026-06-21T14:32:00Z"
  }
}
```

### 3. GET `/api/quality/anomalies/seasonal`

**Purpose**: Get weekly patterns and day-of-week trends

**Response**:
```json
{
  "status": "success",
  "data": {
    "weekly_patterns": [
      {
        "day_of_week": "Friday",
        "avg_day_quality": 74.8,
        "org_avg_quality": 78.5,
        "quality_delta": -3.7,
        "severity": "HIGH",
        "seasonal_pattern": "FRIDAY_FATIGUE",
        "consistency_stddev": 6.2,
        "weeks_observed": 12,
        "recommended_action": "Optimize Friday workload distribution + break timing"
      }
    ],
    "trends": {
      "worst_day": "Saturday",
      "best_day": "Wednesday",
      "quality_range": "71.3-80.2"
    }
  }
}
```

### 4. GET `/api/quality/anomalies/intraday`

**Purpose**: Get hour-by-hour patterns (lunch valley, shift decline, etc.)

**Response**:
```json
{
  "status": "success",
  "data": {
    "intraday_patterns": [
      {
        "hour_of_day": 12,
        "shift_phase": "Lunch Valley",
        "hourly_quality": 72.3,
        "org_avg_hourly_quality": 78.5,
        "quality_delta": -6.2,
        "severity": "HIGH",
        "intraday_pattern": "LUNCH_VALLEY_DIP",
        "good_rate_pct": 28,
        "poor_rate_pct": 28,
        "recommended_action": "Adjust break timing + reduce complex calls during 12-13"
      }
    ],
    "peak_hours": ["09:00", "15:00"],
    "valley_hours": ["12:00", "13:00", "19:00"]
  }
}
```

### 5. GET `/api/quality/anomalies/variability`

**Purpose**: Get agents with high performance inconsistency

**Response**:
```json
{
  "status": "success",
  "data": {
    "high_variability": [
      {
        "employee_code": "EMP003",
        "agent_name": "Mike Brown",
        "process": "Collections",
        "avg_quality": 76.5,
        "agent_stddev": 14.3,
        "org_avg_stddev": 7.2,
        "variability_ratio": 1.99,
        "consistency_pattern": "MODERATELY_INCONSISTENT",
        "quality_range": 57.4,
        "min_quality": 34.7,
        "max_quality": 92.1,
        "severity": "HIGH",
        "recommended_action": "Diagnostic assessment + individualized coaching program"
      }
    ]
  }
}
```

### 6. GET `/api/quality/anomalies/sudden-shift`

**Purpose**: Get agents with significant week-over-week changes

**Response**:
```json
{
  "status": "success",
  "data": {
    "performance_shifts": [
      {
        "employee_code": "EMP004",
        "agent_name": "Jennifer Williams",
        "current_week": 25,
        "current_week_quality": 72.4,
        "previous_4week_avg": 81.8,
        "quality_change": -9.4,
        "pct_change": -11.5,
        "severity": "CRITICAL",
        "shift_direction": "PERFORMANCE_DEGRADATION",
        "recommended_action": "Immediate 1-on-1 check-in + identify root cause"
      }
    ]
  }
}
```

### 7. GET `/api/quality/dashboard/summary`

**Purpose**: One-page executive dashboard

**Response**:
```json
{
  "status": "success",
  "data": {
    "summary": {
      "org_quality_7day": 77.2,
      "active_agents_today": 145,
      "total_calls_today": 2847,
      "active_processes": 8,
      "agents_below_target": 12,
      "critical_anomalies": 3,
      "alerts": {
        "outliers_critical": 2,
        "fatigue_high": 5,
        "sudden_shifts_critical": 1,
        "high_variability": 3
      }
    },
    "top_alerts": [
      {
        "type": "SUDDEN_SHIFT",
        "severity": "CRITICAL",
        "agent": "Jennifer Williams",
        "message": "Quality dropped 11.5% from baseline"
      },
      {
        "type": "OUTLIER",
        "severity": "HIGH",
        "agent": "John Smith",
        "message": "Quality 2.1σ below organizational average"
      }
    ],
    "generated_at": "2026-06-21T14:32:00Z"
  }
}
```

---

## Backend Module Structure

```
src/modules/quality/
├── controllers/
│   ├── anomalyController.ts
│   ├── outlierController.ts
│   ├── fatigueController.ts
│   ├── seasonalController.ts
│   └── dashboardController.ts
├── services/
│   ├── anomalyService.ts
│   ├── queryOptimizationService.ts
│   └── cacheService.ts
├── routes/
│   └── qualityRoutes.ts
├── models/
│   ├── anomalyTypes.ts
│   └── severityLevels.ts
└── queries/
    ├── outliers.sql
    ├── fatigue.sql
    ├── seasonal.sql
    ├── intraday.sql
    └── variability.sql
```

### Implementation Sample

**File**: `src/modules/quality/services/anomalyService.ts`

```typescript
import mysql from '../../../database/mysql';
import { AnomalyResult, Severity } from '../models/anomalyTypes';

export class AnomalyService {
  
  /**
   * Get agent outliers with statistical analysis
   */
  async getAgentOutliers(options: {
    severity?: Severity[];
    limit?: number;
    offset?: number;
    dayWindow?: number;
  }): Promise<AnomalyResult[]> {
    const { severity = ['HIGH', 'CRITICAL'], limit = 20, offset = 0, dayWindow = 90 } = options;
    
    const severityFilter = severity.map(s => `'${s}'`).join(',');
    
    const query = `
      SELECT
        e.employee_code,
        CONCAT(e.first_name, ' ', e.last_name) as agent_name,
        cqa.Campaign as process,
        ROUND(AVG(cqa.quality_percentage), 2) as agent_avg_quality,
        org_stats.org_avg_quality,
        org_stats.org_stddev,
        ROUND(ABS(AVG(cqa.quality_percentage) - org_stats.org_avg_quality) / org_stats.org_stddev, 2) as stddev_distance,
        CASE
          WHEN ABS(AVG(cqa.quality_percentage) - org_stats.org_avg_quality) > (3 * org_stats.org_stddev) THEN 'CRITICAL'
          WHEN ABS(AVG(cqa.quality_percentage) - org_stats.org_avg_quality) > (2 * org_stats.org_stddev) THEN 'HIGH'
          WHEN ABS(AVG(cqa.quality_percentage) - org_stats.org_avg_quality) > org_stats.org_stddev THEN 'MEDIUM'
          ELSE 'LOW'
        END as severity,
        CASE
          WHEN AVG(cqa.quality_percentage) > org_stats.org_avg_quality THEN 'ELITE_PERFORMER'
          ELSE 'UNDERPERFORMER'
        END as performance_category,
        COUNT(*) as sample_calls,
        ROUND(MIN(cqa.quality_percentage), 1) as min_quality,
        ROUND(MAX(cqa.quality_percentage), 1) as max_quality,
        ROUND(STDDEV(cqa.quality_percentage), 2) as agent_stddev
      FROM db_audit.call_quality_assessment cqa
      JOIN employees e ON cqa.User = e.employee_code
      CROSS JOIN (
        SELECT
          AVG(quality_percentage) as org_avg_quality,
          STDDEV(quality_percentage) as org_stddev
        FROM db_audit.call_quality_assessment
        WHERE CallDate >= DATE_SUB(NOW(), INTERVAL ${dayWindow} DAY)
          AND quality_percentage IS NOT NULL
      ) org_stats
      WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ${dayWindow} DAY)
        AND cqa.quality_percentage IS NOT NULL
      GROUP BY e.employee_code, cqa.Campaign
      HAVING ABS(AVG(cqa.quality_percentage) - org_stats.org_avg_quality) >= org_stats.org_stddev
        AND severity IN (${severityFilter})
      ORDER BY stddev_distance DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    
    return await mysql.query(query);
  }
  
  /**
   * Get fatigue patterns for specified period
   */
  async getFatiguePatterns(options: {
    dayWindow?: number;
    minSeverity?: Severity;
    limit?: number;
  }): Promise<AnomalyResult[]> {
    const { dayWindow = 60, minSeverity = 'MEDIUM', limit = 100 } = options;
    
    // Implementation with query optimization
    // [Full implementation]
  }
  
  /**
   * Get seasonal/weekly patterns
   */
  async getSeasonalPatterns(options: {
    dayWindow?: number;
  }): Promise<WeeklyPattern[]> {
    // Implementation
    // [Full implementation]
  }
}
```

---

## Dashboard Widget Components

### 1. Outliers Widget

```tsx
// frontend/src/components/quality/OutliersWidget.tsx
import { useState, useEffect } from 'react';

export function OutliersWidget() {
  const [outliers, setOutliers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchOutliers();
    const interval = setInterval(fetchOutliers, 300000); // 5 min refresh
    return () => clearInterval(interval);
  }, []);

  const fetchOutliers = async () => {
    const res = await fetch('/api/quality/anomalies/outliers?severity=CRITICAL,HIGH');
    const data = await res.json();
    setOutliers(data.data.anomalies);
    setLoading(false);
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className="anomaly-widget">
      <h3>Quality Outliers</h3>
      <table>
        <thead>
          <tr>
            <th>Agent</th>
            <th>Quality</th>
            <th>vs Org Avg</th>
            <th>Severity</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {outliers.map(outlier => (
            <tr key={outlier.employee_code} className={`severity-${outlier.severity}`}>
              <td>{outlier.agent_name}</td>
              <td className="quality">{outlier.agent_avg_quality.toFixed(1)}%</td>
              <td className="delta">
                {outlier.agent_avg_quality > outlier.org_avg_quality ? '+' : ''}
                {(outlier.agent_avg_quality - outlier.org_avg_quality).toFixed(1)}%
              </td>
              <td>
                <span className={`badge severity-${outlier.severity}`}>
                  {outlier.severity}
                </span>
              </td>
              <td>{outlier.recommended_action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

### 2. Fatigue Pattern Alert Widget

```tsx
// frontend/src/components/quality/FatigueAlertsWidget.tsx
export function FatigueAlertsWidget() {
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    const fetchAlerts = async () => {
      const res = await fetch('/api/quality/anomalies/fatigue?period=week');
      const data = await res.json();
      setAlerts(data.data.fatigue_patterns);
    };
    
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 600000); // 10 min refresh
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fatigue-widget">
      <h3>Fatigue Alerts</h3>
      {alerts.map(alert => (
        <div key={`${alert.employee_code}-${alert.work_date}`} 
             className={`alert severity-${alert.severity}`}>
          <div className="alert-header">
            <strong>{alert.agent_name}</strong>
            <span className="badge">{alert.fatigue_pattern}</span>
          </div>
          <div className="alert-body">
            <p>{alert.work_day}: {alert.daily_quality.toFixed(1)}% 
               (was {alert.prev_day_quality.toFixed(1)}% yesterday)</p>
            <p className="recommendation">{alert.recommended_action}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
```

---

## Database Optimization

### Indexes Required

```sql
-- Create indexes for performance
CREATE INDEX idx_quality_calldate ON db_audit.call_quality_assessment(CallDate);
CREATE INDEX idx_quality_user ON db_audit.call_quality_assessment(User);
CREATE INDEX idx_quality_campaign ON db_audit.call_quality_assessment(Campaign);
CREATE INDEX idx_quality_percentage ON db_audit.call_quality_assessment(quality_percentage);
CREATE INDEX idx_quality_user_date ON db_audit.call_quality_assessment(User, CallDate);
CREATE INDEX idx_quality_campaign_date ON db_audit.call_quality_assessment(Campaign, CallDate);
```

### Materialized Views (for high-frequency queries)

```sql
-- Refresh hourly
CREATE VIEW v_daily_agent_quality AS
SELECT
  User as employee_code,
  DATE(CallDate) as work_date,
  Campaign as process,
  ROUND(AVG(quality_percentage), 2) as daily_avg_quality,
  STDDEV(quality_percentage) as daily_stddev,
  COUNT(*) as daily_calls
FROM db_audit.call_quality_assessment
WHERE CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
GROUP BY User, DATE(CallDate), Campaign;
```

---

## Caching Strategy

```typescript
// src/modules/quality/services/cacheService.ts
import redis from 'redis';

const cache = redis.createClient();

export class CacheService {
  
  /**
   * Cache anomaly results with TTL
   */
  async cacheAnomalyResult(
    key: string,
    data: any,
    ttlSeconds: number = 300
  ): Promise<void> {
    await cache.setex(
      `quality:anomaly:${key}`,
      ttlSeconds,
      JSON.stringify(data)
    );
  }
  
  /**
   * Get cached anomaly result
   */
  async getAnomalyCache(key: string): Promise<any | null> {
    const cached = await cache.get(`quality:anomaly:${key}`);
    return cached ? JSON.parse(cached) : null;
  }
  
  /**
   * Invalidate cache on new data
   */
  async invalidateQualityCache(): Promise<void> {
    const keys = await cache.keys('quality:anomaly:*');
    if (keys.length > 0) {
      await cache.del(...keys);
    }
  }
}
```

---

## Real-Time Monitoring (WebSocket)

```typescript
// src/modules/quality/websocket/qualityMonitor.ts
import { Server as SocketIOServer } from 'socket.io';

export class QualityMonitor {
  
  constructor(private io: SocketIOServer, private anomalyService: AnomalyService) {
    this.startMonitoring();
  }
  
  /**
   * Broadcast anomalies every 5 minutes
   */
  private startMonitoring() {
    setInterval(async () => {
      const outliers = await this.anomalyService.getAgentOutliers({
        severity: ['CRITICAL', 'HIGH'],
        dayWindow: 90
      });
      
      this.io.emit('quality:anomalies:updated', {
        timestamp: new Date(),
        outliers,
        total_critical: outliers.filter(o => o.severity === 'CRITICAL').length
      });
    }, 300000); // 5 minutes
  }
}
```

---

## Alert Notification System

```typescript
// src/modules/quality/services/alertService.ts
export class AlertService {
  
  /**
   * Send alert to manager/supervisor
   */
  async sendQualityAlert(
    severity: Severity,
    agentName: string,
    message: string,
    recipients: string[]
  ) {
    // Email notification
    await emailService.send({
      to: recipients,
      subject: `[Quality Alert - ${severity}] ${agentName}`,
      template: 'quality-alert',
      data: { severity, agentName, message }
    });
    
    // In-app notification
    for (const recipient of recipients) {
      await notificationService.create({
        user_id: recipient,
        type: 'QUALITY_ANOMALY',
        severity,
        message,
        action_url: `/quality/agents/${agentName}`
      });
    }
    
    // Audit log
    await auditService.log({
      action: 'QUALITY_ALERT_SENT',
      severity,
      agent: agentName,
      recipients
    });
  }
}
```

---

## Testing Strategy

```typescript
// src/modules/quality/__tests__/anomalyService.test.ts
describe('AnomalyService', () => {
  
  it('should identify critical outliers correctly', async () => {
    const outliers = await anomalyService.getAgentOutliers({
      severity: ['CRITICAL']
    });
    
    expect(outliers.length).toBeGreaterThan(0);
    outliers.forEach(outlier => {
      expect(outlier.stddev_distance).toBeGreaterThan(3);
    });
  });
  
  it('should detect Friday fatigue patterns', async () => {
    const fatigue = await anomalyService.getFatiguePatterns({
      dayWindow: 60
    });
    
    const fridayPatterns = fatigue.filter(f => f.work_day === 'Friday');
    expect(fridayPatterns.length).toBeGreaterThan(0);
  });
});
```

---

## Deployment Checklist

- [ ] Create all indexes on db_audit.call_quality_assessment
- [ ] Deploy backend APIs with proper authorization checks
- [ ] Test query performance under production load
- [ ] Set up Redis cache layer
- [ ] Configure WebSocket connections for real-time updates
- [ ] Deploy frontend dashboard components
- [ ] Set up alert notification system (email/SMS)
- [ ] Configure automated report generation (daily/weekly)
- [ ] Set up audit logging for all anomaly-related actions
- [ ] Create runbooks for each anomaly type
- [ ] Train managers on interpretation and response
- [ ] Monitor API performance and query execution times

---

## Support & Monitoring

**Query Performance Targets**:
- Single agent outlier: <200ms
- Dashboard summary: <500ms
- Full anomaly report: <2s

**Monitor These Metrics**:
- API response times
- Cache hit ratio
- Number of active anomalies
- Alert send success rate
- User engagement with anomaly reports

---

**Document Version**: 1.0  
**Last Updated**: 2026-06-21  
**Author**: HRMS Engineering Team
