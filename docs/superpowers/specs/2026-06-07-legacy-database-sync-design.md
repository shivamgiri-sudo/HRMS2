# Legacy Database Sync System Design

**Date**: 2026-06-07  
**Project**: HRMS1 (MAS Callnet HRMS)  
**Timeline**: 1 month transition period  
**Status**: Design Approved  

---

## Executive Summary

Build a comprehensive real-time sync system to migrate data from legacy SQL Server database (`db_bill` on 192.168.10.22) to HRMS MySQL database during 1-month transition period. After transition, legacy databases will be decommissioned and HRMS becomes the primary system.

**Key Requirements**:
- Near real-time sync (60-second intervals)
- Multi-domain support (Employee, Attendance, Salary, Leave, Assets, etc.)
- SQL Server Change Tracking for efficient incremental sync
- Metadata-based discovery (no full table scans)
- Legacy always wins conflicts (source of truth during transition)
- Admin user setup (shivam.giri@teammas.in)
- Production-ready monitoring and error handling

**Architecture**: Separate sync worker process running parallel domain handlers with Change Tracking-based incremental sync.

---

## 1. Context & Goals

### 1.1 Business Context

- **Current State**: Data scattered across legacy SQL Server databases
- **Transition Period**: 1 month for testing and validation
- **End State**: Legacy databases decommissioned, HRMS is primary
- **Criticality**: Business operations depend on successful migration

### 1.2 Technical Context

**Existing HRMS Architecture**:
- MySQL primary database (`mas_hrms` on 122.184.128.90)
- Node.js/Express backend with TypeScript
- SQL Server integration already exists (NCOSEC biometric)
- Modular backend structure (40+ modules)
- `mssql` package already installed

**Legacy Database**:
- Microsoft SQL Server
- Host: 192.168.10.22 Port: 1433
- Database: db_bill
- 412 tables (unknown structure initially)
- Change Tracking can be enabled

### 1.3 Success Criteria

- [ ] All critical HRMS domains syncing within 60 seconds
- [ ] Zero data loss during transition
- [ ] Sync errors < 0.1% of total records
- [ ] Admin can monitor and control sync via UI
- [ ] System handles 100K+ records/day
- [ ] Graceful error handling and recovery
- [ ] Complete audit trail of all syncs

---

## 2. Architecture Overview

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────┐
│                 Legacy SQL Server                   │
│              (db_bill @ 192.168.10.22)             │
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │   Change Tracking Enabled                     │ │
│  │   - Tracks INSERT/UPDATE/DELETE               │ │
│  │   - Retention: 2 days                         │ │
│  │   - Tables: Employee, Attendance, Salary...   │ │
│  └───────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
                         │
                         │ READ (60s intervals)
                         ▼
┌─────────────────────────────────────────────────────┐
│              Sync Worker Process                    │
│         (Separate from main API)                    │
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │   Change Tracking Engine                      │ │
│  │   - Fetches changes since last checkpoint     │ │
│  │   - Batch processing (1000 rows)              │ │
│  └───────────────────────────────────────────────┘ │
│                         │                           │
│                         ▼                           │
│  ┌───────────────────────────────────────────────┐ │
│  │   Parallel Domain Processors                  │ │
│  │   ┌─────────┬─────────┬─────────┬──────────┐ │ │
│  │   │Employee │Attendance│ Salary  │  Leave   │ │ │
│  │   │ Handler │ Handler  │ Handler │ Handler  │ │ │
│  │   └─────────┴─────────┴─────────┴──────────┘ │ │
│  │                                               │ │
│  │   Each handler:                               │ │
│  │   1. Fetch changes                            │ │
│  │   2. Transform & validate                     │ │
│  │   3. Stage records                            │ │
│  │   4. Merge to target                          │ │
│  └───────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
                         │
                         │ WRITE (upsert)
                         ▼
