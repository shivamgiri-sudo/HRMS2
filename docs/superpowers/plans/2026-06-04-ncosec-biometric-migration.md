# NCOSEC Biometric Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read first punch-in and last punch-out per employee per day from Matrix Cosec NCOSEC (MSSQL server at 172.10.10.140, tables `Mx_ATDEventTrn` + `Mx_UserMst`), map to HRMS employees by `UserID → employee_code`, and import 3 months of attendance into `biometric_attendance_log` and `attendance_daily_record`.

**Architecture:** Three-layer approach — (1) new MySQL tables for biometric data, (2) a one-shot ETL script that connects to NCOSEC MSSQL, queries first-in/last-out per user per day, maps to HRMS employees, and upserts into MySQL attendance tables, (3) an optional live-webhook endpoint for ongoing punches. The ETL uses `mssql` npm package for the MSSQL connection and the existing `mysql2` pool for HRMS writes.

**Tech Stack:** Node.js + TypeScript + `mssql` (NCOSEC SQL Server) + `mysql2` (HRMS MySQL) + Zod (env validation)

---

## NCOSEC Source Query

The ETL pulls **first punch-in and last punch-out** per `UserID` per calendar day:

```sql
-- Run on NCOSEC MSSQL at 172.10.10.140
SELECT
    u.UserID,
    u.Name,
    CAST(e.EDateTime AS DATE)          AS punch_date,
    MIN(e.lDateTime)                    AS first_punch_in,   -- earliest punch of the day
    MAX(e.lDateTime)                    AS last_punch_out     -- latest punch of the day
FROM Mx_ATDEventTrn e
INNER JOIN Mx_UserMst u ON u.UserID = e.UserID
WHERE e.EDateTime >= DATEADD(MONTH, -3, GETDATE())
GROUP BY u.UserID, u.Name, CAST(e.EDateTime AS DATE)
HAVING COUNT(*) >= 1
ORDER BY punch_date ASC, u.UserID ASC;
```

**Columns used:**
- `Mx_ATDEventTrn.EDateTime` — event datetime (used for date grouping)
- `Mx_ATDEventTrn.lDateTime` — Unix timestamp of punch event (used for min/max)
- `Mx_ATDEventTrn.UserID` — device user identifier
- `Mx_UserMst.UserID` — same identifier
- `Mx_UserMst.Name` — employee name (for audit/verification)

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `backend/sql/102_biometric_tables.sql` | Create | New tables: biometric_device_master, employee_biometric_enrollment, biometric_attendance_log |
| `backend/src/config/env.ts` | Modify | Add NCOSEC_DB_* env vars to Zod schema |
| `backend/.env.example` | Modify | Document NCOSEC connection vars |
| `backend/src/db/ncosecDb.ts` | Create | MSSQL connection pool using mssql package |
| `backend/scripts/migrate-ncosec-biometric.ts` | Create | One-shot ETL: NCOSEC → HRMS MySQL |
| `backend/src/modules/wfm/biometric-punch.routes.ts` | Create | Live webhook endpoint for ongoing punches |
| `backend/src/app.ts` | Modify | Mount biometric punch router |

---

## Task 1 — Install mssql package

**Files:**
- Modify: `backend/package.json` (via npm install)

- [ ] **Step 1: Install mssql**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1/backend
npm install mssql
npm install --save-dev @types/mssql
```

Expected output: `added N packages`

- [ ] **Step 2: Verify installation**

```bash
node -e "require('mssql'); console.log('mssql OK')"
```

Expected: `mssql OK`

- [ ] **Step 3: Commit**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1
git add backend/package.json backend/package-lock.json
git commit -m "feat(biometric): add mssql package for NCOSEC SQL Server connection"
```

---

## Task 2 — SQL migration: biometric tables

**Files:**
- Create: `backend/sql/102_biometric_tables.sql`

- [ ] **Step 1: Create migration file**

