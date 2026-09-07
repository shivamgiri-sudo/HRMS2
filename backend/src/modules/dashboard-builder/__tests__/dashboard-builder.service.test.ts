import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Dashboard Builder.
 *
 * The property that matters most is the one a sharing feature makes easy to get
 * wrong: a dashboard's AUTHOR chooses which process a widget reads, but the
 * VIEWER may not be entitled to it. Rendering therefore resolves against the
 * reader's own scope, never the author's — otherwise "anyone can build a
 * dashboard" quietly becomes "anyone can publish one that leaks a client's
 * numbers to the wrong people".
 *
 * The rest pins the closed sets. An unknown widget_type would be stored by
 * MySQL's ENUM as '' and render as nothing, which reads as a broken dashboard
 * rather than a rejected input.
 */
const { execute, buildScopeWhereClause, fetchProcessMetricValues } = vi.hoisted(() => ({
  execute: vi.fn(),
  buildScopeWhereClause: vi.fn(),
  fetchProcessMetricValues: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/scopeAccess.js", () => ({ buildScopeWhereClause }));
vi.mock("../../process-performance/process-metric-source.js", () => ({ fetchProcessMetricValues }));

const svc = await import("../dashboard-builder.service.js");

const DASHBOARD = {
  id: "d1", name: "GS1 Ops", description: null, process_id: "p-gs1",
  owner_user_id: "u1", visible_roles: "manager,qa", active_status: 1,
};

const widget = (over: Record<string, unknown> = {}) => ({
  id: "w1", dashboard_id: "d1", title: "Email TAT", widget_type: "line",
  metric_source: "process_metric_actual", metric_key: "gs1_email_tat_sec",
  process_id: null, date_range: "this_month", grid_width: 6, grid_height: 1,
  position: 0, config_json: null, active_status: 1, ...over,
});

/** Makes the INFORMATION_SCHEMA probe report the tables as present. */
function installed(rest: (sql: string) => unknown) {
  execute.mockImplementation((sql: string) => {
    if (String(sql).includes("INFORMATION_SCHEMA.TABLES")) {
      return Promise.resolve([[{ n: 2 }], []]);
    }
    return rest(String(sql)) as never;
  });
}

beforeEach(() => {
  execute.mockReset();
  buildScopeWhereClause.mockReset().mockResolvedValue({ sql: "1=1", params: [] });
  fetchProcessMetricValues.mockReset().mockResolvedValue(new Map());
  svc.resetDashboardBuilderCapability();
  // Default: installed, and every other query answers empty. Individual tests
  // override with their own mockImplementation.
  installed(() => Promise.resolve([[], []]));
});

describe("resolveDateRange", () => {
  const on = (s: string) => new Date(`${s}T12:00:00`);

  it("gives the whole of last month, ending on its real last day", () => {
    // March, so February's length is the interesting part — a fixed 30 would be wrong.
    expect(svc.resolveDateRange("last_month", on("2026-03-15")))
      .toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("handles a 31-day previous month", () => {
    expect(svc.resolveDateRange("last_month", on("2026-09-07")))
      .toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("runs this month from the 1st to today", () => {
    expect(svc.resolveDateRange("this_month", on("2026-09-07")))
      .toEqual({ from: "2026-09-01", to: "2026-09-07" });
  });

  it("counts last 7 days inclusive of today", () => {
    expect(svc.resolveDateRange("last_7_days", on("2026-09-07")))
      .toEqual({ from: "2026-09-01", to: "2026-09-07" });
  });

  it("crosses a year boundary", () => {
    expect(svc.resolveDateRange("last_month", on("2026-01-10")))
      .toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });
});

describe("saveWidget rejects anything outside the closed sets", () => {
  const base = {
    userId: "u1", dashboardId: "d1", metricSource: "process_metric_actual",
    metricKey: "m1", widgetType: "line",
  };
  const ownsDashboard = () => installed(() => Promise.resolve([[{ id: "d1" }], []]));

  it("refuses an unknown chart type by name", async () => {
    ownsDashboard();
    await expect(svc.saveWidget({ ...base, widgetType: "pyramid" } as never))
      .rejects.toThrow(/Unknown chart type/i);
  });

  it("refuses an unknown metric source", async () => {
    ownsDashboard();
    await expect(svc.saveWidget({ ...base, metricSource: "somewhere_else" } as never))
      .rejects.toThrow(/Unknown metric source/i);
  });

  it("refuses an unknown date range", async () => {
    ownsDashboard();
    await expect(svc.saveWidget({ ...base, dateRange: "since_forever" } as never))
      .rejects.toThrow(/Unknown date range/i);
  });

  it("refuses a widget with no metric", async () => {
    ownsDashboard();
    await expect(svc.saveWidget({ ...base, metricKey: "   " } as never))
      .rejects.toThrow(/Pick a metric/i);
  });

  it("refuses to edit a dashboard the caller does not own", async () => {
    installed(() => Promise.resolve([[], []]));
    await expect(svc.saveWidget(base as never)).rejects.toThrow(/not yours to edit/i);
  });

  it("clamps an out-of-range width rather than erroring at the user", async () => {
    ownsDashboard();
    await svc.saveWidget({ ...base, gridWidth: 99, gridHeight: 99 } as never);
    const insert = execute.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO builder_dashboard_widget"));
    expect(insert![1]).toContain(12);
    expect(insert![1]).toContain(4);
  });
});

describe("saveDashboard", () => {
  it("refuses a role this system does not know", async () => {
    await expect(
      svc.saveDashboard({ userId: "u1", name: "X", visibleRoles: ["definitely_not_a_role"] }),
    ).rejects.toThrow(/Unknown role/i);
  });

  it("refuses a dashboard with no name", async () => {
    await expect(svc.saveDashboard({ userId: "u1", name: "  " })).rejects.toThrow(/Give the dashboard a name/i);
  });

  it("stores shared roles as a comma list", async () => {
    installed(() => Promise.resolve([{ affectedRows: 1 }, []]));
    await svc.saveDashboard({ userId: "u1", name: "Ops", visibleRoles: ["manager", "qa"] });
    const insert = execute.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO builder_dashboard"));
    expect(insert![1]).toContain("manager,qa");
  });

  it("leaves an unshared dashboard private rather than defaulting it open", async () => {
    installed(() => Promise.resolve([{ affectedRows: 1 }, []]));
    await svc.saveDashboard({ userId: "u1", name: "Private" });
    const insert = execute.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO builder_dashboard"));
    expect(insert![1]).toContain(null);
  });
});

describe("renderDashboard resolves against the READER's scope", () => {
  /** dashboard row, widgets, then the scope query. */
  function mockRender(widgets: Array<Record<string, unknown>>, allowedProcessIds: string[]) {
    installed((text: string) => {
      if (text.includes("FROM builder_dashboard\n") || text.includes("FROM builder_dashboard ")) {
        return Promise.resolve([[DASHBOARD], []]);
      }
      if (text.includes("FROM builder_dashboard_widget")) return Promise.resolve([widgets, []]);
      if (text.includes("FROM process_master")) {
        return Promise.resolve([allowedProcessIds.map((id) => ({ id })), []]);
      }
      return Promise.resolve([[], []]);
    });
  }

  it("refuses a widget aimed at a process the reader cannot see", async () => {
    // The AUTHOR pointed it at p-gs1; this reader is entitled to nothing.
    mockRender([widget()], []);
    const out = await svc.renderDashboard("u2", "manager", "d1");
    expect(out!.widgets[0].availability).toBe("out_of_scope");
    expect(out!.widgets[0].value).toBeNull();
    expect(out!.widgets[0].series).toEqual([]);
    // The metric must never have been fetched at all.
    expect(fetchProcessMetricValues).not.toHaveBeenCalled();
  });

  it("renders a widget the reader IS entitled to", async () => {
    mockRender([widget()], ["p-gs1"]);
    fetchProcessMetricValues.mockResolvedValue(
      new Map([["gs1_email_tat_sec", {
        value: 3200, count: 4, trend: [{ period: "2026-08", value: 3200 }],
      }]]),
    );
    const out = await svc.renderDashboard("u1", "manager", "d1");
    expect(out!.widgets[0].availability).toBe("ok");
    expect(out!.widgets[0].value).toBe(3200);
    expect(out!.widgets[0].series).toHaveLength(1);
  });

  it("says no_data rather than drawing a zero when nothing is supplied", async () => {
    mockRender([widget()], ["p-gs1"]);
    fetchProcessMetricValues.mockResolvedValue(new Map());
    const out = await svc.renderDashboard("u1", "manager", "d1");
    expect(out!.widgets[0].availability).toBe("no_data");
    expect(out!.widgets[0].value).toBeNull();
  });

  it("explains a widget that names no process at all", async () => {
    mockRender([widget({ process_id: null })], ["p-gs1"]);
    // Dashboard-level process is also absent for this one.
    installed((text: string) => {
      if (text.includes("FROM builder_dashboard_widget")) {
        return Promise.resolve([[widget({ process_id: null })], []]);
      }
      if (text.includes("FROM builder_dashboard")) {
        return Promise.resolve([[{ ...DASHBOARD, process_id: null }], []]);
      }
      if (text.includes("FROM process_master")) return Promise.resolve([[{ id: "p-gs1" }], []]);
      return Promise.resolve([[], []]);
    });
    const out = await svc.renderDashboard("u1", "manager", "d1");
    expect(out!.widgets[0].availability).toBe("no_data");
    expect(out!.widgets[0].note).toMatch(/no process/i);
  });

  it("lets a widget override the dashboard's process", async () => {
    mockRender([widget({ process_id: "p-other" })], ["p-other"]);
    fetchProcessMetricValues.mockResolvedValue(
      new Map([["gs1_email_tat_sec", { value: 10, count: 1, trend: [] }]]),
    );
    await svc.renderDashboard("u1", "manager", "d1");
    expect(fetchProcessMetricValues).toHaveBeenCalledWith(
      "p-other", ["gs1_email_tat_sec"], expect.any(String), expect.any(String),
    );
  });

  it("returns null for a dashboard not shared with the reader", async () => {
    installed(() => Promise.resolve([[], []]));
    await expect(svc.renderDashboard("u9", "hr", "d1")).resolves.toBeNull();
  });
});

describe("degrades when migration 1683 has not been applied", () => {
  /** The probe reports the tables as absent. */
  function notInstalled() {
    svc.resetDashboardBuilderCapability();
    execute.mockImplementation((sql: string) => {
      if (String(sql).includes("INFORMATION_SCHEMA.TABLES")) {
        return Promise.resolve([[{ n: 0 }], []]);
      }
      // Anything reaching the real tables would be the bug this guards against.
      return Promise.reject(new Error("Table 'mas_hrms.builder_dashboard' doesn't exist"));
    });
  }

  it("lists nothing instead of 500ing, so the page says 'no dashboards yet'", async () => {
    notInstalled();
    await expect(svc.listDashboards("u1", "manager")).resolves.toEqual([]);
  });

  it("returns null for a single dashboard rather than throwing", async () => {
    notInstalled();
    await expect(svc.getDashboard("u1", "manager", "d1")).resolves.toBeNull();
  });

  it("returns null when rendering rather than throwing", async () => {
    notInstalled();
    await expect(svc.renderDashboard("u1", "manager", "d1")).resolves.toBeNull();
  });

  it("refuses a write with a message naming the migration, not a driver error", async () => {
    notInstalled();
    await expect(svc.saveDashboard({ userId: "u1", name: "X" }))
      .rejects.toThrow(/1683_dashboard_builder\.sql/);
  });

  it("refuses a widget write the same way", async () => {
    notInstalled();
    await expect(
      svc.saveWidget({
        userId: "u1", dashboardId: "d1", widgetType: "line",
        metricSource: "process_metric_actual", metricKey: "m1",
      } as never),
    ).rejects.toThrow(/not installed/i);
  });

  it("never touches the real tables while uninstalled", async () => {
    notInstalled();
    await svc.listDashboards("u1", "manager");
    const touched = execute.mock.calls.filter(([sql]) =>
      String(sql).includes("FROM builder_dashboard"));
    expect(touched).toHaveLength(0);
  });
});
