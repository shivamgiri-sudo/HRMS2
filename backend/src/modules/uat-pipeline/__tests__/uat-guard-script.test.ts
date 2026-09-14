/**
 * The path gate, exercised as a subprocess against real diffs.
 *
 * WHY A SUBPROCESS AND NOT AN IMPORT
 *   The guard runs in CI as `node uat-check-diff.mjs`, and what CI acts on is its EXIT CODE.
 *   Importing its functions would test the logic while leaving the thing CI depends on
 *   untested — and a guard that finds a violation and exits 0 is worse than no guard, because
 *   the build goes green.
 *
 * THE TWO CASES THAT MATTER MOST
 *   - A payroll path present IN the allowlist is still rejected, because the deny check reads
 *     the TRUSTED control plane rather than trusting the allowlist it was handed.
 *   - The guard refuses to run when --base is the working directory, which is the
 *     configuration where a patch could have modified the guard judging it.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
const guard = join(repoRoot, "backend", "scripts", "uat-check-diff.mjs");

let work: string;

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "uat-guard-"));
});
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

/** Run the guard and return its exit code plus combined output. */
function runGuard(patch: string, allow: string[], base = repoRoot) {
  const patchFile = join(work, `p-${Math.abs(hash(patch))}.patch`);
  const allowFile = join(work, `a-${Math.abs(hash(JSON.stringify(allow)))}.json`);
  writeFileSync(patchFile, patch);
  writeFileSync(allowFile, JSON.stringify(allow));
  try {
    const out = execFileSync(
      process.execPath,
      [guard, "--base", base, "--patch", patchFile, "--allow", allowFile],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], cwd: work }
    );
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function diff(file: string, body: string): string {
  return [
    `diff --git a/${file} b/${file}`,
    "index 1111111..2222222 100644",
    `--- a/${file}`,
    `+++ b/${file}`,
    "@@ -1,3 +1,3 @@",
    body,
    "",
  ].join("\n");
}

const OK_FILE = "src/pages/NativeVisitorForm.tsx";
const ALLOW = [OK_FILE];

describe("a clean patch", () => {
  it("exits 0 and lists what it allowed", () => {
    const r = runGuard(diff(OK_FILE, "-  const a = 1;\n+  const a = 2;"), ALLOW);
    expect(r.code).toBe(0);
    expect(r.out).toContain(OK_FILE);
  });

  it("prints its own sha256, so the log records which copy ran", () => {
    // If this hash is not the origin/main one, the guard evaluating the patch is the patched
    // guard — and the log is where that becomes visible after the fact.
    const r = runGuard(diff(OK_FILE, "-a\n+b"), ALLOW);
    expect(r.out).toMatch(/guard sha256 = [0-9a-f]{64}/);
  });
});

describe("paths outside the allowlist", () => {
  it("rejects a payroll file", () => {
    const r = runGuard(
      diff("backend/src/modules/payroll/payrollCalculate.service.ts", "-a\n+b"),
      ALLOW
    );
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/outside the approved allowlist/i);
  });

  it("rejects a patch that edits the guard script itself", () => {
    const r = runGuard(diff("backend/scripts/uat-check-diff.mjs", "-a\n+b"), ALLOW);
    expect(r.code).toBe(1);
  });

  it("rejects a patch that edits the control plane", () => {
    const r = runGuard(diff("uat/protected-paths.json", "-a\n+b"), ALLOW);
    expect(r.code).toBe(1);
  });

  it("rejects a patch that edits a workflow", () => {
    const r = runGuard(diff(".github/workflows/deploy.yml", "-a\n+b"), ALLOW);
    expect(r.code).toBe(1);
  });
});

describe("a deny-tier path smuggled INTO the allowlist", () => {
  it("is still rejected, because the deny check reads the trusted control plane", () => {
    // The allowlist is data handed to the guard. If a compromised backend or a tampered
    // storage object supplied one naming a payroll file, an allowlist-only check would pass
    // it. This is the test that says the second check is not redundant.
    const payroll = "backend/src/modules/payroll/payrollCalculate.service.ts";
    const r = runGuard(diff(payroll, "-a\n+b"), [payroll]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/Protected path in the diff/i);
    expect(r.out).toMatch(/backend\/src\/modules\/payroll/);
  });

  it("is still rejected when the deny path is mixed with a legitimate one", () => {
    const payroll = "backend/src/middleware/authMiddleware.ts";
    const patch =
      diff(OK_FILE, "-a\n+b") + diff(payroll, "-x\n+y");
    const r = runGuard(patch, [OK_FILE, payroll]);
    expect(r.code).toBe(1);
  });
});

