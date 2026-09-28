import { randomUUID } from "crypto";
import { promises as fsp } from "fs";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Reported 2026-09-24: raising a GRN with a 50+ page scanned PDF failed with HTTP 413. The
 * production reverse proxy refuses request bodies over 20 MB before the API sees them, so a
 * large invoice could never be attached. The browser now sends such a file in pieces to
 * /documents/chunk; these tests pin that the pieces are joined byte-exact and registered once.
 */

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(), query: vi.fn(), getConnection: vi.fn() } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireWriteAccess: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../finance-access-scope.js", () => ({ assertFinanceRecordBranch: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../finance-workflow-role.js", () => ({ resolveFinanceStageRole: vi.fn() }));
vi.mock("../grn-validation-control.service.js", () => ({ grnValidationControlService: {} }));
vi.mock("../grn.service.js", () => ({
  grnService: { getGrn: vi.fn().mockResolvedValue({ id: "grn-1", branch_id: "b1" }) },
}));

const registered: Array<{ storedPath: string; content: Buffer; originalName: string; mimeType: string; fileSizeBytes: number; isPrimary: boolean }> = [];
vi.mock("../grn-smart.service.js", () => ({
  grnSmartService: {
    registerDocuments: vi.fn(async (_grnId: string, files: any[]) => {
      for (const file of files) {
        registered.push({ ...file, content: await fsp.readFile(file.storedPath) });
      }
      return files.map((file) => ({ id: "doc-1", original_name: file.originalName }));
    }),
  },
}));

import { smartGrnRouter } from "../grn-smart.routes.js";

function app() {
  const server = express();
  server.use((req: any, _res, next) => {
    req.authUser = { id: "u1", role: "branch_head" };
    req.userRoles = ["branch_head"];
    next();
  });
  server.use("/api/finance/grns", smartGrnRouter);
  return server;
}

function sendPart(uploadId: string, index: number, total: number, part: Buffer, fileName = "invoice.pdf") {
  return request(app())
    .post("/api/finance/grns/grn-1/documents/chunk")
    .field("uploadId", uploadId)
    .field("index", String(index))
    .field("total", String(total))
    .field("fileName", fileName)
    .field("documentType", "invoice")
    .field("isPrimary", "true")
    .attach("chunk", part, fileName);
}

beforeEach(() => {
  registered.length = 0;
});

afterEach(async () => {
  for (const file of registered) await fsp.rm(file.storedPath, { force: true });
});

describe("POST /:id/documents/chunk", () => {
  it("joins the parts in order and registers one document", async () => {
    const uploadId = randomUUID();
    const parts = [Buffer.from("%PDF-1.7 part-zero "), Buffer.from("part-one "), Buffer.from("part-two %%EOF")];

    const first = await sendPart(uploadId, 0, 3, parts[0]);
    expect(first.status).toBe(202);
    const second = await sendPart(uploadId, 1, 3, parts[1]);
    expect(second.status).toBe(202);
    expect(registered).toHaveLength(0);

    const last = await sendPart(uploadId, 2, 3, parts[2]);
    expect(last.status).toBe(201);
    expect(registered).toHaveLength(1);
    expect(registered[0].content.equals(Buffer.concat(parts))).toBe(true);
    expect(registered[0].fileSizeBytes).toBe(Buffer.concat(parts).length);
    expect(registered[0].originalName).toBe("invoice.pdf");
    expect(registered[0].mimeType).toBe("application/pdf");
    expect(registered[0].isPrimary).toBe(true);
  });

  it("completes regardless of the order the parts arrive in", async () => {
    const uploadId = randomUUID();
    await sendPart(uploadId, 1, 2, Buffer.from("BBBB"));
    const done = await sendPart(uploadId, 0, 2, Buffer.from("AAAA"));
    expect(done.status).toBe(201);
    expect(registered[0].content.toString()).toBe("AAAABBBB");
  });

  it("refuses a file type the direct upload would also refuse", async () => {
    const res = await sendPart(randomUUID(), 0, 1, Buffer.from("MZ"), "payload.exe");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("payload.exe");
    expect(registered).toHaveLength(0);
  });

  it("refuses a malformed upload id, so it cannot be used as a path", async () => {
    const res = await sendPart("../../etc", 0, 1, Buffer.from("x"));
    expect(res.status).toBe(400);
    expect(registered).toHaveLength(0);
  });

  it("refuses a part number outside the declared total", async () => {
    const res = await sendPart(randomUUID(), 3, 2, Buffer.from("x"));
    expect(res.status).toBe(400);
  });
});
