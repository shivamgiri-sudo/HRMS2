import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";

/**
 * The bulk Activate/Deactivate buttons on the employee directory did nothing.
 *
 * They sent `{ employment_status: "inactive" }`. The API takes camelCase
 * `employmentStatus` and a capitalised enum, so Zod stripped the unknown key,
 * the UPDATE touched no column, the request still returned 200, and the page
 * announced "N employees set to inactive" — a success message for an operation
 * that never happened. HR had no way to tell.
 *
 * Two guards, because either half alone reproduces the bug: the payload has to
 * match the API contract, and the reported count has to come from what actually
 * settled rather than from how many were requested.
 */

const HOOKS = path.resolve(__dirname, "../useEmployees.ts");
const VALIDATION = path.resolve(
  __dirname,
  "../../../backend/src/modules/employees/employee.validation.ts"
);

type BulkStatusVars = { employeeIds: string[]; status: "active" | "inactive" };
type BulkStatusResult = { updatedCount: number; failedCount: number; firstError?: string };

// vi.mock factories are hoisted above const declarations, so the capture box has
// to be hoisted with them or the factory closes over a temporal-dead-zone binding.
const captured = vi.hoisted(() => ({
  fn: undefined as undefined | ((vars: BulkStatusVars) => Promise<BulkStatusResult>),
}));

vi.mock("@/lib/hrmsApi", () => ({
  hrmsApi: { patch: vi.fn(), get: vi.fn(), post: vi.fn(), delete: vi.fn(), put: vi.fn() },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: () => ({ data: undefined, isLoading: false }),
  useMutation: (opts: { mutationFn: (vars: BulkStatusVars) => Promise<BulkStatusResult> }) => {
    captured.fn = opts.mutationFn;
    return {};
  },
}));

const { hrmsApi } = await import("@/lib/hrmsApi");
const { useBulkUpdateEmployeeStatus } = await import("../useEmployees");

/** The mutationFn, lifted out of the React hook without a renderer. */
function mutationFn() {
  useBulkUpdateEmployeeStatus();
  if (!captured.fn) throw new Error("useMutation was never called");
  return captured.fn;
}

describe("bulk employee status payload matches the API contract", () => {
  beforeEach(() => {
    vi.mocked(hrmsApi.patch).mockReset();
    vi.mocked(hrmsApi.patch).mockResolvedValue({} as never);
  });

  it("sends the camelCase key the API validates on", async () => {
    await mutationFn()({ employeeIds: ["a"], status: "inactive" });

    const [, body] = vi.mocked(hrmsApi.patch).mock.calls[0];
    expect(body).toHaveProperty("employmentStatus");
    expect(body).not.toHaveProperty("employment_status");
  });

  it("sends a value the API enum accepts", async () => {
    const enumLine = fs.readFileSync(VALIDATION, "utf8")
      .split("\n")
      .find((l) => l.includes("employmentStatus:"));
    expect(enumLine).toBeDefined();

    await mutationFn()({ employeeIds: ["a"], status: "inactive" });
    const [, inactiveBody] = vi.mocked(hrmsApi.patch).mock.calls[0];
    expect(enumLine).toContain(`"${(inactiveBody as { employmentStatus: string }).employmentStatus}"`);

    vi.mocked(hrmsApi.patch).mockClear();
    await mutationFn()({ employeeIds: ["a"], status: "active" });
    const [, activeBody] = vi.mocked(hrmsApi.patch).mock.calls[0];
    expect(enumLine).toContain(`"${(activeBody as { employmentStatus: string }).employmentStatus}"`);
  });

  it("counts what settled, not what was requested", async () => {
    vi.mocked(hrmsApi.patch)
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error("Reactivation must go through the reactivation request flow"))
      .mockResolvedValueOnce({} as never);

    const result = await mutationFn()({ employeeIds: ["a", "b", "c"], status: "inactive" });

    expect(result.updatedCount).toBe(2);
    expect(result.failedCount).toBe(1);
    expect(result.firstError).toContain("reactivation");
  });

  it("does not report a blanket success count", () => {
    const src = fs.readFileSync(HOOKS, "utf8");
    const fn = src.slice(src.indexOf("export function useBulkUpdateEmployeeStatus"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    // The original bug in one line: updatedCount taken from the input length.
    expect(body).not.toContain("updatedCount: employeeIds.length");
    expect(body).toContain("allSettled");
  });
});
