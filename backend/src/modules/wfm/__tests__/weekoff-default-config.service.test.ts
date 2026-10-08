import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbExecute, logSensitiveAction } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  logSensitiveAction: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: dbExecute },
}));

vi.mock("../../../shared/auditLog.js", () => ({
  logSensitiveAction,
}));

import { weekOffDefaultConfigService } from "../weekoff-default-config.service.js";

const ROW = {
  id: "policy-1",
  scope_type: "global",
  process_id: null,
  branch_id: null,
  default_week_off_day: 0,
  effective_from: "2026-08-14",
  effective_to: null,
  active_status: 1,
  change_reason: "initial org default",
  created_by: "user-1",
  updated_by: "user-1",
  created_at: "2026-08-14T00:00:00.000Z",
  updated_at: "2026-08-14T00:00:00.000Z",
};

describe("weekOffDefaultConfigService", () => {
  beforeEach(() => {
    dbExecute.mockReset();
    logSensitiveAction.mockReset();
    logSensitiveAction.mockResolvedValue(undefined);
  });

  describe("list", () => {
    it("applies no filters when none given", async () => {
      dbExecute.mockResolvedValueOnce([[ROW], []]);
      const rows = await weekOffDefaultConfigService.list({});
      expect(rows).toEqual([ROW]);
      expect(dbExecute).toHaveBeenCalledWith(expect.stringContaining("SELECT * FROM week_off_policy_default"), []);
    });

    it("filters by scope_type and active_status together", async () => {
      dbExecute.mockResolvedValueOnce([[], []]);
      await weekOffDefaultConfigService.list({ scope_type: "process", active_status: "1" });
      const [sql, params] = dbExecute.mock.calls[0];
      expect(sql).toMatch(/scope_type = \?/);
      expect(sql).toMatch(/active_status = \?/);
      expect(params).toEqual(["process", 1]);
    });
  });

  describe("get", () => {
    it("404s when nothing matches", async () => {
      dbExecute.mockResolvedValueOnce([[], []]);
      await expect(weekOffDefaultConfigService.get("missing")).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe("create — validation", () => {
    it("rejects an unknown scope_type", async () => {
      await expect(
        weekOffDefaultConfigService.create({ scope_type: "employee" as any, default_week_off_day: 0 }, "user-1")
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(dbExecute).not.toHaveBeenCalled();
    });

    it("rejects scope_type=global with a process_id supplied", async () => {
      await expect(
        weekOffDefaultConfigService.create({ scope_type: "global", process_id: "p1", default_week_off_day: 0 }, "user-1")
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("rejects scope_type=process with no process_id", async () => {
      await expect(
        weekOffDefaultConfigService.create({ scope_type: "process", default_week_off_day: 0 }, "user-1")
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("rejects scope_type=branch with a process_id also supplied", async () => {
      await expect(
        weekOffDefaultConfigService.create(
          { scope_type: "branch", branch_id: "b1", process_id: "p1", default_week_off_day: 0 },
          "user-1"
        )
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("rejects default_week_off_day outside 0-6", async () => {
      await expect(
        weekOffDefaultConfigService.create({ scope_type: "global", default_week_off_day: 7 }, "user-1")
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        weekOffDefaultConfigService.create({ scope_type: "global", default_week_off_day: -1 }, "user-1")
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("rejects a non-integer default_week_off_day", async () => {
      await expect(
        weekOffDefaultConfigService.create({ scope_type: "global", default_week_off_day: 2.5 }, "user-1")
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("rejects effective_to before effective_from", async () => {
      await expect(
        weekOffDefaultConfigService.create(
          { scope_type: "global", default_week_off_day: 0, effective_from: "2026-08-14", effective_to: "2026-08-01" },
          "user-1"
        )
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("rejects a malformed date string", async () => {
      await expect(
        weekOffDefaultConfigService.create(
          { scope_type: "global", default_week_off_day: 0, effective_from: "14-08-2026" },
          "user-1"
        )
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe("create — scope reference checks", () => {
    it("400s when process_id does not exist in process_master", async () => {
      dbExecute.mockResolvedValueOnce([[], []]); // assertScopeRefExists: process_master lookup misses
      await expect(
        weekOffDefaultConfigService.create({ scope_type: "process", process_id: "ghost", default_week_off_day: 0 }, "user-1")
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("400s when branch_id does not exist in branch_master", async () => {
      dbExecute.mockResolvedValueOnce([[], []]); // assertScopeRefExists: branch_master lookup misses
      await expect(
        weekOffDefaultConfigService.create({ scope_type: "branch", branch_id: "ghost", default_week_off_day: 0 }, "user-1")
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe("create — overlap guard", () => {
    it("409s when an active row already covers this scope + window", async () => {
      dbExecute
        .mockResolvedValueOnce([[{ id: "existing" }], []]) // findOverlappingActiveRow
        .mockResolvedValueOnce([[], []]);
      await expect(
        weekOffDefaultConfigService.create({ scope_type: "global", default_week_off_day: 0 }, "user-1")
      ).rejects.toMatchObject({ statusCode: 409 });
    });
  });

  describe("create — success", () => {
    it("inserts a global-scope row, audits it, and returns the created row", async () => {
      dbExecute
        .mockResolvedValueOnce([[], []]) // findOverlappingActiveRow: no overlap
        .mockResolvedValueOnce([{ affectedRows: 1 }, []]) // INSERT
        .mockResolvedValueOnce([[ROW], []]); // get() re-fetch

      const result = await weekOffDefaultConfigService.create(
        { scope_type: "global", default_week_off_day: 0, change_reason: "initial org default" },
        "user-1"
      );

      expect(result).toEqual(ROW);
      expect(logSensitiveAction).toHaveBeenCalledWith(
        expect.objectContaining({
          actor_user_id: "user-1",
          action_type: "WEEK_OFF_DEFAULT_CREATED",
          module_key: "week_off_policy_default",
          entity_type: "week_off_policy_default",
        })
      );
    });

    it("defaults effective_from to today when omitted", async () => {
      dbExecute
        .mockResolvedValueOnce([[], []])
        .mockResolvedValueOnce([{ affectedRows: 1 }, []])
        .mockResolvedValueOnce([[ROW], []]);

      await weekOffDefaultConfigService.create({ scope_type: "global", default_week_off_day: 0 }, "user-1");

      const insertCall = dbExecute.mock.calls[1];
      const today = new Date().toISOString().slice(0, 10);
      expect(insertCall[1][5]).toBe(today); // effective_from param position
    });

    it("stores process_id only for scope_type=process (branch_id forced null)", async () => {
      dbExecute
        .mockResolvedValueOnce([[{ id: "p1" }], []]) // assertScopeRefExists
        .mockResolvedValueOnce([[], []]) // overlap check
        .mockResolvedValueOnce([{ affectedRows: 1 }, []]) // INSERT
        .mockResolvedValueOnce([[ROW], []]);

      await weekOffDefaultConfigService.create(
        { scope_type: "process", process_id: "p1", default_week_off_day: 3 },
        "user-1"
      );

      const insertCall = dbExecute.mock.calls[2];
      expect(insertCall[1][2]).toBe("p1"); // process_id param
      expect(insertCall[1][3]).toBeNull(); // branch_id param forced null
    });
  });

  describe("update", () => {
    it("400s on an out-of-range default_week_off_day", async () => {
      dbExecute.mockResolvedValueOnce([[ROW], []]); // get() inside update
      await expect(
        weekOffDefaultConfigService.update("policy-1", { default_week_off_day: 9 }, "user-1")
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("is a no-op (no UPDATE issued) when the input has no recognized fields", async () => {
      dbExecute.mockResolvedValueOnce([[ROW], []]); // get()
      const result = await weekOffDefaultConfigService.update("policy-1", {}, "user-1");
      expect(result).toEqual(ROW);
      expect(dbExecute).toHaveBeenCalledTimes(1); // only the get(), no UPDATE
      expect(logSensitiveAction).not.toHaveBeenCalled();
    });

    it("updates default_week_off_day and audits the change", async () => {
      dbExecute
        .mockResolvedValueOnce([[ROW], []]) // get() before update
        .mockResolvedValueOnce([{ affectedRows: 1 }, []]) // UPDATE
        .mockResolvedValueOnce([[{ ...ROW, default_week_off_day: 6 }], []]); // get() after update

      const result = await weekOffDefaultConfigService.update("policy-1", { default_week_off_day: 6 }, "user-1");
      expect(result.default_week_off_day).toBe(6);
      expect(logSensitiveAction).toHaveBeenCalledWith(
        expect.objectContaining({ action_type: "WEEK_OFF_DEFAULT_UPDATED", entity_id: "policy-1" })
      );
    });

    it("does not accept scope_type/process_id/branch_id as update fields (immutable)", async () => {
      dbExecute
        .mockResolvedValueOnce([[ROW], []])
        .mockResolvedValueOnce([[ROW], []]); // no UPDATE issued since only unrecognized fields given

      // @ts-expect-error — intentionally passing fields UpdateWeekOffDefaultInput doesn't declare
      const result = await weekOffDefaultConfigService.update("policy-1", { scope_type: "process", process_id: "p9" }, "user-1");
      expect(result).toEqual(ROW);
      expect(dbExecute).toHaveBeenCalledTimes(1); // only the initial get(), no UPDATE statement built
    });
  });

  describe("deactivate", () => {
    it("404s when the row does not exist", async () => {
      dbExecute.mockResolvedValueOnce([[], []]); // get() misses
      await expect(weekOffDefaultConfigService.deactivate("missing", "user-1")).rejects.toMatchObject({ statusCode: 404 });
    });

    it("409s when the row is already inactive (affectedRows=0)", async () => {
      dbExecute
        .mockResolvedValueOnce([[ROW], []]) // get() finds it
        .mockResolvedValueOnce([{ affectedRows: 0 }, []]); // UPDATE matches nothing (already inactive)
      await expect(weekOffDefaultConfigService.deactivate("policy-1", "user-1")).rejects.toMatchObject({ statusCode: 409 });
    });

    it("deactivates and audits", async () => {
      dbExecute
        .mockResolvedValueOnce([[ROW], []])
        .mockResolvedValueOnce([{ affectedRows: 1 }, []]);
      await weekOffDefaultConfigService.deactivate("policy-1", "user-1");
      expect(logSensitiveAction).toHaveBeenCalledWith(
        expect.objectContaining({ action_type: "WEEK_OFF_DEFAULT_DEACTIVATED", entity_id: "policy-1" })
      );
    });
  });
});
