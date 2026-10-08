import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ sqls: [] as string[], params: [] as Array<{ param_key: string; value: number }>, canary: [] as Array<{ source_type: string; requisition_id: string }>, fail: false }));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string) => {
      h.sqls.push(sql);
      if (h.fail) throw new Error("db down");
      if (sql.includes("FROM he_model_param")) return [h.params];
      if (sql.includes("FROM followup_canary")) return [h.canary];
      return [[]];
    }),
  },
}));

import { logger } from "../../../logger.js";
import {
  canaryCapFor, enrolTag, envCeiling, firstContactHoldSql, followupSkipSql, loadFollowupSwitches, readSwitches, resolveSourceMode, runnableTags,
  SOURCE_MODE_CODES, tickPlan,
} from "../qualified-followup.policy.js";

const P = (o: Record<string, number>) => new Map(Object.entries(o));
const live = { QUAL_FOLLOWUP_MODE: "live" } as NodeJS.ProcessEnv;
beforeEach(() => { h.sqls = []; h.params = []; h.canary = []; h.fail = false; });

describe("per-source modes", () => {
  it("codes are off 0, dry_run 1, test 2, canary 3, live 4", () => {
    expect(SOURCE_MODE_CODES).toEqual({ off: 0, dry_run: 1, test: 2, canary: 3, live: 4 });
  });

  it("missing screen rows mean every source is off even with env live", () => {
    expect(readSwitches(live).sourceModes).toEqual({ meta_live: "off", meta_old: "off", he: "off" });
  });

  it("env dry_run caps a live source", () => {
    expect(readSwitches({ QUAL_FOLLOWUP_MODE: "dry_run" } as NodeJS.ProcessEnv, P({ "policy.followup.he": 4 })).sourceModes.he).toBe("dry_run");
  });

  it("test flag caps canary at test", () => {
    const s = readSwitches({ QUAL_FOLLOWUP_MODE: "live", QUAL_FOLLOWUP_TEST_MODE: "1" } as NodeJS.ProcessEnv, P({ "policy.followup.meta_live": 3 }));
    expect(s.ceiling).toBe("test");
    expect(s.sourceModes.meta_live).toBe("test");
  });

  it("env off means off whatever the screen says", () => {
    const s = readSwitches({} as NodeJS.ProcessEnv, P({ "policy.followup.meta_live": 4, "policy.followup.meta_old": 3, "policy.followup.he": 1 }));
    expect(s.sourceModes).toEqual({ meta_live: "off", meta_old: "off", he: "off" });
  });

  it("invalid codes (7, -1, 2.5) are off", () => {
    for (const v of [7, -1, 2.5]) expect(resolveSourceMode("live", v)).toBe("off");
    expect(resolveSourceMode("live", undefined)).toBe("off");
    expect(resolveSourceMode("live", 2)).toBe("test");
  });

  it("envCeiling: off / dry_run / live, test when the test flag is on with live", () => {
    expect(envCeiling({} as NodeJS.ProcessEnv)).toBe("off");
    expect(envCeiling({ QUAL_FOLLOWUP_MODE: "dry_run", QUAL_FOLLOWUP_TEST_MODE: "1" } as NodeJS.ProcessEnv)).toBe("dry_run");
    expect(envCeiling(live)).toBe("live");
    expect(envCeiling({ ...live, QUAL_FOLLOWUP_TEST_MODE: "true" })).toBe("test");
  });

  it("canary enrolment tags canary only for listed requisitions", () => {
    const s = readSwitches(live, P({ "policy.followup.meta_live": 3 }), [{ sourceType: "meta_live", requisitionId: "R1" }]);
    expect(enrolTag(s, "meta_live", "R1")).toBe("canary");
    expect(enrolTag(s, "meta_live", "R2")).toBe("dry_run");
    expect(enrolTag(s, "he", "R1")).toBeNull();
  });

  it("enrolTag follows live / test / dry_run", () => {
    const s = readSwitches(live, P({ "policy.followup.meta_live": 4, "policy.followup.meta_old": 2, "policy.followup.he": 1 }));
    expect([enrolTag(s, "meta_live", "R"), enrolTag(s, "meta_old", "R"), enrolTag(s, "he", "R")]).toEqual(["live", "test", "dry_run"]);
  });

  it("live runs canary rows; canary does not run live rows", () => {
    expect(runnableTags("live")).toEqual(["live", "canary"]);
    // canary also runs the dry_run rows its unlisted requisitions get (resolved ambiguity 4: the shadow continues; rig finding)
    expect(runnableTags("canary")).toEqual(["canary", "dry_run"]);
    expect(runnableTags("test")).toEqual(["test"]);
    expect(runnableTags("dry_run")).toEqual(["dry_run"]);
    expect(runnableTags("off")).toEqual([]);
  });

  it("tickPlan groups sources by tag", () => {
    const s = readSwitches(live, P({ "policy.followup.meta_live": 4, "policy.followup.meta_old": 1, "policy.followup.he": 0 }));
    expect(tickPlan(s)).toEqual([{ tag: "live", sources: ["meta_live"] }, { tag: "canary", sources: ["meta_live"] }, { tag: "dry_run", sources: ["meta_old"] }]);
  });

  it("canary caps default NOIDA-2 50 and AHMEDABAD prefix 30; params add or override", () => {
    const s = readSwitches(live);
    expect(canaryCapFor(s, "AHMEDABAD-JALDARSHAN")).toEqual({ prefix: "AHMEDABAD", cap: 30 });
    expect(canaryCapFor(s, "noida-2")).toEqual({ prefix: "NOIDA-2", cap: 50 });
    expect(canaryCapFor(s, "PUNE")).toEqual({ prefix: "PUNE", cap: 0 });
    expect(canaryCapFor(s, null)).toEqual({ prefix: "", cap: 0 });
    const p = readSwitches(live, P({ "policy.followup.canary_cap.PUNE": 10, "policy.followup.canary_cap.NOIDA-2": 20 }));
    expect(canaryCapFor(p, "PUNE")).toEqual({ prefix: "PUNE", cap: 10 });
    expect(canaryCapFor(p, "NOIDA-2")).toEqual({ prefix: "NOIDA-2", cap: 20 });
  });

  it("kill switch from the screen or the env; upload WhatsApp and the WA daily max from the screen", () => {
    expect(readSwitches(live, P({ "policy.followup.paused": 1 })).killSwitch).toBe(true);
    expect(readSwitches({ ...live, HE_SENDS_PAUSED: "true" }).killSwitch).toBe(true);
    expect(readSwitches(live).killSwitch).toBe(false);
    expect(readSwitches(live).uploadWa).toBe(false);
    expect(readSwitches(live, P({ "policy.followup.upload_wa": 1 })).uploadWa).toBe(true);
    expect(readSwitches({ ...live, QUAL_FOLLOWUP_WA_DAILY_MAX: "300" }).waDailyMax).toBe(300);
    expect(readSwitches({ ...live, QUAL_FOLLOWUP_WA_DAILY_MAX: "300" }, P({ "policy.followup.wa_daily_max": 200 })).waDailyMax).toBe(200);
  });

  it("keeps the existing fields (mode stays the env mode)", () => {
    const s = readSwitches(live, P({ "policy.followup.he": 4 }));
    expect(s.mode).toBe("live");
    expect(s.callFileTo).toBe("shivam.giri@teammas.in");
  });
});

