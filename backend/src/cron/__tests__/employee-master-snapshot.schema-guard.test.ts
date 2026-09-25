import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../modules/reporting/employee-master-snapshot.service.js", () => ({
  refreshEmployeeMasterSnapshot: vi.fn(),
}));

const { schemaChangeInProgress } =
  await import("../employee-master-snapshot.cron.js");

describe("schemaChangeInProgress", () => {
  beforeEach(() => execute.mockReset());

  it("is true while the migration runner holds its advisory lock", async () => {
    execute.mockResolvedValueOnce([[{ migrating: 1, ddl: 0 }]]);
    await expect(schemaChangeInProgress()).resolves.toBe(true);
  });

  it("is true while any ALTER is running or waiting on a metadata lock", async () => {
    execute.mockResolvedValueOnce([[{ migrating: 0, ddl: 2 }]]);
    await expect(schemaChangeInProgress()).resolves.toBe(true);
  });

  it("is false when nothing is changing the schema", async () => {
    execute.mockResolvedValueOnce([[{ migrating: 0, ddl: 0 }]]);
    await expect(schemaChangeInProgress()).resolves.toBe(false);
  });

  it("fails open: if the check itself errors, the refresh is not blocked forever", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    execute.mockRejectedValueOnce(new Error("db down"));
    await expect(schemaChangeInProgress()).resolves.toBe(false);
  });

  it("checks the migration runner's real lock name", () => {
    const cron = readFileSync(
      resolve(process.cwd(), "src/cron/employee-master-snapshot.cron.ts"),
      "utf8",
    );
    const runner = readFileSync(
      resolve(process.cwd(), "src/db/runPendingMigrations.ts"),
      "utf8",
    );
    expect(runner).toContain("hrms_migration_lock");
    expect(cron).toContain("hrms_migration_lock");
  });

  it("runRefresh defers instead of starting a long employees read during a schema change", () => {
    const cron = readFileSync(
      resolve(process.cwd(), "src/cron/employee-master-snapshot.cron.ts"),
      "utf8",
    );
    const runRefresh = cron.slice(cron.indexOf("async function runRefresh"));
    const guard = runRefresh.indexOf("schemaChangeInProgress()");
    const refresh = runRefresh.indexOf("refreshEmployeeMasterSnapshot()");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(refresh);
  });
});
