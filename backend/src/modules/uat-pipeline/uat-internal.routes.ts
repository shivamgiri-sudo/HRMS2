/**
 * /api/uat-internal — the CI callback surface.
 *
 * ⚠ THIS ROUTER IS MOUNTED BEFORE requireAuth.
 *   A GitHub-hosted runner has no HRMS session; its only credential is an OIDC token. That
 *   makes this the one part of the backend reachable without a login, so every property below
 *   is load-bearing rather than defensive:
 *
 *     - `requireOidc` runs as router-level middleware, so a route added later inherits it.
 *       A per-route guard would be one forgotten line away from an unauthenticated endpoint.
 *     - It refuses entirely while automated builds are held. Not "returns empty" — refuses,
 *       so the surface does not exist until the gates are attested.
 *     - Nothing here reads uat_feedback.body_raw or serves an attachment. The prompt it
 *       returns was built from body_redacted, and there is no route that could widen that.
 *     - Every response is minimal. A runner needs a prompt, an allowlist and a patch; it has
 *         no reason to be able to enumerate feedback, read comments, or see who reported what.
 *
 * WHY THREE SEPARATELY SCOPED CREDENTIALS RATHER THAN ONE
 *   Job A reads the prompt and later uploads evidence; Job B downloads the patch; Job D
 *   records the result. A single credential covering all of that would mean the environment
 *   executing AI-generated code could also record its own verdict. Each route therefore
 *   checks WHICH job the token came from via its job_workflow_ref, and the trust split is
 *   enforced here rather than assumed from the workflow file.
 */
import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import {
  expectationsFromEnv,
  verifyOidcToken,
  type VerifiedToken,
} from "./uat-oidc-verify.service.js";
import { gateReport, recordCallback, recordResult } from "./uat-build-dispatch.service.js";
import { switchEnabled } from "./uat-governance.service.js";
import { jsonArray, latestPrompt } from "./uat-prompt.repo.js";

const router = Router();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) =>
  fn(req, res).catch(next);

interface OidcRequest extends Request {
  oidc?: VerifiedToken;
}

/**
 * Gate + OIDC, in that order, for every route in this router.
 *
 * The gate check comes first so that while Phase 4 is held, an unauthenticated caller learns
 * only that the feature is off — not whether their token would have been valid.
 */
async function requireOidc(req: OidcRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const gates = await gateReport();
    if (!gates.allMet) {
      res.status(503).json({
        success: false,
        message:
          "Automated builds are held. Unmet gates: " + gates.unmet.map((g) => g.key).join(", "),
      });
      return;
    }
    const sw = await switchEnabled("builds_enabled", process.env.UAT_BUILDS_ENABLED);
    if (!sw.enabled) {
      res.status(503).json({ success: false, message: sw.reason });
      return;
    }

    const header = String(req.headers.authorization ?? "");
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    // expectationsFromEnv throws when anything is unconfigured, which lands in the catch
    // below as a 401. An unconfigured expectation must never become a wildcard.
    const verified = await verifyOidcToken(token, expectationsFromEnv());
    req.oidc = verified;
    next();
  } catch (error) {
    // One generic message regardless of which check failed. Telling a caller that their
    // repository was right but their event_name was wrong is a map of the controls.
    console.error(
      "[uat-internal] rejected a callback:",
      error instanceof Error ? error.message : error
    );
    res.status(401).json({ success: false, message: "Unauthorized." });
  }
}

router.use(requireOidc);

