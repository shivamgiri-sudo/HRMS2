# Task 1 Brief: Backend — ESI Eligibility List Endpoint

## Context
This is Task 1 of 6 for the ESI Registration Documents feature. You are adding a new backend route file for the payroll module of an Express + TypeScript + MySQL HRMS system.

## What to build
Create two files:
1. `backend/src/modules/payroll/esi-reg-docs.routes.ts` — new Router with one GET endpoint
2. `backend/src/modules/payroll/__tests__/esi-reg-docs.test.ts` — Vitest tests

## Exact implementation

### Step 1: Create `backend/src/modules/payroll/esi-reg-docs.routes.ts`

```typescript
import { Router, Request, Response } from "express";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

export const esiRegDocsRouter = Router();

const ESI_ROLES = ["payroll_branch", "payroll_head", "super_admin"] as const;

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
         (e.photo_url IS NOT NULL OR e.avatar_url IS NOT NULL) AS photo_ready,
         COALESCE(e.photo_url, e.avatar_url)              AS photo_url,
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

### Step 2: Create `backend/src/modules/payroll/__tests__/esi-reg-docs.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { esiRegDocsRouter } from "../esi-reg-docs.routes.js";

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: vi.fn() },
}));

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
      .mockResolvedValueOnce([[{ total: 1 }] as RowDataPacket[], []])
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

### Step 3: Run tests

```bash
cd backend && npx vitest run src/modules/payroll/__tests__/esi-reg-docs.test.ts
```

All 2 tests must pass.

### Step 4: TypeScript check

```bash
cd backend && npx tsc --noEmit 2>&1 | grep esi-reg
```

Must be zero errors.

### Step 5: Commit

```bash
git add backend/src/modules/payroll/esi-reg-docs.routes.ts backend/src/modules/payroll/__tests__/esi-reg-docs.test.ts
git commit -m "feat(payroll): add ESI reg-docs list endpoint with readiness flags"
```

## Global constraints
- Roles: `payroll_branch`, `payroll_head`, `super_admin` only
- No new DB tables or migrations
- PAN number never decrypted in this endpoint (text only from employees table)
- The `esiRegDocsRouter` export name is used exactly as-is by Task 4

## Report file
Write your full report to: `c:/Users/ADMIN/Desktop/HRMS2-latest/.superpowers/sdd/esi-reg-docs/briefs/task-1-report.md`

Return only: status (DONE/BLOCKED/NEEDS_CONTEXT), commit SHA, test results line, any concerns.
