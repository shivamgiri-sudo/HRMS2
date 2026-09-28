/**
 * A 502/503/504 from nginx during a deploy restart carries no JSON body — just its default
 * HTML error page. Before this fix, buildApiError() treated that HTML as the error message
 * itself, so it rendered verbatim in the UI. Seen live on 2026-09-22: the Branch Ledger tab
 * showed "<html> <head><title>502 Bad Gateway</title>..." as its error banner, mid-deploy.
 *
 * A gateway status must produce a short, friendly sentence instead — never the raw markup.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hrmsApi, getHrmsApiErrorStatus } from "../hrmsApi";

const NGINX_502_PAGE =
  "<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n<center><h1>502 Bad Gateway</h1></center>\r\n<hr><center>nginx/1.18.0 (Ubuntu)</center>\r\n</body>\r\n</html>\r\n";

function htmlResponse(status: number, body: string) {
  return new Response(body, { status, headers: { "content-type": "text/html" } });
}

/** This suite runs under vitest's node environment (no jsdom, no browser localStorage). */
function fakeLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size; },
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", fakeLocalStorage());
  localStorage.setItem("hrms_access_token", "test-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hrmsApi surfaces gateway errors as plain sentences, not raw HTML", () => {
  it("replaces an nginx 502 HTML page with a friendly, deploy-aware message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse(502, NGINX_502_PAGE)));

    await expect(hrmsApi.get("/api/wfm/attendance-ledger/summary")).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining("deploy"),
    });
  });

  it("never lets an HTML error body show up verbatim in the message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse(502, NGINX_502_PAGE)));

    try {
      await hrmsApi.get("/api/wfm/attendance-ledger/summary");
      throw new Error("expected hrmsApi.get to reject");
    } catch (err) {
      expect((err as Error).message).not.toContain("<html>");
      expect((err as Error).message).not.toContain("nginx");
    }
  });

  it("gives a distinct message for 503 and 504 gateway statuses too", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse(503, "<html><body>503 Service Unavailable</body></html>")));
    const err503 = await hrmsApi.get("/api/wfm/attendance-ledger/summary").catch((e) => e);
    expect(getHrmsApiErrorStatus(err503)).toBe(503);
    expect(err503.message).not.toContain("<html>");

    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse(504, "<html><body>504 Gateway Timeout</body></html>")));
    const err504 = await hrmsApi.get("/api/wfm/attendance-ledger/summary").catch((e) => e);
    expect(getHrmsApiErrorStatus(err504)).toBe(504);
    expect(err504.message).not.toContain("<html>");
  });

  it("still surfaces a real backend JSON error message unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ success: false, message: "Date window is limited to 92 days." }, { status: 400 })),
    );

    await expect(hrmsApi.get("/api/wfm/attendance-ledger/summary")).rejects.toMatchObject({
      status: 400,
      message: "Date window is limited to 92 days.",
    });
  });

  it("still surfaces short plain-text (non-HTML) error bodies unchanged", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Gateway auth token expired", { status: 401 })));

    await expect(hrmsApi.get("/api/wfm/attendance-ledger/summary")).rejects.toMatchObject({
      status: 401,
      message: "Gateway auth token expired",
    });
  });
});
