# WFM Roster Operating Model Redesign — Implementation Plan

> **SUPERSEDED (2026-08-20):** confirmed with the user that this plan is
> replaced by the 4-subsystem WFM roster-builder decomposition — see
> `docs/superpowers/specs/2026-08-20-wfm-roster-builder-subsystem1-design.md`.
> Task 1's schema is already live and unaffected. Task 11's amendment/audit
> fields and baseline-protection rule are folded into that decomposition's
> subsystem 2; Task 10's RTA exception disposition is folded into subsystem
> 4. Do not resume this file's remaining tasks independently — check the spec
> above first. Left in place (not deleted) for reference only.

**Created:** 2026-08-19
**Objective:** Transform WFM from forecast-centric to roster-led operating model with fully adjustable Excel import engine.

## Global Constraints

1. **No deletion of existing tables, routes, or pages** — all changes additive; legacy routes get redirects
2. **All 57 existing WFM tests must continue passing**
3. **Backend authorization mandatory** — UI gating is not security
4. **Maker-checker enforcement** — uploader cannot self-approve
5. **Audit everything** — all state changes logged
6. **Shift parser must handle both 12h and 24h formats** including `07:00pm-04:00am` overnight
7. **Blank handling differs by mode** — NEW import: blank → UNASSIGNED; UPDATE import: blank → NO_CHANGE
8. **Literal `0` is always HARD_ERROR** — never valid
9. **HD requires explicit mapping profile** — never assumed
10. **Post-publish amendments cannot retroactively improve adherence baseline**

## Task 1: DB Migrations — Schema Foundation

**Files to create:**
- `backend/sql/1500_wfm_roster_import_engine.sql`

**Schema:**

