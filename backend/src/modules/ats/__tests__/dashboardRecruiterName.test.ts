import { describe, expect, it, vi } from "vitest";
import { recruiterNameSql } from "../dashboard.scope.js";

describe("recruiterNameSql", () => {
  it("falls back to recruiter_assigned_name when recruiter_name is blank", () => {
    expect(recruiterNameSql()).toBe(
      "COALESCE(NULLIF(TRIM(recruiter_name), ''), NULLIF(TRIM(recruiter_assigned_name), ''))",
    );
  });

  it("qualifies both columns with the table alias", () => {
    const sql = recruiterNameSql("c");
    expect(sql).toContain("c.recruiter_name");
    expect(sql).toContain("c.recruiter_assigned_name");
    expect(sql).not.toMatch(/[^.]recruiter_name/);
  });
});

import { BRANCH_EXPR } from "../dashboard.overview.service.js";

describe("BRANCH_EXPR", () => {
  it("resolves a branch id stored in applied_for_branch before falling back to the raw value", () => {
    const lookup = BRANCH_EXPR.indexOf("FROM branch_master");
    const raw = BRANCH_EXPR.indexOf("NULLIF(applied_for_branch,'')");
    expect(lookup).toBeGreaterThan(-1);
    expect(lookup).toBeLessThan(raw);
    expect(BRANCH_EXPR.startsWith("COALESCE(NULLIF(branch_display_name,'')")).toBe(true);
    expect(BRANCH_EXPR.endsWith("'Unspecified')")).toBe(true);
  });
});

describe("legacy-import label helpers", () => {
  it("fall back to the plain expressions until the tag table is known to exist", async () => {
    vi.resetModules();
    const scope = await import("../dashboard.scope.js");
    expect(scope.legacyImportSql("c")).toBe("0");
    expect(scope.sourceValueSql("c")).toBe("c.sourcing_channel");
    expect(scope.recruiterLabelSql("c")).toBe(scope.recruiterNameSql("c"));
  });

  it("label tagged rows once the table exists", async () => {
    vi.resetModules();
    vi.doMock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(async () => [[{ 1: 1 }], []]) } }));
    const scope = await import("../dashboard.scope.js");
    await scope.refreshImportTag();
    expect(scope.legacyImportSql("c")).toContain("ats_candidate_import_tag");
    expect(scope.sourceValueSql("c")).toContain("'Legacy import'");
    expect(scope.recruiterLabelSql("c")).toContain("'Legacy import'");
    vi.doUnmock("../../../db/mysql.js");
  });
});
