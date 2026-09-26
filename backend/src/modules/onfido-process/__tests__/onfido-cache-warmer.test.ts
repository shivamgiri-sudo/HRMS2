import type { NextFunction, Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getOverviewReport, getAnalystReport } = vi.hoisted(() => ({
  getOverviewReport: vi.fn(),
  getAnalystReport: vi.fn(),
}));

vi.mock("../onfido-overview-report.service.js", () => ({ getOverviewReport }));
vi.mock("../onfido-analyst-report.service.js", () => ({ getAnalystReport }));

import {
  clearOnfidoResponseCache,
  onfidoResponseCache,
} from "../onfido-response-cache.js";
import {
  onfidoWarmKeys,
  startOnfidoCacheWarmer,
  stopOnfidoCacheWarmer,
  warmOnfidoCacheOnce,
} from "../onfido-cache-warmer.js";

/** Sends a request through the real cache middleware and reports what it answered with. */
function request(url: string): { hit: boolean; body: unknown } {
  let body: unknown;
  let handlerRan = false;
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    json(b: unknown) {
      body = b;
      return this;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    on: vi.fn(),
  } as unknown as Response;
  const req = {
    method: "GET",
    originalUrl: url,
    path: url.split("?")[0],
  } as unknown as Request;
  const next: NextFunction = () => {
    handlerRan = true;
  };
  onfidoResponseCache(req, res, next);
  return { hit: headers["X-Onfido-Cache"] === "hit" && !handlerRan, body };
}

describe("onfidoWarmKeys", () => {
  it("builds the exact URLs the dashboard requests on first load", () => {
    const keys = onfidoWarmKeys(new Date(2026, 8, 26, 10, 0, 0)); // 26 Sep 2026, local time
    expect(keys.overview).toBe(
      "/api/onfido-process/overview-report?from=2026-06-28&to=2026-09-26&granularity=monthly",
    );
    expect(keys.analyst).toBe(
      "/api/onfido-process/analyst-report?from=2026-08-28&to=2026-09-26",
    );
  });

  it("uses the local calendar date, not UTC, so it matches the browser near midnight", () => {
    const keys = onfidoWarmKeys(new Date(2026, 8, 1, 0, 30, 0)); // 00:30 local on 1 Sep
    expect(keys.overview).toContain("&to=2026-09-01&");
    expect(keys.analyst).toContain("&to=2026-09-01");
  });
});

describe("warmOnfidoCacheOnce", () => {
  beforeEach(() => {
    clearOnfidoResponseCache();
    getOverviewReport.mockReset();
    getAnalystReport.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  const now = new Date(2026, 8, 26, 10, 0, 0);

  it("fills the cache so the page's own first requests are cache hits with the same body shape", async () => {
    getOverviewReport.mockResolvedValue({ marker: "overview" });
    getAnalystReport.mockResolvedValue({ marker: "analyst" });

    const result = await warmOnfidoCacheOnce(now);

    expect(result).toEqual({ warmed: 2, failed: 0 });
    expect(getOverviewReport).toHaveBeenCalledWith(
      {
        from: "2026-06-28",
        to: "2026-09-26",
        tlName: undefined,
        amName: undefined,
      },
      "monthly",
    );
    expect(getAnalystReport).toHaveBeenCalledWith({
      from: "2026-08-28",
      to: "2026-09-26",
      tlName: undefined,
      amName: undefined,
    });
    const keys = onfidoWarmKeys(now);
    expect(request(keys.overview)).toEqual({
      hit: true,
      body: { success: true, data: { marker: "overview" } },
    });
    expect(request(keys.analyst)).toEqual({
      hit: true,
      body: { success: true, data: { marker: "analyst" } },
    });
  });

  it("keeps going when one report fails, and never caches the failed one", async () => {
    getOverviewReport.mockRejectedValue(new Error("onfido db slow"));
    getAnalystReport.mockResolvedValue({ marker: "analyst" });

    const result = await warmOnfidoCacheOnce(now);

    expect(result).toEqual({ warmed: 1, failed: 1 });
    const keys = onfidoWarmKeys(now);
    expect(request(keys.analyst).hit).toBe(true);
    expect(request(keys.overview).hit).toBe(false);
  });

  it("computes one report at a time, so the warm-up never doubles the load on the Onfido database", async () => {
    let running = 0;
    let peak = 0;
    const slow = async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return {};
    };
    getOverviewReport.mockImplementation(slow);
    getAnalystReport.mockImplementation(slow);

    await warmOnfidoCacheOnce(now);

    expect(peak).toBe(1);
  });
});

describe("startOnfidoCacheWarmer", () => {
  beforeEach(() => {
    clearOnfidoResponseCache();
    getOverviewReport.mockReset().mockResolvedValue({});
    getAnalystReport.mockReset().mockResolvedValue({});
  });
  afterEach(() => {
    stopOnfidoCacheWarmer();
    vi.useRealTimers();
  });

  it("warms immediately, refreshes before the 30 minute cache expiry, and can be stopped", async () => {
    vi.useFakeTimers();
    startOnfidoCacheWarmer();
    startOnfidoCacheWarmer(); // a second start must not add a second timer
    await vi.advanceTimersByTimeAsync(0);
    expect(getOverviewReport).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(25 * 60 * 1000 + 1);
    expect(getOverviewReport).toHaveBeenCalledTimes(2);

    stopOnfidoCacheWarmer();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(getOverviewReport).toHaveBeenCalledTimes(2);
  });
});