```sql
-- Shift alias table for normalizing spreadsheet variations
CREATE TABLE IF NOT EXISTS wfm_shift_alias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shift_id INT NOT NULL,
  alias VARCHAR(100) NOT NULL,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by INT,
  FOREIGN KEY (shift_id) REFERENCES wfm_shift_master(id),
  UNIQUE KEY uk_alias (alias)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Import batch for roster uploads
CREATE TABLE IF NOT EXISTS wfm_roster_import_batch (
  id INT AUTO_INCREMENT PRIMARY KEY,
  process_id INT NOT NULL,
  cycle_id INT,
  import_mode ENUM('NEW', 'UPDATE') NOT NULL DEFAULT 'NEW',
  file_name VARCHAR(255),
  file_format ENUM('WIDE', 'LONG') NOT NULL DEFAULT 'WIDE',
  status ENUM('PARSING', 'PREVIEW', 'VALIDATING', 'READY', 'COMMITTED', 'FAILED', 'CANCELLED') DEFAULT 'PARSING',
  total_rows INT DEFAULT 0,
  valid_rows INT DEFAULT 0,
  warning_rows INT DEFAULT 0,
  error_rows INT DEFAULT 0,
  needs_mapping_rows INT DEFAULT 0,
  date_range_start DATE,
  date_range_end DATE,
  mapping_profile_id INT,
  validation_summary_json JSON,
  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  committed_by INT,
  committed_at TIMESTAMP NULL,
  FOREIGN KEY (process_id) REFERENCES process(id),
  INDEX idx_status (status),
  INDEX idx_process (process_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Individual import rows for preview
CREATE TABLE IF NOT EXISTS wfm_roster_import_row (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  batch_id INT NOT NULL,
  row_number INT NOT NULL,
  employee_id INT,
  employee_id_raw VARCHAR(100),
  employee_name_raw VARCHAR(255),
  roster_date DATE NOT NULL,
  raw_value VARCHAR(255),
  normalized_type ENUM('SHIFT', 'WEEK_OFF', 'LEAVE', 'HALF_DAY', 'HOLIDAY', 'TRAINING', 'UNSCHEDULED', 'UNASSIGNED', 'NEEDS_MAPPING', 'NO_CHANGE', 'HARD_ERROR') NOT NULL,
  resolved_shift_id INT,
  validation_state ENUM('VALID', 'WARNING', 'ERROR') NOT NULL DEFAULT 'VALID',
  validation_messages JSON,
  extra_metadata_json JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (batch_id) REFERENCES wfm_roster_import_batch(id) ON DELETE CASCADE,
  INDEX idx_batch (batch_id),
  INDEX idx_batch_state (batch_id, validation_state),
  INDEX idx_employee_date (employee_id, roster_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Header mapping profiles (saved per process/source)
CREATE TABLE IF NOT EXISTS wfm_header_mapping_profile (
  id INT AUTO_INCREMENT PRIMARY KEY,
  process_id INT,
  profile_name VARCHAR(100) NOT NULL,
  source_identifier VARCHAR(100),
  column_mappings JSON NOT NULL,
  shift_alias_overrides JSON,
  status_alias_overrides JSON,
  blank_handling ENUM('UNASSIGNED', 'NO_CHANGE') DEFAULT 'UNASSIGNED',
  hd_maps_to ENUM('HALF_DAY', 'NEEDS_MAPPING') DEFAULT 'NEEDS_MAPPING',
  is_default TINYINT(1) DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (process_id) REFERENCES process(id),
  UNIQUE KEY uk_process_name (process_id, profile_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Add planning_mode to process table
ALTER TABLE process ADD COLUMN IF NOT EXISTS planning_mode ENUM('ROSTER_LED', 'VOLUME_BASED') DEFAULT 'ROSTER_LED';

-- RTA exception disposition tracking
CREATE TABLE IF NOT EXISTS wfm_rta_exception (
  id INT AUTO_INCREMENT PRIMARY KEY,
  alert_id INT NOT NULL,
  employee_id INT NOT NULL,
  exception_date DATE NOT NULL,
  exception_type ENUM('LATE', 'NO_SHOW', 'EARLY_EXIT', 'SHORT_HOURS', 'MISSED_PUNCH', 'ROSTER_MISMATCH', 'OVERTIME', 'OTHER') NOT NULL,
  exception_state ENUM('OPEN', 'ACKNOWLEDGED', 'ACTIONED', 'RESOLVED', 'ESCALATED') DEFAULT 'OPEN',
  disposition_type ENUM('CONTACTED_EMPLOYEE', 'TRANSPORT_ISSUE', 'SYSTEM_LOGIN_ISSUE', 'BIOMETRIC_ISSUE', 'APPROVED_EXCEPTION', 'EMERGENCY', 'SHIFT_CHANGE_PENDING', 'REGULARIZATION_REQUIRED', 'NO_RESPONSE', 'ESCALATE_TO_HR', 'OTHER'),
  disposition_owner_id INT,
  disposition_comment TEXT,
  disposition_at TIMESTAMP NULL,
  regularization_id INT,
  roster_amendment_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (alert_id) REFERENCES adherence_alert(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (disposition_owner_id) REFERENCES users(id),
  INDEX idx_employee_date (employee_id, exception_date),
  INDEX idx_state (exception_state),
  INDEX idx_alert (alert_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Extend roster_change_log for amendment workflow
ALTER TABLE roster_change_log 
  ADD COLUMN IF NOT EXISTS old_shift_id INT,
  ADD COLUMN IF NOT EXISTS new_shift_id INT,
  ADD COLUMN IF NOT EXISTS old_assignment_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS new_assignment_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS amendment_reason TEXT,
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS ack_required TINYINT(1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS acked_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS is_late_change TINYINT(1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lead_time_hours INT;
```

**Tests:** Run migration against test DB, verify all tables created, verify existing WFM tests still pass.

**Commit message:** `feat(wfm): add roster import engine schema (Task 1)`

---

## Task 2: Shift Parser Service

**Files to create:**
- `backend/src/modules/wfm/shift-parser.service.ts`
- `backend/src/modules/wfm/__tests__/shift-parser.test.ts`

**Service exports:**

```typescript
interface ParsedShift {
  type: 'SHIFT' | 'ALIAS_LOOKUP';
  startTime?: string;  // HH:MM (24h)
  endTime?: string;    // HH:MM (24h)
  isOvernight: boolean;
  rawValue: string;
  aliasKey?: string;   // For ALIAS_LOOKUP type
}

interface ShiftParserResult {
  success: boolean;
  parsed?: ParsedShift;
  error?: string;
}

export function parseShiftString(raw: string): ShiftParserResult;
export function normalizeTime12to24(timeStr: string): string | null;
export function detectOvernight(startTime: string, endTime: string): boolean;
```

