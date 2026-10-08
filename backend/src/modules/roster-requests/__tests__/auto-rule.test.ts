import { describe, expect, it, vi } from "vitest";
import { getAutoRule, listAutoRules, upsertAutoRule } from "../roster-requests.auto-rule.js";

const mk = (rows: any[] = []) => ({ execute: vi.fn(async () => [rows, []] as any) });
const PID = "11111111-2222-3333-4444-555555555555";

describe("auto rule store", () => {
  it("defaults to disabled when no row", async () => {
    const exec = mk([]);
    expect(await getAutoRule(PID, "swap", exec as any)).toEqual({ enabled: false, maxCoverageDrop: 0, requireCounterpartAccept: true });
    expect((exec.execute.mock.calls[0] as any)[1]).toEqual([PID, "swap"]);
  });
  it("maps a stored row", async () => {
    const exec = mk([{ enabled: 1, max_coverage_drop: 2, require_counterpart_accept: 0 }]);
    expect(await getAutoRule(PID, "swap", exec as any)).toEqual({ enabled: true, maxCoverageDrop: 2, requireCounterpartAccept: false });
  });
  it("lists all, scoped, and empty scope", async () => {
    const all = mk([{ id: 1 }]);
    await listAutoRules("all", all as any);
    expect((all.execute.mock.calls[0] as any)[0]).not.toContain("IN (");
    const scoped = mk();
    await listAutoRules(["a", "b"], scoped as any);
    expect((scoped.execute.mock.calls[0] as any)[0]).toContain("IN (?,?)");
    expect((scoped.execute.mock.calls[0] as any)[1]).toEqual(["a", "b"]);
    const none = mk();
    expect(await listAutoRules([], none as any)).toEqual([]);
    expect(none.execute).not.toHaveBeenCalled();
  });
  it("upserts with ordered params", async () => {
    const exec = mk();
    await upsertAutoRule({ processId: PID, kind: "swap", enabled: true, maxCoverageDrop: 3, requireCounterpartAccept: false }, "u1", exec as any);
    const [sql, params] = exec.execute.mock.calls[0] as any;
    expect(sql).toContain("ON DUPLICATE KEY UPDATE");
    expect(params).toEqual([PID, "swap", 1, 3, 0, "u1"]);
  });
  it("validates input", async () => {
    const exec = mk();
    const base = { processId: PID, kind: "swap", enabled: true, maxCoverageDrop: 1, requireCounterpartAccept: true };
    await expect(upsertAutoRule({ ...base, kind: "nope" }, "u", exec as any)).rejects.toThrow(/kind/);
    await expect(upsertAutoRule({ ...base, maxCoverageDrop: -1 }, "u", exec as any)).rejects.toThrow(/maxCoverageDrop/);
    await expect(upsertAutoRule({ ...base, maxCoverageDrop: 1.5 }, "u", exec as any)).rejects.toThrow(/maxCoverageDrop/);
    await expect(upsertAutoRule({ ...base, processId: "x; DROP" }, "u", exec as any)).rejects.toThrow(/processId/);
    expect(exec.execute).not.toHaveBeenCalled();
  });
});
