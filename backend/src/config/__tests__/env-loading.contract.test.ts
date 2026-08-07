import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("backend environment loading contract", () => {
  const envCode = fs.readFileSync(path.resolve(__dirname, "../env.ts"), "utf8");

  it("does not let .env override shell/runtime variables", () => {
    expect(envCode).toContain("override: false");
    expect(envCode).not.toContain("override: true");
  });
});
