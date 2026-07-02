import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/db/mysql.js", () => ({ db: { execute: vi.fn().mockResolvedValue([[], []]) }, pingDb: vi.fn() }));
vi.mock("../src/db/supabaseAdmin.js", () => ({
  supabaseAdmin: {},
  supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));

import { db } from "../src/db/mysql.js";
import { employeeService } from "../src/modules/employees/employee.service.js";

const exec = db.execute as ReturnType<typeof vi.fn>;

const fakeEmployee = {
  id: "emp-1",
  employee_code: "MCN001",
  first_name: "Ravi",
  last_name: "Kumar",
  full_name: "Ravi Kumar",
  email: "ravi@mcn.com",
  mobile: "9999999999",
  gender: "Male",
  date_of_joining: "2026-01-01",
  salary_start_date: "2026-01-01",
  employment_type: "Full Time",
  employment_status: "Active",
  active_status: 1,
  created_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  exec.mockReset().mockResolvedValue([[], []]);
});

// ─── Create ───────────────────────────────────────────────────────────────────

describe("employeeService.createEmployee", () => {
  it("creates employee with salary_start_date defaulting to date_of_joining", async () => {
    exec.mockResolvedValueOnce([[], []]);                    // no duplicate code
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);  // INSERT
    exec.mockResolvedValueOnce([[fakeEmployee], []]);        // re-fetch
    const r = await employeeService.createEmployee({
      employeeCode: "MCN001",
      firstName: "Ravi",
      dateOfJoining: "2026-01-01",
    }, "user-1");
    expect(r.employee_code).toBe("MCN001");
    expect(r.salary_start_date).toBe("2026-01-01"); // defaults to doj
  });

  it("creates employee with explicit salary_start_date", async () => {
    exec.mockResolvedValueOnce([[], []]);
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    exec.mockResolvedValueOnce([[{ ...fakeEmployee, salary_start_date: "2026-02-01" }], []]);
    const r = await employeeService.createEmployee({
      employeeCode: "MCN002",
      firstName: "Priya",
      dateOfJoining: "2026-01-15",
      salaryStartDate: "2026-02-01",
    }, "user-1");
    expect(r.salary_start_date).toBe("2026-02-01");
  });

  it("throws on duplicate employee_code", async () => {
    exec.mockResolvedValueOnce([[fakeEmployee], []]); // duplicate found
    await expect(employeeService.createEmployee({
      employeeCode: "MCN001",
      firstName: "Test",
      dateOfJoining: "2026-01-01",
    }, "user-1")).rejects.toThrow("Employee code already exists");
  });
});

// ─── Get ──────────────────────────────────────────────────────────────────────

describe("employeeService.getEmployee", () => {
  it("returns employee by id", async () => {
    exec.mockResolvedValueOnce([[fakeEmployee], []]);
    const r = await employeeService.getEmployee("emp-1");
    expect(r.employee_code).toBe("MCN001");
  });

  it("throws when not found", async () => {
    exec.mockResolvedValueOnce([[], []]);
    await expect(employeeService.getEmployee("nope")).rejects.toThrow("Employee not found");
  });
});

// ─── List ─────────────────────────────────────────────────────────────────────

describe("employeeService.listEmployees", () => {
  it("returns paginated employees", async () => {
    exec.mockResolvedValueOnce([[fakeEmployee], []]);
    exec.mockResolvedValueOnce([[{ total: 1 }], []]);
    const r = await employeeService.listEmployees({ page: 1, limit: 50 });
    expect(r.data).toHaveLength(1);
    expect(r.total).toBe(1);
  });

  it("filters by employment_status", async () => {
    exec.mockResolvedValueOnce([[fakeEmployee], []]);
    exec.mockResolvedValueOnce([[{ total: 1 }], []]);
    await employeeService.listEmployees({ page: 1, limit: 50, status: "Active" });
    const query = exec.mock.calls[0][0] as string;
    expect(query).toContain("employment_status");
  });

  it("filters by process_id", async () => {
    exec.mockResolvedValueOnce([[fakeEmployee], []]);
    exec.mockResolvedValueOnce([[{ total: 1 }], []]);
    await employeeService.listEmployees({ page: 1, limit: 50, processId: "proc-1" });
    const query = exec.mock.calls[0][0] as string;
    expect(query).toContain("process_id");
  });
});

