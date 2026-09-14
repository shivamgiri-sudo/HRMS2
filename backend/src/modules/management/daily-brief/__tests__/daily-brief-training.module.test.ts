import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

import { buildTrainingModule } from "../daily-brief-training.module.js";

describe("daily-brief-training: stale-source detection", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("flags STALE when the last sync timestamp is older than the 24h threshold", async () => {
    const oldSync = new Date(Date.now() - 30 * 60 * 60 * 1000); // 30h ago
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("MAX(synced_at)")) return [[{ last_synced: oldSync }]];
      if (sql.includes("FROM lms_learning_progress_snapshot")) {
        return [[{ total_rows: 10, completed_d1: 1, in_progress: 3, overdue: 0, completed_total: 5 }]];
      }
      if (sql.includes("FROM lms_certification_snapshot")) {
        return [[{ expiring_30d: 0, expired: 0 }]];
      }
      return [[{}]];
    });

    const result = await buildTrainingModule(["e1", "e2"], "2026-08-18");

    const health = result.sourceHealth.find((h) => h.module === "training_progress");
    expect(health?.state).toBe("STALE");
    expect(health?.detail).toContain("synced");
  });

  it("is AVAILABLE (not STALE) when the last sync is recent", async () => {
    const recentSync = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("MAX(synced_at)")) return [[{ last_synced: recentSync }]];
      if (sql.includes("FROM lms_learning_progress_snapshot")) {
        return [[{ total_rows: 10, completed_d1: 1, in_progress: 3, overdue: 0, completed_total: 5 }]];
      }
      if (sql.includes("FROM lms_certification_snapshot")) {
        return [[{ expiring_30d: 0, expired: 0 }]];
      }
      return [[{}]];
    });

    const result = await buildTrainingModule(["e1"], "2026-08-18");

    const health = result.sourceHealth.find((h) => h.module === "training_progress");
    expect(health?.state).toBe("AVAILABLE");
  });
});

describe("daily-brief-training: scope gating", () => {
  it("is NOT_APPLICABLE and runs no query when teamEmployeeIds is empty", async () => {
    execute.mockReset();
    const result = await buildTrainingModule([], "2026-08-18");

    expect(result.applicable).toBe(false);
    expect(result.coursesCompletedD1).toBeNull();
    expect(result.sourceHealth.every((h) => h.state === "NOT_APPLICABLE")).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("daily-brief-training: error handling", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("a thrown query error yields sourceHealth = ERROR, not a silent zero", async () => {
    execute.mockRejectedValue(new Error("ER_NO_SUCH_TABLE: simulated failure"));

    const result = await buildTrainingModule(["e1"], "2026-08-18");

    expect(result.coursesCompletedD1).toBeNull();
    const health = result.sourceHealth.find((h) => h.module === "training_progress");
    expect(health?.state).toBe("ERROR");
    expect(health?.detail).toContain("simulated failure");
  });
});
