import { beforeEach, describe, expect, it, vi } from "vitest";

/** STOP from every channel (Task 12): Pinbot, email unsubscribe, call, HR, web. Idempotent; independent of the inbound webhook. */
const h = vi.hoisted(() => ({
  sqls: [] as Array<{ sql: string; p: unknown[] }>,
  person: null as Record<string, unknown> | null,
  lead: { id: "L1", status: "contacted" } as Record<string, unknown> | null,
  matches: [] as Array<{ match_id: string }>,
  stopped: 2,
  inbound: { last_at: null as string | null, n7: 0 },
  params: [] as Array<{ param_key: string; value: number }>,
  events: [] as unknown[][], status: vi.fn(), revoke: vi.fn(), dequeue: vi.fn(), resp: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      const q = sql.replace(/\s+/g, " ").trim();
      h.sqls.push({ sql: q, p });
      if (q.startsWith("SELECT opted_out_at FROM followup_person")) return [h.person ? [h.person] : []];
      if (q.startsWith("SELECT id, status FROM he_lead")) return [h.lead ? [h.lead] : []];
      if (q.startsWith("SELECT DISTINCT match_id FROM qualified_followup")) return [h.matches];
      if (q.startsWith("UPDATE qualified_followup SET stopped_reason = 'opted_out'")) return [{ affectedRows: h.stopped }];
      if (q.includes("FROM he_message WHERE direction = 'in' AND channel = 'whatsapp'")) return [[h.inbound]];
      if (q.includes("FROM he_model_param")) return [h.params];
      if (q.includes("FROM followup_canary")) return [[]];
      if (q.includes("FROM followup_person fp") && q.includes("opted_out_at IS NOT NULL")) return [h.person?.opted_out_at ? [{ hit: 1 }] : []];
      if (q.startsWith("SELECT")) return [[]];
      return [{ affectedRows: 1 }];
    }),
  },
}));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../he-lead.service.js", () => ({ addEvent: vi.fn(async (...a: unknown[]) => { h.events.push(a); }), setLeadStatus: h.status, revokeConsent: h.revoke }));
vi.mock("../he-superbot.service.js", () => ({ dequeueSuperbotForMatch: h.dequeue }));
vi.mock("../candidate-response.service.js", () => ({ recordResponseSafe: h.resp }));

import { recordPersonOptOut, waInboundHealth } from "../followup-optout.service.js";
import { personOptedOut } from "../qualified-followup.service.js";
import { loadFollowupSwitches, switchRefusal } from "../qualified-followup.policy.js";

const NOW = new Date("2026-10-09T05:30:00Z");
beforeEach(() => {
  h.sqls = []; h.person = null; h.lead = { id: "L1", status: "contacted" }; h.matches = [{ match_id: "M1" }]; h.stopped = 2; h.events = []; h.params = [];
  h.inbound = { last_at: null, n7: 0 };
  for (const f of [h.status, h.revoke, h.dequeue, h.resp]) f.mockReset();
  h.resp.mockResolvedValue({ id: 1, created: true, dedupeOf: null, conflict: false });
});

