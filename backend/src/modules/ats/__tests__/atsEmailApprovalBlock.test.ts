import { describe, it, expect, vi, beforeEach } from "vitest";

const { sendMail, execute, buildApprovalBlock } = vi.hoisted(() => ({
  sendMail: vi.fn().mockResolvedValue({}),
  execute: vi.fn(),
  buildApprovalBlock: vi.fn(),
}));

vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail }) } }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));
vi.mock("../../../config/env.js", () => ({ env: { SMTP_USER: "u", SMTP_PASS: "p", SMTP_FROM: "hr@x.in", SMTP_HOST: "h", SMTP_PORT: "587" } }));
vi.mock("../../approval-center/approval-email.service.js", () => ({ buildApprovalBlock: (...a: unknown[]) => buildApprovalBlock(...a) }));

import { sendOfferReviewEmail } from "../ats.email.service.js";

const params = { candidateId: "c1", to: "bh@x.in", candidateName: "Asha", offerSummary: "CTC 3L" };

describe("ATS approver emails carry the approval block", () => {
  beforeEach(() => { sendMail.mockClear(); execute.mockReset(); buildApprovalBlock.mockReset(); });

  it("appends block html for a known approver", async () => {
    execute.mockResolvedValueOnce([[{ id: "u1" }]]).mockResolvedValue([[]]);
    buildApprovalBlock.mockResolvedValue({ html: "<div>APPROVE-CARD</div>", text: "t" });
    await sendOfferReviewEmail(params);
    expect(buildApprovalBlock).toHaveBeenCalledWith("u1", { kinds: ["ats_offer", "ats_branch_head"] });
    expect(sendMail.mock.calls[0][0].html).toContain("APPROVE-CARD");
  });

  it("leaves the email unchanged when there is no login or nothing pending", async () => {
    execute.mockResolvedValue([[]]);
    await sendOfferReviewEmail(params);
    expect(buildApprovalBlock).not.toHaveBeenCalled();
    expect(sendMail.mock.calls[0][0].html).not.toContain("APPROVE-CARD");

    execute.mockResolvedValueOnce([[{ id: "u1" }]]).mockResolvedValue([[]]);
    buildApprovalBlock.mockResolvedValue(null);
    await sendOfferReviewEmail(params);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it("still sends when the lookup throws", async () => {
    execute.mockRejectedValueOnce(new Error("db down")).mockResolvedValue([[]]);
    const r = await sendOfferReviewEmail(params);
    expect(r.ok).toBe(true);
  });
});
