import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "..", "billDb.ts"),
  "utf8"
);

/**
 * db_bill is MySQL 5.5.44. `SET SESSION TRANSACTION READ ONLY` was added in 5.6, so
 * issuing it unconditionally threw ER_UNKNOWN_SYSTEM_VARIABLE on every fresh pool.
 *
 * The damage was not a clean outage. `pool` was assigned before the statement ran, so
 * after the first (throwing) call every later caller got that same pool back and never
 * retried the guard — meaning db_bill queries succeeded or failed depending purely on
 * whether an earlier caller had swallowed the throw, and when they succeeded the
 * read-only session guard had never been applied. testBillConnection() swallows it, so
 * calling that first "fixed" db_bill and silently removed the protection.
 */

/** Mirrors supportsReadOnlyTransactions in billDb.ts. */
function supportsReadOnlyTransactions(versionString: string): boolean {
  const m = /^(\d+)\.(\d+)/.exec(versionString);
  if (!m) return false;
  const [major, minor] = [Number(m[1]), Number(m[2])];
  return major > 5 || (major === 5 && minor >= 6);
}

describe("billDb read-only guard", () => {
  it("does not claim read-only transaction support on the live 5.5 server", () => {
    expect(supportsReadOnlyTransactions("5.5.44-0ubuntu0.14.04.1-log")).toBe(false);
  });

  it("uses it on 5.6 and later", () => {
    expect(supportsReadOnlyTransactions("5.6.51")).toBe(true);
    expect(supportsReadOnlyTransactions("5.7.44-log")).toBe(true);
    expect(supportsReadOnlyTransactions("8.0.42-0ubuntu0.20.04.1")).toBe(true);
  });

  it("refuses rather than guesses when the version is unreadable", () => {
    expect(supportsReadOnlyTransactions("")).toBe(false);
    expect(supportsReadOnlyTransactions("unknown")).toBe(false);
  });

  it("gates the SET on the version check instead of issuing it unconditionally", () => {
    // Assert the code context, not the bare phrase — the phrase also appears in the
    // comment above explaining the bug, so a plain indexOf matches that instead.
    expect(SRC).toMatch(
      /if \(supportsReadOnlyTransactions\(version\)\) \{\s*await conn\.query\('SET SESSION TRANSACTION READ ONLY'\);/
    );
    // and it must not be issued outside that guard
    const statements = [...SRC.matchAll(/await conn\.query\('SET SESSION TRANSACTION READ ONLY'\)/g)];
    expect(statements, "exactly one guarded SET expected").toHaveLength(1);
  });

  it("never publishes a pool whose initialisation failed", () => {
    // The module-level `pool` must only be assigned after init succeeds, otherwise a
    // failed init silently downgrades every later caller.
    expect(SRC).toMatch(/const candidate = mysql\.createPool\(config\)/);
    expect(SRC).toMatch(/pool = candidate;/);
    expect(SRC, "a failed init must tear the candidate pool down").toMatch(
      /candidate\.end\(\)/
    );
    expect(SRC, "pool must not be assigned straight from createPool").not.toMatch(
      /pool = mysql\.createPool\(config\)/
    );
  });

  it("still blocks writes through billQuery regardless of session state", () => {
    expect(SRC).toMatch(/allowedStarts\s*=\s*\['SELECT', 'SHOW', 'DESCRIBE', 'EXPLAIN'\]/);
  });
});
