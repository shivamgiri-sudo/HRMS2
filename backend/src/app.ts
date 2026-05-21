import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";

import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { healthRouter } from "./routes/health.routes.js";
import { processRouter } from "./modules/process/process.routes.js";
import { integrationRouter } from "./modules/integration-hub/integration.routes.js";
import { wfmRouter } from "./modules/wfm/wfm.routes.js";
import { leaveRouter } from "./modules/leave/leave.routes.js";
import { payrollRouter } from "./modules/payroll/payroll.routes.js";
import { employeeRouter } from "./modules/employees/employee.routes.js";
import { kpiRouter } from "./modules/kpi/kpi.routes.js";
import { portalRouter } from "./modules/portal/portal.routes.js";

export const app = express();

app.use(
  helmet({
    crossOriginResourcePolicy: false
  })
);

app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true
  })
);

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

app.get("/", (_req, res) => {
  return res.json({
    success: true,
    service: "MCN HRMS Backend API",
    version: "1.0.0"
  });
});

app.use("/api/health", healthRouter);
app.use("/api/processes", processRouter);
app.use("/api/integration-hub", integrationRouter);
app.use("/api/wfm", wfmRouter);
app.use("/api/leave", leaveRouter);
app.use("/api/payroll", payrollRouter);
app.use("/api/employees", employeeRouter);
app.use("/api/kpi", kpiRouter);
app.use("/api/portal", portalRouter);

app.use(notFoundHandler);
app.use(errorHandler);
