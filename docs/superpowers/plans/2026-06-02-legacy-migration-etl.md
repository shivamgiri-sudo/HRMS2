# Legacy Data Migration ETL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all rows from the legacy `employee_master` and `leave_management` tables into `mas_hrms`, creating new tables for fields that have no existing home, with full idempotency so the script is safe to re-run.

**Architecture:** A standalone TypeScript CLI script (`backend/scripts/migrate-legacy.ts`) opens two mysql2 connections — one to the legacy source server (placeholder credentials) and one to `mas_hrms` — then runs five sequential phases: validate, seed masters, migrate employees (all sub-tables), migrate leave, print summary. Pure transform functions are extracted into a separate module and covered by vitest unit tests.

**Tech Stack:** TypeScript, mysql2/promise, tsx (runner), vitest (tests), dotenv

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `backend/sql/052_legacy_migration_tables.sql` | Create | ALTER employees + 5 new tables |
| `backend/scripts/migrate-legacy.config.ts` | Create | Source DB connection placeholder + DST env reader |
| `backend/scripts/migrate-legacy.transforms.ts` | Create | Pure field-mapping functions + legacy row interfaces |
| `backend/scripts/migrate-legacy.transforms.test.ts` | Create | vitest unit tests for all transform functions |
| `backend/scripts/migrate-legacy.masters.ts` | Create | Phase 1: seed branch/dept/process/desig masters, return lookup Maps |
| `backend/scripts/migrate-legacy.employees.ts` | Create | Phase 2: read `employee_master`, insert all sub-tables |
| `backend/scripts/migrate-legacy.leave.ts` | Create | Phase 3: read `leave_management`, insert leave_request + approval log |
| `backend/scripts/migrate-legacy.ts` | Create | Main orchestrator: connect, run phases, print summary |
| `backend/src/modules/migration/migration.service.ts` | Update | Add `getLegacyMigrationStatus()` |
| `backend/src/modules/migration/migration.routes.ts` | Update | Add `GET /migration/legacy-status` |

---

## Task 1: SQL Migration File

**Files:**
- Create: `backend/sql/052_legacy_migration_tables.sql`

- [ ] **Step 1: Create the SQL file**

```sql
-- 052_legacy_migration_tables.sql
-- Additive: creates tables for legacy migration and alters employees.
-- Safe to run multiple times. Do NOT run on production without approval.
USE mas_hrms;

-- ── ALTER TABLE employees: add legacy-origin columns ─────────────────────────

SET @s = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employees' AND COLUMN_NAME='biometric_code')=0,
  'ALTER TABLE employees ADD COLUMN biometric_code VARCHAR(50) NULL',
  'SELECT 1');
PREPARE p FROM @s; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employees' AND COLUMN_NAME='band')=0,
  'ALTER TABLE employees ADD COLUMN band VARCHAR(10) NULL',
  'SELECT 1');
PREPARE p FROM @s; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employees' AND COLUMN_NAME='stream')=0,
  'ALTER TABLE employees ADD COLUMN stream VARCHAR(100) NULL',
  'SELECT 1');
PREPARE p FROM @s; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employees' AND COLUMN_NAME='profile_type')=0,
  'ALTER TABLE employees ADD COLUMN profile_type VARCHAR(50) NULL',
  'SELECT 1');
PREPARE p FROM @s; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employees' AND COLUMN_NAME='source_type')=0,
  'ALTER TABLE employees ADD COLUMN source_type VARCHAR(100) NULL',
  'SELECT 1');
PREPARE p FROM @s; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employees' AND COLUMN_NAME='source')=0,
  'ALTER TABLE employees ADD COLUMN source VARCHAR(100) NULL',
  'SELECT 1');
PREPARE p FROM @s; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employees' AND COLUMN_NAME='legacy_emp_id')=0,
  'ALTER TABLE employees ADD COLUMN legacy_emp_id INT NULL',
  'SELECT 1');
PREPARE p FROM @s; EXECUTE p; DEALLOCATE PREPARE p;

-- ── employee_statutory_info ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS employee_statutory_info (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id  CHAR(36)     NOT NULL UNIQUE,
  epf_number   VARCHAR(100),
  esi_number   VARCHAR(100),
  uan_number   VARCHAR(50),
  pan_number   VARCHAR(20),
  aadhaar_id   VARCHAR(50),
  pf_eligible  TINYINT(1)   NOT NULL DEFAULT 0,
  esi_eligible TINYINT(1)   NOT NULL DEFAULT 0,
  epf_date     DATE,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

-- ── employee_salary_snapshot ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS employee_salary_snapshot (
  id                  CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id         CHAR(36)      NOT NULL UNIQUE,
  snapshot_date       DATE          NOT NULL,
  basic               DECIMAL(12,2) DEFAULT 0,
  hra                 DECIMAL(12,2) DEFAULT 0,
  conveyance          DECIMAL(12,2) DEFAULT 0,
  da                  DECIMAL(12,2) DEFAULT 0,
  portfolio_allowance DECIMAL(12,2) DEFAULT 0,
  medical_allowance   DECIMAL(12,2) DEFAULT 0,
  lta                 DECIMAL(12,2) DEFAULT 0,
  mobile_allowance    DECIMAL(12,2) DEFAULT 0,
  special_allowance   DECIMAL(12,2) DEFAULT 0,
  other_allowance     DECIMAL(12,2) DEFAULT 0,
  bonus               DECIMAL(12,2) DEFAULT 0,
  gross               DECIMAL(12,2) DEFAULT 0,
  net_in_hand         DECIMAL(12,2) DEFAULT 0,
  ctc_offered         DECIMAL(12,2) DEFAULT 0,
  package             DECIMAL(12,2) DEFAULT 0,
  epf_employee        DECIMAL(12,2) DEFAULT 0,
  esic_employee       DECIMAL(12,2) DEFAULT 0,
  epf_employer        DECIMAL(12,2) DEFAULT 0,
  esic_employer       DECIMAL(12,2) DEFAULT 0,
  professional_tax    DECIMAL(12,2) DEFAULT 0,
  gratuity            DECIMAL(12,2) DEFAULT 0,
  admin_charges       DECIMAL(12,2) DEFAULT 0,
  pli                 DECIMAL(12,2) DEFAULT 0,
  pay_mode            VARCHAR(50),
  salary_payment_mode VARCHAR(50),
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

-- ── employee_client_mapping ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS employee_client_mapping (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id    CHAR(36)     NOT NULL,
  client_name    VARCHAR(255),
  cost_center    VARCHAR(255),
  emp_for        VARCHAR(50),
  effective_from DATE,
  active_status  TINYINT(1)   NOT NULL DEFAULT 1,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  UNIQUE KEY uq_emp_client (employee_id),
  INDEX idx_client_map_emp (employee_id)
);

-- ── employee_kpi_assignment ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS employee_kpi_assignment (
  id            CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id   CHAR(36)    NOT NULL,
  legacy_kpi_id VARCHAR(50),
  assign_date   DATE,
  created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  UNIQUE KEY uq_emp_kpi (employee_id, legacy_kpi_id),
  INDEX idx_kpi_assign_emp (employee_id)
);

-- ── employee_legacy_meta ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS employee_legacy_meta (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id          CHAR(36)     NOT NULL UNIQUE,
  father_name          VARCHAR(255),
  relationship_type    VARCHAR(50),
  acc_holder_name      VARCHAR(255),
  blood_group          VARCHAR(10),
  qualification        VARCHAR(255),
  marital_status       VARCHAR(50),
  permanent_address    TEXT,
  temporary_address    TEXT,
  land_line_p          VARCHAR(50),
  land_line_t          VARCHAR(50),
  passport_no          VARCHAR(100),
  dl_no                VARCHAR(100),
  offer_no             VARCHAR(100),
  box_file_no          VARCHAR(100),
  appoint_print_date   DATE,
  document_done        VARCHAR(10),
  account_flag         VARCHAR(10),
  ac_validation_date   DATE,
  ac_validated_by      VARCHAR(255),
  ac_rejection_remarks TEXT,
  updated_by           VARCHAR(255),
  official_email       VARCHAR(255),
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

-- ── Additional legacy leave type codes ───────────────────────────────────────

INSERT INTO leave_type_master
  (leave_code, leave_name, max_days_per_year, carry_forward, requires_approval, paid_leave)
VALUES
  ('DL',   'Duty Leave',                0, 0, 1, 1),
  ('PTRL', 'Paternity Leave (Legacy)',  5, 0, 1, 1),
  ('MTRL', 'Maternity Leave (Legacy)', 90, 0, 1, 1)
ON DUPLICATE KEY UPDATE leave_name = VALUES(leave_name);
```

