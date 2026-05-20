import { Router } from "express";
import { pingDb } from "../db/mysql.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  let dbStatus: "ok" | "error" = "ok";
  try {
    await pingDb();
  } catch {
    dbStatus = "error";
  }

  return res.json({
    success: true,
    service: "MCN HRMS Backend API",
    status: "healthy",
    db: dbStatus,
    timestamp: new Date().toISOString(),
  });
});
