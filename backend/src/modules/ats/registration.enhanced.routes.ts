import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/mysql.js";
import { RowDataPacket } from "mysql2/promise";
import multer from "multer";
import axios from "axios";
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

// Memory-storage multer for resume parsing (PDF + images, 10 MB max)
const resumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/jpg"];
    cb(null, allowed.includes(file.mimetype));
  },
});

// ── Resume parsing helpers ─────────────────────────────────────────────────────

function buildParsePrompt(
  contentDescription: string,
  options: Record<string, string[]>
): string {
  return `You are a resume parser. ${contentDescription}

Extract candidate details and return ONLY a valid JSON object (no markdown, no explanation).

Available options for each field — ONLY use these exact values for select fields:
- education: ${JSON.stringify(options.educationOptions ?? [])}
- experience: ${JSON.stringify(options.experienceOptions ?? [])}
- roleApplied: ${JSON.stringify(options.roleOptions ?? [])}
- preferredShift: ${JSON.stringify(options.preferredShiftOptions ?? [])}
- nightShiftComfort: ${JSON.stringify(options.nightShiftComfortOptions ?? [])}
- gender: ["Male", "Female", "Other"]
- rotationalShift: ["Yes", "No"]
- leavesRequired: ["Yes", "No"]
- ownTwoWheeler: ["Yes", "No"]

Return JSON with these keys (use empty string "" if not found):
{
  "name": "",
  "mobile": "",
  "email": "",
  "address": "",
  "education": "",
  "experience": "",
  "gender": "",
  "roleApplied": "",
  "rotationalShift": "",
  "preferredShift": "",
  "nightShiftComfort": "",
  "leavesRequired": "",
  "ownTwoWheeler": ""
}`;
}

async function geminiParseText(
  text: string,
  options: Record<string, string[]>
): Promise<Record<string, string>> {
  const prompt = buildParsePrompt(
    `Parse this resume text:\n\n${text.slice(0, 8000)}`,
    options
  );
  const resp = await axios.post(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
    { contents: [{ parts: [{ text: prompt }] }] },
    {
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": process.env.GEMINI_API_KEY,
      },
      timeout: 30000,
    }
  );
  const raw: string = resp.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  const jsonStr = raw.replace(/```json\n?|\n?```/g, "").trim();
  return JSON.parse(jsonStr);
}

async function geminiParseImage(
  base64: string,
  mimeType: string,
  options: Record<string, string[]>
): Promise<Record<string, string>> {
  const prompt = buildParsePrompt("Parse this resume image.", options);
  const resp = await axios.post(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
    {
      contents: [{
        parts: [
          { inlineData: { mimeType, data: base64 } },
          { text: prompt },
        ],
      }],
    },
    {
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": process.env.GEMINI_API_KEY,
      },
      timeout: 30000,
    }
  );
  const raw: string = resp.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  const jsonStr = raw.replace(/```json\n?|\n?```/g, "").trim();
  return JSON.parse(jsonStr);
}

