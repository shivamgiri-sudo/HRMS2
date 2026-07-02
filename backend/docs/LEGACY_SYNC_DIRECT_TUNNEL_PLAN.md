# Legacy Database → HRMS Direct Sync Tunnel Plan

**Date:** 2026-06-07  
**Objective:** Create direct MySQL-to-MySQL sync from legacy `db_bill` to HRMS `mas_hrms`

---

## Source Database (Legacy)

**Connection:**
- Host: 14.97.30.236
- Port: 3306
- Database: `db_bill`
- User: `shivam_user`
- Engine: MySQL 5.5.44

**Primary Table:** `masjclrentry`
- **Total Records:** 32,634 employees
- **Active (Status='1'):** 1,262 employees
- **Inactive (Status='0'):** 31,372 employees
- **Columns:** 165 fields
- **Last Updated:** 2026-06-06 14:58:04 (RECENT!)

---

## Target Database (HRMS)

**Connection:**
- Host: 122.184.128.90
- Port: 3306
- Database: `mas_hrms`
- User: `root`
- Engine: MySQL 8.x

**Primary Table:** `employees`
- Existing structure with UUID primary key
- Generated column: `full_name` = `first_name` + `last_name`

---

## Field Mapping: masjclrentry → employees

### Identity & Core
| Legacy (masjclrentry) | HRMS (employees) | Transform |
|---|---|---|
| `id` | ❌ Don't map | Use UUID for HRMS |
| `EmpCode` | `employee_code` | Direct |
| `BioCode` | Custom field | Add `biometric_code` column |
| `EmpName` | `first_name` + `last_name` | **SPLIT:** "DEEPAK KASHYAP" → first="DEEPAK", last="KASHYAP" |
| `Title` | `title` | Direct (Mr/Ms/Mrs) |
| `Gendar` | `gender` | Direct (typo in legacy) |

### Personal Info
| Legacy | HRMS | Transform |
|---|---|---|
| `DOB` | `date_of_birth` | Convert date format |
| `DOJ` | `date_of_joining` | Convert date format |
| `DOL` | Custom field | Add `date_of_leaving` column |
| `Age` | ❌ Calculated | Generate from DOB |
| `MaritalStatus` | Custom field | Add `marital_status` column |
| `BloodGruop` | Custom field | Add `blood_group` column |
| `Qualification` | Custom field | Add `qualification` column |

### Contact
| Legacy | HRMS | Transform |
|---|---|---|
| `Mobile` | `mobile` | Direct |
| `EmailId` | `email` | Direct |
| `OfficeEmailId` | Custom field | Add `official_email` column |
| `Adrress1` + `Adrress2` | Custom field | Combine addresses |
| `City`, `State`, `PinCode` | Custom fields | Add address fields |

### Government IDs
| Legacy | HRMS | Transform |
|---|---|---|
| `PanNo` | `pan_number` | Direct |
| `AdharId` | `aadhaar_last4` | **MASK:** Only last 4 digits |
| `PassportNo` | Custom field | Add `passport_number` column |
| `EPFNo` | Custom field | Add `epf_number` column |
| `ESICNo` | Custom field | Add `esic_number` column |
| `UAN` | Custom field | Add `uan` column |

### Organization
| Legacy | HRMS | Transform |
|---|---|---|
| `Dept` | Custom field | Add `department` column |
| `Desgination` | Custom field | Add `designation` column |
| `BranchName` | Custom field | Add `branch` column |
| `ClientName` | Custom field | Add `client_name` column |
| `Process` | Custom field | Add `process` column |
| `CostCenter` | Custom field | Add `cost_center` column |

### Banking
| Legacy | HRMS | Transform |
|---|---|---|
| `AcNo` | Custom field | Add `bank_account_number` column |
| `AcBank` | Custom field | Add `bank_name` column |
| `AcBranch` | Custom field | Add `bank_branch` column |
| `IFSCCode` | Custom field | Add `ifsc_code` column |
| `AccHolder` | Custom field | Add `account_holder_name` column |

