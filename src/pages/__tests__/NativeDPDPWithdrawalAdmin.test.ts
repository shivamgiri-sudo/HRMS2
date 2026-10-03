import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock("@/components/layout/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: unknown }) => children }));

import { normaliseEvidence, normaliseTask } from "@/pages/NativeDPDPWithdrawalAdmin";

describe("withdrawal admin field mapping", () => {
  it("maps the database task columns the screen used to read under other names (it threw on undefined.replace)", () => {
    const t = normaliseTask({ id: "t1", module_key: "payroll", action_required: "Retain statutory records", status: "pending", completed_at: null, notes: null });
    expect(t.task_module).toBe("payroll");
    expect(t.task_description).toBe("Retain statutory records");
    expect(() => t.task_module.replace(/_/g, " ")).not.toThrow();
  });
  it("still accepts the older field names", () => {
    expect(normaliseTask({ id: "t2", task_module: "bgv", task_description: "x", status: "completed" }).task_module).toBe("bgv");
  });
  it("never produces an undefined module, even for a malformed row", () => {
    expect(normaliseTask({ id: "t3" }).task_module).toBe("other");
  });
  it("maps evidence recorded_at / file_ref / recorded_by", () => {
    const e = normaliseEvidence({ id: "e1", evidence_type: "decision_letter", description: "d", file_ref: "f.pdf", recorded_by: "u1", recorded_at: "2026-10-03T00:00:00Z" });
    expect(e).toMatchObject({ file_path: "f.pdf", uploaded_by: "u1", created_at: "2026-10-03T00:00:00Z" });
  });
});
