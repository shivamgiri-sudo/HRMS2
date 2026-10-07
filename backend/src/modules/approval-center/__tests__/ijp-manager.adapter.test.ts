import { describe, it, expect } from "vitest";
import { makeCtx } from "./fakeCtx.js";
import { ijpManagerAdapter } from "../adapters/ijp-manager.js";

const app = (over: Record<string, unknown> = {}) => ({
  id: "a1", status: "pending_manager", employee_name: "Asha Rao", employee_code: "MAS100", job_title: "Team Lead - Support", posting_code: "IJP-0042",
  current_designation_name: "Executive", current_department_name: "Ops", current_process_name: "Support", current_branch_name: "Pune",
  tenure_months: 26, application_note: "Keen to lead", applied_at: new Date().toISOString(), ...over,
});

describe("ijpManagerAdapter", () => {
  it("maps every component from the caller's own pending-manager rows", async () => {
    const { ctx, calls } = makeCtx({ "GET /api/ijp/applications/pending-manager": { applications: [app()], total: 1 } });
    const [it] = await ijpManagerAdapter.list(ctx);
    expect(calls[0].path).toBe("/api/ijp/applications/pending-manager");
    expect(it.uid).toBe("ijp_manager:a1");
    expect(it.category).toBe("Recruitment");
    expect(it.fields.map((f) => f.label)).toEqual(expect.arrayContaining([
      "Employee", "Employee code", "Applied for", "Posting code", "Current designation", "Current department", "Current process", "Current branch", "Tenure (months)", "Employee's note", "Applied on",
    ]));
    expect(it.rejectNeedsReason).toBe(false);
    expect(it.viewPath).toBe("/people/ijp?approvalId=a1");
  });

  it("drops rows no longer pending manager and flags old ones", async () => {
    const old = new Date(Date.now() - 6 * 86_400_000).toISOString();
    const { ctx } = makeCtx({ "GET /api/ijp/applications/pending-manager": { applications: [app({ id: "x", status: "under_review" }), app({ id: "y", applied_at: old })] } });
    const items = await ijpManagerAdapter.list(ctx);
    expect(items.map((i) => i.id)).toEqual(["y"]);
    expect(items[0].priority).toBe("high");
  });

  it("approve / reject use the manager-action endpoint's action vocabulary", async () => {
    const { ctx, calls } = makeCtx({ "PATCH /api/ijp/applications/a1/manager-action": { application: {} } });
    await ijpManagerAdapter.decide(ctx, { id: "a1" }, "approve", "");
    await ijpManagerAdapter.decide(ctx, { id: "a1" }, "reject", "Needed on current project");
    expect(calls[0].body).toEqual({ action: "approve", remarks: undefined });
    expect(calls[1].body).toEqual({ action: "reject", remarks: "Needed on current project" });
  });
});