**Parsing rules:**
1. Try 24-hour format: `/^(\d{1,2}):?(\d{2})\s*[-–]\s*(\d{1,2}):?(\d{2})$/`
2. Try 12-hour format: `/^(\d{1,2}):?(\d{2})?\s*(am|pm)\s*[-–]\s*(\d{1,2}):?(\d{2})?\s*(am|pm)$/i`
3. If neither matches, return `{ type: 'ALIAS_LOOKUP', aliasKey: raw.trim().toUpperCase() }`

**Overnight detection:**
- If end time <= start time (as minutes-from-midnight), it's overnight
- `15:15-00:15` → overnight
- `07:00pm-04:00am` → 19:00-04:00 → overnight

**Test cases (minimum):**
```typescript
// 24-hour formats
'07:00-16:00' → { startTime: '07:00', endTime: '16:00', isOvernight: false }
'15:15-00:15' → { startTime: '15:15', endTime: '00:15', isOvernight: true }
'07:00 - 16:00' → { startTime: '07:00', endTime: '16:00', isOvernight: false }

// 12-hour formats  
'07:00pm-04:00am' → { startTime: '19:00', endTime: '04:00', isOvernight: true }
'7pm-4am' → { startTime: '19:00', endTime: '04:00', isOvernight: true }
'07:00 PM - 04:00 AM' → { startTime: '19:00', endTime: '04:00', isOvernight: true }
'6am-3pm' → { startTime: '06:00', endTime: '15:00', isOvernight: false }

// Alias lookups
'M' → { type: 'ALIAS_LOOKUP', aliasKey: 'M' }
'Morning' → { type: 'ALIAS_LOOKUP', aliasKey: 'MORNING' }
'6-3' → { type: 'ALIAS_LOOKUP', aliasKey: '6-3' }
'General' → { type: 'ALIAS_LOOKUP', aliasKey: 'GENERAL' }
```

**Commit message:** `feat(wfm): add shift parser service with 12h/24h support (Task 2)`

---

## Task 3: Assignment Type Normalizer

**Files to create:**
- `backend/src/modules/wfm/assignment-normalizer.service.ts`
- `backend/src/modules/wfm/__tests__/assignment-normalizer.test.ts`

**Service exports:**

```typescript
type AssignmentType = 
  | 'SHIFT' | 'WEEK_OFF' | 'LEAVE' | 'HALF_DAY' | 'HOLIDAY' 
  | 'TRAINING' | 'UNSCHEDULED' | 'UNASSIGNED' | 'NEEDS_MAPPING' 
  | 'NO_CHANGE' | 'HARD_ERROR';

interface NormalizerConfig {
  importMode: 'NEW' | 'UPDATE';
  hdMapsTo: 'HALF_DAY' | 'NEEDS_MAPPING';
  customAliases?: Record<string, AssignmentType>;
}

interface NormalizerResult {
  type: AssignmentType;
  shiftParseResult?: ShiftParserResult;  // If type is SHIFT
  warning?: string;
}

export function normalizeAssignment(
  rawValue: string | null | undefined, 
  config: NormalizerConfig
): NormalizerResult;
```

**Normalization rules (case-insensitive):**

| Input pattern | Output |
|---|---|
| `WO`, `wo`, `W/O`, `Week Off`, `OFF`, `WEEK_OFF` | `WEEK_OFF` |
| `Leave`, `L`, `LEAVE` | `LEAVE` |
| `Training`, `Trg`, `TRAINING` | `TRAINING` |
| `Holiday`, `H`, `HOLIDAY` | `HOLIDAY` |
| `HD`, `Half Day`, `HALF_DAY` | config.hdMapsTo |
| `0` (literal zero) | `HARD_ERROR` |
| blank/null/undefined + NEW mode | `UNASSIGNED` |
| blank/null/undefined + UPDATE mode | `NO_CHANGE` |
| Parseable as shift | `SHIFT` + shiftParseResult |
| Anything else | `NEEDS_MAPPING` |

