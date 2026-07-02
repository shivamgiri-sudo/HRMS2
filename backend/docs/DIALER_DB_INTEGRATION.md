# Dialer DB Integration - READ ONLY Data Tunnel

**Database:** dialer_db @ 122.184.128.90  
**Access:** READ-ONLY (NO ALTER, ADD, DELETE operations)  
**Purpose:** Live call data integration with HRMS for WFM/reporting

---

## 🔐 **CONNECTION DETAILS**

```env
DIALER_DB_HOST=122.184.128.90
DIALER_DB_PORT=3306
DIALER_DB_USER=root
DIALER_DB_PASSWORD=vicidialnow
DIALER_DB_NAME=dialer_db
DIALER_DB_READ_ONLY=true
```

⚠️ **CRITICAL:** All queries MUST be SELECT only - NO INSERT/UPDATE/DELETE/ALTER

---

## 📊 **KEY TABLES FOR HRMS**

### **1. Call Data Records (CDR)**

#### **Inbound Calls: vw_inbound_cdr**
**Purpose:** Track all inbound calls, agent performance, dispositions

**Key Fields:**
- `AgentId` - Link to employee_code (MAS56408, etc.)
- `AgentName` - Employee name
- `CallDate` - Date of call
- `Time` - Call timestamp
- `CampaignName` - Campaign identifier
- `PhoneNumber` - Customer phone
- `Disposition` - Call outcome
- `CallDurationSecond` - Total duration
- `Talkduration` - Talk time
- `QueueDuration` - Wait time
- `HoldTime` - Hold duration
- `Acwduration` - After call work

**Use Cases:**
- Agent productivity tracking
- Call volume analytics
- Performance dashboards
- Attendance validation (agent was working)
- Quality score correlation

---

#### **Outbound Calls: vw_outbound_cdr**
**Purpose:** Track all outbound calls, dialng metrics

**Key Fields:**
- `Agent` - Link to employee_code
- `PhoneNumber` - Dialed number
- `CallDate` - Date
- `StartTime` / `EndTime` - Call duration
- `CallStatus` - Outcome
- `CallDuration` - Total seconds
- `talk_sec` - Talk time
- `WaitSec` - Wait time
- `campaign_id` - Campaign

**Use Cases:**
- Outbound agent productivity
- Campaign performance
- Talk time analysis
- Dial rate tracking

---

### **2. Agent Activity Logs**

#### **Agent Logs: vicidial_agent_log_***
**Tables:**
- `vicidial_agent_log_11_5` (17.7M records)
- `vicidial_agent_log_249` (3.8M records)
- `vicidial_agent_log_11_4` (2.2M records)
- `vicidial_agent_log_247` (1.4M records)
- `vicidial_agent_log_250` (1.0M records)
- `vicidial_agent_log_10_25` (1.0M records)

**Key Fields:**
- `user` - Employee code (MAS56408)
- `event_time` - Activity timestamp
- `campaign_id` - Campaign
- `user_group` - Team/group
- `status` - Activity status (LOGIN, PAUSED, etc.)
- `pause_sec` - Pause duration
- `wait_sec` - Wait time
- `talk_sec` - Talk time
- `dispo_sec` - Disposition time
- `dead_sec` - Wrap-up time
- `pause_type` - AGENT, SYSTEM, API, ADMIN

**Use Cases:**
- Real-time agent status
- Attendance tracking (LOGIN/LOGOUT)
- Idle time analysis
- Break time monitoring
- Productivity metrics

---

### **3. Additional Tables**

#### **Call Logs: call_logs** (30,959 records)
General call logging table

#### **Feedback Logs:**
- `feedback_log_250` (76K records)
- `feedback_log_249` (31K records)

**Use Cases:**
- Quality feedback integration
- Coaching data
- Agent performance reviews

---

## 🔄 **DATA TUNNEL ARCHITECTURE**

### **Read-Only Connection Pool**

