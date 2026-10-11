import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], on: true, classify: vi.fn(), manual: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: vi.fn(async (sql: string) => {
    if (sql.includes("he_model_param")) return [h.on ? [] : [{ value: 0 }], []];
    return [h.rows, []];
  }) },
}));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../response-actions.service.js", () => ({
  classifyResponse: (...a: unknown[]) => h.classify(...a),
  manualResponse: (...a: unknown[]) => h.manual(...a),
  ResponseActionError: class extends Error { constructor(public status: number, m: string) { super(m); } },
}));
import { autoResolveReplies } from "../response-auto-apply.service.js";
import { prettySlot } from "../reply-agent.rules.js";

const row = (o: Record<string, unknown>) => ({ id: 1, mode: "text", ans: "confirm", confidence: 0.95, match_id: null, invite_id: null, lead_id: "L1", requisition_id: "R1", mobile10: "9000000001", ...o });
const NOW = new Date("2026-10-11T10:00:00Z");
beforeEach(() => { h.rows = []; h.on = true; h.classify.mockReset().mockResolvedValue({ status: "applied", state: "confirmed" }); h.manual.mockReset().mockResolvedValue({ responseId: 9, matchId: null, state: "confirmed" }); });

describe("autoResolveReplies", () => {
  it("applies a clear reply that is tied to a booking through the same path as the button", async () => {
    h.rows = [row({ id: 10, match_id: "M1" })];
    const r = await autoResolveReplies(NOW);
    expect(r.applied).toBe(1);
    expect(h.classify).toHaveBeenCalledWith(expect.objectContaining({ responseId: 10, answer: "confirm", apply: true, confirmPerson: true, actor: "auto-reply" }), expect.anything());
  });
  it("books a person with no booking yet, then closes the reply row", async () => {
    h.rows = [row({ id: 11 })];
    const r = await autoResolveReplies(NOW);
    expect(r.booked).toBe(1);
    expect(h.manual).toHaveBeenCalledWith(expect.objectContaining({ leadId: "L1", requisitionId: "R1", answer: "confirm" }), expect.anything());
    expect(h.classify).toHaveBeenCalledWith(expect.objectContaining({ responseId: 11, apply: false }), expect.anything());
  });
  it("leaves the reply for the next tick when the engine could not book it now", async () => {
    h.manual.mockResolvedValue({ responseId: 0, matchId: null, state: "pending" });
    h.rows = [row({ id: 12 })];
    const r = await autoResolveReplies(NOW);
    expect(r.retryLater).toBe(1);
    expect(h.classify).not.toHaveBeenCalled();
  });
  it("records a decline without booking anything", async () => {
    h.rows = [row({ id: 13, ans: "decline" })];
    const r = await autoResolveReplies(NOW);
    expect(r.recorded).toBe(1);
    expect(h.classify).toHaveBeenCalledWith(expect.objectContaining({ answer: "decline", apply: false }), expect.anything());
  });
  it("does nothing when switched off", async () => {
    h.on = false; h.rows = [row({})];
    expect((await autoResolveReplies(NOW)).off).toBe(true);
    expect(h.classify).not.toHaveBeenCalled();
  });
});

describe("prettySlot", () => {
  it("writes a date and 12-hour time in full words", () => {
    expect(prettySlot("2026-10-12", "10:30")).toBe("Monday, 12 October 2026 at 10:30 AM");
    expect(prettySlot("2026-10-12", "14:00")).toBe("Monday, 12 October 2026 at 2:00 PM");
    expect(prettySlot("2026-10-12", "00:15")).toBe("Monday, 12 October 2026 at 12:15 AM");
    expect(prettySlot("soon", "later")).toBe("soon at later");
  });
});