**Test cases (minimum):**
```typescript
// Standard normalizations
normalizeAssignment('WO', { importMode: 'NEW' }) → { type: 'WEEK_OFF' }
normalizeAssignment('wo', { importMode: 'NEW' }) → { type: 'WEEK_OFF' }
normalizeAssignment('Week Off', { importMode: 'NEW' }) → { type: 'WEEK_OFF' }
normalizeAssignment('Leave', { importMode: 'NEW' }) → { type: 'LEAVE' }
normalizeAssignment('Training', { importMode: 'NEW' }) → { type: 'TRAINING' }

// HD handling
normalizeAssignment('HD', { importMode: 'NEW', hdMapsTo: 'NEEDS_MAPPING' }) → { type: 'NEEDS_MAPPING' }
normalizeAssignment('HD', { importMode: 'NEW', hdMapsTo: 'HALF_DAY' }) → { type: 'HALF_DAY' }

// Literal zero
normalizeAssignment('0', { importMode: 'NEW' }) → { type: 'HARD_ERROR' }

// Blank handling
normalizeAssignment('', { importMode: 'NEW' }) → { type: 'UNASSIGNED' }
normalizeAssignment('', { importMode: 'UPDATE' }) → { type: 'NO_CHANGE' }
normalizeAssignment(null, { importMode: 'NEW' }) → { type: 'UNASSIGNED' }

// Shift strings
normalizeAssignment('07:00-16:00', { importMode: 'NEW' }) → { type: 'SHIFT', shiftParseResult: {...} }
normalizeAssignment('07:00pm-04:00am', { importMode: 'NEW' }) → { type: 'SHIFT', shiftParseResult: {...} }

// Alias lookups
normalizeAssignment('Extraction Only', { importMode: 'NEW' }) → { type: 'NEEDS_MAPPING' }
normalizeAssignment('M', { importMode: 'NEW' }) → { type: 'NEEDS_MAPPING' }  // Unless in customAliases
```

**Commit message:** `feat(wfm): add assignment type normalizer (Task 3)`

---

## Task 4: Header Alias Engine

**Files to create:**
- `backend/src/modules/wfm/header-alias.service.ts`
- `backend/src/modules/wfm/__tests__/header-alias.test.ts`

**Service exports:**

```typescript
interface ColumnMapping {
  sourceHeader: string;
  mappedTo: string | null;  // null = extra_metadata
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
}

interface HeaderDetectionResult {
  headerRowIndex: number;
  dateColumns: Array<{ index: number; header: string; parsedDate: Date }>;
  identityColumns: Array<{ index: number; header: string; mapping: ColumnMapping }>;
  unmappedColumns: Array<{ index: number; header: string }>;
}

export function detectHeaderRow(rows: string[][]): number;
export function parseColumnDate(header: string): Date | null;
export function mapIdentityColumn(header: string): ColumnMapping;
export function analyzeHeaders(rows: string[][]): HeaderDetectionResult;
```

**Date parsing patterns:**
- `DD-MMM` (01-Aug) → current year assumed
- `DD-MMM-YY` (01-Aug-26)
- `DD-MMM-YYYY` (01-Aug-2026)
- `DD/MM/YY` (01/08/26)
- `DD/MM/YYYY` (01/08/2026)
- `M/D/YYYY` (8/1/2026)
- Excel serial number (46044 → date)

**Identity column alias map (HIGH confidence):**

```typescript
const IDENTITY_ALIASES: Record<string, string[]> = {
  employeeId: ['mas id', 'masid', 'emp code', 'employee id', 'emp id', 'empl number', 'agent id', 'employee code'],
  employeeName: ['analyst name', 'name', 'employee name', 'agent name', 'emp name'],
  teammatesId: ['teammates id', 'teammate id'],
  domainId: ['domain id', 'doman id'],
  domainEmail: ['domain', 'domain email', 'email'],
  gender: ['gender', 'sex'],
  batchNumber: ['batch #', 'batch', 'batch number', 'batch no'],
  contactNumber: ['contact no', 'phone', 'mobile', 'contact'],
  doj: ['doj', 'date of joining', 'join date', 'joining date'],
  dol: ['dol', 'date of leaving', 'exit date', 'leaving date'],
  aor: ['aor', 'aor date'],
  aorStatus: ['aor current status', 'aor status', 'current status'],
  tlName: ['tl name', 'team leader', 'tl'],
  qualityAuditor: ['quality auditor', 'qa', 'auditor'],
  amName: ['am', 'assistant manager', 'am name'],
  designation: ['designation', 'role', 'title', 'position'],
  department: ['dept', 'department'],
  process: ['process', 'campaign', 'account', 'project'],
  lob: ['lob', 'line of business'],
  subLob: ['sub lob', 'sub-lob', 'queue', 'sublob'],
  site: ['site', 'location', 'branch', 'office'],
};
```

