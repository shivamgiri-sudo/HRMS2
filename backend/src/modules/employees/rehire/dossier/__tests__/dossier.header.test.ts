import { describe, it, expect, vi } from "vitest";
import { loadHeaderSection, tenureMonths } from "../dossier.header.js";
import { buildWindow } from "../dossierTypes.js";

function executor(map: Record<string, unknown[]>) {
  return {
    execute: vi.fn(async (sql: string) => {
      const key = Object.keys(map).find((k) => sql.includes(k));
      return [key ? map[key] : [], []];
    }),
  };
}
const w = buildWindow("e1", "2026-09-10", 12);

describe("tenureMonths", () => {
  it("counts whole months between two dates", () => {
    expect(tenureMonths("2025-07-15", "2026-09-10")).toBe(13);
    expect(tenureMonths("2026-09-01", "2026-09-10")).toBe(0);
    expect(tenureMonths("2025-09-10", "2026-09-10")).toBe(12);
  });
  it("is null with a missing date and never negative", () => {
    expect(tenureMonths(null, "2026-09-10")).toBeNull();
    expect(tenureMonths("2027-01-01", "2026-09-10")).toBe(0);
  });
});

describe("loadHeaderSection", () => {
  const row = {
    id: "e1", employee_code: "MAS001", full_name: "Asha Rao", photo_url: "/p.png", designation_name: "Agent",
    dept_name: "Ops", branch_name: "Pune", process_name: "SBI Cards", manager_name: "Ravi K", manager_code: "MAS009",
    date_of_joining: "2025-07-15", date_of_exit: "2026-09-10", employment_status: "Resigned",
  };

  it("returns the header with tenure measured to the as-of date", async () => {
    const ex = executor({ "FROM employees e": [row], "FROM employment_stint": [] });
    const h = (await loadHeaderSection(ex as never, w))!;
    expect(h).toMatchObject({ employeeId: "e1", employeeCode: "MAS001", name: "Asha Rao", branch: "Pune", process: "SBI Cards", designation: "Agent", manager: "Ravi K (MAS009)" });
    expect(h.tenureMonths).toBe(13);
    expect(h.dateOfJoining).toBe("2025-07-15");
  });

  it("measures tenure from the FIRST stint when the employee has rejoined before", async () => {
    const ex = executor({ "FROM employees e": [row], "FROM employment_stint": [{ start_date: "2024-01-01" }] });
    const h = (await loadHeaderSection(ex as never, w))!;
    expect(h.tenureMonths).toBe(32);
  });

  it("returns null for an unknown employee", async () => {
    expect(await loadHeaderSection(executor({}) as never, w)).toBeNull();
  });
});
