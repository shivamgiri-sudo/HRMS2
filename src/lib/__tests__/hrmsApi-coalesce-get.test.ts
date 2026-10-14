/**
 * Overlapping identical GETs share one network request (Branch Budget fired /api/employees/me
 * 3-4 times per load). Sequential calls must NOT be served from a cache, and a caller's own
 * AbortSignal must keep its request separate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hrmsApi } from "../hrmsApi";

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

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("localStorage", fakeLocalStorage());
  localStorage.setItem("hrms_access_token", "t");
  fetchMock = vi.fn(async () => json({ success: true, data: { id: "e1" } }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("hrmsApi.get coalescing", () => {
  it("merges overlapping identical GETs into one request, each caller gets its own copy", async () => {
    const [a, b, c] = await Promise.all([
      hrmsApi.get<any>("/api/employees/me"),
      hrmsApi.get<any>("/api/employees/me"),
      hrmsApi.get<any>("/api/employees/me"),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.data.id).toBe("e1");
    a.data.id = "mutated";
    expect(b.data.id).toBe("e1");
    expect(c.data.id).toBe("e1");
  });

  it("does not cache: a call after the first settles goes to the network again", async () => {
    await hrmsApi.get("/api/employees/me");
    await hrmsApi.get("/api/employees/me");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("different URLs are separate requests", async () => {
    await Promise.all([hrmsApi.get("/api/a"), hrmsApi.get("/api/b")]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a call with its own AbortSignal is never merged", async () => {
    const ctl = new AbortController();
    await Promise.all([hrmsApi.get("/api/employees/me"), hrmsApi.get("/api/employees/me", undefined, ctl.signal)]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
