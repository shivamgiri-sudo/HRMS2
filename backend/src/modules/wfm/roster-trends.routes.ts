/**
 * Trends & Publish panel endpoints — mounted at /api/roster-analytics/trends by
 * roster-analytics.routes.ts (requireAuth already applied by the parent router).
 *
 * All are read-only GETs. Query contract: from, to (YYYY-MM-DD, required unless noted),
 * branchId, processId, lobId (uuid | __none__).
 */
import { Router, type Request, type Response } from "express";
import { requireRole } from "../../middleware/requireRole.js";
import { readLobFilter, type LobFilter } from "../../shared/lobFilter.js";
import { employeeFieldGuard, getScope, canAccessTarget, OUT_OF_SCOPE_MSG } from "./branch-scope.js";
import { db } from "../../db/mysql.js";
import { daySpan, isValidDate } from "./roster-trends.calc.js";
import {
  getShrinkageTrend,
  getShrinkageDayDetail,
  getMemberDetail,
  getProcessShrinkage,
  getProcessMembers,
} from "./roster-trends.shrinkage.service.js";
import {
  getPublishOverview,
  getPublishStageDetail,
  getCycleDetail,
} from "./roster-trends.publish.service.js";
import {
  getLatenessOverview,
  getLatenessEmployeeDetail,
  getLatenessDayDetail,
  getAttritionBucketDetail,
} from "./roster-trends.lateness.service.js";

export const rosterTrendsRouter = Router();

const TRENDS_ROLES = [
  "super_admin",
  "admin",
  "hr",
  "wfm",
  "branch_head",
  "operations_manager",
  "ceo",
  "coo",
  "manager",
  "process_manager",
];
const MAX_RANGE_DAYS = 366;
const ID_RE = /^[\w-]{1,64}$/;

rosterTrendsRouter.use(requireRole(...TRENDS_ROLES));
// employeeId named in the query (member-detail, lateness/employee) must be inside the caller's scope.
rosterTrendsRouter.use(employeeFieldGuard("employeeId"));

interface Parsed {
  from: string;
  to: string;
  branchId?: string;
  processId?: string;
  lob: LobFilter;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Validates the shared filter contract at the boundary; writes the 400 itself and returns null. */
function parse(
  req: Request,
  res: Response,
  opts: { needRange?: boolean } = { needRange: true },
): Parsed | null {
  const lob = readLobFilter(req, res);
  if (!lob) return null;
  const from = str(req.query.from) ?? "";
  const to = str(req.query.to) ?? "";
  if (opts.needRange !== false) {
    if (!isValidDate(from) || !isValidDate(to)) {
      res.status(400).json({ error: "from and to are required (YYYY-MM-DD)" });
      return null;
    }
    if (from > to) {
      res.status(400).json({ error: "from must be on or before to" });
      return null;
    }
    if (daySpan(from, to) > MAX_RANGE_DAYS) {
      res
        .status(400)
        .json({ error: `Range too large (max ${MAX_RANGE_DAYS} days)` });
      return null;
    }
  }
  const branchId = str(req.query.branchId);
  const processId = str(req.query.processId);
  if (
    (branchId && !ID_RE.test(branchId)) ||
    (processId && !ID_RE.test(processId))
  ) {
    res.status(400).json({ error: "branchId/processId are malformed" });
    return null;
  }
  return { from, to, branchId, processId, lob };
}

function fail(res: Response, label: string, err: unknown) {
  const msg = err instanceof Error ? err.message : "Unknown error";
  console.error(`[roster-trends] ${label} error:`, msg);
  res.status(500).json({ error: `Failed to load ${label}: ${msg}` });
}

function idParam(req: Request, res: Response, name: string): string | null {
  const v = str(req.query[name]);
  if (!v || !ID_RE.test(v)) {
    res
      .status(400)
      .json({ error: `${name} is required and must be a valid id` });
    return null;
  }
  return v;
}

rosterTrendsRouter.get("/shrinkage", async (req, res) => {
  const f = parse(req, res);
  if (!f) return;
  try {
    res.json(await getShrinkageTrend(f));
  } catch (e) {
    fail(res, "shrinkage trend", e);
  }
});

rosterTrendsRouter.get("/shrinkage/day", async (req, res) => {
  const date = str(req.query.date);
  if (!date || !isValidDate(date)) {
    res.status(400).json({ error: "date is required (YYYY-MM-DD)" });
    return;
  }
  const f = parse(req, res, { needRange: false });
  if (!f) return;
  try {
    res.json(await getShrinkageDayDetail(date, f));
  } catch (e) {
    fail(res, "shrinkage day detail", e);
  }
});

rosterTrendsRouter.get("/process-shrinkage", async (req, res) => {
  const f = parse(req, res);
  if (!f) return;
  try {
    res.json(await getProcessShrinkage(f));
  } catch (e) {
    fail(res, "process shrinkage", e);
  }
});

/** Process drawer: summary row + daily trend + analysts, in parallel, one request. */
rosterTrendsRouter.get("/process-detail", async (req, res) => {
  const processId = idParam(req, res, "processId");
  if (!processId) return;
  const f = parse(req, res);
  if (!f) return;
  try {
    const [members, trend, procs, publish] = await Promise.all([
      getProcessMembers(processId, f),
      getShrinkageTrend({ ...f, processId }),
      getProcessShrinkage({ ...f, processId }),
      getPublishOverview({ ...f, processId }),
    ]);
    res.json({
      processId,
      from: f.from,
      to: f.to,
      process: procs.processes[0] ?? null,
      days: trend.days,
      previous: trend.previous,
      members: members.members,
      publish: {
        funnel: publish.funnel,
        byWeek: publish.byWeek,
        cycles: publish.cycles.slice(0, 20),
      },
    });
  } catch (e) {
    fail(res, "process detail", e);
  }
});

rosterTrendsRouter.get("/member-detail", async (req, res) => {
  const employeeId = idParam(req, res, "employeeId");
  if (!employeeId) return;
  const f = parse(req, res);
  if (!f) return;
  try {
    const d = await getMemberDetail(employeeId, f.from, f.to);
    if (!d) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }
    res.json(d);
  } catch (e) {
    fail(res, "member detail", e);
  }
});