┌─────────────────────────────────────────────────────┐
│               HRMS MySQL Database                   │
│            (mas_hrms @ 122.184.128.90)             │
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │   Staging Tables                              │ │
│  │   - stg_legacy_employee_master                │ │
│  │   - stg_legacy_attendance                     │ │
│  │   - Raw data with validation                  │ │
│  └───────────────────────────────────────────────┘ │
│                         │                           │
│                         ▼ (merge)                   │
│  ┌───────────────────────────────────────────────┐ │
│  │   Final HRMS Tables                           │ │
│  │   - employees                                 │ │
│  │   - wfm_attendance_log                        │ │
│  │   - payroll_run_line                          │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │   Sync Metadata                               │ │
│  │   - legacy_sync_checkpoint                    │ │
│  │   - legacy_sync_run_log                       │ │
│  │   - legacy_sync_exception                     │ │
│  └───────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
                         │
                         │ REST API
                         ▼
┌─────────────────────────────────────────────────────┐
│              Main HRMS API Server                   │
│                 (Port 5055)                         │
│                                                     │
│  Routes: /api/legacy/*                             │
│  - Connection health                               │
│  - Schema analysis                                 │
│  - Mapping management                              │
│  - Sync control & status                           │
│  - Exception handling                              │
└─────────────────────────────────────────────────────┘
                         │
                         │ HTTP
                         ▼
┌─────────────────────────────────────────────────────┐
│             Migration Console UI                    │
│          (React page in HRMS frontend)              │
│                                                     │
│  Tabs:                                             │
│  - Discovery: Scan & analyze legacy DB             │
│  - Mappings: Configure domain mappings             │
│  - Sync Status: Monitor real-time sync             │
│  - Logs: View history & exceptions                 │
└─────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

**1. Discovery Phase** (One-time, manually triggered):
```
Admin triggers scan
  → Analyzer reads INFORMATION_SCHEMA (metadata only)
  → Calculates relevance scores
  → Stores in legacy_source_table_profile
  → Generates mapping candidates
  → Admin approves mappings
  → Creates legacy_sync_map records
```

**2. Sync Phase** (Every 60 seconds, automated):
```
Worker wakes up
  → Checks active sync maps
  → Groups by priority (dependencies)
  → For each domain in parallel:
      1. Query Change Tracking for changes since last checkpoint
      2. Transform legacy data → HRMS format
      3. Validate transformed records
      4. Insert into staging table
      5. Merge staging → final HRMS tables
      6. Update checkpoint with new CT version
      7. Log success/failure
  → Complete cycle
  → Sleep 60 seconds
  → Repeat
```

**3. Error Handling**:
```
Exception detected
  → Log to legacy_sync_exception
  → Mark sync run as partial failure
  → Continue with other records
  → Admin reviews in UI
  → Resolves manually or retries
```

---

## 3. Database Schema

### 3.1 Metadata Tables

```sql
-- Table profiles from legacy DB analysis
CREATE TABLE legacy_source_table_profile (
  id                      CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  source_db               VARCHAR(100) NOT NULL DEFAULT 'db_bill',
  schema_name             VARCHAR(100) NOT NULL,
  table_name              VARCHAR(255) NOT NULL,
  row_count               BIGINT,
  last_user_update        DATETIME,
  candidate_latest_column VARCHAR(255),
  max_candidate_date      DATETIME,
  relevance_score         INT DEFAULT 0,
  relevance_reason        TEXT,
  scan_status             VARCHAR(50) DEFAULT 'pending',
  scanned_at              DATETIME,
  created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY (source_db, schema_name, table_name)
);

-- Column profiles
CREATE TABLE legacy_source_column_profile (
  id              CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  source_db       VARCHAR(100) NOT NULL DEFAULT 'db_bill',
  schema_name     VARCHAR(100) NOT NULL,
  table_name      VARCHAR(255) NOT NULL,
  column_name     VARCHAR(255) NOT NULL,
  data_type       VARCHAR(100),
  max_length      INT,
  is_nullable     TINYINT(1),
  ordinal_position INT,
  matched_domain  VARCHAR(100),
  confidence_score INT DEFAULT 0,
  scanned_at      DATETIME,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY (source_db, schema_name, table_name, column_name)
);
```

### 3.2 Mapping Tables

```sql
-- Suggested mappings (pending approval)
CREATE TABLE legacy_mapping_candidates (
  id                   CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  hrms_domain          VARCHAR(100) NOT NULL,
  hrms_target_table    VARCHAR(255),
  hrms_target_column   VARCHAR(255),
  legacy_schema        VARCHAR(100) NOT NULL,
  legacy_table         VARCHAR(255) NOT NULL,
  legacy_column        VARCHAR(255),
  confidence_score     INT DEFAULT 0,
  mapping_reason       TEXT,
  sample_safe_values   TEXT,
  approved_status      VARCHAR(50) DEFAULT 'pending',
  approved_by          CHAR(36),
  approved_at          DATETIME,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX (hrms_domain),
  INDEX (approved_status)
);

-- Active sync configurations (approved only)
CREATE TABLE legacy_sync_map (
  id                       CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  hrms_domain              VARCHAR(100) NOT NULL,
  source_schema            VARCHAR(100) NOT NULL,
  source_table             VARCHAR(255) NOT NULL,
  source_key_column        VARCHAR(255) NOT NULL,
  source_watermark_column  VARCHAR(255),
  target_table             VARCHAR(255) NOT NULL,
  target_key_column        VARCHAR(255) NOT NULL,
  column_mapping_json      JSON NOT NULL,
  transform_rules_json     JSON,
  sync_mode                VARCHAR(50) DEFAULT 'upsert',
  sync_order               INT DEFAULT 100,
  active_status            TINYINT(1) DEFAULT 1,
  approved_by              CHAR(36),
  approved_at              DATETIME,
  created_at               DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY (hrms_domain, source_schema, source_table)
);
```

### 3.3 Sync State Tables

```sql
-- Checkpoint per sync map
CREATE TABLE legacy_sync_checkpoint (
  id                    CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  sync_map_id           CHAR(36) NOT NULL,
  last_watermark_value  VARCHAR(255),
  last_source_key       VARCHAR(255),
  last_ct_version       BIGINT,
  last_success_at       DATETIME,
  last_run_status       VARCHAR(50),
  last_error            TEXT,
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY (sync_map_id),
  FOREIGN KEY (sync_map_id) REFERENCES legacy_sync_map(id) ON DELETE CASCADE
);

-- Sync run audit log
CREATE TABLE legacy_sync_run_log (
  id             CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  sync_map_id    CHAR(36) NOT NULL,
  run_type       VARCHAR(50) DEFAULT 'incremental',
  started_at     DATETIME NOT NULL,
  finished_at    DATETIME,
  rows_read      INT DEFAULT 0,
  rows_inserted  INT DEFAULT 0,
  rows_updated   INT DEFAULT 0,
  rows_skipped   INT DEFAULT 0,
  rows_failed    INT DEFAULT 0,
  status         VARCHAR(50) DEFAULT 'running',
  error_message  TEXT,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX (sync_map_id),
  INDEX (status),
  INDEX (started_at DESC),
  FOREIGN KEY (sync_map_id) REFERENCES legacy_sync_map(id) ON DELETE CASCADE
);

-- Exceptions requiring manual intervention
CREATE TABLE legacy_sync_exception (
  id                CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  sync_map_id       CHAR(36) NOT NULL,
  sync_run_log_id   CHAR(36),
  exception_type    VARCHAR(100) NOT NULL,
  source_key        VARCHAR(255),
  source_data_json  JSON,
  target_data_json  JSON,
  error_message     TEXT,
  resolved_status   VARCHAR(50) DEFAULT 'pending',
  resolved_by       CHAR(36),
  resolved_at       DATETIME,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX (exception_type),
  INDEX (resolved_status),
  FOREIGN KEY (sync_map_id) REFERENCES legacy_sync_map(id) ON DELETE CASCADE
);
```

### 3.4 Staging Tables (Example)

```sql
-- Staging for employee domain
CREATE TABLE stg_legacy_employee_master (
  id                    CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  sync_run_id           CHAR(36) NOT NULL,
  source_db             VARCHAR(100) NOT NULL,
  source_schema         VARCHAR(100) NOT NULL,
  source_table          VARCHAR(255) NOT NULL,
  source_key            VARCHAR(255) NOT NULL,
  source_updated_at     DATETIME,
  raw_payload_json      JSON NOT NULL,
  -- Normalized columns
  employee_code         VARCHAR(100),
  full_name             VARCHAR(255),
  first_name            VARCHAR(100),
  last_name             VARCHAR(100),
  official_email        VARCHAR(255),
  personal_email        VARCHAR(255),
  mobile                VARCHAR(20),
  date_of_joining       DATE,
  date_of_exit          DATE,
  branch_code           VARCHAR(50),
  branch_id             CHAR(36),
  process_code          VARCHAR(50),
  process_id            CHAR(36),
  department_code       VARCHAR(50),
  department_id         CHAR(36),
  designation_code      VARCHAR(50),
  designation_id        CHAR(36),
  reporting_manager_code VARCHAR(100),
  employment_status     VARCHAR(50),
  active_status         TINYINT(1),
  processed_status      VARCHAR(50) DEFAULT 'pending',
  processed_at          DATETIME,
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX (source_key),
  INDEX (processed_status),
  INDEX (employee_code)
);

-- Similar staging tables for other domains:
-- stg_legacy_branch_master
-- stg_legacy_process_master
-- stg_legacy_attendance
-- stg_legacy_leave_balance
-- stg_legacy_salary_component
-- stg_legacy_assets
```

---

## 4. Backend Implementation

### 4.1 Module Structure

```
backend/
├── src/
│   ├── db/
│   │   ├── mysql.ts (existing)
│   │   ├── ncosecDb.ts (existing)
│   │   └── legacyDb.ts (NEW - SQL Server connection)
│   │
│   ├── modules/
│   │   └── legacy/
│   │       ├── legacy.routes.ts (NEW - REST API)
│   │       ├── legacy.service.ts (NEW - Business logic)
│   │       ├── legacy-analyzer.service.ts (NEW - Metadata scan)
│   │       └── types.ts (NEW - TypeScript interfaces)
│   │
│   └── workers/
│       ├── legacy-sync-worker.ts (NEW - Main orchestrator)
│       ├── sync-engine/
│       │   ├── change-tracking-engine.ts (NEW)
│       │   ├── domain-processor.ts (NEW)
│       │   └── checkpoint-manager.ts (NEW)
│       └── domains/
│           ├── employee-sync-handler.ts (NEW)
│           ├── attendance-sync-handler.ts (NEW)
│           ├── salary-sync-handler.ts (NEW)
│           ├── branch-sync-handler.ts (NEW)
│           ├── process-sync-handler.ts (NEW)
│           ├── leave-sync-handler.ts (NEW)
│           ├── assets-sync-handler.ts (NEW)
│           └── base-sync-handler.ts (NEW - Abstract base)
│
├── sql/
│   ├── 060_legacy_sync_schema.sql (NEW)
│   └── 061_admin_setup.sql (NEW)
│
└── scripts/
    ├── generate-admin-hash.ts (NEW)
    ├── test-legacy-connection.ts (NEW)
    └── enable-change-tracking.sql (NEW - for IT)
```

### 4.2 Environment Variables

```bash
# Legacy SQL Server
LEGACY_MSSQL_HOST=192.168.10.22
LEGACY_MSSQL_PORT=1433
LEGACY_MSSQL_DATABASE=db_bill
LEGACY_MSSQL_USER=hrms_readonly
LEGACY_MSSQL_PASSWORD=<secure>
LEGACY_MSSQL_ENCRYPT=false
LEGACY_MSSQL_TRUST_CERT=true

# Sync Configuration
LEGACY_SYNC_ENABLED=false  # Must enable explicitly
LEGACY_SYNC_INTERVAL_MS=60000
LEGACY_SYNC_BATCH_SIZE=1000
LEGACY_SYNC_PARALLEL_DOMAINS=true
LEGACY_SYNC_MAX_RETRIES=3
LEGACY_SYNC_RETRY_DELAY_MS=5000
LEGACY_CT_RETENTION_DAYS=2
```

### 4.3 API Endpoints

```
GET    /api/legacy/health
GET    /api/legacy/connection-info

POST   /api/legacy/analyze/schema
POST   /api/legacy/analyze/top-candidates
GET    /api/legacy/tables/:schema/:table/profile
GET    /api/legacy/tables/:schema/:table/sample

GET    /api/legacy/mapping-candidates
POST   /api/legacy/mapping-candidates/:id/approve
POST   /api/legacy/mapping-candidates/:id/reject
GET    /api/legacy/sync-maps
POST   /api/legacy/sync-maps
PATCH  /api/legacy/sync-maps/:id/toggle

GET    /api/legacy/sync/status
POST   /api/legacy/sync/run-once
POST   /api/legacy/sync/start
GET    /api/legacy/sync/history
GET    /api/legacy/sync/runs/:id

GET    /api/legacy/exceptions
POST   /api/legacy/exceptions/:id/resolve

POST   /api/legacy/query/test
GET    /api/legacy/change-tracking/info
```

### 4.4 Domain Handler Interface

```typescript
interface DomainSyncHandler {
  domain: string;
  columnMapping: Record<string, string>;
  
  fetchChanges(
    syncMap: SyncMap,
    checkpoint: SyncCheckpoint
  ): Promise<LegacyChange[]>;
  
  transform(
    change: LegacyChange
  ): Promise<TransformedRecord>;
  
  validate(
    record: TransformedRecord
  ): Promise<ValidationResult>;
  
  stageRecords(
    records: TransformedRecord[]
  ): Promise<StagingResult>;
  
  mergeToTarget(
    stagingIds: string[]
  ): Promise<MergeResult>;
  
  handleException(
    error: SyncError
  ): Promise<void>;
}
```

### 4.5 Sync Order & Dependencies

```typescript
const SYNC_ORDER = {
  // Group 1: Master data (no dependencies)
  1: [
    'branch_master',
    'process_master',
    'department_master',
    'designation_master'
  ],
  
  // Group 2: Employee data (depends on group 1)
  2: [
    'employee_master',
    'reporting_manager'
  ],
  
  // Group 3: Transactional data (depends on group 2)
  3: [
    'attendance',
    'leave_balance',
    'salary_component',
    'assets'
  ],
};
```

---

## 5. Frontend Implementation

### 5.1 New Page: Migration Console

**Route**: `/migration-console`

**Page Code**: `MIGRATION_CONSOLE` (admin only)

**Structure**:
```tsx
<MigrationConsolePage>
  <Header>
    <ConnectionStatus />
    <LastSyncTime />
    <SyncNowButton />
  </Header>
  
  <Tabs>
    <Tab id="discovery">
      <DiscoveryTab>
        - Test Connection
        - Scan Schema Button
        - Stats Cards (total, relevant, high priority)
        - Table List (sortable, filterable)
        - Sample Data Modal
      </DiscoveryTab>
    </Tab>
    
    <Tab id="mappings">
      <MappingsTab>
        - Domain Filter
        - Mapping Candidates Table
        - Approve/Reject Actions
        - Active Sync Maps Table
        - Mapping Detail Modal
      </MappingsTab>
    </Tab>
    
    <Tab id="sync-status">
      <SyncStatusTab>
        - Status Overview Cards
        - Manual Trigger Button
        - Domain Sync Status (live updates)
        - Today's Summary
      </SyncStatusTab>
    </Tab>
    
    <Tab id="logs">
      <LogsTab>
        - Filters (domain, status, date range)
        - Sync Run History Table
        - Exceptions Table
        - Resolve Exception Modal
      </LogsTab>
    </Tab>
  </Tabs>
</MigrationConsolePage>
```

### 5.2 Real-Time Updates

Polling strategy (every 5 seconds when sync active):

```typescript
useEffect(() => {
  if (tab === 'sync-status' && syncRunning) {
    const interval = setInterval(async () => {
      const status = await hrmsApi.get('/api/legacy/sync/status');
      setSyncStatus(status.data);
    }, 5000);
    
    return () => clearInterval(interval);
  }
}, [tab, syncRunning]);
```

---

## 6. Deployment

### 6.1 Two-Process Architecture

**Process 1: Main API** (PM2: `hrms-api`)
- Port 5055
- Routes: All HRMS APIs including `/api/legacy/*`
- Instances: 2 (cluster mode)

**Process 2: Sync Worker** (PM2: `hrms-legacy-worker`)
- No HTTP port
- Background sync loop (60s interval)
- Instances: 1 (fork mode)
- Auto-restart on crash

### 6.2 PM2 Configuration

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'hrms-api',
      script: './dist/server.js',
      instances: 2,
      exec_mode: 'cluster',
      env: { NODE_ENV: 'production', PORT: 5055 },
    },
    {
      name: 'hrms-legacy-worker',
      script: './dist/workers/legacy-sync-worker.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        LEGACY_SYNC_ENABLED: 'true',
      },
      restart_delay: 5000,
    }
  ]
};
```

---

## 7. Security

### 7.1 Credentials

- All credentials in `.env` only
- Never logged or exposed in API responses
- Use read-only SQL Server user if possible
- Connection strings never returned from APIs

### 7.2 Access Control

- All `/api/legacy/*` routes require `admin` role
- Admin user (`shivam.giri@teammas.in`) assigned via SQL script
- Password hash generated with bcrypt (10 rounds)
- Migration Console page gated by `MIGRATION_CONSOLE` page code

### 7.3 Data Protection

- Raw legacy data stored in staging with audit trail
- Sensitive fields (salary) logged with encryption
- Exception data sanitized before display
- SQL injection prevented (parameterized queries only)

---

## 8. Testing Strategy

### 8.1 Week 1: Unit Tests

- Relevance scoring algorithm
- Column mapping logic
- Data transformation rules
- Validation functions

### 8.2 Week 2: Integration Tests

- End-to-end sync with test data
- Change Tracking incremental sync
- Error handling and retry logic
- Checkpoint recovery

### 8.3 Week 3: UAT

8 test scenarios covering:
- Connection & discovery
- Mapping configuration
- Manual sync execution
- Data validation
- Incremental sync
- Error handling
- High volume (attendance)
- Continuous sync monitoring

---

## 9. Monitoring & Alerts

### 9.1 Key Metrics

- Sync cycle duration
- Rows synced per second
- Consecutive failures count
- Exception rate
- Worker uptime

### 9.2 Alert Rules

- **Critical**: Worker down > 5 minutes
- **Critical**: Change Tracking retention < 12 hours
- **Warning**: Exception count > 100/day
- **Warning**: Sync duration > 5 minutes

### 9.3 Logging

Structured JSON logs with:
- Timestamp
- Domain
- Operation (fetch, transform, merge)
- Row counts
- Duration
- Errors

---

## 10. Rollback & Recovery

### 10.1 Bad Sync Rollback

```sql
-- Mark staging records for re-sync
UPDATE stg_legacy_employee_master 
SET processed_status = 'rollback' 
WHERE sync_run_id = '<bad-run-id>';

-- Reset checkpoint
UPDATE legacy_sync_checkpoint 
SET last_ct_version = <previous-version>
WHERE sync_map_id = '<map-id>';
```

### 10.2 Worker Crash Recovery

- Checkpoint preserves last successful version
- Incomplete sync marked as 'failed'
- Next cycle resumes from checkpoint
- No duplicate processing (idempotent)

### 10.3 Full Reset

```bash
pm2 stop hrms-legacy-worker
# Truncate all sync tables
# Optionally clear final tables
pm2 start hrms-legacy-worker
```

---

## 11. Post-Migration Sunset

After 1 month when legacy decommissioned:

```bash
# Stop worker permanently
pm2 stop hrms-legacy-worker
pm2 delete hrms-legacy-worker

# Disable in config
echo "LEGACY_SYNC_ENABLED=false" >> .env

# Archive logs
mysqldump mas_hrms \
  legacy_sync_run_log \
  legacy_sync_exception \
  > legacy_sync_archive.sql

# Clean staging tables
DROP TABLE stg_legacy_*;

# Keep metadata for reference
# (legacy_source_table_profile, legacy_mapping_candidates)
```

---

## 12. Timeline & Milestones

**Week 1: Foundation**
- Day 1-2: Admin setup + database schema
- Day 3-4: Legacy connection + analyzer
- Day 5-7: Core sync engine + Change Tracking

**Week 2: Domain Handlers**
- Day 8-10: Employee, Branch, Process handlers
- Day 11-12: Attendance handler (high volume)
- Day 13-14: Salary, Leave, Assets handlers

**Week 3: UI & Production**
- Day 15-17: Migration Console UI
- Day 18-19: Testing & bug fixes
- Day 20-21: Production deployment + monitoring

---

## 13. Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Change Tracking not available | High | Low | Fallback to watermark polling |
| Legacy DB performance degraded | Medium | Medium | Read-only user, indexed queries |
| Sync too slow (> 60s) | High | Medium | Parallel domains, batch tuning |
| Data corruption during sync | Critical | Low | Staging tables, rollback procedures |
| Worker crashes frequently | Medium | Low | PM2 auto-restart, error handling |
| 1-month timeline too tight | High | Medium | Prioritize critical domains first |

---

## 14. Success Metrics

After 1 month:
- [ ] 100% of critical domains syncing
- [ ] < 0.1% exception rate
- [ ] Avg sync cycle < 2 minutes
- [ ] Zero unresolved critical exceptions
- [ ] Admin trained and comfortable with console
- [ ] Complete audit trail maintained
- [ ] Legacy databases successfully decommissioned

---

## Appendices

### A. Relevance Scoring Algorithm

```typescript
function calculateRelevanceScore(table: TableProfile): number {
  let score = 0;
  if (table.hasEmployeeColumn) score += 30;
  if (table.hasDateColumns) score += 20;
  if (table.hasOrgColumns) score += 15;
  if (table.recentlyUpdated) score += 20;
  if (table.hasWatermarkColumn) score += 10;
  if (table.rowCount > 100 && table.rowCount < 10_000_000) score += 5;
  return score;
}
```

**Priority Tiers**:
- 90-100: Critical
- 70-89: Important
- 50-69: Useful
- <50: Low priority

### B. Column Name Patterns

**Employee identifiers**:
`EmpCode`, `EmpID`, `EmployeeCode`, `Employee_Code`

**Org structure**:
`Branch`, `BranchCode`, `Process`, `ProcessName`, `Department`, `Dept`

**Dates**:
`DOJ`, `DateOfJoining`, `DOL`, `CreatedAt`, `UpdatedAt`, `ModifiedDate`

**Attendance**:
`AttendanceDate`, `InTime`, `OutTime`, `Punch`, `Login`, `Logout`

**Payroll**:
`Salary`, `CTC`, `Basic`, `HRA`, `PF`, `ESIC`, `NetSalary`

### C. Change Tracking Setup (IT)

```sql
-- Enable on database
ALTER DATABASE db_bill  
SET CHANGE_TRACKING = ON  
(CHANGE_RETENTION = 2 DAYS, AUTO_CLEANUP = ON);

-- Enable on table
ALTER TABLE dbo.EmployeeMaster  
ENABLE CHANGE_TRACKING;

-- Verify
SELECT * FROM sys.change_tracking_tables;
```

### D. Admin Setup SQL

```sql
START TRANSACTION;

-- Create/update user
INSERT INTO auth_user (id, email, password_hash, is_blocked)
VALUES (UUID(), 'shivam.giri@teammas.in', '<bcrypt-hash>', 0)
ON DUPLICATE KEY UPDATE is_blocked = 0;

-- Assign admin role
SET @user_id = (SELECT id FROM auth_user WHERE email = 'shivam.giri@teammas.in');
INSERT INTO user_roles (id, user_id, role_key, active_status)
VALUES (UUID(), @user_id, 'admin', 1)
ON DUPLICATE KEY UPDATE active_status = 1;

COMMIT;
```

---

**End of Design Document**
