import { describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));

import { isQualityServiceUnavailable, qualityRetry } from "@/hooks/useAgentQualityData";

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

describe("quality service outage handling", () => {
  it("recognises a 503 from the quality routes", () => {
    expect(isQualityServiceUnavailable(httpError(503))).toBe(true);
    expect(isQualityServiceUnavailable(httpError(500))).toBe(false);
    expect(isQualityServiceUnavailable(new Error("network"))).toBe(false);
  });

  it("never retries a 503 but still retries other failures up to the limit", () => {
    const retry = qualityRetry(2);
    expect(retry(0, httpError(503))).toBe(false);
    expect(retry(0, httpError(500))).toBe(true);
    expect(retry(1, httpError(500))).toBe(true);
    expect(retry(2, httpError(500))).toBe(false);
  });
});