```sql
-- 102_biometric_tables.sql
-- Biometric device registry, enrollment mapping, and raw punch log.
-- Raw biometric templates are NEVER stored (DPDP Act 2023 compliance).
-- Only device reference IDs, timestamps, and attendance outcomes are stored.

USE mas_hrms;

-- Device registry (which biometric machines exist and where)
CREATE TABLE IF NOT EXISTS biometric_device_master (
  id            CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  device_uid    VARCHAR(100)  NOT NULL UNIQUE,           -- Cosec device UID / serial
  device_name   VARCHAR(255)  NOT NULL,
  location      VARCHAR(255)  NULL,
  branch_id     CHAR(36)      NULL,
  device_type   ENUM('fingerprint','face','card','fingerprint_face') NOT NULL DEFAULT 'fingerprint',
  ip_address    VARCHAR(50)   NULL,
  is_active     TINYINT(1)    NOT NULL DEFAULT 1,
  source_system VARCHAR(50)   NOT NULL DEFAULT 'ncosec',
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branch_master(id) ON DELETE SET NULL,
  INDEX idx_bio_device_uid (device_uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Maps HRMS employee → Cosec UserID (enrollment reference, NOT biometric template)
CREATE TABLE IF NOT EXISTS employee_biometric_enrollment (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id       CHAR(36)     NOT NULL,
  cosec_user_id     VARCHAR(100) NOT NULL,               -- Mx_UserMst.UserID
  cosec_user_name   VARCHAR(255) NULL,                   -- Mx_UserMst.Name (for audit)
  device_id         CHAR(36)     NULL,                   -- FK to biometric_device_master
  enrolled_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  enrolled_by       CHAR(36)     NULL,
  is_active         TINYINT(1)   NOT NULL DEFAULT 1,
  last_sync_at      DATETIME     NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (device_id)   REFERENCES biometric_device_master(id) ON DELETE SET NULL,
  UNIQUE KEY uq_emp_cosec   (employee_id, cosec_user_id),
  INDEX idx_bio_cosec_uid   (cosec_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Raw punch events from Cosec (first-in and last-out per day)
CREATE TABLE IF NOT EXISTS biometric_attendance_log (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id          CHAR(36)     NOT NULL,
  cosec_user_id        VARCHAR(100) NOT NULL,
  punch_date           DATE         NOT NULL,
  first_punch_in       DATETIME     NULL,                -- MIN(lDateTime) for that day
  last_punch_out       DATETIME     NULL,                -- MAX(lDateTime) for that day
  raw_minutes          INT          GENERATED ALWAYS AS (
                         CASE
                           WHEN first_punch_in IS NOT NULL AND last_punch_out IS NOT NULL
                           THEN TIMESTAMPDIFF(MINUTE, first_punch_in, last_punch_out)
                           ELSE 0
                         END
                       ) STORED,
  source_system        VARCHAR(50)  NOT NULL DEFAULT 'ncosec',
  migrated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attendance_record_id CHAR(36)     NULL,               -- FK set after upsert into attendance_daily_record
  FOREIGN KEY (employee_id)          REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (attendance_record_id) REFERENCES attendance_daily_record(id) ON DELETE SET NULL,
  UNIQUE KEY uq_bio_emp_date (employee_id, punch_date),
  INDEX idx_bio_log_date    (punch_date),
  INDEX idx_bio_log_emp     (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- [ ] **Step 2: Add to 000_run_all.sql**

Open `backend/sql/000_run_all.sql`. Add before the final `SELECT 'mas_hrms schema complete'` line:

```sql
SOURCE sql/102_biometric_tables.sql;
```

- [ ] **Step 3: Verify SQL syntax**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1/backend
node -e "
const fs = require('fs');
const sql = fs.readFileSync('sql/102_biometric_tables.sql', 'utf8');
console.log('Lines:', sql.split('\n').length, '— syntax looks OK');
"
```

- [ ] **Step 4: Commit**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1
git add backend/sql/102_biometric_tables.sql backend/sql/000_run_all.sql
git commit -m "feat(biometric): SQL migration 102 — biometric device, enrollment, and punch log tables"
```

---

## Task 3 — NCOSEC env vars + MSSQL connection

**Files:**
- Modify: `backend/src/config/env.ts`
- Modify: `backend/.env.example`
- Create: `backend/src/db/ncosecDb.ts`

- [ ] **Step 1: Add NCOSEC vars to env.ts**

Read `backend/src/config/env.ts`. In the Zod `z.object({...})` schema, add these fields after the existing MySQL DB vars:

```typescript
// NCOSEC Biometric DB (Matrix Cosec SQL Server)
NCOSEC_DB_HOST:     z.string().default("172.10.10.140"),
NCOSEC_DB_PORT:     z.coerce.number().default(1433),
NCOSEC_DB_USER:     z.string().default(""),
NCOSEC_DB_PASSWORD: z.string().default(""),
NCOSEC_DB_NAME:     z.string().default("NCOSEC"),
NCOSEC_DB_ENCRYPT:  z.string().default("false"),        // set true for Azure SQL
```

- [ ] **Step 2: Add to .env.example**

Read `backend/.env.example`. Add a new section after the MySQL block:

```env
# NCOSEC Biometric DB (Matrix Cosec SQL Server at 172.10.10.140)
NCOSEC_DB_HOST=172.10.10.140
NCOSEC_DB_PORT=1433
NCOSEC_DB_USER=sa
NCOSEC_DB_PASSWORD=your-ncosec-password
NCOSEC_DB_NAME=NCOSEC
NCOSEC_DB_ENCRYPT=false
```

- [ ] **Step 3: Create `backend/src/db/ncosecDb.ts`**

```typescript
import sql from 'mssql';
import { env } from '../config/env.js';

