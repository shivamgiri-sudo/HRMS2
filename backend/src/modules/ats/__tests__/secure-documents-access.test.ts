import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who may download a candidate's identity documents.
 *
 * The role list on these endpoints WAS the whole access control — actorId reaches only
 * auditDocumentAccess, and nothing in the service checks ownership, assignment or branch. So the
 * list had to match the surface that uses it, and it did not: it carried branch_head, finance,
 * operations_manager and it, on top of the four the UI grants.
 *
 * The only consumer is SecureDocumentList / SecureDocumentViewer, rendered solely by
 * NativeJoiningControlRoom, whose ProtectedRoute and navConfig entry both admit exactly
 * ['admin','hr','payroll_hr','super_admin']. The extra four could not open the screen but could
 * call the API directly and stream any candidate's documents by id.
 *
 * This pins the API to the UI's own list. If the page is ever opened to another role, this test
 * fails and the two are reconciled deliberately rather than drifting apart again — in whichever
 * direction.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

const { listCandidateDocuments, getDocumentMetadata } = vi.hoisted(() => ({
  listCandidateDocuments: vi.fn(async () => []),
  getDocumentMetadata: vi.fn(async () => ({ preview_url: "x" })),
}));
vi.mock("../secure-documents.service.js", () => ({
  listCandidateDocuments,
  getDocumentMetadata,
  getDocumentAudit: vi.fn(async () => []),
  getDocumentFile: vi.fn(async () => ({ document: {}, filePath: "/nope" })),
  verifyCandidateDocument: vi.fn(),
  rejectCandidateDocument: vi.fn(),
  requestDocumentReupload: vi.fn(),
}));

let actor: { id: string; role: string; roles: string[] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return {
    ...original,
    requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); },
  };
});

import { secureDocumentsRouter } from "../secure-documents.routes.js";

/** Exactly the list NativeJoiningControlRoom's ProtectedRoute and navConfig entry grant. */
const PAGE_ROLES = ["admin", "hr", "payroll_hr", "super_admin"];
/** In the API list before this fix, and unable to open the page in any build. */
const REMOVED = ["branch_head", "finance", "operations_manager", "it"];

function appFor(role: string) {
  actor = { id: `u-${role}`, role, roles: [role] };
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.authUser = actor; req.userRoles = actor.roles; next(); });
  app.use("/api/ats", secureDocumentsRouter);
  return app;
}

beforeEach(() => {
  execute.mockReset().mockResolvedValue([[], []]);
  listCandidateDocuments.mockClear();
});

describe("candidate document access", () => {
  for (const role of PAGE_ROLES) {
    it(`allows ${role}, which the page itself grants`, async () => {
      const res = await request(appFor(role)).get("/api/ats/candidates/c1/documents");
      expect(res.status).toBe(200);
    });
  }

  for (const role of REMOVED) {
    it(`refuses ${role}, which cannot open the page`, async () => {
      const res = await request(appFor(role)).get("/api/ats/candidates/c1/documents");
      expect(res.status, `${role} must not read candidate documents`).toBe(403);
      expect(listCandidateDocuments, "the service must not be reached").not.toHaveBeenCalled();
    });
  }

  it("refuses the download of a document by id to a removed role", async () => {
    // The endpoint that actually returns the file bytes.
    const res = await request(appFor("it")).get("/api/ats/documents/d1/download");
    expect(res.status).toBe(403);
  });

  it("refuses the access log to a removed role", async () => {
    // Who ELSE viewed a candidate's identity documents is itself sensitive.
    const res = await request(appFor("finance")).get("/api/ats/documents/d1/audit");
    expect(res.status).toBe(403);
  });
});
