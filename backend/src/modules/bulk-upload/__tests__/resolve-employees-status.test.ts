/**
 * Which employees a bulk upload may name.
 *
 * This gate was `employment_status = 'active'`, then briefly a denylist of
 * ('Resigned','terminated'). Both were wrong, because that column does not describe reality
 * in either direction. Counted live 2026-09-02, with attendance in the preceding 90 days:
 *
 *     status       employees   still attending
 *     Active           1,115             1,112
 *     inactive        27,052               586
 *     Resigned        30,309               195
 *     terminated         499                38
 *
 * 'inactive' holds 586 people who are at work — the bug HR hit, where 86 rows of
 * BATCH-1788287542227 were refused as "not active" for employees recording 43-45 attendance
 * days in the previous 60. 'Resigned' and 'terminated' hold another 233 still attending, whom
 * a denylist would have gone on refusing. Nothing corroborates any status: `date_of_leaving`
 * is NULL for 30,307 of the 30,309 Resigned, and the exit tables hold 8 rows against ~57,000
 * supposed leavers.
 *
 * So the rule is attendance activity, with status only as a fast path for 'active'. These
 * tests pin both directions: someone still attending is admitted whatever their flag says,
 * and someone with no recent attendance is refused whatever their flag says.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: vi.fn() } }));
vi.mock("../../../shared/scopeAccess.js", () => ({
  hasAnyRole: vi.fn(),
  hasScopedAccess: vi.fn(),
}));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
vi.mock("../../communication/email.service.js", () => ({ emailService: {} }));

const { resolveEmployees } = await import("../bulk-approval.service.js");

/**
 * Stands in for `employees` LEFT JOIN recent attendance. `attending` is what the EXISTS
 * subquery would find.
 */
const TABLE = [
  { employee_code: "ACTIVE_ATT", employment_status: "Active", attending: true },
  { employee_code: "ACTIVE_NOATT", employment_status: "Active", attending: false },
  { employee_code: "INACTIVE_ATT", employment_status: "inactive", attending: true },
  { employee_code: "INACTIVE_NOATT", employment_status: "inactive", attending: false },
  { employee_code: "RESIGNED_ATT", employment_status: "Resigned", attending: true },
  { employee_code: "RESIGNED_NOATT", employment_status: "Resigned", attending: false },
  { employee_code: "TERMINATED_ATT", employment_status: "terminated", attending: true },
  { employee_code: "NULLSTATUS_NOATT", employment_status: null, attending: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  execute.mockImplementation(async (_sql: string, params: unknown[]) => {
    // Trailing parameter is the activity window; everything before it is the code list.
    const codes = (params as unknown[]).slice(0, -1) as string[];
    const rows = TABLE
      .filter((r) => codes.includes(r.employee_code))
      // The predicate the SQL expresses: active by status, OR seen in attendance recently.
      .filter((r) => String(r.employment_status ?? "").toLowerCase() === "active" || r.attending)
      .map((r) => ({
        id: `id-${r.employee_code}`,
        employee_code: r.employee_code,
        branch_id: "b1", process_id: "p1", first_name: "A", last_name: "B",
      }));
    return [rows, []];
  });
});

const resolve = async (code: string) => (await resolveEmployees([code])).get(code);

describe("resolveEmployees — who may appear in a batch", () => {
  it("admits an inactive employee who is still attending", async () => {
    // The reported bug: 86 rows of BATCH-1788287542227, every one of them this case.
    expect(await resolve("INACTIVE_ATT")).toBeDefined();
  });

  it("admits a resigned employee who is still attending", async () => {
    // 195 live employees are in this state. A status denylist refused them; attendance
    // says they are still coming to work, so a correction for them is legitimate.
    expect(await resolve("RESIGNED_ATT")).toBeDefined();
  });

  it("admits a terminated employee who is still attending", async () => {
    expect(await resolve("TERMINATED_ATT")).toBeDefined();
  });

  it("admits an active employee even with no attendance rows", async () => {
    // A joiner whose first attendance has not been written yet must not be locked out.
    expect(await resolve("ACTIVE_NOATT")).toBeDefined();
  });

  it("refuses an inactive employee with no recent attendance", async () => {
    // 26,466 employees are in this state. Admitting them was the flaw in the denylist.
    expect(await resolve("INACTIVE_NOATT")).toBeUndefined();
  });

  it("refuses a resigned employee with no recent attendance", async () => {
    expect(await resolve("RESIGNED_NOATT")).toBeUndefined();
  });

  it("refuses an employee with no status and no attendance", async () => {
    // A NULL status is an unknown, not an assertion of employment, so it clears the same
    // evidence bar as any other non-active value. `NULL OR FALSE` is NULL, so the row is
    // excluded — which is the wanted outcome, not an accident of NULL logic.
    expect(await resolve("NULLSTATUS_NOATT")).toBeUndefined();
  });

  it("asks the database for activity rather than filtering on status alone", async () => {
    // Shape guard: reverting to a status-only predicate would still pass the cases above
    // until someone changed the fixture, so pin the query itself.
    await resolveEmployees(["ACTIVE_ATT"]);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toMatch(/EXISTS/);
    expect(sql).toMatch(/attendance_daily_record/);
    expect(sql).toMatch(/record_date >= DATE_SUB\(CURDATE\(\), INTERVAL \? DAY\)/);
    expect(sql).toMatch(/LOWER\(employment_status\) = 'active'/);
    expect(sql).not.toMatch(/COALESCE\(employment_status/);
    expect((params as unknown[]).at(-1)).toBe(180);
  });

  it("passes the window on every chunk of a large upload", async () => {
    // The window is appended per chunk; getting that wrong would misalign placeholders
    // against parameters on any upload above 500 rows.
    const codes = Array.from({ length: 1200 }, (_, i) => `MAS${i}`);
    await resolveEmployees(codes);
    expect(execute).toHaveBeenCalledTimes(3);
    for (const [, params] of execute.mock.calls) {
      expect((params as unknown[]).at(-1)).toBe(180);
    }
  });
});
