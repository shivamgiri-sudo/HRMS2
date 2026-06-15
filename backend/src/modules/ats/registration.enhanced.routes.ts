import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/mysql.js";
import { RowDataPacket } from "mysql2/promise";
import {
  getBranchAliases,
  resolveBranchFromAlias,
  getAvailableRecruiters,
  assignRecruiterToCandidate,
  generateTokenNumber,
} from "./ats.enhanced.service.js";
import { atsService } from "./ats.service.js";
import {
  sendCandidateSuccessEmail,
  sendRecruiterNotificationEmail,
} from "./ats.email.service.js";

export const registrationEnhancedRouter = Router();

// ── 1. Get branch aliases (display names) ─────────────────────────────────────
registrationEnhancedRouter.get("/branch-aliases", async (_req, res) => {
  try {
    const aliases = await getBranchAliases();
    return res.json({ success: true, data: aliases });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 2. Get recruiters by branch (filtered by HR + Executive + Present) ────────
const getRecruitersSchema = z.object({
  branchName: z.string().min(1),
});

registrationEnhancedRouter.get("/recruiters/:branchName", async (req, res) => {
  try {
    const { branchName } = getRecruitersSchema.parse(req.params);
    const recruiters = await getAvailableRecruiters(branchName);

    return res.json({
      success: true,
      data: recruiters.map((r: any) => ({
        id: r.id,
        employee_code: r.employee_code,
        name: `${r.first_name} ${r.last_name}`.trim(),
        mobile: r.mobile,
        email: r.email,
        present_today: Boolean(r.present_today),
      })),
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 3. Enhanced registration submission ───────────────────────────────────────
const enhancedRegistrationSchema = z.object({
  name: z.string().min(1),
  mobile: z.string().regex(/^[6-9]\d{9}$/, "Valid 10-digit Indian mobile number required"),
  email: z.string().email().nullable().optional(),
  branchDisplayName: z.string().min(1),
  preferredRecruiterId: z.string().uuid().optional(),
  roleApplied: z.string().min(1),
  address: z.string().optional(),
  education: z.string().min(1),
  experience: z.string().min(1),
  gender: z.enum(["Male", "Female", "Other"]).nullable().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  preferredShift: z.string().nullable().optional(),
  sourcingChannel: z.string().default("Walk-In"),
});

registrationEnhancedRouter.post("/submit-enhanced", async (req, res) => {
  try {
    const input = enhancedRegistrationSchema.parse(req.body);

    // 1. Resolve branch from display name
    const branchData = await resolveBranchFromAlias(input.branchDisplayName);
    if (!branchData) {
      return res.status(400).json({
        success: false,
        message: `Branch "${input.branchDisplayName}" not found`,
      });
    }

    const branchName = branchData.canonical_key;

    // 2. Create through the canonical service so duplicate checks, candidate
    // codes, normalized source values, and the first journey event stay aligned.
    const candidate = await atsService.createCandidate({
      fullName: input.name,
      mobile: input.mobile,
      email: input.email ?? null,
      gender: input.gender ?? null,
      dateOfBirth: input.dateOfBirth ?? null,
      education: input.education,
      experience: input.experience,
      appliedForProcess: input.roleApplied,
      appliedForRole: input.roleApplied,
      appliedForBranch: branchName,
      sourcingChannel: input.sourcingChannel,
      walkInDate: new Date().toISOString().slice(0, 10),
      address: input.address ?? null,
      preferredShift: input.preferredShift ?? null,
      profileStatus: "registered",
    }, null);
    const candidateId = candidate.id;

    await db.execute(
      `UPDATE ats_candidate
       SET branch_display_name = ?, preferred_recruiter_id = ?
       WHERE id = ?`,
      [input.branchDisplayName, input.preferredRecruiterId ?? null, candidateId]
    );

    // 4. Assign recruiter (smart assignment with fallback)
    const assignmentResult = await assignRecruiterToCandidate(
      candidateId,
      input.preferredRecruiterId || null
    );

    // 5. Generate token if recruiter assigned
    let tokenNumber = null;
    if (assignmentResult.assignedRecruiterId) {
      tokenNumber = await generateTokenNumber(branchName);

      await db.execute(
        `INSERT INTO ats_queue_token (
          id, candidate_id, token, arrival_time, current_stage, status,
          branch_name, token_number, recruiter_id, queue_status
        ) VALUES (UUID(), ?, UUID(), NOW(), 'Arrived', 'active', ?, ?, ?, 'waiting')`,
        [candidateId, branchName, tokenNumber, assignmentResult.assignedRecruiterId]
      );
    }

    // 6. Get recruiter details
    let recruiterDetails = null;
    if (assignmentResult.assignedRecruiterId) {
      const [recRows] = await db.execute<RowDataPacket[]>(
        `SELECT employee_code, first_name, last_name, mobile, email
         FROM employees WHERE id = ?`,
        [assignmentResult.assignedRecruiterId]
      );

      if (recRows.length > 0) {
        const rec = recRows[0];
        recruiterDetails = {
          name: `${rec.first_name} ${rec.last_name}`.trim(),
          mobile: rec.mobile,
          email: rec.email,
          employee_code: rec.employee_code,
        };
      }
    }

    // 7. Send emails (async, don't wait)
    if (input.email && recruiterDetails) {
      const registrationDate = new Date().toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });

      // Send candidate success email
      sendCandidateSuccessEmail({
        candidateId,
        to: input.email,
        candidateName: input.name,
        tokenNumber: tokenNumber || 'Pending',
        branchDisplayName: input.branchDisplayName,
        recruiterName: recruiterDetails.name,
        recruiterMobile: recruiterDetails.mobile,
        registrationDate,
      }).catch((err) => console.error('Failed to send candidate email:', err));

      // Send recruiter notification
      sendRecruiterNotificationEmail({
        candidateId,
        to: recruiterDetails.email,
        recruiterName: recruiterDetails.name,
        candidateName: input.name,
        candidateMobile: input.mobile,
        tokenNumber: tokenNumber || 'Pending',
        branchDisplayName: input.branchDisplayName,
        roleApplied: input.roleApplied || 'Not specified',
      }).catch((err) => console.error('Failed to send recruiter email:', err));
    }

    // 8. Send success response
    return res.status(201).json({
      success: true,
      message: "Registration successful",
      candidateId,
      tokenNumber,
      branchName,
      branchDisplayName: input.branchDisplayName,
      recruiter: recruiterDetails,
      assignmentReason: assignmentResult.assignmentReason,
    });
  } catch (error: any) {
    console.error("Enhanced registration error:", error);
    const status = error?.statusCode ?? (error?.name === "ZodError" ? 400 : 500);
    return res.status(status).json({
      success: false,
      message: error.message || "Registration failed",
    });
  }
});

// ── 4. Parse resume (placeholder - integrate with actual parser) ──────────────
registrationEnhancedRouter.post("/parse-resume", async (req, res) => {
  try {
    const { fileUrl } = req.body;

    if (!fileUrl) {
      return res.status(400).json({ success: false, message: "fileUrl required" });
    }

    // TODO: Integrate actual resume parsing library
    // For now, return mock parsed data
    const parsed = {
      name: "",
      mobile: "",
      email: "",
      education: "",
      experience: "",
      skills: [],
      company: "",
      designation: "",
      address: "",
    };

    return res.json({ success: true, data: parsed });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});
