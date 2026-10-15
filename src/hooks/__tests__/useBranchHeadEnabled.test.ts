import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: (...a: unknown[]) => get(...a) } }));
import { fetchBranchHeadEnabled } from "../useBranchHeadEnabled";

beforeEach(() => { get.mockReset(); });

describe("fetchBranchHeadEnabled", () => {
  it("true only for success + enabled", async () => {
    get.mockResolvedValue({ success: true, data: { enabled: true } });
    expect(await fetchBranchHeadEnabled()).toBe(true);
    expect(get).toHaveBeenCalledWith("/api/branch-head-health/enabled");
  });
  it("false on error or a non-enabled body", async () => {
    get.mockRejectedValue(new Error("404"));
    expect(await fetchBranchHeadEnabled()).toBe(false);
    get.mockResolvedValue({ success: false });
    expect(await fetchBranchHeadEnabled()).toBe(false);
  });
});