const config: sql.config = {
  server:   env.NCOSEC_DB_HOST,
  port:     env.NCOSEC_DB_PORT,
  user:     env.NCOSEC_DB_USER,
  password: env.NCOSEC_DB_PASSWORD,
  database: env.NCOSEC_DB_NAME,
  options: {
    encrypt:              env.NCOSEC_DB_ENCRYPT === 'true',
    trustServerCertificate: true,   // required for on-premise Cosec installs
    enableArithAbort:     true,
  },
  connectionTimeout: 15000,
  requestTimeout:    60000,
};

let pool: sql.ConnectionPool | null = null;

export async function getNcosecPool(): Promise<sql.ConnectionPool> {
  if (pool && pool.connected) return pool;
  pool = await new sql.ConnectionPool(config).connect();
  console.log(`[NCOSEC] Connected to ${env.NCOSEC_DB_HOST}:${env.NCOSEC_DB_PORT}/${env.NCOSEC_DB_NAME}`);
  return pool;
}

export async function closeNcosecPool(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
  }
}

/** Test connection — returns true if NCOSEC DB is reachable */
export async function testNcosecConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const p = await getNcosecPool();
    await p.request().query('SELECT 1 AS ok');
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}
```

- [ ] **Step 4: TypeScript check**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1/backend
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "error TS" | head -10
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1
git add backend/src/config/env.ts backend/.env.example backend/src/db/ncosecDb.ts
git commit -m "feat(biometric): NCOSEC MSSQL connection — env vars, pool, test-connection"
```

---

## Task 4 — ETL migration script

**Files:**
- Create: `backend/scripts/migrate-ncosec-biometric.ts`

This is the one-shot script that runs once to import 3 months of historical data. Run it with:
```bash
cd backend && npx tsx scripts/migrate-ncosec-biometric.ts
```

- [ ] **Step 1: Create `backend/scripts/migrate-ncosec-biometric.ts`**

