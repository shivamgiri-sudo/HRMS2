import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));

import { SYNC_STATUS_KEY, newerRecord, readSyncStatus, safeErrorCode, writeSyncStatus, type SyncStatusRecord } from "../meta-sync-status.store.js";

const rec = (over: Partial<SyncStatusRecord> = {}): SyncStatusRecord => ({
  finishedAt: "2026-10-08T06:00:00.000Z", ok: true, imported: 3, forms: 5, formErrors: 0, errorCode: null, lastOkAt: "2026-10-08T06:00:00.000Z", ...over,
});

beforeEach(() => { execute.mockReset(); });

describe("safeErrorCode", () => {
  it("keeps only a short code token, never the message (which could carry a token or a name)", () => {
    expect(safeErrorCode({ code: "ECONNRESET", message: "access_token=EAAB123 failed for Ravi" })).toBe("ECONNRESET");
    expect(safeErrorCode({ message: "access_token=EAAB123 failed for Ravi" })).toBe("error");
    expect(safeErrorCode({ code: "bad code with spaces & PII 9876543210" })).toBe("error");
    expect(safeErrorCode(new TypeError("x"))).toBe("TypeError");
    expect(safeErrorCode(null)).toBe("error");
  });
});

describe("writeSyncStatus / readSyncStatus", () => {
  it("upserts one org_settings row holding only counts, times and the error code", async () => {
    execute.mockResolvedValue([{}]);
    await writeSyncStatus(rec({ ok: false, errorCode: "ECONNRESET" }));
    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/INSERT INTO org_settings/);
    expect(sql).toMatch(/ON DUPLICATE KEY UPDATE/);
    expect(params).toContain(SYNC_STATUS_KEY);
    const json = JSON.parse(params.find((p) => typeof p === "string" && p.startsWith("{")) as string);
    expect(Object.keys(json).sort()).toEqual(["errorCode", "finishedAt", "forms", "formErrors", "imported", "lastOkAt", "ok"].sort());
  });
  it("never throws when the write fails", async () => {
    execute.mockImplementation(async () => { throw new Error("db down"); });
    await expect(writeSyncStatus(rec())).resolves.toBeUndefined();
  });
  it("round-trips a stored value", async () => {
    execute.mockResolvedValue([[{ setting_value: JSON.stringify(rec({ ok: false, errorCode: "E1" })) }]]);
    expect(await readSyncStatus()).toMatchObject({ ok: false, errorCode: "E1", imported: 3 });
  });
  it("returns null for no row, junk JSON, or a bad timestamp", async () => {
    execute.mockResolvedValueOnce([[]]);
    expect(await readSyncStatus()).toBeNull();
    execute.mockResolvedValueOnce([[{ setting_value: "{not json" }]]);
    expect(await readSyncStatus()).toBeNull();
    execute.mockResolvedValueOnce([[{ setting_value: JSON.stringify({ ok: true, finishedAt: "garbage" }) }]]);
    expect(await readSyncStatus()).toBeNull();
  });
  it("returns null (does not throw) when the read fails", async () => {
    execute.mockImplementation(async () => { throw new Error("db down"); });
    expect(await readSyncStatus()).toBeNull();
  });
});

describe("newerRecord", () => {
  it("picks the later finishedAt and tolerates nulls", () => {
    const a = rec({ finishedAt: "2026-10-08T05:00:00.000Z" });
    const b = rec({ finishedAt: "2026-10-08T06:00:00.000Z" });
    expect(newerRecord(a, b)).toBe(b);
    expect(newerRecord(b, a)).toBe(b);
    expect(newerRecord(null, a)).toBe(a);
    expect(newerRecord(a, null)).toBe(a);
    expect(newerRecord(null, null)).toBeNull();
  });
});
