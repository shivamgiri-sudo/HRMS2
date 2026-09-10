import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * `app.use("/api", clientRouter)` applies requireAuth to every /api/* path. Any
 * router that must work WITHOUT a session has to be mounted above that line.
 *
 * publicEmployeeDocumentRouter was mounted 13 lines below it, so every
 * joining-document e-sign link a candidate clicked answered "missing authorization
 * token" — the link carries its own single-use token and there is no session to
 * find. Mount order is invisible to the type checker, so it is pinned here.
 */

const APP = path.resolve(__dirname, "..", "app.ts");

function mountIndex(src: string, needle: string): number {
  const i = src.indexOf(needle);
  expect(i, `expected to find mount: ${needle}`).toBeGreaterThan(-1);
  return i;
}

describe("public API routers mount before the authenticated catch-all", () => {
  const src = fs.readFileSync(APP, "utf8");
  const catchAll = mountIndex(src, 'app.use("/api", clientRouter);');

  const publicMounts = [
    'app.use("/api/public/employee-documents"',
    'app.use("/api/public/joining-kit"',
    'app.use("/api/public/verify"',
    'app.use("/api/public/login-info"',
    'app.use("/api/ats/bgv"',
    'app.use("/api/files"',
  ];

  for (const mount of publicMounts) {
    it(`${mount.replace('app.use("', "").replace('"', "")} is mounted before requireAuth`, () => {
      const at = mountIndex(src, mount);
      expect(
        at,
        `${mount} sits below app.use("/api", clientRouter), so requireAuth answers first and token-carrying links 401`,
      ).toBeLessThan(catchAll);
    });
  }

  it("the catch-all is mounted exactly once", () => {
    const matches = src.match(/app\.use\("\/api",\s*clientRouter\);/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});