// ─── Update ───────────────────────────────────────────────────────────────────

describe("employeeService.updateEmployee", () => {
  it("updates allowed fields", async () => {
    exec.mockResolvedValueOnce([[fakeEmployee], []]);        // getEmployee
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);  // UPDATE
    exec.mockResolvedValueOnce([[{ ...fakeEmployee, mobile: "8888888888" }], []]); // re-fetch
    const r = await employeeService.updateEmployee("emp-1", { mobile: "8888888888" }, "user-1");
    expect(r.mobile).toBe("8888888888");
  });

  it("updates salary_start_date independently", async () => {
    exec.mockResolvedValueOnce([[fakeEmployee], []]);
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    exec.mockResolvedValueOnce([[{ ...fakeEmployee, salary_start_date: "2026-03-01" }], []]);
    const r = await employeeService.updateEmployee("emp-1", { salaryStartDate: "2026-03-01" }, "user-1");
    expect(r.salary_start_date).toBe("2026-03-01");
  });

  it("no-ops when no fields provided", async () => {
    exec.mockResolvedValueOnce([[fakeEmployee], []]);
    exec.mockResolvedValueOnce([[fakeEmployee], []]); // re-fetch (no UPDATE call)
    const r = await employeeService.updateEmployee("emp-1", {}, "user-1");
    expect(r.employee_code).toBe("MCN001");
    expect(exec.mock.calls.some(([sql]) => /^\s*UPDATE employees/i.test(sql as string))).toBe(false);
  });
});

// ─── Deactivate ───────────────────────────────────────────────────────────────

describe("employeeService.deactivateEmployee", () => {
  it("soft-deletes by setting active_status = 0", async () => {
    exec.mockResolvedValueOnce([[fakeEmployee], []]);       // getEmployee
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // UPDATE
    await employeeService.deactivateEmployee("emp-1", "user-1");
    const updateCall = exec.mock.calls[1][0] as string;
    expect(updateCall).toContain("active_status");
  });
});

// ─── Auto-assign salary at creation ──────────────────────────────────────────

describe("employeeService.createEmployee with structureId + ctcAnnual", () => {
  it("auto-assigns salary when structureId and ctcAnnual provided", async () => {
    exec.mockResolvedValueOnce([[], []]);                    // no duplicate code
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);  // INSERT employee
    exec.mockResolvedValueOnce([[fakeEmployee], []]);        // re-fetch employee
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);  // deactivate old assignments
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);  // INSERT salary_assignment
    const r = await employeeService.createEmployee({
      employeeCode: "MCN003",
      firstName: "Amit",
      dateOfJoining: "2026-06-01",
      structureId: "550e8400-e29b-41d4-a716-446655440001",
      ctcAnnual: 300000,
    }, "user-1");
    expect(r.employee_code).toBe("MCN001");
    expect(exec.mock.calls.some(([sql]) => /INSERT INTO employee_salary_assignment/i.test(sql as string))).toBe(true);
    expect(exec.mock.calls.some(([sql]) => /INSERT INTO employee_journey_log/i.test(sql as string))).toBe(true);
  });

  it("skips salary assignment when structureId not provided", async () => {
    exec.mockResolvedValueOnce([[], []]);
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    exec.mockResolvedValueOnce([[fakeEmployee], []]);
    await employeeService.createEmployee({
      employeeCode: "MCN004",
      firstName: "Neha",
      dateOfJoining: "2026-06-01",
    }, "user-1");
    expect(exec.mock.calls.some(([sql]) => /INSERT INTO employee_salary_assignment/i.test(sql as string))).toBe(false);
    expect(exec.mock.calls.some(([sql]) => /INSERT INTO employee_journey_log/i.test(sql as string))).toBe(true);
  });
});