- [ ] **Step 2: Verify SQL file exists**

```
ls backend/sql/052_legacy_migration_tables.sql
```

- [ ] **Step 3: Commit**

```bash
git add backend/sql/052_legacy_migration_tables.sql
git commit -m "feat(migration): 052 — new tables for legacy employee/leave import"
```

---

## Task 2: Config File

**Files:**
- Create: `backend/scripts/migrate-legacy.config.ts`

- [ ] **Step 1: Create the config file**

```typescript
// backend/scripts/migrate-legacy.config.ts
import type { ConnectionOptions } from 'mysql2/promise';
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

export const LEGACY_SRC: ConnectionOptions = {
  host:        '<LEGACY_HOST>',       // Fill in: 122.184.128.90
  port:        3306,
  user:        '<LEGACY_USER>',       // Fill in: root
  password:    '<LEGACY_PASSWORD>',   // Fill in: (provided separately)
  database:    '<LEGACY_DATABASE>',   // Fill in: legacy source DB name
  dateStrings: true,
  timezone:    'local',
};

export const LEGACY_TABLES = {
  employees: 'employee_master',
  leave:     'leave_management',
} as const;

export const DST: ConnectionOptions = {
  host:        process.env.DB_HOST     ?? 'localhost',
  port:        Number(process.env.DB_PORT ?? 3306),
  user:        process.env.DB_USER     ?? 'root',
  password:    process.env.DB_PASSWORD ?? '',
  database:    process.env.DB_NAME     ?? 'mas_hrms',
  dateStrings: false,
  timezone:    '+00:00',
  decimalNumbers: true,
};
```

- [ ] **Step 2: Commit**

```bash
git add backend/scripts/migrate-legacy.config.ts
git commit -m "feat(migration): legacy ETL config with placeholder source credentials"
```

---

## Task 3: Transform Utilities + Unit Tests (TDD)

**Files:**
- Create: `backend/scripts/migrate-legacy.transforms.ts`
- Create: `backend/scripts/migrate-legacy.transforms.test.ts`

- [ ] **Step 1: Write the failing tests first**

