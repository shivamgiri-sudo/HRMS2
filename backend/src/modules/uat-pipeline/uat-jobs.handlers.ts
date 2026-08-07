/**
 * Job handlers for the UAT pipeline. Phase 2 registers exactly one: `validate`.
 *
 * Kept out of uat-job-runner.ts so the runner stays a generic queue with no opinion about
 * what a job does — and so the runner can be tested with a stub handler rather than a live
 * Anthropic call.
 *
 * The validate handler is where the two-dimensional risk model and the LLM meet, and the
 * ordering is the point: the deterministic layers are computed FIRST and the model's output
 * is merged in LAST, through worstOf(). The model can therefore add findings and can never
 * remove one.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import { loadChecklist, persistCapabilityHits, persistEvaluations } from "./uat-checklist.repo.js";
import {
  evaluateCapabilities,
  evaluateDbRules,
  evaluateFloor,
  gateFor,
  mergeLayers,
} from "./uat-checklist.service.js";
import { enqueue, registerJobHandler, type UatJob } from "./uat-job-runner.js";
import { recordEvent, transition } from "./uat-state-machine.js";
import { runValidator, summariseForConsole, type ValidatorDeps } from "./uat-validator.service.js";
import type { StaticScanResult } from "./uat-pipeline.types.js";
import { changeTypeGate, switchEnabled, type ChangeType } from "./uat-governance.service.js";
import { runPromptWriter, PROMPT_WRITER_TEMPLATE_VERSION } from "./uat-prompt-writer.service.js";
import { savePrompt } from "./uat-prompt.repo.js";

interface FeedbackRow extends RowDataPacket {
  id: string;
  feedback_code: string;
  title: string;
  body_redacted: string | null;
  kind: string;
  page_route: string | null;
  status: string;
  change_type: string | null;
}

interface ScanRow extends RowDataPacket {
  scanner_version: string;
  paths_sha: string;
  registry_sha: string;
  impacted_paths_json: string | unknown;
  impacted_routes_json: string | unknown;
  impacted_modules_json: string | unknown;
  protected_hits_json: string | unknown;
  capability_hits_json: string | unknown;
  reverse_dep_max: number;
  resolver_mode: "fast" | "typescript";
  risk_tier: StaticScanResult["riskTier"];
  capability_class: StaticScanResult["capabilityClass"];
  effective_risk: StaticScanResult["effectiveRisk"];
  duration_ms: number;
}

/** mysql2 returns JSON columns already parsed on some driver versions and as text on others. */
function j<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

/** Rehydrate a StaticScanResult from its stored row. Shared by both LLM stages. */
function scanFromRow(s: ScanRow): StaticScanResult {
  return {
    scannerVersion: s.scanner_version,
    pathsSha: s.paths_sha,
    registrySha: s.registry_sha,
    impactedPaths: j(s.impacted_paths_json, []),
    impactedRoutes: j(s.impacted_routes_json, []),
    impactedModules: j(s.impacted_modules_json, []),
    protectedHits: j(s.protected_hits_json, []),
    capabilityHits: j(s.capability_hits_json, []),
    reverseDepMax: Number(s.reverse_dep_max ?? 0),
    resolverMode: s.resolver_mode,
    riskTier: s.risk_tier,
    capabilityClass: s.capability_class,
    effectiveRisk: s.effective_risk,
    requiredApproverRoles: [],
    durationMs: Number(s.duration_ms ?? 0),
    blockedReason: null,
  };
}

/** An error the runner must not retry. */
class TerminalJobError extends Error {
  readonly terminal = true;
}

export function validatorDepsFromEnv(): ValidatorDeps {
  return {
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.ANTHROPIC_DEFAULT_MODEL,
    effort: env.ANTHROPIC_EFFORT,
    maxTokens: env.ANTHROPIC_MAX_OUTPUT_TOKENS,
    timeoutMs: env.ANTHROPIC_TIMEOUT_MS,
    dailyCapUsd: env.UAT_DAILY_LLM_USD_CAP,
    enabled: String(env.UAT_VALIDATOR_ENABLED).toLowerCase() === "true",
  };
}

/**
 * Evaluate one feedback item.
 *
 * Runs the deterministic layers even when the LLM is switched off or fails — a floor and
 * capability verdict is genuine information, and recording it means a reviewer opening the
 * console sees the real risk classification rather than an empty checklist that looks like
 * nothing was assessed.
 */
