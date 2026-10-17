import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs";
import https from "https";
import { sendAddressBgvLinkEmail } from "./ats.email.service.js";
import multer from "multer";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { canAccessCandidate, resolveCandidateScope } from "./candidate-access.js";
import { assessForCandidate, summarise, upsertAddressCheck, type AddressAssessment } from "./address-verification-assessment.js";

// Branch scoping (owner ruling 2026-10-01): HR-facing address-verification actions are limited to candidates
// inside the caller's own branch / assigned scope (org-wide roles unaffected).
const OUT_OF_SCOPE = { success: false, message: "Forbidden: this candidate is outside your branch / assigned scope" };

const router = Router();
const h =
  (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

export const MAX_ATTEMPTS = 3;
const GPS_PASS_THRESHOLD_M = 50;
const EXPIRY_HOURS = 168; // 7 days

const SELFIE_DIR = path.resolve("uploads/bgv-selfies");
if (!fs.existsSync(SELFIE_DIR)) fs.mkdirSync(SELFIE_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, SELFIE_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".jpg";
      cb(null, `${uuidv4()}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are accepted"));
  },
});

function haversineMetres(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nominatimQuery(
  query: string,
): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    const q = encodeURIComponent(query);
    const options = {
      hostname: "nominatim.openstreetmap.org",
      path: `/search?q=${q}&format=json&limit=1&countrycodes=IN`,
      headers: { "User-Agent": "MASCallnet-HRMS/1.0" },
      timeout: 6000,
    };
    const req = https.get(options, (res) => {
      let data = "";
      res.on("data", (chunk: string) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const arr = JSON.parse(data) as Array<{ lat: string; lon: string }>;
          if (arr.length)
            resolve({
              lat: parseFloat(arr[0].lat),
              lng: parseFloat(arr[0].lon),
            });
          else resolve(null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

// Tries pincode → city+state → full address in order. Stops at first hit.
async function geocodeAddress(
  fullAddress: string,
  hints?: { pincode?: string; city?: string; state?: string },
): Promise<{ lat: number; lng: number } | null> {
  // 1. Pincode is the most precise and least ambiguous query for Indian addresses
  if (hints?.pincode && /^\d{6}$/.test(hints.pincode)) {
    const r = await nominatimQuery(`${hints.pincode}, India`);
    if (r) return r;
  }
  // 2. City + State
  if (hints?.city && hints?.state) {
    const r = await nominatimQuery(`${hints.city}, ${hints.state}, India`);
    if (r) return r;
  }
  // 3. Full concatenated address as last resort
  return nominatimQuery(fullAddress + ", India");
}

// Returns ONLY the present address — permanent address is not used for GPS verification.
export function buildPresentAddress(profile: RowDataPacket | null): string {
  if (!profile) return "";
  // Always the CURRENT residential address — never the permanent one. Falls back to the profile's
  // single-field current_address only when the structured present_* columns are all empty.
  const structured = [
    profile.present_address_line1,
    profile.present_address_line2,
    profile.present_address,
    profile.present_city,
    profile.present_state,
    profile.present_pincode,
  ]
    .map((v) => (v ? String(v).trim().replace(/[\s,]+$/, "") : ""))
    .filter(Boolean)
    // Candidates routinely type the city / state / pincode into the street line as well as its own
    // field, which printed "..., New Delhi, Delhi, 110095" with the pincode twice. Drop a part that
    // the text so far already contains.
    .reduce<string[]>((acc, part) => (
      acc.join(", ").toLowerCase().includes(part.toLowerCase()) ? acc : [...acc, part]
    ), [])
    .join(", ");
  return structured || (profile.current_address ? String(profile.current_address).trim() : "");
}

function extractAddressHints(profile: RowDataPacket | null) {
  if (!profile) return {};
  return {
    pincode: profile.present_pincode
      ? String(profile.present_pincode).trim()
      : undefined,
    city: profile.present_city
      ? String(profile.present_city).trim()
      : undefined,
    state: profile.present_state
      ? String(profile.present_state).trim()
      : undefined,
  };
}

export async function syncAddressBgvCheck(
  candidateId: string,
  status: "verified" | "failed" | "not_run",
  verifiedRemarks?: string,
) {
  const now = status === "verified" ? new Date() : null;
  const summary =
    status === "verified"
      ? "Address verified via geo-tagged selfie"
      : status === "failed"
        ? "Address verification failed after max attempts"
        : null;
  await upsertAddressCheck(candidateId, status, now, summary);

  // Propagate into candidate_bgv_report.address_status, which is what actually
  // gates appointment-letter eligibility (evaluateAppointmentLetterEligibility's
  // outstandingBgvCategories reads address_status, not candidate_bgv_check).
  // Without this, an auto-verified GPS-selfie match was recorded in the audit
  // trail above but never cleared the real blocker — HR still had to mark
  // address_status by hand, which is the manual step this endpoint exists to
  // remove. Only a targeted UPDATE on an existing, unlocked report: this must
  // never INSERT a new candidate_bgv_report row (that would fabricate a report
  // with every other category null) and must never touch a locked report,
  // matching the same lock guard bgv-verification.routes.ts enforces.
  //
  // address_status is ENUM('not_run','passed','failed','partial') — 'passed' is
  // the value that clears the check (outstandingBgvCategories' done() accepts
  // "passed"/"waived"/"verified"); there is no 'verified' enum member here.
  if (status === "verified" || status === "failed") {
    const addressStatus = status === "verified" ? "passed" : "failed";
    const addressRemarks =
      status === "verified"
        ? (verifiedRemarks ?? "Auto-verified via geo-tagged selfie (GPS within threshold) — no manual review required.")
        : "Address verification failed after max attempts on the geo-tagged selfie link.";
    await db.execute(
      `UPDATE candidate_bgv_report
          SET address_status = ?, address_remarks = ?, updated_at = NOW()
        WHERE candidate_id = ? AND (locked = 0 OR locked IS NULL)`,
      [addressStatus, addressRemarks, candidateId],
    );

    // Roll the new address result into the overall BGV verdict (score + overall_status), the same
    // way every other check update does. Without this the Joining Control Room and the
    // appointment-letter gate kept reading a stale 'in_progress' even with all categories done.
    // Only when a report already exists (computeAndSaveScore would otherwise insert a bare one);
    // a locked report is left alone inside computeAndSaveScore. Reaching 'clear' also triggers
    // the appointment-letter auto-issue there.
    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT 1 FROM candidate_bgv_report WHERE candidate_id = ? LIMIT 1`,
      [candidateId],
    );
    if (existing.length) {
      const { computeAndSaveScore } = await import("./bgv-verification.service.js");
      await computeAndSaveScore(candidateId);
    }
  }
}

