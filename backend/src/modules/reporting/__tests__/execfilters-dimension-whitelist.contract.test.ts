import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guards against the exact HTTP-layer regression class found in the final whole-branch
 * review: an executor field (`dimension`, read by attritionDeepDive) that is correctly
 * threaded through the executor and the frontend, but silently dropped by report-suite.
 * routes.ts's hand-maintained ExecFilters whitelist built from req.query. The field then
 * defaults inside the executor and nobody notices, because the executor works fine when
 * called directly (which is how every earlier per-task review verified it).
 *
 * This test reads the route file's own source text -- same approach as
 * migration-manifest-guard.test.ts -- rather than exercising the route, so it fails fast
 * and cheaply the moment a whitelist block is edited without carrying `dimension` along.
 */

const ROUTE_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "report-suite.routes.ts"
);

function readSource(): string {
  return fs.readFileSync(ROUTE_FILE, "utf8");
}

describe("report-suite.routes.ts ExecFilters whitelists carry `dimension`", () => {
  it("the default-branch (screen) ExecFilters object includes a dimension field", () => {
    const src = readSource();
    const start = src.indexOf("const execFilters: ExecFilters = {");
    expect(start, "default-branch execFilters object not found").toBeGreaterThan(-1);
    const end = src.indexOf("};", start);
    const block = src.slice(start, end);
    expect(block).toMatch(/dimension:\s*req\.query\.dimension/);
  });

  it("the /:code/export ExecFilters object includes a dimension field", () => {
    const src = readSource();
    const start = src.indexOf("const filters: ExecFilters = {");
    expect(start, "export-route filters object not found").toBeGreaterThan(-1);
    const end = src.indexOf("};", start);
    const block = src.slice(start, end);
    expect(block).toMatch(/dimension:\s*req\.query\.dimension/);
  });
});
