import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const src = fs.readFileSync(path.resolve(__dirname, "../portal.snapshot.service.ts"), "utf8");

describe("portal snapshot staffing/quality query", () => {
  it("binds period as a parameter instead of selecting a non-existent employees.period", () => {
    expect(src).toContain("SELECT process_id, ? AS period, COUNT(*) AS record_count");
    expect(src).toContain("[period, processId]");
    expect(src).not.toContain("SELECT process_id, period, COUNT(*)");
    expect(src).not.toContain("DATE_FORMAT(CURDATE(), '%Y-%m')`");
  });
});