**Test cases:**
```typescript
// Header row detection
detectHeaderRow([
  ['', '', '', ''],
  ['Mas Id', 'Name', '01-Aug', '02-Aug'],
  ['MAS001', 'John', 'WO', '07:00-16:00']
]) → 1

// Multi-row header (day names + dates)
detectHeaderRow([
  ['', '', 'Saturday', 'Sunday'],
  ['Emp Code', 'Name', '01-Aug', '02-Aug'],
  ['MAS001', 'John', 'WO', '07:00-16:00']
]) → 1  // Uses date row

// Column mapping
mapIdentityColumn('Mas Id') → { mappedTo: 'employeeId', confidence: 'HIGH' }
mapIdentityColumn('DoMain ID') → { mappedTo: 'domainId', confidence: 'HIGH' }
mapIdentityColumn('Quality Auditor') → { mappedTo: 'qualityAuditor', confidence: 'HIGH' }
mapIdentityColumn('Random Column') → { mappedTo: null, confidence: 'NONE' }

// Date parsing
parseColumnDate('01-Aug') → Date(2026, 7, 1)
parseColumnDate('01-Aug-26') → Date(2026, 7, 1)
parseColumnDate('46044') → Date from Excel serial
```

**Commit message:** `feat(wfm): add header alias engine with date detection (Task 4)`

---

## Task 5: Import Engine Backend — Upload & Preview

**Files to create:**
- `backend/src/modules/wfm/roster-import.service.ts`
- `backend/src/modules/wfm/roster-import.routes.ts`
- `backend/src/modules/wfm/__tests__/roster-import.test.ts`

**API Endpoints:**

```
POST /api/wfm/roster-imports
  Body: multipart/form-data with file + processId + cycleId? + importMode
  Returns: { batchId, status: 'PARSING' }
  Roles: wfm, admin, super_admin

GET /api/wfm/roster-imports/:batchId
  Returns: Import batch summary with validation counts
  Roles: wfm, admin, super_admin (scope to process)

GET /api/wfm/roster-imports/:batchId/rows
  Query: ?page=1&limit=50&state=ERROR
  Returns: Paginated import rows with validation state
  Roles: wfm, admin, super_admin (scope to process)

PATCH /api/wfm/roster-imports/:batchId/header-mapping
  Body: { columnMappings: {...} }
  Returns: Updated batch
  Roles: wfm, admin, super_admin
```

**Service functions:**

```typescript
export async function createImportBatch(params: {
  processId: number;
  cycleId?: number;
  importMode: 'NEW' | 'UPDATE';
  file: Buffer;
  fileName: string;
  createdBy: number;
}): Promise<{ batchId: number }>;

export async function parseAndValidateBatch(batchId: number): Promise<void>;

export async function getImportBatchSummary(batchId: number): Promise<ImportBatchSummary>;

export async function getImportRows(batchId: number, options: {
  page: number;
  limit: number;
  state?: 'VALID' | 'WARNING' | 'ERROR';
}): Promise<PaginatedResult<ImportRow>>;
```

**Validation checks per row:**
1. Employee exists in HRMS master by employee_id_raw
2. Employee is active on roster_date
3. roster_date >= employee.doj
4. roster_date <= employee.date_of_exit (if set)
5. Process matches (if employee has process assignment)
6. Leave conflict: approved leave exists but roster has working shift
7. Leave mismatch: roster says LEAVE but no approved leave
8. Duplicate: same employee + same date in same batch
9. Conflicting duplicate: same employee + same date + different value