Create `backend/scripts/migrate-legacy.transforms.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  parseLegacyDate,
  splitName,
  normalizeGender,
  toMasterCode,
  parseUAN,
  sumLeaveDays,
  normalizeLeaveStatus,
  toDecimal,
  boolFlag,
  buildAddress,
} from './migrate-legacy.transforms.js';
import type { LegacyLeaveRow } from './migrate-legacy.transforms.js';

describe('parseLegacyDate', () => {
  it('parses US M/D/YYYY', () => {
    expect(parseLegacyDate('6/9/1974')).toBe('1974-06-09');
  });
  it('parses US single-digit day and month', () => {
    expect(parseLegacyDate('3/25/2005')).toBe('2005-03-25');
  });
  it('extracts date from MySQL datetime string', () => {
    expect(parseLegacyDate('2018-06-16 00:00:00')).toBe('2018-06-16');
  });
  it('returns null for 0000-00-00', () => {
    expect(parseLegacyDate('0000-00-00 00:00:00')).toBeNull();
  });
  it('returns null for null', () => {
    expect(parseLegacyDate(null)).toBeNull();
  });
  it('returns null for NA', () => {
    expect(parseLegacyDate('NA')).toBeNull();
  });
  it('returns null for empty string', () => {
    expect(parseLegacyDate('')).toBeNull();
  });
});

describe('splitName', () => {
  it('splits on first space', () => {
    expect(splitName('DEEPAK KASHYAP')).toEqual({ firstName: 'DEEPAK', lastName: 'KASHYAP' });
  });
  it('handles multi-word last name', () => {
    expect(splitName('SHYAM BABU JANGIR')).toEqual({ firstName: 'SHYAM', lastName: 'BABU JANGIR' });
  });
  it('handles single name with no space', () => {
    expect(splitName('RAJNI')).toEqual({ firstName: 'RAJNI', lastName: '' });
  });
  it('trims surrounding whitespace', () => {
    expect(splitName('  RITU CHAUDHARY  ')).toEqual({ firstName: 'RITU', lastName: 'CHAUDHARY' });
  });
});

describe('normalizeGender', () => {
  it('MALE → Male', () => expect(normalizeGender('MALE')).toBe('Male'));
  it('FEMALE → Female', () => expect(normalizeGender('FEMALE')).toBe('Female'));
  it('null → Other', () => expect(normalizeGender(null)).toBe('Other'));
  it('unknown string → Other', () => expect(normalizeGender('UNKNOWN')).toBe('Other'));
  it('lowercase male → Male', () => expect(normalizeGender('male')).toBe('Male'));
});

describe('toMasterCode', () => {
  it('converts spaces to underscores and uppercases', () => {
    expect(toMasterCode('HEAD OFFICE')).toBe('HEAD_OFFICE');
  });
  it('removes forward slashes', () => {
    expect(toMasterCode('IT/SYSTEM')).toBe('ITSYSTEM');
  });
  it('handles already clean value', () => {
    expect(toMasterCode('OPERATIONS')).toBe('OPERATIONS');
  });
  it('collapses multiple spaces', () => {
    expect(toMasterCode('COLLECTION  MANAGEMENT')).toBe('COLLECTION_MANAGEMENT');
  });
  it('truncates at 50 characters', () => {
    expect(toMasterCode('A'.repeat(60)).length).toBe(50);
  });
});

describe('parseUAN', () => {
  it('converts scientific notation string to integer string', () => {
    expect(parseUAN('1.00143E+11')).toBe('100143000000');
  });
  it('converts scientific notation number to integer string', () => {
    expect(parseUAN(1.00298e11)).toBe('100298000000');
  });
  it('passes through plain number string', () => {
    expect(parseUAN('100143000000')).toBe('100143000000');
  });
  it('returns null for null', () => expect(parseUAN(null)).toBeNull());
  it('returns null for undefined', () => expect(parseUAN(undefined)).toBeNull());
  it('returns null for empty string', () => expect(parseUAN('')).toBeNull());
});

describe('sumLeaveDays', () => {
  it('sums all leave type columns', () => {
    const row = { CL: 1, ML: 0, DL: null, EL: 2, PTRL: 0, MTRL: 0, LWP: 1 } as LegacyLeaveRow;
    expect(sumLeaveDays(row)).toBe(4);
  });
  it('returns 0 when all are null', () => {
    const row = { CL: null, ML: null, DL: null, EL: null, PTRL: null, MTRL: null, LWP: null } as LegacyLeaveRow;
    expect(sumLeaveDays(row)).toBe(0);
  });
  it('handles mixed null and number', () => {
    const row = { CL: 2, ML: null, DL: null, EL: null, PTRL: null, MTRL: null, LWP: null } as LegacyLeaveRow;
    expect(sumLeaveDays(row)).toBe(2);
  });
});

describe('normalizeLeaveStatus', () => {
  it('Approved → approved', () => expect(normalizeLeaveStatus('Approved')).toBe('approved'));
  it('Rejected → rejected', () => expect(normalizeLeaveStatus('Rejected')).toBe('rejected'));
  it('Disapproved → rejected', () => expect(normalizeLeaveStatus('Disapproved')).toBe('rejected'));
  it('null → pending', () => expect(normalizeLeaveStatus(null)).toBe('pending'));
  it('empty → pending', () => expect(normalizeLeaveStatus('')).toBe('pending'));
  it('uppercase APPROVED → approved', () => expect(normalizeLeaveStatus('APPROVED')).toBe('approved'));
});

describe('toDecimal', () => {
  it('parses string number', () => expect(toDecimal('25000')).toBe(25000));
  it('parses decimal string', () => expect(toDecimal('10274.84')).toBeCloseTo(10274.84));
  it('returns 0 for null', () => expect(toDecimal(null)).toBe(0));
  it('returns 0 for empty string', () => expect(toDecimal('')).toBe(0));
  it('returns 0 for non-numeric string', () => expect(toDecimal('N/A')).toBe(0));
});

describe('boolFlag', () => {
  it('YES → 1', () => expect(boolFlag('YES')).toBe(1));
  it('yes → 1', () => expect(boolFlag('yes')).toBe(1));
  it('NO → 0', () => expect(boolFlag('NO')).toBe(0));
  it('null → 0', () => expect(boolFlag(null)).toBe(0));
  it('empty → 0', () => expect(boolFlag('')).toBe(0));
});

describe('buildAddress', () => {
  it('joins all non-null parts with comma-space', () => {
    expect(buildAddress('123 Street', 'Delhi', 'Delhi', '110001'))
      .toBe('123 Street, Delhi, Delhi, 110001');
  });
  it('skips null parts', () => {
    expect(buildAddress('123 Street', null, 'Delhi', null))
      .toBe('123 Street, Delhi');
  });
  it('returns null when all parts are null', () => {
    expect(buildAddress(null, null, null, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — expect all to fail with import error**

```bash
cd backend && npx vitest run scripts/migrate-legacy.transforms.test.ts
```

Expected: FAIL — `Cannot find module './migrate-legacy.transforms.js'`

- [ ] **Step 3: Create the transforms module**

Create `backend/scripts/migrate-legacy.transforms.ts`:

```typescript
// backend/scripts/migrate-legacy.transforms.ts