describe("row-based skip", () => {
  it("rollback to off still skips owned rows: the clause does not depend on the env", () => {
    const a = { mobileExpr: "l.mobile10", requisitionExpr: "m.requisition_id" };
    const before = process.env.QUAL_FOLLOWUP_MODE;
    const out: string[] = [];
    for (const m of [undefined, "off", "dry_run", "live"]) {
      if (m === undefined) delete process.env.QUAL_FOLLOWUP_MODE; else process.env.QUAL_FOLLOWUP_MODE = m;
      out.push(followupSkipSql(a));
    }
    if (before === undefined) delete process.env.QUAL_FOLLOWUP_MODE; else process.env.QUAL_FOLLOWUP_MODE = before;
    expect(new Set(out).size).toBe(1);
    expect(out[0]).toBe(" AND NOT EXISTS (SELECT 1 FROM qualified_followup qf WHERE qf.mobile10 = l.mobile10 COLLATE utf8mb4_unicode_ci AND qf.owner = 'pipeline' AND qf.mode_at_enqueue IN ('live','canary') AND (qf.requisition_id = m.requisition_id COLLATE utf8mb4_unicode_ci OR qf.journey_state IN ('reach','engaged','confirmed','reminded')))");
  });

  it("first-contact hold reads followup_person within 7 days", () => {
    expect(firstContactHoldSql({ mobileExpr: "l.mobile10" })).toBe(" AND NOT EXISTS (SELECT 1 FROM followup_person fp WHERE fp.mobile10 = l.mobile10 COLLATE utf8mb4_unicode_ci AND fp.last_first_contact_at > DATE_SUB(NOW(), INTERVAL 7 DAY))");
  });
});

describe("loadFollowupSwitches", () => {
  it("reads policy.followup.* and the canary list", async () => {
    h.params = [{ param_key: "policy.followup.meta_live", value: 3 }, { param_key: "policy.followup.paused", value: 0 }, { param_key: "policy.followup.wa_inbound_verified", value: 1 }];
    h.canary = [{ source_type: "meta_live", requisition_id: "R1" }];
    const s = await loadFollowupSwitches(live);
    expect(s.sourceModes.meta_live).toBe("canary");
    expect(s.canary.has("meta_live:R1")).toBe(true);
    expect(h.sqls.some((q) => q.includes("param_key LIKE 'policy.followup.%'"))).toBe(true);
  });

  it("makes no query while the env ceiling is off", async () => {
    const s = await loadFollowupSwitches({} as NodeJS.ProcessEnv);
    expect(h.sqls).toHaveLength(0);
    expect(s.sourceModes).toEqual({ meta_live: "off", meta_old: "off", he: "off" });
  });

  it("fails closed: db throws -> every source off, kill switch false, a warning", async () => {
    h.fail = true;
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined as never);
    const s = await loadFollowupSwitches(live);
    expect(s.sourceModes).toEqual({ meta_live: "off", meta_old: "off", he: "off" });
    expect(s.killSwitch).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("canary keeps the shadow of unlisted requisitions", () => {
  it("tickPlan for a canary source has a canary pass and a dry_run pass", () => {
    const s = readSwitches(live, P({ "policy.followup.meta_live": 3 }));
    expect(tickPlan(s)).toEqual([{ tag: "canary", sources: ["meta_live"] }, { tag: "dry_run", sources: ["meta_live"] }]);
  });
});
