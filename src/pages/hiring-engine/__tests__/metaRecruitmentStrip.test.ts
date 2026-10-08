/** The Meta recruitment numbers are read once for the page: the strip and the Bulk calls tab share one request. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn());
vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get } }));

import { loadMetaRecruitment, resetMetaRecruitmentCache } from "../MetaRecruitmentStrip";

beforeEach(() => { get.mockReset(); resetMetaRecruitmentCache(); });

describe("loadMetaRecruitment", () => {
  it("two readers at once share one request", async () => {
    get.mockResolvedValue({ data: { campaigns: [], total: { joined: 1 } } });
    const [a, b] = await Promise.all([loadMetaRecruitment(1000), loadMetaRecruitment(1001)]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });
  it("a minute later it reads again; a failed read is not kept", async () => {
    get.mockResolvedValue({ data: { campaigns: [], total: {} } });
    await loadMetaRecruitment(1000);
    await loadMetaRecruitment(62_000);
    expect(get).toHaveBeenCalledTimes(2);
    get.mockRejectedValueOnce(new Error("down"));
    await expect(loadMetaRecruitment(200_000)).rejects.toThrow("down");
    get.mockResolvedValue({ data: { campaigns: [], total: {} } });
    await loadMetaRecruitment(200_001);
    expect(get).toHaveBeenCalledTimes(4);
  });
});
