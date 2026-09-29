import { describe, it, expect, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute }, pingDb: vi.fn() }));

import { scanEngagementHealth } from "../engagement-health.service.js";

describe("scanEngagementHealth employee selection", () => {
  it("filters on the bare employment_status column so the status index is usable", async () => {
    execute.mockReset();
    execute.mockResolvedValue([[], []]);
    await scanEngagementHealth(5).catch(() => undefined);
    const sql = String(execute.mock.calls[0][0]);
    expect(sql).toMatch(/WHERE employment_status = 'active'/);
    expect(sql).not.toMatch(/LOWER\(/);
  });
});
