/**
 * Integration-pass tests for the D-1 Daily Manager Briefing Engine.
 *
 * These exercise the REAL buildManagerDailyBrief() wiring (daily-brief-aggregator.service.ts)
 * against the real role-modules matrix, dedup engine, and domain modules — only the DB layer
 * (db/mysql.js, db/sourceDb.js) and hasRole are mocked, per this codebase's existing test
 * convention (see daily-brief-aggregator.service.test.ts). Do NOT trust the unit tests already
 * written per-module in isolation — these tests are specifically about what happens when the
 * modules are wired together.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Handlebars from "handlebars";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

const { querySource } = vi.hoisted(() => ({ querySource: vi.fn(async () => []) }));
vi.mock("../../../../db/sourceDb.js", () => ({ querySource }));

const { hasRole } = vi.hoisted(() => ({ hasRole: vi.fn(async () => false) }));
vi.mock("../../../../shared/accessGuard.js", () => ({ hasRole }));

import { buildManagerDailyBrief } from "../daily-brief-aggregator.service.js";
import { buildTemplateContext } from "../daily-brief-dispatch.service.js";
import type { RecipientInfo } from "../daily-brief.types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.join(__dirname, "..", "..", "..", "communication", "templates", "management");

function baseRecipient(overrides: Partial<RecipientInfo> = {}): RecipientInfo {
  return {
    employeeId: "emp-mgr-1",
    userId: "user-mgr-1",
    fullName: "Test Manager",
    role: "team_leader",
    allRoles: ["team_leader"],
    scopeLabel: "Your direct/indirect reports",
    teamEmployeeIds: [],
    email: "mgr@masindia.com",
    ...overrides,
  };
}

/** Default execute() implementation matching every MVP + module query pattern with
 * empty-but-valid rows, so a test that doesn't care about a particular module's data
 * doesn't need to hand-mock every table this pipeline touches. */
function defaultExecuteImpl(sql: string): unknown {
  if (sql.includes("FROM attendance_daily_record")) {
    return [[{ total: 0, expected_to_work: 0, present: 0, attended_days: 0, half_day: 0, absent: 0, missing_punch: 0, late_count: 0 }]];
  }
  if (sql.includes("FROM attendance_reconciliation_issue")) return [[]];
  if (sql.includes("FROM work_item")) return [[]];
  if (sql.includes("FROM business_action_queue")) return [[{ open_count: 0 }]];
  if (sql.includes("FROM performance_alert")) return [[]];
  if (sql.includes("FROM kpi_daily_actual")) return [[]];
  if (sql.includes("FROM coaching_session")) return [[]];
  if (sql.includes("FROM training_need")) return [[]];
  if (sql.includes("FROM employees")) return [[]];
  return [[]];
}

describe("daily-brief integration: multi-role merge", () => {
  beforeEach(() => {
    execute.mockReset().mockImplementation(async (sql: string) => defaultExecuteImpl(sql));
    querySource.mockReset().mockResolvedValue([]);
    hasRole.mockReset().mockResolvedValue(false);
  });

  it("a recipient holding two roles gets ONE merged brief with the union of applicable modules, not two", async () => {
    // team_leader alone -> quality: "summary". qa alone -> quality: "diagnostic".
    // A correctly-merged multi-role recipient must get the richer ("diagnostic") level —
    // proof the matrix actually unioned both roles' configs into a single resolution,
    // not just used the primary role.
    const recipient = baseRecipient({ role: "team_leader", allRoles: ["team_leader", "qa"] });

    const brief = await buildManagerDailyBrief(recipient, "2026-08-18", "18 Aug 2026, 9:00 AM IST");

    // Exactly one payload object — buildManagerDailyBrief's return type is a single
    // ManagerDailyBrief, not an array, so "not duplicated" is structural; the real
    // assertion is that the merge actually happened (qa's richer level won).
    expect(brief.modules?.quality?.detailLevel).toBe("diagnostic");
    // team_leader-only modules (people risk, exit) must still be present in the merge.
    expect(brief.sourceHealth.some((h) => h.module === "people_risk")).toBe(true);
    expect(brief.sourceHealth.some((h) => h.module === "exit_resignations")).toBe(true);
  });

  it("a role with no matrix entry (or a role that maps to nothing) still gets the MVP-only payload without throwing", async () => {
    const recipient = baseRecipient({ role: "branch_head", allRoles: ["branch_head"] });
    const brief = await buildManagerDailyBrief(recipient, "2026-08-18", "18 Aug 2026, 9:00 AM IST");
    expect(brief.attendance).toBeDefined();
    expect(brief.modules?.kpi).toBeDefined(); // branch_head IS configured for kpi
  });
});

