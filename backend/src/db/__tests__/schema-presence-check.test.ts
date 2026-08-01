import { describe, it, expect } from "vitest";
import { checkRequiredTables, REQUIRED_TABLES } from "../schema-presence-check.js";

function fakeDb(existing: string[]) {
  return {
    query: async () => [existing.map((n) => ({ TABLE_NAME: n })), []] as never,
  };
}

describe("checkRequiredTables", () => {
  it("reports nothing when every required table exists", async () => {
    const r = await checkRequiredTables(fakeDb(["employees", "leave_request"]), [
      "employees",
      "leave_request",
    ]);
    expect(r.missing).toEqual([]);
  });

  it("names the tables that are absent", async () => {
    const r = await checkRequiredTables(fakeDb(["employees"]), [
      "employees",
      "employee_geofence_alerts",
      "ats_sla_tat_rules",
    ]);
    expect(r.missing).toEqual(["ats_sla_tat_rules", "employee_geofence_alerts"]);
  });

  it("is case-insensitive, because MySQL folds table names on Windows but not Linux", async () => {
    const r = await checkRequiredTables(fakeDb(["Employees"]), ["employees"]);
    expect(r.missing).toEqual([]);
  });

  it("returns nothing missing when asked for nothing, without querying", async () => {
    let queried = false;
    const db = {
      query: async () => {
        queried = true;
        return [[], []] as never;
      },
    };
    const r = await checkRequiredTables(db, []);
    expect(r.missing).toEqual([]);
    expect(queried).toBe(false);
  });
});

describe("REQUIRED_TABLES", () => {
  it("covers the tables whose absence has already caused production errors", () => {
    // employee_geofence_alerts logged 167 errors before anyone noticed it was never created.
    expect(REQUIRED_TABLES).toContain("employee_geofence_alerts");
    expect(REQUIRED_TABLES).toContain("employees");
  });

  it("has no duplicates and is lower-case, so the comparison cannot silently miss", () => {
    expect(new Set(REQUIRED_TABLES).size).toBe(REQUIRED_TABLES.length);
    expect(REQUIRED_TABLES.every((t) => t === t.toLowerCase())).toBe(true);
  });
});
