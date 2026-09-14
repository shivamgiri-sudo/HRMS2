/**
 * The emergency stop the dispatch path never had.
 *
 * notificationEventService.dispatch() -> dispatchService.send() carries the whole
 * 53-event catalogue and consulted no enable flag whatsoever. Halting the
 * 1,863-message eSign storm in August 2026 therefore required
 * `pm2 stop hrms2-workers` — all 45 workers, including payroll and attendance.
 *
 * Two properties matter more than the feature itself, and both are asymmetric on
 * purpose:
 *
 *   1. It must FAIL OPEN. A killswitch that silences payslip and leave mail
 *      because information_schema hiccuped is a worse outage than the storm it
 *      guards against. Contrast the eSign cooldown (1109), which fails CLOSED —
 *      there the danger is sending too much.
 *   2. is_critical must NOT override it. `critical` is what lets an event bypass
 *      the recipient's own channel preference, which is how one worker put 214
 *      SMS on a single number. An operator's explicit stop has to outrank that,
 *      or the switch is useless against exactly the events that need it.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const rows = vi.hoisted(() => ({ value: [] as Array<{ scope: string; blocked: number; reason: string | null }>, fail: false }));

vi.mock("../../db/mysql.js", () => ({
  db: {
    query: vi.fn(async () => {
      if (rows.fail) throw new Error("ER_NO_SUCH_TABLE: notification_dispatch_block");
      return [rows.value, []];
    }),
  },
}));

const { getDispatchBlock, clearDispatchBlockCache } = await import("../notification-dispatch-block.js");

beforeEach(() => {
  rows.value = [];
  rows.fail = false;
  clearDispatchBlockCache();
});

describe("notification dispatch block", () => {
  it("allows everything when no row is blocked", async () => {
    await expect(getDispatchBlock("esign_reminder")).resolves.toMatchObject({ blocked: false });
  });

  it("stops one event without touching the others", async () => {
    rows.value = [{ scope: "esign_reminder", blocked: 1, reason: "storm" }];

    const stopped = await getDispatchBlock("esign_reminder");
    expect(stopped.blocked).toBe(true);
    expect(stopped.scope).toBe("esign_reminder");
    expect(stopped.reason).toBe("storm");

    // payslip_ready must still go out — that is the whole point of not using
    // `pm2 stop hrms2-workers`.
    await expect(getDispatchBlock("payslip_ready")).resolves.toMatchObject({ blocked: false });
  });

  it("global stops everything, including events with no code", async () => {
    rows.value = [{ scope: "global", blocked: 1, reason: "incident 2026-08-08" }];

    for (const code of ["esign_reminder", "payslip_ready", undefined]) {
      const stop = await getDispatchBlock(code);
      expect(stop.blocked, `${code} should be stopped`).toBe(true);
      expect(stop.scope).toBe("global");
    }
  });

  it("FAILS OPEN when the table is missing or the query errors", async () => {
    rows.fail = true;
    // Before the migration lands, and during any DB blip, mail must keep flowing.
    await expect(getDispatchBlock("esign_reminder")).resolves.toMatchObject({ blocked: false });
    await expect(getDispatchBlock()).resolves.toMatchObject({ blocked: false });
  });

  it("a caller with no event code still gets the global stop", async () => {
    rows.value = [{ scope: "esign_reminder", blocked: 1, reason: null }];
    // Only that one event is blocked, so an unidentified caller is not.
    await expect(getDispatchBlock()).resolves.toMatchObject({ blocked: false });

    rows.value = [{ scope: "global", blocked: 1, reason: null }];
    clearDispatchBlockCache();
    await expect(getDispatchBlock()).resolves.toMatchObject({ blocked: true });
  });
});

describe("dispatch.service honours the stop", () => {
  it("suppresses outbound channels and is not overridden by is_critical", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const { fileURLToPath } = await import("url");
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.resolve(dir, "../../modules/communication/dispatch.service.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    expect(code).toContain("getDispatchBlock(dto.event_code)");
    // The stop clears the channel list outright; it must not be reachable only
    // for non-critical events.
    const guard = code.slice(code.indexOf("getDispatchBlock(dto.event_code)"));
    expect(guard.slice(0, 400)).toContain("channels = []");
    expect(guard.slice(0, 400)).not.toContain("is_critical");

    // The portal item is written BEFORE the stop, so stopping mail does not
    // erase the record that the event happened.
    expect(code.indexOf("inboxService.createItem")).toBeLessThan(
      code.indexOf("getDispatchBlock(dto.event_code)"),
    );
  });
});
