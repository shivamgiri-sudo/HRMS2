import { describe, expect, it } from "vitest";
// Plain .mjs script with no type declarations. It needed a @ts-expect-error until the app
// tsconfig started resolving it; the directive then became an error in its own right
// ("Unused '@ts-expect-error'"), so it is a plain comment now.
import { assessDeletions, OVERRIDE_MARKER, BULK_DELETION_LIMIT } from "../../scripts/guard-mass-deletion.mjs";

/**
 * Modelled on what actually happened on 31 July 2026.
 *
 * 9cb198b2 was titled "fix(budget): normalise copy-forward key to match API
 * snake_case vs camelCase" and contained no budget file — 38 files, 1,855
 * deletions, taking four test suites and four SQL migrations with it. Branch
 * protection would not have stopped it: it was an ordinary push, not a
 * force-push. What stops it is noticing a commit deleted things it never
 * mentioned.
 */

const del = (path: string) => ({ status: "D", path });
const mod = (path: string) => ({ status: "M", path });

describe("mass deletion guard", () => {
  it("passes a commit that deletes nothing", () => {
    const v = assessDeletions([mod("src/app.ts"), mod("README.md")], "chore: tidy");
    expect(v.ok).toBe(true);
    expect(v.deleted).toEqual([]);
  });

  it("blocks the real 9cb198b2 shape — a budget message deleting tests and migrations", () => {
    const v = assessDeletions(
      [
        del("backend/tests/payroll-notifications.test.ts"),
        del("backend/tests/exit-notifications.test.ts"),
        del("backend/tests/attendance-notifications.test.ts"),
        del("backend/sql/1030_statutory_config_versioning.sql"),
        mod("src/pages/NativePayslipCenter.tsx"),
      ],
      "fix(budget): normalise copy-forward key to match API snake_case vs camelCase",
    );

    expect(v.ok).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/test suite/);
    expect(v.reasons.join(" ")).toMatch(/SQL migration/);
    // Every offending file is named, so the fix is obvious from the CI log.
    expect(v.protectedHits.map((h: { path: string }) => h.path)).toContain(
      "backend/sql/1030_statutory_config_versioning.sql",
    );
  });

  it("blocks a single deleted test suite, not just a bulk sweep", () => {
    // d2bdc31e removed one ownership check; small deletions matter too.
    const v = assessDeletions([del("backend/tests/payroll.security.test.ts")], "fix(access): tidy routes");
    expect(v.ok).toBe(false);
    expect(v.reasons).toHaveLength(1);
  });

  it("blocks deleting a CI workflow", () => {
    const v = assessDeletions([del(".github/workflows/ci.yml")], "chore: cleanup");
    expect(v.ok).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/CI workflow/);
  });

  it("blocks a bulk deletion even when nothing protected is hit", () => {
    const many = Array.from({ length: BULK_DELETION_LIMIT + 1 }, (_, i) => del(`src/legacy/file${i}.ts`));
    const v = assessDeletions(many, "refactor: remove legacy");
    expect(v.ok).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/over the limit/);
  });

  it("allows a bulk deletion at the limit", () => {
    const some = Array.from({ length: BULK_DELETION_LIMIT }, (_, i) => del(`src/legacy/file${i}.ts`));
    const v = assessDeletions(some, "refactor: remove legacy");
    expect(v.ok).toBe(true);
  });

  it("allows anything when the commit says so", () => {
    // The guard makes the decision visible; it does not overrule a human who
    // has stated the intent.
    const v = assessDeletions(
      [del("backend/tests/payroll-notifications.test.ts"), del("backend/sql/1030_x.sql")],
      `chore: retire the notification pilot ${OVERRIDE_MARKER}`,
    );
    expect(v.ok).toBe(true);
    expect(v.reasons).toEqual([]);
  });

  it("finds the marker anywhere in a multi-commit range", () => {
    const v = assessDeletions(
      [del("backend/tests/a.test.ts")],
      `fix: something\n\nfix: another\n\nchore: remove pilot ${OVERRIDE_MARKER}\n`,
    );
    expect(v.ok).toBe(true);
  });

  it("ignores non-deletions entirely", () => {
    const v = assessDeletions(
      [mod("backend/tests/payroll.security.test.ts"), mod("backend/sql/1030_x.sql")],
      "fix: edit tests and migration",
    );
    expect(v.ok).toBe(true);
  });
});
