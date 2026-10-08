import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  send: vi.fn().mockResolvedValue({}),
  block: vi.fn(),
  recipients: vi.fn(),
}));

vi.mock("../../communication/email.service.js", () => ({ emailService: { isConfigured: () => true, send: h.send } }));
vi.mock("../../approval-center/approval-email.service.js", () => ({ buildApprovalBlock: h.block }));
vi.mock("../../it-provisioning/notification-recipients.service.js", () => ({ getConfiguredRecipients: h.recipients }));
vi.mock("../../communication/template.service.js", () => ({
  templateService: { renderTemplate: vi.fn().mockResolvedValue({ subject: "Raised", html: "<p>JR</p>", text: "JR" }) },
}));
vi.mock("../../../config/env.js", async (orig) => ({ env: { ...((await orig()) as any).env, JOB_REQUISITION_RAISED_EMAIL_ENABLED: true } }));

import { jobRequisitionService } from "./../job-requisition.service.js";

const req: any = { id: "r1", requisition_code: "JR-1", branch_id: "b1", designation_name: "Agent", branch_name: "B", requested_headcount: 3, priority: "high" };

describe("notifyRequisitionRaised approval block", () => {
  beforeEach(() => { h.send.mockClear(); h.block.mockReset(); h.recipients.mockReset(); });

  it("personalises per approver with a login and sends the rest as the shared copy", async () => {
    h.recipients.mockResolvedValue({ to: [{ userId: "u1", email: "a@x.in" }, { userId: null, email: "b@x.in" }], cc: ["c@x.in"] });
    h.block.mockResolvedValue({ html: "<i>CARD</i>", text: "CARD" });
    await jobRequisitionService.notifyRequisitionRaised(req);
    expect(h.block).toHaveBeenCalledWith("u1", { kinds: ["job_requisition"], entityId: "r1" });
    const calls = h.send.mock.calls.map((c) => c[0]);
    expect(calls[0]).toMatchObject({ to: "a@x.in" });
    expect(calls[0].html).toContain("CARD");
    expect(calls[1]).toMatchObject({ to: "b@x.in", cc: "c@x.in" });
    expect(calls[1].html).not.toContain("CARD");
  });

  it("unchanged single shared email when no block is available", async () => {
    h.recipients.mockResolvedValue({ to: [{ userId: "u1", email: "a@x.in" }], cc: [] });
    h.block.mockResolvedValue(null);
    await jobRequisitionService.notifyRequisitionRaised(req);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[0][0]).toMatchObject({ to: "a@x.in", html: "<p>JR</p>" });
  });
});
