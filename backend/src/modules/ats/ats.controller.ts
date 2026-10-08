import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { atsService } from "./ats.service.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { getUserRoleContext } from "../../shared/roleResolver.js";
import { TtlCache } from "../../shared/ttlCache.js";
import { resolveDashboardScopeForRequest } from "../../shared/dashboardScope.js";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { branchNameVariants } from "./ats-vocabulary.js";
import {
  createCandidateSchema,
  updateCandidateSchema,
  moveStagingSchema,
  candidateFiltersSchema,
  createOnboardingBridgeSchema,
  updateOnboardingBridgeSchema,
} from "./ats.validation.js";

/**
 * ats_candidate records the branch and process a candidate APPLIED FOR as free text
 * (applied_for_branch / applied_for_process), not as a foreign key — so a scope expressed
 * in ids cannot filter it until the ids are turned back into the names the rows carry.
 *
 * An id with no matching master row yields nothing rather than a wildcard: a scope that
 * cannot be resolved must narrow to zero, never widen to everything.
 */
async function resolveNames(
  table: "branch_master" | "process_master",
  column: string,
  ids: readonly string[],
): Promise<string[]> {
  const wanted = [
    ...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean)),
  ];
  if (wanted.length === 0) return [];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ${column} AS name FROM ${table} WHERE id IN (${wanted.map(() => "?").join(", ")})`,
    wanted,
  );
  return (rows as RowDataPacket[])
    .map((row) => String((row as { name?: unknown }).name ?? "").trim())
    .filter(Boolean);
}

const resolveBranchNames = (ids: readonly string[]) =>
  resolveNames("branch_master", "branch_name", ids);
const resolveProcessNames = (ids: readonly string[]) =>
  resolveNames("process_master", "process_name", ids);

// /api/ats/stats is read by five dashboard layouts and takes several seconds cold. The payload
// depends only on the date window and the resolved branch/process NAMES (never on the user),
// so viewers with the same filters share one computation per 30s window, and concurrent
// requests share the in-flight one instead of each running the whole query batch.
const ATS_STATS_TTL_MS = 30_000;
// Stale-while-revalidate: ~9-16s cold, so a visit after the TTL gets the previous result at once while one refresh runs.
export const atsStatsCache = new TtlCache<unknown>({ maxEntries: 100, defaultTtlMs: ATS_STATS_TTL_MS, defaultStaleMs: 30 * 60_000 });

export const atsController = {
  async listCandidates(req: AuthenticatedRequest, res: Response) {
    const filters = candidateFiltersSchema.parse(req.query);
    const filtersWithScope = {
      ...filters,
      scopeFilter: (req as AuthenticatedRequest & { scopeFilter?: unknown })
        .scopeFilter,
    };
    const result = await atsService.listCandidates(filtersWithScope);
    return res.json({ success: true, ...result });
  },

  async getCandidate(req: AuthenticatedRequest, res: Response) {
    // Row scope on the by-id path. listCandidates has always scoped; this did not, and the
    // SELECT behind it returns mobile, email, date_of_birth and gender. Same canonical rule
    // as the list route, so a recruiter cannot read a candidate outside their branches.
    const { assertCandidateInScope } = await import("./candidate-access.js");
    if (!(await assertCandidateInScope(req.authUser!.id, req.params.id, res)))
      return;

    const data = await atsService.getCandidate(req.params.id);
    return res.json({ success: true, data });
  },

  async createCandidate(req: AuthenticatedRequest, res: Response) {
    const input = createCandidateSchema.parse(req.body);
    // Convert numeric boolean fields to strings for CreateCandidateInput type compatibility
    const normalizedInput = {
      ...input,
      rotationalShift:
        input.rotationalShift != null
          ? String(input.rotationalShift)
          : input.rotationalShift,
      nightShiftOk:
        input.nightShiftOk != null
          ? String(input.nightShiftOk)
          : input.nightShiftOk,
      leavesIn3months:
        input.leavesIn3months != null
          ? String(input.leavesIn3months)
          : input.leavesIn3months,
      ownsTwoWheeler:
        input.ownsTwoWheeler != null
          ? String(input.ownsTwoWheeler)
          : input.ownsTwoWheeler,
      idProofAvailable:
        input.idProofAvailable != null
          ? String(input.idProofAvailable)
          : input.idProofAvailable,
      educationProofAvailable:
        input.educationProofAvailable != null
          ? String(input.educationProofAvailable)
          : input.educationProofAvailable,
    };
    // Normalization handled inside atsService.createCandidate
    const data = await atsService.createCandidate(
      normalizedInput,
      req.authUser?.id ?? null,
    );
    return res
      .status(201)
      .json({ success: true, data, message: "Candidate registered" });
  },

  async updateCandidate(req: AuthenticatedRequest, res: Response) {
    // Scope BEFORE parsing the body: an out-of-scope caller must get the same 404 whether
    // their payload is valid or not, or the validation error itself confirms the candidate.
    const { assertCandidateInScope } = await import("./candidate-access.js");
    if (!(await assertCandidateInScope(req.authUser!.id, req.params.id, res)))
      return;

    const input = updateCandidateSchema.parse(req.body);
    // Convert numeric boolean fields to strings for CreateCandidateInput type compatibility
    const normalizedInput = {
      ...input,
      rotationalShift:
        input.rotationalShift != null
          ? String(input.rotationalShift)
          : input.rotationalShift,
      nightShiftOk:
        input.nightShiftOk != null
          ? String(input.nightShiftOk)
          : input.nightShiftOk,
      leavesIn3months:
        input.leavesIn3months != null
          ? String(input.leavesIn3months)
          : input.leavesIn3months,
      ownsTwoWheeler:
        input.ownsTwoWheeler != null
          ? String(input.ownsTwoWheeler)
          : input.ownsTwoWheeler,
      idProofAvailable:
        input.idProofAvailable != null
          ? String(input.idProofAvailable)
          : input.idProofAvailable,
      educationProofAvailable:
        input.educationProofAvailable != null
          ? String(input.educationProofAvailable)
          : input.educationProofAvailable,
    };
    const data = await atsService.updateCandidate(
      req.params.id,
      normalizedInput,
      req.authUser!.id,
    );
    return res.json({ success: true, data, message: "Candidate updated" });
  },

  async moveStage(req: AuthenticatedRequest, res: Response) {
    // The most consequential of these: move-stage MUTATES a candidate's pipeline position,
    // so without scope a recruiter could advance or reject someone else's candidate.
    const { assertCandidateInScope } = await import("./candidate-access.js");
    if (!(await assertCandidateInScope(req.authUser!.id, req.params.id, res)))
      return;

    const input = moveStagingSchema.parse(req.body);
    const data = await atsService.moveStage(
      req.params.id,
      input.toStage,
      req.authUser!.id,
      input.remarks ?? undefined,
    );
    return res.json({
      success: true,
      data,
      message: `Moved to ${input.toStage}`,
    });
  },

  async listStageLogs(req: AuthenticatedRequest, res: Response) {
    // Stage history names the candidate's process/branch movement and the actors involved,
    // so it discloses as much as the record itself.
    const { assertCandidateInScope } = await import("./candidate-access.js");
    if (!(await assertCandidateInScope(req.authUser!.id, req.params.id, res)))
      return;

    const data = await atsService.listStageLogs(req.params.id);
    return res.json({ success: true, data });
  },

  async listOnboardingBridges(req: AuthenticatedRequest, res: Response) {
    const scopeFilter = await buildScopeWhereClause(
      req.authUser!.id,
      ["hr"],
      {
        branchId: "COALESCE(br.id, c.applied_for_branch)",
        processId: "c.applied_for_process",
      },
      { allowAdminBypass: true },
    );
    const data = await atsService.listOnboardingBridges(scopeFilter);
    return res.json({ success: true, data });
  },

  async createOnboardingBridge(req: AuthenticatedRequest, res: Response) {
    const input = createOnboardingBridgeSchema.parse(req.body);
    const data = await atsService.createOnboardingBridge(
      input,
      req.authUser!.id,
    );
    return res
      .status(201)
      .json({ success: true, data, message: "Onboarding bridge created" });
  },

  async updateOnboardingBridge(req: AuthenticatedRequest, res: Response) {
    const input = updateOnboardingBridgeSchema.parse(req.body);
    const data = await atsService.updateOnboardingBridge(
      req.params.id,
      input,
      req.authUser!.id,
    );
    return res.json({
      success: true,
      data,
      message: "Onboarding bridge updated",
    });
  },

  async listSourcingChannels(_req: AuthenticatedRequest, res: Response) {
    const data = await atsService.listSourcingChannels();
    return res.json({ success: true, data });
  },

  /**
   * Applies the caller's dashboard scope. This endpoint previously read `branch` and
   * `process` off the query string and applied nothing else, so a branch HR user, a
   * process manager and the CEO all saw the same org-wide ATS figures — and because the
   * dashboards send `branchId`/`processId` (ids) rather than `branch`/`process` (names),
   * the filter bar above those tiles was inert as well.
   *
   * ats_candidate stores applied_for_branch / applied_for_process as NAMES, so the scope's
   * ids are resolved to names before they can filter anything. A requested id narrows
   * within the entitlement and is ignored when it falls outside it; `branch`/`process`
   * name params still work for the callers that already use them.
   */
  async getDashboardStats(req: AuthenticatedRequest, res: Response) {
    const { fromDate, toDate, branch, process, branchId, processId } =
      req.query as Record<string, string | undefined>;

    const ctx = await getUserRoleContext(req.authUser!.id);
    const scope = await resolveDashboardScopeForRequest(
      req.authUser!,
      ctx.primaryRole,
    );

    const narrow = (
      asked: string | undefined,
      entitled: readonly string[],
    ): string[] => {
      const value = String(asked ?? "").trim();
      if (!value) return [...entitled];
      if (entitled.length === 0) return [value]; // ORG_ALL — nothing to narrow against
      return entitled.includes(value) ? [value] : [...entitled];
    };
    const branchIds = narrow(branchId, scope.branchIds);
    const processIds = narrow(processId, scope.processIds);

    const [branchNames, processNames] = await Promise.all([
      resolveBranchNames(branchIds),
      resolveProcessNames(processIds),
    ]);

    // A browser-supplied ?branch= / ?process= may only NARROW the entitlement (owner ruling 2026-10-01):
    // outside the caller's scope it is ignored and the entitled names are used (never widened). Only an
    // ORG_ALL scope honours an arbitrary name.
    const within = (asked: string | undefined, entitled: string[], expand: (n: string) => string[]) => {
      if (!asked) return undefined;
      if (scope.level === "ORG_ALL") return asked;
      const ok = new Set(entitled.flatMap((n) => expand(n)).map((n) => n.toLowerCase()));
      return ok.has(asked.trim().toLowerCase()) ? asked : undefined;
    };
    const statsFilters = {
      fromDate,
      toDate,
      branch: within(branch, branchNames, branchNameVariants) ?? branchNames,
      process: within(process, processNames, (n) => [n]) ?? processNames,
    };
    const asKey = (v: unknown) => JSON.stringify(v ?? null);
    const { value: data } = await atsStatsCache.getOrCompute(
      `ats-stats:${asKey(statsFilters.fromDate)}:${asKey(statsFilters.toDate)}:${asKey(statsFilters.branch)}:${asKey(statsFilters.process)}`,
      () => atsService.getDashboardStats(statsFilters),
    );
    return res.json({ success: true, data });
  },
};
