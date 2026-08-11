import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(__dirname, "../../../sql/199_process_branch_dept_cleanup.sql"), "utf8");

describe("process branch/dept cleanup migration", () => {
  it("backfills process_id from the legacy employees.cost_center column", () => {
    expect(migration).toMatch(/JOIN integration_process_alias ipa ON ipa\.source_value = e\.cost_center/i);
    expect(migration).toMatch(/AND e\.cost_center IS NOT NULL/i);
    expect(migration).toMatch(/AND e\.cost_center != ''/i);
    expect(migration).not.toMatch(/e\.cost_center_code/i);
  });
});
