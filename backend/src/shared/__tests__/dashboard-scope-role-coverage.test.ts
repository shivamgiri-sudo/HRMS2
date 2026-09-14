import { describe, it, expect } from "vitest";

import { resolvePrimaryRole } from "../roleResolver.js";
import { DASHBOARD_ACCESS_REGISTRY, normalizeDashboardRole } from "../dashboardAccessRegistry.js";
import { SCOPE_BEARING_ROLES } from "../dashboardScope.js";

/**
 * Three lists have to agree or a role silently loses its data scope:
 *
 *   1. DASHBOARD_ACCESS_REGISTRY[*].allowedRoleKeys — who may open a dashboard
 *   2. dashboardScope's role sets                   — how wide that user's rows are
 *   3. roleResolver's ROLE_PRIORITY                 — which single role decides (2)
 *
 * They drifted, and the failure was silent in both directions. A role in (1) and (2) but
 * missing from (3) scores 0 there, loses to `employee` (10) — which every real account
 * also holds — and resolves to SELF_ONLY: on 2026-08-28 all four IT accounts opened the
 * IT Manager dashboard and read a headcount of 1. A role in (1) and (3) but missing from
 * (2) falls through the whole ladder to the same SELF_ONLY default at the bottom.
 *
 * Neither shape throws, logs, or renders an error — the tiles just quietly count one
 * person. These assertions are the only thing that makes the drift visible.
 */

const registryRoles = [
  ...new Set(
    Object.values(DASHBOARD_ACCESS_REGISTRY)
      .flatMap((definition) => definition.allowedRoleKeys)
      .map((role) => normalizeDashboardRole(role)),
  ),
];

/**
 * EMPLOYEE_SELF_DASHBOARD deliberately admits nearly every role in the platform — it is a
 * personal dashboard, and resolveSelfOnlyDashboardScope bypasses the role ladder entirely
 * for it. Roles that appear ONLY there therefore need no scope tier of their own.
 */
const operationalRoles = registryRoles.filter((role) =>
  Object.values(DASHBOARD_ACCESS_REGISTRY).some(
    (definition) =>
      definition.code !== "EMPLOYEE_SELF_DASHBOARD" &&
      definition.allowedRoleKeys.some((allowed) => normalizeDashboardRole(allowed) === role),
  ),
);

describe("dashboard scope role coverage", () => {
  it("every role admitted to an operational dashboard carries a scope tier", () => {
    const missing = operationalRoles.filter((role) => !SCOPE_BEARING_ROLES.has(role));
    expect(missing, `roles with no tier in dashboardScope.ts — these resolve to SELF_ONLY`).toEqual([]);
  });

  it("no scope-bearing role loses primaryRole to plain employee", () => {
    // The exact comparison that broke: every real account holds `employee` alongside its
    // privileged role, so a role absent from ROLE_PRIORITY is beaten by employee's 10.
    //
    // `agent` and `trainee` are excluded on purpose. They rank 9 and 8 — below employee —
    // and that is correct: they are SELF_ONLY peers, so losing to employee resolves them
    // to the same tier they were already headed for. Every other role in the union is
    // asking for a wider scope than employee and must therefore outrank it.
    const demoted = [...SCOPE_BEARING_ROLES].filter(
      (role) =>
        !["employee", "agent", "trainee"].includes(role) &&
        resolvePrimaryRole([role, "employee"]) === "employee",
    );
    expect(demoted, "roles missing from ROLE_PRIORITY in roleResolver.ts").toEqual([]);
  });

  it("a role never loses primaryRole to a role of its own tier or lower", () => {
    // it + branch_it must not flip to branch_it's tier being irrelevant, and more
    // importantly a head-office role must beat the process-tier role it commonly co-holds.
    expect(resolvePrimaryRole(["it_head", "employee"])).toBe("it_head");
    expect(resolvePrimaryRole(["it", "employee"])).toBe("it");
    expect(resolvePrimaryRole(["tq_head", "qa_manager", "employee"])).toBe("tq_head");
    expect(resolvePrimaryRole(["tq_head", "quality_analyst", "employee"])).toBe("tq_head");
    expect(resolvePrimaryRole(["branch_admin", "employee"])).toBe("branch_admin");
    expect(resolvePrimaryRole(["operations_manager", "employee"])).toBe("operations_manager");
  });
});
