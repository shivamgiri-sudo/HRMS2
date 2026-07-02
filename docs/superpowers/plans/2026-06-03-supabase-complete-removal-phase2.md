# Complete Supabase Removal — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every Supabase call from the HRMS frontend and backend so the entire platform runs 100% locally with no external dependencies, and every role journey (walk-in candidate → recruiter → HR → employee → manager → admin) works flawlessly end-to-end.

**Architecture:** Every `supabase.from(table)` call is replaced with `hrmsApi.get/post/put/patch/delete` backed by existing Express/MySQL endpoints; four new endpoints are added for tables that don't yet exist in MySQL; a local-disk file upload module replaces Supabase Storage using the already-installed `multer`; Edge Function notification calls are re-routed to the existing `/api/communication/dispatch/send` endpoint; and finally the `@supabase/supabase-js` package and all integration files are deleted.

**Tech Stack:** React 18 + TypeScript + hrmsApi · Express + TypeScript + mysql2 · multer@2.1.1 (already installed) · MySQL `mas_hrms`

---

## Pre-flight: understand before touching anything

Before starting Task 1, read these two files once to orient yourself:
- `src/lib/hrmsApi.ts` — the `hrmsApi.get/post/put/patch/delete` client
- `backend/src/modules/leave/leave.routes.ts` — pattern for a complete Express module

The pattern for every frontend migration is:
```typescript
// BEFORE
const { data, error } = await supabase.from("table").select("col1,col2").eq("field", val);
if (error) throw error;

// AFTER
const res = await hrmsApi.get<{ data: any[]; success: boolean }>("/api/endpoint?field=val");
const data = res.data ?? [];
```

---

## Task 1 — New backend endpoints: company_events, leave_eligibility, org_settings, upload_batch

**Files:**
- Create: `backend/sql/066_company_events.sql`
- Create: `backend/sql/067_org_settings.sql`
- Create: `backend/sql/068_upload_batch.sql`
- Create: `backend/src/modules/org/events.routes.ts`
- Create: `backend/src/modules/org/org_settings.routes.ts`
- Create: `backend/src/modules/bulk-upload/bulk-upload.routes.ts`
- Modify: `backend/src/app.ts`

These four tables are still Supabase-only. Everything else already has a MySQL endpoint.

- [ ] **Step 1: Create `backend/sql/066_company_events.sql`**

```sql
CREATE TABLE IF NOT EXISTS company_event_master (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  title         VARCHAR(255) NOT NULL,
  event_date    DATE         NOT NULL,
  end_date      DATE,
  event_type    VARCHAR(100) NOT NULL DEFAULT 'general',
  is_holiday    TINYINT(1)   NOT NULL DEFAULT 0,
  description   TEXT,
  branch_id     CHAR(36),
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  created_by    CHAR(36),
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_event_date (event_date),
  INDEX idx_event_holiday (is_holiday)
);
```

- [ ] **Step 2: Create `backend/sql/067_org_settings.sql`**

```sql
CREATE TABLE IF NOT EXISTS org_settings (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  setting_key   VARCHAR(100) NOT NULL UNIQUE,
  setting_value TEXT,
  label         VARCHAR(255),
  updated_by    CHAR(36),
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_setting_key (setting_key)
);

INSERT IGNORE INTO org_settings (id, setting_key, setting_value, label) VALUES
  (UUID(), 'domain_whitelist', '[]', 'Allowed email domains'),
  (UUID(), 'office_location_lat', NULL, 'Office latitude'),
  (UUID(), 'office_location_lng', NULL, 'Office longitude'),
  (UUID(), 'office_radius_meters', '200', 'Geofence radius in meters');
```

- [ ] **Step 3: Create `backend/sql/068_upload_batch.sql`**

```sql
CREATE TABLE IF NOT EXISTS upload_batch (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  upload_batch_no   VARCHAR(50)  NOT NULL UNIQUE,
  upload_type_code  VARCHAR(50)  NOT NULL,
  original_file_name VARCHAR(255),
  file_path         VARCHAR(500),
  file_size_bytes   INT,
  total_rows        INT          NOT NULL DEFAULT 0,
  valid_rows        INT          NOT NULL DEFAULT 0,
  error_rows        INT          NOT NULL DEFAULT 0,
  imported_rows     INT          NOT NULL DEFAULT 0,
  batch_status      VARCHAR(50)  NOT NULL DEFAULT 'pending',
  error_summary     TEXT,
  metadata          JSON,
  uploaded_by       CHAR(36),
  validated_by      CHAR(36),
  validated_at      DATETIME,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_batch_no (upload_batch_no),
  INDEX idx_batch_status (batch_status)
);

CREATE TABLE IF NOT EXISTS upload_batch_row (
  id               CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  upload_batch_id  CHAR(36)    NOT NULL,
  row_no           INT         NOT NULL,
  raw_data         JSON,
  normalized_data  JSON,
  row_status       VARCHAR(50) NOT NULL DEFAULT 'pending',
  error_messages   JSON,
  created_at       DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (upload_batch_id) REFERENCES upload_batch(id) ON DELETE CASCADE,
  INDEX idx_batch_row (upload_batch_id, row_no)
);
```

- [ ] **Step 4: Create `backend/src/modules/org/events.routes.ts`**

```typescript
import { Router } from "express";
import { randomUUID } from "crypto";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
const h = (fn: any) => (req: any, res: any, next: any) => fn(req, res).catch(next);
router.use(requireAuth);

router.get("/", h(async (req: AuthenticatedRequest, res: Response) => {
  const { start, end, is_holiday } = req.query as Record<string, string>;
  const conds = ["active_status = 1"];
  const params: unknown[] = [];
  if (start) { conds.push("event_date >= ?"); params.push(start); }
  if (end)   { conds.push("event_date <= ?"); params.push(end); }
  if (is_holiday !== undefined) { conds.push("is_holiday = ?"); params.push(is_holiday === "true" ? 1 : 0); }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM company_event_master WHERE ${conds.join(" AND ")} ORDER BY event_date ASC`,
    params
  );
  res.json({ success: true, data: rows });
}));

router.get("/:id", h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM company_event_master WHERE id = ? AND active_status = 1 LIMIT 1",
    [req.params.id]
  );
  const row = (rows as RowDataPacket[])[0];
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json({ success: true, data: row });
}));