rosterTrendsRouter.get("/publish", async (req, res) => {
  const f = parse(req, res);
  if (!f) return;
  try {
    res.json(await getPublishOverview(f));
  } catch (e) {
    fail(res, "publish overview", e);
  }
});

rosterTrendsRouter.get("/publish/stage", async (req, res) => {
  const status = str(req.query.status) ?? "";
  const f = parse(req, res);
  if (!f) return;
  try {
    const week = str(req.query.week);
    if (week && !isValidDate(week)) {
      res.status(400).json({ error: "week must be YYYY-MM-DD" });
      return;
    }
    const d = await getPublishStageDetail(status, f, week);
    if (!d) {
      res.status(400).json({ error: "Unknown publish stage" });
      return;
    }
    res.json(d);
  } catch (e) {
    fail(res, "publish stage detail", e);
  }
});

rosterTrendsRouter.get("/publish/cycle/:cycleId", async (req, res) => {
  const { cycleId } = req.params;
  if (!ID_RE.test(cycleId)) {
    res.status(400).json({ error: "cycleId is malformed" });
    return;
  }
  try {
    const scope = await getScope(req as any);
    if (!scope) { res.status(401).json({ error: "Unauthorized" }); return; }
    const [own] = await db.execute<any[]>("SELECT branch_id, process_id FROM weekly_roster_cycle WHERE id = ? LIMIT 1", [cycleId]);
    if (own[0] && !(await canAccessTarget(scope, { branchId: own[0].branch_id, processId: own[0].process_id }))) {
      res.status(403).json({ error: OUT_OF_SCOPE_MSG }); return;
    }
    const d = await getCycleDetail(cycleId);
    if (!d) {
      res.status(404).json({ error: "Roster cycle not found" });
      return;
    }
    res.json(d);
  } catch (e) {
    fail(res, "cycle detail", e);
  }
});

rosterTrendsRouter.get("/lateness", async (req, res) => {
  const f = parse(req, res);
  if (!f) return;
  try {
    res.json(await getLatenessOverview(f));
  } catch (e) {
    fail(res, "lateness overview", e);
  }
});

rosterTrendsRouter.get("/lateness/employee", async (req, res) => {
  const employeeId = idParam(req, res, "employeeId");
  if (!employeeId) return;
  const f = parse(req, res);
  if (!f) return;
  try {
    const d = await getLatenessEmployeeDetail(employeeId, f.from, f.to);
    if (!d) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }
    res.json(d);
  } catch (e) {
    fail(res, "lateness employee detail", e);
  }
});

rosterTrendsRouter.get("/lateness/day", async (req, res) => {
  const date = str(req.query.date);
  if (!date || !isValidDate(date)) {
    res.status(400).json({ error: "date is required (YYYY-MM-DD)" });
    return;
  }
  const f = parse(req, res, { needRange: false });
  if (!f) return;
  try {
    res.json(await getLatenessDayDetail(date, f));
  } catch (e) {
    fail(res, "lateness day detail", e);
  }
});

rosterTrendsRouter.get("/attrition/bucket", async (req, res) => {
  const f = parse(req, res);
  if (!f) return;
  try {
    const d = await getAttritionBucketDetail(str(req.query.bucket) ?? "", f);
    if (!d) {
      res
        .status(400)
        .json({ error: "bucket must be one of 0-30, 31-60, 61-90, 90+" });
      return;
    }
    res.json(d);
  } catch (e) {
    fail(res, "attrition bucket detail", e);
  }
});
