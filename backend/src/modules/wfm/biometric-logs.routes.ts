import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { biometricLogsService } from "./biometric-logs.service.js";

export const biometricLogsRouter = Router();

const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: any, next: any) => fn(req, res).catch(next);

biometricLogsRouter.use(requireAuth);

biometricLogsRouter.get("/employee/:employeeId", h(async (req, res) => {
  const employeeId = String(req.params.employeeId ?? "").trim();
  const fromDate = String(req.query.fromDate ?? "").trim();
  const toDate = String(req.query.toDate ?? "").trim();

  if (!employeeId) {
    return res.status(400).json({ success: false, error: "employeeId is required" });
  }
  if (!fromDate || !toDate) {
    return res.status(400).json({ success: false, error: "fromDate and toDate are required" });
  }

  const data = await biometricLogsService.getEmployeePunchLogs(
    req.authUser.id,
    employeeId,
    fromDate,
    toDate,
  );

  return res.json({ success: true, data });
}));