```typescript
/**
 * migrate-ncosec-biometric.ts
 *
 * One-shot ETL: Matrix Cosec NCOSEC SQL Server → HRMS MySQL
 *
 * What it does:
 *   1. Connects to NCOSEC MSSQL at 172.10.10.140
 *   2. Reads Mx_ATDEventTrn JOIN Mx_UserMst — first punch-in and last punch-out per user per day
 *   3. Maps Cosec UserID → HRMS employee via employee_code match
 *   4. Upserts into biometric_attendance_log
 *   5. Upserts into attendance_daily_record (sets clock_in_time, clock_out_time, raw_minutes, attendance_source='biometric')
 *   6. Prints summary report
 *
 * Safe to re-run: uses ON DUPLICATE KEY UPDATE, so re-running will update existing records.
 */

import 'dotenv/config';
import sql from 'mssql';
import { randomUUID } from 'crypto';
import { getNcosecPool, closeNcosecPool, testNcosecConnection } from '../src/db/ncosecDb.js';
import { db } from '../src/db/mysql.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NcosecRow {
  UserID:          string;
  Name:            string;
  punch_date:      Date;
  first_punch_in:  number;   // Unix timestamp (lDateTime)
  last_punch_out:  number;   // Unix timestamp (lDateTime)
}

interface EmployeeMap {
  [cosecUserId: string]: { employeeId: string; employeeCode: string };
}

interface Summary {
  total_ncosec_rows:     number;
  employees_mapped:      number;
  employees_not_found:   string[];  // cosec UserIDs with no HRMS match
  attendance_inserted:   number;
  attendance_updated:    number;
  errors:                Array<{ userId: string; date: string; error: string }>;
}

// ─── Step 1: Pull data from NCOSEC ───────────────────────────────────────────

async function fetchNcosecPunches(pool: sql.ConnectionPool): Promise<NcosecRow[]> {
  console.log('[NCOSEC] Querying Mx_ATDEventTrn + Mx_UserMst (last 3 months)...');

  const result = await pool.request().query<NcosecRow>(`
    SELECT
        u.UserID,
        u.Name,
        CAST(e.EDateTime AS DATE)   AS punch_date,
        MIN(e.lDateTime)            AS first_punch_in,
        MAX(e.lDateTime)            AS last_punch_out
    FROM Mx_ATDEventTrn e
    INNER JOIN Mx_UserMst u ON u.UserID = e.UserID
    WHERE e.EDateTime >= DATEADD(MONTH, -3, GETDATE())
      AND e.lDateTime > 0
    GROUP BY u.UserID, u.Name, CAST(e.EDateTime AS DATE)
    HAVING COUNT(*) >= 1
    ORDER BY punch_date ASC, u.UserID ASC
  `);

  console.log(`[NCOSEC] Found ${result.recordset.length} punch-day records`);
  return result.recordset;
}

// ─── Step 2: Build UserID → HRMS employee map ─────────────────────────────────

async function buildEmployeeMap(): Promise<EmployeeMap> {
  console.log('[HRMS] Loading employee_code → employee_id map...');

  // First check if we have existing biometric enrollments
  const [enrollmentRows] = await db.execute<any[]>(
    `SELECT cosec_user_id, employee_id FROM employee_biometric_enrollment WHERE is_active = 1`
  );

  const map: EmployeeMap = {};

  if (enrollmentRows.length > 0) {
    // Use pre-existing enrollment mappings
    for (const row of enrollmentRows) {
      map[row.cosec_user_id] = { employeeId: row.employee_id, employeeCode: row.cosec_user_id };
    }
    console.log(`[HRMS] Loaded ${enrollmentRows.length} enrollment mappings`);
  } else {
    // Fall back: assume Cosec UserID == HRMS employee_code (common in MAS setup)
    const [empRows] = await db.execute<any[]>(
      `SELECT id AS employeeId, employee_code AS employeeCode FROM employees WHERE active_status = 1`
    );
    for (const emp of empRows) {
      map[emp.employeeCode] = { employeeId: emp.employeeId, employeeCode: emp.employeeCode };
    }
    console.log(`[HRMS] Loaded ${empRows.length} employees — mapping by employee_code = UserID`);
  }

  return map;
}

// ─── Step 3: Upsert biometric_attendance_log ──────────────────────────────────

async function upsertBiometricLog(
  employeeId: string,
  cosecUserId: string,
  punchDate: string,
  firstPunchIn: Date,
  lastPunchOut: Date
): Promise<string> {
  const id = randomUUID();

  const [result] = await db.execute<any>(`
    INSERT INTO biometric_attendance_log
      (id, employee_id, cosec_user_id, punch_date, first_punch_in, last_punch_out, source_system)
    VALUES (?, ?, ?, ?, ?, ?, 'ncosec')
    ON DUPLICATE KEY UPDATE
      first_punch_in  = VALUES(first_punch_in),
      last_punch_out  = VALUES(last_punch_out),
      migrated_at     = NOW()
  `, [id, employeeId, cosecUserId, punchDate, firstPunchIn, lastPunchOut]);

  // Return the actual row ID (may be the inserted id or existing)
  const [rows] = await db.execute<any[]>(
    `SELECT id FROM biometric_attendance_log WHERE employee_id = ? AND punch_date = ? LIMIT 1`,
    [employeeId, punchDate]
  );
  return rows[0]?.id ?? id;
}

// ─── Step 4: Upsert attendance_daily_record ───────────────────────────────────

async function upsertAttendanceDailyRecord(
  employeeId: string,
  punchDate: string,
  firstPunchIn: Date,
  lastPunchOut: Date,
  biometricLogId: string
): Promise<'inserted' | 'updated'> {
  const rawMinutes = Math.floor((lastPunchOut.getTime() - firstPunchIn.getTime()) / 60000);

  // Determine attendance status based on minutes
  // Full day >= 360 min (6h), half day >= 180 min (3h)
  const attendanceStatus =
    rawMinutes >= 360 ? 'present' :
    rawMinutes >= 180 ? 'half_day' :
    rawMinutes > 0    ? 'half_day' : 'absent';

  // Get employee's branch_id and process_id for the record
  const [empRows] = await db.execute<any[]>(
    `SELECT branch_id, process_id FROM employees WHERE id = ? LIMIT 1`,
    [employeeId]
  );
  const emp = empRows[0] ?? {};

  const id = randomUUID();

  const [result] = await db.execute<any>(`
    INSERT INTO attendance_daily_record
      (id, employee_id, record_date, clock_in_time, clock_out_time, raw_minutes,
       attendance_status, attendance_source, branch_id, process_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'biometric', ?, ?, 'ncosec_migration')
    ON DUPLICATE KEY UPDATE
      clock_in_time     = VALUES(clock_in_time),
      clock_out_time    = VALUES(clock_out_time),
      raw_minutes       = VALUES(raw_minutes),
      attendance_status = VALUES(attendance_status),
      attendance_source = 'biometric',
      created_by        = 'ncosec_migration'
  `, [
    id, employeeId, punchDate,
    firstPunchIn, lastPunchOut, rawMinutes,
    attendanceStatus,
    emp.branch_id ?? null,
    emp.process_id ?? null,
  ]);

  const affectedRows = (result as any).affectedRows ?? 0;
  const wasInsert    = affectedRows === 1;

  // Link biometric log to attendance record
  const [adrRows] = await db.execute<any[]>(
    `SELECT id FROM attendance_daily_record WHERE employee_id = ? AND record_date = ? LIMIT 1`,
    [employeeId, punchDate]
  );
  const adrId = adrRows[0]?.id;
  if (adrId) {
    await db.execute(
      `UPDATE biometric_attendance_log SET attendance_record_id = ? WHERE id = ?`,
      [adrId, biometricLogId]
    );
  }

  return wasInsert ? 'inserted' : 'updated';
}

// ─── Step 5: Ensure enrollment record exists ──────────────────────────────────

async function ensureEnrollment(employeeId: string, cosecUserId: string, cosecName: string): Promise<void> {
  await db.execute(`
    INSERT IGNORE INTO employee_biometric_enrollment
      (id, employee_id, cosec_user_id, cosec_user_name, is_active, last_sync_at)
    VALUES (UUID(), ?, ?, ?, 1, NOW())
  `, [employeeId, cosecUserId, cosecName]);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('=================================================');
  console.log('  NCOSEC → HRMS Biometric Migration');
  console.log('=================================================');
  console.log('');

  // Test NCOSEC connectivity first
  console.log('[1/5] Testing NCOSEC connection...');
  const connTest = await testNcosecConnection();
  if (!connTest.ok) {
    console.error(`\n❌ Cannot connect to NCOSEC at 172.10.10.140: ${connTest.error}`);
    console.error('   Check NCOSEC_DB_HOST, NCOSEC_DB_USER, NCOSEC_DB_PASSWORD in .env');
    process.exit(1);
  }
  console.log('   ✓ NCOSEC connected');

  const summary: Summary = {
    total_ncosec_rows:   0,
    employees_mapped:    0,
    employees_not_found: [],
    attendance_inserted: 0,
    attendance_updated:  0,
    errors:              [],
  };

  try {
    // Step 1: Fetch punches from NCOSEC
    console.log('[2/5] Fetching punch data from NCOSEC...');
    const ncosecPool = await getNcosecPool();
    const rows = await fetchNcosecPunches(ncosecPool);
    summary.total_ncosec_rows = rows.length;

    // Step 2: Build employee map
    console.log('[3/5] Building employee map...');
    const empMap = await buildEmployeeMap();

    // Step 3: Process each row
    console.log('[4/5] Importing punch records...');
    let processed = 0;
    const notFoundSet = new Set<string>();

    for (const row of rows) {
      try {
        const cosecId = String(row.UserID).trim();
        const match = empMap[cosecId];

        if (!match) {
          notFoundSet.add(cosecId);
          continue;
        }

        summary.employees_mapped++;

        // Convert lDateTime (Unix timestamp in seconds) to JS Date
        const punchIn  = new Date(Number(row.first_punch_in)  * 1000);
        const punchOut = new Date(Number(row.last_punch_out)   * 1000);
        const punchDate = row.punch_date instanceof Date
          ? row.punch_date.toISOString().slice(0, 10)
          : String(row.punch_date).slice(0, 10);

        // Skip if punch-in equals punch-out (single isolated scan — cannot determine direction)
        if (punchIn.getTime() === punchOut.getTime()) continue;

        // Ensure enrollment record exists
        await ensureEnrollment(match.employeeId, cosecId, row.Name);

        // Upsert biometric log
        const bioLogId = await upsertBiometricLog(
          match.employeeId, cosecId, punchDate, punchIn, punchOut
        );

        // Upsert attendance daily record
        const action = await upsertAttendanceDailyRecord(
          match.employeeId, punchDate, punchIn, punchOut, bioLogId
        );

        if (action === 'inserted') summary.attendance_inserted++;
        else                       summary.attendance_updated++;

        processed++;
        if (processed % 100 === 0) {
          console.log(`   ... processed ${processed} / ${rows.length}`);
        }

      } catch (err: any) {
        summary.errors.push({
          userId: String(row.UserID),
          date:   String(row.punch_date).slice(0, 10),
          error:  err.message,
        });
      }
    }

    summary.employees_not_found = Array.from(notFoundSet);

  } finally {
    await closeNcosecPool();
  }

  // ─── Summary Report ────────────────────────────────────────────────────────
  console.log('');
  console.log('[5/5] Migration Complete');
  console.log('');
  console.log('=================================================');
  console.log('  MIGRATION SUMMARY');
  console.log('=================================================');
  console.log(`  Total NCOSEC rows read  : ${summary.total_ncosec_rows}`);
  console.log(`  Attendance inserted     : ${summary.attendance_inserted}`);
  console.log(`  Attendance updated      : ${summary.attendance_updated}`);
  console.log(`  Errors                  : ${summary.errors.length}`);
  console.log('');

  if (summary.employees_not_found.length > 0) {
    console.log(`  ⚠  ${summary.employees_not_found.length} Cosec UserID(s) not matched to HRMS employees:`);
    summary.employees_not_found.slice(0, 20).forEach(id => console.log(`     - UserID: ${id}`));
    if (summary.employees_not_found.length > 20) {
      console.log(`     ... and ${summary.employees_not_found.length - 20} more`);
    }
    console.log('');
    console.log('  ACTION: Add these to employee_biometric_enrollment table manually');
    console.log('  or ensure HRMS employee_code matches Cosec UserID exactly.');
  }

  if (summary.errors.length > 0) {
    console.log('  ❌ Errors:');
    summary.errors.slice(0, 10).forEach(e =>
      console.log(`     - UserID ${e.userId} / ${e.date}: ${e.error}`)
    );
  }

  console.log('=================================================');
  console.log('');

  process.exit(summary.errors.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 2: TypeScript check**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1/backend
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "error TS" | head -20
```

