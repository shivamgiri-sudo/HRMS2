import { Router } from "express";
import multer from "multer";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  __test__,
  createCandidateFromActivity,
  createTokenFromActivity,
  type DuplicateMode,
  getHiringActivityBootstrap,
  getCallingDashboard,
  getHiringDashboard,
  getHiringActivityAnalytics,
  importHiringActivityRows,
  listHiringActivity,
  mapSheetRow,
  parseRecruiterSheet,
  readImportBatch,
  sendOnboardingFromActivity,
  searchInterviewers,
  updateHiringActivityById,
  upsertHiringActivity,
} from "./recruiter-hiring.service.js";

export const recruiterHiringRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
// Allow HR domain roles (hr, branch_head), admin roles, and recruiters
const authRoles = requireRole("admin", "hr", "super_admin", "recruiter", "branch_head");

recruiterHiringRouter.use(requireAuth);
recruiterHiringRouter.use(authRoles);

function parseQueryBool(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

function duplicateModeFrom(value: unknown): DuplicateMode {
  const mode = String(value ?? "").trim();
  if (mode === "update_existing" || mode === "skip_duplicates") return mode;
  return "insert_duplicates_with_warning";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

function getErrorStatus(error: unknown, fallback = 500): number {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === "number" && Number.isFinite(statusCode)) {
      return statusCode;
    }
  }

  return fallback;
}

function getRequester(req: AuthenticatedRequest) {
  return {
    id: req.authUser?.id ?? "",
    role: req.authUser?.role ?? "",
  };
}

async function ensureRowAccess(req: AuthenticatedRequest, id: string) {
  const { role, id: userId } = getRequester(req);
  const privileged = ["admin", "hr", "super_admin", "branch_head"].includes(role);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, created_by, recruiter_id, branch_name FROM ats_recruiter_hiring_activity WHERE id = ? LIMIT 1`,
    [id]
  );
  const row = rows[0];
  if (!row) return { allowed: false, row: null };
  if (privileged || row.created_by === userId || row.recruiter_id === userId) return { allowed: true, row };

  // Branch-scoped access: recruiters in same branch
  const [branchRows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(bm.branch_name, bm.branch_code) AS branch_name
       FROM employees e LEFT JOIN branch_master bm ON bm.id = e.branch_id
      WHERE e.user_id = ? LIMIT 1`,
    [userId]
  );
  const actorBranch = branchRows[0]?.branch_name;
  if (actorBranch && row.branch_name === actorBranch) return { allowed: true, row };
  return { allowed: false, row };
}

recruiterHiringRouter.get("/interviewers", async (req: AuthenticatedRequest, res) => {
  try {
    const branchName = req.query.branchName ? String(req.query.branchName) : null;
    const q = req.query.q ? String(req.query.q) : null;
    const roundType = req.query.roundType ? String(req.query.roundType) : "ops_round";
    const limit = Math.min(Number(req.query.limit ?? 20) || 20, 50);
    const data = await searchInterviewers(branchName, q, roundType, limit, req.authUser?.id);
    return res.json({ success: true, data });
  } catch (error: unknown) {
    return res.status(getErrorStatus(error)).json({ success: false, message: getErrorMessage(error) });
  }
});

recruiterHiringRouter.get("/recruiter/hiring-activity/bootstrap", async (req: AuthenticatedRequest, res) => {
  try {
    const data = await getHiringActivityBootstrap(req.authUser!.id);
    return res.json({ success: true, data });
  } catch (error: unknown) {
    return res.status(getErrorStatus(error)).json({ success: false, message: getErrorMessage(error) });
  }
});

