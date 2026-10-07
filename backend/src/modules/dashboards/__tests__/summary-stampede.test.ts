import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/dashboards/SUPER_ADMIN_DASHBOARD/summary returned 502 on prod.
 *
 * The summary already caches its metric bundle for 30s, but QualityCache.getOrSet() only shares a
 * result AFTER it is stored: every request arriving while the entry is missing (cold start, or each
 * 30s expiry) ran the whole bundle itself. SUPER_ADMIN alone is eight metrics with multi-second
 * scans, so a handful of open dashboards multiplied that load and tipped the DB over. Concurrent
 * callers for one key now share the single in-flight computation.
 *
 * Also pinned: the metric predicates that wrapped a DATE column in DATE()/CONVERT_TZ() (forcing a
 * scan of wfm_attendance_session) now compare the column directly, and the two independent
 * attendance-exception reads are issued together.
 */
import { sharedInFlight } from "../metrics-in-flight.js";

describe("sharedInFlight", () => {
  beforeEach(() => vi.useRealTimers());

  it("runs one computation for concurrent callers of the same key", async () => {
    let release: (v: Record<string, unknown>) => void = () => undefined;
    const compute = vi.fn(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          release = resolve;
        }),
    );

    const [a, b, c] = [
      sharedInFlight("k", compute),
      sharedInFlight("k", compute),
      sharedInFlight("k", compute),
    ];
    expect(compute).toHaveBeenCalledTimes(1);
    release({ hc: 1 });
    expect(await Promise.all([a, b, c])).toEqual([
      { hc: 1 },
      { hc: 1 },
      { hc: 1 },
    ]);
  });

  it("keeps different keys independent", async () => {
    const compute = vi.fn(async () => ({}));
    await Promise.all([
      sharedInFlight("x", compute),
      sharedInFlight("y", compute),
    ]);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("forgets the computation once settled, and does not cache a failure", async () => {
    const compute = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ ok: true });
    await expect(sharedInFlight("f", compute)).rejects.toThrow("boom");
    await expect(sharedInFlight("f", compute)).resolves.toEqual({ ok: true });
    expect(compute).toHaveBeenCalledTimes(2);
  });
});

describe("dashboard summary sources", () => {
  const routes = readFileSync(
    resolve(__dirname, "../dashboard.routes.ts"),
    "utf-8",
  );
  const metrics = readFileSync(
    resolve(__dirname, "../dashboard-metric.service.ts"),
    "utf-8",
  );

  it("routes the metric bundle through sharedInFlight in front of the TTL cache", () => {
    expect(routes).toMatch(/sharedInFlight\(\s*metricsCacheKey,/);
    expect(routes).toMatch(/dashboardMetricsCache\.getOrSet\(/);
  });

  it("compares wfm_attendance_session.session_date directly", () => {
    expect(metrics).not.toMatch(/DATE\(s\.session_date\)/);
    expect(metrics).not.toMatch(/DATE\(CONVERT_TZ\(s\.session_date/);
    expect(
      metrics.match(/WHERE s\.session_date = \$\{IST_DATE_EXPR\}/g),
    ).toHaveLength(2);
  });

  it("issues the open-issue and cleared attendance-exception reads together", () => {
    const at = metrics.indexOf(
      "export async function getAttendanceExceptionMetrics",
    );
    const body = metrics.slice(
      at,
      metrics.indexOf("export async function", at + 10),
    );
    expect(body).toMatch(
      /await Promise\.all\(\[openIssuesQuery, clearedQuery\]\)/,
    );
    expect(body).not.toMatch(/await db\.execute/);
  });
});