**Test cases:**
- Upload WIDE format file → preview shows correct counts
- Upload with duplicate employee rows (same value) → deduplicated with warning
- Upload with duplicate employee rows (conflicting) → hard error
- Upload with unknown employee ID → error
- Upload with literal 0 → hard error
- Upload with approved leave + working shift → warning

**Commit message:** `feat(wfm): add roster import upload and preview (Task 5)`

---

## Task 6: Import Engine Backend — Commit

**Files to modify:**
- `backend/src/modules/wfm/roster-import.service.ts`
- `backend/src/modules/wfm/roster-import.routes.ts`

**Files to create:**
- `backend/src/modules/wfm/__tests__/roster-import-commit.test.ts`

**API Endpoint:**

```
POST /api/wfm/roster-imports/:batchId/commit
  Body: { overrideWarnings?: boolean }
  Returns: { success, assignmentsCreated, cycleId }
  Roles: wfm, admin, super_admin
  Constraints:
    - Batch must be in READY state (no hard errors)
    - If batch has warnings and overrideWarnings !== true, reject
    - If maker-checker enabled for process: committed_by !== created_by
```

**Service function:**

```typescript
export async function commitImportBatch(
  batchId: number, 
  committedBy: number,
  options: { overrideWarnings?: boolean }
): Promise<{ assignmentsCreated: number; cycleId: number }>;
```

**Commit process:**
1. Verify batch status = READY
2. Verify no HARD_ERROR rows remain
3. If warnings exist and !overrideWarnings, throw
4. If process.maker_checker_enabled and created_by === committedBy, throw
5. Begin transaction:
   - Create/update wfm_roster_assignment records
   - Set assignment lifecycle to DRAFT
   - Log to roster_change_log
   - Update batch status to COMMITTED
   - Set committed_by and committed_at
6. Return summary

**Test cases:**
- Commit batch with errors → rejected
- Commit batch with warnings, no override → rejected
- Commit batch with warnings, override=true → succeeds
- Self-approve with maker-checker enabled → rejected
- Successful commit creates correct assignment records

**Commit message:** `feat(wfm): add roster import commit with maker-checker (Task 6)`

---

## Task 7: Shift Alias CRUD & Resolver

**Files to create:**
- `backend/src/modules/wfm/shift-alias.service.ts`
- `backend/src/modules/wfm/shift-alias.routes.ts`
- `backend/src/modules/wfm/__tests__/shift-alias.test.ts`

**API Endpoints:**

```
GET /api/wfm/shift-aliases
  Query: ?shiftId=
  Returns: List of aliases
  Roles: wfm, admin, super_admin

POST /api/wfm/shift-aliases
  Body: { shiftId, alias }
  Returns: Created alias
  Roles: wfm, admin

PATCH /api/wfm/shift-aliases/:id
  Body: { alias?, isActive? }
  Returns: Updated alias
  Roles: wfm, admin

DELETE /api/wfm/shift-aliases/:id
  Returns: { success }
  Roles: admin

POST /api/wfm/shift-aliases/resolve
  Body: { aliases: string[] }
  Returns: { resolved: Record<string, number | null> }
  Roles: wfm, admin, super_admin
```

**Resolver function:**

```typescript
export async function resolveShiftAliases(
  aliases: string[]
): Promise<Map<string, number | null>>;
// Returns map of alias → shiftId (null if not found)
// Case-insensitive matching
// Also attempts direct time-string match against wfm_shift_master.start_time/end_time
```

**Test cases:**
- Create alias → persisted
- Create duplicate alias → rejected
- Resolve known alias → returns shiftId
- Resolve unknown alias → returns null
- Resolve time string matching existing shift → returns shiftId

**Commit message:** `feat(wfm): add shift alias CRUD and resolver (Task 7)`

---

## Task 8: Header Mapping Profile CRUD

**Files to create:**
- `backend/src/modules/wfm/header-mapping-profile.service.ts`
- `backend/src/modules/wfm/header-mapping-profile.routes.ts`
- `backend/src/modules/wfm/__tests__/header-mapping-profile.test.ts`

**API Endpoints:**

