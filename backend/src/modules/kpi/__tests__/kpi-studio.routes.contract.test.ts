import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contract tests for /api/kpi-studio.
 *
 * A KPI definition decides what appears on somebody's appraisal, and a formula decides what their
 * number is. So the guarantees worth pinning here are not "does the JSON shape match" but:
 *
 *  1. WHO can author one. Authoring is a privileged action and the role list must be the real
 *     gate, not a comment. requireRole is deliberately NOT mocked, so these exercise the actual
 *     middleware.
 *  2. That a database missing the Studio schema produces an actionable 503 rather than a 500 —
 *     production applies migrations out of band, so this is a state that will genuinely occur.
 *  3. That a user's mistake comes back as a 400 with a readable message, not a stack trace.
 *  4. That the root-cause endpoint cannot be used to read an employee outside the caller's scope.
 *     It exposes the inputs behind somebody's KPI, so it must be scoped exactly as tightly as the
 *     endpoint that exposes the KPI value itself.
 *
 * The DB is mocked. These are route-level contracts; the arithmetic and the precedence rules are
 * covered without a database in kpi-formula.engine.test.ts and kpi-studio-scope.test.ts.
 */

const { execute, getConnection } = vi.hoisted(() => ({ execute: vi.fn(), getConnection: vi.fn() }));

vi.mock("../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection },
}));

let actor: { id: string; role: string; roles: string[] };

vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return {
    ...original,
    requireAuth: (req: any, _res: any, next: any) => {
      req.authUser = actor;
      next();
    },
  };
});

// The scope helpers reach for auth tables this suite does not stand up. Stubbed so the per-employee
// checks in the explain route can be steered directly.
const employeeForUser = vi.fn();
const processScope = vi.fn();
vi.mock("../../../shared/accessGuard.js", () => ({
  getEmployeeForUser: (...args: unknown[]) => employeeForUser(...args),
  hasProcessScope: (...args: unknown[]) => processScope(...args),
}));

import { kpiStudioRouter } from "../kpi-studio.routes.js";
import { resetStudioCapability } from "../kpi-studio.service.js";

function appFor(role: string) {
  actor = { id: `user-${role}`, role, roles: [role] };
  const app = express();
  app.use(express.json());
  app.use("/api/kpi-studio", kpiStudioRouter);
  return app;
}

/** Makes the capability probe report the Studio schema as present. */
function schemaInstalled() {
  execute.mockImplementation(async (sql: string) => {
    if (sql.includes("INFORMATION_SCHEMA.TABLES")) return [[{ n: 6 }], []];
    if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) return [[{ n: 6 }], []];
    return [[], []];
  });
}

/** Makes the probe report it as absent, which is the pre-migration production state. */
function schemaMissing() {
  execute.mockImplementation(async (sql: string) => {
    if (sql.includes("INFORMATION_SCHEMA.TABLES")) return [[{ n: 0 }], []];
    if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) return [[{ n: 0 }], []];
    return [[], []];
  });
}

beforeEach(() => {
  execute.mockReset();
  getConnection.mockReset();
  employeeForUser.mockReset();
  processScope.mockReset();
  resetStudioCapability();
});

/**
 * `manager` and `process_manager` are SYNONYMS in this system's role policy — expandRoles() maps
 * each to the other, verified directly against src/platform/policy. So granting process_manager
 * necessarily grants manager, and no gate can admit one while refusing the other.
 *
 * That is pre-existing and deliberate (kpi-master.routes.ts already writes kpi_master_config under
 * requireRole('admin','hr','process_manager'), so managers can already set targets), but it is
 * surprising enough to be worth pinning: without a test saying so, a future reader adding
 * 'process_manager' to a gate will believe they have excluded managers.
 *
 * team_leader expands to team_leader + tl, and qa / tq_head / hr / admin expand to themselves only.
 */
