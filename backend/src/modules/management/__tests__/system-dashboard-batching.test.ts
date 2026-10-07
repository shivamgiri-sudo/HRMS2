import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /api/management/system-dashboard and /workforce-dashboard returned 502 on prod.
 *
 * system-dashboard ran a six-arm UNION ALL (full scans of attendance_daily_record and
 * kpi_daily_actual among them) serially on one connection, on every request, uncached.
 * It is now six concurrent statements, reassembled in the original order, computed once per
 * window and shared by concurrent callers.
 *
 * workforce-dashboard carried three predicates that wrapped a column in a function
 * (DATE(s.session_date), YEAR(lr.start_date), two whole-table SUM()s over ~209k
 * employee_documents rows); those are now index-friendly with identical results, and the route
 * shares one computation per resolved scope per window.
 */
const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: (...a: unknown[]) => execute(...a) },
}));
vi.mock("../../../shared/schema-object-cache.js", () => ({
  columnExists: vi.fn(async () => false),
  tableExists: vi.fn(async () => false),
  ifObjectExists: vi.fn(
    async (_probe: unknown, _run: unknown, fallback: unknown) => fallback,
  ),
}));

import {
  managementService,
  resetSystemDashboardCacheForTest,
} from "../management.service.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

function answer(sql: string): unknown[] {
  if (/'ATS' AS module_name/.test(sql))
    return [
      [
        {
          module_name: "ATS",
          record_count: 5,
          last_activity: "2026-09-29 10:00:00",
          error_count: 0,
        },
      ],
    ];
  if (/'Payroll' AS module_name/.test(sql))
    return [
      [
        {
          module_name: "Payroll",
          record_count: 2,
          last_activity: null,
          error_count: "1",
        },
      ],
    ];
  if (/'Leave' AS module_name/.test(sql))
    return [
      [
        {
          module_name: "Leave",
          record_count: 3,
          last_activity: null,
          error_count: 0,
        },
      ],
    ];
  if (/'Attendance' AS module_name/.test(sql))
    return [
      [
        {
          module_name: "Attendance",
          record_count: 0,
          last_activity: null,
          error_count: 0,
        },
      ],
    ];
  if (/'Integration Hub' AS module_name/.test(sql))
    return [
      [
        {
          module_name: "Integration Hub",
          record_count: 9,
          last_activity: null,
          error_count: 0,
        },
      ],
    ];
  if (/'KPI' AS module_name/.test(sql))
    return [
      [
        {
          module_name: "KPI",
          record_count: 7,
          last_activity: null,
          error_count: 0,
        },
      ],
    ];
  if (/FROM sensitive_action_log/.test(sql)) return [[]];
  return [[{ total: 4, count: 3, configured: 2, active: 1 }]];
}

describe("managementService.getSystemDashboard", () => {
  beforeEach(() => {
    execute.mockReset();
    resetSystemDashboardCacheForTest();
  });

  it("no longer issues the six-arm UNION and keeps module order and status derivation", async () => {
    execute.mockImplementation(async (sql: string) => answer(sql));
    const out = await managementService.getSystemDashboard();

    const sqls = execute.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /UNION/i.test(s))).toBe(false);
    expect(out.modules.map((m) => m.module)).toEqual([
      "ATS",
      "Payroll",
      "Leave",
      "Attendance",
      "Integration Hub",
      "KPI",
    ]);
    const byName = Object.fromEntries(out.modules.map((m) => [m.module, m]));
    expect(byName.Payroll.status).toBe("degraded"); // error_count 1
    expect(byName.Attendance.status).toBe("degraded"); // zero rows
    expect(byName.ATS.status).toBe("operational");
    expect(out.metrics.systemHealth).toBe("warning");
    expect(out.metrics.usersWithout2fa).toBeNull();
  });

  it("starts the module statements together, then serves repeat and concurrent callers from one computation", async () => {
    const gates: Array<() => void> = [];
    execute.mockImplementation(
      (sql: string) =>
        new Promise((resolve) => {
          gates.push(() => resolve(answer(sql)));
        }),
    );

    const a = managementService.getSystemDashboard();
    const b = managementService.getSystemDashboard();
    await flush();
    const started = execute.mock.calls.length;
    expect(
      execute.mock.calls.filter((c) => /AS module_name/.test(String(c[0]))),
    ).toHaveLength(6);
    gates.forEach((g) => g());
    await Promise.all([a, b]);
    expect(execute).toHaveBeenCalledTimes(started); // b shared a's in-flight work

    await managementService.getSystemDashboard(); // inside the TTL window
    expect(execute).toHaveBeenCalledTimes(started);
  });
});

describe("workforce dashboard predicates", () => {
  const service = readFileSync(
    resolve(__dirname, "../management.service.ts"),
    "utf-8",
  );
  const routes = readFileSync(
    resolve(__dirname, "../management.routes.ts"),
    "utf-8",
  );

  it("compares DATE columns directly instead of wrapping them in DATE()/YEAR()", () => {
    expect(service).not.toMatch(/DATE\(s\.session_date\)\s*=\s*CURDATE\(\)/);
    expect(service).not.toMatch(/YEAR\(lr\.start_date\)/);
    expect(service).toMatch(/s\.session_date = CURDATE\(\)/);
    expect(service).toMatch(
      /lr\.start_date >= MAKEDATE\(YEAR\(CURDATE\(\)\), 1\)/,
    );
    expect(service).toMatch(
      /lr\.start_date < MAKEDATE\(YEAR\(CURDATE\(\)\) \+ 1, 1\)/,
    );
  });

  it("probes expiry with NOT EXISTS and still reports not-tracked as NULL", () => {
    const at = service.indexOf("NOT EXISTS (SELECT 1 FROM employee_documents");
    expect(at).toBeGreaterThan(-1);
    const stmt = service.slice(at, service.indexOf("`", at));
    expect(stmt).toContain("THEN NULL");
    expect(stmt).not.toMatch(/SUM\(/);
  });

  it("shares the workforce dashboard per resolved scope through a TTL cache", () => {
    expect(routes).toMatch(/workforceDashboardCache\.getOrCompute\(/);
    expect(routes).toMatch(/const cacheKey = `workforce:\$\{scope\.level\}/);
  });
});
