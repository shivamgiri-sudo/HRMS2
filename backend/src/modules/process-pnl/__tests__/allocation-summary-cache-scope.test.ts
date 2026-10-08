import { describe, expect, it, vi } from "vitest";

/**
 * A user confined to several branches arrives with branchIds and no branchId. The allocation
 * summary cache key used to ignore branchIds, so that user was served the company-wide entry —
 * the one the boot warmer fills with { period } — i.e. other branches' figures.
 */
const { getSummary } = vi.hoisted(() => ({ getSummary: vi.fn() }));
vi.mock("../bpo-pnl-allocation-overlay.service.js", () => ({ bpoPnlAllocationOverlayService: { getSummary } }));

describe("allocation summary cache is keyed by the branch scope", () => {
  it("a branchIds-scoped request never reuses the company-wide entry", async () => {
    getSummary.mockImplementation(async (f: { branchIds?: string[] }) => ({ scope: f.branchIds?.join(",") ?? "company" }));
    const { getCachedAllocationSummary } = await import("../canonical-pnl.service.js");
    const company = await getCachedAllocationSummary({ period: "2031-01" });
    const scoped = await getCachedAllocationSummary({ period: "2031-01", branchIds: ["B2", "B1"] } as never);
    const reordered = await getCachedAllocationSummary({ period: "2031-01", branchIds: ["B1", "B2"] } as never);
    expect(company).toEqual({ scope: "company" });
    expect(scoped).toEqual({ scope: "B2,B1" });
    expect(reordered, "same set, other order: same entry").toEqual({ scope: "B2,B1" });
  });
});
