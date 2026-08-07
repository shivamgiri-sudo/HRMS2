import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  globToRegExp,
  matchGlob,
  matchTablePattern,
  readControlPlaneFile,
  repoRoot,
} from "../control-plane.js";
import { hitsForPath, loadProtectedPaths, pathTierFor } from "../protected-paths.js";
import { capabilityClassFor, loadCapabilityRegistry } from "../capability-registry.js";
import type { CapabilityRegistryFile, ProtectedPathsFile } from "../uat-pipeline.types.js";

/**
 * The control plane decides whether the AI is allowed to touch a file. If it drifts from
 * reality — a rule pointing at a renamed file, a capability with no detection signal, a
 * keyword that does not compile — it fails OPEN, silently, and nobody notices until
 * something edits payroll. These tests are the thing that notices.
 */

describe("control plane — protected-paths.json", () => {
  const { rules } = loadProtectedPaths();

  it("the typed wrapper reads the same bytes as the JSON on disk", () => {
    const onDisk = JSON.parse(
      readFileSync(join(repoRoot(), "uat", "protected-paths.json"), "utf8")
    ) as ProtectedPathsFile;
    expect(rules).toEqual(onDisk.rules);
  });

  it("every non-glob path still exists on disk", () => {
    // A rename that silently voids a rule is the failure this catches. Glob patterns are
    // exempt because they legitimately describe files that do not exist yet.
    const missing = rules
      .filter((r) => !/[*?]/.test(r.pattern))
      .filter((r) => !existsSync(join(repoRoot(), r.pattern)))
      .map((r) => r.pattern);
    expect(
      missing,
      `these protected paths no longer exist, so their rule protects nothing:\n  ${missing.join("\n  ")}`
    ).toEqual([]);
  });

  it("every rule carries a tier, a category and a non-empty reason", () => {
    for (const r of rules) {
      expect(["deny", "review"], `bad tier on ${r.pattern}`).toContain(r.tier);
      expect(
        ["business-critical", "control-plane", "domain-owned"],
        `bad category on ${r.pattern}`
      ).toContain(r.category);
      expect(r.reason?.trim(), `rule ${r.pattern} has no reason`).toBeTruthy();
    }
  });

  it("the deny tier is non-empty and covers the known high-blast-radius inventory", () => {
    const deny = rules.filter((r) => r.tier === "deny");
    expect(deny.length).toBeGreaterThan(0);

    // One representative file per catastrophic domain. If a future edit drops the rule that
    // covers one of these, this fails rather than the pipeline quietly gaining write access.
    const mustBeDenied = [
      "backend/src/modules/payroll/payrollCalculate.service.ts",
      "backend/src/modules/payroll-compliance/payrollCalculate.service.ts",
      "backend/src/modules/ats/salary.calculator.ts",
      "backend/src/workers/all-workers.ts",
      "backend/src/middleware/requireRole.ts",
      "backend/src/modules/auth/auth.service.ts",
      "backend/src/shared/rbacPageMatrix.ts",
      "src/lib/rbacPageMatrix.ts",
      "backend/src/db/runPendingMigrations.ts",
      "backend/sql/1095_uat_feedback_intake.sql",
      "backend/src/config/env.ts",
      "backend/src/modules/exit/ff.service.ts",
      "backend/src/modules/finance/vendor-payment.service.ts",
      "backend/src/modules/wfm/cosec-sync.service.ts",
      "backend/src/app.ts",
    ];
    for (const f of mustBeDenied) {
      expect(pathTierFor(hitsForPath(f, rules)), `${f} must be deny-tier`).toBe("deny");
    }
  });

  it("protects its own control plane, so the pipeline cannot edit its own guardrails", () => {
    const selfProtected = [
      "uat/protected-paths.json",
      "uat/capability-registry.json",
      "backend/src/modules/uat-pipeline/uat-static-scan.service.ts",
      "backend/scripts/guard-mass-deletion.mjs",
      "backend/scripts/uat-check-diff.mjs", // Phase 4; the rule must already exist
      "backend/scripts/check-test-baseline.mjs",
      ".github/workflows/uat-build.yml",     // Phase 4; likewise
      "backend/src/modules/uat-pipeline/__tests__/uat-state-machine.test.ts",
    ];
    for (const f of selfProtected) {
      expect(pathTierFor(hitsForPath(f, rules)), `${f} must be deny-tier`).toBe("deny");
    }
  });

  it("does not accidentally deny ordinary UI work", () => {
    for (const f of [
      "src/components/ui/button.tsx",
      "src/pages/NativeVisitorManagement.tsx",
      "backend/src/modules/visitor/visitor.service.ts",
    ]) {
      expect(pathTierFor(hitsForPath(f, rules)), `${f} should not be blocked`).not.toBe("deny");
    }
  });
});

