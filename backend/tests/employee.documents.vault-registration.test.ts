/**
 * POST /api/employee-docs/:employeeId/upload — vault registration guard.
 *
 * This upload handler saves the file to disk via multer, then used to insert
 * straight into employee_documents with no corresponding
 * document_vault_inventory row. GET /api/files/employee-documents/:filename —
 * what the Profile Documents tab actually requests for preview/download —
 * looks the file up in that same vault table and 403s with
 * VAULT_ITEM_NOT_FOUND when no row exists (documentVaultAuth.ts). So every
 * document uploaded through this route was unrecoverable by anyone,
 * including the uploader, until registerUpload() is called here too.
 *
 * These tests exercise the real multer disk-storage path (so a real,
 * temporary file lands under backend/uploads/employee-documents/ during the
 * run and is cleaned up after), while mocking the DB, auth and vault-service
 * boundaries — the same shape as
 * backend/src/modules/payroll/__tests__/tds-certificate-part-a.routes.test.ts.
 */
import express from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const UPLOAD_DIR = join(backendRoot, "uploads", "employee-documents");

const EMPLOYEE_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";

const { dbExecute, registerUpload } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  registerUpload: vi.fn(),
}));

vi.mock("../src/db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../src/modules/document-vault/documentVault.service.js", () => ({ registerUpload }));
vi.mock("../src/middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: { id: string } }).authUser = { id: USER_ID };
    next();
  },
}));
vi.mock("../src/middleware/requireRole.js", () => ({
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));
vi.mock("../src/shared/accessGuard.js", () => ({
  // Ownership/role check is a separate concern from vault registration —
  // pass through so these tests focus on what happens after auth succeeds.
  selfOrAdminHr: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

const { employeeDocsRouter } = await import("../src/modules/employees/employee.documents.routes.js");

function app() {
  const a = express();
  a.use("/api/employee-docs", employeeDocsRouter);
  return a;
}

// Minimal valid PDF header so any future magic-byte checks on this route
// would also pass; %PDF-1.4 plus an EOF marker.
const FAKE_PDF = Buffer.from("%PDF-1.4\n%%EOF\n");

function uploadedFiles(): string[] {
  return fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR) : [];
}

describe("POST /api/employee-docs/:employeeId/upload", () => {
  const before = new Set<string>();

  beforeEach(() => {
    dbExecute.mockReset();
    registerUpload.mockReset();
    before.clear();
    for (const f of uploadedFiles()) before.add(f);
  });

  afterAll(() => {
    // Clean up anything this suite left behind.
    for (const f of uploadedFiles()) {
      if (!before.has(f)) {
        try { fs.unlinkSync(join(UPLOAD_DIR, f)); } catch {}
      }
    }
  });

  it("registers the upload in the document vault with the employee as owner, access_level pii", async () => {
    registerUpload.mockResolvedValue("vault-item-1");
    dbExecute.mockResolvedValueOnce([{ insertId: 0 }] as any); // INSERT
    dbExecute.mockResolvedValueOnce([[{ id: "doc-1", employee_id: EMPLOYEE_ID, document_type: "pan_card", document_name: "pan.pdf", file_url: "/api/files/employee-documents/x.pdf", verified: 0, uploaded_at: new Date() }]] as any); // SELECT

    const res = await request(app())
      .post(`/api/employee-docs/${EMPLOYEE_ID}/upload`)
      .field("document_type", "pan_card")
      .attach("file", FAKE_PDF, "pan.pdf");

    expect(res.status).toBe(201);
    expect(registerUpload).toHaveBeenCalledTimes(1);
    const call = registerUpload.mock.calls[0][0];
    expect(call.category).toBe("employee-documents");
    expect(call.ownerEmployeeId).toBe(EMPLOYEE_ID);
    expect(call.accessLevel).toBe("pii");
    expect(call.uploadedByUser).toBe(USER_ID);
    expect(call.originalFilename).toBe("pan.pdf");
    expect(typeof call.storedFilename).toBe("string");
    expect(call.storedFilename.length).toBeGreaterThan(0);

    // The DB row must be inserted only after (successful) vault registration —
    // never register two representations of a file where only one exists.
    expect(dbExecute).toHaveBeenCalled();
  });

  it("rolls back: does not insert the DB row and deletes the physical file when vault registration fails", async () => {
    registerUpload.mockRejectedValue(new Error("db down"));

    const res = await request(app())
      .post(`/api/employee-docs/${EMPLOYEE_ID}/upload`)
      .field("document_type", "aadhaar_card")
      .attach("file", FAKE_PDF, "aadhaar.pdf");

    expect(res.status).toBe(500);
    expect(res.body.code).toBe("VAULT_REGISTRATION_FAILED");
    // No employee_documents row for a file that isn't (and now never will be)
    // recorded in the vault — no untracked files, no orphaned DB rows either.
    expect(dbExecute).not.toHaveBeenCalled();

    // The physical file multer wrote must have been deleted on rollback —
    // no files present after this request beyond what existed before it.
    const after = uploadedFiles().filter((f) => !before.has(f));
    expect(after).toEqual([]);
  });
});
