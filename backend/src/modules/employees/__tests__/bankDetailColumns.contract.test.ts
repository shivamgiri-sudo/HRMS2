/**
 * employee_bank_detail has no masked_account_number or verification_status column —
 * confirmed live (SHOW COLUMNS) and empirically (the exact queries these three
 * endpoints ran threw "Unknown column ... in 'field list'" against production).
 * POST /me/bank-change-request, PUT /me/bank-details and PUT /:employeeId/bank-details
 * all referenced one or both, so every call 500'd. The real verification flag is
 * `verified` (tinyint) — already documented elsewhere in this codebase
 * (dashboardSqlManifest.ts, dashboard-drilldown.service.ts) — and the masked value is
 * computed in JS from account_number on read, never stored.
 *
 * Source-text inspection, matching this repo's established contract-test style: the
 * goal is to catch either nonexistent column name coming back into a query against
 * employee_bank_detail, not to exercise a live DB.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rawSource = readFileSync(
  resolve(process.cwd(), "src/modules/employees/employee.routes.ts"),
  "utf8",
);

/** Strip comments so a call site that is only MENTIONED in prose does not count. */
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");


/**
 * employee.routes.ts is prettier-formatted now, so a registration reads
 * `router.put(\n  "/path",` rather than `router.put("/path",`. Joining the verb to its path
 * keeps the route literals below formatting-independent.
 */
const joinRouteVerbs = (s: string): string =>
  s.replace(/\b(router\.(?:get|post|put|patch|delete|use))\(\s+/g, "$1(");

/** A handler runs from its registration to the next top-level `router.` registration. */
function sliceRoute(src: string, idx: number): string {
  const next = src.slice(idx + 1).search(/^router\.(?:get|post|put|patch|delete|use)\(/m);
  return next === -1 ? src.slice(idx) : src.slice(idx, idx + 1 + next);
}

const source = joinRouteVerbs(stripComments(rawSource));

/** Isolate a route handler body so a match elsewhere in the file doesn't count. */
function routeBody(routeLiteral: string): string {
  const idx = source.indexOf(routeLiteral);
  expect(idx, `route registration "${routeLiteral}" not found`).toBeGreaterThan(-1);
  // The WHOLE handler: a fixed 2000-char window no longer covers the reformatted handlers,
  // and a column name past the cut-off would have gone unchecked.
  return sliceRoute(source, idx);
}

/**
 * The SELECT column list of the first query against a given table in `body`. Scoped
 * to the SQL text specifically — a masked value legitimately computed as a JS object
 * property (e.g. `masked_account_number: ...` built in application code, not selected
 * from the DB) must not trip this check.
 */
function selectColumnsFor(body: string, table: string): string {
  const m = body.match(new RegExp(`SELECT([\\s\\S]*?)FROM\\s+${table}\\b`));
  return m ? m[1] : "";
}

describe("employee_bank_detail write/read paths do not reference nonexistent columns", () => {
  it("POST /me/bank-change-request does not select masked_account_number from employee_bank_detail", () => {
    const body = routeBody('router.post("/me/bank-change-request"');
    expect(
      selectColumnsFor(body, "employee_bank_detail"),
      "masked_account_number is not a real column on employee_bank_detail — this query 500'd on every call in production",
    ).not.toContain("masked_account_number");
  });

  it("PUT /me/bank-details does not write verification_status or masked_account_number", () => {
    const body = routeBody('router.put("/me/bank-details"');
    expect(body).not.toContain("verification_status");
    expect(body).not.toContain("masked_account_number");
  });

  it("PUT /:employeeId/bank-details (HR entry) does not write verification_status or masked_account_number", () => {
    const body = routeBody('router.put("/:employeeId/bank-details"');
    expect(body).not.toContain("verification_status");
    expect(body).not.toContain("masked_account_number");
  });
});