### Payroll (salary components)
| Legacy | HRMS | Notes |
|---|---|---|
| `CTC` | Payroll table | Sync to `payroll_salary_assignments` |
| `bs`, `hra`, `conv`, `da`, `ma`, `lta`, etc. | Payroll components | Map to `payroll_structure_lines` |
| `Gross`, `NetInhand` | Calculated | Generate from components |

### Status & Timestamps
| Legacy | HRMS | Transform |
|---|---|---|
| `Status` | `active_status` | '1' → true, '0' → false |
| `lastUpdated` | `updated_at` | **CRITICAL FOR INCREMENTAL SYNC** |
| `EntryDate` | `created_at` | Direct |
| `CreateDate` | Backup timestamp | Use if `EntryDate` is null |

---

## Incremental Sync Strategy

### Method: Timestamp-Based (MySQL doesn't have Change Tracking)

**Sync Key:** `lastUpdated` datetime column

**Algorithm:**
```sql
-- Get latest sync checkpoint
SELECT MAX(legacy_last_updated) FROM legacy_sync_checkpoint WHERE domain = 'employee';

-- Fetch changed records
SELECT * FROM db_bill.masjclrentry 
WHERE lastUpdated > @last_sync_time 
ORDER BY lastUpdated ASC 
LIMIT 1000;

-- Transform and upsert to mas_hrms.employees
-- Update checkpoint with MAX(lastUpdated)
```

**Fallback:** If `lastUpdated` is NULL, use `EntryDate` or `CreateDate`

---

## Database Schema Changes Required

### HRMS `employees` table additions

```sql
-- Add missing columns to employees table
ALTER TABLE employees
  ADD COLUMN biometric_code VARCHAR(50) NULL COMMENT 'Biometric/attendance ID',
  ADD COLUMN date_of_leaving DATE NULL,
  ADD COLUMN marital_status VARCHAR(20) NULL,
  ADD COLUMN blood_group VARCHAR(10) NULL,
  ADD COLUMN qualification VARCHAR(100) NULL,
  ADD COLUMN official_email VARCHAR(255) NULL,
  ADD COLUMN address_line1 VARCHAR(255) NULL,
  ADD COLUMN address_line2 VARCHAR(255) NULL,
  ADD COLUMN city VARCHAR(100) NULL,
  ADD COLUMN state VARCHAR(100) NULL,
  ADD COLUMN pincode VARCHAR(20) NULL,
  ADD COLUMN passport_number VARCHAR(50) NULL,
  ADD COLUMN epf_number VARCHAR(50) NULL,
  ADD COLUMN esic_number VARCHAR(50) NULL,
  ADD COLUMN uan VARCHAR(50) NULL,
  ADD COLUMN department VARCHAR(100) NULL,
  ADD COLUMN designation VARCHAR(100) NULL,
  ADD COLUMN branch VARCHAR(100) NULL,
  ADD COLUMN client_name VARCHAR(100) NULL,
  ADD COLUMN process VARCHAR(100) NULL,
  ADD COLUMN cost_center VARCHAR(100) NULL,
  ADD COLUMN bank_account_number VARCHAR(100) NULL,
  ADD COLUMN bank_name VARCHAR(100) NULL,
  ADD COLUMN bank_branch VARCHAR(100) NULL,
  ADD COLUMN ifsc_code VARCHAR(20) NULL,
  ADD COLUMN account_holder_name VARCHAR(100) NULL,
  ADD COLUMN legacy_last_updated DATETIME NULL COMMENT 'Timestamp from legacy system for sync tracking',
  ADD INDEX idx_employee_code (employee_code),
  ADD INDEX idx_biometric_code (biometric_code),
  ADD INDEX idx_legacy_last_updated (legacy_last_updated);
```

### Sync control tables (already created in 060_legacy_sync_schema.sql)

✅ Already exists:
- `legacy_sync_checkpoint` - Tracks last sync timestamp per domain
- `legacy_sync_run_log` - Audit log of sync runs
- `legacy_sync_exception` - Error tracking

