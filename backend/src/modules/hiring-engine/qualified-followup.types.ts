export type SourceType = "meta_live" | "meta_old" | "he";
/** The stream a line-up runs for (used by the follow-up hook). */
export interface FollowupStreamRef { streamId: string; sourceType: SourceType; originId: string; originLabel: string }
export type FollowupMode = "off" | "dry_run" | "live";
/** Per-source mode (screen switch, capped by the env ceiling). */
export type SourceMode = "off" | "dry_run" | "test" | "canary" | "live";
/** qualified_followup.mode_at_enqueue: the row's tag, fixed at enrolment (promoted in place, never demoted). */
export type RowTag = "dry_run" | "test" | "canary" | "live";
export type JourneyState = "enrolled" | "held_manual" | "held_best_offer" | "reach" | "engaged" | "confirmed" | "reminded" | "arrived" | "no_show"
  | "reinvite_wait" | "declined" | "stopped";
/** Rows that own the person: the engine and the legacy Meta outreach skip them even after a rollback (spec finding 6). */
export const OWNED_TAGS = ["live", "canary"] as const;

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
  /** Record-only row: the Hiring Engine sends to this person, the pipeline never selects it. */
  engineOwned?: boolean;
}

/** The drive a line-up ran for (what the enqueue hook needs to classify and label it). */
export interface MatchedDriveRef { id: string; requisitionId: string; sourceKind: string; runLabel: string | null; driveDate: string }