// ── Core initiation logic (used by HR route and auto-send) ───────────────────
export interface AddressBgvInitResult {
  sent: boolean;
  skippedReason?: "max_attempts" | "no_address" | "no_email" | "already_sent";
  token?: string;
  link?: string;
  expiresAt?: Date;
  declaredAddress?: string;
  attemptNumber?: number;
  geoResolved?: boolean;
}

export async function initiateAddressBgvForCandidate(
  candidateId: string,
  opts: { forceUnblock?: boolean; unblockerId?: string | null; onlyIfNone?: boolean; skipEmail?: boolean } = {},
): Promise<AddressBgvInitResult> {
  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM candidate_bgv_address_verification WHERE candidate_id = ?`,
    [candidateId],
  );
  const attemptCount = Number((countRows[0] as RowDataPacket).cnt);

  // Idempotent auto paths (approval, profile submit, sweep) must never mint a second link.
  if (opts.onlyIfNone && attemptCount > 0) {
    return { sent: false, skippedReason: "already_sent" };
  }

  if (attemptCount >= MAX_ATTEMPTS && !opts.forceUnblock) {
    return { sent: false, skippedReason: "max_attempts" };
  }

  const [[candRow]] = await db.execute<RowDataPacket[]>(
    `SELECT full_name, email FROM ats_candidate WHERE id = ? LIMIT 1`,
    [candidateId],
  );

  const [profiles] = await db.execute<RowDataPacket[]>(
    `SELECT current_address, present_address_line1, present_address_line2, present_address,
            present_city, present_state, present_pincode,
            permanent_address_line1, permanent_address_line2, permanent_address,
            permanent_city, permanent_state, permanent_pincode
       FROM candidate_onboarding_profile WHERE candidate_id = ? LIMIT 1`,
    [candidateId],
  );
  const profile = profiles[0] ?? null;
  const declaredAddress = buildPresentAddress(profile);
  if (!declaredAddress) {
    return { sent: false, skippedReason: "no_address" };
  }

  // skipEmail: HR is copying the link to hand over directly (Ops Control Tower), so no mailbox is needed.
  if (!opts.skipEmail && !candRow?.email) {
    return { sent: false, skippedReason: "no_email" };
  }

  const hints = extractAddressHints(profile);
  const geo = await geocodeAddress(declaredAddress, hints).catch(() => null);

  const token = uuidv4();
  const expiresAt = new Date(Date.now() + EXPIRY_HOURS * 3600 * 1000);
  const nextAttempt = attemptCount + 1;

  await db.execute(
    `INSERT INTO candidate_bgv_address_verification
       (candidate_id, token, declared_address, ref_latitude, ref_longitude,
        attempt_number, sent_via, expires_at, unblocked_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      candidateId,
      token,
      declaredAddress,
      geo?.lat ?? null,
      geo?.lng ?? null,
      nextAttempt,
      // 'copied' = HR took the link to hand over directly; those are never auto-reminded by email.
      opts.skipEmail ? "copied" : "link",
      expiresAt,
      opts.forceUnblock ? (opts.unblockerId ?? null) : null,
    ],
  );

  const appUrl = process.env.APP_URL ?? "https://mcnhrms.teammas.in";
  const link = `${appUrl}/bgv-address-verify/${token}`;

  if (!opts.skipEmail) {
    void sendAddressBgvLinkEmail({
      candidateId,
      to: candRow.email as string,
      candidateName: (candRow.full_name as string) ?? "Candidate",
      declaredAddress,
      verificationLink: link,
      attemptNumber: nextAttempt,
      maxAttempts: MAX_ATTEMPTS,
      expiresAt,
    }).catch(() => {});
  }

  return {
    sent: true,
    token,
    link,
    expiresAt,
    declaredAddress,
    attemptNumber: nextAttempt,
    geoResolved: geo !== null,
  };
}

