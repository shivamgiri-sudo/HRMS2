# Task 2 Brief: Backend — Single Employee ZIP Download Endpoint

## Context
Task 2 of 6. Modifies `backend/src/modules/payroll/esi-reg-docs.routes.ts` (created in Task 1) and its test file. Adds `archiver`+`pdfkit` imports, three helpers, a ZIP download route, and an audit log helper.

**IMPORTANT FIX FROM TASK 1 REVIEW:** Before adding new imports, add `requireAuth` middleware at the router level. The pattern in this codebase is:
```typescript
import { requireAuth } from "../../middleware/authMiddleware.js";
// ... then near top of file, after router creation:
esiRegDocsRouter.use(requireAuth);
```
See `backend/src/modules/payroll/payroll-extended.routes.ts` line 54 for the exact pattern.

## What to build

Modify `backend/src/modules/payroll/esi-reg-docs.routes.ts` — add to existing file:

### 1. Add imports at top (after existing imports)

```typescript
import { requireAuth } from "../../middleware/authMiddleware.js";
import path from "path";
import fs from "fs";
import PDFDocument from "pdfkit";
import * as _archiverNs from "archiver";
import type { ArchiverOptions, Archiver as ArchiverInstance } from "archiver";

const archiverLib = ((_archiverNs as unknown as { default?: unknown }).default ??
  _archiverNs) as (format: string, options?: ArchiverOptions) => ArchiverInstance;

const UPLOADS_ROOT = path.resolve(
  new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  "../../../../uploads"
);
```

### 2. Add requireAuth at router level (right after `export const esiRegDocsRouter = Router();`)

```typescript
esiRegDocsRouter.use(requireAuth);
```

### 3. Add helper: generateBankInfoPdf

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
      const mask = (acct: string) => acct ? `****${acct.slice(-4)}` : "Not provided";
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

### 4. Add helper: urlToLocalPath + fileExists

```typescript
function urlToLocalPath(fileUrl: string | null): string | null {
  if (!fileUrl) return null;
  const match = fileUrl.match(/\/api\/files\/(employee-documents|employee-photos)\/(.+)$/);
  if (!match) return null;
  return path.join(UPLOADS_ROOT, match[1], match[2]);
}

function fileExists(filePath: string | null): boolean {
  if (!filePath) return false;
  try { return fs.statSync(filePath).isFile(); } catch { return false; }
}
```

### 5. Add helper: writeAuditLog

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
    console.error("[esi-reg-docs] audit log failed", err);
  }
}
```

### 6. Add route: GET /esi-reg-docs/:employeeId/download

```typescript
esiRegDocsRouter.get(
  "/esi-reg-docs/:employeeId/download",
  requireRole(...ESI_ROLES),
  async (req: Request, res: Response) => {
    const { employeeId } = req.params;
    const actorId = (req as any).authUser?.id ?? "unknown";

    const [[empRow]] = await db.execute<RowDataPacket[]>(
      `SELECT emp_code, CONCAT(first_name,' ',COALESCE(last_name,'')) AS name,
              esic_number, photo_url, avatar_url
       FROM employees WHERE id = ? LIMIT 1`,
      [employeeId]
    );
    if (!empRow) return res.status(404).json({ error: "Employee not found" });

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

    const panPath = urlToLocalPath((panDoc as RowDataPacket | undefined)?.file_url ?? null);
    if (fileExists(panPath)) {
      const ext = path.extname(panPath!);
      archive.file(panPath!, { name: `PAN_Card${ext}` });
      manifest.push("✓ PAN_Card" + ext);
    } else {
      manifest.push("✗ PAN document not available — please upload in employee profile");
    }

    const photoPath = urlToLocalPath(empRow.photo_url ?? empRow.avatar_url ?? null);
    if (fileExists(photoPath)) {
      const ext = path.extname(photoPath!);
      archive.file(photoPath!, { name: `Photo${ext}` });
      manifest.push("✓ Photo" + ext);
    } else {
      manifest.push("✗ Employee photo not available");
    }

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

### 7. Add test for download endpoint

In `backend/src/modules/payroll/__tests__/esi-reg-docs.test.ts`, add a new describe block:

```typescript
describe("GET /api/payroll/esi-reg-docs/:employeeId/download", () => {
  it("streams a zip with manifest.txt when no files exist on disk", async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce([[{ emp_code: "EMP001", first_name: "Alice", last_name: "Smith", esic_number: "123", photo_url: null, avatar_url: null }] as any, []])
      .mockResolvedValueOnce([[] as any, []]) // no pan doc
      .mockResolvedValueOnce([[] as any, []]); // no bank detail for PDF

    const res = await request(app)
      .get("/api/payroll/esi-reg-docs/emp-1/download")
      .buffer(true)
      .parse((res: any, cb: any) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/zip/);
  });

  it("returns 404 when employee not found", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([[] as any, []]);
    const res = await request(app).get("/api/payroll/esi-reg-docs/nonexistent/download");
    expect(res.status).toBe(404);
  });
});
```

## Steps to run

```bash
# Run all tests
cd backend && npx vitest run src/modules/payroll/__tests__/esi-reg-docs.test.ts

# TypeScript check
cd backend && npx tsc --noEmit 2>&1 | grep esi-reg

# Commit (stage only these 2 files)
git add backend/src/modules/payroll/esi-reg-docs.routes.ts \
        backend/src/modules/payroll/__tests__/esi-reg-docs.test.ts
git commit -m "feat(payroll): add ESI single-employee ZIP download endpoint"
```

All prior 2 tests + new 2 tests = 4 tests must pass.

## Global constraints
- `requireAuth` must be added as `esiRegDocsRouter.use(requireAuth)` — this is the fix from Task 1 review
- Every download writes to `payroll_audit_trail` (non-fatal if it fails)
- ZIP missing-doc behaviour: omit file, include manifest.txt note
- Bank account masked in PDF: last 4 digits only
- `archiverLib` uses the exact CJS compat pattern shown above

## Report file
Write your full report to: `c:/Users/ADMIN/Desktop/HRMS2-latest/.superpowers/sdd/esi-reg-docs/briefs/task-2-report.md`

Return only: status (DONE/BLOCKED/NEEDS_CONTEXT), commit SHA, test results line, any concerns.