export interface LegacyEmployeeRow {
  Id: number;
  SrNo: number | null;
  EmpCode: string;
  EmpType: string | null;
  EmpName: string;
  Fname: string | null;
  Gender: string | null;
  DOB: string | null;
  DOJ: string;
  Desig: string | null;
  Depart: string | null;
  Stream: string | null;
  Process: string | null;
  Profile: string | null;
  Location: string | null;
  SubLocation: string | null;
  Qualification: string | null;
  MaritalStatus: string | null;
  BloodG: string | null;
  PAddress: string | null;
  PCity: string | null;
  PState: string | null;
  PpinCode: string | null;
  TAddress: string | null;
  TCity: string | null;
  TState: string | null;
  TPinCode: string | null;
  PMobNo: string | null;
  PLandLine: string | null;
  TMobNo: string | null;
  TLandLine: string | null;
  EmailId: string | null;
  documentDone: string | null;
  CTCOffered: string | null;
  AcNo: string | null;
  AcBank: string | null;
  AcBranch: string | null;
  PassPortNo: string | null;
  dlNo: string | null;
  EpfNo: string | null;
  EsiNo: string | null;
  EntryDate: string | null;
  Status: string | null;
  LeftDate: string | null;
  LeftRmks: string | null;
  EmpCodeDate: string | null;
  Pwd: string | null;
  Age: string | null;
  bs: string | null;
  hra: string | null;
  conv: string | null;
  da: string | null;
  portf: string | null;
  ma: string | null;
  lta: string | null;
  mob: string | null;
  sa: string | null;
  oa: string | null;
  panno: string | null;
  NewEpfNo: string | null;
  pfelig: string | null;
  esielig: string | null;
  moballow: string | null;
  mno: string | null;
  portfolio: string | null;
  nom1: string | null;
  nom2: string | null;
  dispens: string | null;
  remarks: string | null;
  CreateDate: string | null;
  EpfDate: string | null;
  Band: string | null;
  lastUpdated: string | null;
  BiometricCode: string | null;
  ClientName: string | null;
  CostCenter: string | null;
  EmpFor: string | null;
  UpdatedBy: string | null;
  IFSCCode: string | null;
  AccHolder: string | null;
  AccType: string | null;
  OfferNo: string | null;
  package: string | null;
  Bonus: string | null;
  Gross: string | null;
  ESIC: string | null;
  EPF: string | null;
  NetInHand: string | null;
  EPFCO: string | null;
  ESICCO: string | null;
  Gratuity: string | null;
  ProfessionalTax: string | null;
  AccountFlag: string | null;
  Title: string | null;
  EsicNo: string | null;
  AppointPrintDate: string | null;
  PayMode: string | null;
  AcValidationDate: string | null;
  AcValidatedBy: string | null;
  AdminCharges: string | null;
  SourceType: string | null;
  Source: string | null;
  BoxFileNo: string | null;
  AcRejectionRemarks: string | null;
  KPIId: string | null;
  AssignDate: string | null;
  RType: string | null;
  SalaryPaymentMode: string | null;
  AadharID: string | null;
  PLI: string | null;
  OfficialEmailID: string | null;
  UAN: string | number | null;
}

export interface LegacyLeaveRow {
  Id: number;
  EmpCode: string;
  EmpLocation: string | null;
  EmpName: string | null;
  BranchName: string | null;
  CostCenter: string | null;
  LeaveFrom: string;
  LeaveTo: string;
  LeaveFor: string | null;
  LeaveType: string;
  CurrentStatus: string | null;
  Purpose: string | null;
  Address: string | null;
  Contact: number | null;
  Status: string | null;
  CL: number | null;
  ML: number | null;
  DL: number | null;
  EL: number | null;
  PTRL: number | null;
  MTRL: number | null;
  LWP: number | null;
  TotalLeave: number | null;
  DisApprovedReason: string | null;
  DisApprovedDate: string | null;
  CreateDate: string | null;
  LeaveApproveBy: string | null;
  LeaveApproveDate: string | null;
  chatId: string | null;
}

export function parseLegacyDate(str: string | null | undefined): string | null {
  if (!str) return null;
  const trimmed = str.trim();
  if (!trimmed || trimmed.startsWith('0000') || trimmed === 'NA') return null;
  // MySQL datetime: "YYYY-MM-DD HH:MM:SS" → extract date part
  const mysqlDt = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (mysqlDt) return mysqlDt[1];
  // US format M/D/YYYY or MM/DD/YYYY
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const [, m, d, y] = us;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

export function splitName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  const idx = trimmed.indexOf(' ');
  if (idx === -1) return { firstName: trimmed, lastName: '' };
  return { firstName: trimmed.slice(0, idx), lastName: trimmed.slice(idx + 1).trim() };
}

export function normalizeGender(g: string | null | undefined): 'Male' | 'Female' | 'Other' {
  const upper = (g ?? '').toUpperCase().trim();
  if (upper === 'MALE') return 'Male';
  if (upper === 'FEMALE') return 'Female';
  return 'Other';
}

export function toMasterCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '').slice(0, 50);
}

export function parseUAN(uan: string | number | null | undefined): string | null {
  if (uan == null) return null;
  const str = String(uan).trim();
  if (str === '' || str.toLowerCase() === 'null') return null;
  if (/[eE][+\-]/.test(str)) return String(Math.round(parseFloat(str)));
  return str;
}

export function sumLeaveDays(row: LegacyLeaveRow): number {
  return (
    (Number(row.CL) || 0) + (Number(row.ML) || 0) + (Number(row.DL) || 0) +
    (Number(row.EL) || 0) + (Number(row.PTRL) || 0) + (Number(row.MTRL) || 0) +
    (Number(row.LWP) || 0)
  );
}

export function normalizeLeaveStatus(s: string | null | undefined): string {
  const lower = (s ?? '').toLowerCase().trim();
  if (lower === 'approved') return 'approved';
  if (lower === 'rejected' || lower === 'disapproved') return 'rejected';
  return 'pending';
}

export function toDecimal(v: string | null | undefined): number {
  const n = parseFloat(String(v ?? ''));
  return isNaN(n) ? 0 : n;
}

export function boolFlag(v: string | null | undefined): number {
  const lower = (v ?? '').toLowerCase().trim();
  return lower === 'yes' || lower === '1' || lower === 'true' ? 1 : 0;
}

export function buildAddress(
  addr: string | null,
  city: string | null,
  state: string | null,
  pin: string | null,
): string | null {
  const parts = [addr, city, state, pin].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}
```

- [ ] **Step 4: Run tests — expect all to pass**

```bash
cd backend && npx vitest run scripts/migrate-legacy.transforms.test.ts
```

Expected output:
```
 ✓ scripts/migrate-legacy.transforms.test.ts (30 tests)

 Test Files  1 passed (1)
 Tests       30 passed (30)
```

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/migrate-legacy.transforms.ts backend/scripts/migrate-legacy.transforms.test.ts
git commit -m "feat(migration): legacy transform utilities with full vitest coverage"
```

---

## Task 4: Master Seeder

**Files:**
- Create: `backend/scripts/migrate-legacy.masters.ts`

- [ ] **Step 1: Create the master seeder module**