/**
 * A link HR can copy and hand to the candidate. Reuses the candidate's live (pending, unexpired) link so
 * repeated clicks do not burn the 3-attempt allowance; otherwise mints a fresh attempt WITHOUT emailing.
 */
export async function getOrCreateAddressVerificationLink(
  candidateId: string,
): Promise<
  | { ok: true; link: string; expiresAt: Date; reused: boolean }
  | { ok: false; reason: "max_attempts" | "no_address" }
> {
  const appUrl = process.env.APP_URL ?? "https://mcnhrms.teammas.in";
  const [live] = await db.execute<RowDataPacket[]>(
    `SELECT token, expires_at FROM candidate_bgv_address_verification
      WHERE candidate_id = ? AND status = 'pending' AND expires_at > NOW()
      ORDER BY created_at DESC LIMIT 1`,
    [candidateId],
  );
  if (live[0]) {
    return {
      ok: true,
      link: `${appUrl}/bgv-address-verify/${String(live[0].token)}`,
      expiresAt: new Date(live[0].expires_at as string),
      reused: true,
    };
  }
  const r = await initiateAddressBgvForCandidate(candidateId, { skipEmail: true });
  if (!r.sent || !r.link || !r.expiresAt) {
    return { ok: false, reason: r.skippedReason === "no_address" ? "no_address" : "max_attempts" };
  }
  return { ok: true, link: r.link, expiresAt: r.expiresAt, reused: false };
}

/**
 * Auto-send, with the outcome logged. The approval-time trigger used to be
 * `void initiate(...).catch(() => {})`, so a skip (no address yet, no email) or a failure left no
 * trace and nothing ever retried it. Safe to call repeatedly: onlyIfNone makes it a no-op once a
 * link exists. Never throws.
 */