describe("who may author a KPI", () => {
  const CONFIG_ROLES = ["admin", "hr", "process_manager", "qa", "tq_head"];
  const DENIED_ROLES = ["employee", "team_leader", "recruiter"];

  it("treats manager and process_manager as the same role", async () => {
    schemaInstalled();
    const asManager = await request(appFor("manager"))
      .post("/api/kpi-studio/metrics")
      .send({ metric_code: "TEST_KPI", metric_name: "Test" });
    // Not a 403: manager expands to process_manager, which CONFIG_ROLES grants. It fails later on
    // the mocked database instead, which is the point — it got past the gate.
    expect(asManager.status).not.toBe(403);
  });

  it("lets every configuring role save a definition", async () => {
    for (const role of CONFIG_ROLES) {
      schemaInstalled();
      resetStudioCapability();
      const response = await request(appFor(role))
        .post("/api/kpi-studio/definitions")
        .send({ metric_id: "metric-1", process_id: "process-1", target_value: 240 });
      // Reaches the handler, which then fails on the mocked metric lookup. What matters here is
      // that it is not a 403.
      expect(response.status).not.toBe(403);
    }
  });

  it("refuses roles that should not be able to author one", async () => {
    for (const role of DENIED_ROLES) {
      schemaInstalled();
      resetStudioCapability();
      const response = await request(appFor(role))
        .post("/api/kpi-studio/definitions")
        .send({ metric_id: "metric-1", process_id: "process-1", target_value: 240 });
      expect(response.status).toBe(403);
    }
  });

  it("lets a team leader read definitions without being able to author one", async () => {
    // A team leader is a legitimate reader — they need to answer "why is my agent measured this
    // way" — but creating a company-wide KPI is not theirs to do. Unlike manager, team_leader does
    // not expand into a configuring role, so this distinction is real.
    schemaInstalled();
    const app = appFor("team_leader");

    expect((await request(app).post("/api/kpi-studio/metrics").send({ metric_code: "X", metric_name: "X" })).status).toBe(403);
    resetStudioCapability();
    expect((await request(app).get("/api/kpi-studio/definitions")).status).toBe(200);
  });

  it("keeps running a real computation narrower than authoring", async () => {
    // A computation rewrites kpi_daily_actual for everyone in scope, which changes real people's
    // scores — so qa and tq_head may define a KPI but not run the job.
    schemaInstalled();
    for (const role of ["qa", "tq_head", "team_leader", "employee"]) {
      resetStudioCapability();
      schemaInstalled();
      const response = await request(appFor(role)).post("/api/kpi-studio/compute").send({ date: "2026-08-01" });
      expect(response.status).toBe(403);
    }
    for (const role of ["admin", "hr", "process_manager"]) {
      resetStudioCapability();
      schemaInstalled();
      const response = await request(appFor(role)).post("/api/kpi-studio/compute").send({ date: "2026-08-01" });
      expect(response.status).not.toBe(403);
    }
  });

  it("lets super_admin through without being listed", async () => {
    schemaInstalled();
    const response = await request(appFor("super_admin")).get("/api/kpi-studio/definitions");
    expect(response.status).toBe(200);
  });

  it("rejects an unauthenticated caller", async () => {
    schemaInstalled();
    actor = undefined as unknown as typeof actor;
    const app = express();
    app.use(express.json());
    app.use("/api/kpi-studio", kpiStudioRouter);
    const response = await request(app).get("/api/kpi-studio/definitions");
    expect(response.status).toBe(401);
  });
});

describe("a database without the Studio schema", () => {
  it("reports capability instead of failing", async () => {
    schemaMissing();
    const response = await request(appFor("admin")).get("/api/kpi-studio/capability");
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ tables: false, resolution: false });
  });

  it("answers a write with an actionable 503 naming the migrations", async () => {
    // Not a 500. Production runs SKIP_MIGRATIONS=true, so this is an operational state with a
    // specific fix, and the response has to say what the fix is.
    schemaMissing();
    const response = await request(appFor("admin"))
      .post("/api/kpi-studio/data-sources")
      .send({ source_code: "TEST", source_name: "Test", source_type: "local_query" });
    expect(response.status).toBe(503);
    expect(response.body.message).toContain("1644_kpi_studio_foundation.sql");
    expect(response.body.studio_installed).toBe(false);
  });

  it("returns an empty list rather than an error for a read", async () => {
    // A read degrading to "nothing configured" keeps the page usable; the banner explains why.
    schemaMissing();
    const response = await request(appFor("admin")).get("/api/kpi-studio/definitions");
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it("still reports both halves separately when only the tables exist", async () => {
    // Definitions can be authored and tested but cannot drive live scores until 1645 lands. That is
    // a reasonable state to deploy into and worth surfacing rather than flattening to one boolean.
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("INFORMATION_SCHEMA.TABLES")) return [[{ n: 6 }], []];
      if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) return [[{ n: 0 }], []];
      return [[], []];
    });
    const response = await request(appFor("admin")).get("/api/kpi-studio/capability");
    expect(response.body.data).toEqual({ tables: true, resolution: false });
  });
});