recruiterHiringRouter.get("/recruiter/hiring-activity", async (req: AuthenticatedRequest, res) => {
  try {
    const { id, role } = getRequester(req);
    const data = await listHiringActivity(id, role, {
      fromDate: parseQueryBool(req.query.fromDate),
      toDate: parseQueryBool(req.query.toDate),
      month: parseQueryBool(req.query.month),
      recruiter: parseQueryBool(req.query.recruiter),
      hiringSource: parseQueryBool(req.query.hiringSource),
      wpGroup: parseQueryBool(req.query.wpGroup),
      position: parseQueryBool(req.query.position),
      location: parseQueryBool(req.query.location),
      branch: parseQueryBool(req.query.branch),
      process: parseQueryBool(req.query.process),
      gender: parseQueryBool(req.query.gender),
      education: parseQueryBool(req.query.education),
      experienceLevel: parseQueryBool(req.query.experienceLevel),
      recruiterRemarks: parseQueryBool(req.query.recruiterRemarks),
      hrInterviewStatus: parseQueryBool(req.query.hrInterviewStatus),
      aiInterviewResult: parseQueryBool(req.query.aiInterviewResult),
      opsInterviewStatus: parseQueryBool(req.query.opsInterviewStatus),
      offerLetterStatus: parseQueryBool(req.query.offerLetterStatus),
      joiningStatus: parseQueryBool(req.query.joiningStatus),
      batchNo: parseQueryBool(req.query.batchNo),
      currentStatus: parseQueryBool(req.query.currentStatus),
      walkin: parseQueryBool(req.query.walkin),
      finalSelection: parseQueryBool(req.query.finalSelection),
      joined: parseQueryBool(req.query.joined),
      contacted: parseQueryBool(req.query.contacted),
      search: parseQueryBool(req.query.search),
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 50,
    });
    return res.json({ success: true, ...data });
  } catch (error: unknown) {
    return res.status(getErrorStatus(error)).json({ success: false, message: getErrorMessage(error) });
  }
});

recruiterHiringRouter.post("/recruiter/hiring-activity", async (req: AuthenticatedRequest, res) => {
  try {
    const duplicateMode = duplicateModeFrom(req.body?.duplicateMode);
    const payload = req.body?.row && typeof req.body.row === "object" ? req.body.row : req.body;
    const result = await upsertHiringActivity(payload, req.authUser!.id, duplicateMode);
    return res.status(201).json({ success: true, data: result });
  } catch (error: unknown) {
    const validationErrors = typeof error === "object" && error !== null && "validationErrors" in error
      ? (error as { validationErrors?: unknown }).validationErrors
      : undefined;
    return res.status(getErrorStatus(error)).json({
      success: false,
      message: getErrorMessage(error),
      errors: validationErrors ?? undefined,
    });
  }
});

// ── Analytics endpoint ────────────────────────────────────────────────────────
// Must be registered BEFORE /:id to prevent "analytics" being matched as an ID
recruiterHiringRouter.get("/recruiter/hiring-activity/analytics", async (req: AuthenticatedRequest, res) => {
  try {
    const filters = {
      fromDate:     parseQueryBool(req.query.fromDate),
      toDate:       parseQueryBool(req.query.toDate),
      month:        parseQueryBool(req.query.month),
      branch:       parseQueryBool(req.query.branch),
      process:      parseQueryBool(req.query.process),
      hiringSource: parseQueryBool(req.query.hiringSource),
      recruiter:    parseQueryBool(req.query.recruiter),
      gender:       parseQueryBool(req.query.gender),
      education:    parseQueryBool(req.query.education),
    };

    console.log("[Analytics] Request from user:", req.authUser?.id, "role:", req.authUser?.role, "filters:", filters);

    const data = await getHiringActivityAnalytics(req.authUser!.id, req.authUser?.role, filters);

    console.log("[Analytics] Response data keys:", Object.keys(data), "funnel length:", data.funnel?.length);

    return res.json({ success: true, data });
  } catch (error: unknown) {
    console.error("[Analytics] Error:", error);
    return res.status(getErrorStatus(error)).json({ success: false, message: getErrorMessage(error) });
  }
});

