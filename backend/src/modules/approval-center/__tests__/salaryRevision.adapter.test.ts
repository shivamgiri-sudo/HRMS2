import { describe, it, expect } from "vitest";
import { fakeCtx } from "./_ctx.js";
import { salaryRevisionAdapter as a } from "../adapters/salaryRevision.js";
import { beforeEach as __scopeBeforeEach } from "vitest";
import { useScope, ORG_WIDE } from "./scope-fixture.js";
__scopeBeforeEach(() => useScope(ORG_WIDE));

const row = (o: any = {}) => ({ id: 7, employee_id: "e1", full_name: "Ravi K", employee_code: "E7", branch_name: "Delhi", current_effective_from: "2026-09-01", requested_effective_from: "2026-08-15", reason: "Joined earlier", status: "pending", requested_by_email: "hr@x.in", created_at: "2026-10-01T00:00:00Z", ...o });

describe("salary revision adapter", () => {
  it("maps fields, pending only", async () => {
    const { ctx, calls } = fakeCtx({ "GET /api/salary-revision/": { data: [row(), row({ id: 8, status: "approved" })] } });
    const items = await a.list(ctx);
    expect(calls[0].query).toEqual({ status: "pending" });
    expect(items.map((i) => i.id)).toEqual(["7"]);
    const labels = items[0].fields.map((f) => f.label);
    for (const l of ["Current salary start date", "Requested salary start date", "Reason", "Requested by", "Branch"]) expect(labels).toContain(l);
    expect(items[0].viewPath).toBe("/salary-revision?approvalId=7");
    expect(items[0].rejectNeedsReason).toBe(true);
  });
  it("decide approve + reject", async () => {
    const { ctx, calls } = fakeCtx({ "POST /api/salary-revision/7/review": {} });
    await a.decide(ctx, { id: "7" }, "approve", "");
    await a.decide(ctx, { id: "7" }, "reject", "wrong date");
    expect(calls.map((c) => c.body)).toEqual([{ action: "approve", remarks: undefined }, { action: "reject", remarks: "wrong date" }]);
  });
});
