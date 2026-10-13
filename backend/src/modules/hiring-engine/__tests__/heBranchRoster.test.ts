import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ stamp: [] as Array<Record<string, unknown>>, matches: [] as Array<Record<string, unknown>>, people: [] as Array<Record<string, unknown>>, sqls: [] as string[] }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: vi.fn(async (sql: string) => {
    h.sqls.push(sql);
    if (sql.includes("FROM he_model_param")) return [h.stamp, []];
    if (sql.includes("INSERT INTO he_model_param")) return [{ affectedRows: 1 }, []];
    if (sql.includes("FROM he_drive d")) return [h.matches, []];
    if (sql.includes("FROM employees e")) return [h.people, []];
    return [[], []];
  }) },
}));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../../communication/email.service.js", () => ({ emailService: { send: vi.fn() } }));
import { buildRoster, rosterEmail, runBranchRosters } from "../he-branch-roster.service.js";

const m = (o: Record<string, unknown>) => ({ branch: "NOIDA-2", slot_at: "2026-10-13 10:30:00", state: "invited", full_name: "rahul sharma", mobile10: "9876543210", role: "EXECUTIVE", code: "NOIDA-Onfido-22", ...o });
const MORNING = new Date("2026-10-13T03:30:00Z"); // 09:00 IST
beforeEach(() => { h.stamp = []; h.matches = [m({}), m({ slot_at: "2026-10-13 10:00:00", state: "confirmed", full_name: "Anita Devi" }), m({ slot_at: "2026-10-13 11:30:00" })]; h.people = [{ official_email: "ops@x.in" }]; h.sqls = []; });

describe("branch roster", () => {
  it("counts by hour, masks mobiles and names people by first name, earliest first", () => {
    const r = buildRoster("NOIDA-2", h.matches as never);
    expect(r).toMatchObject({ booked: 3, confirmed: 1 });
    expect(r.byHour).toEqual([{ hour: "10:00", booked: 2, confirmed: 1 }, { hour: "11:00", booked: 1, confirmed: 0 }]);
    expect(r.rows[0]).toMatchObject({ hour: "10:00", name: "Anita", mobile: "xxxxxx3210" });
    expect(rosterEmail(r, "2026-10-13").subject).toBe("Walk-ins expected today at NOIDA-2: 3 booked, 1 confirmed (2026-10-13)");
  });
  it("sends one email per recipient from 08:30, once a day", async () => {
    const send = vi.fn(async () => undefined);
    expect(await runBranchRosters(new Date("2026-10-13T03:30:00Z"), { send } as never)).toBe(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "ops@x.in" }));
    h.stamp = [{ sample: 20261013 }];
    send.mockClear();
    expect(await runBranchRosters(new Date("2026-10-13T04:00:00Z"), { send } as never)).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
  it("does nothing before 08:30 IST", async () => {
    const send = vi.fn();
    expect(await runBranchRosters(new Date("2026-10-13T02:30:00Z"), { send } as never)).toBe(0); // 08:00 IST
    expect(send).not.toHaveBeenCalled();
    void MORNING;
  });
});
