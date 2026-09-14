import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * No non-admin WFM user could ever update overtime.
 *
 * The middleware joined `scope_assignments` — a table that does not exist and
 * never has: no migration creates it, and nothing else in the tree names it.
 * Every call threw ER_NO_SUCH_TABLE, the catch turned it into a 500, and the
 * feature was dead. Admins were unaffected because they return before it.
 *
 * The repair must not swing the other way. The original predicate was
 * `(sa.branch_id = ? OR sa.branch_id IS NULL)` against a LEFT JOIN, so had the
 * table existed, a wfm user with no scope row would have matched the IS NULL
 * arm and been granted access to every branch.
 */
const MIDDLEWARE = path.resolve(__dirname, "../requireWFMAccess.ts");

describe("requireWFMAccess", () => {
  const code = () => fs.readFileSync(MIDDLEWARE, "utf8");

  it("no longer queries a table that does not exist", () => {
    const live = code()
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n");
    expect(live).not.toContain("scope_assignments");
  });

  it("resolves scope through the shared helper, not a hand-rolled join", () => {
    expect(code()).toContain("hasScopedAccess");
    expect(code()).toContain('["wfm"]');
  });

  it("does not opt out of requiring a scope row for non-admins", () => {
    // hasScopedAccess defaults requireScopeForNonAdmin to true. Passing false
    // here would re-create the original fail-open: any wfm user, any branch.
    expect(code()).not.toContain("requireScopeForNonAdmin: false");
  });

  it("still lets admins through before any scope lookup", () => {
    const src = code();
    const adminIdx = src.indexOf("Admin has full access");
    // the CALL, not the import at the top of the file
    const scopeIdx = src.indexOf("await hasScopedAccess(");
    expect(adminIdx).toBeGreaterThan(-1);
    expect(scopeIdx).toBeGreaterThan(-1);
    expect(adminIdx).toBeLessThan(scopeIdx);
  });
});
