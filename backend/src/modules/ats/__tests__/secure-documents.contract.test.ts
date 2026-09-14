/**
 * Secure candidate document viewer: mount, schema and status contract.
 *
 * The JCLR "Documents" tab (SecureDocumentList -> SecureDocumentViewer) calls
 * nine endpoints under /api/ats. Three independent defects meant none of them
 * had ever worked, all verified against the live production schema on
 * 2026-07-31:
 *
 * 1. secureDocumentsRouter was exported but never imported by app.ts. The
 *    compiled router sat in dist/ on production with nothing referencing it, so
 *    every call fell through to the 404 handler. (Probing could not show this
 *    directly — clientRouter applies requireAuth on the bare /api prefix, so an
 *    unauthenticated request to a missing route 401s just like a real one.)
 *
 * 2. Both UNION branches selected COALESCE(document_name, ...) from
 *    ats_candidate_documents. That table has no document_name column — migration
 *    272 added six columns to it and that was not one of them. Live:
 *      ERROR 1054: Unknown column 'document_name' in 'field list'
 *    so list/metadata/preview/stream/download/audit would have 500'd even once
 *    mounted.
 *
 * 3. rejectCandidateDocument() writes document_status = 'rejected', which is not
 *    in that column's ENUM. Migration 272 added rejected_by/rejected_at/
 *    rejection_reason but never the matching status value. Under the live
 *    STRICT_TRANS_TABLES setting this is ERROR 1265, not a silent coercion.
 *    Live census confirmed the path had never succeeded: 0 rows with
 *    rejected_at, 0 with rejection_reason, out of 272 documents.
 *
 * These are source/manifest assertions rather than DB round-trips: the suite has
 * no live database, and each failure was a mismatch between what the SQL text
 * references and what the schema provides — exactly what source assertions catch
 * and a mocked DB would not.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(resolve(process.cwd(), relative), "utf8");

const app = read("src/app.ts");
const service = read("src/modules/ats/secure-documents.service.ts");
const routes = read("src/modules/ats/secure-documents.routes.ts");
const runner = read("src/db/runPendingMigrations.ts");
const migration272 = read("sql/272_hrms2_joining_control_room_document_viewer.sql");
const migration1024 = read("sql/1024_candidate_onboarding_document_rejected_status.sql");

/**
 * Live columns of ats_candidate_documents, read from information_schema on
 * production 2026-07-31. Note the absence of document_name.
 */
const ATS_CANDIDATE_DOCUMENTS_COLUMNS = [
  "id", "candidate_id", "document_type", "file_name", "file_url", "file_mime_type",
  "file_size", "mandatory_flag", "sensitive_flag", "consent_purpose",
  "name_match_status", "verification_status", "verified_by", "verified_at",
  "rejection_reason", "uploaded_at",
];

/** Pull the values out of the first ENUM(...) for a named column in a SQL file. */
function enumValues(sql: string, columnName: string): string[] {
  const match = new RegExp(`${columnName}\\s+ENUM\\(([^)]*)\\)`, "i").exec(sql);
  if (!match) throw new Error(`no ENUM found for ${columnName}`);
  return [...match[1].matchAll(/'{1,2}([a-z_]+)'{1,2}/gi)].map((m) => m[1]);
}

describe("secure document viewer — router mount", () => {
  it("app.ts imports and mounts secureDocumentsRouter", () => {
    expect(app).toContain('import { secureDocumentsRouter } from "./modules/ats/secure-documents.routes.js"');
    expect(app).toContain('app.use("/api/ats", secureDocumentsRouter)');
  });

  it("mounts it after clientRouter, so requireAuth has populated req.authUser", () => {
    // verify/reject/request-reupload dereference req.authUser!.id — an unauth'd
    // request reaching them would throw rather than 401.
    expect(routes).toContain("req.authUser!.id");
    const clientRouterMount = app.indexOf('app.use("/api", clientRouter)');
    const secureMount = app.indexOf('app.use("/api", secureDocumentsRouter)') >= 0
      ? app.indexOf('app.use("/api", secureDocumentsRouter)')
      : app.indexOf('app.use("/api/ats", secureDocumentsRouter)');
    expect(clientRouterMount).toBeGreaterThan(-1);
    expect(secureMount).toBeGreaterThan(clientRouterMount);
  });

  it("does not collide with a route another ats router already owns", () => {
    // atsRouter is mounted on the same /api/ats prefix and wins on overlap.
    const atsRoutes = read("src/modules/ats/ats.routes.ts");
    expect(atsRoutes).not.toMatch(/atsRouter\.\w+\(\s*"\/documents\//);
    expect(atsRoutes).not.toMatch(/atsRouter\.\w+\(\s*"\/candidates\/:\w+\/documents"/);
  });
});

describe("secure document viewer — ats_candidate_documents columns", () => {
  it("never reads document_name, which that table does not have", () => {
    expect(ATS_CANDIDATE_DOCUMENTS_COLUMNS).not.toContain("document_name");
    expect(service).not.toContain("COALESCE(document_name");
  });

  it("derives the document_name alias from columns that do exist", () => {
    const matches = [...service.matchAll(/COALESCE\(file_name, document_type\) AS document_name/g)];
    // Once in listCandidateDocuments, once in getCandidateDocument.
    expect(matches).toHaveLength(2);
    for (const column of ["file_name", "document_type"]) {
      expect(ATS_CANDIDATE_DOCUMENTS_COLUMNS).toContain(column);
    }
  });
});

describe("secure document viewer — document_status values", () => {
  it("migration 1024 adds 'rejected' while keeping every value 272 shipped", () => {
    const after = enumValues(migration1024, "document_status");
    expect(after).toContain("rejected");
    for (const preexisting of [
      "uploaded", "verification_pending", "verified", "mismatch",
      "failed", "manual_review", "waived", "deleted", "file_missing",
    ]) {
      expect(after).toContain(preexisting);
    }
    // Appending keeps existing rows' ordinals stable; reordering would rewrite them.
    expect(after[after.length - 1]).toBe("rejected");
  });

  it("every status the service writes is a value the column accepts", () => {
    const allowed = enumValues(migration1024, "document_status");
    const written = [...service.matchAll(/SET document_status = '([a-z_]+)'/g)].map((m) => m[1]);
    expect(written).toContain("verified");
    expect(written).toContain("rejected");
    for (const status of written) expect(allowed).toContain(status);
  });

  it("is registered in the migration manifest, or it never runs", () => {
    expect(runner).toContain("1024_candidate_onboarding_document_rejected_status.sql");
  });
});

describe("secure document viewer — access log", () => {
  it("every audited access_type is a value the 272 enum accepts", () => {
    const allowed = enumValues(migration272, "access_type");
    const audited = [...service.matchAll(/auditDocumentAccess\([^,]+,[^,]+,\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(audited.length).toBeGreaterThan(0);
    for (const accessType of audited) expect(allowed).toContain(accessType);
    // stream/download reach the log through the accessType parameter instead.
    for (const accessType of ["stream", "download"]) expect(allowed).toContain(accessType);
  });
});