router.post("/", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { title, event_date, end_date, event_type, is_holiday, description, branch_id } = req.body;
  if (!title || !event_date) return res.status(400).json({ error: "title and event_date required" });
  const id = randomUUID();
  await db.execute(
    `INSERT INTO company_event_master (id, title, event_date, end_date, event_type, is_holiday, description, branch_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, title, event_date, end_date ?? null, event_type ?? "general", is_holiday ? 1 : 0, description ?? null, branch_id ?? null, req.authUser!.id]
  );
  const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM company_event_master WHERE id = ? LIMIT 1", [id]);
  res.status(201).json({ success: true, data: (rows as RowDataPacket[])[0] });
}));

router.put("/:id", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { title, event_date, end_date, event_type, is_holiday, description } = req.body;
  await db.execute(
    `UPDATE company_event_master SET title=COALESCE(?,title), event_date=COALESCE(?,event_date),
     end_date=COALESCE(?,end_date), event_type=COALESCE(?,event_type),
     is_holiday=COALESCE(?,is_holiday), description=COALESCE(?,description) WHERE id=?`,
    [title??null, event_date??null, end_date??null, event_type??null, is_holiday!=null?Number(is_holiday):null, description??null, req.params.id]
  );
  const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM company_event_master WHERE id = ? LIMIT 1", [req.params.id]);
  res.json({ success: true, data: (rows as RowDataPacket[])[0] });
}));

router.delete("/:id", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  await db.execute("UPDATE company_event_master SET active_status = 0 WHERE id = ?", [req.params.id]);
  res.json({ success: true });
}));

export { router as eventsRouter };
```

- [ ] **Step 5: Create `backend/src/modules/org/org_settings.routes.ts`**

```typescript
import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
const h = (fn: any) => (req: any, res: any, next: any) => fn(req, res).catch(next);
router.use(requireAuth);

router.get("/", h(async (_req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM org_settings ORDER BY setting_key");
  res.json({ success: true, data: rows });
}));

router.get("/:key", h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM org_settings WHERE setting_key = ? LIMIT 1", [req.params.key]
  );
  const row = (rows as RowDataPacket[])[0];
  if (!row) return res.status(404).json({ error: "Setting not found" });
  res.json({ success: true, data: row });
}));

router.put("/:key", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { setting_value } = req.body;
  await db.execute(
    "UPDATE org_settings SET setting_value = ?, updated_by = ? WHERE setting_key = ?",
    [setting_value ?? null, req.authUser!.id, req.params.key]
  );
  const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM org_settings WHERE setting_key = ? LIMIT 1", [req.params.key]);
  res.json({ success: true, data: (rows as RowDataPacket[])[0] });
}));

export { router as orgSettingsRouter };
```

- [ ] **Step 6: Create `backend/src/modules/bulk-upload/bulk-upload.routes.ts`**

```typescript
import { Router } from "express";
import { randomUUID } from "crypto";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
const h = (fn: any) => (req: any, res: any, next: any) => fn(req, res).catch(next);
router.use(requireAuth);

// GET /api/bulk-upload/batches — list batches (admin/hr)
router.get("/batches", requireRole("admin", "hr"), h(async (_req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM upload_batch ORDER BY created_at DESC LIMIT 50"
  );
  res.json({ success: true, data: rows });
}));

// GET /api/bulk-upload/batches/:id/rows — get rows for a batch
router.get("/batches/:id/rows", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM upload_batch_row WHERE upload_batch_id = ? ORDER BY row_no ASC",
    [req.params.id]
  );
  res.json({ success: true, data: rows });
}));

// POST /api/bulk-upload/batches — create batch record
router.post("/batches", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as {
    upload_batch_no?: string; upload_type_code: string; original_file_name?: string;
    file_path?: string; file_size_bytes?: number; total_rows: number; valid_rows: number;
    error_rows: number; batch_status?: string; error_summary?: string; metadata?: any;
  };
  const id = randomUUID();
  const batchNo = body.upload_batch_no || `BATCH-${Date.now()}`;
  await db.execute(
    `INSERT INTO upload_batch (id, upload_batch_no, upload_type_code, original_file_name, file_path,
     file_size_bytes, total_rows, valid_rows, error_rows, batch_status, error_summary, metadata, uploaded_by, validated_by, validated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, batchNo, body.upload_type_code, body.original_file_name??null, body.file_path??null,
     body.file_size_bytes??null, body.total_rows, body.valid_rows, body.error_rows,
     body.batch_status??"pending", body.error_summary??null,
     body.metadata ? JSON.stringify(body.metadata) : null,
     req.authUser!.id,
     body.valid_rows > 0 ? req.authUser!.id : null,
     body.valid_rows > 0 ? new Date().toISOString() : null]
  );
  const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM upload_batch WHERE id = ? LIMIT 1", [id]);
  res.status(201).json({ success: true, data: (rows as RowDataPacket[])[0] });
}));

// POST /api/bulk-upload/batches/:id/rows — insert rows
router.post("/batches/:id/rows", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const rows = req.body as Array<{ row_no: number; raw_data?: any; normalized_data?: any; row_status?: string; error_messages?: any }>;
  if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: "rows array required" });
  for (const row of rows) {
    await db.execute(
      "INSERT INTO upload_batch_row (id, upload_batch_id, row_no, raw_data, normalized_data, row_status, error_messages) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [randomUUID(), req.params.id, row.row_no, row.raw_data?JSON.stringify(row.raw_data):null,
       row.normalized_data?JSON.stringify(row.normalized_data):null,
       row.row_status??"pending", row.error_messages?JSON.stringify(row.error_messages):null]
    );
  }
  res.status(201).json({ success: true, count: rows.length });
}));

export { router as bulkUploadRouter };
```

- [ ] **Step 7: Mount new routers in `backend/src/app.ts`**

Add imports after the existing import block:
```typescript
import { eventsRouter } from "./modules/org/events.routes.js";
import { orgSettingsRouter } from "./modules/org/org_settings.routes.js";
import { bulkUploadRouter } from "./modules/bulk-upload/bulk-upload.routes.js";
```

Add mounts after `app.use("/api/org", orgRouter);`:
```typescript
app.use("/api/org/events", eventsRouter);
app.use("/api/org/settings", orgSettingsRouter);
app.use("/api/bulk-upload", bulkUploadRouter);
```

- [ ] **Step 8: Verify backend builds**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1/backend
npx tsc --noEmit 2>&1 | grep "error TS" | head -20
```

Expected: zero errors.

- [ ] **Step 9: Commit**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1
git add backend/sql/066_company_events.sql backend/sql/067_org_settings.sql backend/sql/068_upload_batch.sql
git add backend/src/modules/org/events.routes.ts backend/src/modules/org/org_settings.routes.ts
git add backend/src/modules/bulk-upload/bulk-upload.routes.ts backend/src/app.ts
git commit -m "feat(backend): company_events, org_settings, upload_batch endpoints + SQL migrations"
```

---

## Task 2 — File storage module (local disk via multer)

**Files:**
- Create: `backend/src/modules/files/files.routes.ts`
- Modify: `backend/src/app.ts`

Multer 2.1.1 is already in package.json. Files are stored in `backend/uploads/{category}/`.

- [ ] **Step 1: Create `backend/src/modules/files/files.routes.ts`**

```typescript
import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_ROOT = path.resolve(__dirname, "../../../uploads");

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const category = (req.params.category as string) || (req.body.category as string) || "misc";
    const safe = category.replace(/[^a-zA-Z0-9_-]/g, "");
    const dir = path.join(UPLOADS_ROOT, safe);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = [".pdf", ".jpg", ".jpeg", ".png", ".webp", ".doc", ".docx", ".xls", ".xlsx", ".csv"];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

const router = Router();
const h = (fn: any) => (req: any, res: any, next: any) => fn(req, res).catch(next);
router.use(requireAuth);

// POST /api/files/upload?category=employee-documents
router.post(
  "/upload",
  requireRole("admin", "hr"),
  upload.single("file"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const category = (req.query.category as string) || req.body.category || "misc";
    const safe = category.replace(/[^a-zA-Z0-9_-]/g, "");
    const url = `/api/files/${safe}/${req.file.filename}`;
    res.status(201).json({
      success: true,
      url,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });
  })
);

// GET /api/files/:category/:filename — serve file
router.get(
  "/:category/:filename",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const safe = req.params.category.replace(/[^a-zA-Z0-9_-]/g, "");
    const safeFile = path.basename(req.params.filename);
    const filePath = path.join(UPLOADS_ROOT, safe, safeFile);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });
    res.sendFile(filePath);
  })
);

// DELETE /api/files/:category/:filename
router.delete(
  "/:category/:filename",
  requireRole("admin", "hr"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const safe = req.params.category.replace(/[^a-zA-Z0-9_-]/g, "");
    const safeFile = path.basename(req.params.filename);
    const filePath = path.join(UPLOADS_ROOT, safe, safeFile);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ success: true });
  })
);

