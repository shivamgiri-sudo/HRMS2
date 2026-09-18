import { Router, type Request, type Response, type NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs";
import https from "https";
import multer from "multer";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

const MAX_ATTEMPTS = 3;
const GPS_PASS_THRESHOLD_M = 10;
const EXPIRY_HOURS = 72;

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

function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    const q = encodeURIComponent(address + ", India");
    const options = {
      hostname: "nominatim.openstreetmap.org",
      path: `/search?q=${q}&format=json&limit=1&countrycodes=IN`,
      headers: { "User-Agent": "MASCallnet-HRMS/1.0" },
      timeout: 5000,
    };
    const req = https.get(options, (res) => {
      let data = "";
      res.on("data", (chunk: string) => { data += chunk; });
      res.on("end", () => {
        try {
          const arr = JSON.parse(data) as Array<{ lat: string; lon: string }>;
          if (arr.length) resolve({ lat: parseFloat(arr[0].lat), lng: parseFloat(arr[0].lon) });
          else resolve(null);
        } catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

function buildDeclaredAddress(profile: RowDataPacket | null): string {
  if (!profile) return "";
  const present = [
    profile.present_address_line1,
    profile.present_address_line2,
    profile.present_address,
    profile.present_city,
    profile.present_state,
    profile.present_pincode,
  ].map((v) => (v ? String(v).trim() : "")).filter(Boolean);
  if (present.length) return present.join(", ");
  return [
    profile.permanent_address_line1,
    profile.permanent_address_line2,
    profile.permanent_address,
    profile.permanent_city,
    profile.permanent_state,
    profile.permanent_pincode,
  ].map((v) => (v ? String(v).trim() : "")).filter(Boolean).join(", ");
}

async function syncAddressBgvCheck(candidateId: string, status: "verified" | "failed" | "not_run") {
  const now = status === "verified" ? new Date() : null;
  const summary =
    status === "verified" ? "Address verified via geo-tagged selfie" :
    status === "failed"   ? "Address verification failed after max attempts" : null;
  await db.execute(
    `INSERT INTO candidate_bgv_check (candidate_id, check_type, status, verified_at, result_summary, updated_at)
       VALUES (?, 'address', ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE status = VALUES(status), verified_at = VALUES(verified_at),
         result_summary = VALUES(result_summary), updated_at = NOW()`,
    [candidateId, status, now, summary]
  );
}

// ── HR: initiate ──────────────────────────────────────────────────────────────
router.post(
  "/initiate",
  requireAuth,
  requireRole("admin", "hr", "hr_admin", "ho_hr", "branch_hr", "process_hr", "recruitment_hr"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { candidateId, forceUnblock } = req.body as { candidateId?: string; forceUnblock?: boolean };
    if (!candidateId) return res.status(400).json({ success: false, message: "candidateId required" });

    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM candidate_bgv_address_verification WHERE candidate_id = ?`,
      [candidateId]
    );
    const attemptCount = Number((countRows[0] as RowDataPacket).cnt);

    if (attemptCount >= MAX_ATTEMPTS && !forceUnblock) {
      return res.status(422).json({
        success: false,
        message: `Max ${MAX_ATTEMPTS} attempts reached. Use forceUnblock=true (HR override) to allow another attempt.`,
        maxReached: true,
      });
    }

    const [profiles] = await db.execute<RowDataPacket[]>(
      `SELECT present_address_line1, present_address_line2, present_address,
              present_city, present_state, present_pincode,
              permanent_address_line1, permanent_address_line2, permanent_address,
              permanent_city, permanent_state, permanent_pincode
         FROM candidate_onboarding_profile WHERE candidate_id = ? LIMIT 1`,
      [candidateId]
    );
    const declaredAddress = buildDeclaredAddress(profiles[0] ?? null);
    if (!declaredAddress) {
      return res.status(422).json({
        success: false,
        message: "No address on record. Ask the candidate to complete their onboarding profile first.",
      });
    }

    const geo = await geocodeAddress(declaredAddress).catch(() => null);

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + EXPIRY_HOURS * 3600 * 1000);
    const nextAttempt = attemptCount + 1;

    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM employees WHERE user_id = ? LIMIT 1`,
      [req.authUser?.id]
    );
    const unblockerId = forceUnblock ? (empRows[0]?.id ?? null) : null;

    await db.execute(
      `INSERT INTO candidate_bgv_address_verification
         (candidate_id, token, declared_address, ref_latitude, ref_longitude,
          attempt_number, sent_via, expires_at, unblocked_by)
       VALUES (?, ?, ?, ?, ?, ?, 'link', ?, ?)`,
      [candidateId, token, declaredAddress, geo?.lat ?? null, geo?.lng ?? null, nextAttempt, expiresAt, unblockerId]
    );

    const appUrl = process.env.APP_URL ?? "";
    const link = `${appUrl}/bgv-address-verify/${token}`;
    return res.json({
      success: true,
      data: { token, link, expiresAt, declaredAddress, attemptNumber: nextAttempt, geoResolved: geo !== null },
    });
  })
);

// ── Public: fetch info by token (no auth) ─────────────────────────────────────
router.get("/public/:token", h(async (req: Request, res: Response) => {
  const { token } = req.params;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, candidate_id, declared_address, expires_at, status, attempt_number
       FROM candidate_bgv_address_verification WHERE token = ? LIMIT 1`,
    [token]
  );
  const row = rows[0];
  if (!row) return res.status(404).json({ success: false, message: "Link not found or already used." });
  if (new Date(row.expires_at as string) < new Date()) {
    await db.execute(
      `UPDATE candidate_bgv_address_verification SET status='expired' WHERE token=? AND status='pending'`,
      [token]
    );
    return res.status(410).json({ success: false, message: "This link has expired. Please contact HR for a new one." });
  }
  if (row.status !== "pending") {
    return res.status(409).json({
      success: false,
      message: row.status === "submitted"
        ? "This verification has already been submitted."
        : "This link is no longer active.",
    });
  }
  const [cands] = await db.execute<RowDataPacket[]>(
    `SELECT full_name, candidate_code FROM ats_candidate WHERE id = ? LIMIT 1`,
    [row.candidate_id as string]
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
}));

// ── Public: submit selfie + GPS (no auth) ─────────────────────────────────────
router.post(
  "/public/:token/submit",
  upload.single("selfie"),
  h(async (req: Request, res: Response) => {
    const { token } = req.params;
    const { latitude, longitude, accuracy } = req.body as {
      latitude?: string; longitude?: string; accuracy?: string;
    };

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, candidate_id, status, expires_at, ref_latitude, ref_longitude, attempt_number
         FROM candidate_bgv_address_verification WHERE token = ? LIMIT 1`,
      [token]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ success: false, message: "Link not found." });
    if (new Date(row.expires_at as string) < new Date()) {
      return res.status(410).json({ success: false, message: "Link has expired." });
    }
    if (row.status !== "pending") {
      return res.status(409).json({ success: false, message: "Already submitted." });
    }
    if (!req.file) return res.status(400).json({ success: false, message: "Selfie photo is required." });

    const selfiePath = `bgv-selfies/${req.file.filename}`;
    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? null;
    const device = (req.headers["user-agent"] ?? "").slice(0, 500);

    const lat = latitude ? parseFloat(latitude) : null;
    const lng = longitude ? parseFloat(longitude) : null;
    const acc = accuracy ? parseFloat(accuracy) : null;

    let distanceM: number | null = null;
    let autoVerified = false;
    let newStatus: "submitted" | "verified" = "submitted";

    if (lat !== null && lng !== null && row.ref_latitude !== null && row.ref_longitude !== null) {
      distanceM = Math.round(haversineMetres(
        Number(row.ref_latitude), Number(row.ref_longitude), lat, lng
      ) * 100) / 100;
      if (distanceM <= GPS_PASS_THRESHOLD_M) {
        autoVerified = true;
        newStatus = "verified";
      }
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
              auto_verified = ?
        WHERE token = ?`,
      [selfiePath, lat, lng, acc, distanceM, ip, device, newStatus, autoVerified ? 1 : 0, token]
    );

    const candidateId = row.candidate_id as string;
    if (autoVerified) {
      void syncAddressBgvCheck(candidateId, "verified").catch(() => {});
    } else {
      const [allRows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status IN ('failed','expired') THEN 1 ELSE 0 END) AS failed_cnt
           FROM candidate_bgv_address_verification WHERE candidate_id = ?`,
        [candidateId]
      );
      const totalAtt = Number((allRows[0] as RowDataPacket).total);
      const failedCnt = Number((allRows[0] as RowDataPacket).failed_cnt);
      if (totalAtt >= MAX_ATTEMPTS && failedCnt >= MAX_ATTEMPTS) {
        void syncAddressBgvCheck(candidateId, "failed").catch(() => {});
      }
    }

    const message = autoVerified
      ? "Address verified! Your location matched the declared address."
      : lat !== null && distanceM !== null
        ? `Submitted for HR review. Detected distance: ${distanceM.toFixed(1)} m from your declared address.`
        : "Submitted for HR review.";

    return res.json({ success: true, autoVerified, message });
  })
);

