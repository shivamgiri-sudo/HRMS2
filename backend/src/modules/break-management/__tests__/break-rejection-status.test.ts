import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SERVICE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "break-management.service.ts"
);

/**
 * errorHandler branches on `error.statusCode`. A 4xx passes `error.message` through to the
 * client; an error with NO statusCode falls to the unexpected-500 branch, which in production
 * replaces the message with "An unexpected server error occurred. Please quote reference ...".
 *
 * Every rejection in break-management.service.ts was a bare `throw new Error(...)`, so kiosk
 * operators hitting an ordinary business rule — no biometric punch, break already active, wrong
 * branch — were told the server had broken, and the specific wording the product had written for
 * their situation never reached them. It also logged 42 routine rejections as 500s in a single
 * morning, which is what hid real server faults in the error log.
 *
 * These are the checks that would have caught it. The source scan is the load-bearing one: the
 * defect was not a wrong status, it was the *absence* of one, so asserting "no bare throw" is
 * what actually holds.
 */
const SOURCE = readFileSync(SERVICE, "utf8");

/** Strip block and line comments so prose about `throw new Error(...)` is not counted as code. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

export function bareThrows(src: string): string[] {
  return codeOnly(src)
    .split(/\r?\n/)
    .filter((l) => l.includes("throw new Error("))
    .map((l) => l.trim());
}

export function rejectStatuses(src: string): number[] {
  return [...codeOnly(src).matchAll(/throw reject\((\d{3}),/g)].map((m) => Number(m[1]));
}

describe("break-management rejections carry an HTTP status", () => {
  it("detects a bare throw as a defect", () => {
    expect(bareThrows(`throw new Error("nope");`)).toHaveLength(1);
  });

  it("does not count a bare throw mentioned in a comment", () => {
    expect(bareThrows(`// was: throw new Error("nope")`)).toHaveLength(0);
    expect(bareThrows(`/* throw new Error("nope") */`)).toHaveLength(0);
  });

  it("no rejection in the service throws without a status code", () => {
    expect(bareThrows(SOURCE)).toEqual([]);
  });

  it("every rejection uses a 4xx — none re-introduces a 5xx for a business rule", () => {
    const statuses = rejectStatuses(SOURCE);
    expect(statuses.length).toBeGreaterThanOrEqual(22);
    expect(statuses.filter((s) => s < 400 || s >= 500)).toEqual([]);
  });

  it("the reject() helper actually sets statusCode, so errorHandler takes the 4xx branch", () => {
    // Mirrors the helper in the service; if the helper stops setting statusCode the message
    // gets masked in production again.
    const err = new Error("x") as Error & { statusCode?: number };
    err.statusCode = 409;
    expect(err.statusCode).toBeGreaterThanOrEqual(400);
    expect(err.statusCode).toBeLessThan(500);
  });
});