```typescript
// backend/scripts/migrate-legacy.masters.ts
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { toMasterCode } from './migrate-legacy.transforms.js';

export interface MasterMaps {
  branch:      Map<string, string>; // legacy Location value → branch_master.id
  department:  Map<string, string>; // legacy Depart value → department_master.id
  process:     Map<string, string>; // legacy Process value → process_master.id
  designation: Map<string, string>; // legacy Desig value → designation_master.id
  leaveType:   Map<string, string>; // leave_code → leave_type_master.id
}

async function seedTable(
  dst: Connection,
  table: string,
  codeCol: string,
  nameCol: string,
  values: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const val of values) {
    if (!val || val.trim() === '') continue;
    const code = toMasterCode(val);
    await dst.execute(
      `INSERT INTO ${table} (${codeCol}, ${nameCol}) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE ${nameCol} = ${nameCol}`,
      [code, val.trim()],
    );
    const [rows] = await dst.execute<RowDataPacket[]>(
      `SELECT id FROM ${table} WHERE ${codeCol} = ?`,
      [code],
    );
    if (rows[0]) map.set(val.trim(), rows[0].id as string);
  }
  return map;
}

export async function seedMasters(
  src: Connection,
  dst: Connection,
  table: string,
): Promise<MasterMaps> {
  console.log('  [Phase 1] Seeding master tables…');

  const [locRows] = await src.execute<RowDataPacket[]>(
    `SELECT DISTINCT Location FROM ${table} WHERE Location IS NOT NULL AND Location != ''`,
  );
  const [deptRows] = await src.execute<RowDataPacket[]>(
    `SELECT DISTINCT Depart FROM ${table} WHERE Depart IS NOT NULL AND Depart != ''`,
  );
  const [procRows] = await src.execute<RowDataPacket[]>(
    `SELECT DISTINCT Process FROM ${table} WHERE Process IS NOT NULL AND Process != ''`,
  );
  const [desigRows] = await src.execute<RowDataPacket[]>(
    `SELECT DISTINCT Desig FROM ${table} WHERE Desig IS NOT NULL AND Desig != ''`,
  );

  const branch      = await seedTable(dst, 'branch_master',      'branch_code',       'branch_name',       locRows.map(r => r.Location));
  const department  = await seedTable(dst, 'department_master',  'dept_code',         'dept_name',         deptRows.map(r => r.Depart));
  const process     = await seedTable(dst, 'process_master',     'process_code',      'process_name',      procRows.map(r => r.Process));
  const designation = await seedTable(dst, 'designation_master', 'designation_code',  'designation_name',  desigRows.map(r => r.Desig));

  // Build leave type map from existing leave_type_master
  const [ltRows] = await dst.execute<RowDataPacket[]>(
    `SELECT id, leave_code FROM leave_type_master`,
  );
  const leaveType = new Map<string, string>(ltRows.map(r => [r.leave_code as string, r.id as string]));

  console.log(`  [Phase 1] Done. branch:${branch.size} dept:${department.size} proc:${process.size} desig:${designation.size} leaveType:${leaveType.size}`);
  return { branch, department, process, designation, leaveType };
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/scripts/migrate-legacy.masters.ts
git commit -m "feat(migration): master seeder — branch, dept, process, designation auto-seed"
```

---

## Task 5: Employee Migrator

**Files:**
- Create: `backend/scripts/migrate-legacy.employees.ts`

- [ ] **Step 1: Create the employee migrator module**

