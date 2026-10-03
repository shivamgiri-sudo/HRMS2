import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** The payout is commercially sensitive: manager and above, and not reachable through the dashboard's TPZ process-access prefix. */
const routes = readFileSync(resolve(__dirname, "../sbi-card-dashboard.routes.ts"), "utf8");
const catalog = readFileSync(resolve(__dirname, "../../tpz-access/tpz-access.catalog.ts"), "utf8");

describe("payout access", () => {
  const roles = (/const PAYOUT_ROLES = \[([^\]]*)\]/.exec(routes)?.[1] ?? "").split(",").map((r) => r.replace(/["'\s]/g, "")).filter(Boolean);
  it("is limited to manager level and above", () => {
    expect(roles).toEqual(expect.arrayContaining(["admin", "ceo", "coo", "manager"]));
    for (const lower of ["qa", "quality_analyst", "tq_head", "agent", "hr", "tl", "team_leader"]) expect(roles).not.toContain(lower);
  });
  it("is a separate route behind requireRole(PAYOUT_ROLES)", () => {
    expect(routes).toMatch(/router\.get\("\/sbi-card-payout", requireRole\(\.\.\.PAYOUT_ROLES\)/);
  });
  it("is not under the /sbi-card-dashboard prefix a TPZ grant opens", () => {
    expect(catalog).toMatch(/perfPrefixes: \["\/sbi-card-dashboard"\]/);
    expect("/sbi-card-payout".startsWith("/sbi-card-dashboard")).toBe(false);
  });
});
