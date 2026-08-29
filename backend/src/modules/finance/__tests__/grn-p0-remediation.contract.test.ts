import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");
const read = (p: string) => fs.readFileSync(path.join(backendRoot, p), "utf8");

describe("F-01: backfill script assigns grn_number atomically", () => {
  it("script file exists", () => {
    expect(() => read("scripts/fix-grn-null-numbers.ts")).not.toThrow();
  });

  it("script uses per-GRN transaction wrapping the number allocation and the UPDATE", () => {
    const src = read("scripts/fix-grn-null-numbers.ts");
    expect(src).toContain("beginTransaction");
    expect(src).toContain("allocateMonthlyGrnNumber");
    expect(src).toContain("grn_number = ?");
    expect(src).toContain("AND grn_number IS NULL");
    expect(src).toContain("commit");
    expect(src).toContain("rollback");
  });

  it("script is idempotent — IS NULL guard prevents double-assignment", () => {
    const src = read("scripts/fix-grn-null-numbers.ts");
    expect(src).toMatch(/grn_number\s+IS\s+NULL/i);
  });

  it("script only targets non-draft rows", () => {
    const src = read("scripts/fix-grn-null-numbers.ts");
    expect(src).toMatch(/status\s*!=\s*'draft'|status\s*<>\s*'draft'|status NOT IN.*draft/i);
  });
});