// ── HR: get all verifications for a candidate ─────────────────────────────────
router.get(
  "/result/:candidateId",
  requireAuth,
  requireRole("admin", "hr", "hr_admin", "ho_hr", "branch_hr", "process_hr", "recruitment_hr"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { candidateId } = req.params;
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT v.*, e.full_name AS decided_by_name
         FROM candidate_bgv_address_verification v
         LEFT JOIN employees e ON e.id = v.hr_decided_by
        WHERE v.candidate_id = ?
        ORDER BY v.created_at DESC`,
      [candidateId]
    );
    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM candidate_bgv_address_verification WHERE candidate_id = ?`,
      [candidateId]
    );
    const totalAttempts = Number((countRows[0] as RowDataPacket).cnt);
    return res.json({
      success: true,
      data: rows,
      meta: { totalAttempts, maxAttempts: MAX_ATTEMPTS, attemptsLeft: Math.max(0, MAX_ATTEMPTS - totalAttempts) },
    });
  })
);

// ── HR: decide pass / fail / review ──────────────────────────────────────────
router.patch(
  "/decide/:id",
  requireAuth,
  requireRole("admin", "hr", "hr_admin", "ho_hr", "branch_hr", "process_hr", "recruitment_hr"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { decision, notes } = req.body as { decision: "pass" | "fail" | "review"; notes?: string };
    if (!["pass", "fail", "review"].includes(decision)) {
      return res.status(400).json({ success: false, message: "decision must be pass, fail, or review" });
    }

    const [verRows] = await db.execute<RowDataPacket[]>(
      `SELECT candidate_id, status FROM candidate_bgv_address_verification WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!verRows[0]) return res.status(404).json({ success: false, message: "Not found" });
    const candidateId = verRows[0].candidate_id as string;

    const newStatus = decision === "pass" ? "verified" : decision === "fail" ? "failed" : "submitted";

    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM employees WHERE user_id = ? LIMIT 1`,
      [req.authUser?.id]
    );
    const empId = empRows[0]?.id ?? null;

    await db.execute(
      `UPDATE candidate_bgv_address_verification
          SET hr_decision = ?, hr_notes = ?, hr_decided_by = ?, hr_decided_at = NOW(), status = ?
        WHERE id = ?`,
      [decision, notes ?? null, empId, newStatus, id]
    );

    if (decision === "pass") {
      void syncAddressBgvCheck(candidateId, "verified").catch(() => {});
    } else if (decision === "fail") {
      const [allRows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status IN ('failed','expired') THEN 1 ELSE 0 END) AS failed_cnt
           FROM candidate_bgv_address_verification WHERE candidate_id = ?`,
        [candidateId]
      );
      const totalAtt = Number((allRows[0] as RowDataPacket).total);
      const failedCnt = Number((allRows[0] as RowDataPacket).failed_cnt) + 1;
      if (failedCnt >= MAX_ATTEMPTS || totalAtt >= MAX_ATTEMPTS) {
        void syncAddressBgvCheck(candidateId, "failed").catch(() => {});
      }
    }

    return res.json({ success: true });
  })
);

export default router;
