/**
 * A candidate that does not exist is a 404, not a server fault.
 *
 * atsService.getCandidate threw a bare Error("Candidate not found") with no
 * statusCode. Both error paths in this codebase — the global errorHandler and
 * the per-router getErrorStatus helpers — read `statusCode` off the error and
 * fall back to 500 when it is absent, so an ordinary missing row surfaced as
 * "An unexpected server error occurred".
 *
 * Observed on production 2026-07-31:
 *   POST /api/ats/onboarding/send-token/00000000-0000-0000-0000-000000000000
 *   -> 500 {"success":false,"message":"An unexpected server error occurred"}
 * which is misleading for the caller and pages an on-call engineer for a typo.
 * Ten call sites go through getCandidate, so all of them behaved this way.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const atsService = read("src/modules/ats/ats.service.ts");
const errorHandler = read("src/middleware/errorHandler.ts");
const recruiterRoutes = read("src/modules/ats/recruiter-hiring.routes.ts");

describe("candidate lookup — missing row is a 404", () => {
  it("getCandidate tags the error with a 404 status", () => {
    const fn = atsService.slice(atsService.indexOf("async getCandidate("));
    expect(fn).toContain('Object.assign(new Error("Candidate not found"), { statusCode: 404 })');
  });

  it("does not throw a bare Error, which would fall through to 500", () => {
    const fn = atsService.slice(
      atsService.indexOf("async getCandidate("),
      atsService.indexOf("async getCandidate(") + 900,
    );
    expect(fn).not.toMatch(/throw new Error\("Candidate not found"\)/);
  });
});

describe("candidate lookup — the status actually reaches the client", () => {
  it("the global error handler honours a 4xx statusCode", () => {
    expect(errorHandler).toContain("statusCode >= 400 && statusCode < 500");
    expect(errorHandler).toContain("res.status(statusCode)");
  });

  it("the ats routers' getErrorStatus honours it too, defaulting to 500", () => {
    expect(recruiterRoutes).toContain('"statusCode" in error');
    expect(recruiterRoutes).toContain("fallback = 500");
  });
});
