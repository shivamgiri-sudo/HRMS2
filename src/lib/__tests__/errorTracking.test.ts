import { describe, expect, it } from "vitest";
import { apiPathTemplate, captureApiFailure, captureBoundaryError, frontendDsn, IGNORED_ERRORS, initErrorTracking, isErrorTrackingEnabled } from "../errorTracking";

describe("frontend error tracking is off by default", () => {
  it("has no DSN without VITE_ERROR_TRACKING_DSN", () => {
    expect(frontendDsn({})).toBeNull();
    expect(frontendDsn({ VITE_ERROR_TRACKING_DSN: "" })).toBeNull();
    expect(frontendDsn({ VITE_ERROR_TRACKING_DSN: "nonsense" })).toBeNull();
    expect(frontendDsn({ VITE_ERROR_TRACKING_DSN: "http://host/1" })).toBeNull();
    expect(frontendDsn({ VITE_ERROR_TRACKING_DSN: "http://k@host:8710/1" })).toBe("http://k@host:8710/1");
  });

  it("init resolves false and the capture helpers are harmless no-ops", async () => {
    await expect(initErrorTracking()).resolves.toBe(false);
    expect(isErrorTrackingEnabled()).toBe(false);
    expect(captureBoundaryError(new Error("x"))).toBeUndefined();
    expect(() => captureApiFailure("GET", "/api/x", 500, "abc")).not.toThrow();
  });
});

describe("apiPathTemplate", () => {
  it.each([
    ["/api/employees/12345", "/api/employees/:id"],
    ["/api/employees/3f2b8c1e-9a7d-4c2e-b1f0-123456789abc/profile", "/api/employees/:id/profile"],
    ["/api/employees/MAS12345/payslips?month=2026-09", "/api/employees/:id/payslips"],
    ["/api/ats/queue/live", "/api/ats/queue/live"],
  ])("%s -> %s", (input, expected) => expect(apiPathTemplate(input)).toBe(expected));
});

describe("ignored errors", () => {
  const ignored = (msg: string) => IGNORED_ERRORS.some((p) => (typeof p === "string" ? msg.includes(p) : p.test(msg)));
  it("skips stale-chunk and extension noise but not real errors", () => {
    expect(ignored("Failed to fetch dynamically imported module: https://x/assets/a.js")).toBe(true);
    expect(ignored("ResizeObserver loop limit exceeded")).toBe(true);
    expect(ignored("Script error.")).toBe(true);
    expect(ignored("TypeError: Cannot read properties of undefined (reading 'map')")).toBe(false);
  });
});
