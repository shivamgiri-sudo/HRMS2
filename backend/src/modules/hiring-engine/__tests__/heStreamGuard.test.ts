import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as Array<[string, unknown[]]>,
  hit: 0,
  fail: null as null | string,
  createDrive: vi.fn(async () => ({ id: "d-new", invites: 10, targetShows: 4, capacity: 40 })),
  setDriveStatus: vi.fn(async () => undefined),
  suggest: vi.fn(async () => ({ suggested: 2, blockedByReason: {}, considered: 2, leadIds: [] })),
  bridge: vi.fn(async () => ({ poolRows: 0, linked: 0 })),
}));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      const q = sql.replace(/\s+/g, " ").trim();
      h.calls.push([q, p]);
      if (q.includes("FROM job_requisition WHERE id = ?")) return [[{ id: "r1", requisition_code: "R1", designation_name: "Agent", branch_name: "Noida", approval_status: "approved", active_status: 1, requested_headcount: 5, fulfilled_headcount: 0 }]];
      if (q.includes("COUNT(*) AS n FROM meta_campaign")) return [[{ n: 1 }]];
      if (q.includes("FROM requisition_stream")) {
        if (h.fail) throw Object.assign(new Error("x"), { code: h.fail });
        return [[{ hit: h.hit }]];
      }
      return [[]];
    }),
  },
}));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../he-drive.service.js", () => ({ createDrive: h.createDrive, setDriveStatus: h.setDriveStatus, suggestMatchesDetailed: h.suggest }));
vi.mock("../he-meta-bridge.service.js", () => ({ bridgeMetaLeads: h.bridge }));
vi.mock("../he-policy.service.js", async () => {
  const { DEFAULT_DAILY_PLAN } = await import("../he-slots.js");
  return { getDailyPlan: vi.fn(async () => DEFAULT_DAILY_PLAN) };
});

import { previewLaunch, startLaunch, type LaunchInput } from "../he-launch.service.js";

const input: LaunchInput = { kind: "campaign", ids: ["c1"], requisitionId: "r1", date: "2026-10-12" };
const err = async (p: Promise<unknown>) => p.then(() => null, (e) => e as Error & { statusCode?: number });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T10:00:00+05:30"));
  h.calls.length = 0; h.hit = 0; h.fail = null;
  for (const f of [h.createDrive, h.setDriveStatus, h.suggest, h.bridge]) f.mockClear();
});

describe("campaign launch next to streams", () => {
  it("refuses (409) when the requisition has an open/paused stream or a stream-fed drive that day; nothing is bridged or created", async () => {
    h.hit = 1;
    const e = await err(startLaunch(input));
    expect([e?.statusCode, e?.message]).toEqual([409, "This requisition is fed by streams; use Plan now"]);
    expect(h.bridge).not.toHaveBeenCalled();
    expect(h.createDrive).not.toHaveBeenCalled();
    expect(h.suggest).not.toHaveBeenCalled();
    expect((await err(previewLaunch(input)))?.statusCode).toBe(409);
    const q = h.calls.find(([s]) => s.includes("FROM requisition_stream"))!;
    expect(q[0]).toContain("status IN ('open','paused')");
    expect(q[0]).toContain("FROM requisition_stream_plan p JOIN he_drive d ON d.id = p.drive_id WHERE d.requisition_id = ? AND d.drive_date = ?");
    expect(q[1]).toEqual(["r1", "r1", "2026-10-12"]);
  });

  it("an unreadable stream table refuses with 503; a missing one counts as no streams", async () => {
    h.fail = "ER_LOCK_WAIT_TIMEOUT";
    const e = await err(startLaunch(input));
    expect([e?.statusCode, e?.message]).toEqual([503, "Could not check the requisition's streams; try again"]);
    expect(h.createDrive).not.toHaveBeenCalled();
    h.fail = "ER_NO_SUCH_TABLE";
    expect((await startLaunch(input)).driveId).toBe("d-new");
  });

  it("without streams the launch runs as before", async () => {
    const r = await startLaunch(input);
    expect(r).toMatchObject({ driveId: "d-new", shortlist: { suggested: 2 } });
    expect(h.createDrive).toHaveBeenCalledTimes(1);
    expect(h.setDriveStatus).toHaveBeenCalledWith("d-new", "active");
    expect(h.suggest).toHaveBeenCalledWith("d-new");
  });
});
