# MAS Callnet API Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three missing backend API endpoints to HRMS1 that exist in `mas-hrms-backend` but not in HRMS1 — attendance day-detail, COSEC sync stats, and NEFT summary.

**Architecture:** Each endpoint is self-contained and added to an existing router file. No schema changes needed — all tables already exist in HRMS1's database. No new files need to be created; each task modifies one existing route file.

**Tech Stack:** Node.js + Express + TypeScript + mysql2/promise, existing `db` pool from `backend/src/db/mysql.ts`, existing `requireAuth` / `requireRole` middleware.

---

## File Map

| File | Change |
|------|--------|
| `backend/src/modules/wfm/wfm.routes.ts` | Add `GET /api/wfm/attendance/day-detail/:employeeId/:date` |
| `backend/src/modules/wfm/cosec-sync.routes.ts` | Add `GET /api/cosec-sync/stats` |
| `backend/src/modules/payroll/payroll.routes.ts` | Add `GET /api/payroll/runs/:runId/neft-summary` |

---

## Task 1: Attendance Day-Detail Endpoint

**What it does:** Returns a combined view of one employee's attendance record for a single date — the `attendance_daily_record` row, COSEC's authoritative aggregate (`cosec_daily_agg`), and all individual punch events (`cosec_punch_sync`). Used by the live attendance UI to show full punch timeline.

**Files:**
- Modify: `backend/src/modules/wfm/wfm.routes.ts`

- [ ] **Step 1: Find the right place to insert in wfm.routes.ts**

Open `backend/src/modules/wfm/wfm.routes.ts`. Scroll to the bottom of the file, just before the final `export` statement. This is where you will add the new route.

- [ ] **Step 2: Add the day-detail route**

Add this block just before the closing export in `backend/src/modules/wfm/wfm.routes.ts`:

```typescript
// GET /api/wfm/attendance/day-detail/:employeeId/:date
// Returns attendance record + COSEC daily aggregate + all punch events for one employee on one date
router.get(
  "/attendance/day-detail/:employeeId/:date",
  requireAuth,
  requireRole("admin", "hr", "wfm", "manager", "ceo", "finance", "payroll"),
  h(async (req: any, res: any) => {
    const { employeeId, date } = req.params;

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: "Invalid date format. Use YYYY-MM-DD" });
    }

    // 1. Attendance record + biometric log join
    const [attRows] = await db.execute<RowDataPacket[]>(
      `SELECT adr.*,
              DATE_FORMAT(adr.record_date, '%Y-%m-%d') AS record_date,
              e.employee_code,
              COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
              e.working_hours_start,
              e.working_hours_end,
              bal.first_punch,
              bal.last_punch,
              bal.biometric_minutes AS bio_minutes_log
         FROM attendance_daily_record adr
         JOIN employees e ON e.id = adr.employee_id
         LEFT JOIN biometric_attendance_log bal
           ON bal.employee_id = adr.employee_id AND DATE(bal.attendance_date) = adr.record_date
        WHERE adr.employee_id = ? AND adr.record_date = ?
        LIMIT 1`,
      [employeeId, date]
    );

    // 2. COSEC daily aggregate (authoritative work minutes from biometric device)
    const [cosecRows] = await db.execute<RowDataPacket[]>(
      `SELECT *
         FROM cosec_daily_agg
        WHERE employee_id = ? AND work_date = ?
        LIMIT 1`,
      [employeeId, date]
    );

    // 3. All individual punch events — handle night shift (punches from prev day after midnight up to 06:00)
    const [punchRows] = await db.execute<RowDataPacket[]>(
      `SELECT punch_time, io_type,
              CASE io_type WHEN 'I' THEN 'In' WHEN 'O' THEN 'Out' ELSE io_type END AS io_label,
              device_id
         FROM cosec_punch_sync
        WHERE employee_id = ?
          AND (
            DATE(punch_time) = ?
            OR (DATE(punch_time) = DATE_SUB(?, INTERVAL 1 DAY) AND TIME(punch_time) >= '00:00:00' AND TIME(punch_time) < '06:00:00')
          )
        ORDER BY punch_time ASC`,
      [employeeId, date, date]
    );

    return res.json({
      success: true,
      data: {
        attendance_record: attRows[0] ?? null,
        cosec_daily_agg: cosecRows[0] ?? null,
        raw_punches: punchRows,
      },
    });
  })
);
```

