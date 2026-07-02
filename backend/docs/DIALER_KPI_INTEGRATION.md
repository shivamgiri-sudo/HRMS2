# Dialer KPI Integration - Process-Wise Operations Dashboard

## Overview

Automatic synchronization of call center metrics from ViciDial dialer database to HRMS KPI system. Enables process-wise operations dashboards with real-time agent performance tracking.

**Purpose**: Bridge dialer call data → HRMS KPI scores for operations metrics (AHT, ACW, Talk Time, Hold Time, Calls Handled)

---

## Architecture

```
┌──────────────┐         ┌─────────────────────┐         ┌──────────────┐
│  Dialer DB   │ ──READ──> │ Dialer KPI Sync    │ ──WRITE──> │  HRMS DB     │
│ (vicidial)   │         │ Worker              │         │ (kpi_score)  │
│              │         │                     │         │              │
│ - Agent Log  │         │ Calculates:         │         │ - AHT        │
│ - Inbound    │         │   - AHT             │         │ - ACW        │
│ - Outbound   │         │   - ACW             │         │ - TALK_TIME  │
│              │         │   - Talk/Hold/Wait  │         │ - HOLD_TIME  │
└──────────────┘         │   - FCR Count       │         │ - CALLS      │
                         └─────────────────────┘         └──────────────┘
                                    │
                                    │
                         ┌──────────▼─────────────┐
                         │   KPI Dashboard        │
                         │  (Process View)        │
                         │                        │
                         │ - Leaderboard          │
                         │ - Scoring vs Targets   │
                         │ - Process Aggregation  │
                         └────────────────────────┘

## KPI Metrics Calculated

| Metric | Formula | Source | Unit |
|--------|---------|--------|------|
| **AHT** (Average Handle Time) | (Talk + Hold + ACW) / Total Calls | Inbound + Outbound | seconds |
| **ACW** (After Call Work) | ACW Time / Total Calls | Inbound + Outbound | seconds |
| **TALK_TIME** | Talk Time / Total Calls | Inbound + Outbound | seconds |
| **HOLD_TIME** | Hold Time / Total Calls | Inbound only | seconds |
| **CALLS_HANDLED** | Count of all calls | Inbound + Outbound | count |

---

## API Endpoints

### Employee Metrics

**GET /api/dialer/kpi/employee/:employeeCode/:date**

Get calculated KPI metrics for an employee on specific date.

Response:
```json
{
  "success": true,
  "data": {
    "employee_code": "MAS62686",
    "date": "2026-06-06",
    "total_calls": 97,
    "inbound_calls": 45,
    "outbound_calls": 52,
    "aht": 320,
    "acw": 45,
    "talk_time": 240,
    "hold_time": 20,
    "wait_time": 15,
    "fcr_count": 35,
    "callbacks": 3
  }
}
```

---

### Process Aggregation

**GET /api/dialer/kpi/process/:processId/:date**

Get metrics for all agents in a process.

Response:
```json
{
  "success": true,
  "data": [
    {
      "employee_code": "MAS62686",
      "date": "2026-06-06",
      "total_calls": 97,
      "aht": 320,
      "acw": 45
    }
  ],
  "count": 15
}
```

---

### Process Leaderboard

**GET /api/dialer/kpi/leaderboard/:processId/:date**

Ranked agents with scores vs targets.

Response:
```json
{
  "success": true,
  "data": [
    {
      "employee_code": "MAS62686",
      "total_calls": 97,
      "aht": 320,
      "acw": 45,
      "aht_score": 93.8,
      "acw_score": 88.9,
      "overall_score": 91.4
    }
  ],
  "count": 15
}
```

---

### Process KPI Configuration

**GET /api/dialer/kpi/config/:processId**

Get configured targets for a process.

Response:
```json
{
  "success": true,
  "data": [
    {
      "process_id": "uuid",
      "process_name": "Bella Outbound",
      "metric_code": "AHT",
      "metric_id": "uuid",
      "target_value": 300
    },
    {
      "metric_code": "ACW",
      "target_value": 60
    }
  ]
}
```

---

### Sync Operations

**POST /api/dialer/kpi/sync/employee**

Sync metrics for single employee to KPI scores table.

Request:
```json
{
  "employeeCode": "MAS62686",
  "date": "2026-06-06"
}
```

Response:
```json
{
  "success": true,
  "message": "Synced 5 metrics",
  "data": { "synced": 5 }
}
```

**POST /api/dialer/kpi/sync/process**

Bulk sync all agents in a process.

Request:
```json
{
  "processId": "uuid",
  "date": "2026-06-06"
}
```

Response:
```json
{
  "success": true,
  "message": "Synced 75 metrics, skipped 2",
  "data": { "synced": 75, "skipped": 2 }
}
```

---

## Database Schema

### kpi_metric Table

Call center metrics should be configured:

```sql
INSERT INTO kpi_metric (id, metric_code, metric_name, family, unit, direction) VALUES
(UUID(), 'AHT', 'Average Handle Time', 'operations', 'seconds', 'lower_is_better'),
(UUID(), 'ACW', 'After Call Work', 'operations', 'seconds', 'lower_is_better'),
(UUID(), 'TALK_TIME', 'Talk Time', 'operations', 'seconds', 'higher_is_better'),
(UUID(), 'HOLD_TIME', 'Hold Time', 'operations', 'seconds', 'lower_is_better'),
(UUID(), 'CALLS_HANDLED', 'Calls Handled', 'operations', 'count', 'higher_is_better');
```

### kpi_process_config Table

Set targets per process:

```sql
INSERT INTO kpi_process_config (id, process_id, metric_id, target_value, weightage) VALUES
(UUID(), 'process-uuid', 'aht-metric-uuid', 300, 30),  -- 5 min target
(UUID(), 'process-uuid', 'acw-metric-uuid', 60, 20);   -- 1 min target
```

### kpi_score Table

Synced scores stored with `source = 'dialer'`:

```sql
SELECT * FROM kpi_score
WHERE source = 'dialer'
  AND period = '2026-06-06'
  AND employee_id = 'employee-uuid';