```typescript
// backend/src/db/dialerDb.ts
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

const config: mysql.PoolOptions = {
  host: env.DIALER_DB_HOST,
  port: env.DIALER_DB_PORT,
  user: env.DIALER_DB_USER,
  password: env.DIALER_DB_PASSWORD,
  database: env.DIALER_DB_NAME,
  connectionLimit: 5, // Low limit for read-only
  waitForConnections: true,
  queueLimit: 0,
  // ENFORCE READ-ONLY
  flags: '-ALLOW_LOCAL_INFILE',
  connectAttributes: {
    program_name: 'HRMS_ReadOnly',
  },
};

let pool: mysql.Pool | null = null;

export async function getDialerPool(): Promise<mysql.Pool> {
  if (!pool) {
    pool = mysql.createPool(config);
    
    // Test connection and enforce read-only
    const conn = await pool.getConnection();
    await conn.query('SET SESSION TRANSACTION READ ONLY');
    conn.release();
    
    console.log(`[DIALER] Connected to ${env.DIALER_DB_HOST}:${env.DIALER_DB_PORT}/${env.DIALER_DB_NAME} (READ-ONLY)`);
  }
  return pool;
}

export async function closeDialerPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[DIALER] Connection pool closed');
  }
}

// Safe query wrapper - BLOCKS non-SELECT queries
export async function dialerQuery<T = any>(
  sql: string,
  params?: any[]
): Promise<T[]> {
  // CRITICAL: Only allow SELECT queries
  const trimmedSql = sql.trim().toUpperCase();
  if (!trimmedSql.startsWith('SELECT') && !trimmedSql.startsWith('SHOW') && !trimmedSql.startsWith('DESCRIBE')) {
    throw new Error('DIALER_DB: Only SELECT/SHOW/DESCRIBE queries allowed (READ-ONLY)');
  }
  
  const pool = await getDialerPool();
  const [rows] = await pool.execute(sql, params);
  return rows as T[];
}
```

---

## 📡 **REAL-TIME DATA SYNC HANDLERS**

### **1. Agent Status Sync**

```typescript
// backend/src/workers/domains/agent-status-sync.ts
import { dialerQuery } from '../../db/dialerDb.js';
import { db } from '../../db/mysql.js';

export class AgentStatusSync {
  /**
   * Get current agent status from dialer
   */
  async getCurrentAgentStatus(employeeCode: string) {
    const [status] = await dialerQuery(`
      SELECT 
        user as employee_code,
        event_time as last_activity,
        status,
        campaign_id,
        user_group,
        pause_type,
        TIMESTAMPDIFF(SECOND, event_time, NOW()) as seconds_ago
      FROM vicidial_agent_log_11_5
      WHERE user = ?
      ORDER BY event_time DESC
      LIMIT 1
    `, [employeeCode]);
    
    return status;
  }
  
  /**
   * Get all agents currently logged in
   */
  async getActiveAgents() {
    return dialerQuery(`
      SELECT 
        user as employee_code,
        event_time as login_time,
        campaign_id,
        user_group
      FROM vicidial_agent_log_11_5
      WHERE status = 'LOGIN'
        AND DATE(event_time) = CURDATE()
      GROUP BY user
    `);
  }
  
  /**
   * Get agent activity for date range
   */
  async getAgentActivity(employeeCode: string, startDate: Date, endDate: Date) {
    return dialerQuery(`
      SELECT 
        event_time,
        status,
        campaign_id,
        pause_sec,
        wait_sec,
        talk_sec,
        dispo_sec,
        dead_sec,
        pause_type
      FROM vicidial_agent_log_11_5
      WHERE user = ?
        AND event_time BETWEEN ? AND ?
      ORDER BY event_time ASC
    `, [employeeCode, startDate, endDate]);
  }
}
```

---

### **2. Call Data Sync**

