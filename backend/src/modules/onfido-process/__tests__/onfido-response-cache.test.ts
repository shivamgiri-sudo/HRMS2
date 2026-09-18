import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearOnfidoResponseCache, onfidoResponseCache } from "../onfido-response-cache.js";

function fakeReq(url: string, method = "GET"): Request {
  return { method, originalUrl: url, path: url.split("?")[0] } as unknown as Request;
}

function fakeRes() {
  const sent: unknown[] = [];
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    json(body: unknown) { sent.push(body); return this; },
    setHeader(name: string, value: string) { headers[name] = value; },
    on: vi.fn(),
  };
  return { res: res as unknown as Response, sent, headers };
}

/** Runs the middleware; `handler` plays the route and replies through res.json. */
function run(url: string, handler: (res: Response) => void, method = "GET") {
  const { res, sent, headers } = fakeRes();
  const next: NextFunction = vi.fn(() => handler(res));
  onfidoResponseCache(fakeReq(url, method), res, next);
  return { sent, headers, next };
}

describe("onfidoResponseCache", () => {
  beforeEach(() => clearOnfidoResponseCache());

  it("serves an identical GET from cache without re-running the route", () => {
    run("/overview?from=a", (res) => res.json({ n: 1 }));
    const second = run("/overview?from=a", (res) => res.json({ n: 2 }));
    expect(second.next).not.toHaveBeenCalled();
    expect(second.sent).toEqual([{ n: 1 }]);
    expect(second.headers["X-Onfido-Cache"]).toBe("hit");
  });

  it("keys on the full query string", () => {
    run("/overview?from=a", (res) => res.json({ n: 1 }));
    const other = run("/overview?from=b", (res) => res.json({ n: 2 }));
    expect(other.sent).toEqual([{ n: 2 }]);
  });

  it("never caches non-GET, /live or error responses", () => {
    run("/overview", (res) => res.json({ n: 1 }), "POST");
    expect(run("/overview", (res) => res.json({ n: 2 })).sent).toEqual([{ n: 2 }]);

    run("/live/overview", (res) => res.json({ n: 1 }));
    expect(run("/live/overview", (res) => res.json({ n: 2 })).sent).toEqual([{ n: 2 }]);

    run("/trend", (res) => { res.statusCode = 500; res.json({ error: true }); });
    expect(run("/trend", (res) => res.json({ ok: true })).sent).toEqual([{ ok: true }]);
  });

  it("drops everything when an import clears the cache", () => {
    run("/overview", (res) => res.json({ n: 1 }));
    clearOnfidoResponseCache();
    expect(run("/overview", (res) => res.json({ n: 2 })).sent).toEqual([{ n: 2 }]);
  });
});
