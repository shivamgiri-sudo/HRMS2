import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every column the document-verify endpoint writes must exist on employee_documents.
 *
 * THE DEFECT THIS PINS
 * PATCH /api/employee-docs/:employeeId/:docId/verify wrote `updated_at = NOW()`.
 * employee_documents has no such column, so the statement raised
 * ER_BAD_FIELD_ERROR and the endpoint 500'd on every call — no document could be
 * verified or rejected through it, ever.
 *
 * Verified live 2026-08-15. The table is exactly:
 *   id, employee_id, doc_type, doc_category, legacy_source, legacy_ref_id, doc_name,
 *   file_url, verified, uploaded_by, created_at, expiry_date, verified_by,
 *   verification_date, verification_remarks
 *
 * The data agrees that it never worked: of 207,616 documents, 11,124 carry
 * verified = 1 (migrated from the legacy system) but only TWO carry a verified_by.
 * If this endpoint had ever completed, every verified row would name its verifier.
 *
 * It found no UI caller today — the client uses GET list and POST upload only — so
 * this was latent rather than actively failing users. That is exactly the state in
 * which it would have been wired up during launch and failed immediately.
 *
 * The allow-list below is the live schema. A write to a column outside it fails
 * here instead of at runtime.
 */
const SRC = readFileSync(resolve(__dirname, "../employee.documents.routes.ts"), "utf8");

const LIVE_COLUMNS = new Set([
  "id", "employee_id", "doc_type", "doc_category", "legacy_source", "legacy_ref_id",
  "doc_name", "file_url", "verified", "uploaded_by", "created_at", "expiry_date",
  "verified_by", "verification_date", "verification_remarks",
]);

/** Columns assigned in any UPDATE employee_documents ... SET ... in this file. */
function updatedColumns(src: string): string[] {
  const found = new Set<string>();
  const re = /UPDATE\s+employee_documents\s+SET\s+([\s\S]*?)\s+WHERE/gi;
  for (const m of src.matchAll(re)) {
    for (const a of m[1].matchAll(/([a-z_][a-z0-9_]*)\s*=/gi)) found.add(a[1].toLowerCase());
  }
  return [...found];
}

describe("employee_documents writes match the live schema", () => {
  it("finds the UPDATE (guards against a broken matcher)", () => {
    expect(updatedColumns(SRC).length).toBeGreaterThan(0);
  });

  it("writes no column the table does not have", () => {
    const unknown = updatedColumns(SRC).filter((c) => !LIVE_COLUMNS.has(c));
    expect(
      unknown,
      unknown.length === 0
        ? ""
        : `\nemployee_documents has no such column(s): ${unknown.join(", ")}\n` +
          `Live columns: ${[...LIVE_COLUMNS].join(", ")}\n`,
    ).toEqual([]);
  });

  it("specifically no longer writes updated_at", () => {
    expect(SRC).not.toMatch(/updated_at\s*=\s*NOW\(\)/);
  });

  it("still records who verified and when", () => {
    // The fix must not have thrown away the audit fields along with the bad one.
    expect(SRC).toMatch(/verified\s*=\s*\?/);
    expect(SRC).toMatch(/verified_by\s*=\s*\?/);
    expect(SRC).toMatch(/verification_date\s*=\s*NOW\(\)/);
    expect(SRC).toMatch(/verification_remarks\s*=\s*\?/);
  });

  it("still scopes the write to the employee, not just the document id", () => {
    // Without employee_id in the WHERE, any authorised user could verify a document
    // belonging to someone else by guessing an id.
    expect(SRC).toMatch(/WHERE id = \? AND employee_id = \?/);
  });
});
