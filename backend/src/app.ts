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
import { rosterRouter } from "./modules/wfm/roster.routes.js";
import { leaveRouter } from "./modules/leave/leave.routes.js";
import { payrollRouter } from "./modules/payroll/payroll.routes.js";
import { employeeRouter } from "./modules/employees/employee.routes.js";
import { kpiRouter } from "./modules/kpi/kpi.routes.js";
import { portalRouter } from "./modules/portal/portal.routes.js";
import { atsRouter } from "./modules/ats/ats.routes.js";
import { exitRouter } from "./modules/exit/exit.routes.js";
import { migrationRouter } from "./modules/migration/migration.routes.js";
import { accessRouter } from "./modules/access/access.routes.js";
import { orgRouter } from "./modules/org/org.routes.js";
import { workflowRouter } from "./modules/workflow/workflow.routes.js";
import { lifecycleRouter } from "./modules/lifecycle/lifecycle.routes.js";
import { assetsRouter } from "./modules/assets/assets.routes.js";
import { helpdeskRouter } from "./modules/helpdesk/helpdesk.routes.js";
import { lettersRouter } from "./modules/letters/letters.routes.js";
import { atsExtRouter } from "./modules/ats-extensions/ats-ext.routes.js";
import { wfmExtRouter } from "./modules/wfm-extensions/wfm-ext.routes.js";
import { managementRouter } from "./modules/management/management.routes.js";
import { rosterGovRouter } from "./modules/roster/roster.governance.routes.js";
import { rtaRouter } from "./modules/rta/rta.routes.js";
import { accountControlRouter } from "./modules/account-control/account.control.routes.js";
import { workforceMandateRouter } from "./modules/workforce-mandate/workforce.mandate.routes.js";
import { lmsRouter } from "./modules/lms/lms.routes.js";
import { benefitsRouter } from "./modules/benefits/benefits.routes.js";
import { careerRouter } from "./modules/career/career.routes.js";
import { erpRouter } from "./modules/erp/erp.routes.js";
import { inboxRouter } from "./modules/inbox/inbox.routes.js";
import { mobilityRouter } from "./modules/mobility/mobility.routes.js";
import { goalsRouter } from "./modules/goals/goals.routes.js";
import { jobsRouter } from "./modules/jobs/jobs.routes.js";
import { complianceRouter } from "./modules/compliance/compliance.routes.js";
import { privacyRouter } from "./modules/privacy/privacy.routes.js";
import { performanceFeedbackRouter } from "./modules/performance-feedback/performance-feedback.routes.js";
import { engagementRouter } from "./modules/engagement/engagement.routes.js";
import { communicationRouter } from "./modules/communication/communication.routes.js";
import { attendanceEngineRouter } from "./modules/wfm/attendance-engine.routes.js";
import customizationRouter from "./modules/customization/customization.routes.js";
import { rosterMasterRouter } from "./modules/roster/roster-master.routes.js";
import rosterCapacityRouter from "./modules/roster/roster-capacity.routes.js";

export const app = express();

app.use(
  helmet({
    crossOriginResourcePolicy: false
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:") || origin === env.FRONTEND_URL) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
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
app.use("/api/wfm/roster", rosterRouter);
app.use("/api/leave", leaveRouter);
app.use("/api/payroll", payrollRouter);
app.use("/api/employees", employeeRouter);
app.use("/api/kpi", kpiRouter);
app.use("/api/portal", portalRouter);
app.use("/api/ats", atsRouter);
app.use("/api/exit", exitRouter);
app.use("/api/migration", migrationRouter);
app.use("/api/access", accessRouter);
app.use("/api/org", orgRouter);
app.use("/api/workflow", workflowRouter);
app.use("/api/lifecycle", lifecycleRouter);
app.use("/api/assets-mgmt", assetsRouter);
app.use("/api/helpdesk", helpdeskRouter);
app.use("/api/letters", lettersRouter);
app.use("/api/ats-ext", atsExtRouter);
app.use("/api/wfm-ext", wfmExtRouter);
app.use("/api/management", managementRouter);
app.use("/api/roster-gov", rosterGovRouter);
app.use("/api/rta", rtaRouter);
app.use("/api/account-control", accountControlRouter);
app.use("/api/workforce-mandate", workforceMandateRouter);
app.use("/api/lms", lmsRouter);
app.use("/api/benefits", benefitsRouter);
app.use("/api/career", careerRouter);
app.use("/api/erp", erpRouter);
app.use("/api/inbox", inboxRouter);
app.use("/api/mobility", mobilityRouter);
app.use("/api/goals", goalsRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/compliance", complianceRouter);
app.use("/api/privacy", privacyRouter);
app.use("/api/performance-feedback", performanceFeedbackRouter);
app.use("/api/engagement", engagementRouter);
app.use("/api/communication", communicationRouter);
app.use('/api/wfm/attendance', attendanceEngineRouter);
app.use("/api/customization", customizationRouter);
app.use("/api/roster-master", rosterMasterRouter);
app.use("/api/roster-capacity", rosterCapacityRouter);

app.use(notFoundHandler);
app.use(errorHandler);
