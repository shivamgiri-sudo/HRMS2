# Dialer Database Integration - API Endpoints

## Overview

READ-ONLY integration with ViciDial call center database (`dialer_db`) providing real-time agent activity tracking and call data retrieval for HRMS WFM and productivity monitoring.

**Database**: `dialer_db` @ 122.184.128.90:3306  
**Security**: READ-ONLY enforced at session and query level  
**Authentication**: All endpoints require valid HRMS auth token

---

## Endpoints

### Health Check

```http
GET /api/dialer/health
```

Verify dialer database connection status.

**Response**:
```json
{
  "success": true,
  "message": "Dialer DB connection healthy"
}
```

---

### Agent Status

#### Get Current Agent Status

```http
GET /api/dialer/agent-status/:employeeCode
```

Get agent's most recent activity from vicidial_agent_log.

**Parameters**:
- `employeeCode` (path) - Employee code (e.g., MAS60644, IDC61739)

**Response**:
```json
{
  "success": true,
  "data": {
    "employee_code": "MAS60644",
    "last_activity": "2026-06-04T11:45:49.000Z",
    "status": "PAUSED",
    "campaign_id": "BELLA_O",
    "user_group": "Bella",
    "pause_type": "AGENT",
    "seconds_ago": 313661
  }
}
```

---

#### Get All Active Agents

```http
GET /api/dialer/active-agents
```

List all agents with activity in the last hour.

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "employee_code": "MAS61112",
      "login_time": "2026-06-08T09:15:00.000Z",
      "campaign_id": "BELLA_O",
      "user_group": "Bella"
    }
  ],
  "count": 15
}
```

---

#### Check if Agent is Active

```http
GET /api/dialer/is-active/:employeeCode
```

Quick check if agent has activity in last 5 minutes.

**Response**:
```json
{
  "success": true,
  "data": {
    "employee_code": "MAS60644",
    "is_active": true
  }
}
```

---

### Agent Activity

#### Get Activity History

```http
GET /api/dialer/agent-activity/:employeeCode?start=YYYY-MM-DD&end=YYYY-MM-DD
```

Retrieve agent activity logs for date range.

**Query Parameters**:
- `start` (required) - Start date (YYYY-MM-DD)
- `end` (required) - End date (YYYY-MM-DD)

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "event_time": "2026-06-08T10:30:00.000Z",
      "status": "PAUSED",
      "campaign_id": "BELLA_O",
      "pause_sec": 120,
      "wait_sec": 45,
      "talk_sec": 180,
      "dispo_sec": 30,
      "dead_sec": 0,
      "pause_type": "BREAK"
    }
  ],
  "count": 42
}
```

---

### Call Data

#### Get Inbound Calls

```http
GET /api/dialer/calls/inbound/:employeeCode/:date
```

Retrieve inbound call records for specific date.

**Parameters**:
- `employeeCode` (path) - Employee code
- `date` (path) - Date (YYYY-MM-DD)

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "employee_code": "IDC61739",
      "employee_name": "Hamda fatima",
      "call_time": "2026-06-06T10:15:30.000Z",
      "call_date": "2026-06-06T00:00:00.000Z",
      "campaign": "BELLA_I",
      "customer_phone": "+919876543210",
      "disposition": "SALE",
      "duration_sec": "245",
      "talk_sec": "180",
      "queue_sec": "15",
      "hold_sec": "10",
      "acw_sec": "40"
    }
  ],
  "count": 23
}
```

---

#### Get Outbound Calls

```http
GET /api/dialer/calls/outbound/:employeeCode/:date
```

Retrieve outbound call records for specific date.

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "employee_code": "MAS62686",
      "call_start": "2026-06-06T14:20:00.000Z",
      "call_end": "2026-06-06T14:23:15.000Z",
      "call_date": "2026-06-06T00:00:00.000Z",
      "campaign": "BELLA_O",
      "customer_phone": "+919123456789",
      "status": "SALE",
      "duration_sec": "195",
      "talk_sec": "180",
      "wait_sec": "5",
      "dispo_sec": "10"
    }
  ],
  "count": 47
}
```

---

### Analytics

#### Get Daily Summary

```http
GET /api/dialer/agent-summary/:employeeCode/:date
```

Comprehensive daily summary combining agent activity and call data.

**Response**:
```json
{
  "success": true,
  "data": {
    "employee_code": "MAS62686",
    "date": "2026-06-06",
    "agent_activity": {
      "employee_code": "MAS62686",
      "activity_date": "2026-06-06T00:00:00.000Z",
      "total_activities": 305,
      "total_pause_sec": 3858,
      "total_wait_sec": 1245,
      "total_talk_sec": 19442,
      "total_dispo_sec": 850,
      "total_dead_sec": 120,
      "first_activity": "2026-06-06T09:00:15.000Z",
      "last_activity": "2026-06-06T18:30:45.000Z"
    },
    "calls": {
      "inbound": {
        "total_calls": 45,
        "total_duration_sec": 8750,
        "total_talk_sec": 7200,
        "total_acw_sec": 1550
      },
      "outbound": {
        "total_calls": 52,
        "total_duration_sec": 9800,
        "total_talk_sec": 8500,
        "total_dispo_sec": 1300
      }
    }
  }
}
```

