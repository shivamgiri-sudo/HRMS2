import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");
const repoRoot = path.resolve(backendRoot, "..");

const readBackend = (p: string) => fs.readFileSync(path.join(backendRoot, p), "utf8");
const readRepo = (p: string) => fs.readFileSync(path.join(repoRoot, p), "utf8");

// A sharing method only works if all four layers agree: the engine's supported list, the
// dropdown, the import validator, and the route that persists its driver. Adding a method to the
// engine alone silently produces a method that can be chosen and never satisfied. Both failures
// below were found by building a real budget, not by reading the code.

describe("sharing methods are declared in exactly one place", () => {
  it("the engine supports the four driver-based methods", () => {
    const service = readBackend("src/modules/process-pnl/branch-budget-allocation.service.ts");
    for (const method of ["seat_count", "floor_area", "device_count", "hiring_volume"]) {
      expect(service).toContain(`"${method}"`);
    }
  });

  it("the import dialog derives its list instead of hardcoding one", () => {
    // This was a third hardcoded copy that had drifted behind the engine AND the dropdown: it
    // rejected grade_weighted_headcount (shipped in PR 12) plus the four driver-based methods, so
    // a valid spreadsheet failed with "Sharing Method must be one of ..." listing only six of
    // eleven. 18 of 38 rows were refused.
    const dialog = readRepo("src/components/finance/pnl/BranchBudgetImportDialog.tsx");
    expect(dialog).toMatch(/BRANCH_SHARING_METHODS\.map\(/);
    expect(dialog).not.toMatch(/const SHARING_METHODS\s*=\s*\[\s*"total_manpower"/);
  });

  it("the dropdown offers every method the engine supports", () => {
    const service = readBackend("src/modules/process-pnl/branch-budget-allocation.service.ts");
    const hook = readRepo("src/hooks/useBranchBudget.ts");
    const from = service.indexOf("const SUPPORTED_SHARING_METHODS");
    const to = service.indexOf("];", from);
    const supported = service.slice(from, to).match(/"([a-z_]+)"/g)!
      .map((s) => s.replace(/"/g, ""));
    expect(supported.length).toBeGreaterThanOrEqual(11);
    for (const method of supported) {
      expect(hook, `${method} missing from BRANCH_SHARING_METHODS`).toContain(`value: "${method}"`);
    }
  });
});

describe("the monthly-drivers route persists every driver it is sent", () => {
  it("maps seat, floor area, device and hiring volume", () => {
    // The handler mapped a whitelist of four fields, so seat/area/device/hiring were dropped on
    // the way in. The UI sent them, the API answered 200, the values vanished, and the method then
    // failed with "Monthly seat count is missing for: ..." — a silent drop presenting as a
    // configuration error.
    const routes = readBackend("src/modules/process-pnl/process-pnl.routes.ts");
    const start = routes.indexOf('"/pnl/branch-budget/monthly-drivers"', routes.indexOf("router.put"));
    const body = routes.slice(start, start + 1800);
    for (const field of ["seatCount", "floorAreaSqft", "deviceCount", "hiringVolume"]) {
      expect(body, `${field} not mapped in the PUT handler`).toContain(field);
    }
  });

  it("the service writes those columns to the driver table", () => {
    const service = readBackend("src/modules/process-pnl/branch-budget-allocation.service.ts");
    const start = service.indexOf("INSERT INTO finance_cost_centre_monthly_driver");
    const insert = service.slice(start, start + 900);
    for (const column of ["seat_count", "floor_area_sqft", "device_count", "hiring_volume"]) {
      expect(insert, `${column} missing from the driver upsert`).toContain(column);
    }
  });
});
