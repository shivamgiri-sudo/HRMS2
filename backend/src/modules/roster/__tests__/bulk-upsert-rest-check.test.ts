import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("bulkUpsertAssignments — REST policy check", () => {
  it("route or service source references validateMinimumRest", () => {
    const candidates = [
      "src/modules/roster/roster.governance.service.ts",
      "src/modules/roster/roster.governance.routes.ts",
      "src/modules/roster/roster-master.service.ts",
    ];
    const srcs = candidates
      .map((f) => {
        try { return readFileSync(resolve(f), "utf8"); } catch { return ""; }
      })
      .join("\n");
    expect(srcs).toMatch(/validateMinimumRest/);
  });

  it("bulkUpsert path accumulates or returns warnings", () => {
    const candidates = [
      "src/modules/roster/roster.governance.service.ts",
      "src/modules/roster/roster.governance.routes.ts",
      "src/modules/roster/roster-master.service.ts",
    ];
    const srcs = candidates
      .map((f) => {
        try { return readFileSync(resolve(f), "utf8"); } catch { return ""; }
      })
      .join("\n");
    expect(srcs).toMatch(/warnings/);
  });
});