---

## Sync Worker Implementation

### Phase 1: MySQL Adapter (Replace SQL Server code)

**File:** `backend/src/db/legacyDb.ts`

**Current:** Uses `mssql` package for SQL Server  
**New:** Use `mysql2/promise` for MySQL

```typescript
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

let legacyPool: mysql.Pool | null = null;

export async function getLegacyPool(): Promise<mysql.Pool> {
  if (!legacyPool) {
    legacyPool = mysql.createPool({
      host: env.LEGACY_MYSQL_HOST,
      port: env.LEGACY_MYSQL_PORT,
      user: env.LEGACY_MYSQL_USER,
      password: env.LEGACY_MYSQL_PASSWORD,
      database: env.LEGACY_MYSQL_DATABASE,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
    });
  }
  return legacyPool;
}
```

### Phase 2: Employee Sync Handler (Update for MySQL)

**File:** `backend/src/workers/domains/employee-sync-handler.ts`

**Key Changes:**
- Replace Change Tracking queries with timestamp-based queries
- Add name splitting logic (`EmpName` → `first_name` + `last_name`)
- Add Aadhaar masking (only last 4 digits)
- Map all 165 fields to HRMS schema

**Transform Function:**
```typescript
transform(legacyRecord: any): EmployeeRecord {
  // Split name
  const nameParts = (legacyRecord.EmpName || '').trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';
  
  // Mask Aadhaar (security)
  const aadhaarLast4 = legacyRecord.AdharId 
    ? legacyRecord.AdharId.slice(-4) 
    : null;
  
  return {
    employee_code: legacyRecord.EmpCode,
    biometric_code: legacyRecord.BioCode,
    first_name: firstName,
    last_name: lastName,
    title: legacyRecord.Title,
    gender: legacyRecord.Gendar, // Note typo in legacy
    date_of_birth: legacyRecord.DOB,
    date_of_joining: legacyRecord.DOJ,
    date_of_leaving: legacyRecord.DOL,
    mobile: legacyRecord.Mobile,
    email: legacyRecord.EmailId,
    official_email: legacyRecord.OfficeEmailId,
    pan_number: legacyRecord.PanNo,
    aadhaar_last4: aadhaarLast4,
    passport_number: legacyRecord.PassportNo,
    epf_number: legacyRecord.EPFNo,
    esic_number: legacyRecord.ESICNo,
    uan: legacyRecord.UAN,
    department: legacyRecord.Dept,
    designation: legacyRecord.Desgination, // Note typo
    branch: legacyRecord.BranchName,
    client_name: legacyRecord.ClientName,
    process: legacyRecord.Process,
    cost_center: legacyRecord.CostCenter,
    bank_account_number: legacyRecord.AcNo,
    bank_name: legacyRecord.AcBank,
    bank_branch: legacyRecord.AcBranch,
    ifsc_code: legacyRecord.IFSCCode,
    account_holder_name: legacyRecord.AccHolder,
    marital_status: legacyRecord.MaritalStatus,
    blood_group: legacyRecord.BloodGruop, // Note typo
    qualification: legacyRecord.Qualification,
    address_line1: legacyRecord.Adrress1, // Note typo
    address_line2: legacyRecord.Adrress2,
    city: legacyRecord.City,
    state: legacyRecord.State,
    pincode: legacyRecord.PinCode,
    active_status: legacyRecord.Status === '1',
    legacy_last_updated: legacyRecord.lastUpdated,
    created_at: legacyRecord.EntryDate || legacyRecord.CreateDate,
  };
}
```

**Incremental Fetch Query:**
```typescript
async fetchChanges(lastSyncTime: Date): Promise<any[]> {
  const pool = await getLegacyPool();
  
  const [rows] = await pool.execute(`
    SELECT * 
    FROM masjclrentry 
    WHERE lastUpdated > ? 
    ORDER BY lastUpdated ASC 
    LIMIT ?
  `, [lastSyncTime, this.batchSize]);
  
  return rows as any[];
}
```

