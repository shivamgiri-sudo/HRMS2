/**
 * Absconder salary hold, pinned.
 *   1. OFF by default and on any read failure: an unreadable switch must never zero anyone's salary.
 *   2. An absconder is paid as normal; only an exit with a PLACED hold (pay_hold_at) is ever held.
 *   3. The held query asks about the latest live exit, not yet released, and never runs when the hold is off.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, query } = vi.hoisted(() => ({ execute: vi.fn(), query: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query } }));

const { absconderHoldConfig, heldAbsconderEmployeeIds, heldAbsconderLinesForRuns } = await import("../absconder-hold.service.js");

function flags(map: Record<string, string | undefined>) {
  execute.mockImplementation(async (_sql: string, p: unknown[]) => {
    const v = map[String((p ?? [])[0])];
    return [v === undefined ? [] : [{ config_value: v }]];
  });
}

describe("absconder hold switch", () => {
  beforeEach(() => { execute.mockReset(); query.mockReset(); });

  it("is OFF when nothing is configured", async () => {
    flags({});
    expect(await absconderHoldConfig()).toEqual({ enabled: false });
  });
  it("is OFF when the flag is not 'true'", async () => {
    flags({ absconder_salary_hold_enabled: "yes" });
    expect((await absconderHoldConfig()).enabled).toBe(false);
  });
  it("is ON only for an explicit 'true'", async () => {
    flags({ absconder_salary_hold_enabled: "true" });
    expect(await absconderHoldConfig()).toEqual({ enabled: true });
  });
  it("fails OFF when the read throws", async () => {
    execute.mockRejectedValue(new Error("db down"));
    expect((await absconderHoldConfig()).enabled).toBe(false);
  });
});

describe("held employees", () => {
  beforeEach(() => { execute.mockReset(); query.mockReset(); });

  it("returns nobody and never queries exits while the hold is off", async () => {
    flags({});
    expect((await heldAbsconderEmployeeIds(["e1", "e2"])).size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it("returns nobody for an empty list", async () => {
    expect((await heldAbsconderEmployeeIds([])).size).toBe(0);
  });

  it("holds exactly the employees the exit query returns (a hold placed, not yet released)", async () => {
    flags({ absconder_salary_hold_enabled: "true" });
    query.mockResolvedValue([[{ employee_id: "e2" }]]);
    const held = await heldAbsconderEmployeeIds(["e1", "e2"]);
    expect([...held]).toEqual(["e2"]);
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain("er.pay_hold_released_at IS NULL");
    expect(String(sql)).toContain("'absconding','abandonment'");
    expect(String(sql)).toMatch(/NOT IN \('draft','revoked','rejected','cancelled','withdrawn','rejoined'\)/);
    expect(String(sql)).toContain("ORDER BY x.created_at DESC");
    expect(params).toEqual([["e1", "e2"]]);
    expect(String(sql)).toContain("er.pay_hold_at IS NOT NULL");
    expect(String(sql)).toContain("er.pay_hold_released_at IS NULL");
    expect(String(sql)).not.toContain("ff_exception");
  });

  it("reports held lines by name only when the hold is on", async () => {
    flags({});
    expect(await heldAbsconderLinesForRuns(["r1"])).toEqual([]);
    flags({ absconder_salary_hold_enabled: "true" });
    query.mockResolvedValue([[{ employee_id: "e1", employee_code: "MAS1", employee_name: "A B", exit_request_id: "x1" }]]);
    expect(await heldAbsconderLinesForRuns(["r1"])).toEqual([
      { employee_id: "e1", employee_code: "MAS1", employee_name: "A B", exit_request_id: "x1" },
    ]);
  });
});
