import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const read = (f: string) =>
  fs.readFileSync(path.resolve(__dirname, "..", f), "utf8");

describe("engagement real table names", () => {
  it("leaderboard counts kudos from kudos_transaction", () => {
    const src = read("engagement.controller.ts");
    expect(src).toContain(
      "FROM kudos_transaction k WHERE k.receiver_id = e.id",
    );
    expect(src).not.toMatch(/FROM kudos k\b/);
  });
  it("health score promotion signal uses employee_job_history, not employee_career_event", () => {
    const src = read("engagement-health.service.ts");
    expect(src).not.toContain("employee_career_event");
    expect(src).toContain("FROM employee_job_history");
    expect(src).toContain("change_type IN ('promotion','lateral_transfer')");
    expect(src).toContain(
      "effective_date >= DATE_SUB(CURDATE(), INTERVAL 18 MONTH)",
    );
  });
});
