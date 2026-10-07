import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: mocks.execute } }));

import {
  INBOX_RESOLUTION_RULES,
  resetRuleThrottle,
  runInboxReconciliation,
} from "../inbox-reconciliation.js";

const read = (rows: unknown[]) => [rows, []];
const write = (affectedRows: number) => [{ affectedRows }, []];

describe("heavy dated-attendance rules", () => {
  beforeEach(() => {
    mocks.execute.mockReset();
    resetRuleThrottle();
  });

  it("are flagged two-phase and throttled, with the WHERE text unchanged", () => {
    for (const key of ["attendance_missing_punch", "attendance_validation"]) {
      const r = INBOX_RESOLUTION_RULES.find((x) => x.key === key)!;
      expect(r.twoPhase).toBe(true);
      expect(r.minIntervalMs).toBeGreaterThanOrEqual(5 * 60 * 1000);
      expect(r.where).toContain(
        "SUBSTRING_INDEX(SUBSTRING_INDEX(w.action_url, 'date=', -1), '&', 1)",
      );
    }
    // the expired rules stay cheap and un-throttled
    expect(
      INBOX_RESOLUTION_RULES.find(
        (x) => x.key === "attendance_missing_punch_expired",
      )!.minIntervalMs,
    ).toBeUndefined();
  });

  it("selects ids without locking, then closes only those ids", async () => {
    const rule = {
      key: "k",
      resolvedWhen: "x",
      where: "w.is_actioned = 0 AND w.type = 't'",
      twoPhase: true,
    };
    mocks.execute
      .mockResolvedValueOnce(read([{ id: "a" }, { id: "b" }]))
      .mockResolvedValueOnce(write(2));
    const res = await runInboxReconciliation({ rules: [rule] });
    expect(res.byRule.k).toBe(2);
    const [sel] = mocks.execute.mock.calls[0];
    expect(String(sel)).toMatch(/^\s*SELECT w\.id FROM work_inbox_item w/);
    expect(String(sel)).not.toContain("UPDATE");
    const [upd, args] = mocks.execute.mock.calls[1];
    expect(String(upd)).toContain(
      "UPDATE work_inbox_item SET is_actioned = 1, is_read = 1",
    );
    expect(String(upd)).toContain("is_actioned = 0");
    expect(args).toEqual(["a", "b"]);
  });

  it("does nothing when no alert matches", async () => {
    mocks.execute.mockResolvedValueOnce(read([]));
    const res = await runInboxReconciliation({
      rules: [
        {
          key: "k",
          resolvedWhen: "x",
          where: "w.is_actioned = 0",
          twoPhase: true,
        },
      ],
    });
    expect(res.total).toBe(0);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("throttles a rule with minIntervalMs to one run per interval, but not a dry run", async () => {
    const rule = {
      key: "slow",
      resolvedWhen: "x",
      where: "w.is_actioned = 0",
      twoPhase: true,
      minIntervalMs: 60_000,
    };
    mocks.execute.mockResolvedValue(read([]));
    await runInboxReconciliation({ rules: [rule] });
    await runInboxReconciliation({ rules: [rule] });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    mocks.execute.mockResolvedValue(read([{ n: 3 }]));
    const dry = await runInboxReconciliation({ rules: [rule], dryRun: true });
    expect(dry.total).toBe(3);
  });
});
