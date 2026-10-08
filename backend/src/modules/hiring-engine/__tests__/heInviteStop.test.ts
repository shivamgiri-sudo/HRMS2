import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ sqls: [] as Array<{ sql: string; p: unknown[] }>, calls: [] as string[] }));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      h.sqls.push({ sql, p });
      if (sql.includes("FROM he_match m JOIN he_lead l ON l.id = m.lead_id WHERE m.id = ?")) return [[{ id: "M1", lead_id: "L1", requisition_id: "R1", drive_id: "D1", mobile10: "9876543210", status: "contacted", meta_lead_id: "ML1" }]];
      if (sql.includes("SELECT UUID() AS id")) return [[{ id: "U1" }]];
      return [[]];
    }),
  },
}));
vi.mock("../he-lead.service.js", () => ({
  addEvent: vi.fn(async (_l: string, e: string) => { h.calls.push(`event:${e}`); }),
  setLeadStatus: vi.fn(async (_l: string, s: string) => { h.calls.push(`status:${s}`); }),
  revokeConsent: vi.fn(async (_l: string, k: string) => { h.calls.push(`revoke:${k}`); }),
  findLeadByMobile: vi.fn(), persistSignals: vi.fn(), upsertLead: vi.fn(),
}));
vi.mock("../he-send.service.js", () => ({ sendTemplateToLead: vi.fn(async (a: { key: string }) => { h.calls.push(`send:${a.key}`); return { status: "sent" }; }) }));
vi.mock("../he-superbot.service.js", () => ({ dequeueSuperbotForMatch: vi.fn(async () => { h.calls.push("dequeue"); }) }));
vi.mock("../he-master.service.js", () => ({ refreshLeadHistoryById: vi.fn() }));
vi.mock("../he-bot.service.js", () => ({ answerCandidateQuestion: vi.fn(), isLocationTap: vi.fn(() => false), sendLocationLink: vi.fn() }));
vi.mock("../he-insight.service.js", () => ({ recomputeInsight: vi.fn() }));
vi.mock("../qualified-followup.attention.js", () => ({ markFollowupCalled: vi.fn() }));
vi.mock("../he-followup-email.service.js", () => ({ sendFollowUpEmail: vi.fn() }));

import { recordInviteStop } from "../he-ingest.service.js";

beforeEach(() => { h.sqls = []; h.calls = []; });

describe("recordInviteStop", () => {
  it("opts the lead out (event opted_out, consent revoked, match declined), no WhatsApp ack, Meta mirrored", async () => {
    expect(await recordInviteStop("M1")).toEqual({ state: "stopped" });
    expect(h.calls).toEqual(expect.arrayContaining(["status:opted_out", "revoke:whatsapp_contact", "event:opted_out"]));
    expect(h.calls.some((c) => c.startsWith("send:"))).toBe(false);
    expect(h.sqls.find((s) => s.sql.startsWith("UPDATE he_match SET state"))!.p).toEqual(["declined", "M1"]);
    expect(h.sqls.find((s) => s.sql.includes("INSERT INTO he_message"))!.p).toContain("opt_out");
    expect(h.sqls.some((s) => s.sql.includes("UPDATE meta_lead_raw SET") && s.sql.includes("walkin_declined"))).toBe(true);
  });
  it("unknown match → null", async () => {
    const { db } = await import("../../../db/mysql.js");
    (db.execute as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => [[]]);
    expect(await recordInviteStop("nope")).toBeNull();
  });
});
