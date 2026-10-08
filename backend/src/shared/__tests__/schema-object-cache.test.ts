/**
 * Knowingly-absent schema objects should not be queried on every request.
 *
 * Three governance tiles query objects this schema does not have
 * (policy_acknowledgement, performance_appraisal, auth_user.two_fa_enabled).
 * They are correctly guarded, so the tiles read "unavailable" — but each load
 * fired a doomed query, and db/mysql.ts logs every schema error on purpose.
 * On 2026-08-08 that was 28 of ~50 errors in the production window, sitting in
 * the same log as a live ER_TRUNCATED_WRONG_VALUE from a real onboarding
 * failure. The volume is what made the real one easy to miss.
 *
 * The behaviour that must NOT change is the fallback VALUE: null renders as
 * "unavailable", whereas 0 renders as "no pending policy acknowledgements" — a
 * compliance all-clear produced by a query that never ran.
 */
import { describe, expect, it, vi } from "vitest";
import { ifObjectExists } from "../schema-object-cache.js";

describe("ifObjectExists", () => {
  it("runs the query when the object is present", async () => {
    const run = vi.fn().mockResolvedValue("real result");
    await expect(ifObjectExists(true, run, "fallback")).resolves.toBe("real result");
    expect(run).toHaveBeenCalledOnce();
  });

  it("does NOT run the query when the object is absent", async () => {
    const run = vi.fn().mockResolvedValue("real result");
    await expect(ifObjectExists(false, run, "fallback")).resolves.toBe("fallback");
    expect(run, "a doomed query was still issued").not.toHaveBeenCalled();
  });

  it("accepts a promised presence check", async () => {
    const run = vi.fn().mockResolvedValue("real result");
    await expect(ifObjectExists(Promise.resolve(false), run, "fallback")).resolves.toBe("fallback");
    expect(run).not.toHaveBeenCalled();
  });

  it("returns the caller's shape, so the tile still reads 'unavailable'", async () => {
    // The management tiles destructure [[{ count }]]. Returning 0 here instead
    // of null would turn "unavailable" into a false all-clear.
    const absent = [[{ count: null }]];
    const result = await ifObjectExists<any>(false, async () => [[{ count: 5 }]], absent);
    expect(result[0][0].count).toBeNull();
    expect(result[0][0].count).not.toBe(0);
  });
});

describe("management.service call sites", () => {
  it("guards all three known-absent objects and keeps the null fallbacks", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const { fileURLToPath } = await import("url");
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(
      path.resolve(dir, "../../modules/management/management.service.ts"),
      "utf8",
    );

    // Each guarded block must still carry a NULL-shaped absent value and keep
    // its .catch safety net. Asserted per site rather than file-wide: other
    // tiles legitimately fall back to 0 — expense_claim is a real table where
    // "no pending claims" is a true answer, not an unavailable one.
    for (const [guard, shape] of [
      ['tableExists("policy_acknowledgement")', "count: null"],
      ['tableExists("performance_appraisal")', "completion_pct: null"],
      ['columnExists("auth_user", "two_fa_enabled")', "count: null"],
    ]) {
      const at = src.indexOf(guard);
      expect(at, `${guard} not wired up`).toBeGreaterThan(-1);
      const block = src.slice(at, at + 900);
      expect(block, `${guard} lost its null fallback`).toContain(shape);
      expect(block, `${guard} lost its .catch safety net`).toContain(".catch(");
      expect(block, `${guard} must not report 0`).not.toMatch(/count: 0|completion_pct: 0/);
    }
  });
});