```
GET /api/wfm/header-mapping-profiles
  Query: ?processId=
  Returns: List of profiles
  Roles: wfm, admin, super_admin

POST /api/wfm/header-mapping-profiles
  Body: { processId?, profileName, columnMappings, shiftAliasOverrides?, statusAliasOverrides?, blankHandling?, hdMapsTo? }
  Returns: Created profile
  Roles: wfm, admin

PATCH /api/wfm/header-mapping-profiles/:id
  Body: partial update
  Returns: Updated profile
  Roles: wfm, admin

DELETE /api/wfm/header-mapping-profiles/:id
  Returns: { success }
  Roles: admin
```

**Test cases:**
- Create profile → persisted
- Create profile with same name for same process → rejected
- Get profiles by process → returns only that process's profiles
- Update profile → updated

**Commit message:** `feat(wfm): add header mapping profile CRUD (Task 8)`

---

## Task 9: Process Planning Mode Config

**Files to create:**
- `backend/src/modules/wfm/planning-mode.routes.ts`
- `backend/src/modules/wfm/planning-mode.middleware.ts`
- `backend/src/modules/wfm/__tests__/planning-mode.test.ts`

**API Endpoints:**

```
GET /api/wfm/processes/:id/planning-config
  Returns: { planningMode: 'ROSTER_LED' | 'VOLUME_BASED' }
  Roles: wfm, admin, super_admin

PATCH /api/wfm/processes/:id/planning-config
  Body: { planningMode }
  Returns: Updated config
  Roles: admin, super_admin
```

**Middleware:**

```typescript
export function requireVolumeBased(req, res, next) {
  // Check process planning_mode from req.query.processId or req.params.processId
  // If ROSTER_LED, return 403 with message "This feature requires VOLUME_BASED planning mode"
}
```

**Apply middleware to:**
- `/api/wfm/auto-roster/*`
- `/api/wfm/planning-rules/*`
- `/api/wfm/slot-requirements/*`
- `/api/roster-capacity/*`

**Test cases:**
- Get planning config → returns current mode
- Update to VOLUME_BASED → updated
- ROSTER_LED process accessing /auto-roster → 403
- VOLUME_BASED process accessing /auto-roster → allowed

**Commit message:** `feat(wfm): add process planning mode config with feature gate (Task 9)`

---

## Task 10: RTA Exception Disposition API

**Files to create:**
- `backend/src/modules/wfm/rta-exception.service.ts`
- `backend/src/modules/wfm/rta-exception.routes.ts`
- `backend/src/modules/wfm/__tests__/rta-exception.test.ts`

**API Endpoints:**

```
GET /api/wfm/rta/exceptions
  Query: ?date=&processId=&state=&employeeId=
  Returns: List of exceptions with alert details
  Roles: wfm, admin, hr, manager, process_manager, team_leader

POST /api/wfm/rta/exceptions
  Body: { alertId, exceptionType, comment? }
  Returns: Created exception
  Roles: wfm, admin, hr, manager, process_manager

PATCH /api/wfm/rta/exceptions/:id/disposition
  Body: { dispositionType, comment?, regularizationId?, rosterAmendmentId? }
  Returns: Updated exception
  Roles: wfm, admin, hr, manager, process_manager, team_leader

PATCH /api/wfm/rta/exceptions/:id/state
  Body: { state: 'ACKNOWLEDGED' | 'ACTIONED' | 'RESOLVED' | 'ESCALATED' }
  Returns: Updated exception
  Roles: wfm, admin, hr, manager, process_manager, team_leader
```

**State transitions:**
- OPEN → ACKNOWLEDGED (any disposition owner)
- ACKNOWLEDGED → ACTIONED (any disposition owner)
- ACTIONED → RESOLVED (any disposition owner)
- Any → ESCALATED (any disposition owner)

**Test cases:**
- Create exception for alert → persisted
- Update disposition → disposition fields updated
- Transition state → state updated
- Invalid state transition → rejected

**Commit message:** `feat(wfm): add RTA exception disposition API (Task 10)`

---

## Task 11: Roster Amendment Workflow

**Files to modify:**
- `backend/src/modules/roster/roster.governance.service.ts`
- `backend/src/modules/roster/roster.governance.routes.ts`