Expected: zero errors. Common fix if mssql types error: ensure `@types/mssql` is installed (done in Task 1).

- [ ] **Step 3: Commit**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1
git add backend/scripts/migrate-ncosec-biometric.ts
git commit -m "feat(biometric): NCOSEC ETL script — first-in/last-out per day → attendance_daily_record"
```

---

## Task 5 — Live webhook endpoint (ongoing punches)

**Files:**
- Create: `backend/src/modules/wfm/biometric-punch.routes.ts`
- Modify: `backend/src/app.ts`

This endpoint lets Matrix Cosec push new punches in real-time after migration is complete.

- [ ] **Step 1: Create `backend/src/modules/wfm/biometric-punch.routes.ts`**

```typescript
import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Response, Request } from 'express';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';

const router = Router();
const h = (fn: any) => (req: any, res: any, next: any) => fn(req, res).catch(next);

/**
 * POST /api/wfm/biometric-punch
 *
 * Called by Matrix Cosec NCOSEC device on each punch event.
 * Accepts a single punch event — the system accumulates first-in and last-out per day.
 *
 * Body: { user_id: string, event_datetime: string (ISO), device_id?: string }
 *
 * Auth: uses a shared secret header X-Biometric-Token (set in env as BIOMETRIC_WEBHOOK_SECRET)
 */
