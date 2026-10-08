import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REPORT_CATALOG } from "../report-catalog.js";

/**
 * Two places decide whether a report can be downloaded immediately, and they must agree:
 *
 *   - reporting.routes.ts  GET /api/reports/catalog
 *       computes `immediateExportAllowed`, which is what the UI reads to decide whether to
 *       render a download button at all.
 *   - report-suite.routes.ts  GET /api/reports/suite/:code/export
 *       computes `immediateAllowed`, which is what actually serves or refuses the file.
 *
 * On 2026-08-07 they disagreed. The catalog additionally required `enabled` — meaning
 * availabilityStatus of validated or validated_with_limitations — while the export
 * endpoint never looked at availabilityStatus at all. 108 of 117 catalog entries sat at
 * under_validation, so the backend would have returned the workbook for every one of them
 * while the UI showed no way to ask for it. That is the "no XLSX export exists, only
 * Request by Email" report from CEO UAT.
 *
 * The gate also protected nothing: the catalog pushes 'email' into deliveryModes on
 * viewAllowed alone, so identical rows already reached identical users by email.
 *
 * This test pins the two together. If a future change adds a condition to one gate, it has
 * to be added to the other or explained here.
 */

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const catalogSource = read("src/modules/reporting/reporting.routes.ts");
const exportSource  = read("src/modules/reporting/report-suite.routes.ts");

/** The expression assigned to a given const, flattened to single-spaced text. */
const assignedExpression = (source: string, name: string): string => {
  const start = source.indexOf(`const ${name}`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const end = source.indexOf(";", start);
  return source
    .slice(start, end)
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

describe("immediate-export gate parity", () => {
  const catalogGate = assignedExpression(catalogSource, "immediateExportAllowed");
  const exportGate  = assignedExpression(exportSource, "immediateAllowed");

  it("neither gate depends on availabilityStatus", () => {
    // Whichever way this is decided, it must be decided the same way in both places.
    // `enabled` is derived from availabilityStatus in the catalog route.
    expect(
      catalogGate,
      "the catalog gate reintroduced an availabilityStatus condition that the export " +
        "endpoint does not have — the UI would hide downloads the API still serves",
    ).not.toMatch(/\benabled\b/);

    expect(exportGate).not.toMatch(/\benabled\b/);
    expect(exportGate).not.toMatch(/availabilityStatus/);
  });

  it("both gates are built from the same two inputs: super-admin, sensitivity, export roles", () => {
    for (const [name, gate] of [["catalog", catalogGate], ["export", exportGate]] as const) {
      expect(gate, `${name} gate lost its super_admin branch`).toMatch(/isSuperAdmin/);
      expect(gate, `${name} gate lost its exportAllowed term`).toMatch(/exportAllowed/);
      expect(gate, `${name} gate lost its sensitivity term`).toMatch(/IMMEDIATE_LEVELS/);
    }
  });

  it("email delivery stays ungated by availabilityStatus, matching download", () => {
    // If email were ever gated and download were not, the asymmetry would flip the other
    // way and this comment would be the record of why.
    expect(catalogSource).toMatch(/if \(viewAllowed\)\s+deliveryModes\.push\('email'\)/);
  });
});

describe("what the fix unblocks", () => {
  it("most of the catalog is not marked validated, and that no longer hides it", () => {
    const enabled = REPORT_CATALOG.filter(r =>
      ["validated", "validated_with_limitations"].includes(r.availabilityStatus ?? "under_validation"),
    );

    // Not an assertion about the right number — validation is ongoing work. It records
    // that the large majority are unvalidated, which is exactly why gating download on
    // that flag removed the download button almost everywhere.
    expect(enabled.length).toBeLessThan(REPORT_CATALOG.length / 2);
  });
});