describe("control plane — capability-registry.json", () => {
  const { capabilities } = loadCapabilityRegistry();

  it("the typed wrapper reads the same bytes as the JSON on disk", () => {
    const onDisk = JSON.parse(
      readFileSync(join(repoRoot(), "uat", "capability-registry.json"), "utf8")
    ) as CapabilityRegistryFile;
    expect(capabilities).toEqual(onDisk.capabilities);
  });

  it("every capability has a class, a reason and at least one detection signal", () => {
    for (const c of capabilities) {
      expect(
        ["DENY", "HIGH_REVIEW", "REVIEW", "STANDARD", "TRIVIAL"],
        `bad class on ${c.key}`
      ).toContain(c.class);
      expect(c.reason?.trim(), `capability ${c.key} has no reason`).toBeTruthy();
      const signals =
        (c.paths?.length ?? 0) + (c.tables?.length ?? 0) + (c.keywords?.length ?? 0);
      expect(signals, `capability ${c.key} can never fire: no path, table or keyword`).toBeGreaterThan(0);
    }
  });

  it("every keyword compiles as a regular expression", () => {
    for (const c of capabilities) {
      for (const k of c.keywords ?? []) {
        expect(() => new RegExp(k, "i"), `capability ${c.key} keyword ${k}`).not.toThrow();
      }
    }
  });

  it("every REVIEW-or-worse capability names the approver roles it requires", () => {
    for (const c of capabilities) {
      if (c.class === "REVIEW" || c.class === "HIGH_REVIEW") {
        expect(
          c.requiredApproverRoles?.length ?? 0,
          `${c.key} is ${c.class} but names no approver role, so nothing would gate it`
        ).toBeGreaterThan(0);
      }
    }
  });

  it("every mandatory test file it names actually exists", () => {
    for (const c of capabilities) {
      for (const t of c.mandatoryTests ?? []) {
        expect(
          existsSync(join(repoRoot(), t)),
          `capability ${c.key} requires ${t}, which does not exist`
        ).toBe(true);
      }
    }
  });

  it("keeps a DENY capability for each domain that must never be automated", () => {
    const denyKeys = capabilities.filter((c) => c.class === "DENY").map((c) => c.key);
    for (const k of ["payroll_calculation", "auth_rbac", "finance_payment", "attendance_classification"]) {
      expect(denyKeys, `${k} must remain DENY`).toContain(k);
    }
  });

  it("HIGH_REVIEW outranks REVIEW when both match", () => {
    const worst = capabilityClassFor([
      { class: "REVIEW" } as never,
      { class: "HIGH_REVIEW" } as never,
    ]);
    expect(worst).toBe("HIGH_REVIEW");
  });
});

describe("control plane — glob matching", () => {
  it("** spans directory separators, * does not", () => {
    expect(matchGlob("backend/src/modules/payroll/**", "backend/src/modules/payroll/a/b/c.ts")).toBe(true);
    expect(matchGlob("backend/scripts/uat-*.mjs", "backend/scripts/uat-check-diff.mjs")).toBe(true);
    expect(matchGlob("backend/scripts/uat-*.mjs", "backend/scripts/nested/uat-x.mjs")).toBe(false);
  });

  it("**/ also matches zero directories", () => {
    expect(matchGlob("**/uat-*.test.ts", "uat-a.test.ts")).toBe(true);
    expect(matchGlob("**/uat-*.test.ts", "backend/src/x/__tests__/uat-a.test.ts")).toBe(true);
  });

  it("matches backend/src/**/*.cron.ts at any depth", () => {
    expect(matchGlob("backend/src/**/*.cron.ts", "backend/src/cron/business-action-sync.cron.ts")).toBe(true);
    expect(matchGlob("backend/src/**/*.cron.ts", "backend/src/modules/wfm/attendance-engine.cron.ts")).toBe(true);
    expect(matchGlob("backend/src/**/*.cron.ts", "backend/src/modules/wfm/attendance-engine.service.ts")).toBe(false);
  });

  it("normalises Windows separators so a rule written with / still matches", () => {
    expect(matchGlob("backend/sql/**", "backend\\sql\\1095_uat_feedback_intake.sql")).toBe(true);
  });

  it("escapes regex metacharacters in literal path segments", () => {
    expect(globToRegExp("a.b.ts").test("axbyts")).toBe(false);
    expect(globToRegExp("a.b.ts").test("a.b.ts")).toBe(true);
  });

  it("table patterns are case-insensitive and anchored", () => {
    expect(matchTablePattern("payroll_*", "payroll_run")).toBe(true);
    expect(matchTablePattern("payroll_*", "PAYROLL_RUN")).toBe(true);
    expect(matchTablePattern("payroll_*", "x_payroll_run")).toBe(false);
    expect(matchTablePattern("employees", "employees")).toBe(true);
  });
});

describe("control plane — fails loud, never open", () => {
  it("refuses to read a control-plane file that is missing", () => {
    expect(() => readControlPlaneFile("does-not-exist.json")).toThrow(/Cannot read control-plane file/);
  });
});
