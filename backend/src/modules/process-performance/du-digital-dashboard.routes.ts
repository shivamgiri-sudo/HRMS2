import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getDuDigitalDashboard, type DuDashboardLabel } from "./du-digital-dashboard.service.js";
import { spawn } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.use(requireAuth);

const VIEWER_ROLES = [
  "admin", "super_admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
];

function resolveLabel(country: string): DuDashboardLabel | null {
  const c = country.toUpperCase();
  return c === "KOREA" || c === "THAILAND" ? c : null;
}

router.get("/du-digital/:country/dashboard", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const label = resolveLabel(String(req.params.country ?? ""));
  if (!label) return res.status(400).json({ success: false, message: "country must be 'korea' or 'thailand'" });
  const data = await getDuDigitalDashboard(label, String(req.query.from ?? ""), String(req.query.to ?? ""));
  res.json({ success: true, data });
}));

export const duDigitalDashboardRouter = router;

const UPLOADER_ROLES = ["admin", "super_admin", "process_manager", "operations_manager"];
const UPLOADER_DIR = path.resolve(process.cwd(), "..", "uploader", "du_digital");
const PYTHON = process.env.DU_PYTHON || "py";

interface AutoCdrJob { status: "running" | "success" | "failed"; country: string; date: string; message: string; rows?: number }
const autoCdrJobs = new Map<string, AutoCdrJob>();

function runPython(args: string[], onLine?: (line: string) => void): Promise<{ code: number; lines: string[] }> {
  return new Promise((resolve) => {
    const child = spawn(PYTHON, args, { cwd: UPLOADER_DIR });
    const lines: string[] = [];
    const take = (buf: Buffer) => {
      const text = buf.toString("utf8");
      for (const raw of text.split("\n")) {
        const line = raw.replace(/\r$/, "");
        if (!line.trim()) continue;
        lines.push(line);
        onLine?.(line);
      }
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("close", (code) => resolve({ code: code ?? 1, lines }));
    child.on("error", (err) => resolve({ code: 1, lines: [String(err.message)] }));
  });
}

async function runAutoCdr(jobId: string, country: "thailand" | "korea", date: string): Promise<void> {
  const job = autoCdrJobs.get(jobId)!;
  const dl = await runPython(["download_cdr_" + country + ".py", "--headless", "--date-from", date, "--date-to", date]);
  if (dl.code !== 0) {
    job.status = "failed";
    job.message = "Download step failed. Check the uploader logs folder on the server.";
    return;
  }
  const filePath = dl.lines[dl.lines.length - 1]?.trim();
  if (!filePath) {
    job.status = "failed";
    job.message = "Download finished but no file path was reported.";
    return;
  }
  const imp = await runPython(["upload_du_cdr.py", filePath, "--country", country.toUpperCase()]);
  const imported = imp.lines.find((l) => /^Imported /.test(l));
  if (imp.code !== 0 || !imported) {
    job.status = "failed";
    job.message = "Import step failed. " + (imp.lines.slice(-3).join(" | ") || "No output.");
    return;
  }
  const rowsMatch = imported.match(/Imported (\d+)\//);
  job.status = "success";
  job.rows = rowsMatch ? Number(rowsMatch[1]) : undefined;
  job.message = imported;
}

router.post("/du-digital/:country/auto-cdr", requireRole(...UPLOADER_ROLES), h(async (req, res) => {
  const country = String(req.params.country ?? "").toLowerCase();
  if (country !== "thailand" && country !== "korea") return res.status(400).json({ success: false, message: "country must be 'thailand' or 'korea'" });
  const today = new Date().toISOString().slice(0, 10);
  const date = String(req.body?.date ?? today);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ success: false, message: "date must be YYYY-MM-DD" });
  const jobId = randomUUID();
  autoCdrJobs.set(jobId, { status: "running", country, date, message: "Downloading the report from the dialer..." });
  void runAutoCdr(jobId, country, date);
  res.status(202).json({ success: true, data: { jobId } });
}));

router.get("/du-digital/auto-cdr/jobs/:jobId", requireRole(...UPLOADER_ROLES), h(async (req, res) => {
  const job = autoCdrJobs.get(String(req.params.jobId ?? ""));
  if (!job) return res.status(404).json({ success: false, message: "job not found" });
  res.json({ success: true, data: job });
}));

export {};