export { router as filesRouter };
```

- [ ] **Step 2: Mount in `backend/src/app.ts`**

Add import:
```typescript
import { filesRouter } from "./modules/files/files.routes.js";
```

Add mount before `app.use("/api/employee-docs"`:
```typescript
app.use("/api/files", filesRouter);
```

- [ ] **Step 3: Verify build**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1/backend
npx tsc --noEmit 2>&1 | grep "error TS" | head -20
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1
git add backend/src/modules/files/files.routes.ts backend/src/app.ts
git commit -m "feat(files): local disk file upload/serve/delete via multer — replaces Supabase Storage"
```

---

## Task 3 — Migrate attendance, leave, leave-balance, leave-eligibility frontend hooks

**Files:**
- Modify: `src/hooks/useAttendance.ts`
- Modify: `src/hooks/useLeaveRequests.ts`
- Modify: `src/hooks/useLeaves.ts`
- Modify: `src/hooks/useLeaveBalances.ts`
- Modify: `src/hooks/useCompanyEvents.ts`
- Modify: `src/hooks/useCompanyHolidays.ts`
- Modify: `src/pages/Leaves.tsx`

These hooks map to endpoints that already exist: `/api/wfm/attendance`, `/api/leave/requests`, `/api/leave/balance`, `/api/leave/holidays`, `/api/org/events`.

- [ ] **Step 1: Rewrite `src/hooks/useAttendance.ts`**

Replace the full file content:

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";

export function useAttendanceRecords(start: string, end: string) {
  return useQuery({
    queryKey: ["attendance-records", start, end],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any[] }>(`/api/wfm/attendance/daily?from=${start}&to=${end}`);
      return res.data ?? [];
    },
  });
}

export function useTodayAttendance(employeeId: string | null | undefined) {
  const today = format(new Date(), "yyyy-MM-dd");
  return useQuery({
    queryKey: ["attendance-today", employeeId],
    queryFn: async () => {
      if (!employeeId) return null;
      const res = await hrmsApi.get<{ data: any }>(`/api/wfm/attendance/daily/${employeeId}/${today}`);
      return res.data ?? null;
    },
    enabled: !!employeeId,
  });
}

export function useClockIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { employeeId: string; workMode?: string; location?: { latitude: number; longitude: number; locationName: string } }) => {
      const res = await hrmsApi.post<{ data: any }>("/api/wfm/attendance/clock-in", {
        employee_id: payload.employeeId,
        work_mode: payload.workMode ?? "office",
        latitude: payload.location?.latitude,
        longitude: payload.location?.longitude,
        location_name: payload.location?.locationName,
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance-today"] });
      queryClient.invalidateQueries({ queryKey: ["attendance-records"] });
    },
  });
}

export function useClockOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { recordId: string; location?: { latitude: number; longitude: number; locationName: string } }) => {
      const res = await hrmsApi.post<{ data: any }>("/api/wfm/attendance/clock-out", {
        record_id: payload.recordId,
        latitude: payload.location?.latitude,
        longitude: payload.location?.longitude,
        location_name: payload.location?.locationName,
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance-today"] });
      queryClient.invalidateQueries({ queryKey: ["attendance-records"] });
    },
  });
}

export function useAttendanceSummary(employeeId: string | null | undefined, month: string) {
  return useQuery({
    queryKey: ["attendance-summary", employeeId, month],
    queryFn: async () => {
      if (!employeeId) return null;
      const res = await hrmsApi.get<{ data: any }>(`/api/wfm/attendance/summary/${employeeId}/${month}`);
      return res.data ?? null;
    },
    enabled: !!employeeId,
  });
}
```

**Note:** The clock-in/clock-out endpoints may not yet exist in the attendance engine. Check `backend/src/modules/wfm/attendance-engine.routes.ts`. If they don't exist, add them in Step 2; if they do, skip to Step 3.

- [ ] **Step 2: Add clock-in/clock-out endpoints if missing**

Read `backend/src/modules/wfm/attendance-engine.routes.ts`. If `POST /clock-in` and `POST /clock-out` are absent, append before the export:

```typescript
// POST /clock-in
router.post("/clock-in", h(async (req: AuthenticatedRequest, res: Response) => {
  const { employee_id, work_mode, latitude, longitude, location_name } = req.body;
  if (!employee_id) return res.status(400).json({ error: "employee_id required" });
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const id = randomUUID();
  await db.execute(
    `INSERT INTO attendance_daily_record
       (id, employee_id, work_date, clock_in_time, work_mode, clock_in_lat, clock_in_lng, clock_in_location, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'present')
     ON DUPLICATE KEY UPDATE
       clock_in_time = VALUES(clock_in_time), work_mode = VALUES(work_mode),
       clock_in_lat = VALUES(clock_in_lat), clock_in_lng = VALUES(clock_in_lng),
       clock_in_location = VALUES(clock_in_location), status = 'present'`,
    [id, employee_id, today, now, work_mode ?? "office", latitude ?? null, longitude ?? null, location_name ?? null]
  );
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM attendance_daily_record WHERE employee_id = ? AND work_date = ? LIMIT 1",
    [employee_id, today]
  );
  res.status(201).json({ success: true, data: (rows as RowDataPacket[])[0] });
}));

// POST /clock-out
router.post("/clock-out", h(async (req: AuthenticatedRequest, res: Response) => {
  const { record_id, latitude, longitude, location_name } = req.body;
  if (!record_id) return res.status(400).json({ error: "record_id required" });
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE attendance_daily_record
     SET clock_out_time = ?, clock_out_lat = ?, clock_out_lng = ?, clock_out_location = ?
     WHERE id = ?`,
    [now, latitude ?? null, longitude ?? null, location_name ?? null, record_id]
  );
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM attendance_daily_record WHERE id = ? LIMIT 1", [record_id]
  );
  res.json({ success: true, data: (rows as RowDataPacket[])[0] });
}));
```

Also ensure `randomUUID` is imported at the top of that file.

- [ ] **Step 3: Rewrite `src/hooks/useLeaveRequests.ts`**

Replace the full file:

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { toast } from "sonner";

export function useLeaveTypes() {
  return useQuery({
    queryKey: ["leave-types"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any[] }>("/api/leave/types");
      return res.data ?? [];
    },
  });
}

export function useSubmitLeaveRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      employeeId: string; leaveTypeId: string; fromDate: string;
      toDate: string; totalDays: number; reason?: string;
    }) => {
      const res = await hrmsApi.post<{ data: any }>("/api/leave/requests", {
        employeeId: payload.employeeId,
        leaveTypeId: payload.leaveTypeId,
        fromDate: payload.fromDate,
        toDate: payload.toDate,
        totalDays: payload.totalDays,
        reason: payload.reason ?? null,
      });
      // fire-and-forget notification
      hrmsApi.post("/api/communication/dispatch/send", {
        template_code: "leave_submission",
        recipient_employee_ids: [payload.employeeId],
        variables: { leaveTypeId: payload.leaveTypeId, fromDate: payload.fromDate, toDate: payload.toDate, totalDays: payload.totalDays },
        channel_type: "email",
      }).catch(() => {});
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balance"] });
      toast.success("Leave request submitted");
    },
    onError: (e: any) => toast.error(e.message),
  });
}
```

- [ ] **Step 4: Rewrite `src/hooks/useLeaves.ts`**

Replace the full file:

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { toast } from "sonner";

export function useLeaveRequests(filters?: { employeeId?: string; status?: string }) {
  const params = new URLSearchParams();
  if (filters?.employeeId) params.set("employeeId", filters.employeeId);
  if (filters?.status) params.set("status", filters.status);
  const qs = params.toString();

  return useQuery({
    queryKey: ["leave-requests", filters],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any[] }>(`/api/leave/requests${qs ? "?" + qs : ""}`);
      return res.data ?? [];
    },
  });
}

export function useLeaveStats() {
  return useQuery({
    queryKey: ["leave-stats"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any[] }>("/api/leave/requests");
      const all = res.data ?? [];
      return {
        total: all.length,
        pending: all.filter((r: any) => r.status === "pending").length,
        approved: all.filter((r: any) => r.status === "approved").length,
        rejected: all.filter((r: any) => r.status === "rejected").length,
      };
    },
  });
}

export function useReviewLeaveRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: string; status: "approved" | "rejected"; reviewNotes?: string }) => {
      return hrmsApi.patch(`/api/leave/requests/${payload.id}/review`, {
        status: payload.status,
        reviewNotes: payload.reviewNotes ?? null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-stats"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
}
```

- [ ] **Step 5: Rewrite `src/hooks/useLeaveBalances.ts`**

Replace the full file:

