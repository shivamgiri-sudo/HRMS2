import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("migrate-fresh-test destructive safety contract", () => {
  const script = fs.readFileSync(
    path.resolve(__dirname, "../../../scripts/migrate-fresh-test.ts"),
    "utf8",
  );

  it("requires explicit destructive confirmation", () => {
    expect(script).toContain("--allow-destructive-test-db");
    expect(script).toContain("missing --allow-destructive-test-db");
  });

  it("fails closed for non-local hosts, production env, production-looking DB names, and prod/test DB equality", () => {
    expect(script).toContain("127.0.0.1");
    expect(script).toContain("localhost");
    expect(script).toContain("::1");
    expect(script).toContain("non-local host");
    expect(script).toContain("NODE_ENV=production");
    expect(script).toContain("does not look disposable/test-scoped");
    expect(script).toContain("matches DB_NAME");
  });

  it("prints safe target metadata without password output", () => {
    expect(script).toContain("Host:");
    expect(script).toContain("Port:");
    expect(script).toContain("NODE_ENV:");
    expect(script).not.toMatch(/console\.(log|warn|error)\([^)]*DB_PASSWORD/i);
    expect(script).not.toMatch(/console\.(log|warn|error)\([^)]*password/i);
  });
});
