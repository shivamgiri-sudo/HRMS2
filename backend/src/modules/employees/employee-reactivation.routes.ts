import { Router } from "express";

export const employeeReactivationRouter = Router();

employeeReactivationRouter.get("/", (_req, res) => {
  res.json({ success: true, data: [] });
});