describe("formula validation endpoint", () => {
  beforeEach(schemaInstalled);

  it("accepts a valid formula and names the fields it reads", async () => {
    const response = await request(appFor("employee"))
      .post("/api/kpi-studio/validate-formula")
      .send({ formula: "SAFE_DIV(talk_seconds, calls)" });
    expect(response.status).toBe(200);
    expect(response.body.data.ok).toBe(true);
    expect(response.body.data.variables).toEqual(["talk_seconds", "calls"]);
  });

  it("rejects a malformed formula with a readable reason", async () => {
    const response = await request(appFor("employee"))
      .post("/api/kpi-studio/validate-formula")
      .send({ formula: "talk_seconds / (calls" });
    expect(response.body.data.ok).toBe(false);
    expect(response.body.data.error).toContain("closing bracket");
  });

  it("does not execute an injection attempt", async () => {
    const response = await request(appFor("employee"))
      .post("/api/kpi-studio/validate-formula")
      .send({ formula: "constructor.constructor('return process')()" });
    expect(response.status).toBe(200);
    expect(response.body.data.ok).toBe(false);
  });

  it("is readable without a configuring role", async () => {
    // A team leader reading a definition benefits from the same explanation of why it is valid.
    const response = await request(appFor("team_leader"))
      .post("/api/kpi-studio/validate-formula")
      .send({ formula: "calls * 2" });
    expect(response.status).toBe(200);
  });
});

describe("a user's mistake is a 400, not a 500", () => {
  beforeEach(schemaInstalled);

  it("names the missing pieces when previewing without them", async () => {
    const response = await request(appFor("admin")).post("/api/kpi-studio/preview").send({ formula: "calls" });
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/formula, a data source and an employee/i);
  });

  it("rejects an unusable source type by name", async () => {
    const response = await request(appFor("admin"))
      .post("/api/kpi-studio/data-sources")
      .send({ source_code: "TEST", source_name: "Test", source_type: "carrier_pigeon" });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain("local_query");
  });

  it("refuses a connector source with no integration key", async () => {
    const response = await request(appFor("admin"))
      .post("/api/kpi-studio/data-sources")
      .send({ source_code: "EXT", source_name: "External", source_type: "integration_connector" });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain("integration key");
  });

  it("refuses a field name that could not be used in a formula", async () => {
    const response = await request(appFor("admin"))
      .post("/api/kpi-studio/data-sources/src-1/fields")
      .send({ field_name: "talk time (sec)" });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain("formula");
  });

  it("refuses a manual value that is not a number", async () => {
    const response = await request(appFor("admin"))
      .post("/api/kpi-studio/manual-value")
      .send({ employee_id: "emp-1", field_name: "audited_calls", value_date: "2026-08-01", value: "many" });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain("must be a number");
  });

  it("refuses an upload with no file", async () => {
    const response = await request(appFor("admin")).post("/api/kpi-studio/upload/preview").send({});
    expect(response.status).toBe(400);
    expect(response.body.message).toContain("No file");
  });
});

