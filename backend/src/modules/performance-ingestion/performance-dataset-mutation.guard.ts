import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { performanceGovernanceService } from "./performance-governance.service.js";

const ADMIN_ROLES = new Set(["super_admin", "admin"]);
const EXCEPTIONAL_PUBLICATION_FLAGS = [
  "allowPartialPublication",
  "allowEmptyPublication",
] as const;

function actorRoles(req: AuthenticatedRequest): Set<string> {
  return new Set(
    [req.authUser?.role, ...(req.authUser?.roles ?? [])]
      .filter((role): role is string => Boolean(role))
      .map((role) => role.trim().toLowerCase()),
  );
}

function flagValue(config: unknown, flag: string): boolean {
  if (!config || typeof config !== "object" || Array.isArray(config)) return false;
  return (config as Record<string, unknown>)[flag] === true;
}

export async function performanceDatasetMutationGuard(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  if (req.method !== "POST" || req.path !== "/datasets") return next();

  try {
    const input = req.body as {
      id?: string;
      datasetKey?: string;
      config?: Record<string, unknown>;
    };
    const roles = actorRoles(req);
    const isAdmin = [...roles].some((role) => ADMIN_ROLES.has(role));
    const existing = input.id
      ? await performanceGovernanceService.getDataset(req.authUser!.id, input.id)
      : null;

    if (
      existing &&
      String(input.datasetKey ?? "").trim() !== existing.dataset.datasetKey
    ) {
      return res.status(409).json({
        success: false,
        error: "Dataset key is immutable after creation because mappings, exceptions, and lineage depend on it.",
        code: "PERFORMANCE_DATASET_KEY_IMMUTABLE",
      });
    }

    if (!isAdmin) {
      for (const flag of EXCEPTIONAL_PUBLICATION_FLAGS) {
        const requested = flagValue(input.config, flag);
        const current = flagValue(existing?.dataset.config, flag);
        if (requested !== current) {
          return res.status(403).json({
            success: false,
            error: `${flag} can only be changed by Super Admin or Admin.`,
            code: "PERFORMANCE_EXCEPTIONAL_CONTROL_ADMIN_ONLY",
          });
        }
      }
    }

    return next();
  } catch (error) {
    return next(error);
  }
}
