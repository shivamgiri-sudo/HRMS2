import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import {
  SUPPORTED_ALLOCATION_DRIVERS,
  isSupportedAllocationDriver,
} from "../bpo-pnl.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");
const read = (p: string) => fs.readFileSync(path.join(backendRoot, p), "utf8");

// Process P&L declared nine allocation drivers but could only satisfy seven. floor_area and
// device_count had no `case` in either resolver, so a pool configured with one of them fell
// through `default` and was split by ACTIVE HEADCOUNT — the wrong basis, applied silently, while
// the policy screen still showed the driver the user had picked. Nothing validated the driver on
// save either, so the misconfiguration was easy to create and impossible to notice.

describe("Process P&L allocation drivers", () => {
  it("does not claim to support a driver it has no data for", () => {
    // The floor_area_sqft / device_count columns from migration 434 are per COST CENTRE per
    // period, for branch budgets. Process P&L works at process grain and has neither.
    expect(isSupportedAllocationDriver("floor_area")).toBe(false);
    expect(isSupportedAllocationDriver("device_count")).toBe(false);
  });

  it("supports exactly the drivers the resolver can satisfy from a P&L row", () => {
    expect([...SUPPORTED_ALLOCATION_DRIVERS].sort()).toEqual(
      ["active_hc", "billable_hc", "contracted_seats", "direct", "equal", "manual", "revenue"]
    );
  });

  it("refuses to save a policy with an unsupported driver", () => {
    const service = read("src/modules/process-pnl/bpo-pnl.service.ts");
    const start = service.indexOf("async saveAllocationPolicy(");
    expect(start).toBeGreaterThan(-1);
    const next = service.indexOf("\n  async ", start + 10);
    const body = service.slice(start, next > -1 ? next : undefined);
    expect(body).toContain("isSupportedAllocationDriver");
    expect(body).toMatch(/is not supported for Process P&L/);
  });

  it("names the unsatisfiable drivers in both resolvers instead of leaving them to default", () => {
    // Both files must show the substitution as a deliberate, greppable decision. A bare `default`
    // is what hid the bug: nothing in the code said headcount was being used instead.
    for (const file of [
      "src/modules/process-pnl/bpo-pnl.service.ts",
      "src/modules/process-pnl/bpo-pnl-allocation-overlay.service.ts",
    ]) {
      const source = read(file);
      expect(source, `${file} must name floor_area explicitly`).toMatch(/case "floor_area":/);
      expect(source, `${file} must name device_count explicitly`).toMatch(/case "device_count":/);
    }
  });
});
