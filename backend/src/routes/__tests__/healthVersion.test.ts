import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Coverage for the runtime-SHA gap.
 *
 * Nothing in production reported which commit was running, so confirming a deploy had
 * landed meant reading CI logs and assuming the runner's workspace matched the server.
 * The readiness audit lists this as Required for backend and workers separately.
 *
 * Two properties matter and are tested here:
 *   1. The build stamp is written, and never fails a build if it cannot be.
 *   2. A missing or corrupt stamp reports "unknown" rather than throwing or guessing —
 *      a diagnostic endpoint that 500s is worse than useless during an incident.
 */

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(here, "..", "..", "..", "scripts", "write-build-info.mjs");

describe("write-build-info.mjs", () => {
  it("exists and is wired into the backend build script", () => {
    expect(existsSync(scriptPath)).toBe(true);
    const pkg = JSON.parse(
      readFileSync(join(here, "..", "..", "..", "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    // A stamp nothing runs is a stamp that silently goes stale.
    expect(pkg.scripts.build).toContain("write-build-info.mjs");
  });

  it("writes a stamp carrying the commit, and exits 0", () => {
    // Runs the real script; it writes to backend/dist, which the build owns anyway.
    const out = execFileSync(process.execPath, [scriptPath], { encoding: "utf8" });
    expect(out).toContain("[build-info]");

    const stamp = JSON.parse(
      readFileSync(join(here, "..", "..", "..", "dist", "build-info.json"), "utf8"),
    ) as Record<string, string>;

    expect(stamp.commit).toMatch(/^[0-9a-f]{40}$|^unknown$/);
    expect(stamp.builtAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(stamp).toHaveProperty("branch");
  });

  it("prefers the CI-provided SHA over asking git", () => {
    const sha = "a".repeat(40);
    execFileSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      env: { ...process.env, GITHUB_SHA: sha, GITHUB_REF_NAME: "main" },
    });
    const stamp = JSON.parse(
      readFileSync(join(here, "..", "..", "..", "dist", "build-info.json"), "utf8"),
    ) as Record<string, string>;
    expect(stamp.commit).toBe(sha);
    expect(stamp.branch).toBe("main");
  });

  it("exits 0 even when it cannot resolve a commit at all", () => {
    // No git metadata reachable and no CI env: the build must still succeed.
    const isolated = mkdtempSync(join(tmpdir(), "buildinfo-"));
    try {
      const out = execFileSync(process.execPath, [scriptPath], {
        encoding: "utf8",
        cwd: isolated,
        env: { ...process.env, GITHUB_SHA: "", GIT_SHA: "", GITHUB_REF_NAME: "" },
      });
      expect(out).toContain("[build-info]");
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });
});

describe("readBuildInfo", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it("reports 'unknown' instead of throwing when the stamp is missing", async () => {
    vi.doMock("node:fs", async (orig) => {
      const actual = await orig<typeof import("node:fs")>();
      return {
        ...actual,
        readFileSync: (p: unknown, ...rest: unknown[]) => {
          if (String(p).endsWith("build-info.json")) {
            throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
          }
          return (actual.readFileSync as any)(p, ...rest);
        },
      };
    });

    const { readBuildInfo } = await import("../health.routes.js");
    expect(readBuildInfo()).toEqual({ commit: "unknown", branch: "unknown", builtAt: "unknown" });
  });

  it("reports 'unknown' instead of throwing when the stamp is corrupt", async () => {
    vi.doMock("node:fs", async (orig) => {
      const actual = await orig<typeof import("node:fs")>();
      return {
        ...actual,
        readFileSync: (p: unknown, ...rest: unknown[]) =>
          String(p).endsWith("build-info.json") ? "{not json" : (actual.readFileSync as any)(p, ...rest),
      };
    });

    const { readBuildInfo } = await import("../health.routes.js");
    expect(readBuildInfo().commit).toBe("unknown");
  });

  it("fills missing individual fields with 'unknown' rather than undefined", async () => {
    vi.doMock("node:fs", async (orig) => {
      const actual = await orig<typeof import("node:fs")>();
      return {
        ...actual,
        readFileSync: (p: unknown, ...rest: unknown[]) =>
          String(p).endsWith("build-info.json")
            ? JSON.stringify({ commit: "b".repeat(40) })
            : (actual.readFileSync as any)(p, ...rest),
      };
    });

    const { readBuildInfo } = await import("../health.routes.js");
    const info = readBuildInfo();
    expect(info.commit).toBe("b".repeat(40));
    expect(info.branch).toBe("unknown");
    expect(info.builtAt).toBe("unknown");
  });
});
