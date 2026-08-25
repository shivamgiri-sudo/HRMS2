# Task 3 Brief: Backend — Bulk ZIP + CSV Export Endpoints

## Context
Task 3 of 6. Adds two more routes to the existing `esi-reg-docs.routes.ts` and tests.
All helpers (`generateBankInfoPdf`, `writeAuditLog`, `archiverLib`, `urlToLocalPath`, `fileExists`) already exist from Task 2.

## What to build

### New routes to add to `backend/src/modules/payroll/esi-reg-docs.routes.ts`

#### Route 1: POST /esi-reg-docs/bulk-download

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

      const photoPath = urlToLocalPath(emp.photo_url ?? emp.avatar_url ?? null);
      if (fileExists(photoPath)) {
        const ext = path.extname(photoPath!);
        archive.file(photoPath!, { name: `${folder}/Photo${ext}` });
        manifest.push("✓ Photo" + ext);
      } else {
        manifest.push("✗ Photo not available");
      }

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

#### Route 2: GET /esi-reg-docs/export-csv

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
    res.send("\uFEFF" + header + csvRows);

    await writeAuditLog("esi_reg_csv_export", actorId, null, { branch_id: branchId ?? "all" });
  }
);
```

### New tests to add to `backend/src/modules/payroll/__tests__/esi-reg-docs.test.ts`

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
    vi.mocked(db.execute).mockResolvedValueOnce([[] as any, []]);
    const res = await request(app).get("/api/payroll/esi-reg-docs/export-csv");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.text).toContain("Emp Code");
  });
});
```

## Steps

```bash
# Run all tests (4 existing + 3 new = 7 total)
cd backend && npx vitest run src/modules/payroll/__tests__/esi-reg-docs.test.ts

# TypeScript check
cd backend && npx tsc --noEmit 2>&1 | grep esi-reg

# Stage only these 2 files
git add backend/src/modules/payroll/esi-reg-docs.routes.ts \
        backend/src/modules/payroll/__tests__/esi-reg-docs.test.ts
git commit -m "feat(payroll): add ESI bulk ZIP download and CSV export endpoints"
```

## Global constraints
- Bulk cap: 200 employees → 400 if exceeded
- Empty array → 400
- Audit: `esi_bulk_doc_download` (bulk), `esi_reg_csv_export` (CSV)
- CSV: UTF-8 BOM (`\uFEFF`), account numbers masked (`****` + last 4)
- CSV columns exactly: `Emp Code,Name,Branch,ESIC Number,PAN Number,Bank Name,Account Number (Masked),IFSC Code,Account Type,PAN Ready,Photo Ready,Bank Ready`
- Stage ONLY the 2 payroll files

## Report file
Write to: `c:/Users/ADMIN/Desktop/HRMS2-latest/.superpowers/sdd/esi-reg-docs/briefs/task-3-report.md`
Return only: DONE/BLOCKED/NEEDS_CONTEXT, commit SHA, test results line, concerns.