**Files to create:**
- `backend/src/modules/roster/__tests__/roster-amendment.test.ts`

**API Endpoints:**

```
GET /api/roster-gov/cycles/:cycleId/amendments
  Returns: List of amendments (roster_change_log entries)
  Roles: wfm, admin, super_admin

POST /api/roster-gov/cycles/:cycleId/amendments
  Body: { employeeId, date, newShiftId?, newAssignmentType, reason }
  Returns: Created amendment
  Roles: wfm_manager, admin, super_admin
  Constraints:
    - Cycle must be APPROVED_PUBLISHED or FROZEN
    - Creates roster_change_log entry with old/new values
    - If within lead_time_hours threshold, marks is_late_change=true
    - Triggers notification to affected employee
```

**Amendment logic:**
1. Fetch current assignment for employee+date
2. Calculate lead_time_hours from now to shift start
3. If lead_time_hours < process.short_notice_threshold, set is_late_change=true
4. Create roster_change_log entry
5. Update wfm_roster_assignment
6. If cycle is APPROVED_PUBLISHED, trigger ROSTER_CHANGED notification

**Adherence baseline protection:**
- When calculating adherence, use the schedule that was published/notified BEFORE the actual attendance event
- Amendment after actual shift start does NOT change adherence baseline for that date
- Add check in RTA service: if roster_change_log.created_at > shift_start_time, use old_shift_id for adherence

**Test cases:**
- Create amendment for published cycle → creates change log
- Amendment within short notice → is_late_change=true
- Amendment after shift already started → adherence baseline unchanged

**Commit message:** `feat(wfm): add roster amendment workflow with baseline protection (Task 11)`

---

## Task 12: Mount Routes and Integration Test

**Files to modify:**
- `backend/src/app.ts` — mount new routers
- `backend/src/modules/wfm/wfm.routes.ts` — import and use sub-routers

**Integration test file:**
- `backend/src/modules/wfm/__tests__/roster-import-e2e.test.ts`

**Route mounts to add in app.ts:**

```typescript
import { rosterImportRouter } from './modules/wfm/roster-import.routes';
import { shiftAliasRouter } from './modules/wfm/shift-alias.routes';
import { headerMappingProfileRouter } from './modules/wfm/header-mapping-profile.routes';
import { planningModeRouter } from './modules/wfm/planning-mode.routes';
import { rtaExceptionRouter } from './modules/wfm/rta-exception.routes';

// In route mounting section:
app.use('/api/wfm/roster-imports', rosterImportRouter);
app.use('/api/wfm/shift-aliases', shiftAliasRouter);
app.use('/api/wfm/header-mapping-profiles', headerMappingProfileRouter);
app.use('/api/wfm/processes', planningModeRouter);
app.use('/api/wfm/rta/exceptions', rtaExceptionRouter);
```

**E2E test scenario:**
1. Create shift alias
2. Create mapping profile
3. Upload roster file (WIDE format)
4. Verify preview shows correct counts
5. Verify validation errors for bad rows
6. Fix mapping
7. Commit batch
8. Verify assignments created
9. Verify My Roster shows new data

**Commit message:** `feat(wfm): mount import engine routes and add e2e test (Task 12)`

---

## Summary

| Task | Effort | Dependencies |
|---|---|---|
| 1. DB Migrations | S | None |
| 2. Shift Parser | S | None |
| 3. Assignment Normalizer | S | Task 2 |
| 4. Header Alias Engine | M | None |
| 5. Import Upload & Preview | L | Tasks 1-4 |
| 6. Import Commit | M | Task 5 |
| 7. Shift Alias CRUD | S | Task 1 |
| 8. Mapping Profile CRUD | S | Task 1 |
| 9. Planning Mode Config | S | Task 1 |
| 10. RTA Exception API | M | Task 1 |
| 11. Amendment Workflow | M | Task 1 |
| 12. Route Mounting & E2E | M | Tasks 5-11 |

**Total: 12 tasks**

Execution order respecting dependencies:
1, 2, 4, 7, 8, 9, 10 (can run in parallel after 1)
3 (after 2)
5 (after 1-4)
6 (after 5)
11 (after 1)
12 (after all)
