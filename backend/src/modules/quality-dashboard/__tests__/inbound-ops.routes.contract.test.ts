import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routesSource = readFileSync(
  new URL("../quality-dashboard.routes.ts", import.meta.url),
  "utf8",
);

describe("inbound operations route contract", () => {
  it("mounts the existing inbound summary service on the authenticated quality router", () => {
    expect(routesSource).toContain('from "./inbound-ops.service.js"');
    expect(routesSource).toContain('router.get("/inbound-ops/summary"');
    expect(routesSource).toContain("requireRole(...ALLOWED_ROLES)");
    expect(routesSource).toContain("getInboundSummary(from, to, projectKeys)");
  });
});