```typescript
// backend/scripts/migrate-legacy.employees.ts
import type { Connection, RowDataPacket } from 'mysql2/promise';
import type { MasterMaps } from './migrate-legacy.masters.js';
import type { LegacyEmployeeRow } from './migrate-legacy.transforms.js';
import {
  parseLegacyDate, splitName, normalizeGender,
  toDecimal, boolFlag, buildAddress, parseUAN,
} from './migrate-legacy.transforms.js';

export interface EmployeeMigrationResult {
  inserted: number;
  skipped:  number;
  errors:   Array<{ empCode: string; error: string }>;
}

export async function migrateEmployees(
  src: Connection,
  dst: Connection,
  srcTable: string,
  masters: MasterMaps,
): Promise<EmployeeMigrationResult> {
  console.log('  [Phase 2] Migrating employees…');

  const [rows] = await src.execute<RowDataPacket[]>(`SELECT * FROM ${srcTable}`);
  const result: EmployeeMigrationResult = { inserted: 0, skipped: 0, errors: [] };

  for (const raw of rows) {
    const row = raw as LegacyEmployeeRow;
    try {
      await migrateOneEmployee(dst, row, masters, result);
    } catch (err) {
      result.errors.push({ empCode: row.EmpCode, error: String(err) });
    }
  }

  console.log(`  [Phase 2] Done. inserted:${result.inserted} skipped:${result.skipped} errors:${result.errors.length}`);
  return result;
}

async function migrateOneEmployee(
  dst: Connection,
  row: LegacyEmployeeRow,
  masters: MasterMaps,
  result: EmployeeMigrationResult,
): Promise<void> {
  const { firstName, lastName } = splitName(row.EmpName);

  const isLeft   = row.Status === 'L';
  const empStatus = isLeft ? 'Resigned' : 'Active';
  const activeStatus = isLeft ? 0 : 1;

  const doj     = parseLegacyDate(row.DOJ);
  const dob     = parseLegacyDate(row.DOB);
  const exitDate = isLeft ? parseLegacyDate(row.LeftDate) : null;

  const branchId      = row.Location ? (masters.branch.get(row.Location.trim()) ?? null)      : null;
  const departmentId  = row.Depart   ? (masters.department.get(row.Depart.trim()) ?? null)     : null;
  const processId     = row.Process  ? (masters.process.get(row.Process.trim()) ?? null)       : null;
  const designationId = row.Desig    ? (masters.designation.get(row.Desig.trim()) ?? null)     : null;

  // ── Core employee ───────────────────────────────────────────────────────────
  await dst.execute(
    `INSERT INTO employees
       (employee_code, first_name, last_name, email, mobile, gender,
        date_of_birth, date_of_joining, date_of_exit, employment_type,
        employment_status, active_status, branch_id, department_id,
        process_id, designation_id, biometric_code, band, stream,
        profile_type, source_type, source, legacy_emp_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       first_name = VALUES(first_name), last_name = VALUES(last_name),
       email = VALUES(email), mobile = VALUES(mobile),
       gender = VALUES(gender), date_of_birth = VALUES(date_of_birth),
       date_of_joining = VALUES(date_of_joining), date_of_exit = VALUES(date_of_exit),
       employment_status = VALUES(employment_status), active_status = VALUES(active_status),
       branch_id = VALUES(branch_id), department_id = VALUES(department_id),
       process_id = VALUES(process_id), designation_id = VALUES(designation_id),
       biometric_code = VALUES(biometric_code), band = VALUES(band),
       stream = VALUES(stream), profile_type = VALUES(profile_type),
       source_type = VALUES(source_type), source = VALUES(source),
       legacy_emp_id = VALUES(legacy_emp_id)`,
    [
      row.EmpCode, firstName, lastName,
      row.EmailId ?? null, row.PMobNo ?? null,
      normalizeGender(row.Gender),
      dob, doj ?? '2000-01-01', exitDate,
      row.EmpType ?? 'OnRoll', empStatus, activeStatus,
      branchId, departmentId, processId, designationId,
      row.BiometricCode ?? null, row.Band ?? null,
      row.Stream ?? null, row.Profile ?? null,
      row.SourceType ?? null, row.Source ?? null,
      row.Id,
    ],
  );

  const [empRows] = await dst.execute<RowDataPacket[]>(
    `SELECT id FROM employees WHERE employee_code = ?`,
    [row.EmpCode],
  );
  const employeeId = empRows[0]?.id as string | undefined;
  if (!employeeId) {
    result.skipped++;
    return;
  }

  // ── Bank detail ─────────────────────────────────────────────────────────────
  if (row.AcNo) {
    await dst.execute(
      `INSERT INTO employee_bank_detail
         (employee_id, bank_name, account_number, ifsc_code, account_type)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         bank_name = VALUES(bank_name),
         account_number = VALUES(account_number),
         ifsc_code = VALUES(ifsc_code),
         account_type = VALUES(account_type)`,
      [
        employeeId, row.AcBank ?? null,
        Buffer.from(row.AcNo, 'utf8'),
        row.IFSCCode ?? null,
        row.AccType ?? 'Savings',
      ],
    );
  }

  // ── Statutory info ──────────────────────────────────────────────────────────
  await dst.execute(
    `INSERT INTO employee_statutory_info
       (employee_id, epf_number, esi_number, uan_number, pan_number,
        aadhaar_id, pf_eligible, esi_eligible, epf_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       epf_number = VALUES(epf_number), esi_number = VALUES(esi_number),
       uan_number = VALUES(uan_number), pan_number = VALUES(pan_number),
       aadhaar_id = VALUES(aadhaar_id), pf_eligible = VALUES(pf_eligible),
       esi_eligible = VALUES(esi_eligible), epf_date = VALUES(epf_date)`,
    [
      employeeId,
      row.EpfNo ?? null,
      row.EsiNo ?? null,
      parseUAN(row.UAN),
      row.panno ?? null,
      row.AadharID ?? null,
      boolFlag(row.pfelig),
      boolFlag(row.esielig),
      parseLegacyDate(row.EpfDate),
    ],
  );

  // ── Salary snapshot ─────────────────────────────────────────────────────────
  await dst.execute(
    `INSERT INTO employee_salary_snapshot
       (employee_id, snapshot_date, basic, hra, conveyance, da,
        portfolio_allowance, medical_allowance, lta, mobile_allowance,
        special_allowance, other_allowance, bonus, gross, net_in_hand,
        ctc_offered, package, epf_employee, esic_employee, epf_employer,
        esic_employer, professional_tax, gratuity, admin_charges, pli,
        pay_mode, salary_payment_mode)
     VALUES (?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       basic = VALUES(basic), hra = VALUES(hra), conveyance = VALUES(conveyance),
       gross = VALUES(gross), net_in_hand = VALUES(net_in_hand)`,
    [
      employeeId,
      toDecimal(row.bs), toDecimal(row.hra), toDecimal(row.conv), toDecimal(row.da),
      toDecimal(row.portf), toDecimal(row.ma), toDecimal(row.lta), toDecimal(row.mob),
      toDecimal(row.sa), toDecimal(row.oa),
      toDecimal(row.Bonus), toDecimal(row.Gross), toDecimal(row.NetInHand),
      toDecimal(row.CTCOffered), toDecimal(row.package),
      toDecimal(row.EPF), toDecimal(row.ESIC),
      toDecimal(row.EPFCO), toDecimal(row.ESICCO),
      toDecimal(row.ProfessionalTax), toDecimal(row.Gratuity),
      toDecimal(row.AdminCharges), toDecimal(row.PLI),
      row.PayMode ?? null, row.SalaryPaymentMode ?? null,
    ],
  );

  // ── Client mapping ──────────────────────────────────────────────────────────
  if (row.ClientName || row.CostCenter) {
    await dst.execute(
      `INSERT INTO employee_client_mapping
         (employee_id, client_name, cost_center, emp_for, effective_from)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         client_name = VALUES(client_name), cost_center = VALUES(cost_center)`,
      [
        employeeId,
        row.ClientName ?? null, row.CostCenter ?? null,
        row.EmpFor ?? null, doj ?? null,
      ],
    );
  }

  // ── KPI assignment ──────────────────────────────────────────────────────────
  if (row.KPIId) {
    await dst.execute(
      `INSERT INTO employee_kpi_assignment (employee_id, legacy_kpi_id, assign_date)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE legacy_kpi_id = VALUES(legacy_kpi_id)`,
      [employeeId, row.KPIId, parseLegacyDate(row.AssignDate)],
    );
  }

  // ── Legacy meta ─────────────────────────────────────────────────────────────
  await dst.execute(
    `INSERT INTO employee_legacy_meta
       (employee_id, father_name, relationship_type, acc_holder_name, blood_group,
        qualification, marital_status, permanent_address, temporary_address,
        land_line_p, land_line_t, passport_no, dl_no, offer_no, box_file_no,
        appoint_print_date, document_done, account_flag, ac_validation_date,
        ac_validated_by, ac_rejection_remarks, updated_by, official_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       father_name = VALUES(father_name), blood_group = VALUES(blood_group),
       qualification = VALUES(qualification), official_email = VALUES(official_email)`,
    [
      employeeId,
      row.Fname ?? null, row.RType ?? null, row.AccHolder ?? null,
      row.BloodG ?? null, row.Qualification ?? null, row.MaritalStatus ?? null,
      buildAddress(row.PAddress, row.PCity, row.PState, row.PpinCode),
      buildAddress(row.TAddress, row.TCity, row.TState, row.TPinCode),
      row.PLandLine ?? null, row.TLandLine ?? null,
      row.PassPortNo ?? null, row.dlNo ?? null,
      row.OfferNo ?? null, row.BoxFileNo ?? null,
      parseLegacyDate(row.AppointPrintDate),
      row.documentDone ?? null, row.AccountFlag ?? null,
      parseLegacyDate(row.AcValidationDate),
      row.AcValidatedBy ?? null, row.AcRejectionRemarks ?? null,
      row.UpdatedBy ?? null, row.OfficialEmailID ?? null,
    ],
  );

  result.inserted++;
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/scripts/migrate-legacy.employees.ts
git commit -m "feat(migration): employee migrator — all 9 sub-table inserts"
```

---

## Task 6: Leave Migrator

**Files:**
- Create: `backend/scripts/migrate-legacy.leave.ts`

- [ ] **Step 1: Create the leave migrator module**

```typescript
// backend/scripts/migrate-legacy.leave.ts
import type { Connection, RowDataPacket } from 'mysql2/promise';
import type { MasterMaps } from './migrate-legacy.masters.js';
import type { LegacyLeaveRow } from './migrate-legacy.transforms.js';
import {
  parseLegacyDate, sumLeaveDays, normalizeLeaveStatus,
} from './migrate-legacy.transforms.js';

export interface LeaveMigrationResult {
  inserted: number;
  skipped:  number;
  errors:   Array<{ legacyId: number; error: string }>;
}

export async function migrateLeave(
  src: Connection,
  dst: Connection,
  srcTable: string,
  masters: MasterMaps,
): Promise<LeaveMigrationResult> {
  console.log('  [Phase 3] Migrating leave records…');

  const [rows] = await src.execute<RowDataPacket[]>(`SELECT * FROM ${srcTable}`);
  const result: LeaveMigrationResult = { inserted: 0, skipped: 0, errors: [] };

  for (const raw of rows) {
    const row = raw as LegacyLeaveRow;
    try {
      await migrateOneLeave(dst, row, masters, result);
    } catch (err) {
      result.errors.push({ legacyId: row.Id, error: String(err) });
    }
  }

  console.log(`  [Phase 3] Done. inserted:${result.inserted} skipped:${result.skipped} errors:${result.errors.length}`);
  return result;
}

async function migrateOneLeave(
  dst: Connection,
  row: LegacyLeaveRow,
  masters: MasterMaps,
  result: LeaveMigrationResult,
): Promise<void> {
  // Resolve employee
  const [empRows] = await dst.execute<RowDataPacket[]>(
    `SELECT id FROM employees WHERE employee_code = ?`,
    [row.EmpCode],
  );
  const employeeId = empRows[0]?.id as string | undefined;
  if (!employeeId) {
    result.skipped++;
    return;
  }

  // Resolve leave type
  const leaveTypeId = masters.leaveType.get(row.LeaveType.toUpperCase().trim());
  if (!leaveTypeId) {
    result.errors.push({ legacyId: row.Id, error: `Unknown LeaveType: ${row.LeaveType}` });
    return;
  }

  const fromDate = parseLegacyDate(row.LeaveFrom);
  const toDate   = parseLegacyDate(row.LeaveTo);
  if (!fromDate || !toDate) {
    result.errors.push({ legacyId: row.Id, error: `Invalid dates: ${row.LeaveFrom} / ${row.LeaveTo}` });
    return;
  }

  const totalDays = sumLeaveDays(row) || 1;
  const status    = normalizeLeaveStatus(row.Status);
  const reason    = [row.LeaveFor, row.Purpose].filter(Boolean).join(' — ') || null;
  const appliedAt = parseLegacyDate(row.CreateDate);

  // Idempotency key: employee + from + to + leave_type
  await dst.execute(
    `INSERT INTO leave_request
       (employee_id, leave_type_id, from_date, to_date, total_days, reason, status, applied_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE status = VALUES(status), reason = VALUES(reason)`,
    [employeeId, leaveTypeId, fromDate, toDate, totalDays, reason, status, appliedAt ?? fromDate],
  );

  // ── Approval log ─────────────────────────────────────────────────────────────
  if (row.LeaveApproveBy && status === 'approved') {
    const [lrRows] = await dst.execute<RowDataPacket[]>(
      `SELECT id FROM leave_request
       WHERE employee_id = ? AND from_date = ? AND to_date = ? AND leave_type_id = ?`,
      [employeeId, fromDate, toDate, leaveTypeId],
    );
    const leaveRequestId = lrRows[0]?.id as string | undefined;
    if (leaveRequestId) {
      const approveAt = parseLegacyDate(row.LeaveApproveDate) ?? fromDate;
      // Use a fixed system UUID as action_by for legacy approvals
      const SYSTEM_UUID = '00000000-0000-0000-0000-000000000001';
      await dst.execute(
        `INSERT IGNORE INTO leave_approval_log
           (leave_request_id, action, action_by, action_at, remarks)
         VALUES (?, 'approved', ?, ?, ?)`,
        [leaveRequestId, SYSTEM_UUID, approveAt, `Legacy: approved by ${row.LeaveApproveBy}`],
      );
    }
  }

  result.inserted++;
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/scripts/migrate-legacy.leave.ts
git commit -m "feat(migration): leave migrator — leave_request + approval_log"
```

---

## Task 7: Main Orchestrator Script

**Files:**
- Create: `backend/scripts/migrate-legacy.ts`

- [ ] **Step 1: Create the main script**

```typescript
// backend/scripts/migrate-legacy.ts
// Run: npx tsx scripts/migrate-legacy.ts
// Requires: .env file with DB_HOST / DB_USER / DB_PASSWORD / DB_NAME
// Fill in LEGACY_SRC credentials in migrate-legacy.config.ts before running.

import { createConnection } from 'mysql2/promise';
import { LEGACY_SRC, DST, LEGACY_TABLES } from './migrate-legacy.config.js';
import { seedMasters } from './migrate-legacy.masters.js';
import { migrateEmployees } from './migrate-legacy.employees.js';
import { migrateLeave } from './migrate-legacy.leave.js';

async function main(): Promise<void> {
  console.log('=== Legacy Migration ETL ===');
  console.log('Target DB:', DST.database, '@', DST.host);
  console.log('Source DB:', LEGACY_SRC.database, '@', LEGACY_SRC.host);
  console.log('');

  // ── PHASE 0: Connect ────────────────────────────────────────────────────────
  console.log('[Phase 0] Connecting…');
  let src, dst;
  try {
    src = await createConnection(LEGACY_SRC);
    console.log('  ✓ Source connected');
  } catch (err) {
    console.error('  ✗ Source connection failed:', err);
    console.error('  → Fill in LEGACY_SRC credentials in backend/scripts/migrate-legacy.config.ts');
    process.exit(1);
  }
  try {
    dst = await createConnection(DST);
    console.log('  ✓ Destination connected');
  } catch (err) {
    console.error('  ✗ Destination connection failed:', err);
    await src.end();
    process.exit(1);
  }

  // Verify source tables exist
  try {
    await src.execute(`SELECT 1 FROM ${LEGACY_TABLES.employees} LIMIT 1`);
    await src.execute(`SELECT 1 FROM ${LEGACY_TABLES.leave} LIMIT 1`);
    console.log('  ✓ Source tables verified');
  } catch (err) {
    console.error('  ✗ Source table check failed:', err);
    await src.end(); await dst.end();
    process.exit(1);
  }
  console.log('');

  // ── PHASE 1: Seed masters ───────────────────────────────────────────────────
  const masters = await seedMasters(src, dst, LEGACY_TABLES.employees);
  console.log('');

  // ── PHASE 2: Migrate employees ──────────────────────────────────────────────
  const empResult = await migrateEmployees(src, dst, LEGACY_TABLES.employees, masters);
  console.log('');

  // ── PHASE 3: Migrate leave ──────────────────────────────────────────────────
  const leaveResult = await migrateLeave(src, dst, LEGACY_TABLES.leave, masters);
  console.log('');

  // ── PHASE 4: Disconnect ─────────────────────────────────────────────────────
  await src.end();
  await dst.end();

  // ── PHASE 5: Summary ────────────────────────────────────────────────────────
  console.log('=== Migration Summary ===');
  console.log(`Employees : inserted=${empResult.inserted}  skipped=${empResult.skipped}  errors=${empResult.errors.length}`);
  console.log(`Leave     : inserted=${leaveResult.inserted}  skipped=${leaveResult.skipped}  errors=${leaveResult.errors.length}`);

  if (empResult.errors.length > 0) {
    console.log('\nEmployee errors:');
    empResult.errors.forEach(e => console.log(`  ${e.empCode}: ${e.error}`));
  }
  if (leaveResult.errors.length > 0) {
    console.log('\nLeave errors:');
    leaveResult.errors.forEach(e => console.log(`  id=${e.legacyId}: ${e.error}`));
  }

  const exitCode = (empResult.errors.length + leaveResult.errors.length) > 0 ? 1 : 0;
  console.log('\nDone.');
  process.exit(exitCode);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify the script has no TypeScript errors**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors (exit code 0)

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/migrate-legacy.ts
git commit -m "feat(migration): main ETL orchestrator script — 5 phases, summary report"
```

---

## Task 8: Update Migration Service + Routes

**Files:**
- Modify: `backend/src/modules/migration/migration.service.ts`
- Modify: `backend/src/modules/migration/migration.routes.ts`

- [ ] **Step 1: Update migration.service.ts**

Replace the full contents of `backend/src/modules/migration/migration.service.ts` with:

```typescript
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export interface ModuleStatus {
  module: string;
  mysql_count: number;
  status: "empty" | "has_data";
}

export const migrationService = {
  async getModuleStatus(): Promise<ModuleStatus[]> {
    const modules = [
      { module: "employees",   table: "employees" },
      { module: "attendance",  table: "wfm_attendance_session" },
      { module: "wfm",         table: "wfm_roster_assignment" },
      { module: "leave",       table: "leave_request" },
      { module: "ats",         table: "ats_candidate" },
      { module: "payroll",     table: "salary_prep_run" },
    ];

    const results: ModuleStatus[] = [];
    for (const m of modules) {
      try {
        const [rows] = await db.execute<RowDataPacket[]>(
          `SELECT COUNT(*) AS cnt FROM ${m.table}`
        );
        const cnt = (rows as { cnt: number }[])[0]?.cnt ?? 0;
        results.push({ module: m.module, mysql_count: cnt, status: cnt > 0 ? "has_data" : "empty" });
      } catch {
        results.push({ module: m.module, mysql_count: 0, status: "empty" });
      }
    }
    return results;
  },

  async getLegacyMigrationStatus(): Promise<Record<string, number>> {
    const tables = [
      "employee_statutory_info",
      "employee_salary_snapshot",
      "employee_client_mapping",
      "employee_kpi_assignment",
      "employee_legacy_meta",
    ];
    const counts: Record<string, number> = {};
    for (const t of tables) {
      try {
        const [rows] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS cnt FROM ${t}`);
        counts[t] = (rows as { cnt: number }[])[0]?.cnt ?? 0;
      } catch {
        counts[t] = -1; // table does not exist yet
      }
    }
    // Also add base employee count with legacy_emp_id populated
    try {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM employees WHERE legacy_emp_id IS NOT NULL`
      );
      counts['employees_migrated'] = (rows as { cnt: number }[])[0]?.cnt ?? 0;
    } catch {
      counts['employees_migrated'] = 0;
    }
    return counts;
  },
};
```

- [ ] **Step 2: Update migration.routes.ts**

Replace the full contents of `backend/src/modules/migration/migration.routes.ts` with:

```typescript
import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { migrationService } from "./migration.service.js";

export const migrationRouter = Router();
migrationRouter.use(requireAuth);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

migrationRouter.get("/status", h(async (_req: any, res: any) => {
  const data = await migrationService.getModuleStatus();
  return res.json({ success: true, data });
}));

migrationRouter.get("/legacy-status", h(async (_req: any, res: any) => {
  const data = await migrationService.getLegacyMigrationStatus();
  return res.json({ success: true, data });
}));
```

- [ ] **Step 3: Verify no TypeScript errors**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors (exit code 0)

- [ ] **Step 4: Run all tests**

```bash
cd backend && npx vitest run
```

Expected: all tests pass, no failures

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/migration/migration.service.ts \
        backend/src/modules/migration/migration.routes.ts
git commit -m "feat(migration): add legacy-status endpoint to migration console"
```

---

## How to Run the ETL

After all tasks are complete:

1. Apply the SQL migration to your `mas_hrms` database (run `052_legacy_migration_tables.sql` manually or via your migration runner)
2. Fill in the 4 placeholder values in `backend/scripts/migrate-legacy.config.ts`
3. Ensure your `.env` has `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` pointing at `mas_hrms`
4. Run:
   ```bash
   cd backend && npx tsx scripts/migrate-legacy.ts
   ```
5. Review the summary output; non-zero exit code = errors to investigate
6. Check `GET /api/migration/legacy-status` for post-migration row counts

---

## Out of Scope

- Supabase Auth user accounts for migrated employees (separate task)
- Encryption of `account_number` in `employee_bank_detail` — currently stored as plain UTF-8 bytes; encrypt using `PAYROLL_BANK_KEY` in a separate pass
- Attendance/biometric history migration (separate source table, separate spec)
- LMS learner mapping (LMS integration spec)
