import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canLoadOwnRecruiterStats } from "../recruiterWorkspaceAccess";

describe("Recruiter Workspace self-only endpoints", () => {
  it("are loaded for recruiters, including mixed HR+recruiter accounts", () => {
    expect(canLoadOwnRecruiterStats(["recruiter"])).toBe(true);
    expect(canLoadOwnRecruiterStats(["hr", "recruiter"])).toBe(true);
  });

  it("are skipped for privileged non-recruiters (backend answers 400/403 for them)", () => {
    expect(canLoadOwnRecruiterStats(["admin"])).toBe(false);
    expect(canLoadOwnRecruiterStats(["hr"])).toBe(false);
    expect(canLoadOwnRecruiterStats(["super_admin"])).toBe(false);
    expect(canLoadOwnRecruiterStats([])).toBe(false);
  });

  it("the workspace guards both calls and waits for roles before the first load", () => {
    const src = readFileSync(resolve(__dirname, "../../pages/NativeATSRecruiterWorkspace.tsx"), "utf8");
    const guardBefore = (endpoint: string) => {
      const call = src.indexOf(`"${endpoint}"`);
      const fnStart = src.lastIndexOf("const load", call);
      return src.slice(fnStart, call).includes("if (!loadsOwnStats)");
    };
    expect(guardBefore("/api/ats/recruiter/daily-stats")).toBe(true);
    expect(guardBefore("/api/ats/recruiter/other-pending")).toBe(true);
    expect(src).toMatch(/if \(!rolesResolved \|\| workspaceLoadedRef\.current\) return;/);
  });
});
