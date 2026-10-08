import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * accessGuard.hasRole() returns TRUE for admin / super_admin for ANY requested role. Using it to ask "does this caller hold
 * an org-wide role?" (hasRole(u, ...ORG_WIDE_EXEMPT_ROLES)) therefore made every admin org-wide - the opposite of the
 * 2026-10-01 ruling (admin is branch-scoped like hr). The org-wide test is scopeAccess.hasAnyRole, whose only shortcut is
 * super_admin. This pins every workforce / roster / management module against the old pattern coming back.
 */
const MODULES = [
  "wfm", "wfm-extensions", "roster", "attendance", "audit", "goals", "analytics-catalogue", "ats", "ats-full-parity",
  "performance-feedback", "lms", "performance-ingestion", "management", "dashboards", "bulk-upload",
];
const root = resolve(process.cwd(), "src/modules");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "__tests__" && name !== "node_modules") walk(p, out); }
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("org-wide test uses hasAnyRole, never accessGuard.hasRole", () => {
  for (const m of MODULES) {
    it(`${m}: no hasRole(..., ...ORG_WIDE_EXEMPT_ROLES) / hasRole(..., ...WIDE_ROLES)`, () => {
      const offenders = walk(join(root, m))
        .filter((f) => /\bhasRole\([^)]*\.\.\.(ORG_WIDE_EXEMPT_ROLES|WIDE_ROLES)\b/.test(readFileSync(f, "utf8")));
      expect(offenders).toEqual([]);
    });
  }
});
