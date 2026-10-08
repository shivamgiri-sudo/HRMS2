import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("AI insights compatibility route", () => {
  const routeSource = readFileSync(
    resolve(process.cwd(), "src/modules/ai/ai-insights.routes.ts"),
    "utf8",
  );

  it("keeps the authenticated dashboard insight endpoint available", () => {
    expect(routeSource).toContain("aiInsightsRouter.use(requireAuth)");
    expect(routeSource).toContain("aiInsightsRouter.post('/insights'");
    expect(routeSource).toContain("apiSuccess({ insights: [] })");
  });

  it("gates the 3 Mira Analytics routes to super_admin/admin only", () => {
    // Mirrors the existing /providers/usage gate — an admin-only surface,
    // since it exposes aggregate usage/prompt-audit data across all users.
    for (const path of ["/analytics/summary", "/analytics/counts", "/analytics/prompt-audit"]) {
      const routeDecl = `aiInsightsRouter.get('${path}', requireRole('super_admin', 'admin')`;
      expect(routeSource).toContain(routeDecl);
    }
  });
});
