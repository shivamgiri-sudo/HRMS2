import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const src = fs.readFileSync(path.resolve(__dirname, "../rta.routes.ts"), "utf8");

describe("rta snapshot SQL", () => {
  it("applies LOWER() to the qualified column, not as a method on the alias", () => {
    expect(src).not.toMatch(/e\.LOWER\(/);
    expect(src).toContain("WHERE LOWER(e.employment_status) = 'active'");
  });
});
