import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const logger = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../logger.js", () => ({ logger }));

import { collectShadowComparison, compareShadow } from "../qualified-followup.shadow.js";
import { followupTimeline, getFollowupAudit } from "../qualified-followup.attention.js";

const from = new Date("2026-10-08T08:30:00+05:30");
const to = new Date("2026-10-09T08:30:00+05:30");

beforeEach(() => { execute.mockReset(); Object.values(logger).forEach((f) => f.mockReset()); });

describe("shadow comparison", () => {
  const shadow = [
    // A: would send, engine sent the same day -> matched
    { mobile10: "9000000001", day: "2026-10-08", step: "whatsapp", verdict: "would_send", template_key: "he_walkin_invite" },
    // B: would send, nothing sent -> unified-only (by step)
    { mobile10: "9000000002", day: "2026-10-08", step: "email", verdict: "would_send", template_key: "he_walkin_invite_email" },
    // C: the unified guard said quiet_hours, the engine sent anyway -> engine-only with that reason
    { mobile10: "9000000003", day: "2026-10-08", step: "whatsapp", verdict: "quiet_hours", template_key: "he_walkin_invite" },
  ];
  const engine = [
    { mobile10: "9000000001", day: "2026-10-08", k: "he_walkin_invite" },
    { mobile10: "9000000003", day: "2026-10-08", k: "he_walkin_invite" },
    // D: shadowed person, no shadow row that day -> engine-only, no step due
    { mobile10: "9000000004", day: "2026-10-08", k: "he_reminder_1d" },
  ];
  const legacy = [{ mobile10: "9000000005", day: "2026-10-08" }];

  it("matched / unified-only (would send, nothing sent) / engine-only with reason / legacy-only", () => {
    const c = compareShadow(shadow, engine, legacy);
    expect(c.matched).toBe(1);
    expect(c.unifiedOnly).toEqual({ email: 1 });
    expect(c.legacyOnly.engine).toEqual({ quiet_hours: 1, no_step_due: 1 });
    expect(c.legacyOnly.legacy_meta).toEqual({ no_step_due: 1 });
    expect(c.samples.join(" ")).not.toMatch(/\d{10}/);
    expect(c.samples.some((x) => x.includes("xxxxxx0003") && x.includes("quiet_hours"))).toBe(true);
  });

  it("a legacy send to a person the shadow would also have messaged is matched", () => {
    const c = compareShadow([{ mobile10: "9000000005", day: "2026-10-08", step: "whatsapp", verdict: "would_send", template_key: "he_winback" }], [], legacy);
    expect(c).toMatchObject({ matched: 1, unifiedOnly: {}, legacyOnly: { engine: {}, legacy_meta: {} } });
  });

  it("collectShadowComparison reads the window for shadowed (dry_run) people only, other paths only", async () => {
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes("FROM followup_shadow")) return [shadow];
      if (q.includes("FROM he_message")) return [engine];
      if (q.includes("FROM meta_lead_raw")) return [legacy];
      return [[]];
    });
    const c = await collectShadowComparison(from, to);
    expect(c.matched).toBe(1);
    const sqls = execute.mock.calls.map(([q]) => String(q));
    const eng = sqls.find((q) => q.includes("FROM he_message"))!;
    expect(eng).toMatch(/sent_by IS NULL OR m\.sent_by <> 'followup'/);
    expect(eng).toContain("mode_at_enqueue = 'dry_run'");
    expect(sqls.find((q) => q.includes("FROM meta_lead_raw"))).toContain("notification_sent_at");
    expect(execute.mock.calls.find(([q]) => String(q).includes("FROM followup_shadow"))![1]).toEqual(["2026-10-08 08:30:00", "2026-10-09 08:30:00"]);
  });
});

describe("per-person timeline", () => {
  it("timeline merges sends, skips with reason and shadow rows in time order", async () => {
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes("FROM he_message")) return [[
        { at: "2026-10-08 10:05:00", direction: "out", channel: "whatsapp", template_key: "he_walkin_invite:abc", delivery_status: "delivered", sent_by: "followup" },
        { at: "2026-10-08 12:00:00", direction: "in", channel: "whatsapp", template_key: null, delivery_status: null, sent_by: null },
        { at: "2026-10-08 09:00:00", direction: "out", channel: "email", template_key: "he_walkin_invite_email", delivery_status: "sent", sent_by: "followup" },
      ]];
      if (q.includes("FROM he_lead_event")) return [[
        { at: "2026-10-08 09:30:00", event_type: "followup_skip", channel: "whatsapp", detail: "whatsapp:quiet_hours" },
        { at: "2026-10-08 13:00:00", event_type: "opted_out", channel: "whatsapp", detail: "STOP from 9876543210" },
      ]];
      if (q.includes("FROM followup_shadow")) return [[{ at: "2026-10-08 08:00:00", step: "whatsapp", verdict: "would_send", template_key: "he_walkin_invite" }]];
      return [[]];
    });
    const t = await followupTimeline({ id: "f1", mobile10: "9876543210", requisitionId: "r1", heLeadId: "l1" });
    expect(t.map((e) => [e.at, e.kind, e.step])).toEqual([
      ["2026-10-08 08:00:00", "shadow", "whatsapp"],
      ["2026-10-08 09:00:00", "sent", "email"],
      ["2026-10-08 09:30:00", "skip", "whatsapp"],
      ["2026-10-08 10:05:00", "sent", "whatsapp"],
      ["2026-10-08 12:00:00", "reply", "whatsapp"],
      ["2026-10-08 13:00:00", "stop", "whatsapp"],
    ]);
    expect(t[2].detail).toBe("quiet_hours");
    expect(t[3].detail).toContain("he_walkin_invite");
    expect(JSON.stringify(t)).not.toMatch(/\d{10}/);
  });

  it("getFollowupAudit carries the timeline; a failed timeline read gives an empty list", async () => {
    execute.mockResolvedValueOnce([[{ id: "f1", source_type: "he", origin_id: "o", origin_label: "Pool", mode_at_enqueue: "live", mobile10: "9876543210", requisition_id: "r1", he_lead_id: null, call_state: "pending" }]]);
    execute.mockRejectedValue(new Error("no table"));
    const a = await getFollowupAudit("f1");
    expect(a?.timeline).toEqual([]);
  });
});