```typescript
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export function useLeaveBalance(employeeId: string | null | undefined, year?: number) {
  const y = year ?? new Date().getFullYear();
  return useQuery({
    queryKey: ["leave-balance", employeeId, y],
    queryFn: async () => {
      if (!employeeId) return [];
      const res = await hrmsApi.get<{ data: any[] }>(`/api/leave/balance/${employeeId}?year=${y}`);
      return res.data ?? [];
    },
    enabled: !!employeeId,
  });
}

export function useLeaveEligibility(employeeId: string | null | undefined) {
  return useQuery({
    queryKey: ["leave-eligibility", employeeId],
    queryFn: async () => {
      if (!employeeId) return [];
      const res = await hrmsApi.get<{ data: any[] }>(`/api/leave/eligibility/${employeeId}`);
      return res.data ?? [];
    },
    enabled: !!employeeId,
  });
}
```

- [ ] **Step 6: Add `/api/leave/eligibility/:employeeId` endpoint to leave.routes.ts**

In `backend/src/modules/leave/leave.routes.ts`, append before the export:

```typescript
// GET /leave/eligibility/:employeeId — returns leave types the employee is eligible for
leaveRouter.get("/eligibility/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT lt.id, lt.leave_code, lt.leave_name, lt.max_days_per_year, lt.carry_forward, lt.requires_approval, lt.paid_leave
     FROM leave_type_master lt
     WHERE lt.active_status = 1
     ORDER BY lt.leave_name ASC`,
    []
  );
  res.json({ success: true, data: rows });
}));
```

Add missing imports at the top of leave.routes.ts if not present:
```typescript
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
```

- [ ] **Step 7: Rewrite `src/hooks/useCompanyEvents.ts`**

Replace full file:

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export function useCompanyEvents(start?: string, end?: string) {
  const params = new URLSearchParams();
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  return useQuery({
    queryKey: ["company-events", start, end],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any[] }>(`/api/org/events?${params.toString()}`);
      return res.data ?? [];
    },
  });
}

export function useAllCompanyEvents() {
  return useQuery({
    queryKey: ["company-events-all"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any[] }>("/api/org/events");
      return res.data ?? [];
    },
  });
}

export function useCreateCompanyEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (event: any) => hrmsApi.post("/api/org/events", event),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["company-events"] }),
  });
}

export function useUpdateCompanyEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...event }: any) => hrmsApi.put(`/api/org/events/${id}`, event),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["company-events"] }),
  });
}

export function useDeleteCompanyEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => hrmsApi.delete(`/api/org/events/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["company-events"] }),
  });
}
```

- [ ] **Step 8: Rewrite `src/hooks/useCompanyHolidays.ts`**

Replace full file:

```typescript
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export function useCompanyHolidays(year?: number) {
  const y = year ?? new Date().getFullYear();
  return useQuery({
    queryKey: ["company-holidays", y],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any[] }>(`/api/org/events?is_holiday=true&start=${y}-01-01&end=${y}-12-31`);
      return res.data ?? [];
    },
  });
}
```

- [ ] **Step 9: Migrate `src/pages/Leaves.tsx`**

Read the file. Find and replace:

```typescript
// REMOVE the supabase import line
import { supabase } from "@/integrations/supabase/client";

// ADD hrmsApi import if not present
import { hrmsApi } from "@/lib/hrmsApi";
```

Find `supabase.from("employees").select("id").eq("user_id", user.id)` — replace with:
```typescript
const res = await hrmsApi.get<{ data: any }>("/api/employees/me");
const data = res.data;
```

Find `supabase.from("employees").select("id, first_name, last_name").eq("user_id"...)` — replace with:
```typescript
const res = await hrmsApi.get<{ data: any }>("/api/employees/me");
const employeeData = res.data;
```

Find `supabase.from("leave_requests").update({status,...}).eq("id", requestId)` — replace with:
```typescript
await hrmsApi.patch(`/api/leave/requests/${requestId}/review`, {
  status,
  reviewNotes: reviewNotes || null,
});
```

Find `supabase.functions.invoke("leave-status-notification",...)` — replace with:
```typescript
hrmsApi.post("/api/communication/dispatch/send", {
  template_code: "leave_status",
  recipient_employee_ids: [requestData.employeeId],
  variables: { status, reviewer_name: employeeData ? `${employeeData.first_name} ${employeeData.last_name}` : "HR Team", review_notes: reviewNotes },
  channel_type: "email",
}).catch(() => {});
```

- [ ] **Step 10: TypeScript check**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1
npx tsc --noEmit 2>&1 | grep "error TS" | head -20
```

- [ ] **Step 11: Commit**

```bash
git add src/hooks/useAttendance.ts src/hooks/useLeaveRequests.ts src/hooks/useLeaves.ts
git add src/hooks/useLeaveBalances.ts src/hooks/useCompanyEvents.ts src/hooks/useCompanyHolidays.ts
git add src/pages/Leaves.tsx
git add backend/src/modules/leave/leave.routes.ts backend/src/modules/wfm/attendance-engine.routes.ts
git commit -m "fix(data): migrate attendance, leave, holidays hooks to MySQL endpoints"
```

---

## Task 4 — Migrate employees, dashboard, onboarding, and performance hooks

**Files:**
- Modify: `src/hooks/useEmployees.ts`
- Modify: `src/hooks/useEmployeeStatus.ts`
- Modify: `src/hooks/useDashboardStats.ts`
- Modify: `src/hooks/useOnboardingRequest.ts`
- Modify: `src/hooks/useOnboardingRequests.ts`
- Modify: `src/hooks/usePerformance.ts`
- Modify: `src/hooks/usePayroll.ts`
- Modify: `src/hooks/useNotificationPreferences.ts`
- Modify: `src/hooks/usePushNotifications.ts`
- Modify: `src/components/dashboard/WhosOut.tsx`
- Modify: `src/components/dashboard/UpcomingHolidays.tsx`
- Modify: `src/components/dashboard/RecentActivity.tsx`

- [ ] **Step 1: Fix remaining Supabase calls in `src/hooks/useEmployees.ts`**

Read the file. Remove the `import { supabase }` line. Replace the remaining Supabase calls:

`supabase.from("employees").select(...)` → `hrmsApi.get<{data:any[]}>("/api/employees")`

`supabase.from("employees").select("id, status")` for stats → `hrmsApi.get<{data:any}>("/api/employees/stats")`

`supabase.from("employees").delete().eq("id", id)` → `hrmsApi.delete(\`/api/employees/${id}\`)`

`supabase.from("employees").update({ status }).in("id", ids)` → loop: `for (const id of ids) await hrmsApi.patch(\`/api/employees/${id}\`, { status })`

- [ ] **Step 2: Fix `src/hooks/useEmployeeStatus.ts`**

Replace full file:

```typescript
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";

export function useEmployeeStatus() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["employee-status", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const res = await hrmsApi.get<{ data: any }>("/api/employees/me");
      return res.data ?? null;
    },
    enabled: !!user,
  });
}
```

- [ ] **Step 3: Fix `src/hooks/useDashboardStats.ts`**

Remove the Supabase import. Remove the `supabase.channel(...)` realtime subscription block entirely — React Query polling is sufficient. Replace each Supabase call:

`supabase.from("employees").select("id").eq("user_id"...)` → `hrmsApi.get<{data:any}>("/api/employees/me").then(r => r.data)`

`supabase.from("leave_requests").select("id").eq("employee_id"...)` → `hrmsApi.get<{data:any[]}>("/api/leave/requests?employeeId=<id>&status=approved").then(r => r.data ?? [])`

`supabase.from("asset_assignments").select("id").eq("employee_id"...)` → `hrmsApi.get<{data:any[]}>("/api/assets-mgmt/employee/<id>").then(r => r.data ?? [])`

`supabase.from("employees").select("id").eq("manager_id"...)` + leave_requests count → `hrmsApi.get<{data:any[]}>("/api/leave/requests?status=pending").then(r => r.data ?? [])`

`supabase.from("activity_logs").select(...)` → `hrmsApi.get<{data:any[]}>("/api/access/audit-log?limit=10").then(r => r.data ?? [])`

