import { beforeEach, describe, expect, it, vi } from "vitest";

// Plain recorder, not vi.fn: vitest 4 reports an error thrown through a vi.fn implementation as a test failure even when the caller catches it.
const h = vi.hoisted(() => ({ calls: [] as unknown[][], reply: (() => ({ data: {} })) as () => unknown }));
vi.mock("axios", () => ({ default: { post: async (...a: unknown[]) => { h.calls.push(a); return h.reply(); }, isAxiosError: (e: unknown) => Boolean((e as { isAxiosError?: boolean })?.isAxiosError) } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../he-call-ref.service.js", () => ({ existingRef: vi.fn(async () => "HRMS-007") }));
vi.mock("../he-secrets.service.js", () => ({
  superbotConfig: vi.fn(async () => ({ apiKey: "k".repeat(32), superbotId: "O3nqdwL8r2Z8", campaignId: "27425", baseUrl: "https://api.superbot.one/tel/v2", lang: "en-IN" })),
}));

import { dequeueSuperbotForMatch, queueSuperbotCall, testSuperbotConnection } from "../he-superbot.service.js";

const BASE = "https://api.superbot.one/tel/v2/superbot/O3nqdwL8r2Z8/campaign/27425";
/** Shaped like an AxiosError with a response. */
const httpErr = (status: number, data: unknown) => ({ isAxiosError: true, message: `status ${status}`, response: { status, data } });

beforeEach(() => { h.calls = []; h.reply = () => ({ data: {} }); });

describe("superbot service URLs (integration doc)", () => {
  it("queues a single call on the campaign /call endpoint", async () => {
    h.reply = () => ({ data: { status: true, capture_request_id: "abc" } });
    const r = await queueSuperbotCall({ referenceId: "HRMS-001", mobile10: "9983281723", params: { name: "John", role: "QA", interview_date: "12/10/2026", interview_time: "10 AM", branch_address: "Noida" } });
    expect(r).toEqual({ ok: true, requestId: "abc" });
    expect(h.calls[0][0]).toBe(`${BASE}/call`);
    expect(h.calls[0][1]).toMatchObject({ numbers: [{ phone: "+919983281723", reference_id: "HRMS-001" }], lang: "en-IN" });
  });
  it("dequeues by reference on the campaign /contact/dequeue/ endpoint", async () => {
    h.reply = () => ({ data: { status: true } });
    expect(await dequeueSuperbotForMatch("M1")).toBe(true);
    expect(h.calls[0][0]).toBe(`${BASE}/contact/dequeue/`);
    expect(h.calls[0][1]).toEqual({ reference_id: "HRMS-007" });
    expect(h.calls[0][2].headers.apiKey).toBe("k".repeat(32));
  });
  it("dequeue never throws when the contact is not in the queue", async () => {
    h.reply = () => { throw httpErr(404, { message: "Contact Not Found In Queue" }); };
    expect(await dequeueSuperbotForMatch("M1")).toBe(false);
  });
});

describe("testSuperbotConnection", () => {
  it("passes only on Superbot's own 'not found in queue' reply", async () => {
    h.reply = () => { throw httpErr(404, { message: "Contact Not Found In Queue" }); };
    expect((await testSuperbotConnection()).ok).toBe(true);
    expect(h.calls[0][0]).toBe(`${BASE}/contact/dequeue/`);
  });
  it("fails on a bare 404 (wrong path, Superbot id or campaign)", async () => {
    h.reply = () => { throw httpErr(404, "<html>Not Found</html>"); };
    expect(await testSuperbotConnection()).toMatchObject({ ok: false, message: expect.stringMatching(/404/) });
  });
  it("fails on a rejected key", async () => {
    h.reply = () => { throw httpErr(401, { success: false, message: "Invalid API key" }); };
    expect((await testSuperbotConnection()).ok).toBe(false);
  });
});
