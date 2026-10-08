// The follow-up enrolment as the selection gate sees it: the unified enrolment (enqueueQualifiedFollowup), which records the shortlist
// decision (shortlist_id) and its criteria version on the journey row and runs only the caps for shortlisted people.
import { enqueueQualifiedFollowup } from "../hiring-engine/qualified-followup.service.js";
import type { EnqueueInput, SourceType } from "../hiring-engine/qualified-followup.types.js";

export interface EnrolInput {
  sourceType: SourceType; requisitionId: string; mobile10: string;
  heLeadId?: string | null; metaLeadId?: string | null; atsCandidateId?: string | null; campaignId?: string | null;
  fullName?: string | null; email?: string | null; branchName?: string | null; roleName?: string | null;
  originId: string; originLabel: string;
  /** shortlist_candidate.id the person was approved on, and the criteria version of that decision. */
  shortlistId: string; criteriaVersionId: string | null;
  /** Live Meta arrival with the campaign's auto_notify off: enrolled held for HR, as on the unified path. */
  heldReason?: EnqueueInput["heldReason"];
}
export interface EnrolmentPort { enqueue(i: EnrolInput): Promise<{ status: string; id?: string }> }

export function toEnqueueInput(i: EnrolInput): EnqueueInput {
  return {
    sourceType: i.sourceType, requisitionId: i.requisitionId, phone: i.mobile10, heLeadId: i.heLeadId ?? null, metaLeadId: i.metaLeadId ?? null,
    atsCandidateId: i.atsCandidateId ?? null, campaignId: i.campaignId ?? null, fullName: i.fullName ?? null, email: i.email ?? null, branchName: i.branchName ?? null,
    roleName: i.roleName ?? null, originId: i.originId, originLabel: i.originLabel, shortlistId: i.shortlistId, criteriaVersionId: i.criteriaVersionId,
    heldReason: i.heldReason ?? null,
  };
}

export const currentFollowupPort: EnrolmentPort = { enqueue: (i) => enqueueQualifiedFollowup(toEnqueueInput(i)) };