export async function handleValidateJob(job: UatJob, deps?: ValidatorDeps): Promise<void> {
  const feedbackId = job.feedbackId;
  if (!feedbackId) throw new TerminalJobError("validate job carries no feedback_id");

  const [fbRows] = await db.query<FeedbackRow[]>(
    `SELECT id, feedback_code, title, body_redacted, kind, page_route, status, change_type
       FROM uat_feedback WHERE id = ? LIMIT 1`,
    [feedbackId]
  );
  if (!fbRows.length) throw new TerminalJobError(`feedback ${feedbackId} no longer exists`);
  const fb = fbRows[0];

  const [scanRows] = await db.query<ScanRow[]>(
    `SELECT * FROM uat_static_scan WHERE feedback_id = ? ORDER BY created_at DESC LIMIT 1`,
    [feedbackId]
  );
  if (!scanRows.length) {
    // Validation without a scan would send an unclassified item to an external model.
    throw new TerminalJobError(`feedback ${feedbackId} has no static scan; refusing to validate`);
  }
  const scan = scanFromRow(scanRows[0]);

  const checklist = await loadChecklist();
  const floor = evaluateFloor(scan);
  const capability = evaluateCapabilities(scan);
  await persistCapabilityHits(feedbackId, scan, null);

  const validator = await runValidator(
    {
      feedbackId,
      title: fb.title,
      // Only the redacted body. body_raw is not selected above, so it cannot reach here.
      bodyRedacted: fb.body_redacted ?? "",
      kind: fb.kind,
      pageRoute: fb.page_route,
      scan,
      checklist,
    },
    deps ?? validatorDepsFromEnv()
  );

  const db_ = evaluateDbRules(checklist.rules, validator.supplied);
  const results = mergeLayers(floor, capability, db_);
  const gate = gateFor(scan, results, checklist.blockingItemKeys);

  await persistEvaluations({
    feedbackId,
    results,
    snapshotSha: checklist.snapshotSha,
    pathsSha: scan.pathsSha,
    registrySha: scan.registrySha,
    llmCallId: validator.llmCallId ?? null,
  });

  await recordEvent(feedbackId, "checklist_evaluated", {
    actorKind: validator.ok ? "llm" : "system",
    message: validator.ok
      ? summariseForConsole(validator)
      : (validator.failureReason ?? "Validator did not run; deterministic layers only."),
    detail: {
      outcome: gate.outcome,
      effectiveRisk: gate.effectiveRisk,
      capabilityClass: gate.capabilityClass,
      requiredApproverRoles: gate.requiredApproverRoles,
      blockingReasons: gate.blockingReasons.slice(0, 10),
      warnings: gate.warnings.slice(0, 10),
      llmRan: validator.ok,
      costMicros: validator.costMicros ?? null,
    },
  });

  // The LLM failing is NOT the same as the checklist failing. A blocked gate is a real
  // verdict and moves the item on; an LLM that could not run leaves the item in
  // validation_failed so a human knows the assessment is incomplete rather than negative.
  if (gate.outcome === "blocked") {
    await transition(feedbackId, "checklist_failed", {
      actorKind: "system",
      reason: gate.blockingReasons[0] ?? "Checklist blocked this request.",
    });
    return;
  }
  if (!validator.ok) {
    await transition(feedbackId, "validation_failed", {
      actorKind: "system",
      reason: validator.failureReason ?? "The validator did not complete.",
    });
    if (validator.terminal) throw new TerminalJobError(validator.failureReason ?? "validator refused");
    return;
  }
  await transition(feedbackId, "checklist_passed", {
    actorKind: "llm",
    reason:
      gate.outcome === "needs_approval"
        ? `Checklist clear; requires approval from: ${gate.requiredApproverRoles.join(", ") || "a named reviewer"}.`
        : "Checklist clear. A human approval is still required before anything is built.",
  });
}

/**
 * Move an item into `validating` and queue the work.
 *
 * The transition happens FIRST and in the caller's request, not in the worker: if enqueue
 * succeeded but the status stayed `triaged`, the console would show an item nobody is working
 * on while a job quietly processes it. The state machine rejects an illegal source status, so
 * a double-click cannot queue a second job for an item already validating.
 *
 * The idempotency key includes the status the item is leaving, so a legitimate re-validation
 * after a failure (validation_failed → triaged → validating) gets its own job while a
 * duplicate click does not.
 */
export async function queueValidation(
  feedbackId: string,
  actorUserId?: string | null
): Promise<{ queued: boolean }> {
  const { from } = await transition(feedbackId, "validating", {
    actorUserId: actorUserId ?? null,
    actorKind: actorUserId ? "user" : "system",
    reason: "Queued for automated checklist evaluation.",
  });
  return enqueue({
    jobType: "validate",
    feedbackId,
    idempotencyKey: `validate:${feedbackId}:${from}`,
  });
}

