import { Router } from "express";

// Compatibility mount reserved for employee governance endpoints added by
// production hardening branches. The secured employee routes carry the current
// governance behavior; this router keeps the app bootable when the mount exists.
export const employeeGovernanceRouter = Router();
