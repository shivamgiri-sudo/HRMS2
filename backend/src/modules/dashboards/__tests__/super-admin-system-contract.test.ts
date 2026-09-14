import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routes = readFileSync(resolve(process.cwd(), "src/modules/management/management.routes.ts"), "utf8");
const service = readFileSync(resolve(process.cwd(), "src/modules/management/management.service.ts"), "utf8");

describe("super admin system dashboard contract", () => {
  it("explicitly permits super admin without granting business admins implicit access", () => {
    expect(routes).toContain(
      'router.get("/system-dashboard", requireRole("admin", "super_admin")',
    );
  });

  it("provides a system-health freshness timestamp", () => {
    expect(service).toContain("generatedAt: new Date().toISOString()");
  });
});