/**
 * Stage 2 — render a build prompt for human review.
 *
 * Four gates before a single token is spent, in this order and all of them fail-closed:
 * the kill switch, the checklist verdict, the change-type approvals, and the capability
 * approvals. Checking the switch first means a paused pipeline costs nothing; checking the
 * approvals before the call means an item waiting on a product owner does not get a prompt
 * written speculatively that would then create pressure to approve it.
 */
export async function handlePromptWriteJob(job: UatJob): Promise<void> {
  const feedbackId = job.feedbackId;
  if (!feedbackId) throw new TerminalJobError("prompt_write job carries no feedback_id");

  const gate = await switchEnabled("prompt_writer_enabled", process.env.UAT_PROMPT_WRITER_ENABLED);
  if (!gate.enabled) throw new TerminalJobError(gate.reason ?? "prompt writer disabled");

  const [fbRows] = await db.query<FeedbackRow[]>(
    `SELECT id, feedback_code, title, body_redacted, kind, page_route, status, change_type
       FROM uat_feedback WHERE id = ? LIMIT 1`,
    [feedbackId]
  );
  if (!fbRows.length) throw new TerminalJobError(`feedback ${feedbackId} no longer exists`);
  const fb = fbRows[0] as FeedbackRow & { feedback_code: string; change_type: ChangeType | null };

  // CG-01/02/03. A prompt written before its approvals exist is a fait accompli, so this is
  // checked here rather than at dispatch.
  const ct = await changeTypeGate(feedbackId, fb.change_type);
  if (!ct.satisfied) {
    throw new TerminalJobError(
      `Change-type governance is not satisfied: ${ct.reason ?? "approvals outstanding"}.`
    );
  }

  const [scanRows] = await db.query<ScanRow[]>(
    `SELECT * FROM uat_static_scan WHERE feedback_id = ? ORDER BY created_at DESC LIMIT 1`,
    [feedbackId]
  );
  if (!scanRows.length) throw new TerminalJobError("no static scan; refusing to plan a change");
  const scan = scanFromRow(scanRows[0]);

  const attemptNo = Number(job.payload.attemptNo ?? 1);
  const result = await runPromptWriter(
    {
      feedbackId,
      feedbackCode: fb.feedback_code,
      title: fb.title,
      bodyRedacted: fb.body_redacted ?? "",
      changeType: ct.changeType,
      restatedRequirement: String(job.payload.restatedRequirement ?? fb.title),
      scan,
      attemptNo,
      previousFailure: (job.payload.previousFailure as string | undefined) ?? null,
    },
    {
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_DEFAULT_MODEL,
      effort: env.ANTHROPIC_EFFORT,
      maxTokens: env.ANTHROPIC_MAX_OUTPUT_TOKENS,
      timeoutMs: env.ANTHROPIC_TIMEOUT_MS,
      dailyCapUsd: env.UAT_DAILY_LLM_USD_CAP,
      enabled: true,
    }
  );

  if (!result.ok) {
    await transition(feedbackId, "validation_failed", {
      actorKind: "system",
      reason: result.failureReason ?? "The prompt writer did not complete.",
    });
    throw Object.assign(new Error(result.failureReason ?? "prompt writer failed"), {
      terminal: Boolean(result.terminal),
    });
  }

  await savePrompt({
    feedbackId,
    attemptNo,
    templateVersion: PROMPT_WRITER_TEMPLATE_VERSION,
    promptText: result.promptText!,
    allowedPaths: result.allowlist!.allowed,
    forbiddenPaths: result.allowlist!.forbidden,
    mandatoryTests: result.mandatoryTests ?? [],
    branchSlug: result.branchSlug!,
    acceptanceCriteria: result.acceptanceCriteria ?? [],
    rollbackPlan: result.rollbackPlan ?? "",
    llmCallId: result.llmCallId ?? null,
  });

  await recordEvent(feedbackId, "prompt_generated", {
    actorKind: "llm",
    message: `Build prompt rendered (${PROMPT_WRITER_TEMPLATE_VERSION}), branch ${result.branchSlug}.`,
    detail: {
      allowedPaths: result.allowlist!.allowed,
      // Surfaced, not hidden: a reviewer must see what the model asked for and was denied,
      // or they will approve a plan believing it is intact.
      removedPaths: result.allowlist!.removed,
      mandatoryTests: result.mandatoryTests,
      promptSha256: result.promptSha256,
    },
  });

  await transition(feedbackId, "prompt_ready", {
    actorKind: "llm",
    reason: "A build prompt is ready for human review. Nothing has been dispatched.",
  });
}

let registered = false;

/** Idempotent: a second call is a no-op, so double registration cannot double-handle a job. */
export function registerUatJobHandlers(): void {
  if (registered) return;
  registerJobHandler("validate", (job) => handleValidateJob(job));
  registerJobHandler("prompt_write", (job) => handlePromptWriteJob(job));
  registered = true;
}