```

---

## Frontend Integration

### NativeOperationsKPI.tsx

Page already configured for AHT, ACW, TALK_TIME, HOLD_TIME metrics.

**Fetch Process Leaderboard:**
```typescript
const { data: leaderboard } = useQuery({
  queryKey: ['dialer-kpi-leaderboard', processId, date],
  queryFn: async () => {
    const res = await hrmsApi.get(
      `/api/dialer/kpi/leaderboard/${processId}/${date}`
    );
    return res.data.data;
  }
});
```

**Fetch Employee Metrics:**
```typescript
const { data: metrics } = useQuery({
  queryKey: ['dialer-kpi-employee', employeeCode, date],
  queryFn: async () => {
    const res = await hrmsApi.get(
      `/api/dialer/kpi/employee/${employeeCode}/${date}`
    );
    return res.data.data;
  }
});
```

**Sync Process KPIs (Admin Action):**
```typescript
const syncKpis = async () => {
  await hrmsApi.post('/api/dialer/kpi/sync/process', {
    processId,
    date: format(new Date(), 'yyyy-MM-dd')
  });
  // Refetch leaderboard
};
```

---

## Automated Sync Worker

Create scheduled task to sync daily:

**backend/src/workers/cron/dialer-kpi-daily-sync.ts:**

```typescript
import { DialerKpiSync } from '../domains/dialer-kpi-sync.js';
import { db } from '../../db/mysql.js';

export async function dialerKpiDailySync() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const date = yesterday.toISOString().split('T')[0];

  console.log(`[DialerKpiSync] Starting daily sync for ${date}`);

  // Get all active processes
  const [processes] = await db.execute<any[]>(
    `SELECT id FROM process_master WHERE active_status = 1`
  );

  const sync = new DialerKpiSync();
  let totalSynced = 0;

  for (const process of processes) {
    const result = await sync.syncProcessKpis(process.id, date);
    totalSynced += result.synced;
    console.log(`  Process ${process.id}: ${result.synced} synced, ${result.skipped} skipped`);
  }

  console.log(`[DialerKpiSync] Daily sync complete: ${totalSynced} total metrics`);
}
```

**Schedule in cron:**
```bash
# Run daily at 2 AM
0 2 * * * node -e "require('./dist/workers/cron/dialer-kpi-daily-sync.js').dialerKpiDailySync()"
```

---

## Scoring Logic

### Lower is Better (AHT, ACW, HOLD_TIME)

```typescript
if (actual <= target) {
  score = 100; // Met or exceeded target
} else {
  score = (target / actual) * 100; // Proportional penalty
}
```

**Example:**
- Target AHT: 300 seconds (5 min)
- Actual AHT: 330 seconds (5.5 min)
- Score: (300 / 330) * 100 = 90.9%

### Higher is Better (CALLS_HANDLED, TALK_TIME)

```typescript
if (actual >= target) {
  score = 100;
} else {
  score = (actual / target) * 100;
}
```

---

## Testing

### Manual Sync Test

```bash
# Sync single employee
curl -X POST http://localhost:5000/api/dialer/kpi/sync/employee \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"employeeCode":"MAS62686","date":"2026-06-06"}'

# Sync entire process
curl -X POST http://localhost:5000/api/dialer/kpi/sync/process \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"processId":"process-uuid","date":"2026-06-06"}'
```

### Metrics Calculation Test

```bash
node scripts/test-dialer-kpi-metrics-only.cjs
```

---

## Production Considerations

1. **Daily Automated Sync**: Schedule cron job to sync yesterday's data every morning
2. **Data Retention**: Dialer queries limited to last 3 months (performance optimization)
3. **Process Targets**: Configure realistic targets in `kpi_process_config` table
4. **Dashboard Refresh**: Frontend should poll `/api/dialer/kpi/leaderboard` every 5 minutes for live view
5. **Caching**: Consider Redis cache for frequently accessed leaderboards (optional)

---

## Troubleshooting

**Q: Metrics show 0:00 for all time values**  
A: This agent (VDCL - "Inbound No Agent") is system placeholder, not real agent. Use actual agent codes (MAS\*, IDC\*).

**Q: Employee not found in HRMS**  
A: Sync employee_code mapping between dialer and HRMS employees table.

**Q: KPI metrics not configured**  
A: Run INSERT queries from Database Schema section above.

**Q: Process has no targets**  
A: Configure targets in kpi_process_config table per process.

---

## Implementation Files

- `backend/src/workers/domains/dialer-kpi-sync.ts` - Core sync logic
- `backend/src/modules/dialer/dialer-kpi.controller.ts` - API controllers
- `backend/src/modules/dialer/dialer.routes.ts` - Routes (includes KPI endpoints)
- `backend/scripts/test-dialer-kpi-metrics-only.cjs` - Test script
- `src/pages/NativeOperationsKPI.tsx` - Frontend KPI dashboard

---

## Next Steps

1. Configure call center KPI metrics in `kpi_metric` table
2. Set process-specific targets in `kpi_process_config`
3. Run manual sync test for a recent date
4. Integrate frontend queries into NativeOperationsKPI page
5. Set up daily automated sync cron job
6. Monitor data quality and scoring accuracy
