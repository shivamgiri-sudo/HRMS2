import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../he-read-limit.js", () => ({ limitedDb: { execute } }));

import { personTimeline } from "../response-timeline.service.js";

const ALL = { all: true } as const;
const PUNE = { all: false, branchName: "PUNE" } as const;
type Rows = Record<string, unknown>[];
let t: Record<string, Rows | Error>;
const pick = (q: string): string | null =>
  q.includes("FROM candidate_response cr LEFT JOIN job_requisition jr ON jr.id = cr.requisition_id WHERE cr.id = ?") ? "byResponse"
    : q.includes("FROM he_match m JOIN he_lead l ON l.id = m.lead_id LEFT JOIN job_requisition jr ON jr.id = m.requisition_id WHERE m.id = ?") ? "byMatch"
      : q.includes("FROM he_lead l WHERE l.id = ?") ? "byLead" : q.includes("FROM he_lead l WHERE l.mobile10 = ?") ? "leadOfMobile"
        : q.includes("AS in_scope") ? "scope" : q.includes("FROM he_message hm") ? "messages" : q.includes("FROM candidate_response cr WHERE cr.mobile10 = ?") ? "responses"
          : q.includes("FROM he_lead_event ev") ? "events" : q.includes("FROM he_call hc") ? "calls" : q.includes("FROM meta_lead_messages mm") ? "metaMessages"
            : q.includes("FROM meta_lead_raw ml WHERE ml.id IN") ? "metaFills" : q.includes("FROM walkin_invite wi") ? "invites"
              : q.includes("SELECT DISTINCT cr.meta_lead_id") ? "metaIds" : null;

beforeEach(() => {
  t = {
    byResponse: [{ mobile10: "9876543210", lead_id: "L1", meta_lead_id: "ML1", branch_name: "PUNE" }],
    byLead: [{ id: "L1", mobile10: "9876543210", meta_lead_id: "ML1", full_name: "Asha Kumari" }],
    leadOfMobile: [{ id: "L1", mobile10: "9876543210", meta_lead_id: "ML1", full_name: "Asha Kumari" }],
    scope: [{ in_scope: 1 }],
    messages: [
      { created_at: "2026-10-07 10:00:00", direction: "out", channel: "email", template_key: "he_walkin_invite", body: "Invite", delivery_status: "sent" },
      { created_at: "2026-10-07 12:00:00", direction: "in", channel: "whatsapp", template_key: null, body: "ok call 9876543210", delivery_status: null },
    ],
    responses: [{ occurred_at: "2026-10-07 12:00:01", channel: "whatsapp", mode: "text", answer: "question", status: "needs_review", conflict: 0 }],
    events: [{ created_at: "2026-10-07 09:00:00", event_type: "invited", channel: "email", detail: null }],
    calls: [{ created_at: "2026-10-08 09:00:00", outcome: "WALKIN_CONFIRMED_YES", summary: "said yes" }],
    metaMessages: [{ created_at: "2026-10-06 08:00:00", direction: "outbound", message_text: "Hello from MAS" }],
    metaFills: [{ id: "ML1", notification_sent_at: "2026-10-06 07:59:00", notification_channels: "[\"email\",\"whatsapp\"]" }],
    invites: [{ last_sent_at: "2026-10-06 08:30:00", source_path: "legacy_meta", send_count: 2, state: "sent" }],
    metaIds: [{ meta_lead_id: "ML1" }],
  };
  execute.mockReset();
  execute.mockImplementation(async (q: string) => {
    const k = pick(String(q));
    const v = k ? t[k] : undefined;
    if (v instanceof Error) throw v;
    return [v ?? []];
  });
});

describe("personTimeline", () => {
  it("merges messages, responses, events, calls, Meta messages, Meta invitations and invite links, newest first", async () => {
    const r = (await personTimeline({ responseId: 7 }, ALL))!;
    expect(r.items.map((i) => [i.at, i.kind])).toEqual([
      ["2026-10-08 09:00:00", "call"], ["2026-10-07 12:00:01", "response"], ["2026-10-07 12:00:00", "in"], ["2026-10-07 10:00:00", "out"],
      ["2026-10-07 09:00:00", "event"], ["2026-10-06 08:30:00", "out"], ["2026-10-06 08:00:00", "out"], ["2026-10-06 07:59:00", "out"],
    ]);
    expect(r.items[0]).toMatchObject({ channel: "voice_bot", label: "Call: walkin confirmed yes" });
    expect(r.items[1]).toMatchObject({ channel: "whatsapp", label: "Answer: question (needs review)" });
    expect(r.items[7]).toMatchObject({ label: "Meta invitation sent", detail: "email, whatsapp" });
    expect(r.person).toEqual({ name: "Asha K.", mobileMasked: "xxxxxx3210" });
    expect(r.truncated).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/\d{10}/);
  });
  it("a branch user: a response outside their branch is not found; a lead with nothing in their branch is not found", async () => {
    t.byResponse = [{ mobile10: "9876543210", lead_id: "L1", meta_lead_id: null, branch_name: "DELHI" }];
    expect(await personTimeline({ responseId: 7 }, PUNE)).toBeNull();
    t.scope = [{ in_scope: 0 }];
    expect(await personTimeline({ leadId: "L1" }, PUNE)).toBeNull();
    t.scope = [{ in_scope: 1 }];
    expect(await personTimeline({ leadId: "L1" }, PUNE)).not.toBeNull();
  });
  it("unknown key is null; reads are keyed by the person's mobile / lead / Meta ids", async () => {
    t.byResponse = [];
    expect(await personTimeline({ responseId: 7 }, ALL)).toBeNull();
    t.byResponse = [{ mobile10: "9876543210", lead_id: "L1", meta_lead_id: "ML1", branch_name: "PUNE" }];
    await personTimeline({ responseId: 7 }, ALL);
    const sql = execute.mock.calls.map(([q, p]) => [String(q), p as unknown[]] as const);
    expect(sql.find(([q]) => pick(q) === "messages")![0]).toContain("WHERE hm.mobile10 = ?");
    expect(sql.find(([q]) => pick(q) === "events")![0]).toContain("WHERE ev.lead_id = ?");
    expect(sql.find(([q]) => pick(q) === "metaMessages")![1]).toEqual(["ML1"]);
  });
  it("tables not deployed yet (candidate_response, walkin_invite) read as nothing", async () => {
    t.responses = Object.assign(new Error("x"), { code: "ER_NO_SUCH_TABLE" });
    t.invites = Object.assign(new Error("x"), { code: "ER_NO_SUCH_TABLE" });
    t.metaIds = Object.assign(new Error("x"), { code: "ER_NO_SUCH_TABLE" });
    const r = (await personTimeline({ leadId: "L1" }, ALL))!;
    expect(r.items.some((i) => i.kind === "response")).toBe(false);
    expect(r.items.length).toBeGreaterThan(0);
  });
  it("caps at 300 items and says so", async () => {
    t.messages = Array.from({ length: 320 }, (_, i) => ({ created_at: `2026-10-07 ${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00`, direction: "out", channel: "whatsapp", template_key: "t", body: "x" }));
    const r = (await personTimeline({ leadId: "L1" }, ALL))!;
    expect(r.items).toHaveLength(300);
    expect(r.truncated).toBe(true);
  });
});
