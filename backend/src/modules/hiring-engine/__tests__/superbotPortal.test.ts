import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: h.execute } }));
vi.mock("../../../logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { botConfig, BOT_PARAMS, bulkImport, resetBotToken } from "../superbot-portal.client.js";
import { botCallToReportRow, normaliseRef, uploadCallFile } from "../superbot-portal.sync.js";
import { parseResultRows } from "../he-call-results.js";

const ENV = { SUPERBOT_EMAIL: "svc@example.test", SUPERBOT_PASSWORD: "pw", SUPERBOT_ACCOUNT_ID: "1965", SUPERBOT_CAMPAIGN_ID: "27425", SUPERBOT_UPLOAD_MODE: "live" };

describe("portal config", () => {
  it("is null until the account, campaign and login are all there", () => {
    expect(botConfig({})).toBeNull();
    expect(botConfig({ ...ENV, SUPERBOT_CAMPAIGN_ID: "abc" })).toBeNull();
    expect(botConfig(ENV)?.uploadMode).toBe("live");
    expect(botConfig({ ...ENV, SUPERBOT_UPLOAD_MODE: "" })?.uploadMode).toBe("off");
    expect(botConfig(ENV)?.base).toBe("https://bytelink.superbot.one/api");
  });
});

describe("portal upload", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetBotToken(); h.execute.mockReset(); });
  const stubFetch = (importStatus: number, importBody: unknown) => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body?: string }) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
      if (url.endsWith("/login")) return { status: 200, json: async () => ({ token: "t" }) };
      return { status: importStatus, json: async () => importBody };
    }));
    return calls;
  };
  const row = ["9876543210", "Asha", "EXECUTIVE", "11 10 2026", "11 00 AM", "Okaya Tower", "QF-0A1B2C3D"];

  it("does nothing unless the upload mode is live", async () => {
    for (const [k, v] of Object.entries({ ...ENV, SUPERBOT_UPLOAD_MODE: "off" })) vi.stubEnv(k, v);
    const calls = stubFetch(200, { success: true });
    const r = await uploadCallFile("b1", [row]);
    expect(r).toMatchObject({ attempted: false, ok: false });
    expect(calls).toHaveLength(0);
  });
  it("posts the mapped parameters with India and the rows, and notes the result on the batch", async () => {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
    const calls = stubFetch(200, { success: true, message: "queued" });
    const r = await uploadCallFile("b1", [row, ["12345", "Bad", "", "", "", "", ""]]);
    expect(r).toMatchObject({ attempted: true, ok: true, total: 1 });
    const post = calls.find((c) => c.url.endsWith("/campaign/27425/bulk-import"));
    expect(post?.body).toEqual({ language_id: 1, country_code: 1, parameters: [...BOT_PARAMS], data: [row], total_data: 1 });
    expect(h.execute.mock.calls.some((c) => String(c[0]).includes("JSON_SET"))).toBe(true);
  });
  it("falls back to the +91 form once when the first country value is rejected, and stops on a server error", async () => {
    const c = botConfig(ENV)!;
    const calls = stubFetch(422, { success: false, message: "country invalid" });
    const r = await bulkImport(c, [row]);
    expect(r.ok).toBe(false);
    expect(calls.filter((x) => x.url.endsWith("/bulk-import")).map((x) => (x.body as { country_code: unknown }).country_code)).toEqual([1, "+91"]);
    resetBotToken();
    const calls2 = stubFetch(500, null);
    await bulkImport(c, [row]);
    expect(calls2.filter((x) => x.url.endsWith("/bulk-import"))).toHaveLength(1);
  });
});

describe("portal results as call-results rows", () => {
  it("normalises the portal's spaced reference", () => {
    expect(normaliseRef("HRMS- 296")).toBe("HRMS-296");
    expect(normaliseRef(" QF-0A1B2C3D ")).toBe("QF-0A1B2C3D");
  });
  it("answered with a disposition parses as the calling tool's report", () => {
    const rep = botCallToReportRow({ callId: "9", reference: "HRMS-188", disposition: "WILL ATTEND WALK-IN INTERVIEW", status: "answered", callStatus: "200", noOfCalls: 1, processedAtIst: "2026-10-08 16:53:02", maskedPhone: "XXXXXX8709" }, "9876543210");
    const p = parseResultRows([rep]);
    expect(p.rows[0]).toMatchObject({ ok: true, outcome: "WALKIN_CONFIRMED_YES", callId: "9", referenceId: "HRMS-188", startedAt: "2026-10-08 16:53:02" });
  });
  it("failed calls and abandoned answers are retryable outcomes", () => {
    const failed = parseResultRows([botCallToReportRow({ callId: "1", reference: "QF-1", disposition: "", status: "failed", callStatus: "", noOfCalls: 0, processedAtIst: "2026-10-08 10:00:00", maskedPhone: "" }, "9876543210")]);
    expect(failed.rows[0].outcome).toBe("CALL_FAILED");
    const abandoned = parseResultRows([botCallToReportRow({ callId: "2", reference: "QF-2", disposition: "", status: "answered", callStatus: "200", noOfCalls: 1, processedAtIst: "2026-10-08 10:00:00", maskedPhone: "" }, "9876543210")]);
    expect(abandoned.rows[0].outcome).toBe("NO_ANSWER");
  });
});
