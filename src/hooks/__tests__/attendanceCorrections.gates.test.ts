import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * The UI gate and the API gate must name the same roles.
 *
 * A role shown a Discard button that the API refuses gets a 403 on a reversal it was
 * invited to make; a role the API would allow but the UI hides has a capability nobody can
 * reach — which is exactly how /api/attendance/manual-overrides sat at 0 rows for months
 * while being fully built. Both directions are silent, so they are pinned here.
 *
 * Source-text assertions rather than imports: the backend gate is an Express middleware
 * chain that cannot be imported into the frontend test project, and this file has no jsdom
 * to render the hooks in. Same idiom as useDiscard.queryKeys.test.ts.
 */

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

const CORRECTIONS_HOOK = read("../useAttendanceCorrections.ts");
const DISCARD_HOOK = read("../useDiscard.ts");
const DISCARD_ROUTES = read("../../../backend/src/modules/discard/discard.routes.ts");
const EXCEPTION_ROUTES = read("../../../backend/src/modules/wfm/attendance-exceptions.routes.ts");

describe("attendance correction gates", () => {
  it("offers attendance status changes to payroll_head and super_admin only", () => {
    const fn = CORRECTIONS_HOOK.slice(CORRECTIONS_HOOK.indexOf("export function useCanCorrectAttendance"));
    expect(fn).toContain('r === "super_admin"');
    expect(fn).toContain('r === "payroll_head"');
    // The API also admits payroll_admin and admin. The business asked for two roles, so
    // the page must not surface the other two just because the endpoint would honour them.
    expect(fn).not.toContain('r === "payroll_admin"');
    expect(fn).not.toContain('r === "admin"');
  });

  it("keeps the discard button in step with the discard API's own gate", () => {
    const uiRoles = ["super_admin", "wfm", "payroll_head"];
    const fn = DISCARD_HOOK.slice(DISCARD_HOOK.indexOf("export function useCanDiscard"));
    for (const role of uiRoles) expect(fn).toContain(`r === "${role}"`);

    const gate = DISCARD_ROUTES.match(/const discardGate = \[[^\]]*\]/)?.[0] ?? "";
    expect(gate).toBeTruthy();
    for (const role of uiRoles) expect(gate).toContain(`"${role}"`);
  });

  it("restricts exception resolve/reopen to super_admin and payroll_head", () => {
    expect(EXCEPTION_ROUTES).toContain("const RESOLVE_ROLES = ['super_admin', 'payroll_head'] as const;");
    // Both writes use RESOLVE_ROLES, never the far wider VIEW_ROLES.
    const resolveRoute = EXCEPTION_ROUTES.slice(EXCEPTION_ROUTES.indexOf("'/:id/resolve'"));
    expect(resolveRoute).toContain("requireRole(...RESOLVE_ROLES)");
    expect(resolveRoute).not.toContain("requireRole(...VIEW_ROLES)");
  });

  it("reads exceptions from the store that actually has rows", () => {
    // attendance_reconciliation_issue (18,038 rows) via /api/wfm/attendance-exceptions —
    // NOT /api/attendance/exception-engine, whose `attendance_exception` table has never
    // held a single row and would render an Exceptions tab that is empty for everybody.
    expect(CORRECTIONS_HOOK).toContain("/api/wfm/attendance-exceptions");
    expect(CORRECTIONS_HOOK).not.toContain("/api/attendance/exception-engine?");
  });
});
