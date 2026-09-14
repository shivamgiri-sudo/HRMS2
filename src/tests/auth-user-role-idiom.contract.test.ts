import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");
const srcRoot = path.join(repoRoot, "src");

function walk(dir: string, out: string[] = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * `HrmsUser` is `{ id, email, isReadOnly? }` — `decodeJwtUser` builds it
 * explicitly and drops any role claim on the token. So `user.role` read off
 * `useAuth()` is always `undefined`, and any check built on it silently never
 * matches.
 *
 * That had hidden the cost-centre approval workflow, the meetings admin and
 * manager surfaces, and the Salary Start Date field from every user including
 * super admins. The same shape once ran the other way and served every employee
 * the admin payroll console (see the primaryRole note in useUserRole.ts), so
 * this is not always fail-closed.
 *
 * Role checks must go through `useHasRole` / `useWorkforceAccess`.
 */
describe("auth user role idiom", () => {
  it("HrmsUser still has no role field, so the ban below stays necessary", () => {
    const auth = fs.readFileSync(path.join(srcRoot, "contexts/AuthContext.tsx"), "utf8");
    const shape = auth.match(/export interface HrmsUser \{([\s\S]*?)\}/)?.[1] ?? "";
    expect(shape).not.toMatch(/\brole\b/);
    expect(shape).not.toMatch(/\broles\b/);
  });

  it("nothing reads .role or .roles off the useAuth() user", () => {
    const offenders: string[] = [];

    for (const file of walk(srcRoot)) {
      const source = fs.readFileSync(file, "utf8");
      // Only files that pull the user out of the auth context can be at fault.
      if (!/\bconst\s*\{[^}]*\buser\b[^}]*\}\s*=\s*useAuth\(\)/.test(source)) continue;

      source.split("\n").forEach((line, index) => {
        const code = line.replace(/\/\/.*$/, "");
        if (/\buser\s*(\?\.|\.)\s*roles?\b/.test(code)) {
          offenders.push(`${path.relative(repoRoot, file)}:${index + 1}`);
        }
      });
    }

    expect(
      offenders,
      `These read a role off the useAuth() user, which is always undefined. Use useHasRole(...) instead:\n${offenders.join("\n")}`
    ).toEqual([]);
  });
});
