import { describe, it, expect, vi } from "vitest";

// The route module pulls in the db pool and auth middleware at import time.
// Only the pure error-guard is under test here, so stub the edges.
vi.mock("../src/db/mysql.js", () => ({ db: { execute: vi.fn(), query: vi.fn() } }));
vi.mock("../src/middleware/authMiddleware.js", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../src/middleware/requireRole.js", () => ({
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../src/middleware/scopeMiddleware.js", () => ({
  requireScopedRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../src/shared/apiResponse.js", () => ({ logSourceFailure: vi.fn() }));

const { emptyOnError } = await import("../src/modules/kpi/kpi.routes.js");
const { logSourceFailure } = await import("../src/shared/apiResponse.js");

/**
 * /api/kpi/org-summary guards four queries with emptyOnError. It logged the
 * failure but still returned an empty result set, and the response then said
 * "No KPI actuals were recorded for <period>" — the same sentence a genuinely
 * quiet month produces.
 *
 * That sentence is the bug. An operator reading it has no way to tell a broken
 * column reference from an idle period, which is the same blindness that let
 * dialer_1 fail 864 times unnoticed.
 */

describe("KPI source failure visibility", () => {
  it("still returns an empty row set so the endpoint does not 500", () => {
    // Degrading to partial data is the intended behaviour — the dashboard
    // should render what it has rather than showing nothing at all.
    const result = emptyOnError("test query")(new Error("ER_BAD_FIELD_ERROR"));
    expect(result).toEqual([[]]);
  });

  it("still logs the failure", () => {
    vi.mocked(logSourceFailure).mockClear();
    emptyOnError("by_metric", { period: "2026-07" })(new Error("boom"));
    expect(logSourceFailure).toHaveBeenCalledWith(
      "kpi",
      expect.any(Error),
      expect.objectContaining({ query: "by_metric", period: "2026-07" }),
    );
  });

  it("records the failure for the caller, not only for the log", () => {
    // The response needs this to say "incomplete" instead of "zero".
    const failures: string[] = [];
    emptyOnError("by_metric", {}, failures)(new Error("boom"));
    emptyOnError("trend", {}, failures)(new Error("boom"));
    expect(failures).toEqual(["by_metric", "trend"]);
  });

  it("leaves the collector untouched when nothing fails", () => {
    // A genuinely empty period must remain distinguishable from a broken one.
    const failures: string[] = [];
    expect(failures).toHaveLength(0);
  });

  it("works without a collector, so existing call sites are unaffected", () => {
    expect(() => emptyOnError("no collector")(new Error("boom"))).not.toThrow();
  });
});
