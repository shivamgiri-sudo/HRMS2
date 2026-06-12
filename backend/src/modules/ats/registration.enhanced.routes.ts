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
        mobile: r.mobile_number,
        email: r.email,
        present_today: !!r.clock_in_time,
      })),
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 3. Enhanced registration submission ───────────────────────────────────────
const enhancedRegistrationSchema = z.object({
  name: z.string().min(1),
  mobile: z.string().min(10),
  email: z.string().email().optional(),
  branchDisplayName: z.string().min(1),
  preferredRecruiterId: z.string().uuid().optional(),
  roleApplied: z.string().optional(),
  address: z.string().optional(),
  education: z.string().optional(),
  experience: z.string().optional(),
  gender: z.string().optional(),
  photoUrl: z.string().optional(),
  resumeUrl: z.string().optional(),
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

    // 2. Get branch_id from branch_master
    const [branchRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM branch_master WHERE branch_name = ? LIMIT 1`,
      [branchName]
    );

    if (branchRows.length === 0) {
      return res.status(400).json({
        success: false,
        message: `Branch "${branchName}" not found in branch_master`,
      });
    }

    const branchId = branchRows[0].id;

    // 3. Create candidate record
    const candidateId = crypto.randomUUID();

    await db.execute(
      `INSERT INTO ats_candidate (
        id, full_name, mobile, email, address,
        education, years_of_experience, gender,
        applied_for_role, applied_for_branch, branch_id,
        branch_display_name, preferred_recruiter_id,
        photo_url, resume_url,
        candidate_status, sourcing_channel
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'registered', 'Walk-in')`,
      [
        candidateId,
        input.name,
        input.mobile,
        input.email || null,
        input.address || null,
        input.education || null,
        input.experience || null,
        input.gender || null,
        input.roleApplied || null,
        branchName,
        branchId,
        input.branchDisplayName,
        input.preferredRecruiterId || null,
        input.photoUrl || null,
        input.resumeUrl || null,
      ]
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
          id, candidate_id, branch_name, token_number,
          recruiter_id, queue_status
        ) VALUES (UUID(), ?, ?, ?, ?, 'waiting')`,
        [candidateId, branchName, tokenNumber, assignmentResult.assignedRecruiterId]
      );
    }

    // 6. Get recruiter details
    let recruiterDetails = null;
    if (assignmentResult.assignedRecruiterId) {
      const [recRows] = await db.execute<RowDataPacket[]>(
        `SELECT employee_code, first_name, last_name, mobile_number, email
         FROM employees WHERE id = ?`,
        [assignmentResult.assignedRecruiterId]
      );

      if (recRows.length > 0) {
        const rec = recRows[0];
        recruiterDetails = {
          name: `${rec.first_name} ${rec.last_name}`.trim(),
          mobile: rec.mobile_number,
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
    return res.status(500).json({
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
