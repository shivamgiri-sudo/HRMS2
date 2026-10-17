/**
 * Branch Health Report — on-demand .xlsx export for a single branch.
 *
 * The report itself is cron/email-only (see index.ts/scheduler.ts); this route lets an
 * admin pull the same underlying data for one branch as a workbook, without waiting for
 * the scheduled email. Headcount movement is broken out both by process and by LOB.
 */
import { Router } from "express";
import ExcelJS from "exceljs";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getCurrentDateIST } from "../../shared/istDate.js";
import { fetchAllBranchHealthData } from "./query.js";
import { buildBranchHealthReport } from "./metrics.js";

export const branchHealthExportRouter = Router();
branchHealthExportRouter.use(requireAuth);

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

branchHealthExportRouter.get(
  "/export",
  requireRole("super_admin", "hr_admin", "branch_head"),
  h(async (req, res) => {
    const branchName = String(req.query.branch ?? "").trim();
    if (!branchName) {
      return res.status(400).json({ success: false, message: "Query param 'branch' is required, e.g. ?branch=NOIDA-2" });
    }

    const reportDate = getCurrentDateIST();
    const raw = await fetchAllBranchHealthData(branchName, reportDate);
    if (raw.branchId == null) {
      return res.status(404).json({ success: false, message: `Branch '${branchName}' not found or has no health-report data` });
    }
    const report = buildBranchHealthReport(branchName, reportDate, raw);
    const hc = report.raw.headcount;

    const wb = new ExcelJS.Workbook();
    wb.creator = "MAS Callnet HRMS";
    wb.created = new Date();

    const summary = wb.addWorksheet("Summary");
    summary.columns = [{ width: 28 }, { width: 24 }];
    summary.addRows([
      ["Branch", report.branch],
      ["Report Date", report.reportDate],
      ["Overall Status", report.overallStatus],
      ["Active Headcount", hc.totalActive],
      ["Joined Today", hc.joinedToday],
      ["Joined MTD", hc.joinedMtd],
      ["Left Today", hc.leftToday],
      ["Left MTD", hc.leftMtd],
      ["Net MTD", signed(hc.joinedMtd - hc.leftMtd)],
      ["Mandate Seats Total", hc.mandateSeatsTotal ?? "—"],
      ["Exits Due in 30d", hc.upcomingExits],
      ["Exits Past LWD, Still Active", hc.exitsNotClosed],
    ]);
    summary.getColumn(1).font = { bold: true };

    const byProcess = wb.addWorksheet("Headcount — Process-wise");
    byProcess.columns = [
      { header: "Process", key: "process", width: 28 },
      { header: "Mandate Seats", key: "mandateSeats", width: 14 },
      { header: "Active", key: "active", width: 10 },
      { header: "Joined Today", key: "joinedToday", width: 12 },
      { header: "Joined MTD", key: "joinedMtd", width: 12 },
      { header: "Left Today", key: "leftToday", width: 10 },
      { header: "Left MTD", key: "leftMtd", width: 10 },
      { header: "Net MTD", key: "netMtd", width: 10 },
    ];
    byProcess.getRow(1).font = { bold: true };
    for (const r of hc.byProcess) {
      byProcess.addRow({
        process: r.mandateSource === "db_bill" ? `${r.process} *` : r.process,
        mandateSeats: r.mandateSeats ?? "—",
        active: r.active,
        joinedToday: r.joinedToday,
        joinedMtd: r.joinedMtd,
        leftToday: r.leftToday,
        leftMtd: r.leftMtd,
        netMtd: signed(r.joinedMtd - r.leftMtd),
      });
      // The process's active headcount split by LOB, indented under it.
      for (const l of r.lobs ?? []) {
        byProcess.addRow({ process: `    LOB: ${l.lob}`, active: l.active }).font = { italic: true, color: { argb: "FF64748B" } };
      }
    }
    byProcess.addRow({
      process: "Total",
      mandateSeats: hc.mandateSeatsTotal ?? "—",
      active: hc.totalActive,
      joinedToday: hc.joinedToday,
      joinedMtd: hc.joinedMtd,
      leftToday: hc.leftToday,
      leftMtd: hc.leftMtd,
      netMtd: signed(hc.joinedMtd - hc.leftMtd),
    }).font = { bold: true };

    const byLob = wb.addWorksheet("Headcount — LOB-wise");
    byLob.columns = [
      { header: "LOB", key: "lob", width: 28 },
      { header: "Active Headcount", key: "active", width: 16 },
    ];
    byLob.getRow(1).font = { bold: true };
    for (const r of hc.byLob) {
      byLob.addRow({ lob: r.lob, active: r.active });
    }
    byLob.addRow({ lob: "Total", active: hc.byLob.reduce((n, r) => n + r.active, 0) }).font = { bold: true };

    const safeBranch = branchName.replace(/[^a-zA-Z0-9-]+/g, "_");
    const filename = `branch-health-report_${safeBranch}_${reportDate}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    const buffer = await wb.xlsx.writeBuffer();
    res.send(Buffer.from(buffer));
  }),
);
