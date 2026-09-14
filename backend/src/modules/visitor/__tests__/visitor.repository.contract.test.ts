import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const repositorySource = readFileSync(
  new URL("../visitor.repository.ts", import.meta.url),
  "utf8",
);

describe("visitor repository runtime contracts", () => {
  it("does not bind LIMIT and OFFSET through MySQL prepared parameters", () => {
    expect(repositorySource).not.toContain("LIMIT ? OFFSET ?");
    expect(repositorySource).toContain("LIMIT ${limit} OFFSET ${offset}");
    expect(repositorySource).toContain("Math.trunc");
  });
});
