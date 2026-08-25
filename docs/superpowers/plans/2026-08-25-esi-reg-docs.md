# ESI Registration Documents Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "ESI Reg. Docs" tab to the existing `PfManagement.tsx` page that lets authorised payroll staff download PAN Card, Photo, and Bank Information documents for ESI-eligible employees — individually, in bulk ZIP, or as a CSV summary.

**Architecture:** A single new backend route file (`esi-reg-docs.routes.ts`) exposes four endpoints under `/api/payroll`; the frontend is a single new tab component (`EsiRegDocsTab.tsx`) with a KPI strip, filterable employee table, bulk-select, and a right-side slide-over drill-down drawer. No new pages, no schema changes — all additive.

**Tech Stack:** Express + TypeScript + MySQL (`db` pool), `archiver` v8 (ZIP), `pdfkit` (bank info PDF), React 18 + TypeScript, Tailwind CSS, shadcn/ui, Lucide React, TanStack Query.

## Global Constraints

- Roles allowed on ALL four backend endpoints: `payroll_branch`, `payroll_head`, `super_admin` — enforced via `requireRole()` middleware.
- No new database tables. No schema migrations.
- PAN number decrypted server-side only; never send raw `pan_number_encrypted` to the frontend.
- Bank account numbers masked in CSV and UI: show last 4 digits, `****` prefix.
- Every download action (single, bulk, CSV) must write an audit row to `payroll_audit_trail`.
- ZIP missing-doc behaviour: omit the file, include a `manifest.txt` noting what is missing.
- Bulk download hard cap: 200 employees per request — return 400 if exceeded.
- Archiver import pattern (CJS compat): copy the pattern from `src/modules/ats/ats.joiningDocumentsTracker.service.ts` lines 7–18.
- Mount new router in `backend/src/app.ts` after line 387 (`payrollMoreRouter`).
- Frontend design tokens: purple gradient header (`bg-gradient-to-r from-purple-600 to-violet-600`), GlassCard containers (`rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm`), tone system per HRMS design system.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| **Create** | `backend/src/modules/payroll/esi-reg-docs.routes.ts` | All 4 API endpoints |
| **Create** | `backend/src/modules/payroll/__tests__/esi-reg-docs.test.ts` | Backend route tests |
| **Modify** | `backend/src/app.ts` line ~387 | Mount new router |
| **Create** | `src/pages/payroll/EsiRegDocsTab.tsx` | Full tab UI: KPI strip, table, drawer |
| **Modify** | `src/pages/payroll/PfManagement.tsx` | Add 5th tab + TabsContent |

---

## Task 1: Backend — ESI eligibility list endpoint

**Files:**
- Create: `backend/src/modules/payroll/esi-reg-docs.routes.ts`
- Create: `backend/src/modules/payroll/__tests__/esi-reg-docs.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/payroll/esi-reg-docs` → `{ employees: EsiRegDocEmployee[], total: number, page: number, limit: number }`
  - `EsiRegDocEmployee` shape (used by Tasks 2, 3, 4 and frontend):
    ```ts
    interface EsiRegDocEmployee {
      employee_id: string;
      emp_code: string;
      name: string;
      branch: string;
      esic_number: string | null;
      pan_ready: boolean;
      pan_doc_id: string | null;
      pan_file_url: string | null;
      photo_ready: boolean;
      photo_url: string | null;
      bank_ready: boolean;
    }
    ```

- [ ] **Step 1: Create the route file skeleton with role guard**

Create `backend/src/modules/payroll/esi-reg-docs.routes.ts`:

```typescript
import { Router, Request, Response } from "express";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

export const esiRegDocsRouter = Router();

const ESI_ROLES = ["payroll_branch", "payroll_head", "super_admin"] as const;
```

- [ ] **Step 2: Write the failing test for the list endpoint**

