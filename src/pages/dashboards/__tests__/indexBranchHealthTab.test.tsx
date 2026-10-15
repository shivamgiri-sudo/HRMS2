import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

const enabledState = vi.hoisted(() => ({ value: { enabled: false, isLoading: false } }));
vi.mock("@/hooks/useUserRole", () => ({ useUserRole: () => ({ data: { roleKeys: ["ceo", "branch_head"] }, isLoading: false }) }));
vi.mock("@/hooks/useBranchHeadEnabled", () => ({ useBranchHeadEnabled: () => enabledState.value }));
vi.mock("@/components/layout/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <div>{children}</div> }));
vi.mock("../ReferenceRoleDashboard", () => ({ default: ({ subheader, variant }: any) => <div data-variant={variant}>{subheader}</div> }));

import Index from "../../Index";

const html = () => renderToStaticMarkup(<MemoryRouter><Index /></MemoryRouter>);
afterEach(() => vi.unstubAllEnvs());

describe("Index Branch Health tab", () => {
  it("is hidden when the backend says not enabled, even with the build flag on", () => {
    vi.stubEnv("VITE_BRANCH_HEAD_HEALTH_ENABLED", "true");
    enabledState.value = { enabled: false, isLoading: false };
    const out = html();
    expect(out).not.toContain("Branch Health");
    expect(out).toContain("CEO");
  });
  it("is shown when enabled", () => {
    vi.stubEnv("VITE_BRANCH_HEAD_HEALTH_ENABLED", "true");
    enabledState.value = { enabled: true, isLoading: false };
    expect(html()).toContain("Branch Health");
  });
});