> **Note:** `RowDataPacket` is already imported at the top of `wfm.routes.ts` via `import type { RowDataPacket } from "mysql2"`. Confirm this import exists; if not, add it. Also confirm `db` is imported from `../../db/mysql.js` and `requireAuth`/`requireRole` are imported — they will be, since the file already uses them.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd C:\Users\shivamg\HRMS1\backend && npx tsc --noEmit
```

Expected: no errors. If you see `RowDataPacket` not found, add `import type { RowDataPacket } from "mysql2";` at the top of `wfm.routes.ts`.

- [ ] **Step 4: Start the backend and test the endpoint**

```bash
cd C:\Users\shivamg\HRMS1\backend && npm run dev
```

In a second terminal, test with a real employee ID and date from your DB:

```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:5055/api/wfm/attendance/day-detail/<employeeId>/<YYYY-MM-DD>
```

Expected response shape:
```json
{
  "success": true,
  "data": {
    "attendance_record": { "record_date": "2025-06-01", "attendance_status": "present", ... },
    "cosec_daily_agg": { "work_date": "2025-06-01", "work_minutes": 480, ... },
    "raw_punches": [
      { "punch_time": "2025-06-01T09:02:00", "io_type": "I", "io_label": "In", "device_id": "1" }
    ]
  }
}
```

If `cosec_daily_agg` or `raw_punches` is empty — that is fine, it means that data doesn't exist yet in the DB. The attendance_record should return data.

- [ ] **Step 5: Commit**

```bash
cd C:\Users\shivamg\HRMS1
git add backend/src/modules/wfm/wfm.routes.ts
git commit -m "feat(wfm): add attendance day-detail endpoint with COSEC punch timeline"
```

---

## Task 2: COSEC Sync Stats Endpoint

**What it does:** Returns aggregate statistics about the COSEC biometric sync — total biometric log count, latest record date, total attendance records processed, unmapped user count, and all sync watermarks. Used by the WFM admin screen to monitor sync health.

**Files:**
- Modify: `backend/src/modules/wfm/cosec-sync.routes.ts`

- [ ] **Step 1: Open cosec-sync.routes.ts and locate the bottom**

Open `backend/src/modules/wfm/cosec-sync.routes.ts`. Scroll to the bottom, just before the export statement.

- [ ] **Step 2: Add the stats route**

Add this block just before the closing export:

```typescript
// GET /api/cosec-sync/stats
// Returns aggregate stats: biometric log counts, attendance record count, unmapped users, watermarks
cosecSyncRouter.get(
  "/stats",
  requireRole("admin", "hr", "wfm", "ceo"),
  h(async (_req: any, res: any) => {
    // Run 4 queries in parallel
    const [bioCountRows, attCountRows, unmappedCountRows, watermarkRows] = await Promise.all([
      db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total_bio_logs,
                MAX(attendance_date) AS latest_bio_date
           FROM biometric_attendance_log`
      ),
      db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total_attendance_records
           FROM attendance_daily_record`
      ),
      db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS unmapped_count
           FROM cosec_unmapped_users`
      ),
      db.execute<RowDataPacket[]>(
        `SELECT *
           FROM source_sync_watermark
          ORDER BY source_key ASC`
      ),
    ]);

    return res.json({
      success: true,
      data: {
        biometric_log: bioCountRows[0][0] ?? {},
        attendance_records: attCountRows[0][0] ?? {},
        unmapped_users: unmappedCountRows[0][0] ?? {},
        watermarks: watermarkRows[0],
      },
    });
  })
);
```

> **Note on tables:** `biometric_attendance_log`, `attendance_daily_record`, `cosec_unmapped_users`, and `source_sync_watermark` all exist in HRMS1's schema. If `cosec_unmapped_users` or `source_sync_watermark` return empty results it just means no data yet — the query will not error.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd C:\Users\shivamg\HRMS1\backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Test the endpoint**

```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:5055/api/cosec-sync/stats
```

Expected response shape:
```json
{
  "success": true,
  "data": {
    "biometric_log": { "total_bio_logs": 1240, "latest_bio_date": "2025-06-17" },
    "attendance_records": { "total_attendance_records": 5600 },
    "unmapped_users": { "unmapped_count": 3 },
    "watermarks": []
  }
}
```

- [ ] **Step 5: Commit**

```bash
cd C:\Users\shivamg\HRMS1
git add backend/src/modules/wfm/cosec-sync.routes.ts
git commit -m "feat(cosec): add /stats endpoint for sync aggregate monitoring"
```

---

## Task 3: Payroll NEFT Summary Endpoint

**What it does:** Returns a list of all approved/finalized employees in a payroll run with their bank account details and net salary — exactly what Finance needs to initiate bulk NEFT bank transfers. HRMS1 has a `/neft-export` endpoint that exports a file, but no JSON summary endpoint for the UI to display before export.

**Files:**
- Modify: `backend/src/modules/payroll/payroll.routes.ts`

- [ ] **Step 1: Open payroll.routes.ts and find the /runs section**

Open `backend/src/modules/payroll/payroll.routes.ts`. Search for `/runs/:id/neft-export` — the new endpoint goes right after it.

- [ ] **Step 2: Add the neft-summary route**

Add this block immediately after the `/runs/:id/neft-export` handler block:

```typescript
// GET /api/payroll/runs/:runId/neft-summary
// Returns bank details + net salary for all approved/finalized employees in a payroll run
router.get(
  "/runs/:runId/neft-summary",
  requireAuth,
  requireRole("admin", "hr", "finance", "payroll", "ceo"),
  h(async (req: any, res: any) => {
    const { runId } = req.params;

    // Verify the run exists
    const [runRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, run_month, status FROM salary_prep_run WHERE id = ? LIMIT 1`,
      [runId]
    );
    if (!runRows.length) {
      return res.status(404).json({ success: false, error: "Payroll run not found" });
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.employee_code,
              e.first_name,
              e.last_name,
              e.bank_account_number,
              e.bank_name,
              e.bank_ifsc_code AS ifsc_code,
              COALESCE(NULLIF(e.account_holder_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS account_holder_name,
              spl.net_salary
         FROM salary_prep_line spl
         JOIN employees e ON e.id = spl.employee_id
        WHERE spl.run_id = ?
          AND spl.status IN ('approved', 'finalized')
        ORDER BY e.employee_code ASC`,
      [runId]
    );

    return res.json({
      success: true,
      run: runRows[0],
      data: rows,
      meta: { count: rows.length, total_net: rows.reduce((sum: number, r: any) => sum + Number(r.net_salary ?? 0), 0) },
    });
  })
);
```

> **Note on column names:** HRMS1 employees table uses `bank_account_number`, `bank_name`, `bank_ifsc_code`, `account_holder_name`. If you get a column-not-found error, run `DESCRIBE employees;` in MySQL and use the correct column names. The `salary_prep_line` table has `run_id`, `employee_id`, `net_salary`, `status` — verify with `DESCRIBE salary_prep_line;` if needed.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd C:\Users\shivamg\HRMS1\backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Test the endpoint**

First get a valid runId from your DB:
```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:5055/api/payroll/runs
```

Then test the summary:
```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:5055/api/payroll/runs/<runId>/neft-summary
```

Expected response shape:
```json
{
  "success": true,
  "run": { "id": "abc123", "run_month": "2025-06-01", "status": "finalized" },
  "data": [
    {
      "employee_code": "MCN001",
      "first_name": "Priya",
      "last_name": "Sharma",
      "bank_account_number": "123456789",
      "bank_name": "HDFC Bank",
      "ifsc_code": "HDFC0001234",
      "account_holder_name": "Priya Sharma",
      "net_salary": "32500.00"
    }
  ],
  "meta": { "count": 42, "total_net": 1365000 }
}
```

- [ ] **Step 5: Commit**

```bash
cd C:\Users\shivamg\HRMS1
git add backend/src/modules/payroll/payroll.routes.ts
git commit -m "feat(payroll): add NEFT summary endpoint for bulk bank transfer prep"
```

---

## Self-Review

### Spec Coverage
- [x] `GET /api/wfm/attendance/day-detail/:employeeId/:date` — Task 1 ✓
- [x] `GET /api/cosec-sync/stats` — Task 2 ✓
- [x] `GET /api/payroll/runs/:runId/neft-summary` — Task 3 ✓

### Items intentionally excluded
- **masCallnetPayslipGeneratorV2** — Already exists in HRMS1 at `src/lib/masCallnetPayslipGeneratorV2.ts` and is used by `PayslipViewer.tsx` and `NativePayslipCenter.tsx`. No action needed.
- **version.ts** — Already exists in HRMS1 at `src/lib/version.ts`. No action needed.
- **PWA components** — OfflineFallback, PWAInstallBanner, CookieConsent, ScrollToTop all already exist in `src/components/layout/`. No action needed.
- **RM-change module** — HRMS1 already has a solid implementation in `backend/src/modules/employees/rm-change.routes.ts` with transactions, sensitive action logging, and both `reporting_manager_id`/`manager_id` updates. No action needed.
- **Python COSEC daemons** — Deployment concern, not a code gap. Copy `cosec_sync/` folder from `mas-hrms-backend` separately.
- **demoCreds.ts** — Already exists in HRMS1 at `src/lib/demoCreds.ts`. Not for production anyway.