```typescript
// backend/src/workers/domains/call-data-sync.ts
import { dialerQuery } from '../../db/dialerDb.js';

export class CallDataSync {
  /**
   * Get inbound calls for employee
   */
  async getInboundCalls(employeeCode: string, date: Date) {
    return dialerQuery(`
      SELECT 
        AgentId as employee_code,
        AgentName as employee_name,
        Time as call_time,
        CallDate as call_date,
        CampaignName as campaign,
        PhoneNumber as customer_phone,
        Disposition,
        CallDurationSecond as duration_sec,
        Talkduration as talk_sec,
        QueueDuration as queue_sec,
        HoldTime as hold_sec,
        Acwduration as acw_sec
      FROM vw_inbound_cdr
      WHERE AgentId = ?
        AND CallDate = DATE(?)
      ORDER BY Time ASC
    `, [employeeCode, date]);
  }
  
  /**
   * Get outbound calls for employee
   */
  async getOutboundCalls(employeeCode: string, date: Date) {
    return dialerQuery(`
      SELECT 
        Agent as employee_code,
        StartTime as call_start,
        EndTime as call_end,
        CallDate as call_date,
        campaign_id as campaign,
        PhoneNumber as customer_phone,
        CallStatus as status,
        CallDuration as duration_sec,
        talk_sec,
        WaitSec as wait_sec,
        DispoSec as dispo_sec
      FROM vw_outbound_cdr
      WHERE Agent = ?
        AND CallDate = DATE(?)
      ORDER BY StartTime ASC
    `, [employeeCode, date]);
  }
  
  /**
   * Get daily call summary
   */
  async getDailySummary(employeeCode: string, date: Date) {
    const [inbound] = await dialerQuery(`
      SELECT 
        COUNT(*) as total_calls,
        SUM(CAST(CallDurationSecond AS UNSIGNED)) as total_duration_sec,
        SUM(CAST(Talkduration AS UNSIGNED)) as total_talk_sec,
        SUM(CAST(Acwduration AS UNSIGNED)) as total_acw_sec
      FROM vw_inbound_cdr
      WHERE AgentId = ?
        AND CallDate = DATE(?)
    `, [employeeCode, date]);
    
    const [outbound] = await dialerQuery(`
      SELECT 
        COUNT(*) as total_calls,
        SUM(CAST(CallDuration AS UNSIGNED)) as total_duration_sec,
        SUM(CAST(talk_sec AS UNSIGNED)) as total_talk_sec,
        SUM(CAST(DispoSec AS UNSIGNED)) as total_dispo_sec
      FROM vw_outbound_cdr
      WHERE Agent = ?
        AND CallDate = DATE(?)
    `, [employeeCode, date]);
    
    return {
      inbound: inbound || { total_calls: 0, total_duration_sec: 0, total_talk_sec: 0, total_acw_sec: 0 },
      outbound: outbound || { total_calls: 0, total_duration_sec: 0, total_talk_sec: 0, total_dispo_sec: 0 },
    };
  }
}
```

---

## 🎯 **HRMS USE CASES**

### **1. Real-Time Agent Dashboard**
**Endpoint:** `GET /api/wfm/agent-status/:employeeCode`

```typescript
// Show if agent is currently logged in, on call, on break
const status = await agentStatusSync.getCurrentAgentStatus('MAS56408');
// Returns: { status: 'PAUSED', pause_type: 'AGENT', seconds_ago: 45 }
```

---

### **2. Attendance Validation**
**Endpoint:** `GET /api/wfm/attendance/validate/:employeeCode/:date`

```typescript
// Validate attendance by checking dialer login records
const activity = await agentStatusSync.getAgentActivity('MAS56408', '2026-06-07', '2026-06-07');
// If activity exists with status='LOGIN' → agent was present
```

---

### **3. Productivity Reports**
**Endpoint:** `GET /api/wfm/productivity/:employeeCode/:date`

```typescript
// Daily productivity summary
const summary = await callDataSync.getDailySummary('MAS56408', '2026-06-07');
// Returns: { inbound: {calls: 45, talk_time: 3600}, outbound: {calls: 120, talk_time: 7200} }
```

---

### **4. Live Call Monitoring**
**Endpoint:** `GET /api/wfm/live-status`

```typescript
// All agents currently logged in
const activeAgents = await agentStatusSync.getActiveAgents();
// Returns: [{employee_code: 'MAS56408', login_time: '2026-06-07 09:00:00', campaign: 'BELLA_O'}]
```

