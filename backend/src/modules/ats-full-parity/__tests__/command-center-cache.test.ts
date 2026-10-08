import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMMAND_CENTER_TTL_MS,
  commandCenterCache,
  commandCenterCacheKey,
  pruneCommandCenterCache,
} from "../commandCenterCache.js";

/**
 * /api/ats-full-parity/command-center reads up to 25,000 candidate rows and took 43 s on production
 * 2026-09-30, past the browser's 30 s abort; the abort does not stop the query so each retry started
 * another. Identical requests now share one computation and a finished one is reused for 30 s. The
 * key MUST include the actor and scope: this endpoint is scope-filtered per user.
 */
describe("commandCenterCacheKey", () => {
  const q = { period: "ALL", branch: "NOIDA" };

  it("is identical for the same actor, scope and filters regardless of query-key order", () => {
    expect(commandCenterCacheKey("u1", false, { period: "ALL", branch: "NOIDA" }))
      .toBe(commandCenterCacheKey("u1", false, { branch: "NOIDA", period: "ALL" }));
  });

  it("differs per actor, so one user's scoped result is never served to another", () => {
    expect(commandCenterCacheKey("u1", false, q)).not.toBe(commandCenterCacheKey("u2", false, q));
  });

  it("differs when scope bypass differs", () => {
    expect(commandCenterCacheKey("u1", true, q)).not.toBe(commandCenterCacheKey("u1", false, q));
  });

  it("differs when any filter differs", () => {
    expect(commandCenterCacheKey("u1", false, q)).not.toBe(commandCenterCacheKey("u1", false, { ...q, branch: "PUNE" }));
    expect(commandCenterCacheKey("u1", false, q)).not.toBe(commandCenterCacheKey("u1", false, { period: "ALL" }));
  });

  it("an unauthenticated actor never collides with a real one", () => {
    expect(commandCenterCacheKey(undefined, false, q)).not.toBe(commandCenterCacheKey("u1", false, q));
  });
});

describe("cache bounds", () => {
  it("keeps the newest entries when it grows past its cap", () => {
    commandCenterCache.clear();
    for (let i = 0; i < 260; i++) commandCenterCache.set(`k${i}`, { at: i, value: { i } });
    pruneCommandCenterCache();
    expect(commandCenterCache.size).toBe(200);
    expect(commandCenterCache.has("k259")).toBe(true);
    expect(commandCenterCache.has("k0")).toBe(false);
    commandCenterCache.clear();
  });

  it("uses a short TTL", () => {
    expect(COMMAND_CENTER_TTL_MS).toBeLessThanOrEqual(60_000);
  });
});

describe("route wiring", () => {
  const src = readFileSync(resolve(process.cwd(), "src/modules/ats-full-parity/atsFullParity.routes.ts"), "utf8");
  const start = src.indexOf('"/command-center"');
  const body = src.slice(start, src.indexOf("}));", start));

  it("keys on the actor and scope, shares in-flight work and never caches failures", () => {
    expect(body).toMatch(/commandCenterCacheKey\(actorId, bypassScope, query\)/);
    expect(body).toMatch(/sharedInFlight\(key/);
    // the cache write happens only after the service call resolves
    expect(body.indexOf("await svc.commandCenterData")).toBeLessThan(body.indexOf("commandCenterCache.set"));
  });

  it("still forwards the same actorId / bypassScope to the service", () => {
    expect(body).toMatch(/svc\.commandCenterData\(\{ \.\.\.query, actorId, bypassScope \}\)/);
  });
});