describe("daily-brief integration: payroll security gate (spec §22)", () => {
  beforeEach(() => {
    execute.mockReset().mockImplementation(async (sql: string) => defaultExecuteImpl(sql));
    querySource.mockReset().mockResolvedValue([]);
  });

  const FORBIDDEN_FIELD_NAMES = [
    "salary_prep_run",
    "runMonth",
    "blockerCount",
    "warningCount",
    "financeApproved",
    "ceoAcknowledged",
    "attendanceSnapshotLocked",
    "branchReadinessGaps",
    "categoryStatuses",
  ];

  it("a non-payroll-role recipient's ENTIRE serialized payload never contains payroll-run-detail field names", async () => {
    hasRole.mockResolvedValue(false); // team_leader is not PAYROLL_ROLES-entitled

    const recipient = baseRecipient({ role: "team_leader", allRoles: ["team_leader"] });
    const brief = await buildManagerDailyBrief(recipient, "2026-08-18", "18 Aug 2026, 9:00 AM IST");

    expect(brief.modules?.payrollReadinessDetail).toBeUndefined();

    const serialized = JSON.stringify(brief);
    for (const forbidden of FORBIDDEN_FIELD_NAMES) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
    // The safe operational hint path must have been used instead.
    expect(brief.modules).toHaveProperty("payrollOperationalHint");
  });

  it("a multi-role recipient whose UNION includes payroll:'readiness' from an entitled role, but whose actual account is NOT PAYROLL_ROLES-entitled, still never receives run-detail data", async () => {
    hasRole.mockResolvedValue(false); // the account itself is not payroll-entitled, regardless of matrix intent
    const recipient = baseRecipient({ role: "team_leader", allRoles: ["team_leader", "payroll_head"] });
    const brief = await buildManagerDailyBrief(recipient, "2026-08-18", "18 Aug 2026, 9:00 AM IST");

    expect(brief.modules?.payrollReadinessDetail).toBeUndefined();
    const serialized = JSON.stringify(brief);
    for (const forbidden of FORBIDDEN_FIELD_NAMES) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
  });
});

describe("daily-brief integration: one module crashing never takes down the whole brief", () => {
  beforeEach(() => {
    execute.mockReset().mockImplementation(async (sql: string) => defaultExecuteImpl(sql));
    querySource.mockReset().mockResolvedValue([]);
    hasRole.mockReset().mockResolvedValue(false);
    vi.resetModules();
  });

  it("kpi module throwing synchronously still leaves the rest of the payload populated, with kpi_performance = ERROR", async () => {
    vi.doMock("../daily-brief-kpi.module.js", () => ({
      buildKpiPerformanceModule: vi.fn(async () => {
        throw new Error("simulated kpi module crash");
      }),
    }));

    const { buildManagerDailyBrief: buildWithMockedKpi } = await import("../daily-brief-aggregator.service.js");
    const recipient = baseRecipient({ role: "team_leader", allRoles: ["team_leader"] });

    const brief = await buildWithMockedKpi(recipient, "2026-08-18", "18 Aug 2026, 9:00 AM IST");

    const kpiHealth = brief.sourceHealth.find((h) => h.module === "kpi_performance");
    expect(kpiHealth?.state).toBe("ERROR");
    expect(kpiHealth?.detail).toContain("simulated kpi module crash");

    // Everything else must still be populated normally.
    expect(brief.attendance).toBeDefined();
    expect(brief.hygieneIssues).toEqual([]);
    expect(brief.sourceHealth.some((h) => h.module === "attendance")).toBe(true);
    expect(brief.sourceHealth.some((h) => h.module === "people_risk")).toBe(true);

    vi.doUnmock("../daily-brief-kpi.module.js");
  });
});

describe("daily-brief integration: dedup collapses a same-employee duplicate in the real pipeline", () => {
  beforeEach(() => {
    execute.mockReset();
    querySource.mockReset().mockResolvedValue([]);
    hasRole.mockReset().mockResolvedValue(false);
  });

  it("two performance-alert rows for the same employee that alias to the same issue key collapse into one attention signal", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM performance_alert")) {
        return [[
          {
            id: "alert-critical", employee_id: "e1", employee_code: "E001", full_name: "A. Kumar",
            alert_type: "attendance_exception", severity: "critical", message: "Critical attendance exception", created_at: "2026-08-18T09:00:00Z",
          },
          {
            id: "alert-high", employee_id: "e1", employee_code: "E001", full_name: "A. Kumar",
            alert_type: "missing_punch", severity: "high", message: "Missing punch flagged", created_at: "2026-08-18T08:00:00Z",
          },
        ]];
      }
      return defaultExecuteImpl(sql);
    });

    const recipient = baseRecipient({ role: "team_leader", allRoles: ["team_leader"], teamEmployeeIds: ["e1"] });
    const brief = await buildManagerDailyBrief(recipient, "2026-08-18", "18 Aug 2026, 9:00 AM IST");

    const kpiAttention = (brief.attention ?? []).filter((s) => s.source === "kpi_performance");
    expect(kpiAttention).toHaveLength(1); // two same-employee, alias-colliding signals merged into one
    expect(kpiAttention[0].priority).toBe("critical"); // the more severe of the two survives
  });
});