### Phase 3: Merge Strategy

**Upsert Logic:**
```sql
INSERT INTO employees (
  id, employee_code, biometric_code, first_name, last_name, ...
) VALUES (
  UUID(), ?, ?, ?, ?, ...
)
ON DUPLICATE KEY UPDATE
  biometric_code = VALUES(biometric_code),
  first_name = VALUES(first_name),
  last_name = VALUES(last_name),
  ... all fields ...,
  updated_at = NOW();
```

**Conflict Resolution:** Legacy wins during transition period (update all fields)

---

## Testing Plan

### Phase 1: Connection Test
```bash
node scripts/test-mysql-legacy.ts
# Expected: ✅ Connected, 32,634 rows in masjclrentry
```

### Phase 2: Schema Migration
```bash
mysql -h 122.184.128.90 -u root -p mas_hrms < backend/sql/062_employees_legacy_fields.sql
# Adds all missing columns to employees table
```

### Phase 3: Sample Sync (10 records)
```bash
# Set LEGACY_SYNC_BATCH_SIZE=10
# Set LEGACY_SYNC_ENABLED=false (manual trigger)
curl -X POST http://localhost:3002/api/legacy/sync/trigger
```

### Phase 4: Full Sync (32K records)
```bash
# Set LEGACY_SYNC_BATCH_SIZE=1000
# Set LEGACY_SYNC_ENABLED=true
# Restart backend
# Monitor: tail -f /tmp/backend.log
```

---

## Rollout Schedule

### Week 1: Infrastructure
- ✅ Database connection verified
- ⏳ Create employees table schema migration (062_employees_legacy_fields.sql)
- ⏳ Update legacyDb.ts to use MySQL
- ⏳ Update employee-sync-handler.ts for MySQL + field mapping

### Week 2: Testing
- ⏳ Run sample sync (10 records)
- ⏳ Verify data accuracy in HRMS
- ⏳ Test incremental sync (update 1 record in legacy, verify sync)
- ⏳ Test active/inactive status handling

### Week 3: Initial Sync
- ⏳ Full historical sync (32K records, ~30 minutes)
- ⏳ Verify all employees in HRMS
- ⏳ Compare counts: legacy vs HRMS

### Week 4: Production
- ⏳ Enable continuous sync (60-second interval)
- ⏳ Monitor sync logs
- ⏳ Train ops team on sync monitoring

---

## Monitoring & Alerts

### Key Metrics
- **Sync lag:** Time between `lastUpdated` and actual sync
- **Error rate:** Failed records / total records
- **Sync frequency:** Runs per hour
- **Record throughput:** Records/second

### Alerts
- ❌ Sync fails 3+ times in a row
- ⚠️ Sync lag > 10 minutes
- ⚠️ Error rate > 5%

### Dashboard Query
```sql
SELECT 
  domain,
  last_sync_time,
  records_processed,
  records_failed,
  TIMESTAMPDIFF(MINUTE, last_sync_time, NOW()) as lag_minutes
FROM legacy_sync_checkpoint
WHERE domain = 'employee';
```

---

## Security Considerations

1. **Aadhaar Masking:** Only store last 4 digits (compliance)
2. **Password Field:** Do NOT sync `Pwd` column (security risk)
3. **Connection Credentials:** Use read-only user if possible
4. **Data at Rest:** Encrypted storage for HRMS database
5. **Audit Trail:** All syncs logged to `legacy_sync_run_log`

---

## Next Steps

1. **Create SQL migration:** `backend/sql/062_employees_legacy_fields.sql`
2. **Update MySQL adapter:** Modify `legacyDb.ts`
3. **Update sync handler:** Rewrite employee-sync-handler.ts for MySQL
4. **Run initial sync:** Test with 10 records first
5. **Enable production sync:** Full 32K records + continuous updates

**Estimated Time:** 2-3 days for development + 1 week testing

**Token Cost:** ~50K tokens for full sync worker rewrite