export async function autoSendAddressBgvLink(candidateId: string, trigger: string): Promise<void> {
  try {
    const r = await initiateAddressBgvForCandidate(candidateId, { onlyIfNone: true });
    if (r.sent) console.log(`[address-bgv] link sent candidate=${candidateId} trigger=${trigger}`);
    else if (r.skippedReason !== "already_sent") {
      console.warn(`[address-bgv] link NOT sent candidate=${candidateId} trigger=${trigger} reason=${r.skippedReason}`);
    }
  } catch (err) {
    console.error(`[address-bgv] auto-send failed candidate=${candidateId} trigger=${trigger}:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Catch-up for candidates who passed approval (or submitted their profile) but never got a link —
 * typically because the address was not filled in yet when approval fired. Only rows that can
 * actually be sent (address + email present) and are recent are selected, so permanently
 * unsendable rows cannot starve the batch and old candidates are never emailed out of the blue.
 */
export async function sweepMissingAddressBgvLinks(limit = 5): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.id
       FROM ats_candidate c
       JOIN candidate_onboarding_profile p ON p.candidate_id = c.id
      WHERE (c.current_stage = 'offer_approved' OR c.profile_submitted_at IS NOT NULL)
        AND COALESCE(c.profile_submitted_at, c.updated_at) >= NOW() - INTERVAL 14 DAY
        AND c.email IS NOT NULL AND TRIM(c.email) <> ''
        AND COALESCE(NULLIF(TRIM(p.present_address), ''), NULLIF(TRIM(p.present_address_line1), ''), NULLIF(TRIM(p.current_address), '')) IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM candidate_bgv_address_verification v WHERE v.candidate_id = c.id)
      ORDER BY c.updated_at DESC
      LIMIT ${Math.max(1, Math.min(50, Math.trunc(limit)))}`,
  );
  for (const row of rows) await autoSendAddressBgvLink(String(row.id), "sweep");
  return rows.length;
}

/**
 * Reminds candidates whose emailed link is still unused: once 24h after it was sent and once more 72h
 * after. Skips HR-copied links, expired or nearly expired ones, and candidates without an email. Each
 * (link, reminder number) is claimed in address_bgv_reminder_log BEFORE sending (unique key), so two
 * workers or a retry can never double-send. Capped per tick to stay inside the mail quota.
 */
export async function sendAddressBgvReminders(limit = 10): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT v.id, v.candidate_id, v.token, v.declared_address, v.attempt_number, v.expires_at, v.created_at,
            c.email, c.full_name
       FROM candidate_bgv_address_verification v
       JOIN ats_candidate c ON c.id = v.candidate_id
      WHERE v.status = 'pending' AND v.sent_via = 'link'
        AND v.expires_at > NOW() + INTERVAL 6 HOUR
        AND v.created_at <= NOW() - INTERVAL 24 HOUR
        AND v.created_at >= NOW() - INTERVAL 7 DAY
        AND c.email IS NOT NULL AND TRIM(c.email) <> ''
        AND NOT EXISTS (SELECT 1 FROM candidate_bgv_address_verification vv
                         WHERE vv.candidate_id = v.candidate_id AND vv.status IN ('submitted', 'verified'))
      ORDER BY v.created_at ASC
      LIMIT 100`,
  );
  if (!rows.length) return 0;
  const ids = rows.map((r) => String(r.id));
  const [logged] = await db.execute<RowDataPacket[]>(
    `SELECT verification_id, MAX(reminder_no) AS last_no, MAX(sent_at) AS last_at
       FROM address_bgv_reminder_log WHERE verification_id IN (${ids.map(() => "?").join(",")})
      GROUP BY verification_id`,
    ids,
  );
  const lastBy = new Map(logged.map((l) => [String(l.verification_id), { no: Number(l.last_no), at: new Date(l.last_at as string) }]));
  const appUrl = process.env.APP_URL ?? "https://mcnhrms.teammas.in";
  let sent = 0;
  for (const r of rows) {
    if (sent >= limit) break;
    const last = lastBy.get(String(r.id));
    const ageH = (Date.now() - new Date(r.created_at as string).getTime()) / 3_600_000;
    const next = !last ? 1 : last.no === 1 && ageH >= 72 && Date.now() - last.at.getTime() >= 24 * 3_600_000 ? 2 : 0;
    if (next === 0) continue;
    try {
      await db.execute(
        `INSERT INTO address_bgv_reminder_log (id, verification_id, candidate_id, reminder_no, outcome)
         VALUES (?, ?, ?, ?, 'claimed')`,
        [uuidv4(), r.id, r.candidate_id, next],
      );
    } catch {
      continue; // already claimed by another worker / earlier tick
    }
    const out = await sendAddressBgvLinkEmail({
      candidateId: String(r.candidate_id),
      to: String(r.email),
      candidateName: String(r.full_name ?? "Candidate"),
      declaredAddress: String(r.declared_address ?? ""),
      verificationLink: `${appUrl}/bgv-address-verify/${String(r.token)}`,
      attemptNumber: Number(r.attempt_number ?? 1),
      maxAttempts: MAX_ATTEMPTS,
      expiresAt: new Date(r.expires_at as string),
      reminderNo: next,
    }).catch(() => ({ ok: false, skipped: false }));
    await db.execute(
      `UPDATE address_bgv_reminder_log SET outcome = ? WHERE verification_id = ? AND reminder_no = ?`,
      [out.ok && !(out as { skipped?: boolean }).skipped ? "sent" : "failed", r.id, next],
    ).catch(() => undefined);
    if (out.ok) sent++;
  }
  return sent;
}

// ── HR: initiate ──────────────────────────────────────────────────────────────
router.post(
  "/initiate",
  requireAuth,
  requireRole(
    "admin",
    "hr",
    "hr_admin",
    "ho_hr",
    "branch_hr",
    "process_hr",
    "recruitment_hr",
  ),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { candidateId, forceUnblock } = req.body as {
      candidateId?: string;
      forceUnblock?: boolean;
    };
    if (!candidateId)
      return res
        .status(400)
        .json({ success: false, message: "candidateId required" });
    if (!(await canAccessCandidate(req.authUser!.id, candidateId))) return res.status(403).json(OUT_OF_SCOPE);

    let unblockerId: string | null = null;
    if (forceUnblock) {
      const [empRows] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM employees WHERE user_id = ? LIMIT 1`,
        [req.authUser?.id],
      );
      unblockerId = empRows[0]?.id ?? null;
    }

    const result = await initiateAddressBgvForCandidate(candidateId, {
      forceUnblock,
      unblockerId,
    });

    if (!result.sent) {
      if (result.skippedReason === "max_attempts") {
        return res.status(422).json({
          success: false,
          message: `Max ${MAX_ATTEMPTS} attempts reached. Use forceUnblock=true (HR override) to allow another attempt.`,
          maxReached: true,
        });
      }
      if (result.skippedReason === "no_address") {
        return res.status(422).json({
          success: false,
          message:
            "No present address on record. Ask the candidate to fill in their current address in the onboarding profile first.",
        });
      }
      return res.status(422).json({ success: false, message: "Could not send verification link." });
    }

    return res.json({ success: true, data: result });
  }),
);

