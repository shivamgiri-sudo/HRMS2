/**
 * GET /my-pending-count is rendered on every dashboard load. It refreshed each assigned scope
 * strictly one after another; scopes are independent, so they now refresh in small concurrent
 * chunks (Promise.all), keeping scope order and skipping scopes that fail to load.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const src = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../payroll-process-readiness.routes.ts",
  ),
  "utf8",
);
const handler = src.slice(
  src.indexOf('"/my-pending-count"'),
  src.indexOf('"/branch/:branchId"'),
);

describe("GET /my-pending-count scope refresh", () => {
  it("refreshes scopes concurrently in bounded chunks, not one await per scope in a for-of loop", () => {
    expect(handler).toMatch(
      /Promise\.all\(\s*scopes\.slice\(i, i \+ SCOPE_CHUNK\)/,
    );
    expect(handler).not.toMatch(/for \(const scope of scopes\)/);
  });
  it("still skips failing scopes and only lists non-ready ones", () => {
    expect(handler).toMatch(/catch \{\s*return null;/);
    expect(handler).toMatch(/rec && rec\.readiness_status !== "ready"/);
  });
});
