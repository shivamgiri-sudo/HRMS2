import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]) },
}));

import { db } from "../src/db/mysql.js";
import { appendEvent, listEvents } from "../src/modules/integration-hub/eventLog.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

const fakeEvent = {
  id: "ev-1",
  integration_key: "dialer_1",
  event_type: "run_triggered",
  triggered_by: "user-1",
  description: "Manual run",
  metadata: null,
  created_at: "2026-05-20T10:00:00Z",
};

describe("appendEvent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts event row", async () => {
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);
    mockExecute.mockResolvedValueOnce([[fakeEvent]]);
    const result = await appendEvent("dialer_1", "run_triggered", "user-1", "Manual run");
    expect(mockExecute).toHaveBeenCalledTimes(2);
    expect(result.event_type).toBe("run_triggered");
  });

  it("stores metadata as JSON when provided", async () => {
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);
    mockExecute.mockResolvedValueOnce([[{ ...fakeEvent, metadata: { rows: 100 } }]]);
    await appendEvent("dialer_1", "run_complete", "user-1", "Done", { rows: 100 });
    const [, params] = mockExecute.mock.calls[0];
    const metaParam = (params as unknown[]).find(
      (p) => typeof p === "string" && p.includes("rows")
    );
    expect(metaParam).toBeDefined();
  });
});

describe("listEvents", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns events for an integration key", async () => {
    mockExecute.mockResolvedValueOnce([[fakeEvent]]);
    const result = await listEvents("dialer_1");
    expect(result).toHaveLength(1);
    expect(result[0].integration_key).toBe("dialer_1");
  });

  it("filters by event_type when provided", async () => {
    mockExecute.mockResolvedValueOnce([[fakeEvent]]);
    await listEvents("dialer_1", "run_triggered");
    const [sql] = mockExecute.mock.calls[0];
    expect(sql).toMatch(/event_type/i);
  });

  it("returns empty array when no events", async () => {
    mockExecute.mockResolvedValueOnce([[]]);
    const result = await listEvents("dialer_1");
    expect(result).toEqual([]);
  });
});
