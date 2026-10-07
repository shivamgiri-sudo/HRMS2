import type { ApprovalAdapter } from "../types.js";
import { accessRequestAdapter } from "./access-request.js";
import { advancesAdapter } from "./advances.js";
import { atsBranchHeadAdapter } from "./ats-branch-head.js";
import { atsOfferAdapter } from "./ats-offer.js";
import { autoRosterAdapter } from "./auto-roster.js";
import { awolAdapter } from "./awol.js";
import { bankChangeAdapter } from "./bank-change.js";
import { benefitsClaimAdapter } from "./benefits-claim.js";
import { bgvReviewAdapter } from "./bgv-review.js";
import { branchBudgetAdapter } from "./branch-budget.js";
import { budgetTopupAdapter } from "./budget-topup.js";
import { bulkUploadAdapter } from "./bulkUpload.js";
import { clientInvoiceAdapter, clientCreditNoteAdapter } from "./client-billing.js";
import { companyPostAdapter } from "./company-post.js";
import { costCentreAdapter } from "./cost-centre.js";
import { dpdpWithdrawalAdapter } from "./dpdp-withdrawal.js";
import { exitClearanceAdapter } from "./exit-clearance.js";
import { exitFfAdapter } from "./exit-ff.js";
import { exitPassAdapter } from "./exit-pass.js";
import { exitResignationAdapter } from "./exit-resignation.js";
import { grnAdapter } from "./grn.js";
import { holidayWorkAdapter } from "./holiday-work.js";
import { ijpManagerAdapter } from "./ijp-manager.js";
import { imprestAllocationAdapter } from "./imprest-allocation.js";
import { incentivesAdapter } from "./incentives.js";
import { jobRequisitionAdapter } from "./job-requisition.js";
import { journalVoucherAdapter } from "./journal-voucher.js";
import { leaveAdapter } from "./leave.js";
import { loansAdapter } from "./loans.js";
import { manualOverrideAdapter } from "./manual-override.js";
import { mobilityAdapter } from "./mobility.js";
import { nocAdapter } from "./noc.js";
import { paymentVoucherAdapter } from "./payment-voucher.js";
import { payrollHeadReviewAdapter } from "./payroll-head-review.js";
import { payrollSignoffAdapter } from "./payrollSignoff.js";
import { pnlManualAdjustmentAdapter } from "./pnl-manual-adjustment.js";
import { regularizationAdapter } from "./regularization.js";
import { reimbursementsAdapter } from "./reimbursements.js";
import { rejoinAdapter } from "./rejoin.js";
import { revenueForecastAdapter } from "./revenue-forecast.js";
import { rmChangeAdapter } from "./rm-change.js";
import { rosterPreferenceAdapter } from "./roster-preference.js";
import { rosterSwapAdapter, rosterWeekoffAdapter, rosterDisputeAdapter, rosterConflictAdapter } from "./roster-requests.js";
import { salaryDisputeAdapter } from "./salaryDispute.js";
import { salaryIncrementAdapter } from "./salaryIncrement.js";
import { salaryRevisionAdapter } from "./salaryRevision.js";
import { statutoryChangeAdapter } from "./statutory-change.js";
import { statutoryOptOutAdapter } from "./statutory-optout.js";
import { teamRosterAdapter } from "./team-roster.js";
import { vendorApprovalAdapter } from "./vendor-approval.js";
import { vendorBankChangeAdapter } from "./vendor-bank-change.js";
import { visitorAdapter } from "./visitor.js";
import { workItemAdapter } from "./work-item.js";
import { workflowAdapter } from "./workflow.js";

/**
 * Every approval kind the Approval Center knows. One adapter per kind; add yours here.
 * Order is only a tie-break; the list is sorted by priority then age.
 */
export const ADAPTERS: ApprovalAdapter[] = [
  accessRequestAdapter,
  advancesAdapter,
  atsBranchHeadAdapter,
  atsOfferAdapter,
  autoRosterAdapter,
  awolAdapter,
  bankChangeAdapter,
  benefitsClaimAdapter,
  bgvReviewAdapter,
  branchBudgetAdapter,
  budgetTopupAdapter,
  bulkUploadAdapter,
  clientInvoiceAdapter,
  clientCreditNoteAdapter,
  companyPostAdapter,
  costCentreAdapter,
  dpdpWithdrawalAdapter,
  exitClearanceAdapter,
  exitFfAdapter,
  exitPassAdapter,
  exitResignationAdapter,
  grnAdapter,
  holidayWorkAdapter,
  ijpManagerAdapter,
  imprestAllocationAdapter,
  incentivesAdapter,
  jobRequisitionAdapter,
  journalVoucherAdapter,
  leaveAdapter,
  loansAdapter,
  manualOverrideAdapter,
  mobilityAdapter,
  nocAdapter,
  paymentVoucherAdapter,
  payrollHeadReviewAdapter,
  payrollSignoffAdapter,
  pnlManualAdjustmentAdapter,
  regularizationAdapter,
  reimbursementsAdapter,
  rejoinAdapter,
  revenueForecastAdapter,
  rmChangeAdapter,
  rosterPreferenceAdapter,
  rosterSwapAdapter,
  rosterWeekoffAdapter,
  rosterDisputeAdapter,
  rosterConflictAdapter,
  salaryDisputeAdapter,
  salaryIncrementAdapter,
  salaryRevisionAdapter,
  statutoryChangeAdapter,
  statutoryOptOutAdapter,
  teamRosterAdapter,
  vendorApprovalAdapter,
  vendorBankChangeAdapter,
  visitorAdapter,
  workItemAdapter,
  workflowAdapter,
];