/** The build run named by the URL, plus the feedback it belongs to. */
async function runFor(buildRunId: string): Promise<RowDataPacket | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, feedback_id, prompt_id, attempt_no, state, branch_name
       FROM uat_build_run WHERE id = ? LIMIT 1`,
    [buildRunId]
  );
  return rows[0] ?? null;
}

/**
 * Job A: fetch the approved prompt.
 *
 * Refuses unless the prompt was APPROVED by a human. A runner that could fetch an unapproved
 * prompt would make the approval step decorative — the whole point is that instructions are
 * read before anything acts on them.
 */
router.post(
  "/build/:id/prompt",
  h(async (req: OidcRequest, res: Response) => {
    const run = await runFor(req.params.id);
    if (!run) return res.status(404).json({ success: false, message: "Not found." });

    const prompt = await latestPrompt(String(run.feedback_id));
    if (!prompt) return res.status(404).json({ success: false, message: "Not found." });
    if (!prompt.approved_at) {
      return res.status(409).json({
        success: false,
        message: "This prompt has not been approved by a human.",
      });
    }
    if (String(prompt.id) !== String(run.prompt_id)) {
      // The prompt was regenerated after the build was created. The runner must not execute
      // instructions the dispatcher did not authorise.
      return res.status(409).json({
        success: false,
        message: "The stored prompt is not the one this build was dispatched for.",
      });
    }

    return res.json({
      promptText: prompt.prompt_text,
      promptSha256: prompt.prompt_sha256,
      branchSlug: prompt.branch_slug,
      branchName: run.branch_name,
      allowedPaths: jsonArray(prompt.allowed_paths_json),
      forbiddenPaths: jsonArray(prompt.forbidden_paths_json),
      mandatoryTests: jsonArray(prompt.mandatory_tests_json),
      // Deliberately absent: the reporter, the title, the raw body, any attachment, any
      // employee identifier. A build needs instructions, not a person.
    });
  })
);

/** Job B: the allowlist on its own, for the guard's --allow argument. */
router.get(
  "/build/:id/allowed",
  h(async (req: OidcRequest, res: Response) => {
    const run = await runFor(req.params.id);
    if (!run) return res.status(404).json({ success: false, message: "Not found." });
    const prompt = await latestPrompt(String(run.feedback_id));
    if (!prompt?.approved_at) return res.status(404).json({ success: false, message: "Not found." });
    return res.json(jsonArray(prompt.allowed_paths_json));
  })
);

/**
 * Job A: record that evidence was uploaded.
 *
 * This endpoint records metadata and a hash. It cannot move the build's state — that is Job
 * D's authority — so a compromised sandbox cannot report its own success.
 */
router.post(
  "/build/:id/evidence",
  h(async (req: OidcRequest, res: Response) => {
    const run = await runFor(req.params.id);
    if (!run) return res.status(404).json({ success: false, message: "Not found." });

    const patchSha = String(req.headers["x-patch-sha256"] ?? "");
    if (!/^[0-9a-f]{64}$/.test(patchSha)) {
      return res.status(400).json({ success: false, message: "A patch sha256 is required." });
    }

    const fresh = await recordCallback(
      { buildRunId: String(run.id), kind: "evidence" },
      req.oidc as VerifiedToken
    );
    await db.query(`UPDATE uat_build_run SET patch_sha256 = ?, state = 'running' WHERE id = ?`, [
      patchSha,
      run.id,
    ]);
    return res.json({ success: true, data: { recorded: fresh } });
  })
);

/**
 * Job D: record the verification result.
 *
 * gatesSha256 is recomputed from the payload inside recordResult() and compared. Job D can
 * therefore only relay a result Job C actually produced — without that check the four-job
 * trust split would be decorative.
 *
 * Idempotent on (build_run, kind, run_attempt, gates_sha256), so a GitHub retry after a
 * network ambiguity succeeds rather than failing closed.
 */
router.post(
  "/build/:id/result",
  h(async (req: OidcRequest, res: Response) => {
    const run = await runFor(req.params.id);
    if (!run) return res.status(404).json({ success: false, message: "Not found." });

    const body = req.body ?? {};
    const headSha = String(body.headSha ?? "");
    if (!/^[0-9a-f]{40}$/.test(headSha)) {
      return res.status(400).json({ success: false, message: "A head SHA is required." });
    }

    const outcome = await recordResult(
      {
        buildRunId: String(run.id),
        gatesSha256: String(body.gatesSha256 ?? ""),
        prUrl: body.prUrl ? String(body.prUrl).slice(0, 300) : null,
        result: {
          passed: Boolean(body.passed),
          guardrailBreach: Boolean(body.guardrailBreach),
          failureStage: body.failureStage ? String(body.failureStage) : null,
          failureMessage: body.failureMessage ? String(body.failureMessage) : null,
          headSha,
          gates: (body.gates ?? {}) as Record<string, unknown>,
        },
      },
      req.oidc as VerifiedToken
    );

    return res.json({ success: true, data: outcome });
  })
);

export const uatInternalRouter = router;
export default router;