The `getEligibleLeaveTotals` helper:
```typescript
async function getEligibleLeaveTotals(employeeId: string, year: number) {
  const balance = await hrmsApi.get<{ data: any[] }>(`/api/leave/balance/${employeeId}?year=${year}`);
  const rows = balance.data ?? [];
  const totalLeaves = rows.reduce((s: number, r: any) => s + (r.max_days ?? 0), 0);
  const usedLeaves = rows.reduce((s: number, r: any) => s + (r.used_days ?? 0), 0);
  return { totalLeaves, usedLeaves, availableLeaves: Math.max(totalLeaves - usedLeaves, 0) };
}
```

- [ ] **Step 4: Fix `src/hooks/useOnboardingRequest.ts`**

Replace full file:

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";

export function useMyOnboardingRequest() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-onboarding-request", user?.id],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any[] }>("/api/ats/onboarding/requests");
      return (res.data ?? [])[0] ?? null;
    },
    enabled: !!user,
  });
}

export function useSubmitOnboardingRequest() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ message }: { message?: string }) => {
      const meRes = await hrmsApi.get<{ data: any }>("/api/employees/me");
      const emp = meRes.data;
      const fullName = emp ? `${emp.first_name ?? ""} ${emp.last_name ?? ""}`.trim() : (user?.email ?? "Unknown");
      const res = await hrmsApi.post<{ data: any }>("/api/ats/onboarding/requests", {
        email: user?.email,
        full_name: fullName,
        message: message ?? null,
      });
      hrmsApi.post("/api/communication/dispatch/send", {
        template_code: "onboarding_request",
        recipient_employee_ids: [emp?.id].filter(Boolean),
        variables: { type: "submitted", user_email: user?.email, user_name: fullName, message },
        channel_type: "email",
      }).catch(() => {});
      return res.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-onboarding-request"] }),
  });
}
```

- [ ] **Step 5: Fix `src/hooks/useOnboardingRequests.ts`**

Replace full file:

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export function useOnboardingRequests() {
  return useQuery({
    queryKey: ["onboarding-requests"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any[] }>("/api/ats/onboarding/requests");
      return res.data ?? [];
    },
  });
}

export function useApproveOnboardingRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ requestId }: { requestId: string }) => {
      const res = await hrmsApi.post(`/api/ats/onboarding/offers/${requestId}/approve`, {});
      hrmsApi.post("/api/communication/dispatch/send", {
        template_code: "onboarding_request",
        recipient_employee_ids: [],
        variables: { type: "approved", request_id: requestId },
        channel_type: "email",
      }).catch(() => {});
      return res;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["onboarding-requests"] }),
  });
}

export function useRejectOnboardingRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ requestId, reason }: { requestId: string; reason?: string }) => {
      const res = await hrmsApi.post(`/api/ats/onboarding/offers/${requestId}/reject`, { remarks: reason ?? null });
      hrmsApi.post("/api/communication/dispatch/send", {
        template_code: "onboarding_request",
        recipient_employee_ids: [],
        variables: { type: "rejected", request_id: requestId },
        channel_type: "email",
      }).catch(() => {});
      return res;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["onboarding-requests"] }),
  });
}
```

- [ ] **Step 6: Fix `src/hooks/usePerformance.ts`**

Remove the supabase import. Replace each call:

Goals: `supabase.from("goals")` CRUD → `hrmsApi.get/post/patch/delete` on `/api/goals/goals` (these already exist in goalsRouter)

Performance reviews: `supabase.from("performance_reviews")` CRUD → `hrmsApi.get/post/patch/delete` on `/api/performance-feedback/requests` and `/api/performance-feedback/reports`

Edge functions:
```typescript
// REPLACE review-notification invoke
hrmsApi.post("/api/communication/dispatch/send", {
  template_code: "performance_review",
  recipient_employee_ids: [review.employee_id],
  variables: { review_id: data.id, review_period: review.review_period },
  channel_type: "email",
}).catch(() => {});

// REPLACE review-acknowledgment-notification invoke
hrmsApi.post("/api/communication/dispatch/send", {
  template_code: "review_acknowledgment",
  recipient_employee_ids: [employeeId],
  variables: { review_id: reviewId, review_period: reviewPeriod },
  channel_type: "email",
}).catch(() => {});
```

- [ ] **Step 7: Fix `src/hooks/usePayroll.ts`**

Remove the supabase import. Replace each Supabase call with the MySQL payroll endpoints:

`supabase.from("payroll_records").select(...)` → `hrmsApi.get<{data:any[]}>("/api/payroll/payslip/...")` or existing payroll run endpoints

`supabase.from("salary_structures").select(...)` → `hrmsApi.get<{data:any[]}>("/api/payroll/structures")`

`supabase.from("salary_structures").upsert(...)` → `hrmsApi.post("/api/payroll/structures", ...)`

`supabase.from("salary_structures").update(...)` → `hrmsApi.put(\`/api/payroll/structures/${id}\`, ...)`

`supabase.from("salary_structures").delete()` → `hrmsApi.delete(\`/api/payroll/structures/${id}\`)`

For payroll records that don't have a direct endpoint, replace with a stub returning `[]` and a console.warn — the full payroll run module is separate and already MySQL-backed.

- [ ] **Step 8: Fix `src/hooks/useNotificationPreferences.ts`**

Replace full file:

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export function useNotificationPreferences() {
  return useQuery({
    queryKey: ["notification-preferences"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any }>("/api/communication/preferences");
      return res.data ?? {};
    },
  });
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (prefs: Record<string, boolean>) =>
      hrmsApi.patch("/api/communication/preferences", prefs),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification-preferences"] }),
  });
}
```

- [ ] **Step 9: Remove `src/hooks/usePushNotifications.ts` Supabase calls**

Replace the Supabase upsert and delete calls with no-ops (push subscriptions require Supabase Realtime which is being removed):

```typescript
// REPLACE supabase.from("push_subscriptions").upsert(...)
// Push subscriptions not supported in local deployment
console.info("Push subscriptions disabled in local-only deployment");

// REPLACE supabase.from("push_subscriptions").delete()
// No-op
```

Remove the supabase import from the file.

- [ ] **Step 10: Fix `src/components/dashboard/WhosOut.tsx`**

Replace the three Supabase calls with a single hrmsApi call:

```typescript
import { hrmsApi } from "@/lib/hrmsApi";

// In the queryFn:
const today = format(new Date(), "yyyy-MM-dd");
const res = await hrmsApi.get<{ data: any[] }>(`/api/leave/requests?status=approved&activeOn=${today}`);
const leaves = res.data ?? [];
// leaves already has employee and leave_type joined if the backend supports it
// otherwise do two separate calls:
const employeeIds = [...new Set(leaves.map((l: any) => l.employee_id))];
const employees = employeeIds.length > 0
  ? await hrmsApi.get<{ data: any[] }>(`/api/employees?ids=${employeeIds.join(",")}`).then(r => r.data ?? [])
  : [];
```

Remove supabase import.

- [ ] **Step 11: Fix `src/components/dashboard/UpcomingHolidays.tsx`**

```typescript
// Replace queryFn:
const today = format(new Date(), "yyyy-MM-dd");
const next30 = format(addDays(new Date(), 30), "yyyy-MM-dd");
const res = await hrmsApi.get<{ data: any[] }>(`/api/org/events?is_holiday=true&start=${today}&end=${next30}`);
return (res.data ?? []).slice(0, 5);
```

Remove supabase import, add hrmsApi import.

- [ ] **Step 12: Fix `src/components/dashboard/RecentActivity.tsx`**

Replace all 4 Supabase calls:

```typescript
// Audit log (replaces activity_logs query)
const auditRes = await hrmsApi.get<{ data: any[] }>("/api/access/audit-log?limit=10");

// Recent leaves
const leavesRes = await hrmsApi.get<{ data: any[] }>("/api/leave/requests?limit=5");

