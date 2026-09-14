import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Upload Batch History must not show one user another user's uploads.
 *
 * The endpoint shipped as `SELECT * FROM upload_batch ORDER BY created_at DESC LIMIT 50` — no
 * scope of any kind, so every role on its guard saw every upload from every branch, including the
 * file names and row counts of work that was none of their business. Measured live: a user with no
 * assignment scope was shown all 65 batches; after scoping, 40 (their own).
 *
 * This is a source-text contract rather than a behavioural test because the protection is a WHERE
 * clause, and the failure mode that matters is someone later "simplifying" the query and quietly
 * removing it. A mocked-database test would keep passing through exactly that edit.
 */

const DIR = path.dirname(fileURLToPath(import.meta.url));
const routes = fs.readFileSync(path.resolve(DIR, "../bulk-upload.routes.ts"), "utf8");

/** The GET /batches handler only — later handlers have their own, different scoping needs. */
function batchesHandler(): string {
  const start = routes.indexOf('router.get("/batches"');
  expect(start, "GET /batches handler not found").toBeGreaterThan(-1);
  const next = routes.indexOf("router.get(", start + 10);
  return routes.slice(start, next === -1 ? undefined : next);
}

describe("GET /batches is scoped", () => {
  it("never selects the whole table unfiltered", () => {
    const handler = batchesHandler();
    expect(handler).not.toContain("SELECT * FROM upload_batch ORDER BY");
    expect(handler).toContain("WHERE");
  });

  it("always lets a caller see their own uploads", () => {
    // Unconditional: whatever the scope resolves to, you can still find the file you uploaded.
    expect(batchesHandler()).toContain("ub.uploaded_by = ?");
  });

  it("delegates branch/role scope to the shared helper rather than hand-rolling it", () => {
    // buildScopeWhereClause is what this module's approval service already uses; it resolves
    // super_admin to 1=1 and a user with no assignment scope to 1=0, which is what leaves such a
    // user with their own uploads only.
    const handler = batchesHandler();
    expect(handler).toContain("buildScopeWhereClause");
    expect(routes).toContain('from "../../shared/scopeAccess.js"');
  });

  it("scopes on the effective branch, not the stamped one", () => {
    /*
     * upload_batch.branch_id is populated on only 32 of 65 live rows. Scoping on that column alone
     * would hide two thirds of the history from a branch head, including uploads that genuinely
     * belong to their branch. The uploader's own branch is the fallback, which resolves for all 65.
     */
    expect(batchesHandler()).toContain("COALESCE(ub.branch_id, uploader_emp.branch_id)");
  });

  it("resolves the uploader's display name server-side", () => {
    // auth_user holds an email and no name, so the name cannot be derived on the client.
    const handler = batchesHandler();
    expect(handler).toContain("uploaded_by_name");
    expect(handler).toContain("uploader_emp.full_name");
  });
});

describe("filters narrow, and never widen, what scope allows", () => {
  it("applies every filter as an additional AND, not as a replacement", () => {
    const handler = batchesHandler();
    // Each filter pushes onto the same `where` list that already holds the scope predicate.
    for (const column of ["ub.upload_type_code = ?", "ub.batch_status = ?", "ub.uploaded_by = ?"]) {
      expect(handler).toContain(column);
    }
    expect(handler).toContain("where.join(\" AND \")");
  });

  it("binds every filter as a parameter, interpolating nothing user-supplied into the SQL", () => {
    const handler = batchesHandler();

    /*
     * Inspect the SQL template itself, not the whole handler. An earlier version of this test
     * scanned the handler for `${search}` and failed on `params.push(`%${search}%`)` — which is
     * the safe construction, a bound parameter being built. What must not appear inside the query
     * text is any user-supplied value.
     */
    const sqlStart = handler.indexOf("`SELECT ub.*");
    expect(sqlStart, "the batches SELECT was not found").toBeGreaterThan(-1);
    const sql = handler.slice(sqlStart, handler.indexOf("`", sqlStart + 1) + 1);

    for (const name of ["uploadType", "status", "uploadedBy", "search", "from", "to"]) {
      expect(sql, `${name} must be bound, not interpolated`).not.toContain("${" + name + "}");
    }
    // LIMIT is the only interpolated value, and is clamped to a number before it gets there.
    expect(sql).toContain("LIMIT ${limit}");
    expect(handler).toContain("Math.min(200");
  });
});

describe("filter options cannot leak another branch's data", () => {
  it("scopes the options query the same way as the list", () => {
    const start = routes.indexOf('router.get("/batches/filter-options"');
    expect(start, "filter-options handler not found").toBeGreaterThan(-1);
    const handler = routes.slice(start, routes.indexOf("router.", start + 10) || undefined);
    // An unscoped options list would name upload types and uploaders the caller cannot see —
    // disclosing that another branch's uploads exist even while the rows stay hidden.
    expect(handler).toContain("buildScopeWhereClause");
    expect(handler).toContain("ub.uploaded_by = ?");
  });
});
