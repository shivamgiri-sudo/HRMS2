import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyLockConflict, flushLockConflicts, installLockTelemetry, peekLockConflicts, recordLockConflict,
  resetLockTelemetryForTests, statementShape, trackLockConflicts,
} from "../lock-telemetry.js";

const deadlock = (sql?: string) => Object.assign(new Error("Deadlock found"), { code: "ER_LOCK_DEADLOCK", errno: 1213, sql });
const lockWait = () => Object.assign(new Error("Lock wait timeout exceeded"), { code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 });

describe("lock telemetry", () => {
  beforeEach(() => { resetLockTelemetryForTests(); vi.spyOn(console, "warn").mockImplementation(() => undefined); });

  it("classifies only 1213 and 1205", () => {
    expect(classifyLockConflict(deadlock())).toBe("deadlock");
    expect(classifyLockConflict(lockWait())).toBe("lock_wait_timeout");
    expect(classifyLockConflict({ errno: 1054 })).toBeNull();
    expect(classifyLockConflict(null)).toBeNull();
  });

  it("groups by normalised statement, so literals and IN-lists collapse to one shape", () => {
    expect(statementShape("UPDATE t SET a = 5 WHERE id IN (1, 2,3) AND n = 'x y'")).toBe("UPDATE t SET a = ? WHERE id IN (?…) AND n = ?");
    recordLockConflict(deadlock(), "UPDATE t SET a = 1 WHERE id = 10");
    recordLockConflict(deadlock(), "UPDATE t SET a = 2 WHERE id = 99");
    recordLockConflict(lockWait(), "UPDATE t SET a = 2 WHERE id = 99");
    expect(peekLockConflicts()).toEqual([
      { kind: "deadlock", shape: "UPDATE t SET a = ? WHERE id = ?", count: 2 },
      { kind: "lock_wait_timeout", shape: "UPDATE t SET a = ? WHERE id = ?", count: 1 },
    ]);
  });

  it("prefers the statement MySQL attached to the error over the caller's", () => {
    recordLockConflict(deadlock("INSERT INTO salary_component_assignments (id) VALUES (UUID())"), "SELECT 1");
    expect(peekLockConflicts()[0].shape).toMatch(/^INSERT INTO salary_component_assignments/);
  });

  it("ignores non-lock errors", () => {
    recordLockConflict(Object.assign(new Error("x"), { errno: 1054 }), "SELECT 1");
    expect(peekLockConflicts()).toEqual([]);
  });

  it("trackLockConflicts counts and re-throws the SAME error, and passes results through", async () => {
    const err = deadlock();
    await expect(trackLockConflicts("UPDATE t SET a = 1", Promise.reject(err))).rejects.toBe(err);
    await expect(trackLockConflicts("SELECT 1", Promise.resolve(42))).resolves.toBe(42);
    expect(peekLockConflicts()).toHaveLength(1);
  });

  it("flushes aggregated rows and clears them; a failing write drops the window instead of throwing", async () => {
    const execute = vi.fn().mockResolvedValue([{}, []]);
    installLockTelemetry({ execute } as never);
    recordLockConflict(deadlock(), "UPDATE t SET a = 1");
    recordLockConflict(deadlock(), "UPDATE t SET a = 2");
    expect(await flushLockConflicts()).toBe(1);
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO db_lock_incident"), ["deadlock", "UPDATE t SET a = ?", 2]);
    expect(peekLockConflicts()).toEqual([]);

    execute.mockRejectedValueOnce(new Error("Table 'db_lock_incident' doesn't exist"));
    recordLockConflict(deadlock(), "UPDATE t SET a = 1");
    await expect(flushLockConflicts()).resolves.toBe(0);
  });
});
