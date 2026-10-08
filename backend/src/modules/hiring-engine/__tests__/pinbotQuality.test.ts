import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn());
vi.mock("axios", () => ({ default: { get } }));

import { fetchPinbotQuality, getPinbotQuality, resetPinbotQualityCache } from "../he-pinbot-quality.service.js";

beforeEach(() => {
  get.mockReset();
  resetPinbotQualityCache();
  vi.stubEnv("PINBOT_API_KEY", "secret-key");
  vi.stubEnv("PINBOT_PHONE_NUMBER_ID", "12345");
  vi.stubEnv("PINBOT_BASE_URL", "");
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("fetchPinbotQuality", () => {
  it("reads quality_rating from GET {base}/{phone number id} with the apikey header", async () => {
    get.mockResolvedValue({ data: { verified_name: "MAS", quality_rating: "GREEN", display_phone_number: "+91 98" } });
    expect(await fetchPinbotQuality()).toBe("GREEN");
    const [url, cfg] = get.mock.calls[0];
    expect(url).toBe("https://partnersv1.pinbot.ai/v3/12345");
    expect(cfg.headers.apikey).toBe("secret-key");
    expect(cfg.timeout).toBe(8000);
  });
  it("normalises odd values to UNKNOWN", async () => {
    get.mockResolvedValue({ data: { quality_rating: "NA" } });
    expect(await fetchPinbotQuality()).toBe("UNKNOWN");
  });
  it("returns null when the request fails, without leaking the key", async () => {
    get.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await fetchPinbotQuality()).toBeNull();
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret-key");
    spy.mockRestore();
  });
  it("returns null without an HTTP call when not configured", async () => {
    vi.stubEnv("PINBOT_API_KEY", "");
    expect(await fetchPinbotQuality()).toBeNull();
    vi.stubEnv("PINBOT_API_KEY", "k");
    vi.stubEnv("PINBOT_PHONE_NUMBER_ID", "");
    expect(await fetchPinbotQuality()).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});

describe("getPinbotQuality", () => {
  it("caches for 30 minutes, then polls again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-07T10:00:00Z"));
    get.mockResolvedValue({ data: { quality_rating: "YELLOW" } });
    expect(await getPinbotQuality()).toBe("YELLOW");
    vi.advanceTimersByTime(29 * 60_000);
    expect(await getPinbotQuality()).toBe("YELLOW");
    expect(get).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2 * 60_000);
    await getPinbotQuality();
    expect(get).toHaveBeenCalledTimes(2);
  });
  it("a failed poll is null (unknown), never GREEN, and is cached too", async () => {
    get.mockRejectedValue(new Error("down"));
    expect(await getPinbotQuality()).toBeNull();
    expect(await getPinbotQuality()).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
  });
});