recruiterHiringRouter.get("/recruiter/hiring-activity/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const access = await ensureRowAccess(req, req.params.id);
    if (!access.allowed) {
      return res.status(404).json({ success: false, message: "Hiring activity not found" });
    }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM ats_recruiter_hiring_activity WHERE id = ? LIMIT 1`,
      [req.params.id]
    );
    return res.json({ success: true, data: rows[0] ?? null });
  } catch (error: unknown) {
    return res.status(getErrorStatus(error)).json({ success: false, message: getErrorMessage(error) });
  }
});

recruiterHiringRouter.put("/recruiter/hiring-activity/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const access = await ensureRowAccess(req, req.params.id);
    if (!access.allowed) {
      return res.status(404).json({ success: false, message: "Hiring activity not found" });
    }
    const payload = req.body?.row && typeof req.body.row === "object" ? req.body.row : req.body;
    const result = await updateHiringActivityById(req.params.id, payload, req.authUser!.id);
    return res.json({ success: true, data: result });
  } catch (error: unknown) {
    const validationErrors = typeof error === "object" && error !== null && "validationErrors" in error
      ? (error as { validationErrors?: unknown }).validationErrors
      : undefined;
    return res.status(getErrorStatus(error)).json({
      success: false,
      message: getErrorMessage(error),
      errors: validationErrors ?? undefined,
    });
  }
});

recruiterHiringRouter.delete("/recruiter/hiring-activity/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const { role, id: userId } = getRequester(req);
    const isAdmin = ["admin", "hr", "super_admin", "ho_hr"].includes(role);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, created_by, recruiter_id FROM ats_recruiter_hiring_activity WHERE id = ? LIMIT 1`,
      [req.params.id]
    );
    const row = rows[0];
    if (!row) {
      return res.status(404).json({ success: false, message: "Hiring activity not found" });
    }
    const isOwner = row.created_by === userId || row.recruiter_id === userId;
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, message: "You can only delete your own entries" });
    }
    await db.execute(`DELETE FROM ats_recruiter_hiring_activity WHERE id = ?`, [req.params.id]);
    return res.json({ success: true, message: "Hiring activity deleted" });
  } catch (error: unknown) {
    return res.status(getErrorStatus(error)).json({ success: false, message: getErrorMessage(error) });
  }
});

recruiterHiringRouter.post("/recruiter/hiring-activity/import", upload.single("file"), async (req: AuthenticatedRequest, res) => {
  try {
    const duplicateMode = duplicateModeFrom(req.body?.duplicateMode);
    let rows: Record<string, unknown>[] = [];
    const fileName = String(req.body?.fileName ?? req.file?.originalname ?? "recruiter_hiring_import.xlsx");

    if (req.file?.buffer) {
      rows = parseRecruiterSheet(req.file.buffer, fileName);
    } else if (req.body?.rows) {
      rows = typeof req.body.rows === "string" ? JSON.parse(req.body.rows) : req.body.rows;
      if (!Array.isArray(rows)) throw new Error("rows must be an array");
    } else {
      throw new Error("Upload a file or provide rows");
    }

    const result = await importHiringActivityRows(rows, req.authUser!.id, fileName, duplicateMode);
    return res.status(201).json({ success: true, data: result });
  } catch (error: unknown) {
    const validationErrors = typeof error === "object" && error !== null && "validationErrors" in error
      ? (error as { validationErrors?: unknown }).validationErrors
      : undefined;
    return res.status(getErrorStatus(error, 400)).json({
      success: false,
      message: getErrorMessage(error),
      errors: validationErrors ?? undefined,
    });
  }
});

recruiterHiringRouter.get("/recruiter/hiring-activity/import/:batchId", async (req: AuthenticatedRequest, res) => {
  try {
    const data = await readImportBatch(req.params.batchId);
    return res.json({ success: true, data });
  } catch (error: unknown) {
    return res.status(getErrorStatus(error)).json({ success: false, message: getErrorMessage(error) });
  }
});