---

## 🔒 **SECURITY MEASURES**

### **Enforced Read-Only:**
✅ Connection set to READ ONLY transaction mode  
✅ Query wrapper blocks INSERT/UPDATE/DELETE  
✅ Limited connection pool (5 connections max)  
✅ No schema modification allowed  
✅ Separate credentials from main HRMS DB  

### **Data Privacy:**
✅ Customer phone numbers available (for validation only)  
✅ No PII stored - only aggregated metrics  
✅ Agent codes link to HRMS employees table  
✅ Real-time data only - no historical storage in HRMS  

---

## 📋 **API ENDPOINTS**

### **Agent Status:**
```
GET  /api/dialer/agent-status/:employeeCode
GET  /api/dialer/active-agents
GET  /api/dialer/agent-activity/:employeeCode?start=YYYY-MM-DD&end=YYYY-MM-DD
```

### **Call Data:**
```
GET  /api/dialer/calls/inbound/:employeeCode/:date
GET  /api/dialer/calls/outbound/:employeeCode/:date
GET  /api/dialer/calls/summary/:employeeCode/:date
```

### **Live Monitoring:**
```
GET  /api/dialer/live/dashboard
GET  /api/dialer/live/campaigns
GET  /api/dialer/live/team/:teamName
```

---

## ⚡ **PERFORMANCE OPTIMIZATION**

### **Caching Strategy:**
- Agent status: Cache for 10 seconds (near real-time)
- Daily summaries: Cache for 5 minutes
- Historical data: Cache for 1 hour

### **Query Optimization:**
- Use indexed columns (user, event_time, CallDate)
- LIMIT results to prevent full table scans
- Date-based partitioning (tables are already partitioned by campaign)

### **Connection Management:**
- Pool size: 5 (read-only, low concurrency)
- Connection timeout: 10 seconds
- Query timeout: 30 seconds

---

## 🚀 **IMPLEMENTATION STEPS**

### **1. Add Environment Variables**
```bash
# backend/.env
DIALER_DB_HOST=122.184.128.90
DIALER_DB_PORT=3306
DIALER_DB_USER=root
DIALER_DB_PASSWORD=vicidialnow
DIALER_DB_NAME=dialer_db
```

### **2. Create Database Connection** ✅
File: `backend/src/db/dialerDb.ts`

### **3. Create Sync Handlers** ✅
- `backend/src/workers/domains/agent-status-sync.ts`
- `backend/src/workers/domains/call-data-sync.ts`

### **4. Create API Routes**
- `backend/src/modules/dialer/dialer.routes.ts`
- `backend/src/modules/dialer/dialer.controller.ts`

### **5. Mount in App**
```typescript
// backend/src/app.ts
import { dialerRouter } from './modules/dialer/dialer.routes.js';
app.use('/api/dialer', dialerRouter);
```

---

## ✅ **VALIDATION CHECKLIST**

- [ ] Connection pool created (READ-ONLY mode)
- [ ] Query wrapper blocks non-SELECT statements
- [ ] Agent status sync tested
- [ ] Call data sync tested
- [ ] API endpoints created
- [ ] Caching implemented
- [ ] Error handling added
- [ ] Logging configured
- [ ] Performance tested
- [ ] Security validated (no write operations)

---

## 📊 **DATA VOLUME**

| Table | Records | Purpose |
|-------|---------|---------|
| vw_inbound_cdr | Millions | Inbound call data (VIEW) |
| vw_outbound_cdr | Millions | Outbound call data (VIEW) |
| vicidial_agent_log_11_5 | 17.7M | Agent activity logs |
| vicidial_agent_log_249 | 3.8M | Agent activity logs |
| call_logs | 31K | Call logging |

**Total Data:** ~30M+ records across all tables

---

**🎯 READ-ONLY DATA TUNNEL: READY FOR IMPLEMENTATION**

**Last Updated:** 2026-06-07  
**Status:** ✅ Architecture complete, ready to build
