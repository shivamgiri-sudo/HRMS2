import { describe, it, expect, vi } from "vitest";
const emp = vi.fn();
vi.mock("../../../shared/accessGuard.js", () => ({ getEmployeeForUser: (...a: any[]) => emp(...a) }));
import { rosterPreferenceAdapter } from "../adapters/roster-preference.js";

describe("rosterPreferenceAdapter", () => {
  it("maps fields and drops own rows", async () => {
    emp.mockResolvedValue({ id: "me" });
    const call = vi.fn().mockResolvedValue({ data: [
      { id: "p1", employee_id: "e1", first_name: "A", last_name: "B", employee_code: "C1", preferred_week_off: "Sunday", shift_name: "Morning", flexibility: "fixed", notes: "Exam", effective_from: "2030-01-06", status: "pending", created_at: "2030-01-01T00:00:00Z" },
      { id: "p2", employee_id: "me", first_name: "Me", status: "pending" },
    ] });
    const items = await rosterPreferenceAdapter.list({ userId: "u", call } as any);
    expect(items.map((i) => i.id)).toEqual(["p1"]);
    expect(items[0].fields.map((x) => x.label)).toEqual(expect.arrayContaining(["Employee", "Preferred shift", "Preferred week-off", "Flexibility", "Effective from", "Notes"]));
    expect(items[0].rejectNeedsReason).toBe(false);
    expect(items[0].viewPath).toBe("/roster-preference?approvalId=p1");
  });
  it("decides", async () => {
    const call = vi.fn().mockResolvedValue({});
    await rosterPreferenceAdapter.decide({ userId: "u", call } as any, { id: "p1" }, "approve", "");
    expect(call).toHaveBeenLastCalledWith("PATCH", "/api/wfm/roster-preferences/p1/approve", { body: {} });
    await rosterPreferenceAdapter.decide({ userId: "u", call } as any, { id: "p1" }, "reject", "no");
    expect(call).toHaveBeenLastCalledWith("PATCH", "/api/wfm/roster-preferences/p1/reject", { body: { reason: "no" } });
  });
});
