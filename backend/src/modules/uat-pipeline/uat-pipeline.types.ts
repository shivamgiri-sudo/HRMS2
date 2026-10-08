/**
 * Shared types for the UAT governance pipeline.
 *
 * Phase 1 scope: intake, static risk classification, approvals and the release/retest
 * lifecycle. Phases 2-4 add LLM validation, prompt generation and automated builds; the
 * types those need are deliberately absent rather than stubbed, so an unimplemented stage
 * is a compile error rather than a silently empty object.
 */

// ── Risk ──────────────────────────────────────────────────────────────────────

/** Path-floor tier, from uat/protected-paths.json. */
export type PathTier = "deny" | "review" | "standard" | "trivial";

/** Business-capability class, from uat/capability-registry.json. */
export type CapabilityClass = "DENY" | "HIGH_REVIEW" | "REVIEW" | "STANDARD" | "TRIVIAL";

/**
 * The two dimensions are ordered independently but compared on one scale.
 * Higher number = more dangerous. effective_risk = max of the two, mapped back to PathTier.
 */
export const PATH_TIER_RANK: Record<PathTier, number> = {
  trivial: 0,
  standard: 1,
  review: 2,
  deny: 3,
};

export const CAPABILITY_CLASS_RANK: Record<CapabilityClass, number> = {
  TRIVIAL: 0,
  STANDARD: 1,
  REVIEW: 2,
  HIGH_REVIEW: 2.5, // strictly worse than REVIEW, strictly better than DENY
  DENY: 3,
};

/** Maps a numeric rank back onto the tier vocabulary the DB column uses. */
export function rankToPathTier(rank: number): PathTier {
  if (rank >= 3) return "deny";
  if (rank >= 2) return "review";
  if (rank >= 1) return "standard";
  return "trivial";
}

// ── Protected paths ───────────────────────────────────────────────────────────

export type ProtectedTier = "deny" | "review";
export type ProtectedCategory = "business-critical" | "control-plane" | "domain-owned";

export interface ProtectedPathRule {
  tier: ProtectedTier;
  category: ProtectedCategory;
  pattern: string;
  reason: string;
}

export interface ProtectedPathsFile {
  version: number;
  tiers: Record<string, string>;
  rules: ProtectedPathRule[];
}

export interface ProtectedHit {
  path: string;
  pattern: string;
  tier: ProtectedTier;
  category: ProtectedCategory;
  reason: string;
}

// ── Capability registry ───────────────────────────────────────────────────────

export type MatchSignal = "path" | "table" | "keyword";

export interface CapabilityDefinition {
  key: string;
  name: string;
  class: CapabilityClass;
  requiredApproverRoles: string[];
  mandatoryTests: string[];
  paths: string[];
  tables: string[];
  keywords: string[];
  reason: string;
}

export interface CapabilityRegistryFile {
  version: number;
  classes: Record<string, string>;
  capabilities: CapabilityDefinition[];
}

export interface CapabilityHit {
  capabilityKey: string;
  capabilityName: string;
  class: CapabilityClass;
  signal: MatchSignal;
  /** The concrete thing that matched: a file path, a table name, or the keyword pattern. */
  matchedToken: string;
  requiredApproverRoles: string[];
  mandatoryTests: string[];
  reason: string;
}

// ── Static scan ───────────────────────────────────────────────────────────────

/**
 * What the scanner was given. page_route / page_code are captured from the SPA and are
 * authoritative; moduleHint is the user's own selection and is advisory only — server-side
 * resolution decides the outcome, so a mislabelled payroll bug is still classified as payroll.
 */
export interface ScanInput {
  feedbackId: string;
  title: string;
  /** Redacted body. Raw text must never reach the scanner's logs or an LLM. */
  text: string;
  pageRoute?: string | null;
  pageCode?: string | null;
  moduleHint?: string | null;
  apiPathHint?: string | null;
}

