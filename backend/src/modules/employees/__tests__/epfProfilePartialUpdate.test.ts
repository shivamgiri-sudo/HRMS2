import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * PUT /:employeeId/epf-compliance/profile used to name all 34 columns
 * unconditionally as `req.body.x ?? null`, so any field the caller omitted was
 * overwritten with NULL.
 *
 * That is not theoretical: EmployeeEpfCompliancePage has no input for
 * previous_pf_account_number, ppo_number, passport_number, gender or
 * marital_status, yet it calls this endpoint. Every save from that screen wiped
 * them — returning success, with the audit log recording the request body rather
 * than what was destroyed.
 *
 * These assertions read the source because the handler is an inline Express
 * route with no exported unit to call. That is a weaker test than exercising the
 * behaviour, so it asserts the specific shape that caused the loss rather than
 * merely that some guard exists.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "..", "employee.compliance.routes.ts"), "utf8");

// The profile handler, from its route declaration to the audit call that follows.
const handler = (() => {
  const start = src.indexOf(`put("/:employeeId/epf-compliance/profile"`);
  const end = src.indexOf("EPF_PROFILE_UPDATED", start);
  expect(start, "profile route not found").toBeGreaterThan(-1);
  expect(end, "end marker not found").toBeGreaterThan(start);
  return src.slice(start, end);
})();

describe("EPF profile update only writes what was sent", () => {
  it("does not unconditionally coalesce every column to null", () => {
    // The exact pattern that caused the loss: a column assigned req.body.x ?? null
    // inside the UPDATE's parameter list.
    const blanket = handler.match(/req\.body\.[a-z_]+ \?\? null/g) ?? [];
    expect(blanket, `still blanket-nulling: ${blanket.join(", ")}`).toEqual([]);
  });

  it("builds the SET clause from keys present in the body", () => {
    expect(handler).toMatch(/hasOwnProperty\.call\(body, key\)/);
    expect(handler).toMatch(/if \(!sent\(column\)\) continue;/);
  });

  it("writes only through a fixed column whitelist", () => {
    // The SET clause is interpolated, so the column names must never come from
    // user input.
    expect(src).toMatch(/const EPF_PROFILE_WRITABLE_COLUMNS = \[/);
    expect(handler).toMatch(/for \(const column of EPF_PROFILE_WRITABLE_COLUMNS\)/);
    // No request-derived key may reach the SQL string.
    expect(handler).not.toMatch(/Object\.keys\(body\)[^)]*\)\s*\{[^}]*sets\.push/);
  });

  it("does not let an absent boolean flag clear a stored true", () => {
    // `req.body.flag ? 1 : 0` outside a presence check turns an unsent flag into 0.
    const flags = ["previous_pf_member", "previous_eps_member", "international_worker",
      "specially_abled", "excluded_employee"];
    for (const flag of flags) {
      expect(handler, `${flag} still coerced unconditionally`)
        .not.toMatch(new RegExp(`req\\.body\\.${flag} \\? 1 : 0`));
    }
    expect(src).toMatch(/EPF_PROFILE_BOOLEAN_COLUMNS = new Set\(/);
  });

  it("still advances the stage on every save", () => {
    expect(handler).toMatch(/status = 'draft'/);
    expect(handler).toMatch(/compliance_stage = 'profile_in_progress'/);
    expect(handler).toMatch(/updated_at = NOW\(\)/);
  });

  it("keeps accepting either the raw or the pre-masked identifier", () => {
    for (const key of ["aadhaar_masked", "pan_masked", "uan_masked"]) {
      expect(handler, `${key} no longer written`).toContain(key);
    }
    expect(handler).toMatch(/keys\.some\(sent\)/);
  });
});