function regexParse(
  text: string,
  options: Record<string, string[]>
): Record<string, string> {
  const fields: Record<string, string> = {};
  const t = text;

  // Mobile — Indian mobile number
  const mobileMatch = t.match(/\b[6-9]\d{9}\b/);
  if (mobileMatch) fields.mobile = mobileMatch[0];

  // Email
  const emailMatch = t.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) fields.email = emailMatch[0].toLowerCase();

  // Name — line starting with "Name:" or first line with 2+ words
  const nameLabel = t.match(/(?:^|\n)\s*(?:name|full name)\s*[:\-]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/im);
  if (nameLabel) {
    fields.name = nameLabel[1].trim();
  } else {
    const firstCapLine = t.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/m);
    if (firstCapLine) fields.name = firstCapLine[1].trim();
  }

  // Address — line starting with "Address:"
  const addrMatch = t.match(/(?:^|\n)\s*(?:address|location)\s*[:\-]?\s*(.+?)(?:\n|$)/im);
  if (addrMatch) fields.address = addrMatch[1].trim();

  // Education — match against options
  const eduOpts = options.educationOptions ?? [];
  for (const opt of eduOpts) {
    if (t.toLowerCase().includes(opt.toLowerCase())) { fields.education = opt; break; }
  }

  // Experience — parse year counts
  const expOpts = options.experienceOptions ?? [];
  const yearMatch = t.match(/(\d+(?:\.\d+)?)\s*(?:\+)?\s*years?\s*(?:of)?\s*(?:experience)?/i);
  if (yearMatch) {
    const yrs = parseFloat(yearMatch[1]);
    if (yrs === 0 || t.toLowerCase().includes("fresher")) fields.experience = "Fresher";
    else if (yrs <= 1) fields.experience = expOpts.find(o => o.includes("0-1")) ?? "";
    else if (yrs <= 2) fields.experience = expOpts.find(o => o.includes("1-2")) ?? "";
    else if (yrs <= 3) fields.experience = expOpts.find(o => o.includes("2-3")) ?? "";
    else fields.experience = expOpts.find(o => o.includes("3+")) ?? "";
  } else if (/fresher|no experience/i.test(t)) {
    fields.experience = "Fresher";
  }

  // Gender
  if (/\bfemale\b/i.test(t)) fields.gender = "Female";
  else if (/\bmale\b/i.test(t)) fields.gender = "Male";

  // Role — keyword match
  const roleOpts = options.roleOptions ?? [];
  const tl = t.toLowerCase();
  for (const opt of roleOpts) {
    if (tl.includes(opt.toLowerCase())) { fields.roleApplied = opt; break; }
  }
  if (!fields.roleApplied) {
    if (tl.includes("inbound")) fields.roleApplied = roleOpts.find(o => /inbound/i.test(o)) ?? "";
    else if (tl.includes("outbound")) fields.roleApplied = roleOpts.find(o => /outbound/i.test(o)) ?? "";
    else if (tl.includes("back office") || tl.includes("backoffice")) fields.roleApplied = roleOpts.find(o => /back/i.test(o)) ?? "";
    else if (tl.includes("quality")) fields.roleApplied = roleOpts.find(o => /quality/i.test(o)) ?? "";
  }

  return fields;
}

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
        id: r.id,                      // roster id (FK-safe for ats_candidate.recruiter_id)
        employee_id: r.id,             // alias used by frontend as preferredRecruiterId
        employee_code: r.employee_code,
        name: [r.first_name, r.last_name].filter(Boolean).join(' ').trim(),
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
  preferredRecruiterId: z.string().uuid().nullable().optional(),
  recruiterName: z.string().nullable().optional(),
  roleApplied: z.string().min(1),
  address: z.string().optional(),
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
      rotationalShift: input.rotationalShift != null ? String(input.rotationalShift) : null,
      nightShiftOk: input.nightShiftOk != null ? String(input.nightShiftOk) : null,
      leavesIn3months: input.leavesIn3months != null ? String(input.leavesIn3months) : null,
      ownsTwoWheeler: input.ownsTwoWheeler != null ? String(input.ownsTwoWheeler) : null,
      idProofAvailable: input.idProofAvailable != null ? String(input.idProofAvailable) : null,
      educationProofAvailable: input.educationProofAvailable != null ? String(input.educationProofAvailable) : null,
      profileStatus: "registered",
    }, null);
    const candidateId = candidate.id;

    // Resolve recruiter ID — must be an ats_recruiter_roster.id (FK target)
    // preferredRecruiterId from the frontend is already a roster id (returned by getAvailableRecruiters).
    // Fallback: look up by name → get roster id (upsert if needed).
    let resolvedRecruiterId = input.preferredRecruiterId || null;
    if (!resolvedRecruiterId && input.recruiterName) {
      // Try roster first (fast path — most cases already seeded)
      const [rosterRows] = await db.execute<RowDataPacket[]>(
        `SELECT r.id FROM ats_recruiter_roster r
         WHERE r.active_status = 1
           AND UPPER(r.name) = UPPER(?)
           AND (r.branch = ? OR r.branch = ?)
         LIMIT 1`,
        [input.recruiterName.trim(), branchName, branchData.canonical_key]
      );
      if ((rosterRows as RowDataPacket[]).length > 0) {
        resolvedRecruiterId = (rosterRows as RowDataPacket[])[0].id as string;
      } else {
        // Not in roster yet — find the employee and upsert into roster
        const nameParts = input.recruiterName.trim().split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ');
        const [empRows] = await db.execute<RowDataPacket[]>(
          `SELECT e.id, e.first_name, e.last_name, e.mobile, e.email, b.branch_name
           FROM employees e
           JOIN branch_master b ON b.id = e.branch_id
           WHERE e.active_status = 1
             AND UPPER(e.first_name) = UPPER(?)
             AND (? = '' OR UPPER(TRIM(COALESCE(e.last_name,''))) = UPPER(?))
             AND (b.branch_name = ? OR b.branch_code = ?)
           LIMIT 1`,
          [firstName, lastName, lastName, branchName, branchName]
        );
        if ((empRows as RowDataPacket[]).length > 0) {
          const emp = (empRows as RowDataPacket[])[0] as any;
          // ensureRecruiterInRoster is not exported — do inline upsert
          const [existingRoster] = await db.execute<RowDataPacket[]>(
            `SELECT id FROM ats_recruiter_roster WHERE employee_id = ? LIMIT 1`,
            [emp.id]
          );
          if ((existingRoster as RowDataPacket[]).length > 0) {
            resolvedRecruiterId = (existingRoster as RowDataPacket[])[0].id as string;
          } else {
            const { randomUUID } = await import('crypto');
            const rosterId = randomUUID();
            const fullName = `${emp.first_name} ${emp.last_name ?? ''}`.trim();
            await db.execute(
              `INSERT INTO ats_recruiter_roster
                 (id, name, email, mobile, branch, employee_id, active_status, active_flag,
                  available_today, daily_capacity, assigned_today)
               VALUES (?, ?, ?, ?, ?, ?, 1, 'Y', 'Y', 999, 0)`,
              [rosterId, fullName, emp.email ?? null, emp.mobile ?? null, emp.branch_name, emp.id]
            );
            resolvedRecruiterId = rosterId;
          }
        }
      }
    }

    await db.execute(
      `UPDATE ats_candidate
       SET branch_display_name = ?, preferred_recruiter_id = ?, recruiter_name = ?
       WHERE id = ?`,
      [input.branchDisplayName, resolvedRecruiterId ?? null, input.recruiterName ?? null, candidateId]
    );

    // 4. Assign recruiter (smart assignment with fallback)
    const assignmentResult = await assignRecruiterToCandidate(
      candidateId,
      resolvedRecruiterId
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

    // 6. Get recruiter details — prefer official employee contact over stale roster row
    let recruiterDetails = null;
    if (assignmentResult.assignedRecruiterId) {
      const [recRows] = await db.execute<RowDataPacket[]>(
        `SELECT r.name,
                COALESCE(e.mobile, r.mobile)                                         AS mobile,
                COALESCE(e.official_email, e.office_email, e.email, r.email)         AS email,
                e.employee_code
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

    // 8. Fetch candidate_code for the success response
    const [codeRows] = await db.execute<RowDataPacket[]>(
      'SELECT candidate_code FROM ats_candidate WHERE id = ? LIMIT 1',
      [candidateId]
    );
    const candidate_code = (codeRows as RowDataPacket[])[0]?.candidate_code ?? null;

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
  } catch (error: any) {
    console.error("Enhanced registration error:", error);
    const status = error?.statusCode ?? (error?.name === "ZodError" ? 400 : 500);
    return res.status(status).json({
      success: false,
      message: error.message || "Registration failed",
    });
  }
});

// ── 4. Parse resume — Gemini AI + pdf-parse ───────────────────────────────────
registrationEnhancedRouter.post(
  "/parse-resume",
  resumeUpload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: "No file uploaded" });
      }

      const { mimetype, buffer } = req.file;
      let optionsArg: Record<string, string[]> = {};
      try { optionsArg = JSON.parse(req.body.options ?? "{}"); } catch { /* ignore */ }

      const hasGemini = !!process.env.GEMINI_API_KEY;
      const isPdf = mimetype === "application/pdf";

      if (isPdf) {
        // Extract text from PDF with pdf-parse
        let pdfText = "";
        try {
          const { PDFParse } = await import("pdf-parse");
          const parser = new PDFParse({ data: buffer });
          const result = await parser.getText();
          pdfText = result.text ?? "";
        } catch {
          pdfText = "";
        }

        if (!pdfText.trim()) {
          return res.json({ success: true, fields: {}, message: "Could not extract text from PDF" });
        }

        let fields: Record<string, string> = {};
        if (hasGemini) {
          try {
            fields = await geminiParseText(pdfText, optionsArg);
          } catch {
            fields = regexParse(pdfText, optionsArg);
          }
        } else {
          fields = regexParse(pdfText, optionsArg);
        }
        return res.json({ success: true, fields });
      }

      // Image path
      if (!hasGemini) {
        // No Gemini key — tell frontend to fall back to Tesseract
        return res.json({ success: true, needsClientOcr: true, fields: {} });
      }

      const base64 = buffer.toString("base64");
      let fields: Record<string, string> = {};
      try {
        fields = await geminiParseImage(base64, mimetype, optionsArg);
      } catch {
        fields = {};
      }
      return res.json({ success: true, fields });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }
);

// ── 5. Parse-resume capability status ────────────────────────────────────────
registrationEnhancedRouter.get("/parse-resume/status", (_req, res) => {
  res.json({
    success: true,
    data: {
      parsing_available: true,
      pdf_supported: true,
      ai_enhanced: !!process.env.GEMINI_API_KEY,
      supported_formats: ["pdf", "jpg", "jpeg", "png", "webp"],
    },
  });
});
