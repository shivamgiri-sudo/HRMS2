import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<{ sql: string; params: unknown[] }> = [];
let candidateRows: any[] = [];
let deleteBatches: number[] = [];

vi.mock("../src/logger.js", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock("../src/db/mysql.js", () => ({
  db: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/FROM upload_batch_retention_policy/.test(sql)) {
        return [[{ upload_type_code: "*", retain_days: 7, retain_failed_days: 30, enabled: 1 },
                 { upload_type_code: "INCENTIVE_BULK", retain_days: 14, retain_failed_days: 60, enabled: 1 }]];
      }
      if (/FROM upload_batch ub/.test(sql)) return [candidateRows];
      return [[]];
    }),
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/^DELETE FROM upload_batch_row/.test(sql)) return [{ affectedRows: deleteBatches.shift() ?? 0 }];
      return [{ affectedRows: 1 }];
    }),
  },
}));

import {
  DONE_STATUSES, FAILED_STATUSES, resolvePolicy, retentionMode, runUploadBatchRetention,
} from "../src/workers/upload-batch-retention.worker.js";

const cand = (over: Record<string, unknown> = {}) => ({
  id: "b1", upload_batch_no: "B-1", upload_type_code: "ONFIDO_DOC_RAW", original_file_name: "f.xlsx",
  batch_status: "imported", total_rows: 10, valid_rows: 10, error_rows: 0, imported_rows: 10,
  created_at: new Date("2026-08-01"), age_days: 20, ...over,
});

beforeEach(() => { calls.length = 0; candidateRows = []; deleteBatches = []; });

describe("retention mode", () => {
  // Since 2026-10-03 (commit 7fd7908bc) deletion is the default; only an explicit "dry_run" switches it off.
  // The remaining safety guarantees (terminal statuses only, snapshot first, small paced deletes) are covered below.
  it("executes by default; only an explicit dry_run switches deletion off", () => {
    expect(retentionMode(undefined)).toBe("execute");
    expect(retentionMode("")).toBe("execute");
    expect(retentionMode("true")).toBe("execute");
    expect(retentionMode("execute")).toBe("execute");
    expect(retentionMode("dry_run")).toBe("dry_run");
  });
});

describe("terminal statuses only", () => {
  it("never includes batches that are pending import or approval", () => {
    const all = [...DONE_STATUSES, ...FAILED_STATUSES] as string[];
    for (const s of ["uploaded", "validated", "processing"]) expect(all).not.toContain(s);
  });
  it("selects only terminal statuses", async () => {
    await runUploadBatchRetention("dry_run");
    const q = calls.find((c) => /FROM upload_batch ub/.test(c.sql))!;
    const statuses = q.params[0] as string[];
    expect(statuses).not.toContain("validated");
    expect(statuses).toContain("imported_with_errors");
  });
});

describe("policy", () => {
  const map = new Map([["*", { retain_days: 7, retain_failed_days: 30, enabled: 1 }], ["X", { retain_days: 14, retain_failed_days: 60, enabled: 1 }]]);
  it("uses the type's own row, else the default, else 7/30", () => {
    expect(resolvePolicy("X", map).retain_days).toBe(14);
    expect(resolvePolicy("OTHER", map).retain_days).toBe(7);
    expect(resolvePolicy("OTHER", new Map()).retain_failed_days).toBe(30);
  });
});

describe("dry run", () => {
  it("deletes and writes nothing", async () => {
    candidateRows = [cand()];
    const r = await runUploadBatchRetention("dry_run");
    expect(r.due).toBe(1);
    expect(r.rowsDeleted).toBe(0);
    expect(calls.some((c) => /^\s*(DELETE|INSERT|UPDATE)\b/i.test(c.sql))).toBe(false);
  });
  it("skips a batch younger than its retention", async () => {
    candidateRows = [cand({ age_days: 3 })];
    expect((await runUploadBatchRetention("dry_run")).due).toBe(0);
  });
  it("keeps money uploads 14 days", async () => {
    candidateRows = [cand({ upload_type_code: "INCENTIVE_BULK", age_days: 10 })];
    expect((await runUploadBatchRetention("dry_run")).due).toBe(0);
    candidateRows = [cand({ upload_type_code: "INCENTIVE_BULK", age_days: 15 })];
    expect((await runUploadBatchRetention("dry_run")).due).toBe(1);
  });
  it("keeps failed batches 30 days", async () => {
    candidateRows = [cand({ batch_status: "failed", age_days: 20 })];
    expect((await runUploadBatchRetention("dry_run")).due).toBe(0);
    candidateRows = [cand({ batch_status: "failed", age_days: 31 })];
    expect((await runUploadBatchRetention("dry_run")).due).toBe(1);
  });
});

describe("execute", () => {
  it("snapshots first, deletes in small autocommitted chunks, then marks the batch purged", async () => {
    candidateRows = [cand()];
    deleteBatches = [1000, 1000, 250];
    const r = await runUploadBatchRetention("execute");
    expect(r.rowsDeleted).toBe(2250);
    expect(r.batchesPurged).toBe(1);
    const order = calls.map((c) => (/INSERT IGNORE INTO upload_batch_snapshot/.test(c.sql) ? "snapshot" : /^DELETE/.test(c.sql) ? "delete" : /UPDATE upload_batch_snapshot/.test(c.sql) ? "mark" : ""));
    expect(order.indexOf("snapshot")).toBeLessThan(order.indexOf("delete"));
    expect(order.filter((o) => o === "delete")).toHaveLength(3);
    expect(order.lastIndexOf("mark")).toBeGreaterThan(order.lastIndexOf("delete"));
    const del = calls.find((c) => /^DELETE/.test(c.sql))!;
    expect(del.sql).toMatch(/LIMIT 1000$/); // constant inlined, never a bound LIMIT ? (rejected by MySQL prepared statements)
    expect(del.params).toEqual(["b1"]);
    expect(calls.some((c) => /BEGIN|START TRANSACTION/i.test(c.sql))).toBe(false);
  }, 20000);
  it("snapshot query never reads row data", async () => {
    candidateRows = [cand()];
    deleteBatches = [0];
    await runUploadBatchRetention("execute");
    const reads = calls.filter((c) => /FROM upload_batch_row/.test(c.sql) && /^\s*SELECT/i.test(c.sql)).map((c) => c.sql);
    expect(reads.length).toBeGreaterThan(0);
    for (const q of reads) expect(q).not.toMatch(/raw_data|normalized_data/);
  });
});