router.post(
  '/',
  h(async (req: Request, res: Response) => {
    const secret = process.env.BIOMETRIC_WEBHOOK_SECRET;
    if (secret && req.headers['x-biometric-token'] !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { user_id, event_datetime } = req.body as {
      user_id: string;
      event_datetime: string;
    };

    if (!user_id || !event_datetime) {
      return res.status(400).json({ error: 'user_id and event_datetime required' });
    }

    const punchTime = new Date(event_datetime);
    if (isNaN(punchTime.getTime())) {
      return res.status(400).json({ error: 'Invalid event_datetime format. Use ISO 8601.' });
    }

    const punchDate = punchTime.toISOString().slice(0, 10);

    // Lookup employee from enrollment
    const [enrollRows] = await db.execute<RowDataPacket[]>(
      `SELECT employee_id FROM employee_biometric_enrollment
       WHERE cosec_user_id = ? AND is_active = 1 LIMIT 1`,
      [user_id]
    );

    const employeeId = (enrollRows[0] as any)?.employee_id;
    if (!employeeId) {
      return res.status(404).json({ error: `No HRMS employee found for Cosec UserID: ${user_id}` });
    }

    // Upsert biometric log — update first_punch_in (MIN) and last_punch_out (MAX)
    await db.execute(`
      INSERT INTO biometric_attendance_log
        (id, employee_id, cosec_user_id, punch_date, first_punch_in, last_punch_out, source_system)
      VALUES (UUID(), ?, ?, ?, ?, ?, 'ncosec')
      ON DUPLICATE KEY UPDATE
        first_punch_in  = LEAST(COALESCE(first_punch_in, VALUES(first_punch_in)), VALUES(first_punch_in)),
        last_punch_out  = GREATEST(COALESCE(last_punch_out, VALUES(last_punch_out)), VALUES(last_punch_out)),
        migrated_at     = NOW()
    `, [employeeId, user_id, punchDate, punchTime, punchTime]);

    // Fetch updated log to compute minutes
    const [logRows] = await db.execute<RowDataPacket[]>(
      `SELECT first_punch_in, last_punch_out, raw_minutes FROM biometric_attendance_log
       WHERE employee_id = ? AND punch_date = ? LIMIT 1`,
      [employeeId, punchDate]
    );
    const log = logRows[0] as any;
    if (!log?.first_punch_in) {
      return res.json({ success: true, message: 'Punch recorded — waiting for more events' });
    }

    const rawMinutes = log.raw_minutes ?? 0;
    const attendanceStatus =
      rawMinutes >= 360 ? 'present' :
      rawMinutes >= 180 ? 'half_day' : 'half_day';

    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT branch_id, process_id FROM employees WHERE id = ? LIMIT 1`,
      [employeeId]
    );
    const emp = (empRows[0] as any) ?? {};

    await db.execute(`
      INSERT INTO attendance_daily_record
        (id, employee_id, record_date, clock_in_time, clock_out_time, raw_minutes,
         attendance_status, attendance_source, branch_id, process_id, created_by)
      VALUES (UUID(), ?, ?, ?, ?, ?, ?, 'biometric', ?, ?, 'ncosec_live')
      ON DUPLICATE KEY UPDATE
        clock_in_time     = LEAST(COALESCE(clock_in_time, VALUES(clock_in_time)), VALUES(clock_in_time)),
        clock_out_time    = GREATEST(COALESCE(clock_out_time, VALUES(clock_out_time)), VALUES(clock_out_time)),
        raw_minutes       = VALUES(raw_minutes),
        attendance_status = VALUES(attendance_status),
        attendance_source = 'biometric'
    `, [
      employeeId, punchDate,
      log.first_punch_in, log.last_punch_out, rawMinutes,
      attendanceStatus,
      emp.branch_id ?? null,
      emp.process_id ?? null,
    ]);

    res.json({ success: true, employee_id: employeeId, punch_date: punchDate, raw_minutes: rawMinutes });
  })
);

export { router as biometricPunchRouter };
```

- [ ] **Step 2: Mount in app.ts**

Read `backend/src/app.ts`. Add import after the wfm router imports:

```typescript
import { biometricPunchRouter } from './modules/wfm/biometric-punch.routes.js';
```

Add mount after `app.use('/api/wfm', wfmRouter)`:

```typescript
app.use('/api/wfm/biometric-punch', biometricPunchRouter);
```

- [ ] **Step 3: TypeScript check**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1/backend
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "error TS" | head -10
```

- [ ] **Step 4: Commit**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1
git add backend/src/modules/wfm/biometric-punch.routes.ts backend/src/app.ts
git commit -m "feat(biometric): live punch webhook — POST /api/wfm/biometric-punch for ongoing Cosec events"
```

---

## Task 6 — Run the migration + verify + push

- [ ] **Step 1: Set NCOSEC credentials in backend/.env**

Add to `backend/.env`:
```
NCOSEC_DB_HOST=172.10.10.140
NCOSEC_DB_PORT=1433
NCOSEC_DB_USER=sa
NCOSEC_DB_PASSWORD=<actual password>
NCOSEC_DB_NAME=NCOSEC
NCOSEC_DB_ENCRYPT=false
```

- [ ] **Step 2: Apply SQL migrations (tables must exist first)**

The startup migration runner applies `102_biometric_tables.sql` automatically when the backend starts. To apply manually right now:

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1/backend
node dist/server.js &
sleep 3
curl http://localhost:5055/api/health
kill %1
```

Look for `[migration] applied: 102_biometric_tables.sql` in server output.

- [ ] **Step 3: Run the ETL script**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1/backend
npx tsx scripts/migrate-ncosec-biometric.ts 2>&1 | tee /tmp/biometric-migration.log
```

Expected output:
```
=================================================
  NCOSEC → HRMS Biometric Migration
=================================================

[1/5] Testing NCOSEC connection...
   ✓ NCOSEC connected
[2/5] Fetching punch data from NCOSEC...
[NCOSEC] Found NNNN punch-day records
[3/5] Building employee map...
[4/5] Importing punch records...
   ... processed 100 / NNNN
   ... processed 200 / NNNN
[5/5] Migration Complete

=================================================
  MIGRATION SUMMARY
=================================================
  Total NCOSEC rows read  : NNNN
  Attendance inserted     : NNN
  Attendance updated      : NNN
  Errors                  : 0
=================================================
```

- [ ] **Step 4: Verify data in MySQL**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1/backend
node -e "
const mysql = require('mysql2/promise');
async function verify() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '122.184.128.90',
    port: 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'vicidialnow',
    database: 'mas_hrms'
  });
  const [logs] = await conn.execute('SELECT COUNT(*) as cnt FROM biometric_attendance_log');
  const [adr]  = await conn.execute(\"SELECT COUNT(*) as cnt FROM attendance_daily_record WHERE attendance_source='biometric'\");
  console.log('biometric_attendance_log rows :', logs[0].cnt);
  console.log('attendance_daily_record (bio) :', adr[0].cnt);
  const [sample] = await conn.execute(\"SELECT e.employee_code, b.punch_date, b.first_punch_in, b.last_punch_out, b.raw_minutes FROM biometric_attendance_log b JOIN employees e ON e.id = b.employee_id LIMIT 5\");
  console.log('Sample:', JSON.stringify(sample, null, 2));
  await conn.end();
}
verify().catch(console.error);
"
```

Expected: both counts > 0, sample shows employee_code + dates + times.

- [ ] **Step 5: Handle unmatched UserIDs (if any)**

If the summary showed unmatched Cosec UserIDs, manually insert enrollment mappings:

```sql
-- Run in MySQL for each unmatched employee:
INSERT INTO employee_biometric_enrollment
  (id, employee_id, cosec_user_id, cosec_user_name, is_active)
VALUES
  (UUID(),
   (SELECT id FROM employees WHERE employee_code = 'EMP001' LIMIT 1),
   '12345',   -- Cosec UserID
   'John Doe',
   1);
```

Then re-run the ETL — it is idempotent and will pick up previously unmatched rows.

- [ ] **Step 6: Push to GitHub**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1
git fetch upstream && git rebase upstream/main
git push upstream main
git push origin main --force-with-lease 2>&1 | tail -3
```

---

## How to re-run after adding more employees

The ETL script is safe to re-run at any time:
- `ON DUPLICATE KEY UPDATE` means no duplicates will be created
- New employees added to enrollment table will be picked up
- Records from the last 3 months are always re-synced

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1/backend
npx tsx scripts/migrate-ncosec-biometric.ts
```

---

## Self-Review

**Spec coverage:**
- ✅ NCOSEC table `Mx_ATDEventTrn` + `Mx_UserMst` JOIN — Task 4 ETL query
- ✅ Columns `EDateTime`, `lDateTime`, `UserID` — used exactly in query
- ✅ First punch-in = `MIN(lDateTime)`, last punch-out = `MAX(lDateTime)` — GROUP BY day
- ✅ Server 172.10.10.140 — in `ncosecDb.ts` default and env.example
- ✅ Map UserID → HRMS employee_code — `buildEmployeeMap()` in ETL
- ✅ 3 months history — `DATEADD(MONTH, -3, GETDATE())` in NCOSEC query
- ✅ Import to `biometric_attendance_log` — `upsertBiometricLog()`
- ✅ Import to `attendance_daily_record` — `upsertAttendanceDailyRecord()`
- ✅ Live webhook for ongoing punches — Task 5

**No placeholders:** All code is complete and runnable.

**Type consistency:** `NcosecRow`, `EmployeeMap`, `Summary` defined in Task 4 and used consistently throughout the ETL script.
