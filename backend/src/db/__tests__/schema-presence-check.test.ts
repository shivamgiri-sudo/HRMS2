import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { checkRequiredTables, REQUIRED_TABLES } from "../schema-presence-check.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationRunnerSource = readFileSync(resolve(here, "../runPendingMigrations.ts"), "utf8");

const requiredTableCreatorMigrations: Record<string, string> = {
  employees: "002_employees.sql",
  branch_master: "001_core_org.sql",
  leave_request: "006_leave.sql",
  attendance_daily_record: "044_attendance_engine.sql",
  salary_prep_run: "007_payroll.sql",
  notification_event_config: "1022_notification_event_registry.sql",
  notification_dispatch_claim: "1023_notification_dispatch_claim.sql",
  communication_template: "040_communication.sql",
  employee_geofence_alerts: "migrations/426_employee_geofence_alerts.sql",
  tat_matrix_master: "294_tat_escalation_matrix.sql",
  escalation_matrix_master: "294_tat_escalation_matrix.sql",
  finance_grn_sequence: "414_finance_grn_sequence.sql",
  grn_request: "310_vendor_payment_tracking.sql",
  lms_employee_mapping: "251_lms_employee_mapping.sql",
};

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

  it("only names tables whose creator migration is scheduled for fresh databases", () => {
    expect(Object.keys(requiredTableCreatorMigrations).sort()).toEqual([...REQUIRED_TABLES].sort());

    for (const [tableName, migrationFile] of Object.entries(requiredTableCreatorMigrations)) {
      expect(migrationRunnerSource, `${tableName} is created by ${migrationFile}`).toContain(
        `"${migrationFile}"`,
      );
    }
  });
});