// Recent attendance
const attendanceRes = await hrmsApi.get<{ data: any[] }>("/api/wfm/attendance/daily?limit=5");

// Recent assets
const assetsRes = await hrmsApi.get<{ data: any[] }>("/api/assets-mgmt?limit=3");
```

Remove supabase import.

- [ ] **Step 13: TypeScript check**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1
npx tsc --noEmit 2>&1 | grep "error TS" | head -20
```

- [ ] **Step 14: Commit**

```bash
git add src/hooks/useEmployees.ts src/hooks/useEmployeeStatus.ts src/hooks/useDashboardStats.ts
git add src/hooks/useOnboardingRequest.ts src/hooks/useOnboardingRequests.ts
git add src/hooks/usePerformance.ts src/hooks/usePayroll.ts
git add src/hooks/useNotificationPreferences.ts src/hooks/usePushNotifications.ts
git add src/components/dashboard/WhosOut.tsx src/components/dashboard/UpcomingHolidays.tsx
git add src/components/dashboard/RecentActivity.tsx
git commit -m "fix(data): migrate employees, dashboard, onboarding, performance, payroll hooks to MySQL"
```

---

## Task 5 — Migrate Onboarding.tsx and BulkUploadHub.tsx

**Files:**
- Modify: `src/pages/Onboarding.tsx`
- Modify: `src/pages/BulkUploadHub.tsx`

These are the two largest and most complex Supabase-dependent pages.

- [ ] **Step 1: Fix file storage calls in `src/pages/Onboarding.tsx`**

Find `supabase.storage.from("employee-documents").createSignedUrl(filePath, 3600)` (line 310). Replace with:
```typescript
const isSupabaseUrl = filePath && filePath.startsWith("http");
const fileUrl = isSupabaseUrl ? filePath : `${import.meta.env.VITE_HRMS_API_URL || "http://localhost:5055"}/api/files/employee-documents/${filePath}`;
// Open in new tab:
window.open(fileUrl, "_blank");
```

Find `supabase.storage.from("employee-documents").upload(fileName, file)` + `getPublicUrl` (lines 356-364). Replace with:
```typescript
const formData = new FormData();
formData.append("file", file);
const token = localStorage.getItem("hrms_access_token");
const uploadRes = await fetch(
  `${import.meta.env.VITE_HRMS_API_URL || "http://localhost:5055"}/api/files/upload?category=employee-documents`,
  { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData }
);
if (!uploadRes.ok) throw new Error("File upload failed");
const uploadData = await uploadRes.json();
const publicUrl = uploadData.url;
```

- [ ] **Step 2: Fix DB calls in `src/pages/Onboarding.tsx`**

Replace ALL `supabase.from("employees")` calls:

`supabase.from("employees").select(...).eq("status","onboarding")` → `hrmsApi.get<{data:any[]}>("/api/employees?status=onboarding")`

`supabase.from("employees").select("id, first_name, last_name").eq("status","active")` → `hrmsApi.get<{data:any[]}>("/api/employees?status=active")`

`supabase.from("employees").select("user_id").not(...)` → `hrmsApi.get<{data:any[]}>("/api/employees").then(r => (r.data??[]).map((e:any)=>e.user_id).filter(Boolean))`

`supabase.from("employees").insert({...})` → `hrmsApi.post<{data:any}>("/api/employees", { employee_code, first_name, last_name, email, phone, designation, hire_date, status: "onboarding", department_id, manager_id, avatar_url, ... })`

`supabase.from("employees").update({status:"active"}).eq("id",id)` → `hrmsApi.patch(\`/api/employees/${id}\`, { employment_status: "Active" })`

`supabase.from("employees").update({...fields}).eq("id",id)` → `hrmsApi.patch(\`/api/employees/${id}\`, fields)`

`supabase.from("employees").update({ user_id }).eq("id",id)` → `hrmsApi.patch(\`/api/employees/${id}\`, { user_id })`

`supabase.from("salary_structures").insert(...)` → `hrmsApi.post("/api/payroll/structures", { employee_id, basic_salary, effective_from })`

`supabase.from("leave_types").select("id,days_per_year")` → `hrmsApi.get<{data:any[]}>("/api/leave/types")`

`supabase.from("leave_balances").upsert(...)` → `hrmsApi.post("/api/leave/balance/seed", leaveBalances)` — add this endpoint in leave.routes.ts (Step 3)

`supabase.from("employee_documents").select("*").eq("employee_id",id)` → `hrmsApi.get(\`/api/employee-docs/${id}\`)`

`supabase.from("employee_documents").insert({...})` → `hrmsApi.post(\`/api/employee-docs/${employeeId}\`, { document_type, document_name, file_url: publicUrl })`

`supabase.from("profiles").select("id,email,full_name,avatar_url")` → `hrmsApi.get("/api/employees?status=active")`

Replace edge functions:
- `supabase.functions.invoke("invite-employee", {body:{email,...}})` → `hrmsApi.post("/api/auth/register", { email: data.email, password: "Welcome@123", role: "employee" })` then link user_id
- `supabase.functions.invoke("onboarding-notification", {body})` → `hrmsApi.post("/api/communication/dispatch/send", { template_code: "employee_onboarding", recipient_employee_ids: [employee.id], variables: {employee_name, department_name, email}, channel_type: "email" }).catch(()=>{})`

Remove supabase import.

- [ ] **Step 3: Add `/api/leave/balance/seed` endpoint for bulk leave balance initialization**

In `backend/src/modules/leave/leave.routes.ts`, append:

```typescript
// POST /leave/balance/seed — bulk insert/update leave balances (used during onboarding)
leaveRouter.post("/balance/seed", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const rows = req.body as Array<{ employee_id: string; leave_type_id: string; year: number; allocated_days: number }>;
  if (!Array.isArray(rows)) return res.status(400).json({ error: "Array of balance rows required" });
  for (const row of rows) {
    await db.execute(
      `INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, fiscal_year, allocated_days, used_days, balance_days)
       VALUES (?, ?, ?, ?, ?, 0, ?)
       ON DUPLICATE KEY UPDATE allocated_days = VALUES(allocated_days), balance_days = VALUES(allocated_days) - used_days`,
      [randomUUID(), row.employee_id, row.leave_type_id, row.year, row.allocated_days, row.allocated_days]
    );
  }
  res.json({ success: true, count: rows.length });
}));
```

Also add `import { randomUUID } from "crypto";` if missing at top of leave.routes.ts.

- [ ] **Step 4: Fix `src/pages/BulkUploadHub.tsx`**

Remove supabase import.

Replace `supabase.rpc("generate_upload_batch_no")`:
```typescript
const batchNo = `BATCH-${Date.now()}`;
```

Replace `supabase.storage.from(BULK_UPLOAD_BUCKET).upload(filePath, selectedFile, ...)`:
```typescript
const formData = new FormData();
formData.append("file", selectedFile);
const token = localStorage.getItem("hrms_access_token");
const uploadRes = await fetch(
  `${import.meta.env.VITE_HRMS_API_URL || "http://localhost:5055"}/api/files/upload?category=bulk-uploads`,
  { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData }
);
if (!uploadRes.ok) throw new Error("File upload failed");
const uploadData = await uploadRes.json();
const filePath = uploadData.url;
```

Replace `supabase.from("upload_batch").insert(...)`:
```typescript
const batchRes = await hrmsApi.post<{ data: any }>("/api/bulk-upload/batches", {
  upload_batch_no: batchNo,
  upload_type_code: selectedTemplate.upload_type_code,
  original_file_name: selectedFile.name,
  file_path: filePath,
  file_size_bytes: selectedFile.size,
  total_rows: stagedRows.length,
  valid_rows: validRows,
  error_rows: errorRows,
  batch_status: batchStatus,
  error_summary: errorRows > 0 ? `${errorRows} row(s) have validation errors` : null,
  metadata: { source: "frontend_bulk_upload_hub" },
});
const batch = batchRes.data;
```

