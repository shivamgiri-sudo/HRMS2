import { invalidateAuthContextCache } from "../../../middleware/authMiddleware.js";
import { dispatchJoinProvisioningTasks } from "../../it-provisioning/it-provisioning.service.js";
import { settleAbsconderPayHoldOnRejoin } from "../../payroll/absconder-pay-release.service.js";
import type { FollowUpDeps } from "./rejoinFollowUps.js";

/**
 * The real wiring, kept out of rejoinFollowUps.ts on purpose: tests that mock authMiddleware with only
 * requireAuth would otherwise fail on the missing invalidateAuthContextCache export.
 */
export const realFollowUpDeps: FollowUpDeps = {
  invalidateAuthContextCache,
  settleAbsconderPayHold: (employeeId, actorUserId) => settleAbsconderPayHoldOnRejoin(employeeId, actorUserId),
  dispatchJoinProvisioningTasks: (input) => dispatchJoinProvisioningTasks(input),
};
