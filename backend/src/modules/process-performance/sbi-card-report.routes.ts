import { Router } from "express";
import { requireRole } from "../../middleware/requireRole.js";
import {
  buildAgentMis,
  buildDialerMis,
  buildCampaignPerformance,
  buildPenEstimation,
  buildDowntimeTracker,
  buildFirstCall,
} from "./sbi-card-report-builder.js";
import { query } from "../../db/mysql.js";

const router = Router();

const VIEWER_ROLES = requireRole([
  "super_admin",
  "admin",
  "hr_admin",
  "finance",
  "operations_manager",
  "process_manager",
  "branch_head",
  "wfm",
]);

interface ReportMeta {
  id: string;
  name: string;
  filename: (params: Record<string, string>) => string;
  filters: Array<{
    key: string;
    label: string;
    type: string;
    options?: string[];
  }>;
}

const REPORTS: ReportMeta[] = [
  {
    id: "agent-mis",
    name: "Agent MIS",
    filename: (p) => `Agent_MIS_${p.from}_${p.to}.xlsx`,
    filters: [
      { key: "from", label: "From", type: "date" },
      { key: "to", label: "To", type: "date" },
      {
        key: "team",
        label: "Team",
        type: "select",
        options: ["", "HIGHBAL", "LOWBAL"],
      },
      { key: "teamLeader", label: "Team Leader", type: "text" },
      { key: "agent", label: "Agent (name / ID)", type: "text" },
    ],
  },
  {
    id: "dialer-mis",
    name: "Dialer MIS",
    filename: (p) => `Dialer_MIS_${p.from}_${p.to}.xlsx`,
    filters: [
      { key: "from", label: "From", type: "date" },
      { key: "to", label: "To", type: "date" },
      { key: "campaign", label: "Campaign sheet", type: "text" },
    ],
  },
  {
    id: "campaign-performance",
    name: "Campaign Performance",
    filename: (p) => `Campaign_Performance_${p.from}_${p.to}.xlsx`,
    filters: [
      { key: "from", label: "From", type: "date" },
      { key: "to", label: "To", type: "date" },
      { key: "campaign", label: "Campaign (contains)", type: "text" },
    ],
  },
  {
    id: "campaign-1600",
    name: "Campaign Performance 1600 Series",
    filename: (p) => `Campaign_1600_${p.from}_${p.to}.xlsx`,
    filters: [
      { key: "from", label: "From", type: "date" },
      { key: "to", label: "To", type: "date" },
      { key: "campaign", label: "Campaign (contains)", type: "text" },
    ],
  },
  {
    id: "first-call",
    name: "First Call Report",
    filename: (p) => `First_Call_${p.from}_${p.to}.xlsx`,
    filters: [
      { key: "from", label: "From", type: "date" },
      { key: "to", label: "To", type: "date" },
    ],
  },
  {
    id: "pen-estimation",
    name: "Pen Estimation Report",
    filename: (p) => `Pen_Estimation_${p.date || p.to}.xlsx`,
    filters: [{ key: "date", label: "Date", type: "date" }],
  },
  {
    id: "downtime-tracker",
    name: "Downtime Tracker",
    filename: (p) => `Downtime_Tracker_${p.from}_${p.to}.xlsx`,
    filters: [
      { key: "from", label: "From", type: "date" },
      { key: "to", label: "To", type: "date" },
      { key: "site", label: "Site", type: "text" },
      {
        key: "status",
        label: "Status",
        type: "select",
        options: ["", "Open", "Resolved"],
      },
    ],
  },
];

// GET /api/process-performance/sbi-card-reports
router.get("/sbi-card-reports", VIEWER_ROLES, (_req, res) => {
  res.json({ success: true, data: REPORTS });
});

// GET /api/process-performance/sbi-card-reports/:id/download
router.get(
  "/sbi-card-reports/:id/download",
  VIEWER_ROLES,
  async (req, res) => {
    const report = REPORTS.find((r) => r.id === req.params.id);
    if (!report) {
      res.status(404).json({ success: false, error: "Unknown report" });
      return;
    }

    const p = req.query as Record<string, string>;

    const today = new Date().toISOString().slice(0, 10);
    const monthStart = today.slice(0, 8) + "01";

    // Resolve process_id from process_code SBI_CARD
    const pmRows = await query<{ id: string }>(
      "SELECT id FROM process_master WHERE process_code = ? LIMIT 1",
      ["SBI_CARD"]
    );
    const processId = pmRows[0]?.id;

    try {
      let buffer: Buffer;
      const params = {
        from: p.from || monthStart,
        to: p.to || today,
        date: p.date || p.to || today,
        processId,
        campaign: p.campaign,
        team: p.team,
        teamLeader: p.teamLeader,
        agent: p.agent,
        site: p.site,
        status: p.status,
      };

      switch (report.id) {
        case "agent-mis":
          buffer = await buildAgentMis(params);
          break;
        case "dialer-mis":
          buffer = await buildDialerMis(params);
          break;
        case "campaign-performance":
          buffer = await buildCampaignPerformance(params);
          break;
        case "campaign-1600":
          buffer = await buildCampaignPerformance({ ...params, series: "1600" });
          break;
        case "first-call":
          buffer = await buildFirstCall(params);
          break;
        case "pen-estimation":
          buffer = await buildPenEstimation(params);
          break;
        case "downtime-tracker":
          buffer = await buildDowntimeTracker(params);
          break;
        default:
          res.status(404).json({ success: false, error: "Not implemented" });
          return;
      }

      const filename = report.filename(params);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.send(buffer);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
    }
  }
);

export { router as sbiCardReportRouter };