describe("daily-brief integration: display caps with overflow text (spec §48)", () => {
  beforeEach(() => {
    execute.mockReset();
    querySource.mockReset().mockResolvedValue([]);
    hasRole.mockReset().mockResolvedValue(false);
  });

  it("caps hygieneTop5 at 5 items and reports the overflow count", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM attendance_reconciliation_issue") && sql.includes("SELECT id")) {
        return [[
          { id: "1", employee_code: "E1", issue_type: "missing_punch", severity: "blocker", issue_date: "2026-08-18" },
          { id: "2", employee_code: "E2", issue_type: "missing_punch", severity: "blocker", issue_date: "2026-08-18" },
          { id: "3", employee_code: "E3", issue_type: "missing_punch", severity: "warning", issue_date: "2026-08-18" },
          { id: "4", employee_code: "E4", issue_type: "missing_punch", severity: "warning", issue_date: "2026-08-18" },
          { id: "5", employee_code: "E5", issue_type: "missing_punch", severity: "warning", issue_date: "2026-08-18" },
          { id: "6", employee_code: "E6", issue_type: "missing_punch", severity: "warning", issue_date: "2026-08-18" },
          { id: "7", employee_code: "E7", issue_type: "missing_punch", severity: "warning", issue_date: "2026-08-18" },
        ]];
      }
      return defaultExecuteImpl(sql);
    });

    const recipient = baseRecipient({ role: "team_leader", allRoles: ["team_leader"], teamEmployeeIds: ["e1", "e2", "e3", "e4", "e5", "e6", "e7"] });
    const brief = await buildManagerDailyBrief(recipient, "2026-08-18", "18 Aug 2026, 9:00 AM IST");

    expect(brief.hygieneTop5?.items).toHaveLength(5);
    expect(brief.hygieneTop5?.totalCount).toBe(7);
    expect(brief.hygieneTop5?.overflowText).toBe("+2 more — View in HRMS");
  });

  it("reports no overflow text when the list is already within the cap", async () => {
    execute.mockImplementation(async (sql: string) => defaultExecuteImpl(sql));
    const recipient = baseRecipient({ role: "team_leader", allRoles: ["team_leader"] });
    const brief = await buildManagerDailyBrief(recipient, "2026-08-18", "18 Aug 2026, 9:00 AM IST");
    expect(brief.hygieneTop5?.overflowText).toBeNull();
  });
});

describe("daily-brief integration: templates render for 4 role/module combinations without throwing, and escape a poisoned employee name", () => {
  const htmlSource = fs.readFileSync(path.join(TEMPLATE_DIR, "daily-brief.hbs"), "utf-8");
  const textSource = fs.readFileSync(path.join(TEMPLATE_DIR, "daily-brief.txt.hbs"), "utf-8");
  const htmlTemplate = Handlebars.compile(htmlSource);
  const textTemplate = Handlebars.compile(textSource);

  beforeEach(() => {
    execute.mockReset();
    querySource.mockReset().mockResolvedValue([]);
    hasRole.mockReset();
  });

  const POISONED_NAME = '<img src=x onerror=alert(1)>Priya';

  const roleCombos: Array<{ role: string; allRoles: string[] }> = [
    { role: "team_leader", allRoles: ["team_leader"] },
    { role: "branch_head", allRoles: ["branch_head"] },
    { role: "qa", allRoles: ["qa"] },
    { role: "payroll_head", allRoles: ["payroll_head"] },
  ];

  for (const combo of roleCombos) {
    it(`renders for role=${combo.role} without throwing and with no un-escaped <script/HTML from a poisoned employee name`, async () => {
      hasRole.mockResolvedValue(combo.role === "payroll_head"); // only the payroll role is entitled
      execute.mockImplementation(async (sql: string) => {
        if (sql.includes("FROM attendance_reconciliation_issue") && sql.includes("SELECT id")) {
          return [[{ id: "1", employee_code: POISONED_NAME, issue_type: "missing_punch", severity: "blocker", issue_date: "2026-08-18" }]];
        }
        return defaultExecuteImpl(sql);
      });

      const recipient = baseRecipient({
        role: combo.role,
        allRoles: combo.allRoles,
        teamEmployeeIds: ["e1"],
        fullName: POISONED_NAME,
      });
      const brief = await buildManagerDailyBrief(recipient, "2026-08-18", "18 Aug 2026, 9:00 AM IST");
      const context = buildTemplateContext(brief);

      let html = "";
      let text = "";
      expect(() => { html = htmlTemplate(context); }).not.toThrow();
      expect(() => { text = textTemplate(context); }).not.toThrow();

      // Handlebars' default {{}} escaping applies the SAME HTML-entity escaping to both
      // templates (it has no separate "plaintext" mode) — the .txt.hbs template inherits
      // it too, which is exactly the "zero un-escaped raw-HTML uses" requirement: neither
      // rendered output ever contains the poisoned name's literal, executable markup.
      expect(html).not.toContain("<img src=x onerror=alert(1)>");
      expect(text).not.toContain("<img src=x onerror=alert(1)>");
      // Handlebars' default escaping also entity-encodes "=" (&#x3D;) — assert on the
      // unambiguous, unexecutable escaped form rather than a literal "=" match.
      expect(html).toContain("&lt;img src&#x3D;x onerror&#x3D;alert(1)&gt;");
      expect(text).toContain("&lt;img src&#x3D;x onerror&#x3D;alert(1)&gt;");
    });
  }
});
