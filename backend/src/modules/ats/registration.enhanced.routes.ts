import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/mysql.js";
import { RowDataPacket } from "mysql2/promise";
import {
  getBranchAliases,
  resolveBranchFromAlias,
  getAvailableRecruiters,
  ensureRecruiterInRoster,
  assignRecruiterToCandidate,
  generateTokenNumber,
} from "./ats.enhanced.service.js";
import { atsService } from "./ats.service.js";
import { syncHiringActivityFromCandidateRegistration } from "./recruiter-hiring.service.js";
import {
  sendCandidateSuccessEmail,
  sendRecruiterNotificationEmail,
} from "./ats.email.service.js";

export const registrationEnhancedRouter = Router();

interface RecruiterRow {
  id: string;
  employee_id: string | null;
  employee_code: string | null;
  first_name: string | null;
  last_name: string | null;
  mobile: string | null;
  email: string | null;
  present_today?: unknown;
}

interface RecruiterEmployeeRow extends RowDataPacket {
  id: string;
  first_name: string | null;
  last_name: string | null;
  mobile: string | null;
  email: string | null;
  branch_name: string | null;
}

interface RecruiterIdRow extends RowDataPacket {
  id: string;
}

interface RecruiterContactRow extends RowDataPacket {
  name: string | null;
  mobile: string | null;
  email: string | null;
  employee_code: string | null;
}

interface CandidateCodeRow extends RowDataPacket {
  candidate_code: string | null;
}

interface ExistingCandidateRow extends RowDataPacket {
  id: string;
  candidate_code: string | null;
  current_stage: string | null;
  profile_status: string | null;
  employee_code: string | null;
  active_status: number | null;
}

interface ExistingTokenRow extends RowDataPacket {
  id: string;
  token_number: string | null;
  recruiter_id: string | null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error";
}

function getErrorStatus(error: unknown): number {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === "number" && Number.isFinite(statusCode)) {
      return statusCode;
    }
  }

  if (error instanceof z.ZodError) {
    return 400;
  }

  return 500;
}

function normalizeSourceChannel(source: string | null | undefined): string {
  const value = String(source ?? "").trim();
  if (!value) return "Walk-In";
  const lowered = value.toLowerCase();
  if (lowered === "walk-in" || lowered === "walk in" || lowered === "walkin") return "Walk-In";
  if (lowered === "reference" || lowered === "referral" || lowered === "employee referral") return "Reference";
  return value;
}

// ── 1. Get branch aliases (display names) ─────────────────────────────────────
registrationEnhancedRouter.get("/branch-aliases", async (_req, res) => {
  try {
    const aliases = await getBranchAliases();
    return res.json({ success: true, data: aliases });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
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
      data: recruiters.map((r) => ({
        id: r.id,                      // roster id (FK-safe for ats_candidate.recruiter_id)
        employee_id: r.employee_id,    // actual employee UUID — frontend sends this as preferredRecruiterId
        employee_code: r.employee_code,
        name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || r.employee_code || "Recruiter",
        mobile: r.mobile,
        email: r.email,
        present_today: Boolean(r.present_today),
      })),
    });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});