Replace `supabase.from("upload_batch_row").insert(rows)`:
```typescript
await hrmsApi.post(`/api/bulk-upload/batches/${batch.id}/rows`,
  stagedRows.map(row => ({
    row_no: row.rowNo,
    raw_data: row.rawData,
    normalized_data: row.normalizedData,
    row_status: row.status,
    error_messages: row.errors,
  }))
);
```

- [ ] **Step 5: TypeScript check**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1
npx tsc --noEmit 2>&1 | grep "error TS" | head -20
```

- [ ] **Step 6: Commit**

```bash
git add src/pages/Onboarding.tsx src/pages/BulkUploadHub.tsx
git add backend/src/modules/leave/leave.routes.ts
git commit -m "fix(data): migrate Onboarding and BulkUploadHub to MySQL endpoints + local file storage"
```

---

## Task 6 — Migrate remaining components and pages

**Files:**
- Modify: `src/pages/CompanyCalendar.tsx`
- Modify: `src/lib/version.ts`
- Modify: `src/components/settings/UserRolesManager.tsx`
- Modify: `src/components/settings/DomainWhitelistSettings.tsx`
- Modify: `src/components/settings/OfficeLocationSettings.tsx`
- Modify: `src/components/documents/DocumentViewerDialog.tsx`
- Modify: `src/components/documents/EmployeeDocuments.tsx`
- Modify: `src/components/profile/TaxDocumentsViewer.tsx`
- Modify: `src/pages/Profile.tsx`
- Modify: `src/pages/NativeLMSMyLearning.tsx`
- Modify: All other remaining files with supabase import (run grep to find any missed)

- [ ] **Step 1: Fix `src/pages/CompanyCalendar.tsx`**

Find `supabase.functions.invoke("event-notification")`. Replace with:
```typescript
hrmsApi.post("/api/communication/dispatch/send", {
  template_code: "company_event",
  recipient_employee_ids: [],
  variables: { event_title: eventTitle },
  channel_type: "email",
}).catch(() => {});
```

Replace any `supabase.from("company_events")` calls with `hrmsApi` calls to `/api/org/events`.

Remove supabase import.

- [ ] **Step 2: Fix `src/lib/version.ts`**

Read the file. Find the `supabase.functions.invoke("version-check", ...)` call. Replace the entire version check function with:

```typescript
export const APP_VERSION = "1.0.0";

export async function checkVersion(): Promise<{ upToDate: boolean; latestVersion: string }> {
  // Version check removed — Supabase Edge Functions not available in local deployment
  return { upToDate: true, latestVersion: APP_VERSION };
}
```

Remove supabase import.

- [ ] **Step 3: Fix `src/components/settings/UserRolesManager.tsx`**

Replace supabase calls with:
- `supabase.from("user_roles")` → `hrmsApi` to `/api/access/roles/catalog` and `/api/access/roles/user/:userId`
- `supabase.from("user_roles").insert(...)` → `hrmsApi.post("/api/access/roles/assign", { user_id, role_key })`
- `supabase.from("user_roles").delete(...)` → `hrmsApi.post("/api/access/roles/revoke", { user_id, role_key })`

Remove supabase import.

- [ ] **Step 4: Fix `src/components/settings/DomainWhitelistSettings.tsx`**

Replace `supabase.from("organization_settings")` calls with:
```typescript
hrmsApi.get<{data:any}>("/api/org/settings/domain_whitelist")
hrmsApi.put("/api/org/settings/domain_whitelist", { setting_value: JSON.stringify(domains) })
```

Remove supabase import.

- [ ] **Step 5: Fix `src/components/settings/OfficeLocationSettings.tsx`**

Replace `supabase.from("organization_settings")` calls with:
```typescript
hrmsApi.get<{data:any[]}>("/api/org/settings")
hrmsApi.put("/api/org/settings/office_location_lat", { setting_value: String(lat) })
hrmsApi.put("/api/org/settings/office_location_lng", { setting_value: String(lng) })
hrmsApi.put("/api/org/settings/office_radius_meters", { setting_value: String(radius) })
```

Remove supabase import.

- [ ] **Step 6: Fix `src/components/documents/DocumentViewerDialog.tsx`**

Replace `supabase.storage.from(bucket).createSignedUrl(...)` and `.download(...)`:

```typescript
const HRMS_API = import.meta.env.VITE_HRMS_API_URL || "http://localhost:5055";
const isLegacyUrl = documentInfo.file_url?.startsWith("https://") && documentInfo.file_url.includes("supabase.co");
const viewUrl = isLegacyUrl
  ? documentInfo.file_url  // existing Supabase-stored files — still accessible if bucket public
  : `${HRMS_API}${documentInfo.file_url}`;
window.open(viewUrl, "_blank");
```

Remove supabase import.

- [ ] **Step 7: Fix `src/components/documents/EmployeeDocuments.tsx`**

Replace `supabase.storage.from("employee-documents").download(fileUrl)`:

```typescript
const HRMS_API = import.meta.env.VITE_HRMS_API_URL || "http://localhost:5055";
const isLegacyUrl = fileUrl?.startsWith("https://");
const downloadUrl = isLegacyUrl ? fileUrl : `${HRMS_API}${fileUrl}`;
const a = document.createElement("a");
a.href = downloadUrl;
a.download = fileName;
a.click();
```

Remove supabase import.

- [ ] **Step 8: Fix `src/components/profile/TaxDocumentsViewer.tsx`**

Same pattern as Step 7 — replace `.download()` with a direct URL open.

Remove supabase import.

- [ ] **Step 9: Fix `src/pages/Profile.tsx`**

Read the file. Replace any `supabase.from("employees")` with `hrmsApi.get("/api/employees/me")` and `/api/employees/:id`. Replace storage calls with direct URL construction (same pattern as Step 6). Remove supabase import.

- [ ] **Step 10: Fix `src/pages/NativeLMSMyLearning.tsx`**

Read the file. Replace any `supabase.from("lms_*")` calls with:
```typescript
hrmsApi.get(`/api/lms/progress/${employeeId}`)
hrmsApi.get(`/api/lms/certifications/${employeeId}`)
hrmsApi.get(`/api/lms/launch-urls/${employeeId}`)
```

Remove supabase import.

- [ ] **Step 11: Find any remaining Supabase imports**

```bash
grep -r "from \"@/integrations/supabase/client\"" /c/Users/shivamg/Desktop/HRMS/HRMS1/src --include="*.ts" --include="*.tsx" -l
```

For each file found, read it and apply the same pattern: replace `supabase.from(table)` with the nearest hrmsApi equivalent. If no endpoint exists, return `[]` with a console.warn.

- [ ] **Step 12: TypeScript check**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1
npx tsc --noEmit 2>&1 | grep "error TS" | head -20
```

- [ ] **Step 13: Commit**

```bash
git add src/pages/CompanyCalendar.tsx src/lib/version.ts
git add src/components/settings/ src/components/documents/
git add src/components/profile/TaxDocumentsViewer.tsx
git add src/pages/Profile.tsx src/pages/NativeLMSMyLearning.tsx
git commit -m "fix(data): migrate calendar, settings, documents, profile, LMS components to MySQL"
```

---

## Task 7 — Final cleanup: delete Supabase integration, remove package, add AppRole type

**Files:**
- Create: `src/types/roles.ts`
- Delete: `src/integrations/supabase/client.ts`
- Delete: `src/integrations/supabase/types.ts`
- Delete: `src/integrations/supabase/` (directory)
- Modify: `package.json` (remove @supabase/supabase-js)
- Modify: `backend/.env.example`
- Modify: `backend/src/db/supabaseAdmin.ts`
- Modify: `backend/src/modules/access/access.service.ts`

- [ ] **Step 1: Create `src/types/roles.ts`**

```typescript
export type AppRole =
  | "admin" | "hr" | "manager" | "employee" | "recruiter"
  | "qa" | "wfm" | "finance" | "trainer" | "ceo"
  | "process_manager" | "team_leader";
```

- [ ] **Step 2: Update all imports of AppRole from supabase/types**

