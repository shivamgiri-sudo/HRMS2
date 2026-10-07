import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const audit = vi.hoisted(() => vi.fn(async (_e?: unknown) => undefined));
vi.mock("../src/shared/auditLog.js", async (orig) => ({
  ...(await orig<object>()),
  writeAuditLog: audit,
}));
vi.mock("../src/middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.authUser = { id: "u1" };
    next();
  },
}));
vi.mock("../src/middleware/requireRole.js", () => ({
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../src/shared/roleResolver.js", async (orig) => ({
  ...(await orig<object>()),
  getUserRoleContext: async () => ({
    primaryRole: "super_admin",
    roles: ["super_admin"],
  }),
}));
vi.mock("../src/shared/dashboardScope.js", async (orig) => ({
  ...(await orig<object>()),
  resolveDashboardScope: async () => ({
    level: "ORG_ALL",
    branchIds: [],
    processIds: [],
    employeeIds: [],
    userId: "u",
    role: "super_admin",
  }),
  narrowDashboardScope: async (s: unknown) => s,
}));
vi.mock("../src/modules/operations/ops-command.context.js", async (orig) => ({
  ...(await orig<object>()),
  resolvePeriod: async () => ({
    from: "2026-09-01",
    to: "2026-09-29",
    attThrough: "2026-09-29",
    today: "2026-09-30",
  }),
}));
vi.mock("../src/modules/operations/ops-command.service.js", async (orig) => ({
  ...(await orig<object>()),
  computeGroups: async () => ({
    total: 2,
    externalQualityAvailable: true,
    rows: [
      {
        id: "b1",
        name: '=HYPERLINK("http://x")',
        sub: "code, with comma",
        m: { hc_closing: 10, mandate_gap: -3 },
      },
      {
        id: "b2",
        name: "Plain",
        sub: null,
        m: { hc_closing: 5, mandate_gap: null },
      },
    ],
  }),
}));

import router from "../src/modules/operations/ops-command.routes.js";

const app = express().use("/api/operations-command", router);

describe("Operations Command CSV export", () => {
  beforeEach(() => audit.mockClear());

  it("neutralises formula injection, keeps numbers numeric, audits the export", async () => {
    const res = await request(app).get(
      "/api/operations-command/export?groupBy=branch&columns=hc_closing,mandate_gap,not_a_metric",
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain(
      "operations-branch-2026-09-01_2026-09-29.csv",
    );
    const lines = res.text.replace("﻿", "").split("\r\n");
    expect(lines[0]).toBe("branch,Detail,Headcount,Gap to mandate");
    expect(lines[1]).toBe(
      `"'=HYPERLINK(""http://x"")","code, with comma",10,-3`,
    ); // formula neutralised, minus stays numeric
    expect(lines[2]).toBe("Plain,,5,");
    expect(audit).toHaveBeenCalledTimes(1);
    const entry = audit.mock.calls[0][0] as {
      action_type: string;
      metadata: { columns: string[]; rows: number };
    };
    expect(entry.action_type).toBe("operations_command_export");
    expect(entry.metadata.columns).toEqual(["hc_closing", "mandate_gap"]); // unknown metric dropped
    expect(entry.metadata.rows).toBe(2);
  });

  it("requires at least one valid column", async () => {
    const res = await request(app).get(
      "/api/operations-command/export?columns=nope",
    );
    expect(res.status).toBe(400);
    expect(audit).not.toHaveBeenCalled();
  });
});