// ── 3. Enhanced registration submission ───────────────────────────────────────
const enhancedRegistrationSchema = z.object({
  name: z.string().min(1),
  mobile: z.string().regex(/^[6-9]\d{9}$/, "Valid 10-digit Indian mobile number required"),
  email: z.string().email().nullable().optional(),
  branchDisplayName: z.string().min(1),
  preferredRecruiterId: z.string().uuid().optional(),
  recruiterName: z.string().nullable().optional(), // fallback when UUID not available
  referredBy: z.string().trim().nullable().optional(),
  roleApplied: z.string().min(1),
  address: z.string().nullable().optional(),
  education: z.string().min(1),
  experience: z.string().min(1),
  gender: z.enum(["Male", "Female", "Other"]).nullable().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  preferredShift: z.string().nullable().optional(),
  rotationalShift: z.number().nullable().optional(),
  nightShiftOk: z.number().nullable().optional(),
  leavesIn3months: z.number().nullable().optional(),
  ownsTwoWheeler: z.number().nullable().optional(),
  idProofAvailable: z.number().nullable().optional(),
  educationProofAvailable: z.number().nullable().optional(),
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
    const sourceChannel = normalizeSourceChannel(input.sourcingChannel);
    const autoAssign = sourceChannel === "Walk-In" || sourceChannel === "Reference";
    const walkInDate = new Date().toISOString().slice(0, 10);

    // 2. Reuse the ATS candidate when hiring-entry/calling created the lead first.
    // Candidate registration is the walk-in continuation of that same person, not a brand-new record.
    const [existingCandidateRows] = await db.execute<ExistingCandidateRow[]>(
      `SELECT id, candidate_code, current_stage, profile_status, employee_code, active_status
       FROM ats_candidate
       WHERE mobile = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [input.mobile]
    );
    const existingCandidate = existingCandidateRows[0] ?? null;

    if (existingCandidate && (existingCandidate.employee_code || existingCandidate.profile_status === "onboarded")) {
      return res.status(409).json({
        success: false,
        message: "This mobile is already linked to an onboarded candidate",
      });
    }

    let candidateId: string;
    if (existingCandidate) {
      await db.execute(
        `UPDATE ats_candidate
         SET full_name = ?,
             email = ?,
             gender = ?,
             date_of_birth = ?,
             applied_for_process = ?,
             role_applied = ?,
             applied_for_branch = ?,
             branch_display_name = ?,
             sourcing_channel = ?,
             referred_by = ?,
             walk_in_date = ?,
             address = ?,
             education = ?,
             experience = ?,
             rotational_shift = ?,
             preferred_shift = ?,
             night_shift_ok = ?,
             leaves_in_3months = ?,
             owns_two_wheeler = ?,
             id_proof_available = ?,
             education_proof_available = ?,
             active_status = 1,
             profile_status = 'registered',
             current_stage = CASE
               WHEN current_stage IS NULL OR current_stage IN ('Applied', 'New', 'Screening')
               THEN 'Arrived'
               ELSE current_stage
             END,
             updated_at = NOW()
         WHERE id = ?`,
        [
          input.name,
          input.email ?? null,
          input.gender ?? null,
          input.dateOfBirth ?? null,
          input.roleApplied,
          input.roleApplied,
          branchName,
          input.branchDisplayName,
          sourceChannel,
          input.referredBy ?? null,
          walkInDate,
          input.address ?? null,
          input.education,
          input.experience,
          input.rotationalShift ?? null,
          input.preferredShift ?? null,
          input.nightShiftOk ?? null,
          input.leavesIn3months ?? null,
          input.ownsTwoWheeler ?? null,
          input.idProofAvailable ?? null,
          input.educationProofAvailable ?? null,
          existingCandidate.id,
        ]
      );
      candidateId = existingCandidate.id;
    } else {
      const candidate = await atsService.createCandidate({
        fullName: input.name,
        mobile: input.mobile,
        email: input.email ?? null,
        gender: input.gender ?? null,
        dateOfBirth: input.dateOfBirth ?? null,
        education: input.education,
        experience: input.experience,
        appliedForProcess: input.roleApplied,
        appliedForBranch: branchName,
        sourcingChannel: sourceChannel,
        walkInDate,
        address: input.address ?? null,
        preferredShift: input.preferredShift ?? null,
        profileStatus: "registered",
      }, null);
      candidateId = candidate.id;
    }

    // Resolve preferred recruiter to a roster UUID.
    // preferredRecruiterId is an employee UUID (sent by both old and enhanced forms).
    // Fallback: look up by employee name → find employee → ensureRecruiterInRoster.
    let resolvedRecruiterId: string | null = null;

    if (autoAssign) {
      const availableRecruiters = await getAvailableRecruiters(branchName);
      if (availableRecruiters.length > 0) {
        const pick = availableRecruiters[Math.floor(Math.random() * availableRecruiters.length)];
        resolvedRecruiterId = pick.id ?? null;
      }
    }

    if (!resolvedRecruiterId && input.preferredRecruiterId && !autoAssign) {
      const [preferredRosterRows] = await db.execute<RecruiterIdRow[]>(
        `SELECT r.id
         FROM ats_recruiter_roster r
         LEFT JOIN branch_master b ON b.branch_name = r.branch OR b.branch_code = r.branch
         WHERE r.id = ?
           AND r.active_status = 1
           AND (r.branch = ? OR r.branch = ? OR b.branch_name = ? OR b.branch_code = ?)
         LIMIT 1`,
        [input.preferredRecruiterId, branchName, input.branchDisplayName, branchName, input.branchDisplayName]
      );
      if (preferredRosterRows.length > 0) {
        resolvedRecruiterId = preferredRosterRows[0].id;
      }
    }

    if (!resolvedRecruiterId && input.preferredRecruiterId && !autoAssign) {
      // Resolve employee UUID → roster UUID (idempotent upsert)
      const [empRows] = await db.execute<RecruiterEmployeeRow[]>(
        `SELECT e.id, e.first_name, e.last_name, e.mobile,
                COALESCE(e.office_email, e.official_email, e.email) AS email,
                b.branch_name
         FROM employees e
         JOIN branch_master b ON b.id = e.branch_id
         WHERE e.id = ? AND e.active_status = 1
         LIMIT 1`,
        [input.preferredRecruiterId]
      );
      if (empRows.length > 0) {
        const emp = empRows[0];
        resolvedRecruiterId = await ensureRecruiterInRoster({
          id: emp.id,
          first_name: emp.first_name,
          last_name: emp.last_name,
          mobile: emp.mobile,
          email: emp.email,
          branch_name: emp.branch_name,
        });
      }
    }

    if (!resolvedRecruiterId && input.recruiterName && !autoAssign) {
      // Fallback: look up by name — try roster first, then employees
      const [rosterRows] = await db.execute<RecruiterIdRow[]>(
        `SELECT r.id FROM ats_recruiter_roster r
         WHERE r.active_status = 1 AND UPPER(r.name) = UPPER(?)
           AND (r.branch = ? OR r.branch = ?)
         LIMIT 1`,
        [input.recruiterName.trim(), branchName, branchData.canonical_key]
      );
      if (rosterRows.length > 0) {
        resolvedRecruiterId = rosterRows[0].id;
      } else {
        const fullName = input.recruiterName.trim();
        const [empRows] = await db.execute<RecruiterEmployeeRow[]>(
          `SELECT e.id, e.first_name, e.last_name, e.mobile,
                  COALESCE(e.office_email, e.official_email, e.email) AS email,
                  b.branch_name
           FROM employees e
           JOIN branch_master b ON b.id = e.branch_id
           WHERE e.active_status = 1
             AND UPPER(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) = UPPER(?)
           LIMIT 1`,
          [fullName]
        );
        if (empRows.length > 0) {
          const emp = empRows[0];
          resolvedRecruiterId = await ensureRecruiterInRoster({
            id: emp.id,
            first_name: emp.first_name,
            last_name: emp.last_name,
            mobile: emp.mobile,
            email: emp.email,
            branch_name: emp.branch_name,
          });
        }
      }
    }

    await db.execute(
      `UPDATE ats_candidate
       SET branch_display_name = ?, preferred_recruiter_id = ?, recruiter_name = ?, referred_by = ?, sourcing_channel = ?
       WHERE id = ?`,
      [
        input.branchDisplayName,
        resolvedRecruiterId ?? null,
        autoAssign ? null : input.recruiterName ?? null,
        input.referredBy ?? null,
        sourceChannel,
        candidateId,
      ]
    );

    // 4. Assign recruiter (smart assignment with fallback)
    const assignmentResult = await assignRecruiterToCandidate(
      candidateId,
      resolvedRecruiterId
    );

    // 5. Generate token if recruiter assigned
    let tokenNumber: string | null = null;
    if (assignmentResult.assignedRecruiterId) {
      const [existingTokenRows] = await db.execute<ExistingTokenRow[]>(
        `SELECT id, token_number, recruiter_id
         FROM ats_queue_token
         WHERE candidate_id = ?
           AND (status = 'active' OR queue_status IN ('waiting', 'called', 'in_interview'))
         ORDER BY created_at DESC
         LIMIT 1`,
        [candidateId]
      );
      const existingToken = existingTokenRows[0] ?? null;

      if (existingToken) {
        tokenNumber = existingToken.token_number ?? await generateTokenNumber(branchName);
        await db.execute(
          `UPDATE ats_queue_token
           SET recruiter_id = ?,
               branch_name = ?,
               token_number = ?,
               status = 'active',
               queue_status = COALESCE(queue_status, 'waiting'),
               updated_at = NOW()
           WHERE id = ?`,
          [assignmentResult.assignedRecruiterId, branchName, tokenNumber, existingToken.id]
        );
      } else {
        tokenNumber = await generateTokenNumber(branchName);
        await db.execute(
          `INSERT INTO ats_queue_token (
            id, candidate_id, token, arrival_time, current_stage, status,
            branch_name, token_number, recruiter_id, queue_status
          ) VALUES (UUID(), ?, UUID(), NOW(), 'Arrived', 'active', ?, ?, ?, 'waiting')
          ON DUPLICATE KEY UPDATE
            recruiter_id = VALUES(recruiter_id),
            branch_name = VALUES(branch_name),
            token_number = VALUES(token_number),
            updated_at = NOW()`,
          [candidateId, branchName, tokenNumber, assignmentResult.assignedRecruiterId]
        );
      }

      await db.execute(
        `UPDATE ats_candidate
         SET q_token = ?,
             status = 'Waiting',
             current_stage = CASE
               WHEN current_stage IS NULL OR current_stage IN ('Applied', 'New', 'Screening')
               THEN 'Arrived'
               ELSE current_stage
             END,
             created_date = COALESCE(created_date, ?),
             created_time = COALESCE(created_time, TIME(?)),
             updated_at = NOW()
         WHERE id = ?`,
        [tokenNumber, walkInDate, `${walkInDate} 09:00:00`, candidateId]
      );
    }

    // 6. Get recruiter details — assignedRecruiterId is a roster id, join to employees for contact info
    const [latestTokenRows] = await db.execute<ExistingTokenRow[]>(
      `SELECT id, token_number, recruiter_id
       FROM ats_queue_token
       WHERE candidate_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [candidateId]
    );

    await syncHiringActivityFromCandidateRegistration({
      mobile: input.mobile,
      candidateId,
      queueTokenId: latestTokenRows[0]?.id ?? null,
      branchName,
      processName: input.roleApplied,
      activityDate: walkInDate,
    });

    let recruiterDetails: { name: string | null; mobile: string | null; email: string | null; employee_code: string | null } | null = null;
    if (assignmentResult.assignedRecruiterId) {
      const [recRows] = await db.execute<RecruiterContactRow[]>(
        `SELECT r.name, r.mobile, r.email, e.employee_code
         FROM ats_recruiter_roster r
         LEFT JOIN employees e ON e.id = r.employee_id
         WHERE r.id = ?
         LIMIT 1`,
        [assignmentResult.assignedRecruiterId]
      );

      if (recRows.length > 0) {
        const rec = recRows[0];
        recruiterDetails = {
          name: rec.name,
          mobile: rec.mobile,
          email: rec.email,
          employee_code: rec.employee_code,
        };
      }
    }

    // 7. Send emails (async, don't wait)
    const recruiterEmail = recruiterDetails?.email ?? null;
    const recruiterName = recruiterDetails?.name ?? "Recruiter";
    const recruiterMobile = recruiterDetails?.mobile ?? "Not available";

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
        recruiterName,
        recruiterMobile,
        registrationDate,
      }).catch((err) => console.error('Failed to send candidate email:', err));

      // Send recruiter notification
      if (recruiterEmail) {
        sendRecruiterNotificationEmail({
          candidateId,
          to: recruiterEmail,
          recruiterName,
          candidateName: input.name,
          candidateMobile: input.mobile,
          tokenNumber: tokenNumber || 'Pending',
          branchDisplayName: input.branchDisplayName,
          roleApplied: input.roleApplied || 'Not specified',
        }).catch((err) => console.error('Failed to send recruiter email:', err));
      }
    }

    // 8. Fetch candidate_code for the success response
    const [codeRows] = await db.execute<CandidateCodeRow[]>(
      'SELECT candidate_code FROM ats_candidate WHERE id = ? LIMIT 1',
      [candidateId]
    );
    const candidate_code = codeRows[0]?.candidate_code ?? null;

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      candidateId,
      candidate_code,
      tokenNumber,
      branchName,
      branchDisplayName: input.branchDisplayName,
      recruiter: recruiterDetails,
      assignmentReason: assignmentResult.assignmentReason,
    });
  } catch (error: unknown) {
    console.error("Enhanced registration error:", error);
    const status = getErrorStatus(error);
    return res.status(status).json({
      success: false,
      message: getErrorMessage(error) || "Registration failed",
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

    // Extract metadata from the URL itself — no parsing library required
    const urlParts = fileUrl.split('/');
    const filename = decodeURIComponent(urlParts[urlParts.length - 1] ?? '');
    const lower = filename.toLowerCase();
    const isPdf = lower.endsWith('.pdf');
    const isDoc = lower.endsWith('.docx') || lower.endsWith('.doc');

    // For plain-text files, attempt a fetch and read
    let extractedText = '';
    if (lower.endsWith('.txt')) {
      try {
        const response = await fetch(fileUrl);
        if (response.ok) {
          extractedText = await response.text();
        }
      } catch {
        // Silently ignore fetch failures — fallback data is returned below
      }
    }

    const parsed = {
      name: '',
      mobile: '',
      email: '',
      education: '',
      experience: '',
      skills: [] as string[],
      company: '',
      designation: '',
      address: extractedText ? extractedText.slice(0, 500) : '',
      source_url: fileUrl,
      filename,
      parse_status: isPdf || isDoc
        ? 'manual_review_required'
        : lower.endsWith('.txt') && extractedText
          ? 'text_extracted'
          : 'unsupported_format',
      parse_message: isPdf || isDoc
        ? 'Resume uploaded successfully. Please fill in the details manually or use the preview to copy information.'
        : lower.endsWith('.txt') && extractedText
          ? 'Plain-text content extracted. Please review and fill in the structured fields.'
          : 'Unsupported file format. Please upload a PDF or Word document.',
    };

    return res.json({ success: true, data: parsed });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});

// ── 5. Parse-resume capability status ────────────────────────────────────────
registrationEnhancedRouter.get('/parse-resume/status', (_req, res) => {
  res.json({
    success: true,
    data: {
      parsing_available: false,
      supported_formats: ['pdf', 'docx', 'doc'],
      message: 'Automatic parsing not available. Manual entry required.',
    },
  });
});
