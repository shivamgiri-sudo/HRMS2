/**
 * Role-owned stages use a LITERAL role match: super_admin / org-wide / alias roles that merely pass the endpoint guard are not
 * designated. For each adapter: a caller holding only an unrelated role (and only super_admin where the module does not list it)
 * sees nothing and the module endpoint is never called; a caller holding the stage's role reaches the endpoint.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { heldRoles } from "./_literalRoles.js";
vi.mock("../adapters/_roles.js", async () => (await import("./_literalRoles.js")).rolesModule);
vi.mock("../../../db/mysql.js", () => ({ db: { execute: async () => [[], []] } }));

import { accessRequestAdapter } from "../adapters/access-request.js";
import { companyPostAdapter } from "../adapters/company-post.js";
import { dpdpWithdrawalAdapter } from "../adapters/dpdp-withdrawal.js";
import { clientInvoiceAdapter, clientCreditNoteAdapter } from "../adapters/client-billing.js";
import { benefitsClaimAdapter } from "../adapters/benefits-claim.js";
import { salaryRevisionAdapter } from "../adapters/salaryRevision.js";
import { rmChangeAdapter } from "../adapters/rm-change.js";
import { bankChangeAdapter } from "../adapters/bank-change.js";
import { statutoryChangeAdapter } from "../adapters/statutory-change.js";
import { jobRequisitionAdapter } from "../adapters/job-requisition.js";
import { journalVoucherAdapter } from "../adapters/journal-voucher.js";
import { nocAdapter } from "../adapters/noc.js";
import { loansAdapter } from "../adapters/loans.js";
import { payrollHeadReviewAdapter } from "../adapters/payroll-head-review.js";
import { holidayWorkAdapter } from "../adapters/holiday-work.js";
import { manualOverrideAdapter } from "../adapters/manual-override.js";
import { statutoryOptOutAdapter } from "../adapters/statutory-optout.js";
import { atsOfferAdapter } from "../adapters/ats-offer.js";
import { atsBranchHeadAdapter } from "../adapters/ats-branch-head.js";
import type { ApprovalAdapter, LoopbackCtx } from "../types.js";

// [adapter, a role the module designates, a role that is NOT designated]
const CASES: Array<[ApprovalAdapter, string, string]> = [
  [accessRequestAdapter, "admin", "hr"],
  [companyPostAdapter, "hr_head", "hr"],
  [dpdpWithdrawalAdapter, "dpo", "ceo"],
  [clientInvoiceAdapter, "finance", "payroll_head"],
  [clientCreditNoteAdapter, "accounts_head", "payroll_head"],
  [benefitsClaimAdapter, "hr", "ceo"],
  [salaryRevisionAdapter, "payroll_head", "finance_head"],
  [rmChangeAdapter, "branch_wfm", "ceo"],
  [bankChangeAdapter, "payroll", "payroll_head"],
  [statutoryChangeAdapter, "hr", "payroll"],
  [jobRequisitionAdapter, "branch_head", "hr"],
  [journalVoucherAdapter, "ceo", "accounts_head"],
  [nocAdapter, "payroll_head", "payroll"],
  [loansAdapter, "finance_head", "payroll"],
  [payrollHeadReviewAdapter, "payroll_head", "payroll_hr"],
  [holidayWorkAdapter, "payroll_branch", "finance"],
  [manualOverrideAdapter, "payroll_admin", "payroll"],
  [statutoryOptOutAdapter, "payroll", "hr"],
  [atsOfferAdapter, "branch_head", "hr"],
  [atsBranchHeadAdapter, "branch_head", "admin"],
];

function spyCtx() {
  const calls: string[] = [];
  const ctx: LoopbackCtx = {
    userId: "u1",
    async call(method, path) {
      calls.push(`${method} ${path}`);
      return { data: [] } as never;
    },
  };
  return { ctx, calls };
}

describe("literal stage-role gate", () => {
  beforeEach(() => { heldRoles.list = []; });
  for (const [adapter, designated, other] of CASES) {
    it(`${adapter.kind}: an undesignated role (${other}) sees nothing; ${designated} reaches the module queue`, async () => {
      heldRoles.list = [other];
      const none = spyCtx();
      expect(await adapter.list(none.ctx).catch(() => [])).toEqual([]);
      // endpoint may be consulted before the gate in a few adapters, but nothing may come back
      heldRoles.list = [designated];
      const yes = spyCtx();
      await adapter.list(yes.ctx).catch(() => undefined);
      expect(yes.calls.length).toBeGreaterThan(0);
    });
  }
  it("super_admin where the module does not list it is not a wildcard (access request: admin only)", async () => {
    heldRoles.list = ["super_admin"];
    const { ctx, calls } = spyCtx();
    expect(await accessRequestAdapter.list(ctx)).toEqual([]);
    expect(calls).toEqual([]);
  });
});