recruiterHiringRouter.get("/recruiter/hiring-activity/import/:batchId/errors", async (req: AuthenticatedRequest, res) => {
  try {
    const data = await readImportBatch(req.params.batchId);
    return res.json({ success: true, data: data.errors });
  } catch (error: unknown) {
    return res.status(getErrorStatus(error)).json({ success: false, message: getErrorMessage(error) });
  }
});

recruiterHiringRouter.get("/recruiter/hiring-dashboard", async (req: AuthenticatedRequest, res) => {
  try {
    const data = await getHiringDashboard(req.authUser!.id, req.authUser?.role, {
      fromDate: parseQueryBool(req.query.fromDate),
      toDate: parseQueryBool(req.query.toDate),
      month: parseQueryBool(req.query.month),
      recruiter: parseQueryBool(req.query.recruiter),
      hiringSource: parseQueryBool(req.query.hiringSource),
      wpGroup: parseQueryBool(req.query.wpGroup),
      position: parseQueryBool(req.query.position),
      location: parseQueryBool(req.query.location),
      branch: parseQueryBool(req.query.branch),
      process: parseQueryBool(req.query.process),
      gender: parseQueryBool(req.query.gender),
      education: parseQueryBool(req.query.education),
      experienceLevel: parseQueryBool(req.query.experienceLevel),
      recruiterRemarks: parseQueryBool(req.query.recruiterRemarks),
      hrInterviewStatus: parseQueryBool(req.query.hrInterviewStatus),
      aiInterviewResult: parseQueryBool(req.query.aiInterviewResult),
      opsInterviewStatus: parseQueryBool(req.query.opsInterviewStatus),
      offerLetterStatus: parseQueryBool(req.query.offerLetterStatus),
      joiningStatus: parseQueryBool(req.query.joiningStatus),
      batchNo: parseQueryBool(req.query.batchNo),
      currentStatus: parseQueryBool(req.query.currentStatus),
      walkin: parseQueryBool(req.query.walkin),
      finalSelection: parseQueryBool(req.query.finalSelection),
      joined: parseQueryBool(req.query.joined),
      contacted: parseQueryBool(req.query.contacted),
      search: parseQueryBool(req.query.search),
    });
    return res.json({ success: true, data });
  } catch (error: unknown) {
    return res.status(getErrorStatus(error)).json({ success: false, message: getErrorMessage(error) });
  }
});

recruiterHiringRouter.get("/recruiter/calling-dashboard", async (req: AuthenticatedRequest, res) => {
  try {
    const data = await getCallingDashboard(req.authUser!.id, req.authUser?.role, {
      fromDate: parseQueryBool(req.query.fromDate),
      toDate: parseQueryBool(req.query.toDate),
      month: parseQueryBool(req.query.month),
      recruiter: parseQueryBool(req.query.recruiter),
      hiringSource: parseQueryBool(req.query.hiringSource),
      wpGroup: parseQueryBool(req.query.wpGroup),
      position: parseQueryBool(req.query.position),
      location: parseQueryBool(req.query.location),
      branch: parseQueryBool(req.query.branch),
      process: parseQueryBool(req.query.process),
      gender: parseQueryBool(req.query.gender),
      education: parseQueryBool(req.query.education),
      experienceLevel: parseQueryBool(req.query.experienceLevel),
      recruiterRemarks: parseQueryBool(req.query.recruiterRemarks),
      hrInterviewStatus: parseQueryBool(req.query.hrInterviewStatus),
      aiInterviewResult: parseQueryBool(req.query.aiInterviewResult),
      opsInterviewStatus: parseQueryBool(req.query.opsInterviewStatus),
      offerLetterStatus: parseQueryBool(req.query.offerLetterStatus),
      joiningStatus: parseQueryBool(req.query.joiningStatus),
      batchNo: parseQueryBool(req.query.batchNo),
      currentStatus: parseQueryBool(req.query.currentStatus),
      walkin: parseQueryBool(req.query.walkin),
      finalSelection: parseQueryBool(req.query.finalSelection),
      joined: parseQueryBool(req.query.joined),
      contacted: parseQueryBool(req.query.contacted),
      search: parseQueryBool(req.query.search),
    });
    return res.json({ success: true, data });
  } catch (error: unknown) {
    return res.status(getErrorStatus(error)).json({ success: false, message: getErrorMessage(error) });
  }
});

