import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, mark: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(async () => [h.rows, []]) } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../location-elsewhere.service.js", () => ({ markLocationElsewhere: (...a: unknown[]) => h.mark(...a) }));
import { sweepLocationElsewhere } from "../location-sweep.service.js";

const row = (id: string, mobile: string, residence: string | null) => ({ id, mobile10: mobile, branch: "NOIDA-2", city: "", state: "Uttar Pradesh", residence });
beforeEach(() => { h.rows = []; h.mark.mockReset().mockResolvedValue({ journeysStopped: 1, bookingsReleased: 0 }); });

describe("sweepLocationElsewhere", () => {
  it("stops only people whose records name another place; local and unknown stay", async () => {
    h.rows = [row("a1", "9000000001", "navrangpura ahmedabad gujarat"), row("a2", "9000000002", "sector 62 noida"), row("a3", "9000000003", null), row("a4", "9000000004", "near the market")];
    const r = await sweepLocationElsewhere();
    expect(r.checked).toBe(4);
    expect(r.stopped).toBe(1);
    expect(h.mark).toHaveBeenCalledTimes(1);
    expect(h.mark).toHaveBeenCalledWith("9000000001", expect.objectContaining({ actor: "location-sweep" }));
  });
  it("wraps to the start when a pass finds nothing more", async () => {
    h.rows = [];
    expect((await sweepLocationElsewhere()).wrapped).toBe(true);
  });
});
