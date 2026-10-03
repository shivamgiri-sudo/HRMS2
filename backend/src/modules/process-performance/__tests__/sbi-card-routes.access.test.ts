import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** The readiness board and the ad-hoc lists sit under /sbi-card-dashboard (viewer roles, covered by a TPZ grant); the lists are CSV downloads of account numbers. */
const routes = readFileSync(resolve(__dirname, "../sbi-card-dashboard.routes.ts"), "utf8");
/** Source with comments removed, so a comment saying "never a phone number" is not mistaken for code that uses one. */
const code = (file: string): string => readFileSync(resolve(__dirname, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const adhoc = code("../sbi-card-adhoc.calc.ts");
const rows = code("../sbi-card-account-rows.ts");

describe("readiness and ad-hoc routes", () => {
  it("are behind the dashboard's viewer roles", () => {
    expect(routes).toMatch(/router\.get\("\/sbi-card-dashboard\/readiness", requireRole\(\.\.\.VIEWER_ROLES\)/);
    expect(routes).toMatch(/router\.get\("\/sbi-card-dashboard\/adhoc-list", requireRole\(\.\.\.VIEWER_ROLES\)/);
  });
  it("has the movement comparison behind the same viewer roles", () => {
    expect(routes).toMatch(/router\.get\("\/sbi-card-dashboard\/movement", requireRole\(\.\.\.VIEWER_ROLES\)/);
  });
  it("reject an unknown list type and send the list as a CSV attachment", () => {
    expect(routes).toMatch(/isAdhocType\(type\)\)[\s\S]{0,80}status\(400\)/);
    expect(routes).toContain('"text/csv; charset=utf-8"');
    expect(routes).toMatch(/Content-Disposition", `attachment; filename=/);
  });
});

describe("no phone numbers can leave through a call list", () => {
  it("the list builder never reads a phone field and the account query never selects one", () => {
    expect(adhoc).not.toMatch(/mobile|phone/i);
    expect(rows).not.toMatch(/mobile_no|phone/i);
  });
  it("always excludes do-not-call, deceased, dispute and welfare accounts", () => {
    expect(adhoc).toMatch(/NEVER_CALL = \["DS", "SUTH", "DISP"\]/);
    expect(adhoc).toMatch(/if \(e\.dnc \|\| cs\.some/);
  });
});