---

#### Get Call Volume by Hour

```http
GET /api/dialer/calls/hourly/:employeeCode/:date
```

Hourly breakdown of call volume.

**Response**:
```json
{
  "success": true,
  "data": [
    { "hour": 9, "call_count": 8, "total_talk_sec": 1440 },
    { "hour": 10, "call_count": 12, "total_talk_sec": 2160 },
    { "hour": 11, "call_count": 15, "total_talk_sec": 2700 }
  ]
}
```

---

#### Get Disposition Breakdown

```http
GET /api/dialer/calls/dispositions/:employeeCode/:date
```

Call outcome statistics.

**Response**:
```json
{
  "success": true,
  "data": [
    { "disposition": "SALE", "count": 12 },
    { "disposition": "CALLBACK", "count": 8 },
    { "disposition": "NO ANSWER", "count": 15 },
    { "disposition": "DNC", "count": 3 }
  ]
}
```

---

## Database Tables

### vicidial_agent_log_11_5
Agent activity tracking with status changes, pause types, and time metrics.

**Key Columns**:
- `user` - Employee code
- `event_time` - Activity timestamp
- `status` - LOGIN, PAUSED, READY, etc.
- `campaign_id` - Campaign identifier
- `pause_sec`, `wait_sec`, `talk_sec`, `dispo_sec` - Time metrics

---

### vw_inbound_cdr (View)
Inbound call detail records.

**Key Columns**:
- `AgentId` - Employee code
- `AgentName` - Agent name
- `CallDate` - Call date
- `Time` - Call timestamp
- `PhoneNumber` - Customer phone
- `Disposition` - Call outcome
- `CallDurationSecond`, `Talkduration`, `Acwduration` - Duration metrics

---

### vw_outbound_cdr (View)
Outbound call detail records.

**Key Columns**:
- `Agent` - Employee code
- `CallDate` - Call date
- `StartTime`, `EndTime` - Call timestamps
- `PhoneNumber` - Customer phone
- `CallStatus` - Call outcome
- `CallDuration`, `talk_sec`, `DispoSec` - Duration metrics

---

## Use Cases

### 1. Real-Time Agent Monitoring
```javascript
// Check if agent is currently active
const response = await hrmsApi.get(`/api/dialer/is-active/MAS60644`);
if (response.data.data.is_active) {
  // Agent online - show live status
}
```

### 2. WFM Attendance Validation
```javascript
// Validate agent clock-in with dialer activity
const summary = await hrmsApi.get(`/api/dialer/agent-summary/MAS60644/2026-06-08`);
const firstActivity = summary.data.agent_activity.first_activity;
// Compare with HRMS attendance punch time
```

### 3. Productivity Reporting
```javascript
// Get daily call metrics for team
const agents = ['MAS60644', 'IDC61739', 'MAS62686'];
const summaries = await Promise.all(
  agents.map(code => 
    hrmsApi.get(`/api/dialer/agent-summary/${code}/2026-06-08`)
  )
);
// Calculate team averages, top performers
```

### 4. Live Dashboard
```javascript
// Show real-time active agents
const activeAgents = await hrmsApi.get('/api/dialer/active-agents');
// Display on WFM live tracking dashboard
```

---

## Security

**READ-ONLY Enforcement**:
1. MySQL session set to `TRANSACTION READ ONLY`
2. Query wrapper blocks non-SELECT statements
3. Connection pool configured with minimal privileges

**Error Example**:
```javascript
// This will throw error:
dialerQuery('UPDATE vicidial_agent_log SET status = ?', ['LOGOUT']);
// Error: DIALER_DB: Only SELECT/SHOW/DESCRIBE queries allowed (READ-ONLY)
```

---

## Implementation Files

- `backend/src/db/dialerDb.ts` - Connection pool and query wrapper
- `backend/src/workers/domains/agent-status-sync.ts` - Agent status sync handler
- `backend/src/workers/domains/call-data-sync.ts` - Call data sync handler
- `backend/src/modules/dialer/dialer.controller.ts` - API controllers
- `backend/src/modules/dialer/dialer.routes.ts` - Express routes
- `backend/scripts/test-dialer-connection.cjs` - Connection test script
- `backend/scripts/test-dialer-api.cjs` - API integration test script

---

## Testing

```bash
# Test database connection
node scripts/test-dialer-connection.cjs

# Test API integration (data queries)
node scripts/test-dialer-api.cjs

# Test API endpoints (requires auth token)
curl -H "Authorization: Bearer <token>" http://localhost:5000/api/dialer/health
```

---

## Production Notes

- **No data modifications**: All queries are SELECT only
- **Real-time data**: Direct query to production dialer database
- **30M+ records**: vicidial tables contain historical data back to 2024
- **Performance**: Connection pooled, indexes on vicidial tables
- **Availability**: 24/7 live data access

---

## Future Enhancements

1. **Caching Layer**: Redis cache for frequently accessed summaries
2. **WebSocket Updates**: Real-time agent status push notifications
3. **Aggregated Tables**: Pre-computed daily/weekly summaries
4. **Integration with WFM**: Auto-populate attendance from dialer activity
5. **Analytics Dashboard**: Grafana/Superset integration for call center metrics
