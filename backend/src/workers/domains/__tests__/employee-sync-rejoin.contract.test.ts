import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "..", "employee-sync-handler.ts"), "utf8");

/**
 * A rejoin in db_bill (Status=1, DOL empty, lastUpdated after the exit) must clear the HRMS
 * date_of_exit, otherwise the attendance register keeps hiding the employee (MAS61435, Sep 2026).
 */
describe("employee sync clears a stale exit date on rejoin", () => {
  it("clears date_of_exit only for an active, no-DOL record updated after the exit", () => {
    const m = src.match(/date_of_exit = IF\(([\s\S]*?), NULL, date_of_exit\)/);
    expect(m, "date_of_exit rejoin clause missing").not.toBeNull();
    const cond = m![1];
    expect(cond).toContain("VALUES(active_status) = 1");
    expect(cond).toContain("VALUES(date_of_leaving) IS NULL");
    expect(cond).toContain("VALUES(legacy_last_updated) > date_of_exit");
  });
});
