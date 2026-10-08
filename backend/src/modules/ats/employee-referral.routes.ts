/**
 * Employee referral: any employee refers a candidate from HRMS. It reuses the existing ATS candidate
 * registration (same duplicate checks, same table) with the source set to "Employee Referral" and
 * the referee_* columns the recruiter tracker already reads, so a referral lands in the same
 * recruiter queue and reports as every other candidate. Nothing new is stored.
 */
import { Router, type NextFunction, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { db } from "../../db/mysql.js";
import { requireAuth, requireWriteAccess, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import { atsService } from "./ats.service.js";

export const employeeReferralRouter = Router();
employeeReferralRouter.use(requireAuth);

const RELATIONSHIPS = ["Friend", "Relative", "Ex-colleague", "Neighbour", "Other"] as const;
const REFERRAL_CHANNEL = "Employee Referral";

const referralSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  mobile: z.string().trim().regex(/^[6-9]\d{9}$/, "Enter a 10-digit Indian mobile number"),
  email: z.string().trim().email().max(255).nullish(),
  education: z.string().trim().min(2).max(100),
  experience: z.string().trim().min(1).max(100),
  appliedForProcess: z.string().trim().min(1).max(150),
  appliedForBranch: z.string().trim().min(1).max(150),
  relationship: z.enum(RELATIONSHIPS),
  remarks: z.string().trim().max(500).nullish(),
});

type Handler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const wrap = (fn: Handler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

async function referrerOf(req: AuthenticatedRequest): Promise<{ id: string; code: string | null; name: string } | null> {
  const employee = await getEmployeeForUser(req.authUser.id);
  if (!employee?.id) return null;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code, COALESCE(NULLIF(TRIM(full_name), ''), TRIM(CONCAT(first_name, ' ', COALESCE(last_name, '')))) AS name
       FROM employees WHERE id = ? LIMIT 1`,
    [employee.id],
  );
  const row = rows[0];
  return row ? { id: String(row.id), code: (row.employee_code as string | null) ?? null, name: String(row.name ?? "") } : null;
}

employeeReferralRouter.post("/", requireWriteAccess, wrap(async (req, res) => {
  const parsed = referralSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Invalid referral" });
  const referrer = await referrerOf(req);
  if (!referrer) return res.status(403).json({ success: false, message: "Only employees can refer a candidate." });
  const input = parsed.data;

  const candidate = await atsService.createCandidate(
    {
      fullName: input.fullName,
      mobile: input.mobile,
      email: input.email ?? null,
      education: input.education,
      experience: input.experience,
      appliedForProcess: input.appliedForProcess,
      appliedForBranch: input.appliedForBranch,
      sourcingChannel: REFERRAL_CHANNEL,
      referredBy: `${referrer.code ?? ""} ${referrer.name}`.trim(),
      remarks: input.remarks ?? null,
    },
    req.authUser.id,
  );
  await db.execute(
    `UPDATE ats_candidate
        SET referee_employee_id = ?, referee_employee_code = ?, referee_name = ?, referral_relationship = ?, referral_remarks = ?
      WHERE id = ?`,
    [referrer.id, referrer.code, referrer.name, input.relationship, input.remarks ?? null, candidate.id],
  );
  return res.status(201).json({ success: true, data: { id: candidate.id, candidateCode: candidate.candidate_code, stage: candidate.current_stage } });
}));

/** The caller's own referrals and where each one stands in the ATS pipeline. */
employeeReferralRouter.get("/mine", wrap(async (req, res) => {
  const referrer = await referrerOf(req);
  if (!referrer) return res.json({ success: true, data: [] });
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, candidate_code, full_name, current_stage, applied_for_process, applied_for_branch, referral_relationship,
            DATE_FORMAT(created_at, '%Y-%m-%d') AS referred_on
       FROM ats_candidate WHERE referee_employee_id = ? ORDER BY created_at DESC LIMIT 200`,
    [referrer.id],
  );
  return res.json({
    success: true,
    data: rows.map((r) => ({
      id: String(r.id), candidateCode: r.candidate_code, name: r.full_name, stage: r.current_stage ?? "Registered",
      process: r.applied_for_process, branch: r.applied_for_branch, relationship: r.referral_relationship, referredOn: r.referred_on,
    })),
  });
}));

export const REFERRAL_RELATIONSHIPS = RELATIONSHIPS;
