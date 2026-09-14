/**
 * lms-mysql.ts used to default LMS_DB_HOST/USER/PASSWORD/NAME to literal values
 * committed to source — including a plaintext password — and that pool is live in
 * production (imported by the mounted lms-integration router and management.service.ts).
 * Source-text inspection, matching the repo's existing contract-test style: the goal
 * is to catch the literal fallback coming back, not to open a real connection.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/db/lms-mysql.ts"), "utf8");

describe("lms-mysql.ts has no hardcoded fallback credentials", () => {
  it("does not contain the leaked literal password", () => {
    expect(source).not.toContain("qwersdfg");
  });

  it("does not fall back host/user/password/database to a literal via ??", () => {
    expect(source).not.toMatch(/LMS_DB_HOST\s*\?\?\s*["']/);
    expect(source).not.toMatch(/LMS_DB_USER\s*\?\?\s*["']/);
    expect(source).not.toMatch(/LMS_DB_PASSWORD\s*\?\?\s*["']/);
    expect(source).not.toMatch(/LMS_DB_NAME\s*\?\?\s*["']/);
  });

  it("getLmsPool throws when a required var is missing, rather than silently connecting", () => {
    const fnMatch = source.match(/function getLmsPool\(\)[\s\S]*?\n\}/);
    expect(fnMatch, "getLmsPool function body not found").toBeTruthy();
    expect(fnMatch![0]).toMatch(/if\s*\(!LMS_HOST\s*\|\|\s*!LMS_USER\s*\|\|\s*!LMS_PASSWORD\s*\|\|\s*!LMS_DATABASE\)/);
    expect(fnMatch![0]).toMatch(/throw new Error/);
  });
});
