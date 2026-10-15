import { beforeEach, describe, expect, it, vi } from "vitest";

const getEmployeeForUser = vi.fn();
vi.mock("../../../shared/accessGuard.js", () => ({ getEmployeeForUser: (...a: unknown[]) => getEmployeeForUser(...a) }));

import { isPilotAllowed, isPilotMember } from "../pilot.js";

const user = { id: "U-1", email: "A.B@Team.in", employeeCode: "MAS100" };
beforeEach(() => { getEmployeeForUser.mockReset(); });

describe("isPilotMember", () => {
  it("unset or blank allow-list passes everyone", () => {
    expect(isPilotMember(user, {})).toBe(true);
    expect(isPilotMember(user, { BRANCH_HEAD_HEALTH_PILOT_USERS: " , ," })).toBe(true);
  });
  it("matches id, employee code and email case-insensitively, ignoring whitespace and empties", () => {
    const env = { BRANCH_HEAD_HEALTH_PILOT_USERS: " u-1 ,, mas100 , a.b@team.IN " };
    expect(isPilotMember({ id: "u-1" }, env)).toBe(true);
    expect(isPilotMember({ id: "x", employeeCode: "Mas100" }, env)).toBe(true);
    expect(isPilotMember({ id: "x", email: "A.B@team.in" }, env)).toBe(true);
  });
  it("unlisted user is not a member; super_admin always is", () => {
    const env = { BRANCH_HEAD_HEALTH_PILOT_USERS: "someone-else" };
    expect(isPilotMember(user, env)).toBe(false);
    expect(isPilotMember({ id: "z", role: "super_admin" }, env)).toBe(true);
    expect(isPilotMember({ id: "z", roles: ["Super_Admin"] }, env)).toBe(true);
  });
});

describe("isPilotAllowed", () => {
  it("looks up the employee code only when needed", async () => {
    const env = { BRANCH_HEAD_HEALTH_PILOT_USERS: "mas100" };
    getEmployeeForUser.mockResolvedValue({ id: "e", employee_code: "MAS100" });
    expect(await isPilotAllowed({ id: "u9" }, env)).toBe(true);
    expect(await isPilotAllowed({ id: "u9" }, {})).toBe(true);
    expect(getEmployeeForUser).toHaveBeenCalledTimes(1);
  });
  it("fails closed when the lookup throws", async () => {
    getEmployeeForUser.mockImplementation(async () => { throw new Error("db"); });
    expect(await isPilotAllowed({ id: "u9" }, { BRANCH_HEAD_HEALTH_PILOT_USERS: "mas100" })).toBe(false);
  });
});