describe("recordPersonOptOut", () => {
  it("email unsubscribe stops every journey of the person (all requisitions), releases them, records opted_out with the source", async () => {
    const r = await recordPersonOptOut("+91 98765 43210", { source: "email_unsubscribe" });
    expect(r).toEqual({ leadId: "L1", journeysStopped: 2 });
    const stop = h.sqls.find((s) => s.sql.startsWith("UPDATE qualified_followup SET stopped_reason = 'opted_out'"))!;
    expect(stop.sql).toContain("journey_state = 'stopped'");
    expect(stop.sql).toContain("WHERE mobile10 = ? AND stopped_reason IS NULL");
    expect(stop.p).toEqual(["9876543210"]);
    expect(h.sqls.find((s) => s.sql.startsWith("INSERT INTO followup_person"))!.p).toEqual(["9876543210", "email_unsubscribe"]);
    expect(h.sqls.some((s) => s.sql.startsWith("UPDATE followup_person SET active_followup_id = NULL WHERE mobile10 = ?"))).toBe(true);
    expect(h.status).toHaveBeenCalledWith("L1", "opted_out");
    expect(h.revoke).toHaveBeenCalledWith("L1", "whatsapp_contact");
    expect(h.events).toContainEqual(["L1", "opted_out", expect.objectContaining({ detail: "email_unsubscribe" })]);
    expect(h.dequeue).toHaveBeenCalledWith("M1");
    expect(h.resp).toHaveBeenCalledWith(expect.objectContaining({ answer: "unsubscribe", channel: "email", mobile10: "9876543210" }));
  });
  it("call result do_not_call records source call", async () => {
    await recordPersonOptOut("9876543210", { source: "call" });
    expect(h.sqls.find((s) => s.sql.startsWith("INSERT INTO followup_person"))!.p[1]).toBe("call");
    expect(h.resp).toHaveBeenCalledWith(expect.objectContaining({ channel: "voice_bot" }));
  });
  it("HR button records source hr with the user id", async () => {
    await recordPersonOptOut("9876543210", { source: "hr", actor: "U-7", detail: "asked on the phone" });
    expect(h.events).toContainEqual(["L1", "opted_out", expect.objectContaining({ actor: "U-7", detail: "hr: asked on the phone" })]);
    expect(h.resp).toHaveBeenCalledWith(expect.objectContaining({ channel: "hr", mode: "manual", handledBy: "U-7" }));
  });
  it("Pinbot STOP: the reply ingest already set the lead, consent, event and response; only the person and journeys here", async () => {
    await recordPersonOptOut("9876543210", { source: "pinbot" });
    expect(h.status).not.toHaveBeenCalled();
    expect(h.events).toEqual([]);
    expect(h.resp).not.toHaveBeenCalled();
    expect(h.sqls.some((s) => s.sql.startsWith("UPDATE qualified_followup SET stopped_reason = 'opted_out'"))).toBe(true);
  });
  it("opt-out without any he_lead still blocks (followup_person holds it)", async () => {
    h.lead = null;
    const r = await recordPersonOptOut("9876543210", { source: "hr", actor: "U-7" });
    expect(r.leadId).toBeNull();
    expect(h.sqls.some((s) => s.sql.startsWith("INSERT INTO followup_person"))).toBe(true);
    h.person = { opted_out_at: "2026-10-09 11:00:00" };
    expect(await personOptedOut("9876543210")).toBe(true);
  });
  it("second STOP is a no-op for the record (no second event or response)", async () => {
    h.person = { opted_out_at: "2026-10-09 10:00:00" };
    h.lead = { id: "L1", status: "opted_out" };
    h.stopped = 0;
    expect(await recordPersonOptOut("9876543210", { source: "email_unsubscribe" })).toEqual({ leadId: "L1", journeysStopped: 0 });
    expect(h.events).toEqual([]);
    expect(h.resp).not.toHaveBeenCalled();
    expect(h.status).not.toHaveBeenCalled();
  });
  it("an invalid mobile records nothing", async () => {
    expect(await recordPersonOptOut("123", { source: "hr" })).toEqual({ leadId: null, journeysStopped: 0 });
    expect(h.sqls).toHaveLength(0);
  });
});

describe("Pinbot inbound health and the canary/live gate", () => {
  it("waInboundHealth reports last inbound, 7-day count and the verified flag", async () => {
    h.inbound = { last_at: "2026-10-08 18:00:00", n7: 4 };
    h.params = [{ param_key: "policy.followup.wa_inbound_verified", value: 1 }];
    expect(await waInboundHealth(NOW)).toEqual({ lastInboundAt: new Date("2026-10-08T12:30:00Z"), inbound7d: 4, verified: true });
  });
  it("switchRefusal: canary/live refused while inbound is unverified unless the owner acknowledged; dry_run/test always allowed", () => {
    expect(switchRefusal("live", { verified: false, acknowledged: false })).toMatch(/inbound/);
    expect(switchRefusal("canary", { verified: false, acknowledged: false })).toMatch(/inbound/);
    expect(switchRefusal("live", { verified: false, acknowledged: true })).toBeNull();
    expect(switchRefusal("live", { verified: true, acknowledged: false })).toBeNull();
    expect(switchRefusal("test", { verified: false, acknowledged: false })).toBeNull();
    expect(switchRefusal("dry_run", { verified: false, acknowledged: false })).toBeNull();
  });
  it("a live/canary screen value with inbound unverified and not acknowledged runs as dry_run (shadow) and says why", async () => {
    h.params = [{ param_key: "policy.followup.meta_live", value: 4 }, { param_key: "policy.followup.he", value: 3 }, { param_key: "policy.followup.meta_old", value: 2 }];
    const s = await loadFollowupSwitches({ QUAL_FOLLOWUP_MODE: "live" } as NodeJS.ProcessEnv);
    expect(s.sourceModes).toEqual({ meta_live: "dry_run", he: "dry_run", meta_old: "test" });
    expect(s.inboundGate).toBe(true);
    h.params.push({ param_key: "policy.followup.wa_inbound_ack", value: 1 });
    const t = await loadFollowupSwitches({ QUAL_FOLLOWUP_MODE: "live" } as NodeJS.ProcessEnv);
    expect(t.sourceModes.meta_live).toBe("live");
    expect(t.inboundGate).toBe(false);
  });
});
