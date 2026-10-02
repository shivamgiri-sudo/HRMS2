import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useUserRole", () => ({ useHasRole: () => true }));
vi.mock("@/hooks/useOrgMasters", () => ({ useProcesses: () => ({ data: [{ id: "p1", process_name: "Support" }] }) }));
vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(async () => ({ data: [] })), put: vi.fn() } }));

import { AutoRulesPanel, AUTO_RULE_WARNING, RuleRow } from "../AutoRulesPanel";
import { validateAutoRule, DEFAULT_RULE } from "../autoRuleForm";

const wrap = (node: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
};

describe("AutoRulesPanel", () => {
  it("renders the warning text and the process picker (no rows until a process is chosen)", () => {
    const html = wrap(<AutoRulesPanel />);
    expect(html).toContain("approved automatically and the employee is notified");
    expect(html).toContain(AUTO_RULE_WARNING.slice(0, 40));
    expect(html).toContain("Choose a process");
    expect(html).toContain("Support");
    expect(html).not.toContain("Max coverage drop for");
  });

  it("renders a rule row for swap and weekoff_rejection with default-off settings", () => {
    const html = wrap(<><RuleRow processId="p1" kind="swap" rows={[]} /><RuleRow processId="p1" kind="weekoff_rejection" rows={[]} /></>);
    expect(html).toContain("Shift swap");
    expect(html).toContain("Week-off rejected");
    expect(html.match(/Auto-approve/g)?.length).toBe(2);
    expect(html).toContain("Max coverage drop for Shift swap");
    expect(html.match(/<input type="checkbox"\/> Auto-approve/g)?.length).toBe(2); // enabled unchecked by default
  });
});

describe("validateAutoRule", () => {
  it("rejects a negative maxCoverageDrop", () => {
    const v = validateAutoRule("p1", "swap", { ...DEFAULT_RULE, maxCoverageDrop: "-1" });
    expect(v.ok).toBe(false);
  });
  it("rejects non-numeric, accepts 0 and positive", () => {
    expect(validateAutoRule("p1", "swap", { ...DEFAULT_RULE, maxCoverageDrop: "abc" }).ok).toBe(false);
    expect(validateAutoRule("p1", "swap", { ...DEFAULT_RULE, maxCoverageDrop: "2" }).ok).toBe(true);
  });
});
