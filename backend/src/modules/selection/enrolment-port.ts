// The follow-up enrolment as the selection gate sees it (unified plan U-Task 7: enqueueQualifiedFollowup with shortlistId and
// criteriaVersionId). The adapter below targets this branch's enqueueQualifiedFollowup; the unified branch replaces it with its own
// enrolment, which records shortlistId / criteriaVersionId on the row. Compiles standalone.
import { enqueueQualifiedFollowup } from "../hiring-engine/qualified-followup.service.js";
import type { SourceType } from "../hiring-engine/qualified-followup.types.js";

export interface EnrolInput {
  sourceType: SourceType; requisitionId: string; mobile10: string;
  heLeadId?: string | null; metaLeadId?: string | null; atsCandidateId?: string | null;
  fullName?: string | null; email?: string | null; branchName?: string | null; roleName?: string | null;
  originId: string; originLabel: string;
  /** shortlist_candidate.id the person was approved on, and the criteria version of that decision (unified U-Task 7). */
  shortlistId: string; criteriaVersionId: string | null;
}
export interface EnrolmentPort { enqueue(i: EnrolInput): Promise<{ status: string; id?: string }> }

export const currentFollowupPort: EnrolmentPort = {
  enqueue: (i) => enqueueQualifiedFollowup({
    sourceType: i.sourceType, requisitionId: i.requisitionId, phone: i.mobile10, heLeadId: i.heLeadId ?? null, metaLeadId: i.metaLeadId ?? null,
    atsCandidateId: i.atsCandidateId ?? null, fullName: i.fullName ?? null, email: i.email ?? null, branchName: i.branchName ?? null, roleName: i.roleName ?? null,
    originId: i.originId, originLabel: i.originLabel,
  }),
};
