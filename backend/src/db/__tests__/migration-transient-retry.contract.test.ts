import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { isTransientMigrationError } from "../runPendingMigrations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../..");
const RUNNER = "src/db/runPendingMigrations.ts";

function read(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

/**
 * Production outage 2026-08-17. runPendingMigrations' outer catch recorded EVERY error as
 * `migration-runner`, and in production any recorded failure throws
 * "Production startup blocked because migrations failed", refusing to boot.
 *
 * What it caught that day was ER_LOCK_WAIT_TIMEOUT (1205) on
 * `CREATE TABLE IF NOT EXISTS salary_certificate_request` — a table that had existed since
 * 31 July. Nothing was wrong with the schema. A momentary lock kept production down for ~40
 * minutes across two deploys, because a retryable blip was treated as a permanent schema verdict.
 */
describe("startup migrations retry transient DB errors instead of refusing to boot", () => {
  it("classifies lock contention as transient — by driver code and by errno", () => {
    expect(isTransientMigrationError(Object.assign(new Error("lock"), { code: "ER_LOCK_WAIT_TIMEOUT" }))).toBe(true);
    expect(isTransientMigrationError(Object.assign(new Error("deadlock"), { code: "ER_LOCK_DEADLOCK" }))).toBe(true);
    // mysql2 always sets errno; code has been absent on some driver paths, so both must work.
    expect(isTransientMigrationError(Object.assign(new Error("lock"), { errno: 1205 }))).toBe(true);
    expect(isTransientMigrationError(Object.assign(new Error("deadlock"), { errno: 1213 }))).toBe(true);
    // The exact shape mysql2 threw during the outage.
    expect(isTransientMigrationError(
      Object.assign(new Error("Lock wait timeout exceeded; try restarting transaction"), {
        code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205, sqlState: "HY000",
      })
    )).toBe(true);
  });

  it("classifies connection loss as transient", () => {
    for (const code of ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EPIPE", "PROTOCOL_CONNECTION_LOST"]) {
      expect(isTransientMigrationError(Object.assign(new Error(code), { code })), code).toBe(true);
    }
  });

  it("does NOT classify a real schema failure as transient", () => {
    // These must still block the boot — that guard is the point of the runner.
    for (const code of ["ER_PARSE_ERROR", "ER_NO_SUCH_TABLE", "ER_DUP_FIELDNAME", "ER_BAD_FIELD_ERROR"]) {
      expect(isTransientMigrationError(Object.assign(new Error(code), { code })), code).toBe(false);
    }
    expect(isTransientMigrationError(new Error("Checksum mismatch for 1006_x.sql"))).toBe(false);
    expect(isTransientMigrationError(null)).toBe(false);
    expect(isTransientMigrationError(undefined)).toBe(false);
    expect(isTransientMigrationError("Lock wait timeout exceeded")).toBe(false);
  });

  /**
   * The ordering here is the whole correctness argument: the runner holds an advisory lock for the
   * duration of the try, released in the `finally`. Retrying INSIDE the catch would block waiting
   * for a lock this very call still owns — turning a 3-second blip into a hang.
   */
  it("retries only after the advisory lock is released, never inside the catch", () => {
    const source = read(RUNNER);
    const catchIdx = source.indexOf("if (isTransientMigrationError(error) && attempt < MIGRATION_MAX_ATTEMPTS)");
    const releaseIdx = source.indexOf("await releaseMigrationLock(lockConn)");
    const retryIdx = source.indexOf("return runPendingMigrations(attempt + 1)");
    expect(catchIdx, "transient check must exist in the catch").toBeGreaterThan(-1);
    expect(releaseIdx, "lock release must exist").toBeGreaterThan(-1);
    expect(retryIdx, "retry call must exist").toBeGreaterThan(-1);
    // catch flags it -> finally releases the lock -> only then do we recurse.
    expect(catchIdx).toBeLessThan(releaseIdx);
    expect(releaseIdx).toBeLessThan(retryIdx);
  });

  it("is bounded, so a genuinely stuck lock still fails the boot", () => {
    const source = read(RUNNER);
    expect(source).toContain("MIGRATION_MAX_ATTEMPTS");
    expect(source).toMatch(/attempt < MIGRATION_MAX_ATTEMPTS/);
    // Past the bound, the error must fall through to the failure list as before.
    const idx = source.indexOf("attempt < MIGRATION_MAX_ATTEMPTS");
    expect(source.slice(idx, idx + 500)).toContain('filename: "migration-runner"');
  });

  it("keeps the production boot guard intact for non-transient failures", () => {
    const source = read(RUNNER);
    expect(source).toContain("Production startup blocked because migrations failed");
    expect(source).toMatch(/migrationHealth\.failed\.length > 0 && env\.NODE_ENV === "production"/);
  });

  it("stays compatible with existing callers", () => {
    const source = read(RUNNER);
    // `attempt` must be defaulted, or server.ts / preflight would have to pass it.
    expect(source).toMatch(/runPendingMigrations\(attempt = 1\)/);
  });

  /**
   * The rejected alternative: adding lock codes to db/mysql.ts's global transient set would make
   * withTransientRetry silently re-run statements inside other people's transactions.
   */
  it("does not widen the app-wide retry set in db/mysql.ts", () => {
    const mysqlSource = read("src/db/mysql.ts");
    const setStart = mysqlSource.indexOf("const TRANSIENT_DB_ERROR_CODES");
    const block = mysqlSource.slice(setStart, mysqlSource.indexOf("]", setStart));
    expect(block).not.toContain("ER_LOCK_WAIT_TIMEOUT");
    expect(block).not.toContain("ER_LOCK_DEADLOCK");
  });
});