describe("root-cause endpoint scope", () => {
  beforeEach(() => {
    schemaInstalled();
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("INFORMATION_SCHEMA.TABLES")) return [[{ n: 6 }], []];
      if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) return [[{ n: 6 }], []];
      // Reporting tree: nobody reports to this viewer.
      if (sql.includes("reporting_tree")) return [[], []];
      if (sql.includes("FROM kpi_metric_master")) return [[{ metric_code: "AHT", metric_name: "Handle time" }], []];
      if (sql.includes("kpi_studio_computation_log")) return [[], []];
      if (sql.includes("process_id, branch_id FROM employees")) return [[{ process_id: "p1", branch_id: "b1" }], []];
      return [[], []];
    });
  });

  it("lets an employee read their own explanation", async () => {
    employeeForUser.mockResolvedValue({ id: "emp-self", employee_code: "MAS1" });
    const response = await request(appFor("employee")).get("/api/kpi-studio/explain/emp-self/metric-1");
    expect(response.status).toBe(200);
  });

  it("refuses an employee reading somebody else's", async () => {
    // This endpoint exposes the raw inputs behind a KPI, so it must be scoped at least as tightly
    // as the endpoint exposing the value.
    employeeForUser.mockResolvedValue({ id: "emp-self", employee_code: "MAS1" });
    const response = await request(appFor("employee")).get("/api/kpi-studio/explain/emp-other/metric-1");
    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/outside your reporting or assigned scope/i);
  });

  it("refuses a manager reading somebody outside their reporting tree", async () => {
    employeeForUser.mockResolvedValue({ id: "mgr-1", employee_code: "MAS2" });
    const response = await request(appFor("manager")).get("/api/kpi-studio/explain/emp-elsewhere/metric-1");
    expect(response.status).toBe(403);
  });

  it("lets a manager read somebody inside their reporting tree", async () => {
    employeeForUser.mockResolvedValue({ id: "mgr-1", employee_code: "MAS2" });
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("INFORMATION_SCHEMA.TABLES")) return [[{ n: 6 }], []];
      if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) return [[{ n: 6 }], []];
      if (sql.includes("reporting_tree")) return [[{ id: "emp-report" }], []];
      if (sql.includes("FROM kpi_metric_master")) return [[{ metric_code: "AHT", metric_name: "Handle time" }], []];
      if (sql.includes("kpi_studio_computation_log")) return [[], []];
      return [[], []];
    });
    const response = await request(appFor("manager")).get("/api/kpi-studio/explain/emp-report/metric-1");
    expect(response.status).toBe(200);
  });

  it("lets hr read anyone", async () => {
    employeeForUser.mockResolvedValue({ id: "hr-1", employee_code: "MAS3" });
    const response = await request(appFor("hr")).get("/api/kpi-studio/explain/emp-anyone/metric-1");
    expect(response.status).toBe(200);
  });

  it("defers to process scope for qa rather than granting outright", async () => {
    employeeForUser.mockResolvedValue({ id: "qa-1", employee_code: "MAS4" });
    processScope.mockResolvedValue(false);
    expect((await request(appFor("qa")).get("/api/kpi-studio/explain/emp-x/metric-1")).status).toBe(403);

    processScope.mockResolvedValue(true);
    resetStudioCapability();
    expect((await request(appFor("qa")).get("/api/kpi-studio/explain/emp-x/metric-1")).status).toBe(200);
  });

  it("says so plainly when a KPI has no calculation history", async () => {
    // A KPI fed by an existing sync has no Studio working to show. That is not an error, and it must
    // not read as one — otherwise every pre-existing metric looks broken.
    employeeForUser.mockResolvedValue({ id: "emp-self", employee_code: "MAS1" });
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("INFORMATION_SCHEMA.TABLES")) return [[{ n: 6 }], []];
      if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) return [[{ n: 6 }], []];
      if (sql.includes("FROM kpi_metric_master")) return [[], []];
      return [[], []];
    });
    const response = await request(appFor("employee")).get("/api/kpi-studio/explain/emp-self/metric-unknown");
    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.message).toMatch(/existing sync/i);
  });
});

describe("read endpoints available to viewing roles", () => {
  beforeEach(schemaInstalled);

  it("exposes the function catalogue to any authenticated user", async () => {
    const response = await request(appFor("employee")).get("/api/kpi-studio/formula-help");
    expect(response.status).toBe(200);
    expect(response.body.data.functions.map((fn: { name: string }) => fn.name)).toContain("SAFE_DIV");
    expect(response.body.data.aggregations).toContain("average");
  });

  it("gates the scope pickers to viewing roles", async () => {
    expect((await request(appFor("team_leader")).get("/api/kpi-studio/scope-options")).status).toBe(200);
    resetStudioCapability();
    expect((await request(appFor("employee")).get("/api/kpi-studio/scope-options")).status).toBe(403);
  });

  it("requires a search term or filter before listing employees", async () => {
    // Guards against an accidental full-directory dump through the picker.
    const response = await request(appFor("admin")).get("/api/kpi-studio/employees");
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });
});
