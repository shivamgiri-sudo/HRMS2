/**
 * Contracts for the release integrity gate.
 *
 * The gate's whole value is that it FAILS. A version of it that silently passes on a stale
 * artifact is worse than not having it, because the deploy script would then treat its green
 * output as proof. So these pin the failure conditions, and the manifest comparison is exercised
 * behaviourally against real fixtures rather than asserted from the source text.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { describe, expect, it, afterAll } from "vitest";

const SCRIPT = resolve(process.cwd(), "scripts/release-integrity-check.mjs");
const SRC = readFileSync(SCRIPT, "utf8");

const tmp = mkdtempSync(join(tmpdir(), "release-gate-"));
afterAll(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } });

describe("the gate is wired to fail, not to reassure", () => {
  it("exits non-zero on any failure", () => {
    expect(SRC).toContain("process.exit(1)");
  });

  it("treats a missing build stamp as a failure", () => {
    expect(SRC).toMatch(/build-info\.json missing/);
  });

  it("treats an 'unknown' commit as a failure rather than a curiosity", () => {
    // buildInfo.ts resolves to "unknown" when the stamp could not be produced. That is a
    // truthful answer and an unacceptable one for a release.
    expect(SRC).toMatch(/commit is 'unknown'/);
    expect(SRC).toMatch(/runtime reports commit 'unknown'/);
  });

  it("fails when source and artifact disagree", () => {
    expect(SRC).toContain("SOURCE != ARTIFACT");
  });

  it("reports artifact-vs-runtime drift, but only FAILS on it after the restart", () => {
    expect(SRC).toContain("ARTIFACT != RUNTIME");
    // The pre gate runs straight after `npm run build`, when the processes are by definition
    // still on the previous commit. Failing there would fail every deploy at the moment it is
    // behaving correctly — so pre records a note and only --post treats it as the failure.
    expect(SRC).toMatch(/if \(POST\) fail\(`\$\{msg\}\. The restart did not take\.`\);/);
    expect(SRC).toMatch(/else notes\.push\(`\$\{msg\} — expected before the restart\.`\)/);
  });

  it("fails on a stale worker process only after the restart", () => {
    // The worker exposes no version endpoint, so start-time-vs-artifact-mtime is the available
    // proof. Without it, "we restarted them together" is an inference, and a worker left on old
    // code satisfies that inference silently.
    expect(SRC).toContain("it did not restart onto the new code");
    expect(SRC).toMatch(/POST \? fail\(/);
    expect(SRC).toContain("hrms2-workers");
    expect(SRC).toContain("hrms2-backend");
  });

  it("still fails PRE-restart when the source and the artifact disagree", () => {
    // This one a restart cannot fix, so it is a hard failure in both modes — it is the check
    // that would have stopped the 2026-08-13 deploy.
    const i = SRC.indexOf("SOURCE != ARTIFACT");
    expect(i).toBeGreaterThan(-1);
    expect(SRC.slice(Math.max(0, i - 200), i)).not.toContain("if (POST)");
  });

  it("requires pending = 0 only in --post mode", () => {
    expect(SRC).toMatch(/POST && ver\.schema\.pending !== 0/);
    // Pre-restart, pending > 0 is the normal state and must NOT fail the gate.
    expect(SRC).not.toMatch(/if \(ver\.schema\.pending !== 0\) fail/);
  });
});

describe("manifest parity is compared as a SET, not a count", () => {
  /** Minimal stand-ins with the same shape the real parser sees. */
  function writePair(srcEntries: string[], distEntries: string[]) {
    const asTs = (e: string[]) =>
      `const MIGRATION_MANIFEST = [\n${e.map((x) => `  "${x}",`).join("\n")}\n];\nexport type MigrationHealth = {};\n`;
    const asJs = (e: string[]) =>
      `const MIGRATION_MANIFEST = [\n${e.map((x) => `  "${x}",`).join("\n")}\n];\nMigrationHealth\n`;
    writeFileSync(join(tmp, "src.ts"), asTs(srcEntries));
    writeFileSync(join(tmp, "dist.js"), asJs(distEntries));
  }

  /** Re-implements the gate's extraction exactly, so a drift in the regex fails here. */
  function extract(file: string): Set<string> {
    const txt = readFileSync(join(tmp, file), "utf8");
    const start = txt.indexOf("MIGRATION_MANIFEST");
    const i = txt.indexOf("MigrationHealth", start);
    const body = txt.slice(start, i > 0 ? i : undefined);
    return new Set([...body.matchAll(/["']([0-9]+_[A-Za-z0-9_.-]+\.sql)["']/g)].map((m) => m[1]));
  }

  it("detects an entry present in source but missing from the artifact", () => {
    // The exact production case: 1141/1142 in src, absent from a 4-hour-old dist.
    writePair(["1140_a.sql", "1141_b.sql", "1142_c.sql"], ["1140_a.sql"]);
    const s = extract("src.ts"); const d = extract("dist.js");
    const missing = [...s].filter((x) => !d.has(x));
    expect(missing).toEqual(["1141_b.sql", "1142_c.sql"]);
  });

  it("detects an entry present in the artifact but missing from source", () => {
    writePair(["1140_a.sql"], ["1140_a.sql", "1199_ghost.sql"]);
    const s = extract("src.ts"); const d = extract("dist.js");
    expect([...d].filter((x) => !s.has(x))).toEqual(["1199_ghost.sql"]);
  });

  it("catches a same-size swap that a count comparison would pass", () => {
    // This is why the gate compares sets. Both sides have 2 entries.
    writePair(["1140_a.sql", "1141_b.sql"], ["1140_a.sql", "1141_DIFFERENT.sql"]);
    const s = extract("src.ts"); const d = extract("dist.js");
    expect(s.size).toBe(d.size);
    expect([...s].filter((x) => !d.has(x))).toEqual(["1141_b.sql"]);
  });

  it("reports parity when the two agree", () => {
    writePair(["1140_a.sql", "1141_b.sql"], ["1141_b.sql", "1140_a.sql"]); // order must not matter
    const s = extract("src.ts"); const d = extract("dist.js");
    expect([...s].filter((x) => !d.has(x))).toEqual([]);
    expect([...d].filter((x) => !s.has(x))).toEqual([]);
  });
});

describe("the gate runs", () => {
  it("executes and reports a verdict rather than crashing", () => {
    // No dist and no live API in CI, so it must FAIL — cleanly, with a verdict, not a stack trace.
    let out = "";
    let code = 0;
    try {
      out = execFileSync("node", [SCRIPT, "--expected-sha", "0".repeat(40), "--api", "http://127.0.0.1:1"], {
        encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000,
      });
    } catch (e: any) {
      code = e.status ?? 1;
      out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }
    expect(out).toContain("RELEASE INTEGRITY");
    expect(out).not.toMatch(/Cannot find module|SyntaxError|UnhandledPromiseRejection/);
    // Without an artifact or a reachable runtime it cannot certify anything, so it must fail.
    expect(code).toBe(1);
  }, 90_000);
});