export interface ImpactedPath {
  path: string;
  confidence: "high" | "medium" | "low";
  why: string;
  fanIn: number;
}

export interface StaticScanResult {
  scannerVersion: string;
  pathsSha: string;
  registrySha: string;
  impactedPaths: ImpactedPath[];
  impactedRoutes: string[];
  impactedModules: string[];
  protectedHits: ProtectedHit[];
  capabilityHits: CapabilityHit[];
  reverseDepMax: number;
  resolverMode: "fast" | "typescript";
  /** Path-floor verdict. */
  riskTier: PathTier;
  /** Capability verdict. */
  capabilityClass: CapabilityClass;
  /** max(riskTier, capabilityClass) — the verdict that actually gates the pipeline. */
  effectiveRisk: PathTier;
  /** Every approver role any matched capability demands, deduplicated. */
  requiredApproverRoles: string[];
  durationMs: number;
  /** Human-readable explanation shown to the submitter when effectiveRisk is "deny". */
  blockedReason: string | null;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export type UatStatus =
  | "submitted"
  | "scanning"
  | "scan_blocked"
  | "scan_done"
  | "triaged"
  | "validating"
  | "validation_failed"
  | "invalid"
  | "checklist_failed"
  | "checklist_passed"
  | "awaiting_governance"
  | "awaiting_approval"
  | "rejected"
  | "prompt_writing"
  | "prompt_ready"
  | "build_queued"
  | "build_running"
  | "build_failed"
  | "pr_open"
  | "reviewed"
  | "merged"
  | "deployed_to_uat"
  | "ready_for_retest"
  | "retest_failed"
  | "retest_passed"
  | "reopened"
  | "production_released"
  | "production_verified"
  | "rollback_required"
  | "rolled_back"
  | "closed";

export type ActorKind = "user" | "system" | "llm" | "ci";

export interface TransitionContext {
  actorUserId?: string | null;
  actorKind?: ActorKind;
  reason?: string | null;
  detail?: Record<string, unknown> | null;
}

// ── Approvals ─────────────────────────────────────────────────────────────────

export type ApprovalType =
  | "review_tier"
  | "capability"
  | "change_type"
  | "dispatch"
  | "merge"
  | "retest"
  | "release"
  | "rollback";

export type ApprovalDecision = "pending" | "approved" | "rejected";

export interface ApprovalRow {
  id: string;
  feedbackId: string;
  approvalType: ApprovalType;
  capabilityKey: string | null;
  requiredRole: string;
  approverUserId: string | null;
  delegationId: string | null;
  decision: ApprovalDecision;
  reason: string | null;
  requestedAt: Date;
  decidedAt: Date | null;
}

// ── Feedback ──────────────────────────────────────────────────────────────────

export type FeedbackKind = "bug" | "correction" | "feature" | "question";
export type ChangeType = "bug" | "enhancement" | "policy_change" | "question";
export type Severity = "low" | "medium" | "high" | "blocker";
export type Priority = "p3" | "p2" | "p1" | "p0";

export interface CreateFeedbackInput {
  kind: FeedbackKind;
  severity: Severity;
  priority?: Priority;
  title: string;
  body: string;
  expectedBehaviour?: string | null;
  actualBehaviour?: string | null;
  stepsToReproduce?: string | null;
  pageRoute?: string | null;
  pageCode?: string | null;
  moduleHint?: string | null;
  apiPathHint?: string | null;
  /** Captured silently by the client; reproducibility comes free. */
  appVersion?: string | null;
  frontendSha?: string | null;
  backendSha?: string | null;
  environment?: string | null;
  browser?: string | null;
  device?: string | null;
  correlationId?: string | null;
  occurredAt?: string | null;
}

/** Row scope. An admin for Branch A must not see Branch B's feedback or screenshots. */
export interface UatScope {
  branchIds: string[] | null; // null = unrestricted
  processIds: string[] | null;
}
