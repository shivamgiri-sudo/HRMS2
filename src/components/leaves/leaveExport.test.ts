import { describe, expect, it } from "vitest";
import { buildLeaveCsv, filterByStartRange } from "./leaveExport";
import type { LeaveRequest } from "@/hooks/useLeaves";

const req = (over: Partial<LeaveRequest> = {}): LeaveRequest => ({
  id: "1", employeeId: "e1", employee: { name: 'Asha "AR" Rao', department: "Ops" }, branch: "Noida", process: "Sales",
  type: "Casual Leave", startDate: "2026-10-05", endDate: "2026-10-06", days: 2, reason: 'said "ok", fine', status: "branch_head_approved",
  canReview: false, submittedAt: "", ...over,
});

describe("buildLeaveCsv", () => {
  it("escapes quotes and keeps commas inside one cell", () => {
    const csv = buildLeaveCsv([req()]);
    const [header, row] = csv.split("\n");
    expect(header.split(",")).toHaveLength(10);
    expect(row).toContain('"Asha ""AR"" Rao"');
    expect(row).toContain('"said ""ok"", fine"');
  });
  it("writes the plain-language status, not the raw API value", () => {
    expect(buildLeaveCsv([req()])).toContain('"Approved"');
    expect(buildLeaveCsv([req({ status: "pending_branch_head" })])).toContain('"Awaiting Branch Head"');
  });
});

describe("filterByStartRange", () => {
  const rows = [req({ id: "a", startDate: "2026-10-01" }), req({ id: "b", startDate: "2026-10-10" }), req({ id: "c", startDate: "2026-10-20" })];
  it("returns everything with no range", () => expect(filterByStartRange(rows)).toHaveLength(3));
  it("keeps starts inside the range, inclusive of both ends", () => {
    const out = filterByStartRange(rows, new Date("2026-10-01T00:00:00"), new Date("2026-10-10T00:00:00"));
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });
  it("supports open-ended ranges", () => {
    expect(filterByStartRange(rows, new Date("2026-10-10T00:00:00")).map((r) => r.id)).toEqual(["b", "c"]);
    expect(filterByStartRange(rows, undefined, new Date("2026-10-10T00:00:00")).map((r) => r.id)).toEqual(["a", "b"]);
  });
});