describe("additive-only is checked structurally", () => {
  it("rejects a deleted file", () => {
    const patch = [
      `diff --git a/${OK_FILE} b/${OK_FILE}`,
      "deleted file mode 100644",
      "index 1111111..0000000",
      `--- a/${OK_FILE}`,
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-const a = 1;",
      "",
    ].join("\n");
    const r = runGuard(patch, ALLOW);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/deletes or renames files/i);
  });

  it("rejects a rename, which is a deletion as far as callers are concerned", () => {
    const patch = [
      `diff --git a/${OK_FILE} b/src/pages/Renamed.tsx`,
      "similarity index 90%",
      `rename from ${OK_FILE}`,
      "rename to src/pages/Renamed.tsx",
      "",
    ].join("\n");
    const r = runGuard(patch, [OK_FILE, "src/pages/Renamed.tsx"]);
    expect(r.code).toBe(1);
  });

  it("rejects a removed export", () => {
    const r = runGuard(
      diff(OK_FILE, "-export function useVisitorForm() {}\n+const y = 1;"),
      ALLOW
    );
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/removes an export/i);
  });

  it("rejects a removed route registration", () => {
    const r = runGuard(
      diff(OK_FILE, '-  router.get("/things", handler);\n+  const z = 1;'),
      ALLOW
    );
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/route registration/i);
  });

  it("rejects a removed migration manifest entry", () => {
    const r = runGuard(diff(OK_FILE, '-  "1042_something.sql",\n+  const q = 1;'), ALLOW);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/migration manifest entry/i);
  });
});

describe("the other checklist items the guard can decide alone", () => {
  it("rejects a dependency manifest change (BR-07)", () => {
    const r = runGuard(diff("package.json", '-  "a": "1"\n+  "left-pad": "^1.0.0"'), [
      "package.json",
    ]);
    expect(r.code).toBe(1);
  });

  it("rejects a lockfile change", () => {
    const r = runGuard(diff("package-lock.json", "-a\n+b"), ["package-lock.json"]);
    expect(r.code).toBe(1);
  });

  it("rejects introduced DDL (DI-01/DI-02)", () => {
    const r = runGuard(
      diff(OK_FILE, '-const a = 1;\n+await db.query("CREATE TABLE thing (id INT)");'),
      ALLOW
    );
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/DDL/i);
  });

  it("rejects an UPDATE with no WHERE (DI-05)", () => {
    const r = runGuard(
      diff(OK_FILE, '-const a = 1;\n+await db.query("UPDATE employees SET active = 0");'),
      ALLOW
    );
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/no WHERE/i);
  });

  it("allows an UPDATE that does have a WHERE", () => {
    const r = runGuard(
      diff(OK_FILE, '-const a = 1;\n+await db.query("UPDATE employees SET active = 0 WHERE id = ?");'),
      ALLOW
    );
    expect(r.code).toBe(0);
  });
});

describe("it refuses to run in a configuration where it could be judging itself", () => {
  it("exits non-zero when --base is the working directory", () => {
    const patchFile = join(work, "self.patch");
    const allowFile = join(work, "self.json");
    writeFileSync(patchFile, diff(OK_FILE, "-a\n+b"));
    writeFileSync(allowFile, JSON.stringify(ALLOW));
    let code = 0;
    let out = "";
    try {
      execFileSync(
        process.execPath,
        [guard, "--base", repoRoot, "--patch", patchFile, "--allow", allowFile],
        { encoding: "utf8", cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] }
      );
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      code = err.status ?? -1;
      out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    }
    expect(code).toBe(2);
    expect(out).toMatch(/current working directory/i);
  });

  it("exits non-zero with an empty allowlist", () => {
    const r = runGuard(diff(OK_FILE, "-a\n+b"), []);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/allowlist is empty/i);
  });

  it("exits non-zero when --base is not a repository checkout", () => {
    const r = runGuard(diff(OK_FILE, "-a\n+b"), ALLOW, work);
    expect(r.code).toBe(2);
  });

  it("exits non-zero on an unparseable patch rather than passing it", () => {
    const r = runGuard("this is not a diff at all", ALLOW);
    expect(r.code).toBe(2);
  });
});