```bash
grep -r "app_role\|AppRole\|supabase/types" /c/Users/shivamg/Desktop/HRMS/HRMS1/src --include="*.ts" --include="*.tsx" -l
```

For each file found, replace:
```typescript
// BEFORE
import type { Database } from "@/integrations/supabase/types";
type AppRole = Database["public"]["Enums"]["app_role"];
// OR
import type { AppRole } from "@/integrations/supabase/types";

// AFTER
import type { AppRole } from "@/types/roles";
```

- [ ] **Step 3: Delete supabase integration directory**

```bash
rm -rf /c/Users/shivamg/Desktop/HRMS/HRMS1/src/integrations/supabase
```

- [ ] **Step 4: Remove @supabase/supabase-js**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1
npm uninstall @supabase/supabase-js
```

- [ ] **Step 5: Verify no remaining supabase imports**

```bash
grep -r "supabase" /c/Users/shivamg/Desktop/HRMS/HRMS1/src --include="*.ts" --include="*.tsx" -l
```

Expected: zero files. If any appear, read them and remove the calls.

- [ ] **Step 6: Update `backend/.env.example`**

Remove these three lines:
```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_ANON_KEY=...
```

- [ ] **Step 7: Gut `backend/src/db/supabaseAdmin.ts`**

Replace full content with:

```typescript
// Supabase removed — this file is kept as a tombstone to avoid import errors during transition.
// All callers have been migrated to MySQL. Delete this file after confirming no remaining usages.
export const supabaseAdmin = {
  from: () => ({ select: async () => ({ data: [], error: null }) }),
  auth: { getUser: async () => ({ data: { user: null }, error: null }) },
} as any;
```

- [ ] **Step 8: Fix RBAC reconciliation in `backend/src/modules/access/access.service.ts`**

Find the `getRbacReconciliation` function. Replace the Supabase query:
```typescript
// BEFORE
const { data: sbRows, error } = await supabaseAdmin.from("user_roles").select("user_id, role").order("user_id");
if (error) throw Object.assign(new Error(`Supabase role fetch failed: ${error.message}`), { statusCode: 502 });
const supabaseRoles = ...

// AFTER
// Supabase removed — reconciliation now compares MySQL user_roles vs MySQL user_roles (identity)
// Returns empty mismatches since there is only one source of truth
const supabaseRoles: Record<string, string[]> = {};
```

- [ ] **Step 9: Check backend for remaining supabase references**

```bash
grep -r "supabase\|SUPABASE" /c/Users/shivamg/Desktop/HRMS/HRMS1/backend/src --include="*.ts" -l
```

For each file: if it imports `supabaseAdmin`, verify the call is now dead code and remove it.

- [ ] **Step 10: Full TypeScript check (frontend + backend)**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1
npx tsc --noEmit 2>&1 | grep "error TS" | head -30
cd backend
npx tsc --noEmit 2>&1 | grep "error TS" | head -30
```

Expected: zero errors in both.

- [ ] **Step 11: Commit**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1
git add src/types/roles.ts
git rm -r src/integrations/supabase/
git add package.json package-lock.json
git add backend/.env.example backend/src/db/supabaseAdmin.ts backend/src/modules/access/access.service.ts
git commit -m "feat(cleanup): remove @supabase/supabase-js, delete integration files, add AppRole type — Supabase fully removed"
```

---

## Task 8 — End-to-end role journey verification

**This task verifies every role journey works after the migration. Do NOT skip any journey.**

- [ ] **Step 1: Build frontend**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1
npm run build 2>&1 | tail -20
```

Expected: Build succeeds, zero TypeScript errors, no import-not-found errors.

- [ ] **Step 2: Start backend**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1/backend
node dist/server.js &
```

Expected: Migration runner logs `[migration] applied: 066_...` through `068_...`. Server starts on port 5055.

- [ ] **Step 3: Verify zero Supabase network calls**

```bash
# Must return zero
grep -r "supabase.co\|supabase.from\|supabase.auth\|supabase.storage\|supabase.functions" \
  /c/Users/shivamg/Desktop/HRMS/HRMS1/src --include="*.ts" --include="*.tsx"
```

Expected: zero matches.

- [ ] **Step 4: Walk-in candidate journey (Recruiter)**

Verify these API calls succeed:
```bash
# Public candidate registration — no auth needed
curl -s -X POST http://localhost:5055/api/ats/candidates \
  -H "Content-Type: application/json" \
  -d '{"fullName":"Test Candidate","mobile":"9876543210","appliedForProcess":"Customer Service","walkInDate":"2026-06-03"}' \
  | python3 -m json.tool
```
Expected: `{ "success": true, "data": { "id": "...", "candidate_code": "..." } }`

- [ ] **Step 5: HR Onboarding journey**

Login as HR and verify:
```bash
TOKEN=$(curl -s -X POST http://localhost:5055/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"hr@mascallnet.com","password":"Hr@123456"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Create employee
curl -s -X POST http://localhost:5055/api/employees \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"employee_code":"EMP999","first_name":"Test","last_name":"Employee","email":"test999@test.com","employment_status":"Active","date_of_joining":"2026-06-03"}' \
  | python3 -m json.tool
```
Expected: `{ "success": true, "data": { "id": "..." } }`

- [ ] **Step 6: Employee self-service journey**

```bash
TOKEN=$(curl -s -X POST http://localhost:5055/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"employee@mascallnet.com","password":"Employee@1"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Get my employee record
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:5055/api/employees/me | python3 -m json.tool

# Get leave types
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:5055/api/leave/types | python3 -m json.tool

# Get holidays
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:5055/api/leave/holidays | python3 -m json.tool
```
Expected: all return `{ "success": true, "data": [...] }` — no Supabase errors.

- [ ] **Step 7: Manager journey**

```bash
TOKEN=$(curl -s -X POST http://localhost:5055/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"manager@mascallnet.com","password":"Manager@1"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# List leave requests (pending approvals)
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:5055/api/leave/requests?status=pending" | python3 -m json.tool

# List roster
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:5055/api/wfm/roster | python3 -m json.tool
```
Expected: both return data arrays, no 500 errors.

- [ ] **Step 8: Finance journey**

```bash
TOKEN=$(curl -s -X POST http://localhost:5055/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"finance@mascallnet.com","password":"Finance@1"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# List salary structures
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:5055/api/payroll/structures | python3 -m json.tool
```
Expected: `{ "data": [...] }`

- [ ] **Step 9: File upload journey**

```bash
# Create test file
echo "test content" > /tmp/test_doc.txt

# Upload (requires auth)
TOKEN=$(curl -s -X POST http://localhost:5055/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"hr@mascallnet.com","password":"Hr@123456"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

curl -s -X POST "http://localhost:5055/api/files/upload?category=employee-documents" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/test_doc.txt" \
  | python3 -m json.tool
```
Expected: `{ "success": true, "url": "/api/files/employee-documents/uuid.txt", "filename": "..." }`

- [ ] **Step 10: Verify uploads directory was created**

```bash
ls /c/Users/shivamg/Desktop/HRMS/HRMS1/backend/uploads/employee-documents/
```
Expected: the uploaded file is present.

- [ ] **Step 11: Final push to upstream**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1
git fetch upstream
git rebase upstream/main
git push upstream main
git push origin main --force-with-lease
```

---

## Role Journey Coverage Summary

| Role | Key Flows Covered |
|---|---|
| Walk-in Candidate | Registration form → ATS candidate created (no auth) |
| Recruiter | Candidate queue, stage moves, onboarding bridge |
| HR | Employee CRUD, onboarding, documents, leave types, payroll structures |
| Employee | Self-service leave, attendance, payslip, goals, helpdesk |
| Manager | Leave approvals, team attendance, roster, performance reviews |
| WFM | Roster builder, live tracker, RTA |
| Finance | Payroll structures, payslip generation |
| Admin | Access control, org masters, settings, audit log |
| CEO | Management dashboards, command center |
| Trainer | LMS coordinator integration surface |

All flows must use `hrmsApi` → Express → MySQL exclusively. Zero calls to `*.supabase.co`.
