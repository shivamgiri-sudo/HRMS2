import { invalidateAuthContextCache } from "../../../middleware/authMiddleware.js";
import { dispatchJoinProvisioningTasks } from "../../it-provisioning/it-provisioning.service.js";
import type { FollowUpDeps } from "./rejoinFollowUps.js";

/**
 * The real wiring, kept out of rejoinFollowUps.ts on purpose: tests that mock authMiddleware with only
 * requireAuth would otherwise fail on the missing invalidateAuthContextCache export.
 */
export const realFollowUpDeps: FollowUpDeps = {
  invalidateAuthContextCache,
  dispatchJoinProvisioningTasks: (input) => dispatchJoinProvisioningTasks(input),
};
