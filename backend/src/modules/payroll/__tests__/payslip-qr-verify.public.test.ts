import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The verify endpoint is the target of the QR printed on every payslip. It must
// answer an anonymous request, so the DB is stubbed rather than reached.
const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));

const { payrollPublicRouter, parseMonthYear } = await import("../payroll.public.routes.js");
const { payrollRouter } = await import("../payroll.routes.js");

/** Mirrors app.ts: the public router is mounted ahead of the auth-gated ones. */
function buildApp() {
  const app = express();
  app.use("/api/payroll", payrollPublicRouter);
  app.use("/api/payroll", payrollRouter);
  return app;
}

describe("public payslip QR verification", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("answers an unauthenticated scan instead of 401", async () => {
    // Regression guard. This route used to live on payrollRouter, which calls
    // router.use(requireAuth) before registering anything — so every QR scan got
    // 401 "Missing authorization token" and the page rendered "Payslip Not Found".
    execute.mockResolvedValue([[{
      payslip_ref: "PS-2026-06-0001",
      generated_at: "2026-06-30T10:00:00.000Z",
      run_month: "2026-06",
      employee_name: "Rajesh Sharma",
      employee_code: "MAS47814",
    }]]);

    const res = await request(buildApp())
      .get("/api/payroll/verify/payslip/MAS47814/2026-06");

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.employee_code).toBe("MAS47814");
  });

  it("never leaks salary figures on the public endpoint", async () => {
    execute.mockResolvedValue([[{
      payslip_ref: "PS-2026-06-0001",
      generated_at: "2026-06-30T10:00:00.000Z",
      run_month: "2026-06",
      employee_name: "Rajesh Sharma",
      employee_code: "MAS47814",
    }]]);

    const res = await request(buildApp())
      .get("/api/payroll/verify/payslip/MAS47814/2026-06");

    expect(Object.keys(res.body).sort()).toEqual([
      "employee_code", "employee_name", "generated_at", "payslip_ref", "run_month", "verified",
    ]);
  });

  it("reports an unknown payslip as unverified, not as an error", async () => {
    execute.mockResolvedValue([[]]);

    const res = await request(buildApp())
      .get("/api/payroll/verify/payslip/NOPE/2026-06");

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
  });

  it("still accepts the spelled-out period printed on older payslips", async () => {
    execute.mockResolvedValue([[]]);

    await request(buildApp())
      .get(`/api/payroll/verify/payslip/MAS47814/${encodeURIComponent("June - 2026")}`);

    expect(execute).toHaveBeenCalledWith(expect.any(String), ["MAS47814", "2026-06"]);
  });

  it("leaves the authenticated payroll routes gated", async () => {
    const res = await request(buildApp()).get("/api/payroll/structures");
    expect(res.status).toBe(401);
  });

  describe("parseMonthYear", () => {
    it.each([
      ["June - 2026", "2026-06"],
      ["June-2026", "2026-06"],
      ["June 2026", "2026-06"],
      ["december - 2025", "2025-12"],
      ["2026-06", "2026-06"],
      ["2026-6", "2026-06"],
    ])("parses %s to %s", (input, expected) => {
      expect(parseMonthYear(input)).toBe(expected);
    });

    it.each(["", "Junuary - 2026", "June - 26", "2026-13", "garbage"])(
      "rejects %s", (input) => {
        expect(parseMonthYear(input)).toBe("");
      });
  });
});
