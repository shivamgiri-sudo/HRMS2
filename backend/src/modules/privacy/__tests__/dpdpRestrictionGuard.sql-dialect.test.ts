/**
 * The guard's own SQL must be executable by the MySQL it runs on.
 *
 * dpdpRestrictionGuard fails CLOSED: any error from its lookup returns 503
 * "Privacy restriction check temporarily unavailable. Please retry." That is the
 * right call for a §13 restriction check — but it means a malformed query is
 * indistinguishable, from the outside, from a database blip, and it takes down
 * every route the guard is mounted on rather than one.
 *
 * That is exactly what happened. The subquery carried a LIMIT 1:
 *
 *     dcw.requester_id IN (SELECT e.user_id FROM employees e WHERE e.id = ? LIMIT 1)
 *
 * MySQL rejects LIMIT inside IN/ALL/ANY/SOME with ER_NOT_SUPPORTED_YET, so the
 * statement threw on EVERY UUID-shaped target. The guard is mounted in app.ts on
 * app.use("/api/employees/:employeeId", ...), so the result was a blanket 503
 * across all employee-scoped APIs — reported from the AON analytics drill-down,
 * but never specific to it. Reproduced directly against production MySQL 8.0.42.
 *
 * The existing wiring test mocks db.execute and therefore could never see this:
 * a mock happily "runs" SQL no real server would accept. Hence a dialect check
 * on the query text itself.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(import.meta.dirname, "..", "dpdpRestrictionGuard.ts"),
  "utf8",
);

/** Strip line comments so the explanatory note above the fix is not scanned. */
const sqlText = SOURCE.split("\n")
  .filter((line) => !line.trim().startsWith("--") && !line.trim().startsWith("//") && !line.trim().startsWith("*"))
  .join("\n");

describe("dpdpRestrictionGuard SQL dialect", () => {
  it("uses no LIMIT inside an IN/ALL/ANY/SOME subquery", () => {
    // MySQL: ER_NOT_SUPPORTED_YET. The guard fails closed, so this does not
    // degrade one lookup — it 503s every route the guard covers.
    // [^()]* keeps the scan INSIDE the subquery. A looser [\s\S]*? runs straight
    // past the closing paren and matches the statement's own trailing LIMIT 1,
    // which is legal and must not be flagged.
    const offending = /\b(?:IN|ALL|ANY|SOME)\s*\(\s*SELECT[^()]*\bLIMIT\b/i;
    expect(
      offending.test(sqlText),
      "LIMIT inside an IN/ALL/ANY/SOME subquery — MySQL raises ER_NOT_SUPPORTED_YET, " +
        "and because this guard fails closed that becomes a blanket 503 on every " +
        "route it is mounted on, not a single failed check.",
    ).toBe(false);
  });

  it("still resolves the employee-id form of the target, not only auth_user.id", () => {
    // The LIMIT was redundant, never load-bearing: employees.id is the primary
    // key. Removing it must not have removed the employees lookup itself, which
    // is what lets the guard accept an employees.id as well as an auth_user.id.
    expect(sqlText).toMatch(/SELECT\s+e\.user_id\s+FROM\s+employees\s+e\s+WHERE\s+e\.id\s*=\s*\?/i);
  });

  it("keeps failing closed — the 503 path is deliberate and must not become a bypass", () => {
    expect(SOURCE).toMatch(/DPDP_RESTRICTION_CHECK_FAILED/);
    expect(SOURCE).toMatch(/res\.status\(503\)/);
    expect(SOURCE, "a catch that calls next() would turn a DB error into silent access").not.toMatch(
      /catch[\s\S]{0,200}?\bnext\(\)/,
    );
  });
});
