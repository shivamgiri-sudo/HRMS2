import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: api }));

import { selectionApi } from "../selectionApi";

beforeEach(() => { api.get.mockReset(); api.post.mockReset(); api.post.mockResolvedValue({ data: { success: true, data: [] } }); });

describe("why-not lookup call", () => {
  it("sends the searched mobile only in a POST body, never in the URL", async () => {
    await selectionApi.why("9876543210", "r1");
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledWith("/api/job-requisition/selection/why", { q: "9876543210", requisitionId: "r1" });
    expect(String(api.post.mock.calls[0][0])).not.toContain("9876543210");
  });
  it("omits the requisition when none is chosen", async () => {
    await selectionApi.why("Ravi");
    expect(api.post).toHaveBeenCalledWith("/api/job-requisition/selection/why", { q: "Ravi" });
  });
});
