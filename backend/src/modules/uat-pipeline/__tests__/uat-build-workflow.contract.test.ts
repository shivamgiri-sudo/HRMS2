/**
 * The build workflow's trust boundaries, asserted against the YAML itself.
 *
 * WHY A TEXT TEST AND NOT A YAML SCHEMA
 *   The properties that matter here are not "is this valid YAML" — GitHub will tell us that.
 *   They are "does the job that executes AI-generated code hold write authority", and that is
 *   a question about which permission block sits under which job key. Reading the file and
 *   asserting on job blocks is the direct way to ask it.
 *
 * WHY IT IS WORTH TESTING AT ALL
 *   Workflow permissions are edited casually. Someone debugging a failing push adds
 *   `contents: write` to the job that is failing, the build goes green, and the audit rule
 *   the four-job split exists to satisfy is silently gone with no test failing. This is that
 *   test.
 *
 * COMMENTS ARE STRIPPED BEFORE CHECKING. The file's own comments explain why
 * `actions/upload-artifact` and `git add -A` are avoided, and an earlier version of this
 * test failed on its own prose. Checking comments is checking the documentation.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
const raw = readFileSync(join(repoRoot, ".github", "workflows", "uat-build.yml"), "utf8");

const src = raw
  .split("\n")
  .filter((l) => !/^\s*#/.test(l))
  .join("\n");

function jobBlocks(): Record<string, string> {
  const names = ["sandbox", "publish", "verify", "report"];
  const starts = names
    .map((n) => ({ n, i: src.indexOf(`\n  ${n}:\n`) }))
    .sort((a, b) => a.i - b.i);
  for (const s of starts) {
    if (s.i < 0) throw new Error(`job "${s.n}" is missing from uat-build.yml`);
  }
  const out: Record<string, string> = {};
  starts.forEach((s, k) => {
    out[s.n] = src.slice(s.i, k + 1 < starts.length ? starts[k + 1].i : src.length);
  });
  return out;
}

const { sandbox: A, publish: B, verify: C, report: D } = jobBlocks();

describe("the workflow cannot be triggered by an attacker", () => {
  it("is workflow_dispatch only", () => {
    // A pull_request trigger would let a fork run this workflow. push would run it on every
    // commit. Neither is recoverable by any later check.
    expect(/on:\s*\n\s*workflow_dispatch:/.test(src)).toBe(true);
    expect(/\n\s{2}(push|pull_request|pull_request_target|schedule):/.test(src)).toBe(false);
  });

  it("takes exactly one input, a UUID — no token, no prompt, no free text", () => {
    const inputs = [...src.matchAll(/^\s{6}([a-z_]+):\s*$/gm)].map((m) => m[1]);
    expect(inputs).toContain("build_run_id");
    for (const forbidden of ["token", "prompt", "command", "script", "paths"]) {
      expect(inputs).not.toContain(forbidden);
    }
  });

  it("declares empty default permissions, so nothing inherits write by omission", () => {
    expect(/^permissions: \{\}$/m.test(src)).toBe(true);
  });

  it("pins every third-party action to a commit SHA, never a tag", () => {
    // A tag is mutable. `@v4` is a promise the action's owner can break on every repository
    // at once, and a compromised action in Job B holds contents: write.
    const uses = [...src.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u, `${u} is not SHA-pinned`).toMatch(/@[0-9a-f]{40}$/);
  });
});

describe("Job A — executes generated code, therefore holds no write authority", () => {
  it("has no contents: write", () => {
    expect(/contents:\s*write/.test(A)).toBe(false);
  });

  it("strips both OIDC request variables before the sandbox starts", () => {
    // These two variables ARE the ability to mint a credential. Removing them is stronger
    // than any tool denylist, because it holds even if the agent ignores every instruction.
    expect(A).toContain("unset ACTIONS_ID_TOKEN_REQUEST_URL");
    expect(A).toContain("unset ACTIONS_ID_TOKEN_REQUEST_TOKEN");
    expect(A).toContain("unset GITHUB_TOKEN");
  });

  it("blocks egress before Claude runs, not after", () => {
    const block = A.indexOf("egress-policy: block");
    const claude = A.indexOf("claude-code");
    expect(block).toBeGreaterThan(-1);
    expect(claude).toBeGreaterThan(-1);
    expect(block, "egress must be blocked before the sandbox starts").toBeLessThan(claude);
  });

  it("runs the guards from the trusted origin/main checkout, not the patched tree", () => {
    // The single most important line in the file. A guard run from the patched tree is a
    // guard a patch could have modified.
    expect(A).toMatch(/\/tmp\/trusted-base\/backend\/scripts\/uat-check-diff\.mjs/);
  });

  it("redirects the session log to a file rather than tee-ing it to the console", () => {
    expect(A).toMatch(/>\s*evidence\/claude-session\.jsonl/);
    expect(/\|\s*tee/.test(A)).toBe(false);
  });

  it("narrows the bash tool to test commands only", () => {
    // Bash(npm run *) executes whatever a modified package.json script contains.
    expect(A).toContain("Bash(npm run test:*)");
    expect(A).not.toContain("Bash(npm run *)");
  });

  it("never prints the prompt to the log", () => {
    expect(/cat prompt\.md\s*$/m.test(A)).toBe(false);
  });
});

describe("Job B — writes to the repository, executes nothing generated", () => {
  it("is the only job holding contents: write", () => {
    expect(/contents:\s*write/.test(B)).toBe(true);
    expect(/contents:\s*write/.test(A + C + D)).toBe(false);
  });

  it("verifies the patch hash before applying it", () => {
    expect(B).toContain("Patch hash mismatch");
  });

  it("stages by explicit path — never git add -A", () => {
    // A broad add in a repository with a dozen concurrent worktrees sweeps other agents'
    // in-flight edits into this commit, where they are attributed to the wrong change.
    expect(/git add -A\b/.test(B)).toBe(false);
    expect(/git add \.\s/.test(B)).toBe(false);
    expect(B).toMatch(/git add -- /);
  });

  it("re-runs the guard from its own trusted checkout", () => {
    expect(B).toContain("trusted-base");
  });

  it("validates the branch name before git switch -c", () => {
    expect(B).toMatch(/grep -Eq/);
    expect(B).toContain("^uat/");
  });

  it("runs no tests and no generated code", () => {
    expect(/npm run test|vitest|npm run build/.test(B)).toBe(false);
  });
});

describe("Job C — executes repository code, therefore holds nothing", () => {
  it("cannot mint an OIDC token", () => {
    expect(/id-token/.test(C)).toBe(false);
  });

  it("has no write permission of any kind", () => {
    expect(/contents:\s*write/.test(C)).toBe(false);
    expect(/pull-requests:\s*write/.test(C)).toBe(false);
  });

  it("checks out the exact pushed SHA, not the branch", () => {
    // A branch reference can move between the push and the checkout; verification must
    // certify the commit that actually landed.
    expect(C).toMatch(/ref:\s*\$\{\{\s*needs\.publish\.outputs\.head_sha/);
  });

  it("uses the frontend typecheck that actually compiles files", () => {
    // `npm run typecheck` compiles zero files in this repository and always exits 0.
    expect(C).toContain("tsc --noEmit -p tsconfig.app.json");
  });
});

describe("Job D — publishes, executes no repository code", () => {
  it("never checks out the repository", () => {
    // This is what makes it safe for it to hold publication authority.
    expect(/actions\/checkout/.test(D)).toBe(false);
  });

  it("holds pull-requests: write", () => {
    expect(/pull-requests:\s*write/.test(D)).toBe(true);
  });

  it("opens a draft, never a ready-for-merge PR", () => {
    expect(D).toContain("--draft");
  });

  it("relays a gate hash it did not compute", () => {
    expect(D).toMatch(/needs\.verify\.outputs\.gates_sha256/);
  });

  it("runs on failure too, so a failed build is reported rather than silent", () => {
    expect(D).toMatch(/if:\s*always\(\)/);
  });
});

describe("nothing employee-derived leaves the backend", () => {
  it("uses no actions/upload-artifact anywhere", () => {
    // Artifacts are readable by anyone who can read the repository, and stay readable after
    // it is made private.
    expect(/upload-artifact/.test(src)).toBe(false);
  });

  it("installs with --ignore-scripts on every install", () => {
    const installs = src.match(/npm (--prefix backend )?ci( |$)/gm) ?? [];
    const guarded = src.match(/npm (--prefix backend )?ci --ignore-scripts/g) ?? [];
    expect(guarded.length).toBe(installs.length);
    expect(guarded.length).toBeGreaterThanOrEqual(4);
  });

  it("never runs curl in verbose mode, which would print the auth header", () => {
    expect(/curl -sS/.test(src)).toBe(true);
    expect(/curl [^\n]*\s-v\b/.test(src)).toBe(false);
    expect(/set -x/.test(src)).toBe(false);
  });

  it("masks every token it mints", () => {
    expect((src.match(/::add-mask::/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});

describe("serialisation", () => {
  it("does not cancel a build in progress", () => {
    // A cancelled build can leave a pushed branch and a half-recorded result; reconciling
    // that is harder than waiting.
    expect(src).toMatch(/cancel-in-progress:\s*false/);
  });
});