recruiterHiringRouter.post("/recruiter/hiring-activity/:id/create-candidate", async (req: AuthenticatedRequest, res) => {
  try {
    const data = await createCandidateFromActivity(req.params.id, req.authUser!.id);
    return res.status(201).json({ success: true, data });
  } catch (error: unknown) {
    return res.status(getErrorStatus(error)).json({ success: false, message: getErrorMessage(error) });
  }
});

recruiterHiringRouter.post("/recruiter/hiring-activity/:id/generate-token", async (req: AuthenticatedRequest, res) => {
  try {
    const data = await createTokenFromActivity(req.params.id, req.authUser!.id);
    return res.status(201).json({ success: true, data });
  } catch (error: unknown) {
    return res.status(getErrorStatus(error)).json({ success: false, message: getErrorMessage(error) });
  }
});

recruiterHiringRouter.post("/recruiter/hiring-activity/:id/send-onboarding", async (req: AuthenticatedRequest, res) => {
  try {
    const data = await sendOnboardingFromActivity(req.params.id, req.authUser!.id);
    return res.status(201).json({ success: true, data });
  } catch (error: unknown) {
    return res.status(getErrorStatus(error)).json({ success: false, message: getErrorMessage(error) });
  }
});

// ── Set followup reminder ─────────────────────────────────────────────────────
recruiterHiringRouter.post("/recruiter/hiring-activity/:id/set-followup", async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { followup_date, followup_reason } = req.body as { followup_date?: string; followup_reason?: string };

    if (!followup_date) {
      return res.status(400).json({ success: false, message: "followup_date is required" });
    }

    const { allowed, row } = await ensureRowAccess(req as AuthenticatedRequest, id);
    if (!allowed || !row) {
      return res.status(403).json({ success: false, message: "Access denied or record not found" });
    }

    await db.execute(
      `UPDATE ats_recruiter_hiring_activity
          SET followup_required = 1,
              followup_date = ?,
              followup_reason = ?,
              updated_by = ?,
              updated_at = NOW()
        WHERE id = ?`,
      [followup_date, followup_reason ?? null, req.authUser!.id, id]
    );

    // Create inbox reminder for the recruiter
    const candidateName = String((row as RowDataPacket).candidate_name ?? "Candidate");
    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM work_inbox_item WHERE entity_type='hiring_activity' AND entity_id=? AND type='ats_followup_reminder' LIMIT 1`,
      [id]
    );
    if ((existing as RowDataPacket[]).length === 0) {
      await db.execute(
        `INSERT INTO work_inbox_item (id, user_id, type, title, description, entity_type, entity_id, action_url, priority, is_read, is_actioned, created_at)
         VALUES (UUID(), ?, 'ats_followup_reminder', ?, ?, 'hiring_activity', ?, '/ats/recruiter/hiring-entry', 'normal', 0, 0, NOW())`,
        [
          req.authUser!.id,
          `Follow-up: ${candidateName}`,
          `Scheduled for ${followup_date}${followup_reason ? ` — ${followup_reason}` : ""}`,
          id,
        ]
      );
    } else {
      await db.execute(
        `UPDATE work_inbox_item SET title=?, description=?, is_read=0, is_actioned=0, created_at=NOW()
          WHERE entity_type='hiring_activity' AND entity_id=? AND type='ats_followup_reminder'`,
        [
          `Follow-up: ${candidateName}`,
          `Scheduled for ${followup_date}${followup_reason ? ` — ${followup_reason}` : ""}`,
          id,
        ]
      );
    }

    return res.json({ success: true, message: "Follow-up reminder set" });
  } catch (error: unknown) {
    return res.status(getErrorStatus(error)).json({ success: false, message: getErrorMessage(error) });
  }
});

export { __test__ };