Create `backend/src/modules/payroll/__tests__/esi-reg-docs.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { esiRegDocsRouter } from "../esi-reg-docs.routes.js";

// Mock DB
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: vi.fn() },
}));

// Mock requireRole to pass for payroll_head
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: (..._roles: string[]) =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
      (_req as any).authUser = { id: "user-1", roles: ["payroll_head"] };
      next();
    },
}));

import { db } from "../../../db/mysql.js";

const app = express();
app.use(express.json());
app.use("/api/payroll", esiRegDocsRouter);

describe("GET /api/payroll/esi-reg-docs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns paginated ESI-eligible employees with readiness flags", async () => {
    vi.mocked(db.execute)
      // count query
      .mockResolvedValueOnce([[{ total: 1 }] as RowDataPacket[], []])
      // list query
      .mockResolvedValueOnce([
        [
          {
            employee_id: "emp-1",
            emp_code: "EMP001",
            name: "Alice Smith",
            branch: "Chennai",
            esic_number: "1234567890",
            pan_ready: 1,
            pan_doc_id: "doc-1",
            pan_file_url: "/api/files/employee-documents/pan.jpg",
            photo_ready: 1,
            photo_url: "/api/files/employee-photos/emp1.jpg",
            bank_ready: 1,
          },
        ] as RowDataPacket[],
        [],
      ]);

    const res = await request(app).get("/api/payroll/esi-reg-docs");
    expect(res.status).toBe(200);
    expect(res.body.employees).toHaveLength(1);
    expect(res.body.employees[0].pan_ready).toBe(true);
    expect(res.body.total).toBe(1);
  });

  it("returns 400 when limit exceeds 200", async () => {
    const res = await request(app).get("/api/payroll/esi-reg-docs?limit=999");
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run test — expect FAIL (router not yet implemented)**

```bash
cd backend && npx vitest run src/modules/payroll/__tests__/esi-reg-docs.test.ts
```

Expected: FAIL — "Cannot find module" or route returns 404.

- [ ] **Step 4: Implement the list endpoint**

Add to `esi-reg-docs.routes.ts`:

```typescript
esiRegDocsRouter.get(
  "/esi-reg-docs",
  requireRole(...ESI_ROLES),
  async (req: Request, res: Response) => {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
    const limit = parseInt(String(req.query.limit ?? "50"), 10);
    if (limit > 200) {
      return res.status(400).json({ error: "Maximum limit is 200" });
    }
    const offset = (page - 1) * limit;
    const branchId = req.query.branch_id as string | undefined;
    const search = req.query.search as string | undefined;

    const whereParts: string[] = [
      `(e.esic_number IS NOT NULL OR esi.esi_eligible = 1)`,
      `e.employment_status != 'terminated'`,
    ];
    const params: unknown[] = [];

    if (branchId) {
      whereParts.push("e.branch_id = ?");
      params.push(branchId);
    }
    if (search) {
      whereParts.push("(e.emp_code LIKE ? OR CONCAT(e.first_name,' ',e.last_name) LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }

    const whereClause = whereParts.join(" AND ");

    const [[{ total }]] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
       FROM employees e
       LEFT JOIN employee_statutory_info esi ON esi.employee_id = e.id
       WHERE ${whereClause}`,
      params
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         e.id                                              AS employee_id,
         e.emp_code,
         CONCAT(e.first_name, ' ', COALESCE(e.last_name,'')) AS name,
         COALESCE(b.name, e.branch, '')                   AS branch,
         e.esic_number,
         -- PAN readiness
         (SELECT COUNT(*) FROM employee_documents ed
          WHERE ed.employee_id = e.id
            AND ed.doc_category = 'pan'
            AND ed.document_status IN ('verified','uploaded','verification_pending')) > 0
                                                          AS pan_ready,
         (SELECT id FROM employee_documents ed
          WHERE ed.employee_id = e.id
            AND ed.doc_category = 'pan'
          ORDER BY ed.created_at DESC LIMIT 1)            AS pan_doc_id,
         (SELECT file_url FROM employee_documents ed
          WHERE ed.employee_id = e.id
            AND ed.doc_category = 'pan'
          ORDER BY ed.created_at DESC LIMIT 1)            AS pan_file_url,
         -- Photo readiness
         (e.photo_url IS NOT NULL OR e.avatar_url IS NOT NULL) AS photo_ready,
         COALESCE(e.photo_url, e.avatar_url)              AS photo_url,
         -- Bank readiness
         (SELECT COUNT(*) FROM employee_bank_detail ebd
          WHERE ebd.employee_id = e.id
            AND ebd.ifsc_code IS NOT NULL AND ebd.ifsc_code != '') > 0
                                                          AS bank_ready
       FROM employees e
       LEFT JOIN employee_statutory_info esi ON esi.employee_id = e.id
       LEFT JOIN branches b ON b.id = e.branch_id
       WHERE ${whereClause}
       ORDER BY e.emp_code
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const employees = (rows as RowDataPacket[]).map((r) => ({
      ...r,
      pan_ready: !!r.pan_ready,
      photo_ready: !!r.photo_ready,
      bank_ready: !!r.bank_ready,
    }));

    return res.json({ employees, total: Number(total), page, limit });
  }
);
```

- [ ] **Step 5: Run test — expect PASS**

```bash
cd backend && npx vitest run src/modules/payroll/__tests__/esi-reg-docs.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 6: TypeScript check**

```bash
cd backend && npx tsc --noEmit 2>&1 | grep esi-reg
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/payroll/esi-reg-docs.routes.ts \
        backend/src/modules/payroll/__tests__/esi-reg-docs.test.ts
git commit -m "feat(payroll): add ESI reg-docs list endpoint with readiness flags"
```

---

## Task 2: Backend — Single employee ZIP download endpoint

**Files:**
- Modify: `backend/src/modules/payroll/esi-reg-docs.routes.ts`
- Modify: `backend/src/modules/payroll/__tests__/esi-reg-docs.test.ts`

**Interfaces:**
- Consumes: `db` pool, `archiver` (CJS compat pattern), `pdfkit`, `path`, `fs`
- Produces: `GET /api/payroll/esi-reg-docs/:employeeId/download` → `application/zip` stream

- [ ] **Step 1: Add import block at top of route file**

Add to the top of `esi-reg-docs.routes.ts` (after existing imports):

```typescript
import path from "path";
import fs from "fs";
import PDFDocument from "pdfkit";
import * as _archiverNs from "archiver";
import type { ArchiverOptions, Archiver as ArchiverInstance } from "archiver";

const archiverLib = ((_archiverNs as unknown as { default?: unknown }).default ??
  _archiverNs) as (format: string, options?: ArchiverOptions) => ArchiverInstance;

// Resolve the uploads root from app root (two levels up from src/modules/payroll)
const UPLOADS_ROOT = path.resolve(
  new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  "../../../../uploads"
);
```

- [ ] **Step 2: Write helper — generate bank info PDF buffer**

Add to `esi-reg-docs.routes.ts`:

```typescript
async function generateBankInfoPdf(employeeId: string): Promise<Buffer> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ebd.bank_name, ebd.account_number, ebd.ifsc_code, ebd.account_type,
            CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS name,
            e.emp_code, e.esic_number
     FROM employee_bank_detail ebd
     JOIN employees e ON e.id = ebd.employee_id
     WHERE ebd.employee_id = ?
     ORDER BY ebd.created_at DESC LIMIT 1`,
    [employeeId]
  );
  const row = (rows as RowDataPacket[])[0];

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).font("Helvetica-Bold").text("ESI Registration — Bank Information", { align: "center" });
    doc.moveDown();

    if (!row) {
      doc.fontSize(12).font("Helvetica").text("Bank details not on record for this employee.");
    } else {
      const mask = (acct: string) =>
        acct ? `****${acct.slice(-4)}` : "Not provided";

      doc.fontSize(12).font("Helvetica");
      const fields: [string, string][] = [
        ["Employee Code", row.emp_code ?? ""],
        ["Employee Name", row.name ?? ""],
        ["ESIC Number", row.esic_number ?? "Not assigned"],
        ["Bank Name", row.bank_name ?? ""],
        ["Account Number (Masked)", mask(row.account_number ?? "")],
        ["IFSC Code", row.ifsc_code ?? ""],
        ["Account Type", row.account_type ?? ""],
      ];
      for (const [label, value] of fields) {
        doc.font("Helvetica-Bold").text(`${label}: `, { continued: true });
        doc.font("Helvetica").text(value);
      }
    }
    doc.end();
  });
}
```

- [ ] **Step 3: Write helper — resolve file path from URL**

Add to `esi-reg-docs.routes.ts`:

```typescript
function urlToLocalPath(fileUrl: string | null): string | null {
  if (!fileUrl) return null;
  // Normalise: /api/files/employee-documents/abc.jpg → uploads/employee-documents/abc.jpg
  const match = fileUrl.match(/\/api\/files\/(employee-documents|employee-photos)\/(.+)$/);
  if (!match) return null;
  return path.join(UPLOADS_ROOT, match[1], match[2]);
}

function fileExists(filePath: string | null): boolean {
  if (!filePath) return false;
  try { return fs.statSync(filePath).isFile(); } catch { return false; }
}
```

- [ ] **Step 4: Write failing test for single-download endpoint**

Add to `esi-reg-docs.test.ts`:

```typescript
describe("GET /api/payroll/esi-reg-docs/:employeeId/download", () => {
  it("streams a zip with manifest.txt when no files exist", async () => {
    // employee exists but no files on disk
    vi.mocked(db.execute)
      .mockResolvedValueOnce([[{ emp_code: "EMP001", first_name: "Alice", last_name: "Smith", esic_number: "123" }] as RowDataPacket[], []])
      .mockResolvedValueOnce([[] as RowDataPacket[], []]) // no pan doc
      .mockResolvedValueOnce([[] as RowDataPacket[], []]); // no bank detail

    const res = await request(app)
      .get("/api/payroll/esi-reg-docs/emp-1/download")
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/zip/);
  });
});
```

- [ ] **Step 5: Run test — expect FAIL**

```bash
cd backend && npx vitest run src/modules/payroll/__tests__/esi-reg-docs.test.ts 2>&1 | tail -20
```

Expected: FAIL — no route for `:employeeId/download`.

- [ ] **Step 6: Write audit helper**

Add to `esi-reg-docs.routes.ts`:

```typescript
async function writeAuditLog(
  action: string,
  performedBy: string,
  targetEmployeeId: string | null,
  details: Record<string, unknown>
): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO payroll_audit_trail (id, action, performed_by, target_employee_id, details, created_at)
       VALUES (UUID(), ?, ?, ?, ?, NOW())`,
      [action, performedBy, targetEmployeeId, JSON.stringify(details)]
    );
  } catch (err) {
    // Non-fatal — log and continue
    console.error("[esi-reg-docs] audit log failed", err);
  }
}
```

- [ ] **Step 7: Implement single-download endpoint**

Add to `esi-reg-docs.routes.ts`:

```typescript
esiRegDocsRouter.get(
  "/esi-reg-docs/:employeeId/download",
  requireRole(...ESI_ROLES),
  async (req: Request, res: Response) => {
    const { employeeId } = req.params;
    const actorId = (req as any).authUser?.id ?? "unknown";

    // Fetch employee basics
    const [[empRow]] = await db.execute<RowDataPacket[]>(
      `SELECT emp_code, CONCAT(first_name,' ',COALESCE(last_name,'')) AS name,
              esic_number, photo_url, avatar_url
       FROM employees WHERE id = ? LIMIT 1`,
      [employeeId]
    );
    if (!empRow) return res.status(404).json({ error: "Employee not found" });

    // Fetch PAN doc
    const [[panDoc]] = await db.execute<RowDataPacket[]>(
      `SELECT file_url FROM employee_documents
       WHERE employee_id = ? AND doc_category = 'pan'
       ORDER BY created_at DESC LIMIT 1`,
      [employeeId]
    );

    const date = new Date().toISOString().slice(0, 10);
    const filename = `ESI_Docs_${empRow.emp_code}_${date}.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const archive = archiverLib("zip", { zlib: { level: 9 } });
    archive.pipe(res);
    archive.on("error", (err: Error) => console.error("[esi-reg-docs] archive error", err));

    const manifest: string[] = [`ESI Registration Documents — ${empRow.name} (${empRow.emp_code})\n`];

    // PAN card
    const panPath = urlToLocalPath((panDoc as RowDataPacket | undefined)?.file_url ?? null);
    if (fileExists(panPath)) {
      const ext = path.extname(panPath!);
      archive.file(panPath!, { name: `PAN_Card${ext}` });
      manifest.push("✓ PAN_Card" + ext);
    } else {
      manifest.push("✗ PAN document not available — please upload in employee profile");
    }

    // Photo
    const photoPath = urlToLocalPath(empRow.photo_url ?? empRow.avatar_url ?? null);
    if (fileExists(photoPath)) {
      const ext = path.extname(photoPath!);
      archive.file(photoPath!, { name: `Photo${ext}` });
      manifest.push("✓ Photo" + ext);
    } else {
      manifest.push("✗ Employee photo not available");
    }

    // Bank info PDF
    try {
      const bankPdf = await generateBankInfoPdf(employeeId);
      archive.append(bankPdf, { name: "Bank_Information.pdf" });
      manifest.push("✓ Bank_Information.pdf");
    } catch {
      manifest.push("✗ Bank information could not be generated");
    }

    archive.append(manifest.join("\n"), { name: "manifest.txt" });

    await archive.finalize();

    await writeAuditLog("esi_reg_doc_download", actorId, employeeId, {
      emp_code: empRow.emp_code,
    });
  }
);
```

- [ ] **Step 8: Run tests — expect PASS**

```bash
cd backend && npx vitest run src/modules/payroll/__tests__/esi-reg-docs.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/payroll/esi-reg-docs.routes.ts \
        backend/src/modules/payroll/__tests__/esi-reg-docs.test.ts
git commit -m "feat(payroll): add ESI single-employee ZIP download endpoint"
```

---

## Task 3: Backend — Bulk ZIP + CSV export endpoints

**Files:**
- Modify: `backend/src/modules/payroll/esi-reg-docs.routes.ts`
- Modify: `backend/src/modules/payroll/__tests__/esi-reg-docs.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/payroll/esi-reg-docs/bulk-download` body `{ employee_ids: string[] }` → `application/zip`
  - `GET /api/payroll/esi-reg-docs/export-csv` → `text/csv`
- Consumes: `generateBankInfoPdf`, `writeAuditLog`, `archiverLib`, `urlToLocalPath`, `fileExists` (all defined in Task 2)

- [ ] **Step 1: Write failing tests**

Add to `esi-reg-docs.test.ts`:

```typescript
describe("POST /api/payroll/esi-reg-docs/bulk-download", () => {
  it("returns 400 when more than 200 employee_ids supplied", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `emp-${i}`);
    const res = await request(app)
      .post("/api/payroll/esi-reg-docs/bulk-download")
      .send({ employee_ids: ids });
    expect(res.status).toBe(400);
  });

  it("returns 400 when employee_ids is empty", async () => {
    const res = await request(app)
      .post("/api/payroll/esi-reg-docs/bulk-download")
      .send({ employee_ids: [] });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/payroll/esi-reg-docs/export-csv", () => {
  it("returns CSV with correct headers", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([[] as RowDataPacket[], []]);
    const res = await request(app).get("/api/payroll/esi-reg-docs/export-csv");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.text).toContain("Emp Code");
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd backend && npx vitest run src/modules/payroll/__tests__/esi-reg-docs.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Implement bulk-download endpoint**

Add to `esi-reg-docs.routes.ts`:

```typescript
esiRegDocsRouter.post(
  "/esi-reg-docs/bulk-download",
  requireRole(...ESI_ROLES),
  async (req: Request, res: Response) => {
    const { employee_ids } = req.body as { employee_ids?: string[] };
    if (!Array.isArray(employee_ids) || employee_ids.length === 0) {
      return res.status(400).json({ error: "employee_ids must be a non-empty array" });
    }
    if (employee_ids.length > 200) {
      return res.status(400).json({ error: "Maximum 200 employees per bulk download" });
    }
    const actorId = (req as any).authUser?.id ?? "unknown";
    const date = new Date().toISOString().slice(0, 10);

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="ESI_Bulk_Docs_${date}.zip"`);

    const archive = archiverLib("zip", { zlib: { level: 9 } });
    archive.pipe(res);
    archive.on("error", (err: Error) => console.error("[esi-reg-docs] bulk archive error", err));

    const placeholders = employee_ids.map(() => "?").join(",");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, emp_code, CONCAT(first_name,' ',COALESCE(last_name,'')) AS name,
              esic_number, photo_url, avatar_url
       FROM employees WHERE id IN (${placeholders})`,
      employee_ids
    );

    for (const emp of rows as RowDataPacket[]) {
      const folder = `${emp.emp_code}_${(emp.name as string).replace(/\s+/g, "_")}`;
      const manifest: string[] = [`ESI Docs — ${emp.name} (${emp.emp_code})\n`];

      // PAN card
      const [[panDoc]] = await db.execute<RowDataPacket[]>(
        `SELECT file_url FROM employee_documents
         WHERE employee_id = ? AND doc_category = 'pan'
         ORDER BY created_at DESC LIMIT 1`,
        [emp.id]
      );
      const panPath = urlToLocalPath((panDoc as RowDataPacket | undefined)?.file_url ?? null);
      if (fileExists(panPath)) {
        const ext = path.extname(panPath!);
        archive.file(panPath!, { name: `${folder}/PAN_Card${ext}` });
        manifest.push("✓ PAN_Card" + ext);
      } else {
        manifest.push("✗ PAN document not available");
      }

      // Photo
      const photoPath = urlToLocalPath(emp.photo_url ?? emp.avatar_url ?? null);
      if (fileExists(photoPath)) {
        const ext = path.extname(photoPath!);
        archive.file(photoPath!, { name: `${folder}/Photo${ext}` });
        manifest.push("✓ Photo" + ext);
      } else {
        manifest.push("✗ Photo not available");
      }

      // Bank PDF
      try {
        const bankPdf = await generateBankInfoPdf(emp.id as string);
        archive.append(bankPdf, { name: `${folder}/Bank_Information.pdf` });
        manifest.push("✓ Bank_Information.pdf");
      } catch {
        manifest.push("✗ Bank info unavailable");
      }

      archive.append(manifest.join("\n"), { name: `${folder}/manifest.txt` });
    }

    await archive.finalize();

    await writeAuditLog("esi_bulk_doc_download", actorId, null, {
      employee_ids,
      count: employee_ids.length,
    });
  }
);
```

- [ ] **Step 4: Implement CSV export endpoint**

Add to `esi-reg-docs.routes.ts`:

```typescript
esiRegDocsRouter.get(
  "/esi-reg-docs/export-csv",
  requireRole(...ESI_ROLES),
  async (req: Request, res: Response) => {
    const actorId = (req as any).authUser?.id ?? "unknown";
    const branchId = req.query.branch_id as string | undefined;

    const whereParts = [
      `(e.esic_number IS NOT NULL OR esi.esi_eligible = 1)`,
      `e.employment_status != 'terminated'`,
    ];
    const params: unknown[] = [];
    if (branchId) {
      whereParts.push("e.branch_id = ?");
      params.push(branchId);
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         e.emp_code,
         CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS name,
         COALESCE(b.name, e.branch, '')                   AS branch,
         e.esic_number,
         e.pan_number,
         (SELECT ebd.bank_name FROM employee_bank_detail ebd WHERE ebd.employee_id = e.id ORDER BY ebd.created_at DESC LIMIT 1) AS bank_name,
         (SELECT ebd.account_number FROM employee_bank_detail ebd WHERE ebd.employee_id = e.id ORDER BY ebd.created_at DESC LIMIT 1) AS account_number,
         (SELECT ebd.ifsc_code FROM employee_bank_detail ebd WHERE ebd.employee_id = e.id ORDER BY ebd.created_at DESC LIMIT 1) AS ifsc_code,
         (SELECT ebd.account_type FROM employee_bank_detail ebd WHERE ebd.employee_id = e.id ORDER BY ebd.created_at DESC LIMIT 1) AS account_type,
         (SELECT COUNT(*) FROM employee_documents ed WHERE ed.employee_id = e.id AND ed.doc_category = 'pan') > 0 AS pan_ready,
         (e.photo_url IS NOT NULL OR e.avatar_url IS NOT NULL) AS photo_ready,
         (SELECT COUNT(*) FROM employee_bank_detail ebd WHERE ebd.employee_id = e.id AND ebd.ifsc_code IS NOT NULL) > 0 AS bank_ready
       FROM employees e
       LEFT JOIN employee_statutory_info esi ON esi.employee_id = e.id
       LEFT JOIN branches b ON b.id = e.branch_id
       WHERE ${whereParts.join(" AND ")}
       ORDER BY e.emp_code`,
      params
    );

    const mask = (acct: string | null) => (acct ? `****${acct.slice(-4)}` : "");

    const header = "Emp Code,Name,Branch,ESIC Number,PAN Number,Bank Name,Account Number (Masked),IFSC Code,Account Type,PAN Ready,Photo Ready,Bank Ready\n";
    const csvRows = (rows as RowDataPacket[])
      .map((r) =>
        [
          r.emp_code,
          `"${r.name}"`,
          `"${r.branch}"`,
          r.esic_number ?? "",
          r.pan_number ?? "",
          `"${r.bank_name ?? ""}"`,
          mask(r.account_number ?? null),
          r.ifsc_code ?? "",
          r.account_type ?? "",
          r.pan_ready ? "Yes" : "No",
          r.photo_ready ? "Yes" : "No",
          r.bank_ready ? "Yes" : "No",
        ].join(",")
      )
      .join("\n");

    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="ESI_Reg_${date}.csv"`);
    // UTF-8 BOM for Excel compatibility
    res.send("\uFEFF" + header + csvRows);

    await writeAuditLog("esi_reg_csv_export", actorId, null, { branch_id: branchId ?? "all" });
  }
);
```

- [ ] **Step 5: Run all tests — expect PASS**

```bash
cd backend && npx vitest run src/modules/payroll/__tests__/esi-reg-docs.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: TypeScript check**

```bash
cd backend && npx tsc --noEmit 2>&1 | grep esi-reg
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/payroll/esi-reg-docs.routes.ts \
        backend/src/modules/payroll/__tests__/esi-reg-docs.test.ts
git commit -m "feat(payroll): add ESI bulk ZIP download and CSV export endpoints"
```

---

## Task 4: Mount router in app.ts

**Files:**
- Modify: `backend/src/app.ts`

**Interfaces:**
- Consumes: `esiRegDocsRouter` exported from `esi-reg-docs.routes.ts`
- Produces: all 4 endpoints live under `/api/payroll`

- [ ] **Step 1: Add import**

In `backend/src/app.ts`, after the existing payroll imports (around line 27–30), add:

```typescript
import { esiRegDocsRouter } from "./modules/payroll/esi-reg-docs.routes.js";
```

- [ ] **Step 2: Mount router**

After line 387 (`app.use("/api/payroll", listEndpointLimiter, payrollMoreRouter);`), add:

```typescript
app.use("/api/payroll", listEndpointLimiter, esiRegDocsRouter);
```

- [ ] **Step 3: TypeScript check**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 4: Smoke-test the endpoint (requires running backend)**

```bash
curl -s -H "Authorization: Bearer <your-token>" \
  http://localhost:3000/api/payroll/esi-reg-docs?limit=5 | python -m json.tool | head -20
```

Expected: JSON with `employees` array and `total`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app.ts
git commit -m "feat(payroll): mount esiRegDocsRouter under /api/payroll"
```

---

## Task 5: Frontend — EsiRegDocsTab component

**Files:**
- Create: `src/pages/payroll/EsiRegDocsTab.tsx`

**Interfaces:**
- Consumes: `GET /api/payroll/esi-reg-docs`, `GET /api/payroll/esi-reg-docs/:id/download`, `POST /api/payroll/esi-reg-docs/bulk-download`, `GET /api/payroll/esi-reg-docs/export-csv`
- Produces: exported default `EsiRegDocsTab` component (no props)

**Design tokens (MAS PeopleOS):**
- Page header: `bg-gradient-to-r from-purple-600 to-violet-600 text-white` (statutory domain)
- Cards: `rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm`
- Ready chip: `bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full`
- Missing chip: `bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full`
- KPI tile tones: `blue` (total eligible), `green` (all docs ready), `amber` (missing docs)

- [ ] **Step 1: Create the file with types and data-fetching hook**

Create `src/pages/payroll/EsiRegDocsTab.tsx`:

```tsx
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  CheckCircle2, XCircle, Download, FileText, Users,
  AlertTriangle, Search, FileDown, Loader2,
} from "lucide-react";

interface EsiEmployee {
  employee_id: string;
  emp_code: string;
  name: string;
  branch: string;
  esic_number: string | null;
  pan_ready: boolean;
  pan_doc_id: string | null;
  pan_file_url: string | null;
  photo_ready: boolean;
  photo_url: string | null;
  bank_ready: boolean;
}

interface ListResponse {
  employees: EsiEmployee[];
  total: number;
  page: number;
  limit: number;
}

function useEsiList(params: { search: string; branchId: string; page: number }) {
  return useQuery<ListResponse>({
    queryKey: ["esi-reg-docs", params],
    queryFn: () =>
      hrmsApi
        .get("/payroll/esi-reg-docs", {
          params: {
            search: params.search || undefined,
            branch_id: params.branchId || undefined,
            page: params.page,
            limit: 50,
          },
        })
        .then((r) => r.data),
    staleTime: 30_000,
  });
}
```

- [ ] **Step 2: Add KPI strip sub-component**

Continue in `EsiRegDocsTab.tsx`:

```tsx
function KpiStrip({ employees }: { employees: EsiEmployee[] }) {
  const total = employees.length;
  const allReady = employees.filter((e) => e.pan_ready && e.photo_ready && e.bank_ready).length;
  const missing = total - allReady;

  const tiles = [
    { label: "ESI Eligible", value: total, icon: Users, tone: "blue" as const },
    { label: "All Docs Ready", value: allReady, icon: CheckCircle2, tone: "green" as const },
    { label: "Docs Missing", value: missing, icon: AlertTriangle, tone: "amber" as const },
  ];

  const toneMap = {
    blue:  { bg: "bg-[#edf4ff]", text: "text-[#0b63e5]", border: "border-[#dce8fb]", icon: "text-[#0b63e5]" },
    green: { bg: "bg-[#eaf8ef]", text: "text-[#15803d]", border: "border-[#d7f0df]", icon: "text-[#15803d]" },
    amber: { bg: "bg-[#fff4e8]", text: "text-[#ea580c]", border: "border-[#fee3c5]", icon: "text-[#ea580c]" },
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
      {tiles.map((t) => {
        const c = toneMap[t.tone];
        const Icon = t.icon;
        return (
          <div key={t.label} className={`rounded-2xl border ${c.border} ${c.bg} px-5 py-4 flex items-center gap-4`}>
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${c.bg}`}>
              <Icon className={`w-5 h-5 ${c.icon}`} />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{t.label}</p>
              <p className={`text-2xl font-bold ${c.text}`}>{t.value}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Add readiness chip helper and employee table**

Continue in `EsiRegDocsTab.tsx`:

```tsx
function ReadyChip({ ready, label }: { ready: boolean; label: string }) {
  return ready ? (
    <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">
      <CheckCircle2 className="w-3 h-3" /> {label}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">
      <XCircle className="w-3 h-3" /> {label}
    </span>
  );
}

function EmployeeTable({
  employees,
  selected,
  onToggle,
  onSelectAll,
  onDownload,
  onOpenDrawer,
  downloading,
}: {
  employees: EsiEmployee[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onDownload: (id: string) => void;
  onOpenDrawer: (emp: EsiEmployee) => void;
  downloading: string | null;
}) {
  const allSelected = employees.length > 0 && selected.size === employees.length;

  return (
    <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60">
              <th className="px-4 py-3 text-left w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onSelectAll}
                  className="rounded"
                  aria-label="Select all"
                />
              </th>
              {["Emp Code", "Name", "Branch", "ESIC No.", "PAN", "Photo", "Bank", "Actions"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400 text-sm">
                  No ESI-eligible employees found.
                </td>
              </tr>
            )}
            {employees.map((emp) => (
              <tr
                key={emp.employee_id}
                className="border-b border-slate-50 hover:bg-blue-50/40 transition-colors duration-150 cursor-pointer"
                onClick={() => onOpenDrawer(emp)}
              >
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected.has(emp.employee_id)}
                    onChange={() => onToggle(emp.employee_id)}
                    className="rounded"
                    aria-label={`Select ${emp.name}`}
                  />
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-600">{emp.emp_code}</td>
                <td className="px-4 py-3 font-semibold text-slate-800">{emp.name}</td>
                <td className="px-4 py-3 text-slate-600">{emp.branch}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{emp.esic_number ?? "—"}</td>
                <td className="px-4 py-3"><ReadyChip ready={emp.pan_ready} label="PAN" /></td>
                <td className="px-4 py-3"><ReadyChip ready={emp.photo_ready} label="Photo" /></td>
                <td className="px-4 py-3"><ReadyChip ready={emp.bank_ready} label="Bank" /></td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1 border-blue-200 text-blue-700 hover:bg-blue-50"
                    disabled={downloading === emp.employee_id}
                    onClick={() => onDownload(emp.employee_id)}
                  >
                    {downloading === emp.employee_id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Download className="w-3 h-3" />
                    )}
                    ZIP
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add drill-down drawer sub-component**

Continue in `EsiRegDocsTab.tsx`:

```tsx
function EsiDrawer({
  emp,
  onClose,
  onDownload,
  downloading,
}: {
  emp: EsiEmployee | null;
  onClose: () => void;
  onDownload: (id: string) => void;
  downloading: string | null;
}) {
  if (!emp) return null;
  const allReady = emp.pan_ready && emp.photo_ready && emp.bank_ready;

  return (
    <Sheet open={!!emp} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="max-w-2xl w-full overflow-y-auto p-0">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-violet-600 text-white px-6 py-5">
          <SheetHeader>
            <SheetTitle className="text-white text-lg font-bold">
              {emp.name}
            </SheetTitle>
          </SheetHeader>
          <div className="flex items-center gap-3 mt-2">
            <span className="font-mono text-sm bg-white/20 px-2 py-0.5 rounded">{emp.emp_code}</span>
            <Badge className={allReady ? "bg-green-400/90 text-white" : "bg-amber-400/90 text-white"}>
              {allReady ? "Docs Ready" : "Docs Incomplete"}
            </Badge>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* ESI Details */}
          <section>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">ESI Details</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide">ESIC Number</p>
                <p className="font-semibold text-slate-800">{emp.esic_number ?? "Not assigned"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide">Branch</p>
                <p className="font-semibold text-slate-800">{emp.branch}</p>
              </div>
            </div>
          </section>

          {/* Document Readiness */}
          <section>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">Document Readiness</p>
            <div className="space-y-2">
              {[
                { label: "PAN Card", ready: emp.pan_ready, hint: "Upload in employee profile → Documents" },
                { label: "Employee Photo", ready: emp.photo_ready, hint: "Upload via employee profile" },
                { label: "Bank Information", ready: emp.bank_ready, hint: "Add bank details in employee profile" },
              ].map((d) => (
                <div key={d.label} className="flex items-center justify-between py-2 border-b border-slate-50">
                  <div className="flex items-center gap-2">
                    {d.ready ? (
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-400" />
                    )}
                    <span className="text-sm font-medium text-slate-700">{d.label}</span>
                  </div>
                  {!d.ready && (
                    <span className="text-xs text-slate-400 italic">{d.hint}</span>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Download Actions */}
          <section>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">Download Actions</p>
            <div className="flex flex-wrap gap-3">
              <Button
                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold gap-2 rounded-xl shadow-[0_4px_12px_rgba(37,99,235,0.3)] transition-all duration-200"
                disabled={downloading === emp.employee_id}
                onClick={() => onDownload(emp.employee_id)}
              >
                {downloading === emp.employee_id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                Download ESI ZIP
              </Button>
            </div>
            <p className="text-xs text-slate-400 mt-2">
              ZIP includes PAN card, photo, and bank information PDF for ESI portal upload.
              Missing documents are noted in manifest.txt inside the ZIP.
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 5: Add the main export component with toolbar**

Continue in `EsiRegDocsTab.tsx`:

```tsx
export default function EsiRegDocsTab() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [page] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerEmp, setDrawerEmp] = useState<EsiEmployee | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [bulkDownloading, setBulkDownloading] = useState(false);

  const { data, isLoading } = useEsiList({ search, branchId: "", page });
  const employees = data?.employees ?? [];

  const allSelected = useMemo(
    () => employees.length > 0 && selected.size === employees.length,
    [employees, selected]
  );

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(employees.map((e) => e.employee_id)));
    }
  }

  async function downloadSingle(employeeId: string) {
    setDownloading(employeeId);
    try {
      const res = await hrmsApi.get(`/payroll/esi-reg-docs/${employeeId}/download`, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(new Blob([res.data], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = res.headers["content-disposition"]?.match(/filename="(.+)"/)?.[1] ?? "ESI_Docs.zip";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Download failed", description: "Could not download ESI documents.", variant: "destructive" });
    } finally {
      setDownloading(null);
    }
  }

  async function downloadBulk() {
    if (selected.size === 0) return;
    setBulkDownloading(true);
    try {
      const res = await hrmsApi.post(
        "/payroll/esi-reg-docs/bulk-download",
        { employee_ids: Array.from(selected) },
        { responseType: "blob" }
      );
      const url = URL.createObjectURL(new Blob([res.data], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `ESI_Bulk_Docs_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setSelected(new Set());
    } catch {
      toast({ title: "Bulk download failed", variant: "destructive" });
    } finally {
      setBulkDownloading(false);
    }
  }

  async function exportCsv() {
    try {
      const res = await hrmsApi.get("/payroll/esi-reg-docs/export-csv", { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([res.data], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `ESI_Reg_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "CSV export failed", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4 py-4">
      {/* Gradient header */}
      <div className="rounded-2xl bg-gradient-to-r from-purple-600 to-violet-600 text-white px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold">ESI Registration Documents</h2>
            <p className="text-sm text-purple-100 mt-0.5">
              Download PAN Card, Photo &amp; Bank Information for ESI portal registration.
            </p>
          </div>
        </div>
      </div>

      {/* KPI strip */}
      {!isLoading && <KpiStrip employees={employees} />}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search by name or emp code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 rounded-xl border-blue-200"
          />
        </div>
        <Button
          variant="outline"
          className="gap-2 rounded-xl border-blue-200 text-blue-700 hover:bg-blue-50"
          onClick={exportCsv}
        >
          <FileDown className="w-4 h-4" />
          Export CSV
        </Button>
        <Button
          className="gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-[0_4px_12px_rgba(37,99,235,0.3)] transition-all duration-200 disabled:opacity-50"
          disabled={selected.size === 0 || bulkDownloading}
          onClick={downloadBulk}
        >
          {bulkDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Bulk ZIP {selected.size > 0 && `(${selected.size})`}
        </Button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading…
        </div>
      ) : (
        <EmployeeTable
          employees={employees}
          selected={selected}
          onToggle={toggleSelect}
          onSelectAll={toggleSelectAll}
          onDownload={downloadSingle}
          onOpenDrawer={setDrawerEmp}
          downloading={downloading}
        />
      )}

      {/* Total count */}
      {data && (
        <p className="text-xs text-slate-400 text-right">
          {data.total} ESI-eligible employee{data.total !== 1 ? "s" : ""}
        </p>
      )}

      {/* Drill-down drawer */}
      <EsiDrawer
        emp={drawerEmp}
        onClose={() => setDrawerEmp(null)}
        onDownload={downloadSingle}
        downloading={downloading}
      />
    </div>
  );
}
```

- [ ] **Step 6: TypeScript check**

```bash
cd c:/Users/ADMIN/Desktop/HRMS2-latest && npx tsc --noEmit 2>&1 | grep EsiRegDocs
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/pages/payroll/EsiRegDocsTab.tsx
git commit -m "feat(payroll): add EsiRegDocsTab component with KPI strip, table, bulk download, drawer"
```

---

## Task 6: Wire tab into PfManagement.tsx

**Files:**
- Modify: `src/pages/payroll/PfManagement.tsx`

**Interfaces:**
- Consumes: `EsiRegDocsTab` default export from `./EsiRegDocsTab`
- Produces: "ESI Reg. Docs" visible as the 5th tab in PF/EPFO Management page

- [ ] **Step 1: Add import**

In `src/pages/payroll/PfManagement.tsx` after the existing imports (around line 12), add:

```tsx
import EsiRegDocsTab from "./EsiRegDocsTab";
```

- [ ] **Step 2: Add tab trigger**

In the `<TabsList>` (around line 26–30), add after the "establishments" trigger:

```tsx
<TabsTrigger value="esi-reg">ESI Reg. Docs</TabsTrigger>
```

- [ ] **Step 3: Add tab content**

After the establishments `<TabsContent>` block (around line 44–47), add:

```tsx
<TabsContent value="esi-reg" className="mt-0">
  <EsiRegDocsTab />
</TabsContent>
```

- [ ] **Step 4: Frontend build check**

```bash
cd c:/Users/ADMIN/Desktop/HRMS2-latest && npm run build 2>&1 | tail -10
```

Expected: Build succeeded with zero TypeScript errors.

- [ ] **Step 5: Backend TypeScript check**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -10
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/payroll/PfManagement.tsx
git commit -m "feat(payroll): add ESI Reg. Docs tab to PF/EPFO Management page"
```

---

## Post-Implementation Verification Checklist

- [ ] `npm run build` — zero errors
- [ ] `cd backend && npx tsc --noEmit` — zero errors
- [ ] `cd backend && npx vitest run src/modules/payroll/__tests__/esi-reg-docs.test.ts` — all pass
- [ ] Navigate to Payroll → PF/EPFO Management → confirm "ESI Reg. Docs" tab appears
- [ ] With `payroll_head` role: tab loads, KPI strip shows counts, table shows employees
- [ ] With a non-authorised role (e.g. `hr`): confirm API returns 403
- [ ] Single ZIP download: file downloads, contains `manifest.txt`
- [ ] Bulk ZIP: select 2 employees → "Bulk ZIP (2)" button active → downloads ZIP with sub-folders
- [ ] CSV export: file downloads, opens in Excel, headers match spec, account numbers masked
- [ ] Row click: drawer opens with employee details, Download button present
