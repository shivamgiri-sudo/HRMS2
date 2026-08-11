import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";

import { db } from "../../../db/mysql.js";
import { employeeService } from "../employee.service.js";

/**
 * The daily activation job grants login access, and had no notion of approval.
 *
 * Deactivation is governed — a stated reason, and getting back in needs
 * branch-head approval plus HR confirmation via /employees/reactivation. But the
 * API guard only refuses setting the label to "Active". Setting a deactivated
 * employee to "Onboarding" or "On Notice" — neither excluded by the job — handed
 * their access back that night with nobody approving it.
 *
 * The job now skips anyone carrying an EMPLOYEE_DEACTIVATED audit row, which
 * only works if both deactivation paths actually write one.
 */

const ACTIVATION = path.resolve(__dirname, "../employee-activation.service.ts");
const mockExecute = db.execute as unknown as ReturnType<typeof vi.fn>;

interface Captured { sql: string; params: unknown[] }

function stubEmployee(row: Record<string, unknown>): Captured[] {
  const calls: Captured[] = [];
  mockExecute.mockImplementation((sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes("SELECT user_id FROM employees")) return Promise.resolve([[{ user_id: "user-1" }], []]);
    if (sql.includes("FROM employees WHERE id = ?")) return Promise.resolve([[row], []]);
    return Promise.resolve([[{ affectedRows: 1 }], []]);
  });
  return calls;
}

const auditRows = (calls: Captured[]) =>
  calls.filter((c) => c.sql.includes("INSERT INTO sensitive_action_log"));

const hasMarker = (calls: Captured[]) =>
  auditRows(calls).some((c) => JSON.stringify(c.params).includes("EMPLOYEE_DEACTIVATED"));

describe("both deactivation paths emit the canonical EMPLOYEE_DEACTIVATED marker", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue([[], []]);
  });

  it("the DELETE path writes it", async () => {
    const calls = stubEmployee({ id: "emp-a", employment_status: "Active", active_status: 1 });

    await employeeService.deactivateEmployee("emp-a", "hr-user", "Absconded since 1 Aug");

    expect(hasMarker(calls)).toBe(true);
  });

  it("the profile-update path writes it too — this is the path HR actually uses", async () => {
    const calls = stubEmployee({ id: "emp-b", employment_status: "Active", active_status: 1 });

    await employeeService.updateEmployee(
      "emp-b",
      { employmentStatus: "Inactive", deactivationReason: "Resigned, LWD 15 Aug" } as never,
      "hr-user"
    );

    expect(hasMarker(calls)).toBe(true);
    const marker = auditRows(calls).find((c) => JSON.stringify(c.params).includes("EMPLOYEE_DEACTIVATED"));
    // carries the reason, so the audit answers "why", not only "when"
    expect(JSON.stringify(marker?.params)).toContain("Resigned, LWD 15 Aug");
  });

  it("an ordinary edit does NOT write it — the marker has to stay specific", async () => {
    const calls = stubEmployee({ id: "emp-c", employment_status: "Active", active_status: 1 });

    await employeeService.updateEmployee("emp-c", { city: "Noida" } as never, "hr-user");

    expect(hasMarker(calls)).toBe(false);
  });
});

describe("the activation job refuses to re-activate a deliberate deactivation", () => {
  const activationQuery = () => {
    const code = fs.readFileSync(ACTIVATION, "utf8");
    const job = code.slice(code.indexOf("Find all employees due for activation"));
    return job.slice(0, job.indexOf("`,"));
  };

  it("excludes anyone carrying the marker", () => {
    const query = activationQuery();
    expect(query).toContain("NOT EXISTS");
    expect(query).toContain("sensitive_action_log");
    expect(query).toContain("EMPLOYEE_DEACTIVATED");
  });

  it("still admits genuine pre-joiners — the exclusion list is unchanged", () => {
    const query = activationQuery();
    // The inverted test that made activation independent of the creation path
    // must survive; narrowing it back to a whitelist selected nobody at all.
    expect(query).toContain("NOT IN");
    expect(query).toContain("'resigned'");
    expect(query).toContain("e.date_of_joining <= CURDATE()");
  });
});