// ── HR: backfill — send to all offer_approved candidates who haven't received a link ──
router.post(
  "/backfill-offer-approved",
  requireAuth,
  requireRole("admin", "hr_admin", "ho_hr"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const scope = await resolveCandidateScope(req.authUser!.id, "c");
    const [candidates] = await db.execute<RowDataPacket[]>(
      `SELECT c.id
         FROM ats_candidate c
        WHERE c.current_stage = 'offer_approved'
          AND (${scope.sql})
          AND NOT EXISTS (
            SELECT 1 FROM candidate_bgv_address_verification v WHERE v.candidate_id = c.id
          )`,
      scope.params as any[],
    );

    let sent = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const row of candidates) {
      try {
        const result = await initiateAddressBgvForCandidate(row.id as string);
        if (result.sent) sent++;
        else skipped++;
      } catch (err: unknown) {
        errors.push(`${row.id as string}: ${err instanceof Error ? err.message : String(err)}`);
        skipped++;
      }
    }

    return res.json({ success: true, data: { total: candidates.length, sent, skipped, errors } });
  }),
);

// ── Public: fetch info by token (no auth) ─────────────────────────────────────
router.get(
  "/public/:token",
  h(async (req: Request, res: Response) => {
    const { token } = req.params;
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, candidate_id, declared_address, expires_at, status, attempt_number
       FROM candidate_bgv_address_verification WHERE token = ? LIMIT 1`,
      [token],
    );
    const row = rows[0];
    if (!row)
      return res
        .status(404)
        .json({ success: false, message: "Link not found or already used." });
    if (new Date(row.expires_at as string) < new Date()) {
      await db.execute(
        `UPDATE candidate_bgv_address_verification SET status='expired' WHERE token=? AND status='pending'`,
        [token],
      );
      return res
        .status(410)
        .json({
          success: false,
          message: "This link has expired. Please contact HR for a new one.",
        });
    }
    if (row.status !== "pending") {
      return res.status(409).json({
        success: false,
        message:
          row.status === "submitted"
            ? "This verification has already been submitted."
            : "This link is no longer active.",
      });
    }
    const [cands] = await db.execute<RowDataPacket[]>(
      `SELECT full_name, candidate_code FROM ats_candidate WHERE id = ? LIMIT 1`,
      [row.candidate_id as string],
    );
    return res.json({
      success: true,
      data: {
        id: row.id,
        declaredAddress: row.declared_address,
        candidateName: (cands[0] as RowDataPacket)?.full_name ?? null,
        candidateCode: (cands[0] as RowDataPacket)?.candidate_code ?? null,
        expiresAt: row.expires_at,
        attemptNumber: row.attempt_number,
        maxAttempts: MAX_ATTEMPTS,
      },
    });
  }),
);

// ── Public: submit selfie + GPS (no auth) ─────────────────────────────────────
router.post(
  "/public/:token/submit",
  upload.single("selfie"),
  h(async (req: Request, res: Response) => {
    const { token } = req.params;
    const { latitude, longitude, accuracy } = req.body as {
      latitude?: string;
      longitude?: string;
      accuracy?: string;
    };

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, candidate_id, status, expires_at, ref_latitude, ref_longitude, attempt_number
         FROM candidate_bgv_address_verification WHERE token = ? LIMIT 1`,
      [token],
    );
    const row = rows[0];
    if (!row)
      return res
        .status(404)
        .json({ success: false, message: "Link not found." });
    if (new Date(row.expires_at as string) < new Date()) {
      return res
        .status(410)
        .json({ success: false, message: "Link has expired." });
    }
    if (row.status !== "pending") {
      return res
        .status(409)
        .json({ success: false, message: "Already submitted." });
    }
    if (!req.file)
      return res
        .status(400)
        .json({ success: false, message: "Selfie photo is required." });

    const selfiePath = `bgv-selfies/${req.file.filename}`;
    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)
        ?.split(",")[0]
        ?.trim() ??
      req.socket.remoteAddress ??
      null;
    const device = (req.headers["user-agent"] ?? "").slice(0, 500);

    const lat = latitude ? parseFloat(latitude) : null;
    const lng = longitude ? parseFloat(longitude) : null;
    const acc = accuracy ? parseFloat(accuracy) : null;

    let distanceM: number | null = null;
    let autoVerified = false;
    let newStatus: "submitted" | "verified" = "submitted";

    if (
      lat !== null &&
      lng !== null &&
      row.ref_latitude !== null &&
      row.ref_longitude !== null
    ) {
      distanceM =
        Math.round(
          haversineMetres(
            Number(row.ref_latitude),
            Number(row.ref_longitude),
            lat,
            lng,
          ) * 100,
        ) / 100;
      if (distanceM <= GPS_PASS_THRESHOLD_M) {
        autoVerified = true;
        newStatus = "verified";
      }
    }

    // Second independent signal: what DigiLocker/Aadhaar holds for this candidate. A selfie close to the
    // pincode centre plus an agreeing government address is verified; anything else is queued for HR with
    // the reasons attached (see address-verification-assessment.ts). Never fails the submission.
    let assessment: AddressAssessment | null = null;
    try {
      assessment = await assessForCandidate(row.candidate_id as string, distanceM, acc);
      if (assessment.tier === "verified" && !autoVerified) {
        autoVerified = true;
        newStatus = "verified";
      }
    } catch (err) {
      console.error("[address-bgv] assessment failed:", err instanceof Error ? err.message : err);
    }

    await db.execute(
      `UPDATE candidate_bgv_address_verification
          SET submitted_at = NOW(),
              selfie_path = ?,
              gps_latitude = ?,
              gps_longitude = ?,
              gps_accuracy_m = ?,
              gps_distance_m = ?,
              ip_address = ?,
              device_info = ?,
              status = ?,
              auto_verified = ?,
              hr_notes = ?
        WHERE token = ?`,
      [
        selfiePath,
        lat,
        lng,
        acc,
        distanceM,
        ip,
        device,
        newStatus,
        autoVerified ? 1 : 0,
        assessment ? `[auto] ${summarise(assessment)}`.slice(0, 1000) : null,
        token,
      ],
    );

    const candidateId = row.candidate_id as string;
    if (autoVerified) {
      void syncAddressBgvCheck(
        candidateId,
        "verified",
        assessment && distanceM !== null && distanceM > GPS_PASS_THRESHOLD_M
          ? `Auto-verified: ${assessment.reasons.join("; ")}`
          : undefined,
      ).catch(() => {});
    } else {
      const [allRows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status IN ('failed','expired') THEN 1 ELSE 0 END) AS failed_cnt
           FROM candidate_bgv_address_verification WHERE candidate_id = ?`,
        [candidateId],
      );
      const totalAtt = Number((allRows[0] as RowDataPacket).total);
      const failedCnt = Number((allRows[0] as RowDataPacket).failed_cnt);
      if (totalAtt >= MAX_ATTEMPTS && failedCnt >= MAX_ATTEMPTS) {
        void syncAddressBgvCheck(candidateId, "failed").catch(() => {});
      }
    }

    const message = autoVerified
      ? "Address verified! Your location matched the declared address."
      : lat !== null && distanceM !== null && assessment
        ? // The reference point is a pincode centre, so the raw metres are not a distance from the home.
          `Submitted for HR review. ${assessment.reasons[0]}.`
        : "Submitted for HR review.";

    return res.json({ success: true, autoVerified, message });
  }),
);

// ── HR: get all verifications for a candidate ─────────────────────────────────
router.get(
  "/result/:candidateId",
  requireAuth,
  requireRole(
    "admin",
    "hr",
    "hr_admin",
    "ho_hr",
    "branch_hr",
    "process_hr",
    "recruitment_hr",
    "payroll_head",
    "payroll_hr",
  ),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { candidateId } = req.params;
    if (!(await canAccessCandidate(req.authUser!.id, candidateId))) return res.status(403).json(OUT_OF_SCOPE);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT v.*, e.full_name AS decided_by_name
         FROM candidate_bgv_address_verification v
         LEFT JOIN employees e ON e.id = v.hr_decided_by
        WHERE v.candidate_id = ?
        ORDER BY v.created_at DESC`,
      [candidateId],
    );
    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM candidate_bgv_address_verification WHERE candidate_id = ?`,
      [candidateId],
    );
    const totalAttempts = Number((countRows[0] as RowDataPacket).cnt);
    const withAssessment = await Promise.all(
      rows.map(async (r) => {
        if (r.status !== "submitted" && r.status !== "verified") return r;
        const a = await assessForCandidate(
          candidateId,
          r.gps_distance_m === null || r.gps_distance_m === undefined ? null : Number(r.gps_distance_m),
          r.gps_accuracy_m === null || r.gps_accuracy_m === undefined ? null : Number(r.gps_accuracy_m),
        ).catch(() => null);
        return { ...r, assessment: a };
      }),
    );
    return res.json({
      success: true,
      data: withAssessment,
      meta: {
        totalAttempts,
        maxAttempts: MAX_ATTEMPTS,
        attemptsLeft: Math.max(0, MAX_ATTEMPTS - totalAttempts),
      },
    });
  }),
);

// ── HR: decide pass / fail / review ──────────────────────────────────────────
router.patch(
  "/decide/:id",
  requireAuth,
  requireRole(
    "admin",
    "hr",
    "hr_admin",
    "ho_hr",
    "branch_hr",
    "process_hr",
    "recruitment_hr",
    "payroll_head",
    "payroll_hr",
  ),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { decision, notes } = req.body as {
      decision: "pass" | "fail" | "review";
      notes?: string;
    };
    if (!["pass", "fail", "review"].includes(decision)) {
      return res
        .status(400)
        .json({
          success: false,
          message: "decision must be pass, fail, or review",
        });
    }

    const [verRows] = await db.execute<RowDataPacket[]>(
      `SELECT candidate_id, status FROM candidate_bgv_address_verification WHERE id = ? LIMIT 1`,
      [id],
    );
    if (!verRows[0])
      return res.status(404).json({ success: false, message: "Not found" });
    const candidateId = verRows[0].candidate_id as string;
    if (!(await canAccessCandidate(req.authUser!.id, candidateId))) return res.status(403).json(OUT_OF_SCOPE);

    const newStatus =
      decision === "pass"
        ? "verified"
        : decision === "fail"
          ? "failed"
          : "submitted";

    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM employees WHERE user_id = ? LIMIT 1`,
      [req.authUser?.id],
    );
    const empId = empRows[0]?.id ?? null;

    await db.execute(
      `UPDATE candidate_bgv_address_verification
          SET hr_decision = ?, hr_notes = ?, hr_decided_by = ?, hr_decided_at = NOW(), status = ?
        WHERE id = ?`,
      [decision, notes ?? null, empId, newStatus, id],
    );

    if (decision === "pass") {
      void syncAddressBgvCheck(candidateId, "verified").catch(() => {});
    } else if (decision === "fail") {
      const [allRows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status IN ('failed','expired') THEN 1 ELSE 0 END) AS failed_cnt
           FROM candidate_bgv_address_verification WHERE candidate_id = ?`,
        [candidateId],
      );
      const totalAtt = Number((allRows[0] as RowDataPacket).total);
      const failedCnt = Number((allRows[0] as RowDataPacket).failed_cnt) + 1;
      if (failedCnt >= MAX_ATTEMPTS || totalAtt >= MAX_ATTEMPTS) {
        void syncAddressBgvCheck(candidateId, "failed").catch(() => {});
      }
    }

    return res.json({ success: true });
  }),
);

// ── Admin: re-assess queued submissions with the two-signal rule ────────────────────────────
// Dry-run by default. apply=true marks 'verified' only those whose assessment is now verified (exact GPS,
// or same area plus an agreeing DigiLocker address); everything else is left for HR untouched.
router.post(
  "/reassess",
  requireAuth,
  requireRole("admin", "hr_admin", "ho_hr", "payroll_head"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const apply = (req.body as { apply?: boolean } | undefined)?.apply === true;
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, candidate_id, gps_distance_m, gps_accuracy_m
         FROM candidate_bgv_address_verification
        WHERE status = 'submitted' AND hr_decision IS NULL
        ORDER BY submitted_at DESC LIMIT 500`,
    );
    const tally = { verified: 0, needs_hr: 0, conflict: 0 };
    const verifiedIds: string[] = [];
    for (const r of rows) {
      if (!(await canAccessCandidate(req.authUser!.id, String(r.candidate_id)))) continue;
      const a = await assessForCandidate(
        String(r.candidate_id),
        r.gps_distance_m === null ? null : Number(r.gps_distance_m),
        r.gps_accuracy_m === null ? null : Number(r.gps_accuracy_m),
      );
      tally[a.tier]++;
      if (a.tier !== "verified") continue;
      verifiedIds.push(String(r.candidate_id));
      if (apply) {
        await db.execute(
          `UPDATE candidate_bgv_address_verification
              SET status = 'verified', auto_verified = 1, hr_notes = ?
            WHERE id = ? AND status = 'submitted' AND hr_decision IS NULL`,
          [`[auto] ${summarise(a)}`.slice(0, 1000), r.id],
        );
        await syncAddressBgvCheck(String(r.candidate_id), "verified", `Auto-verified: ${a.reasons.join("; ")}`);
      }
    }
    return res.json({ success: true, applied: apply, examined: rows.length, tally, verifiedCandidateIds: verifiedIds });
  }),
);

export default router;
