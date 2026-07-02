import { Router } from "express";

export const employeeVerifyRouter = Router();

employeeVerifyRouter.get("/:employeeCode", (req, res) => {
  res.json({ success: true, data: { employeeCode: req.params.employeeCode, verified: false } });
});
