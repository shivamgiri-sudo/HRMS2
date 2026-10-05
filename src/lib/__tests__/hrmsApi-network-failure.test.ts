/**
 * "Failed to fetch" is the browser's TypeError for a request that never got an answer — seen when
 * the backend restarts during a deploy. A GET is retried once; a write is never retried; and the
 * raw "Failed to fetch" never reaches the UI.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hrmsApi, NETWORK_FAILURE_MESSAGE } from "../hrmsApi";

function fakeLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  } as Storage;
}
const ok = () => new Response(JSON.stringify({ success: true, data: [1] }), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", fakeLocalStorage());
  localStorage.setItem("hrms_access_token", "test-token");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("hrmsApi network failures", () => {
  it("retries a GET once and succeeds when the server is back", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetchMock);
    const p = hrmsApi.get("/api/meta/inbox");
    await vi.advanceTimersByTimeAsync(1600);
    await expect(p).resolves.toMatchObject({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives a readable message, not 'Failed to fetch', when the GET retry also fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const p = hrmsApi.get("/api/meta/inbox");
    const assertion = expect(p).rejects.toThrow(NETWORK_FAILURE_MESSAGE);
    await vi.advanceTimersByTimeAsync(1600);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never retries a POST (it may already have landed)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(hrmsApi.post("/api/meta/leads/x/reply", { message: "hi" })).rejects.toThrow(NETWORK_FAILURE_MESSAGE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
