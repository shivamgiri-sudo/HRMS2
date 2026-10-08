import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ got: 1, calls: [] as string[], poll: vi.fn(async () => ({ read: 0, matched: 0, recorded: 0, skipped: {} })) }));
vi.mock("../../db/mysql.js", () => ({
  db: { getConnection: vi.fn(async () => ({ execute: vi.fn(async (sql: string) => { h.calls.push(sql); return [[{ got: h.got }]]; }), release: vi.fn(() => h.calls.push("release")) })) },
}));
vi.mock("../../modules/hiring-engine/inbound-email.service.js", async () => {
  const actual = await vi.importActual<typeof import("../../modules/hiring-engine/inbound-email.service.js")>("../../modules/hiring-engine/inbound-email.service.js");
  return { ...actual, pollInboundEmail: h.poll };
});
vi.mock("../../modules/hiring-engine/inbound-email.imap.js", () => ({ connectImap: vi.fn() }));

import { runInboundEmailTick, startInboundEmailWorker, stopInboundEmailWorker } from "../inbound-email.worker.js";

const env = { INBOUND_EMAIL_MODE: "dry_run", INBOUND_EMAIL_IMAP_HOST: "h", INBOUND_EMAIL_IMAP_USER: "u", INBOUND_EMAIL_IMAP_PASS: "p" };
beforeEach(() => { h.got = 1; h.calls = []; h.poll.mockClear(); vi.unstubAllEnvs(); });

describe("inbound email worker", () => {
  it("off: no connection, no lock, no poll; start does not schedule", async () => {
    expect(await runInboundEmailTick()).toBe("off");
    expect(h.calls).toHaveLength(0);
    const spy = vi.spyOn(globalThis, "setInterval");
    startInboundEmailWorker();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it("lock held elsewhere: no poll, connection released", async () => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    h.got = 0;
    expect(await runInboundEmailTick()).toBe("locked");
    expect(h.poll).not.toHaveBeenCalled();
    expect(h.calls).toEqual(["SELECT GET_LOCK(?, 0) AS got", "release"]);
  });
  it("lock taken: polls, then releases the lock and the connection; start is idempotent", async () => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    await runInboundEmailTick();
    expect(h.poll).toHaveBeenCalledTimes(1);
    expect(h.calls).toEqual(["SELECT GET_LOCK(?, 0) AS got", "SELECT RELEASE_LOCK(?)", "release"]);
    const spy = vi.spyOn(globalThis, "setInterval");
    startInboundEmailWorker(); startInboundEmailWorker();
    expect(spy).toHaveBeenCalledTimes(1);
    stopInboundEmailWorker();
    spy.mockRestore();
  });
});
