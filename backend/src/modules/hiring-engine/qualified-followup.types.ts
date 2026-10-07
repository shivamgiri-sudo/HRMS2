export type SourceType = "meta_live" | "meta_old" | "he";
export type FollowupMode = "off" | "dry_run" | "live";

export interface EnqueueInput {
  sourceType: SourceType;
  metaLeadId?: string | null;
  heLeadId?: string | null;
  atsCandidateId?: string | null;
  requisitionId: string;
  campaignId?: string | null;
  driveId?: string | null;
  originId: string;
  originLabel: string;
  phone: string;
  email?: string | null;
  fullName?: string | null;
  branchName?: string | null;
  roleName?: string | null;
  qualifiedAt?: Date;
}
