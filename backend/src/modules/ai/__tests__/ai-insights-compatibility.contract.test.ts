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
});
