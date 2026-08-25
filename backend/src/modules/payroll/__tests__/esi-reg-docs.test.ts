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

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (_req as any).authUser = { id: "user-1", roles: ["payroll_head"] };
    next();
  },
}));

vi.mock("archiver", () => {
  return {
    default: vi.fn(() => {
      let _dest: any = null;
      const archiveMock = {
        append: vi.fn().mockReturnThis(),
        file: vi.fn().mockReturnThis(),
        pipe: vi.fn((dest: any) => { _dest = dest; return archiveMock; }),
        on: vi.fn().mockReturnThis(),
        finalize: vi.fn(() => {
          if (_dest && typeof _dest.end === "function") _dest.end();
          return Promise.resolve();
        }),
      };
      return archiveMock;
    }),
  };
});

import { db } from "../../../db/mysql.js";

const app = express();
app.use(express.json());
app.use("/api/payroll", esiRegDocsRouter);

describe("GET /api/payroll/esi-reg-docs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns paginated ESI-eligible employees with readiness flags", async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce([[{ total: 1 }] as any, []])
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
        ] as any,
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

describe("GET /api/payroll/esi-reg-docs/:employeeId/download", () => {
  beforeEach(() => vi.clearAllMocks());

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

describe("POST /api/payroll/esi-reg-docs/bulk-download", () => {
  beforeEach(() => vi.clearAllMocks());

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

  it("returns 200 zip when valid employee_ids supplied", async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce([[{ id: "emp-1", emp_code: "EMP001", name: "Alice Smith", esic_number: "123", photo_url: null, avatar_url: null }] as any, []])
      .mockResolvedValueOnce([[] as any, []]) // no pan doc
      .mockResolvedValueOnce([[] as any, []]); // no bank detail for PDF

    const res = await request(app)
      .post("/api/payroll/esi-reg-docs/bulk-download")
      .send({ employee_ids: ["emp-1"] })
      .buffer(true)
      .parse((res: any, cb: any) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/zip/);
  });
});

describe("GET /api/payroll/esi-reg-docs/export-csv", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns CSV with BOM, all 12 column headers, and masked account number", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([
      [{
        emp_code: "EMP001",
        name: "Alice Smith",
        branch: "Chennai",
        esic_number: "1234567890",
        pan_number: "ABCDE1234F",
        bank_name: "SBI",
        account_number: "9876543210",
        ifsc_code: "SBIN0001234",
        account_type: "savings",
        pan_ready: 1,
        photo_ready: 1,
        bank_ready: 1,
      }] as any,
      [],
    ]);

    const res = await request(app).get("/api/payroll/esi-reg-docs/export-csv");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    const expectedColumns = [
      "Emp Code", "Name", "Branch", "ESIC Number", "PAN Number",
      "Bank Name", "Account Number (Masked)", "IFSC Code",
      "Account Type", "PAN Ready", "Photo Ready", "Bank Ready",
    ];
    for (const col of expectedColumns) {
      expect(res.text).toContain(col);
    }
    expect(res.text).toContain("****3210");
    expect(res.text).not.toContain("9876543210");
  });
});
