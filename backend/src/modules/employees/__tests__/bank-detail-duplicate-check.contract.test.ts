/**
 * Cross-employee bank-account duplicate check, wired into PUT /:employeeId/bank-details
 * (HR entry) — matches the same wiring added to PATCH /api/payroll/bank-change-requests/:id
 * (see bank-change-requests.routes.test.ts).
 *
 * Both write paths previously carried a TODO pointing at bankAccountDuplicate.ts's
 * findDuplicateAccountOwner(), written and unit-tested but called from zero routes.
 * Migration 1136 (the blind-index column) is applied to production; the one-time backfill
 * of existing rows has not run yet, so this check only catches a duplicate against another
 * account written after that migration — narrower than "no duplicate accounts exist," but
 * strictly better than the no-check status quo it replaces, and every row this route writes
 * now stores its own index, which shrinks the backfill's remaining scope.
 *
 * Source-text inspection, matching this repo's established style for this exact file's
 * bank-detail routes (see bankDetailColumns.contract.test.ts).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rawSource = readFileSync(resolve(process.cwd(), "src/modules/employees/employee.routes.ts"), "utf8");

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

function routeBody(routeLiteral: string): string {
  const idx = source.indexOf(routeLiteral);
  expect(idx, `route registration "${routeLiteral}" not found`).toBeGreaterThan(-1);
  return sliceRoute(source, idx);
}

describe("PUT /:employeeId/bank-details checks for a cross-employee duplicate account", () => {
  const body = routeBody('router.put("/:employeeId/bank-details"');

  it("calls findDuplicateAccountOwner before writing, excluding the employee's own record", () => {
    expect(body).toMatch(/findDuplicateAccountOwner\(\s*String\(account_number\),\s*empId,?\s*\)/);
  });

  it("refuses with 409 naming the other employee when a duplicate is found", () => {
    const checkBlock = body.slice(body.indexOf("findDuplicateAccountOwner"), body.indexOf("findDuplicateAccountOwner") + 400);
    expect(checkBlock).toMatch(/status\(409\)/);
    expect(checkBlock).toMatch(/dup\.employeeCode/);
  });

  it("checks for a duplicate before the INSERT, not after", () => {
    const dupAt = body.indexOf("findDuplicateAccountOwner");
    const insertAt = body.indexOf("INSERT INTO employee_bank_detail");
    expect(dupAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(dupAt);
  });

  it("computes and stores account_number_blind_index alongside the encrypted value", () => {
    expect(body).toMatch(/computeAccountBlindIndex\(String\(account_number\)\)/);
    expect(body).toContain('fields.push("account_number_blind_index")');
    expect(body).toContain("account_number_blind_index = VALUES(account_number_blind_index)");
  });
});
