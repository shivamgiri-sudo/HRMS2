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

interface FeedbackRow extends RowDataPacket {
  id: string;
  title: string;
  body_redacted: string | null;
  kind: string;
  page_route: string | null;
  status: string;
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
    `SELECT id, title, body_redacted, kind, page_route, status
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
  const s = scanRows[0];
  const scan: StaticScanResult = {
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

let registered = false;

/** Idempotent: a second call is a no-op, so double registration cannot double-handle a job. */
export function registerUatJobHandlers(): void {
  if (registered) return;
  registerJobHandler("validate", (job) => handleValidateJob(job));
  registered = true;
}
