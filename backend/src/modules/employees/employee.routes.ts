import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireScopedRole } from "../../middleware/scopeMiddleware.js";
import { buildScopeWhereClause, hasScopedAccess } from "../../shared/scopeAccess.js";
import { db } from "../../db/mysql.js";
import { mobilityService } from "../mobility/mobility.service.js";
import { employeeController as c } from "./employee.controller.js";
import { employeeService } from "./employee.service.js";
import { employeeFiltersSchema } from "./employee.validation.js";
import { appendJourneyEvent, listJourneyEvents, listComprehensiveJourney } from "./journeyLog.service.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { profileApprovalService, submitStatutoryDetailsForApproval } from "./profile-approval.service.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { isOfficialEmail } from "../../shared/officialEmail.js";
import { bootstrapCandidateForEmployee } from "./employee-bgv-bootstrap.service.js";
import { encryptField, decryptField } from "../../shared/fieldEncryption.js";
import { encryptPanForSync, blindIndexPan } from "../../shared/syncPiiEncryption.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

// PERFORMANCE: Simple in-memory cache for hr-hub queries (30-second TTL)
interface CacheEntry { data: any; timestamp: number; }
const hrHubCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000; // 30 seconds

function getCached(key: string): any | null {
  const entry = hrHubCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    hrHubCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: any): void {
  hrHubCache.set(key, { data, timestamp: Date.now() });
  // Auto-cleanup: remove entries older than 5 minutes
  if (hrHubCache.size > 100) {
    const cutoff = Date.now() - 300_000;
    for (const [k, v] of hrHubCache.entries()) {
      if (v.timestamp < cutoff) hrHubCache.delete(k);
    }
  }
}

/**
 * Drop every cached hr-hub page.
 *
 * The cache key embeds the caller's user id and the full query string, so a write
 * that changes one employee's attendance cannot be targeted precisely — the
 * affected employee may appear in any number of filter combinations cached for
 * any number of users. Clearing the whole map is the only correct option, and it
 * is cheap: this is a <=100-entry, 30-second performance cache, not a store.
 *
 * Called after a discard rewrites attendance, otherwise the Attendance Hub keeps
 * serving pre-discard present_days / lwp_days for up to 30s even on a forced
 * refetch.
 */
export function invalidateHrHubCache(): void {
  hrHubCache.clear();
}

router.use(requireAuth);

// GET /api/employees/me — returns the employee record for the logged-in user with nested details
router.get("/me", h(async (req: any, res: any) => {
  const userId = req.authUser?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  const [rows] = await db.execute(
    `SELECT
       e.id, e.employee_code, e.user_id,
       e.first_name, e.last_name,
       e.email, e.official_email,
       e.mobile, e.personal_email, e.personal_phone, e.alternate_mobile,
       e.avatar_url, e.photo_url,
       e.gender, e.date_of_birth, e.marital_status, e.blood_group,
       e.address_line1 AS address, e.address_line1, e.city, e.state, e.country, e.pincode,
       e.employment_status AS status, e.employment_status, e.employment_type,
       e.designation_id, e.department_id, e.branch_id, e.process_id,
       e.reporting_manager_id, e.manager_id,
       e.date_of_joining, e.date_of_joining AS hire_date, e.salary_start_date,
       e.working_hours_start, e.working_hours_end, e.working_days,
       EXISTS(
         SELECT 1 FROM employees direct_report
         WHERE direct_report.reporting_manager_id = e.id
           AND direct_report.active_status = 1
       ) AS is_manager,
       e.pan_verified_on, e.aadhaar_verified_on,
       e.pan_number, e.uan_number, e.epf_number, e.esic_number,
       e.aadhaar_number, e.aadhaar_last4,
       d.designation_name  AS designation,
       dept.dept_name      AS department_name,
       p.process_name,
       b.branch_name,
       b.branch_name       AS branch_display_name,
       CONCAT(mgr.first_name, ' ', COALESCE(mgr.last_name, '')) AS reporting_manager_name
     FROM employees e
     LEFT JOIN designation_master d    ON d.id    = e.designation_id
     LEFT JOIN department_master  dept ON dept.id = e.department_id
     LEFT JOIN process_master     p    ON p.id    = e.process_id
     LEFT JOIN branch_master      b    ON b.id    = e.branch_id
     LEFT JOIN employees          mgr  ON mgr.id  = e.reporting_manager_id
     WHERE e.user_id = ? AND e.active_status = 1
     LIMIT 1`,
    [userId]
  ) as any[];
  if (!rows.length) return res.status(404).json({ success: false, error: "No employee record for this user" });

  const emp = rows[0];
  const empId = emp.id;

  const [bankRows, statRows, emergRows, nomineeRows] = await Promise.all([
    // Bank details — read both columns; account_number_enc preferred over legacy plaintext
    db.execute(
      "SELECT bank_name, account_holder_name, bank_branch, ifsc_code, account_type, account_number, account_number_enc, verified FROM employee_bank_detail WHERE employee_id = ? AND active_status = 1 LIMIT 1",
      [empId]
    ).then(([r]: any) => r).catch(() => []),

    // Statutory details
    db.execute(
      "SELECT epf_number, esi_number, uan_number, pan_number, aadhaar_id, pf_eligible, esi_eligible, epf_date FROM employee_statutory_info WHERE employee_id = ? LIMIT 1",
      [empId]
    ).then(([r]: any) => r).catch(() => []),

    // Emergency contact — prefer is_primary=1, fall back to first row
    db.execute(
      "SELECT name, relationship, mobile, address FROM employee_emergency_contact WHERE employee_id = ? ORDER BY is_primary DESC, contact_seq ASC LIMIT 1",
      [empId]
    ).then(([r]: any) => r).catch(() => []),

    // Nominee (primary / first)
    db.execute(
      "SELECT nominee_name, relationship, date_of_birth, mobile, address FROM employee_nominee WHERE employee_id = ? ORDER BY created_at ASC LIMIT 1",
      [empId]
    ).then(([r]: any) => r).catch(() => []),
  ]);

  // Build masked statutory — primary source is employees row (pan_number, uan_number,
  // epf_number, esic_number, aadhaar_number/aadhaar_last4 columns); employee_statutory_info
  // supplements with pf_eligible, esi_eligible, epf_date when a row exists.
  const si = statRows[0] ?? null;
  const maskPan    = (v: string | null | undefined) => v && v.trim() ? v.slice(0, 5) + "***" + v.slice(-1) : null;
  const maskLast4  = (v: string | null | undefined) => v && v.trim() ? "****" + v.slice(-4) : null;
  const maskEpf    = (v: string | null | undefined) => v && v.trim() ? v.slice(0, 2) + "/****/****" : null;

  // Resolve each field: employees table takes priority, fall back to employee_statutory_info
  const pan_number    = (emp.pan_number    && String(emp.pan_number).trim())    || (si?.pan_number    && String(si.pan_number).trim())    || null;
  const uan_number    = (emp.uan_number    && String(emp.uan_number).trim())    || (si?.uan_number    && String(si.uan_number).trim())    || null;
  const epf_number    = (emp.epf_number    && String(emp.epf_number).trim())    || (si?.epf_number    && String(si.epf_number).trim())    || null;
  const esic_number   = (emp.esic_number   && String(emp.esic_number).trim())   || (si?.esi_number    && String(si.esi_number).trim())    || null;
  // aadhaar: employees stores full number or last4 separately
  const aadhaar_full  = (emp.aadhaar_number && String(emp.aadhaar_number).trim()) || (si?.aadhaar_id  && String(si.aadhaar_id).trim())    || null;
  const aadhaar_last4 = (emp.aadhaar_last4  && String(emp.aadhaar_last4).trim()) || null;
  // For masking: prefer full number (mask last4), fall back to last4 digits already stored
  const aadhaar_for_mask = aadhaar_full || (aadhaar_last4 ? "XXXXXXXXXXXX".slice(0, -4) + aadhaar_last4 : null);

  const pan_verified   = emp.pan_verified_on   ? "verified" : (pan_number    ? "pending" : "not_provided");
  const aadhaar_verified = emp.aadhaar_verified_on ? "verified" : (aadhaar_for_mask ? "pending" : "not_provided");
  const pf_uan_verified  = uan_number ? "pending" : "not_provided";

  const statutory_details: Record<string, any> = {
    masked_pan_number:      maskPan(pan_number),
    masked_aadhaar_number:  maskLast4(aadhaar_for_mask),
    masked_pf_number:       maskEpf(epf_number),
    masked_uan:             maskLast4(uan_number),
    esi_number:             esic_number ? "****" + esic_number.slice(-4) : null,
    pf_eligible:            si?.pf_eligible ?? (epf_number ? 1 : 0),
    esi_eligible:           si?.esi_eligible ?? (esic_number ? 1 : 0),
    epf_date:               si?.epf_date ?? null,
    pan_verification_status:     pan_verified,
    aadhaar_verification_status: aadhaar_verified,
    pf_uan_verification_status:  pf_uan_verified,
  };

  return res.json({
    success: true,
    data: {
      // Identity
      id:                       emp.id,
      employee_code:            emp.employee_code,
      user_id:                  emp.user_id,
      // Name
      first_name:               emp.first_name,
      last_name:                emp.last_name,
      full_name:                [emp.first_name, emp.last_name].filter(Boolean).join(" "),
      // Contact
      email:                    emp.email,
      official_email:           emp.official_email,
      official_email_compliant: isOfficialEmail(emp.official_email ?? emp.email),
      mobile:                   emp.mobile,
      personal_email:           emp.personal_email,
      personal_phone:           emp.personal_phone,
      personal_mobile:          emp.personal_phone,
      alternate_mobile:         emp.alternate_mobile,
      // Avatar
      avatar_url:               emp.avatar_url,
      photo_url:                emp.photo_url,
      // Personal details
      gender:                   emp.gender,
      date_of_birth:            emp.date_of_birth,
      marital_status:           emp.marital_status,
      blood_group:              emp.blood_group,
      // Address
      address:                  emp.address,
      address_line1:            emp.address_line1,
      city:                     emp.city,
      state:                    emp.state,
      country:                  emp.country,
      pincode:                  emp.pincode,
      // Employment
      status:                   emp.status,
      employment_status:        emp.employment_status,
      employment_type:          emp.employment_type,
      designation:              emp.designation,
      designation_id:           emp.designation_id,
      department_name:          emp.department_name,
      department_id:            emp.department_id,
      branch_name:              emp.branch_name,
      branch_display_name:      emp.branch_display_name,
      branch_id:                emp.branch_id,
      process_name:             emp.process_name ?? null,
      process_id:               emp.process_id,
      reporting_manager_name:   emp.reporting_manager_name,
      reporting_manager_id:     emp.reporting_manager_id,
      manager_id:               emp.manager_id,
      date_of_joining:          emp.date_of_joining,
      hire_date:                emp.hire_date,
      salary_start_date:        emp.salary_start_date,
      // Schedule
      working_hours_start:      emp.working_hours_start,
      working_hours_end:        emp.working_hours_end,
      working_days:             emp.working_days,
      // Flags
      is_manager:               emp.is_manager,
      // Presence-only flag (boolean, never the raw value)
      bank_account_number:      bankRows.length ? true : null,
      emergency_contact_name:   emergRows[0]?.name ?? null,
      // Nested shapes expected by frontend
      department: emp.department_name ? { name: emp.department_name } : null,
      bank_details: (() => {
        if (!bankRows.length) return null;
        const b = bankRows[0];
        // Prefer decrypted account_number_enc; fall back to legacy plaintext varbinary
        let rawAcct: string | null = null;
        if (b.account_number_enc) {
          try { rawAcct = decryptField(b.account_number_enc); } catch { rawAcct = null; }
        }
        if (!rawAcct && b.account_number) {
          rawAcct = Buffer.isBuffer(b.account_number)
            ? b.account_number.toString("utf8")
            : String(b.account_number);
        }
        return {
          bank_name: b.bank_name,
          account_holder_name: b.account_holder_name ?? null,
          bank_branch: b.bank_branch ?? null,
          ifsc_code: b.ifsc_code,
          account_type: b.account_type,
          masked_account_number: rawAcct ? "****" + rawAcct.slice(-4) : null,
          verified: !!b.verified,
          verification_status: b.verified ? "verified" : "pending",
        };
      })(),
      statutory_details,
      emergency_contact: emergRows.length ? emergRows[0] : null,
      nominee: nomineeRows.length ? {
        nominee_name: nomineeRows[0].nominee_name,
        relationship: nomineeRows[0].relationship,
        date_of_birth: nomineeRows[0].date_of_birth,
        mobile: nomineeRows[0].mobile,
        address: nomineeRows[0].address,
      } : null,
    }
  });
}));

// PATCH /api/employees/me — self-service update of non-sensitive personal fields
router.patch("/me", h(async (req: any, res: any) => {
  const userId = req.authUser?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  const [rows] = await db.execute(
    "SELECT id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1",
    [userId]
  ) as any[];
  if (!rows.length) return res.status(404).json({ success: false, error: "No employee record for this user" });
  const empId = rows[0].id;

  // official_email is the canonical login identity — HR-only, never self-service.
  // address→address_line1, no "address" or "country" column in prod schema.
  const ALLOWED_FIELDS = [
    "mobile", "personal_email", "personal_phone", "alternate_mobile",
    "address_line1", "address_line2", "city", "state", "pincode",
    "date_of_birth", "gender", "marital_status",
    "blood_group", "working_hours_start", "working_hours_end", "working_days"
  ];

  // Reject any attempt to update official_email through self-service.
  if (req.body.official_email !== undefined) {
    return res.status(403).json({ success: false, error: "official_email cannot be changed through self-service. Contact HR." });
  }

  const updates: string[] = [];
  const values: any[] = [];
  for (const field of ALLOWED_FIELDS) {
    if (req.body[field] !== undefined) {
      updates.push(`\`${field}\` = ?`);
      values.push(req.body[field]);
    }
  }

  if (!updates.length) return res.status(400).json({ success: false, error: "No updatable fields provided" });

  values.push(empId);
  await db.execute(`UPDATE employees SET ${updates.join(", ")} WHERE id = ?`, values);

  return res.json({ success: true, message: "Profile updated" });
}));

// GET /api/employees/me/journey — journey events for the logged-in user
router.get("/me/journey", h(async (req: any, res: any) => {
  const userId = req.authUser?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  const [rows] = await db.execute(
    "SELECT id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1",
    [userId]
  ) as any[];
  if (!rows.length) return res.status(404).json({ success: false, error: "No employee record for this user" });
  const empId = rows[0].id;

  const data = await listComprehensiveJourney(empId, {
    filters: {
      module:    req.query.module    as string | undefined,
      eventType: req.query.eventType as string | undefined,
      fromDate:  req.query.fromDate  as string | undefined,
      toDate:    req.query.toDate    as string | undefined,
    },
  });
  return res.json({ success: true, data });
}));

// GET /api/employees/me/promotions and /me/transfers — the caller's own records.
//
// EmployeeJourney renders one personal timeline from three sources: /me/journey
// above, plus these two. They had no route at all, so the page silently rendered
// a timeline missing every promotion and transfer.
//
// Deliberately not served by pointing the page at /api/mobility/{promotions,
// transfers}: those already exist and scope correctly for an ordinary employee,
// but they return every record in the company for admin and hr. On a screen whose
// whole premise is "my journey", an HR user would have seen everyone's history
// mixed into their own. These always scope to the actor, whatever their role.
function meScopedMobility(
  path: "promotions" | "transfers",
  fetch: (employeeId: string) => Promise<unknown[]>,
) {
  router.get(`/me/${path}`, h(async (req: any, res: any) => {
    const userId = req.authUser?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

    const [rows] = await db.execute(
      "SELECT id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1",
      [userId]
    ) as any[];
    if (!rows.length) return res.status(404).json({ success: false, error: "No employee record for this user" });

    const data = await fetch(rows[0].id);
    return res.json({ success: true, data });
  }));
}

meScopedMobility("promotions", (employee_id) => mobilityService.listPromotions({ employee_id }));
meScopedMobility("transfers", (employee_id) => mobilityService.listTransfers({ employee_id }));

// GET /api/employees/me/bank-change-status — check if a pending bank change request exists
router.get("/me/bank-change-status", h(async (req: any, res: any) => {
  const userId = req.authUser?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT pua.requested_at FROM profile_update_approval pua
     JOIN employees e ON e.id = pua.employee_id AND e.user_id = ? AND e.active_status = 1
     WHERE pua.request_type = 'bank_details' AND pua.status = 'pending'
     ORDER BY pua.requested_at DESC LIMIT 1`,
    [userId]
  );
  return res.json({ success: true, pending: rows.length > 0, requested_at: rows[0]?.requested_at ?? null });
}));

// POST /api/employees/me/bank-change-request — submit bank change for Payroll HO approval
router.post("/me/bank-change-request", h(async (req: any, res: any) => {
  const userId = req.authUser?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1",
    [userId]
  );
  if (!rows.length) return res.status(404).json({ success: false, error: "No employee record for this user" });
  const empId = rows[0].id;

  const { bank_name, account_holder_name, bank_branch, ifsc_code, account_type, account_number } = req.body;

  // Fetch existing bank details for old_values record. masked_account_number is not a
  // real column on employee_bank_detail (this query 500'd on every call — confirmed live);
  // compute the mask in JS from the raw account_number instead, matching the pattern
  // already used for reads elsewhere in this file (see GET /me below).
  const [existing] = await db.execute<RowDataPacket[]>(
    "SELECT bank_name, account_holder_name, bank_branch, ifsc_code, account_type, account_number, account_number_enc FROM employee_bank_detail WHERE employee_id = ? AND is_primary = 1 LIMIT 1",
    [empId]
  );
  const existingRow = existing[0];
  const existingForAudit = existingRow
    ? {
        bank_name: existingRow.bank_name,
        account_holder_name: existingRow.account_holder_name,
        bank_branch: existingRow.bank_branch,
        ifsc_code: existingRow.ifsc_code,
        account_type: existingRow.account_type,
        masked_account_number: (() => {
          let str: string | null = null;
          if (existingRow.account_number_enc) {
            try { str = decryptField(existingRow.account_number_enc); } catch { str = null; }
          }
          if (!str && existingRow.account_number) {
            const raw = existingRow.account_number;
            str = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
          }
          return str ? "****" + str.slice(-4) : null;
        })(),
      }
    : {};

  const result = await profileApprovalService.submitBankDetailsForApproval(
    userId,
    empId,
    { bank_name, account_holder_name, bank_branch, ifsc_code, account_type, account_number },
    existingForAudit
  );

  return res.json({ success: true, ...result });
}));

// PUT /api/employees/me/bank-details — REMOVED self-service direct write.
// Bank detail changes must go through the Payroll HO approval workflow via
// POST /me/bank-change-request. Keeping the route as a 410 tombstone so that
// any old client that still calls it gets a clear error rather than a silent 404.
router.put("/me/bank-details", h(async (_req: any, res: any) => {
  return res.status(410).json({
    success: false,
    error: "Direct bank detail updates are no longer permitted. Submit a change request via POST /api/employees/me/bank-change-request for Payroll approval.",
  });
}));

// PUT /api/employees/me/statutory-details — upsert statutory info for logged-in user
router.put("/me/statutory-details", h(async (req: any, res: any) => {
  const userId = req.authUser?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  const [rows] = await db.execute(
    "SELECT id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1",
    [userId]
  ) as any[];
  if (!rows.length) return res.status(404).json({ success: false, error: "No employee record for this user" });
  const empId = rows[0].id;

  const { epf_number, esi_number, uan_number, pan_number, aadhaar_id, pf_eligible, esi_eligible, epf_date } = req.body;

  const newValues: Record<string, unknown> = {};
  if (epf_number   !== undefined) newValues.epf_number   = epf_number;
  if (esi_number   !== undefined) newValues.esi_number   = esi_number;
  if (uan_number   !== undefined) newValues.uan_number   = uan_number;
  if (pan_number   !== undefined) newValues.pan_number   = pan_number;
  if (aadhaar_id   !== undefined) newValues.aadhaar_id   = aadhaar_id;
  if (pf_eligible  !== undefined) newValues.pf_eligible  = pf_eligible;
  if (esi_eligible !== undefined) newValues.esi_eligible = esi_eligible;
  if (epf_date     !== undefined) newValues.epf_date     = epf_date;

  if (!Object.keys(newValues).length) {
    return res.status(400).json({ success: false, error: "No statutory fields provided" });
  }

  const result = await submitStatutoryDetailsForApproval(userId, empId, newValues);
  return res.json({ success: true, message: result.message, approval_id: result.id });
}));

// PUT /api/employees/me/emergency-contact — upsert primary emergency contact for logged-in user
router.put("/me/emergency-contact", h(async (req: any, res: any) => {
  const userId = req.authUser?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  const [rows] = await db.execute(
    "SELECT id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1",
    [userId]
  ) as any[];
  if (!rows.length) return res.status(404).json({ success: false, error: "No employee record for this user" });
  const empId = rows[0].id;

  const { name, relationship, mobile, address } = req.body;
  if (!name || !relationship || !mobile) {
    return res.status(400).json({ success: false, error: "name, relationship, and mobile are required" });
  }

  await db.execute(
    `INSERT INTO employee_emergency_contact (employee_id, contact_seq, is_primary, name, relationship, mobile, address)
     VALUES (?, 1, 1, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), relationship = VALUES(relationship), mobile = VALUES(mobile), address = VALUES(address)`,
    [empId, name, relationship, mobile, address ?? null]
  );
  return res.json({ success: true, message: "Emergency contact saved" });
}));

// PUT /api/employees/me/nominee — upsert nominee for logged-in user (uses employee_nominee table)
router.put("/me/nominee", h(async (req: any, res: any) => {
  const userId = req.authUser?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  const [rows] = await db.execute(
    "SELECT id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1",
    [userId]
  ) as any[];
  if (!rows.length) return res.status(404).json({ success: false, error: "No employee record for this user" });
  const empId = rows[0].id;

  const { nominee_name, relationship, date_of_birth, mobile, address } = req.body;
  if (!nominee_name || !relationship) {
    return res.status(400).json({ success: false, error: "nominee_name and relationship are required" });
  }

  try {
    // Check if nominee already exists for this employee
    const [existingRows] = await db.execute(
      "SELECT id FROM employee_nominee WHERE employee_id = ? ORDER BY created_at ASC LIMIT 1",
      [empId]
    ) as any[];

    if (existingRows.length) {
      await db.execute(
        `UPDATE employee_nominee SET nominee_name = ?, relationship = ?, date_of_birth = ?, mobile = ?, address = ? WHERE id = ?`,
        [nominee_name, relationship, date_of_birth ?? null, mobile ?? null, address ?? null, existingRows[0].id]
      );
    } else {
      await db.execute(
        `INSERT INTO employee_nominee (employee_id, nominee_name, relationship, date_of_birth, mobile, address) VALUES (?, ?, ?, ?, ?, ?)`,
        [empId, nominee_name, relationship, date_of_birth ?? null, mobile ?? null, address ?? null]
      );
    }
  } catch (_e) {
    // Fallback: update nominee columns on employees table if employee_nominee table unavailable
    await db.execute(
      "UPDATE employees SET nominee_name = ?, nominee_relation = ? WHERE id = ?",
      [nominee_name, relationship, empId]
    );
  }
  return res.json({ success: true, message: "Nominee saved" });
}));

// Shared scope resolver for the HR-facing :employeeId profile-completion routes below —
// same shape requireScopedRole already uses on PATCH /:id, extracted so each route doesn't
// re-derive it.
async function resolveEmployeeScope(req: any) {
  const [rows] = await db.execute(
    "SELECT branch_id, process_id, department_id FROM employees WHERE id = ? LIMIT 1",
    [req.params.employeeId]
  ) as any[];
  const emp = rows[0];
  return { branchId: emp?.branch_id, processId: emp?.process_id, departmentId: emp?.department_id };
}
const hrProfileGate = [requireRole("super_admin", "admin", "hr"), requireScopedRole(["hr"], resolveEmployeeScope)];

// PUT /api/employees/:employeeId/bank-details — HR entry for a manually-onboarded employee.
// Same direct-write/pending-verification shape as PUT /me/bank-details (no penny-drop here —
// that's candidate-journey-specific verification infra, out of scope for field parity).
router.put("/:employeeId/bank-details", ...hrProfileGate, h(async (req: any, res: any) => {
  const empId = req.params.employeeId;
  const { bank_name, account_holder_name, bank_branch, ifsc_code, account_type, account_number } = req.body;

  // verification_status and masked_account_number are not real columns on
  // employee_bank_detail (this INSERT 500'd on every call — confirmed live). See the
  // matching fix and comment on PUT /me/bank-details above.
  const fields: string[] = ["employee_id", "bank_name", "account_holder_name", "bank_branch", "ifsc_code", "account_type"];
  const vals: any[] = [empId, bank_name, account_holder_name, bank_branch, ifsc_code, account_type];
  const onDup: string[] = ["bank_name = VALUES(bank_name)", "account_holder_name = VALUES(account_holder_name)", "bank_branch = VALUES(bank_branch)", "ifsc_code = VALUES(ifsc_code)", "account_type = VALUES(account_type)"];

  if (account_number) {
    const enc = encryptField(String(account_number));
    fields.push("account_number_enc");
    vals.push(enc);
    onDup.push("account_number_enc = VALUES(account_number_enc)");
  }

  const placeholders = fields.map(() => "?").join(", ");
  await db.execute(
    `INSERT INTO employee_bank_detail (${fields.join(", ")}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${onDup.join(", ")}`,
    vals
  );

  void logSensitiveAction({
    actor_user_id: req.authUser!.id,
    action_type: "BANK_DETAILS_HR_ENTRY",
    module_key: "employees",
    entity_type: "employee",
    entity_id: empId,
    change_summary: { fields_updated: fields.filter((f) => f !== "employee_id") },
    req,
  });

  return res.json({ success: true, message: "Bank details saved" });
}));

// PUT /api/employees/:employeeId/statutory-details — HR entry, mirrors PUT /me/statutory-details
router.put("/:employeeId/statutory-details", ...hrProfileGate, h(async (req: any, res: any) => {
  const empId = req.params.employeeId;
  const { epf_number, esi_number, uan_number, pan_number, aadhaar_id, pf_eligible, esi_eligible, epf_date,
          previous_pf_member, eps_member, international_worker, declaration_accepted } = req.body;

  const STAT_FIELDS: string[] = ["employee_id"];
  const statVals: any[] = [empId];
  const statOnDup: string[] = [];

  const addStat = (col: string, val: any) => {
    if (val !== undefined) {
      STAT_FIELDS.push(col);
      statVals.push(val);
      statOnDup.push(`${col} = VALUES(${col})`);
    }
  };
  addStat("epf_number", epf_number);
  addStat("esi_number", esi_number);
  addStat("uan_number", uan_number);
  addStat("pan_number", pan_number);
  // employee_statutory_info.pan_number held 3,341 plaintext PANs against 0 ciphertext
  // (measured live 2026-08-11): migration 1123 added pan_number_encrypted and
  // pan_blind_index, and no writer ever filled either. This route is one of the two live
  // writers, so without this the table rots again from the next HR entry.
  //
  // The plaintext write deliberately STAYS. The duplicate-employee guard still reads
  // s.pan_number by equality, so dropping it now would break that guard. The order is
  // backfill -> migrate readers -> retire plaintext; this is only the stop-the-rot step.
  //
  // Both helpers return null under a dev key, which writes NULL here. That is the correct
  // outcome: keeping a stale ciphertext next to a newly changed plaintext would be worse
  // than having none, and in production the real key is always loaded.
  if (pan_number !== undefined) {
    addStat("pan_number_encrypted", encryptPanForSync(pan_number, "statutory-hr-entry"));
    addStat("pan_blind_index", blindIndexPan(pan_number, "statutory-hr-entry"));
  }
  addStat("aadhaar_id", aadhaar_id);
  addStat("pf_eligible", pf_eligible);
  addStat("esi_eligible", esi_eligible);
  addStat("epf_date", epf_date);
  addStat("previous_pf_member", previous_pf_member);
  addStat("eps_member", eps_member);
  addStat("international_worker", international_worker);
  addStat("declaration_accepted", declaration_accepted);

  if (STAT_FIELDS.length > 1) {
    const placeholders = STAT_FIELDS.map(() => "?").join(", ");
    const dupClause = statOnDup.length ? `ON DUPLICATE KEY UPDATE ${statOnDup.join(", ")}` : "";
    // Same silence as the self-service route above, on the HR-entry path. See the note
    // there: the unique key exists, so the only thing this catch hid was real failure.
    await db.execute(
      `INSERT INTO employee_statutory_info (${STAT_FIELDS.join(", ")}) VALUES (${placeholders}) ${dupClause}`,
      statVals
    ).catch((error) => {
      console.error(`[statutory] employee_statutory_info write failed for ${empId} (HR entry):`, error);
    });
  }

  if (uan_number !== undefined) {
    await db.execute("UPDATE employees SET uan_number = ? WHERE id = ?", [uan_number, empId])
      .catch((error) => {
        console.error(`[statutory] employees.uan_number sync failed for ${empId} (HR entry):`, error);
      });
  }

  void logSensitiveAction({
    actor_user_id: req.authUser!.id,
    action_type: "STATUTORY_HR_ENTRY",
    module_key: "employees",
    entity_type: "employee",
    entity_id: empId,
    change_summary: { fields_updated: STAT_FIELDS.filter((f) => f !== "employee_id") },
    req,
  });

  return res.json({ success: true, message: "Statutory details saved" });
}));

// PUT /api/employees/:employeeId/emergency-contact — HR entry, mirrors PUT /me/emergency-contact
router.put("/:employeeId/emergency-contact", ...hrProfileGate, h(async (req: any, res: any) => {
  const empId = req.params.employeeId;
  const { name, relationship, mobile, address } = req.body;
  if (!name || !relationship || !mobile) {
    return res.status(400).json({ success: false, error: "name, relationship, and mobile are required" });
  }

  await db.execute(
    `INSERT INTO employee_emergency_contact (employee_id, contact_seq, is_primary, name, relationship, mobile, address)
     VALUES (?, 1, 1, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), relationship = VALUES(relationship), mobile = VALUES(mobile), address = VALUES(address)`,
    [empId, name, relationship, mobile, address ?? null]
  );
  return res.json({ success: true, message: "Emergency contact saved" });
}));

// PUT /api/employees/:employeeId/nominee — HR entry, mirrors PUT /me/nominee
router.put("/:employeeId/nominee", ...hrProfileGate, h(async (req: any, res: any) => {
  const empId = req.params.employeeId;
  const { nominee_name, relationship, date_of_birth, mobile, address } = req.body;
  if (!nominee_name || !relationship) {
    return res.status(400).json({ success: false, error: "nominee_name and relationship are required" });
  }

  try {
    const [existingRows] = await db.execute(
      "SELECT id FROM employee_nominee WHERE employee_id = ? ORDER BY created_at ASC LIMIT 1",
      [empId]
    ) as any[];

    if (existingRows.length) {
      await db.execute(
        `UPDATE employee_nominee SET nominee_name = ?, relationship = ?, date_of_birth = ?, mobile = ?, address = ? WHERE id = ?`,
        [nominee_name, relationship, date_of_birth ?? null, mobile ?? null, address ?? null, existingRows[0].id]
      );
    } else {
      await db.execute(
        `INSERT INTO employee_nominee (employee_id, nominee_name, relationship, date_of_birth, mobile, address) VALUES (?, ?, ?, ?, ?, ?)`,
        [empId, nominee_name, relationship, date_of_birth ?? null, mobile ?? null, address ?? null]
      );
    }
  } catch (_e) {
    await db.execute(
      "UPDATE employees SET nominee_name = ?, nominee_relation = ? WHERE id = ?",
      [nominee_name, relationship, empId]
    );
  }
  return res.json({ success: true, message: "Nominee saved" });
}));

// GET/POST/DELETE /api/employees/:employeeId/education — repeater, mirrors candidate journey's Step7Education
router.get("/:employeeId/education", ...hrProfileGate, h(async (req: any, res: any) => {
  const [rows] = await db.execute(
    "SELECT * FROM employee_education WHERE employee_id = ? ORDER BY created_at ASC",
    [req.params.employeeId]
  );
  return res.json({ success: true, data: rows });
}));

router.post("/:employeeId/education", ...hrProfileGate, h(async (req: any, res: any) => {
  const empId = req.params.employeeId;
  const { qualification, specialization_course_name, institution_name, board_type,
          passed_out_state, passed_out_city, passed_out_year, passed_out_percentage } = req.body;
  if (!qualification) return res.status(400).json({ success: false, error: "qualification is required" });

  await db.execute(
    `INSERT INTO employee_education
       (employee_id, qualification, specialization_course_name, institution_name, board_type,
        passed_out_state, passed_out_city, passed_out_year, passed_out_percentage)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [empId, qualification, specialization_course_name ?? null, institution_name ?? null, board_type ?? null,
     passed_out_state ?? null, passed_out_city ?? null, passed_out_year ?? null, passed_out_percentage ?? null]
  );
  return res.status(201).json({ success: true, message: "Education entry added" });
}));

router.delete("/:employeeId/education/:educationId", ...hrProfileGate, h(async (req: any, res: any) => {
  await db.execute(
    "DELETE FROM employee_education WHERE id = ? AND employee_id = ?",
    [req.params.educationId, req.params.employeeId]
  );
  return res.status(204).send();
}));

// GET/PUT /api/employees/:employeeId/experience — single latest-employer entry, mirrors candidate Step8Experience
router.get("/:employeeId/experience", ...hrProfileGate, h(async (req: any, res: any) => {
  const [rows] = await db.execute(
    "SELECT * FROM employee_experience WHERE employee_id = ? LIMIT 1",
    [req.params.employeeId]
  ) as any[];
  return res.json({ success: true, data: rows[0] ?? null });
}));

router.put("/:employeeId/experience", ...hrProfileGate, h(async (req: any, res: any) => {
  const empId = req.params.employeeId;
  const { is_fresher, employer_name, last_designation, last_ctc, experience_years, from_date, to_date, reason_for_leaving } = req.body;

  await db.execute(
    `INSERT INTO employee_experience
       (employee_id, is_fresher, employer_name, last_designation, last_ctc, experience_years, from_date, to_date, reason_for_leaving)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       is_fresher = VALUES(is_fresher), employer_name = VALUES(employer_name),
       last_designation = VALUES(last_designation), last_ctc = VALUES(last_ctc),
       experience_years = VALUES(experience_years), from_date = VALUES(from_date),
       to_date = VALUES(to_date), reason_for_leaving = VALUES(reason_for_leaving)`,
    [empId, is_fresher ? 1 : 0, employer_name ?? null, last_designation ?? null, last_ctc ?? null,
     experience_years ?? null, from_date ?? null, to_date ?? null, reason_for_leaving ?? null]
  );
  return res.json({ success: true, message: "Experience saved" });
}));

// POST /api/employees/:employeeId/bgv/start — bootstraps the ats_candidate + consent record
// a manually-onboarded employee needs to enter the existing BGV pipeline (see
// employee-bgv-bootstrap.service.ts). Requires the caller to confirm consent was recorded
// in the UI first — this never runs BGV on someone silently.
router.post("/:employeeId/bgv/start", ...hrProfileGate, h(async (req: any, res: any) => {
  if (req.body?.consentConfirmed !== true) {
    return res.status(400).json({ success: false, error: "consentConfirmed must be true — record the employee's consent before starting BGV" });
  }
  const result = await bootstrapCandidateForEmployee(req.params.employeeId, req.authUser!.id);
  return res.json({ success: true, data: result });
}));

// GET /api/employees/org-tree — role-scoped hierarchical org chart (must be before /:id)
router.get("/org-tree", requireAuth, h(async (req: any, res: any) => {
  const result = await employeeService.getOrgTree({
    userId: req.authUser!.id,
    processId: req.query.process_id as string | undefined,
    branchId:  req.query.branch_id as string | undefined,
    departmentId: req.query.department_id as string | undefined,
  });
  return res.json({ success: true, ...result });
}));

// GET /api/employees/stats — aggregate counts (must be before /:id to avoid route collision)
router.get("/stats", requireRole("admin", "hr", "manager", "ceo", "branch_head", "finance_head", "it_head"), h(async (req: any, res: any) => {
  const scoped = await buildScopeWhereClause(
    req.authUser!.id,
    ["hr", "manager", "branch_head"],
    { branchId: "e.branch_id", processId: "e.process_id" },
    { allowAdminBypass: true, allowCeoAllRead: true }
  );
  const scopeSql = scoped.sql === "1=1" ? "" : ` AND (${scoped.sql})`;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total_employees,
       COUNT(CASE WHEN LOWER(COALESCE(e.employment_status, 'active')) NOT IN ('inactive','terminated','offboarded','absconded','resigned','left','separated') THEN 1 END) AS active_employees,
       COUNT(CASE WHEN LOWER(COALESCE(e.employment_status, '')) IN ('inactive','terminated','offboarded','absconded','resigned','left','separated') THEN 1 END) AS inactive_employees,
       COUNT(CASE WHEN DATEDIFF(NOW(), e.date_of_joining) <= 90 THEN 1 END) AS new_joiners_90d
     FROM employees e WHERE e.active_status = 1${scopeSql}`,
    scoped.params
  );
  res.json({ data: rows[0] });
}));

// GET /api/employees/hr-hub/filter-options - scoped options from active employee assignments
router.get("/hr-hub/filter-options", requireRole("super_admin", "admin", "hr", "payroll_head", "payroll_admin", "wfm"), h(async (req: any, res: any) => {
  const parsed = employeeFiltersSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { branchId, processId, designationId } = parsed.data;
  const scoped = await buildScopeWhereClause(
    req.authUser!.id,
    ["hr", "manager", "payroll_head", "payroll_admin", "wfm", "branch_head"],
    {
      branchId: "e.branch_id",
      processId: "e.process_id",
      departmentId: "e.department_id",
      managerEmployeeId: "e.reporting_manager_id",
    },
    { allowAdminBypass: true, allowCeoAllRead: true },
  );

  const baseConditions = ["e.active_status = 1"];
  const baseParams: unknown[] = [];
  if (scoped.sql && scoped.sql !== "1=1") {
    baseConditions.push(`(${scoped.sql.replace(/^WHERE\s+/i, "").trim()})`);
    baseParams.push(...(scoped.params ?? []));
  }

  const whereFor = (conditions: string[], params: unknown[]) => ({
    sql: `WHERE ${[...baseConditions, ...conditions].join(" AND ")}`,
    params: [...baseParams, ...params],
  });

  const branchesWhere = whereFor([], []);
  const processesWhere = whereFor(
    branchId ? ["e.branch_id = ?"] : [],
    branchId ? [branchId] : [],
  );
  const designationsWhere = whereFor(
    [
      ...(branchId ? ["e.branch_id = ?"] : []),
      ...(processId ? ["e.process_id = ?"] : []),
    ],
    [branchId, processId].filter(Boolean),
  );
  const statusesWhere = whereFor(
    [
      ...(branchId ? ["e.branch_id = ?"] : []),
      ...(processId ? ["e.process_id = ?"] : []),
      ...(designationId ? ["e.designation_id = ?"] : []),
      "NULLIF(TRIM(e.employment_status), '') IS NOT NULL",
    ],
    [branchId, processId, designationId].filter(Boolean),
  );

  const [branchesResult, processesResult, designationsResult, statusesResult] = await Promise.all([
    db.execute<RowDataPacket[]>(
      `SELECT DISTINCT bm.id, bm.branch_name AS name
         FROM employees e
         JOIN branch_master bm ON bm.id = e.branch_id
         ${branchesWhere.sql}
        ORDER BY bm.branch_name`,
      branchesWhere.params,
    ),
    db.execute<RowDataPacket[]>(
      `SELECT DISTINCT pm.id, pm.process_name AS name
         FROM employees e
         JOIN process_master pm ON pm.id = e.process_id
         ${processesWhere.sql}
        ORDER BY pm.process_name`,
      processesWhere.params,
    ),
    db.execute<RowDataPacket[]>(
      `SELECT DISTINCT dm.id, dm.designation_name AS name
         FROM employees e
         JOIN designation_master dm ON dm.id = e.designation_id
         ${designationsWhere.sql}
        ORDER BY dm.designation_name`,
      designationsWhere.params,
    ),
    db.execute<RowDataPacket[]>(
      `SELECT DISTINCT e.employment_status AS id, e.employment_status AS name
         FROM employees e
         ${statusesWhere.sql}
        ORDER BY e.employment_status`,
      statusesWhere.params,
    ),
  ]);

  return res.json({
    success: true,
    data: {
      branches: branchesResult[0],
      processes: processesResult[0],
      designations: designationsResult[0],
      statuses: statusesResult[0],
    },
  });
}));

router.get("/hr-hub/today-summary", requireRole("super_admin", "admin", "hr", "payroll_head", "payroll_admin", "wfm", "branch_head"), h(async (req: any, res: any) => {
  // IST today: UTC+5:30
  const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const today = nowIST.toISOString().slice(0, 10);
  const scoped = await buildScopeWhereClause(
    req.authUser!.id,
    ["hr", "manager", "payroll_head", "payroll_admin", "wfm", "branch_head"],
    { branchId: "e.branch_id", processId: "e.process_id" },
    { allowAdminBypass: true, allowCeoAllRead: true }
  );
  const scopeSql = scoped.sql === "1=1" ? "" : ` AND (${scoped.sql})`;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total_with_record,
       SUM(adr.attendance_status = 'present')        AS present,
       SUM(adr.attendance_status = 'half_day')       AS half_day,
       SUM(adr.attendance_status = 'absent')         AS absent,
       SUM(adr.attendance_status = 'missing_punch')  AS missing_punch,
       SUM(adr.attendance_status = 'leave_approved') AS on_leave,
       SUM(adr.attendance_status = 'week_off')       AS week_off,
       SUM(adr.attendance_status = 'holiday')        AS holiday
     FROM employees e
     LEFT JOIN attendance_daily_record adr
       ON adr.employee_id = e.id AND adr.record_date = ?
     WHERE e.active_status = 1 AND e.employment_status = 'Active'${scopeSql}`,
    [today, ...scoped.params]
  );
  const [totalRow] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM employees e WHERE e.active_status = 1 AND e.employment_status = 'Active'${scopeSql}`,
    scoped.params
  );
  const total_active = Number((totalRow[0] as any)?.total ?? 0);
  const r = rows[0] as any;
  return res.json({
    success: true,
    date: today,
    data: {
      total_active,
      present:       Number(r.present ?? 0),
      half_day:      Number(r.half_day ?? 0),
      absent:        Number(r.absent ?? 0),
      missing_punch: Number(r.missing_punch ?? 0),
      on_leave:      Number(r.on_leave ?? 0),
      week_off:      Number(r.week_off ?? 0),
      holiday:       Number(r.holiday ?? 0),
      no_record:     total_active - Number(r.total_with_record ?? 0),
    },
  });
}));

// GET /api/employees/hr-hub — enriched employee list for People Attendance & Earnings Hub
router.get("/hr-hub", requireRole("super_admin", "admin", "hr", "payroll_head", "payroll_admin", "wfm"), h(async (req: any, res: any) => {
  const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ success: false, error: "month must be YYYY-MM" });
  }
  const monthStart = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const monthEnd = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;

  // PERFORMANCE: Check cache first (cache key includes all filters)
  const cacheKey = `hr-hub:${req.authUser!.id}:${JSON.stringify(req.query)}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  const scoped = await buildScopeWhereClause(
    req.authUser!.id,
    ["hr", "manager", "payroll_head", "payroll_admin", "wfm", "branch_head"],
    { branchId: "e.branch_id", processId: "e.process_id", departmentId: "e.department_id", managerEmployeeId: "e.reporting_manager_id" },
    { allowAdminBypass: true, allowCeoAllRead: true }
  );

  const parsed = employeeFiltersSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { page, status, processId, branchId, departmentId, search } = parsed.data;
  const designationId = parsed.data.designationId;
  const limit = Math.min(200, Math.max(1, Math.trunc(Number(parsed.data.limit) || 50)));
  const safeOffset = Math.max(0, Math.trunc((page - 1) * limit));
  const offset = safeOffset;

  const anomalyOnly = req.query.anomalyOnly === "1" || req.query.anomalyOnly === "true";

  const conds: string[] = ["e.active_status = 1"];
  const params: unknown[] = [];
  if (status)        { conds.push("e.employment_status = ?");  params.push(status); }
  if (processId)     { conds.push("e.process_id = ?");         params.push(processId); }
  if (branchId)      { conds.push("e.branch_id = ?");          params.push(branchId); }
  if (departmentId)  { conds.push("e.department_id = ?");      params.push(departmentId); }
  if (designationId) { conds.push("e.designation_id = ?");     params.push(designationId); }
  if (search) {
    const isCodeSearch = /^MAS/i.test(search.trim());
    if (isCodeSearch) {
      // Employee code searches: use prefix match (indexed, fast)
      conds.push("e.employee_code LIKE ?");
      params.push(`${search.trim().toUpperCase()}%`);
    } else {
      const term = search.trim();
      // Names are matched two ways because FULLTEXT alone has real blind spots:
      //  1. innodb_ft_min_token_size defaults to 3, so a 1-2 character search
      //     matches NOTHING via MATCH...AGAINST — typing "Jo" found no "John".
      //  2. only full_name is in ft_emp_search, so an employee whose full_name
      //     is blank (first_name/last_name populated instead) was unfindable.
      // The derived-name LIKE covers both. It sits inside the existing OR, so
      // the query plan class is unchanged; for terms >= 3 chars FULLTEXT still
      // does the heavy lifting.
      const derivedName =
        "COALESCE(NULLIF(e.full_name, ''), CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, '')))";
      if (term.length < 3) {
        // Below the FULLTEXT token floor — LIKE is the only thing that can match.
        conds.push(`(${derivedName} LIKE ? OR e.employee_code LIKE ?)`);
        params.push(`%${term}%`, `%${term}%`);
      } else {
        conds.push(
          `(MATCH(e.full_name, e.employee_code, e.official_email) AGAINST (? IN BOOLEAN MODE)
            OR e.employee_code LIKE ?
            OR ${derivedName} LIKE ?)`
        );
        params.push(`${term}*`, `%${term}%`, `%${term}%`);
      }
    }
  }
  if (scoped.sql && scoped.sql !== "1=1") {
    conds.push(`(${scoped.sql.replace(/^WHERE\s+/i, "").trim()})`);
    params.push(...(scoped.params ?? []));
  }
  if (anomalyOnly) {
    conds.push("(COALESCE(att.lwp_days, 0) > 2 OR COALESCE(att.missing_punch_count, 0) > 0)");
  }
  const where = `WHERE ${conds.join(" AND ")}`;

  // PERFORMANCE FIX: Use indexed queries and simpler aggregations
  const mainQuery = `SELECT e.id, e.employee_code,
            e.full_name,
            e.employment_status, e.date_of_joining,
            bm.branch_name, pm.process_name, dm.designation_name, dept.dept_name,
            COALESCE(att.present_days, 0) AS present_days,
            COALESCE(att.lwp_days, 0) AS lwp_days,
            COALESCE(att.late_marks, 0) AS late_marks,
            COALESCE(att.missing_punch_count, 0) AS missing_punch_count,
            sal.net_salary  AS last_salary_net,
            sal.run_month   AS last_salary_month
       FROM employees e
       LEFT JOIN branch_master bm       ON bm.id   = e.branch_id
       LEFT JOIN process_master pm      ON pm.id   = e.process_id
       LEFT JOIN designation_master dm  ON dm.id   = e.designation_id
       LEFT JOIN department_master dept ON dept.id = e.department_id
       LEFT JOIN (
         SELECT employee_id,
                COUNT(CASE WHEN attendance_status = 'present' THEN 1 END) AS present_days,
                SUM(CASE
                    WHEN attendance_status NOT IN ('week_off','holiday','leave_approved')
                    THEN COALESCE(lwp_value, 0)
                    ELSE 0
                END) AS lwp_days,
                COALESCE(SUM(late_mark), 0) AS late_marks,
                COUNT(CASE WHEN attendance_status = 'missing_punch' THEN 1 END) AS missing_punch_count
           FROM attendance_daily_record
          WHERE record_date >= ? AND record_date <= ?
          GROUP BY employee_id
       ) att ON att.employee_id = e.id
       LEFT JOIN LATERAL (
         SELECT spl.net_salary, spr.run_month
           FROM salary_prep_line spl
           INNER JOIN salary_prep_run spr ON spr.id = spl.run_id
          WHERE spl.employee_id = e.id
          ORDER BY spr.run_month DESC, spr.created_at DESC
          LIMIT 1
       ) sal ON TRUE
       ${where}
       ORDER BY e.employee_code ASC
       LIMIT ${limit} OFFSET ${offset}`;

  const countQuery = anomalyOnly
    ? `SELECT COUNT(*) AS total
         FROM employees e
         LEFT JOIN (
           SELECT employee_id,
                  COALESCE(SUM(
                    CASE
                      WHEN attendance_status NOT IN ('week_off','holiday','leave_approved')
                      THEN COALESCE(lwp_value, 0)
                      ELSE 0
                    END
                  ), 0) AS lwp_days,
                  SUM(attendance_status = 'missing_punch') AS missing_punch_count
             FROM attendance_daily_record
            WHERE record_date BETWEEN ? AND ?
            GROUP BY employee_id
         ) att ON att.employee_id = e.id
         ${where}`
    : `SELECT COUNT(*) AS total FROM employees e ${where}`;

  const countParams = anomalyOnly
    ? [monthStart, monthEnd, ...params]
    : params;

  const [[rows], [countRows]] = await Promise.all([
    db.execute<RowDataPacket[]>(mainQuery, [monthStart, monthEnd, ...params]),
    db.execute<RowDataPacket[]>(countQuery, countParams),
  ]);

  const data = (rows as any[]).map((r: any) => ({
    ...r,
    has_anomaly: Number(r.lwp_days) > 2 || Number(r.missing_punch_count) > 0,
  }));

  const result = { success: true, data, total: Number((countRows as any[])[0]?.total ?? 0), page, limit };

  // PERFORMANCE: Cache the result
  setCache(cacheKey, result);

  return res.json(result);
}));

router.get("/", requireRole("super_admin", "admin", "hr", "manager", "ceo", "branch_head", "process_manager", "wfm", "payroll_head", "payroll_admin", "payroll", "finance_head", "it_head", "tq_head"), h(async (req, res) => {
  const scoped = await buildScopeWhereClause(
    req.authUser!.id,
    ["hr", "manager", "branch_head", "process_manager", "wfm", "payroll_head", "payroll_admin", "payroll", "finance_head", "it_head", "tq_head"],
    {
      branchId: "e.branch_id",
      processId: "e.process_id",
      departmentId: "e.department_id",
      managerEmployeeId: "e.reporting_manager_id"
    },
    { allowAdminBypass: true, allowCeoAllRead: true }
  );

  (req as any).scopeFilter = scoped;
  return c.listEmployees(req, res);
}));
router.post("/",
  requireRole("admin", "hr"),
  requireScopedRole(["hr"], async (req) => ({
    branchId: req.body.branch_id,
    processId: req.body.process_id,
    departmentId: req.body.department_id
  })),
  h(c.createEmployee)
);
router.get("/:id", requireRole("super_admin", "admin", "hr", "manager", "branch_head", "process_manager", "wfm", "payroll_head", "payroll_admin", "payroll", "finance_head", "it_head"), h(async (req: any, res: any) => {
  // Fetch employee to check scope before exposing profile
  const [empRows] = await db.execute<RowDataPacket[]>(
    "SELECT branch_id, process_id FROM employees WHERE id = ? LIMIT 1",
    [req.params.id]
  );
  const emp = (empRows as any[])[0];
  if (!emp) return res.status(404).json({ success: false, message: "Employee not found" });

  const ok = await hasScopedAccess(
    req.authUser!.id,
    ["hr", "manager", "branch_head", "process_manager", "wfm", "payroll_head", "payroll_admin", "payroll", "finance_head", "it_head"],
    { branchId: emp.branch_id, processId: emp.process_id },
    { allowAdminBypass: true }
  );
  if (!ok) return res.status(403).json({ success: false, message: "Forbidden: outside your assigned scope" });

  return c.getEmployee(req, res);
}));
router.patch("/:id",
  requireRole("super_admin", "admin", "hr"),
  requireScopedRole(["hr"], async (req) => {
    // Resolve employee's branch/process from DB
    const [rows] = await db.execute(
      'SELECT branch_id, process_id, department_id FROM employees WHERE id = ? LIMIT 1',
      [req.params.id]
    ) as any[];
    const emp = rows[0];
    return {
      branchId: emp?.branch_id,
      processId: emp?.process_id,
      departmentId: emp?.department_id
    };
  }),
  h(c.updateEmployee)
);
router.delete("/:id", requireRole("admin"), h(c.deactivateEmployee));

// Journey log
router.get("/:id/journey", requireRole("admin", "hr", "manager"), async (req: any, res: any, next: any) => {
  try {
    const data = await listJourneyEvents(req.params.id, {
      module:    req.query.module    as string | undefined,
      eventType: req.query.eventType as string | undefined,
      fromDate:  req.query.fromDate  as string | undefined,
      toDate:    req.query.toDate    as string | undefined,
    });
    return res.json({ success: true, data });
  } catch (err) { next(err); }
});

router.post("/:id/journey", requireRole("admin", "hr"), async (req: any, res: any, next: any) => {
  try {
    const b = req.body;
    if (!b.eventType || !b.eventDate) {
      return res.status(400).json({ success: false, message: "eventType and eventDate required" });
    }
    const data = await appendJourneyEvent({
      employeeId:  req.params.id,
      eventType:   b.eventType,
      eventDate:   b.eventDate,
      description: b.description,
      oldValue:    b.oldValue,
      newValue:    b.newValue,
      module:      b.module,
      triggeredBy: req.authUser?.id,
      metadata:    b.metadata,
    });
    return res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/employees/:id/stat-card — comprehensive employee profile aggregate
//
// SHADOWED: employee.secure.routes.ts is mounted first (app.ts) and its
// `/:id([0-9a-fA-F-]{36})/stat-card` route matches every UUID employee id, so this
// handler never runs in practice. Kept for non-UUID ids and backward compatibility.
// Any change to the stat-card payload must be made in employee.secure.routes.ts too,
// or it will silently never reach the client.
router.get("/:id/stat-card", requireAuth, h(async (req: any, res: any) => {
  const { db } = await import("../../db/mysql.js");
  const targetId = req.params.id;
  const selfEmp = await getEmployeeForUser(req.authUser!.id);

  // Check if requesting own stat card
  if (selfEmp?.id === targetId) {
    // Always allowed
  } else {
    // Requesting someone else's card — resolve all roles in a single DB query
    // (req.authUser.role holds the primary role from middleware; fetch full list for multi-role users)
    const [roleRows] = await db.execute<RowDataPacket[]>(
      `SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1`,
      [req.authUser!.id]
    );
    const userRoleSet = new Set((roleRows as { role_key: string }[]).map(r => r.role_key));
    const isSuperAdmin = userRoleSet.has("super_admin");
    const isPayroll = userRoleSet.has("payroll_head") || userRoleSet.has("payroll");
    const isCEO = userRoleSet.has("ceo");
    const isAdmin = userRoleSet.has("admin");
    const isHR = userRoleSet.has("hr");
    const isBranchHead = userRoleSet.has("branch_head");
    const isManager = userRoleSet.has("manager") || userRoleSet.has("process_manager");

    // Super Admin, Payroll, CEO see all
    if (isSuperAdmin || isPayroll || isCEO) {
      // Allowed
    }
    // Admin, HR, Branch Head — branch scope only
    else if (isAdmin || isHR || isBranchHead) {
      const [[myEmp]] = await db.execute<RowDataPacket[]>(
        'SELECT branch_id FROM employees WHERE id = ? LIMIT 1',
        [selfEmp?.id]
      );
      const [[targetEmp]] = await db.execute<RowDataPacket[]>(
        'SELECT branch_id FROM employees WHERE id = ? LIMIT 1',
        [targetId]
      );
      if (!myEmp || !targetEmp || myEmp.branch_id !== targetEmp.branch_id) {
        return res.status(403).json({ error: "You can only view employees in your branch" });
      }
    }
    // Manager — team scope only
    else if (isManager) {
      const [[targetEmp]] = await db.execute<RowDataPacket[]>(
        'SELECT reporting_manager_id FROM employees WHERE id = ? LIMIT 1',
        [targetId]
      );
      if (!targetEmp || targetEmp.reporting_manager_id !== selfEmp?.id) {
        return res.status(403).json({ error: "You can only view your direct reports" });
      }
    }
    // Regular employee — already denied by outer check
    else {
      return res.status(403).json({ error: "You can only view your own stat card" });
    }
  }

  // Core employee with joined master data
  const [[emp]] = await db.execute<RowDataPacket[]>(
    `SELECT e.*, CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS full_name,
            d.designation_name, b.branch_name, b.call_centre_code,
            COALESCE(b.address, '') AS branch_address, b.city AS branch_city, b.state AS branch_state, COALESCE(b.hr_contact, '') AS branch_hr_contact,
            p.process_name, dept.dept_name,
            DATEDIFF(NOW(), e.date_of_joining) AS days_employed,
            eec.name AS emergency_name,
            eec.relationship AS emergency_relationship,
            eec.mobile AS emergency_mobile
       FROM employees e
       LEFT JOIN designation_master d ON d.id = e.designation_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN department_master dept ON dept.id = e.department_id
       LEFT JOIN employee_emergency_contact eec
         ON eec.employee_id = e.id
        AND eec.id = (
          SELECT ec2.id
            FROM employee_emergency_contact ec2
           WHERE ec2.employee_id = e.id
           ORDER BY COALESCE(ec2.is_primary, 0) DESC, COALESCE(ec2.contact_seq, 1) ASC, ec2.created_at ASC
           LIMIT 1
        )
      WHERE e.id = ? LIMIT 1`,
    [targetId]
  );
  if (!emp) return res.status(404).json({ error: "Employee not found" });

  // Leave balances (all types for current year)
  let leaveBalances: RowDataPacket[] = [];
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT lt.leave_code, lt.leave_name,
              COALESCE(lbl.allocated_days, 0) + COALESCE(lbl.adjusted_days, 0) - COALESCE(lbl.used_days, 0) AS available_days,
              COALESCE(lbl.used_days, 0) AS used_days
         FROM leave_balance_ledger lbl
         JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
        WHERE lbl.employee_id = ? AND lbl.balance_year = YEAR(NOW())
        ORDER BY lt.leave_name`,
      [targetId]
    );
    leaveBalances = rows;
  } catch (_e) { /* table may not exist yet */ }

  // Attendance this month
  let attendance = { present_days: 0, working_days: 0, attendance_pct: null as number | null };
  try {
    const [attRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(CASE WHEN attendance_status = 'present' THEN 1 END) AS present_days,
         COUNT(CASE WHEN attendance_status NOT IN ('week_off','holiday') THEN 1 END) AS working_days,
         ROUND(
           COUNT(CASE WHEN attendance_status = 'present' THEN 1 END) * 100.0 /
           NULLIF(COUNT(CASE WHEN attendance_status NOT IN ('week_off','holiday') THEN 1 END), 0),
         1) AS attendance_pct
       FROM attendance_daily_record
      WHERE employee_id = ? AND YEAR(record_date) = YEAR(NOW()) AND MONTH(record_date) = MONTH(NOW())`,
      [targetId]
    );
    if (attRows[0]) attendance = attRows[0] as any;
  } catch (_e) { /* table may not exist yet */ }

  // Latest performance rating
  let performance: RowDataPacket | null = null;
  try {
    const [perfRows] = await db.execute<RowDataPacket[]>(
      `SELECT pfr.overall_score, pfc.period
         FROM performance_feedback_report pfr
         JOIN performance_feedback_cycle pfc ON pfc.cycle_id = pfr.cycle_id
        WHERE pfr.employee_id = ?
        ORDER BY pfr.report_generated_at DESC LIMIT 1`,
      [targetId]
    );
    performance = perfRows[0] ?? null;
  } catch (_e) { /* table may not exist yet */ }

  // Active assets — use returned_date (aligned with secure route)
  let activeAssets = 0;
  try {
    const [assetRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS active_assets FROM asset_assignment WHERE employee_id = ? AND returned_date IS NULL`,
      [targetId]
    );
    activeAssets = Number(assetRows[0]?.active_assets ?? 0);
  } catch (_e) { /* table may not exist yet */ }

  // Documents — combine joining-document checklist + general employee_documents
  // Checklist is the primary source for onboarded employees; employee_documents is secondary
  let missingDocs = 0, awaitingVerification = 0, verifiedDocs = 0;
  try {
    // Checklist counts (employee_joining_document_checklist)
    const [clRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         SUM(CASE WHEN status IN ('pending_hr_upload','pending_candidate_esign','pending_generation','rejected','template_pending','needs_correction') AND mandatory = 1 THEN 1 ELSE 0 END) AS checklist_missing,
         SUM(CASE WHEN status IN ('uploaded_pending_review','uploaded_pending_esign','esign_initiated','employee_confirmed','wet_signed_uploaded') THEN 1 ELSE 0 END) AS checklist_awaiting,
         SUM(CASE WHEN status IN ('verified','signed_verified','completed','esign_completed') THEN 1 ELSE 0 END) AS checklist_verified
         FROM employee_joining_document_checklist WHERE employee_id = ?`,
      [targetId]
    ).catch(() => [[{ checklist_missing: null, checklist_awaiting: null, checklist_verified: null }]] as any);

    // General employee_documents counts
    const [docRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         SUM(CASE WHEN (file_url IS NULL OR file_url = '') THEN 1 ELSE 0 END) AS missing_docs,
         SUM(CASE WHEN file_url IS NOT NULL AND file_url <> '' AND verified = 0 THEN 1 ELSE 0 END) AS awaiting_verification,
         SUM(CASE WHEN verified = 1 THEN 1 ELSE 0 END) AS verified_docs
         FROM employee_documents WHERE employee_id = ?`,
      [targetId]
    ).catch(() => [[{ missing_docs: 0, awaiting_verification: 0, verified_docs: 0 }]] as any);

    const clMissing = Number(clRows[0]?.checklist_missing ?? 0);
    const clAwaiting = Number(clRows[0]?.checklist_awaiting ?? 0);
    const clVerified = Number(clRows[0]?.checklist_verified ?? 0);
    const clTotal = clMissing + clAwaiting + clVerified;

    if (clTotal > 0) {
      // Employee has a checklist — use it as the authoritative source
      missingDocs = clMissing;
      awaitingVerification = clAwaiting;
      verifiedDocs = clVerified;
    } else {
      // No checklist rows — fall back to general employee_documents
      missingDocs = Number(docRows[0]?.missing_docs ?? 0);
      awaitingVerification = Number(docRows[0]?.awaiting_verification ?? 0);
      verifiedDocs = Number(docRows[0]?.verified_docs ?? 0);
    }
  } catch (_e) { /* table may not exist yet */ }

  // Gamification tier
  let gamificationTier: RowDataPacket | null = null;
  try {
    const [tierRows] = await db.execute<RowDataPacket[]>(
      /*
       * employee_tier_status holds current_tier_id, not tier_name, so this threw
       * ER_BAD_FIELD_ERROR. It sits inside a try/catch that leaves gamificationTier null, so the
       * failure was silent: the employee profile simply never showed a tier.
       *
       * Two tier masters exist and the right one was measured rather than guessed. Of the 814
       * rows in employee_tier_status, all 814 join gamification_tier_master.tier_id and 0 join
       * gamification_tier.id.
       */
      `SELECT gtm.tier_name, ets.total_points
         FROM employee_tier_status ets
         LEFT JOIN gamification_tier_master gtm ON gtm.tier_id = ets.current_tier_id
        WHERE ets.employee_id = ? LIMIT 1`,
      [targetId]
    );
    gamificationTier = tierRows[0] ?? null;
  } catch (_e) { /* table may not exist yet */ }

  // EPF compliance status
  let epfComplianceStatus: string | null = null;
  try {
    const [epfRows] = await db.execute<RowDataPacket[]>(
      `SELECT status FROM employee_epf_compliance_profile WHERE employee_id = ? LIMIT 1`,
      [targetId]
    );
    epfComplianceStatus = (epfRows[0]?.status as string) ?? null;
  } catch (_e) { /* table may not exist yet */ }

  // Journey events (last 20)
  let journey: RowDataPacket[] = [];
  try {
    const [journeyRows] = await db.execute<RowDataPacket[]>(
      `SELECT event_type, event_date, description, module
         FROM employee_journey_log
        WHERE employee_id = ?
        ORDER BY event_date DESC LIMIT 20`,
      [targetId]
    );
    journey = journeyRows;
  } catch (_e) { /* table may not exist yet */ }

  return res.json({
    data: {
      employee: {
        ...emp,
        emergency_contact: emp.emergency_name ? {
          name: emp.emergency_name,
          relationship: emp.emergency_relationship,
          mobile: emp.emergency_mobile,
        } : null,
      },
      leave_balances: leaveBalances,
      attendance,
      performance,
      active_assets: activeAssets,
      missing_docs: missingDocs,
      awaiting_verification: awaitingVerification,
      verified_docs: verifiedDocs,
      pending_docs: missingDocs,
      epf_compliance_status: epfComplianceStatus,
      gamification_tier: gamificationTier,
      journey,
    }
  });
}));

// ── GET /api/employees/bank-quality/corrupt ─────────────────────────────────
// HR Admin: list employees whose stored account number is corrupt (scientific
// notation from legacy Excel import) and therefore unrecoverable. These employees
// need to re-submit their bank details through the normal profile-update flow.
router.get("/bank-quality/corrupt", requireAuth, requireRole("hr", "hr_admin", "super_admin", "payroll", "finance"), h(async (_req: any, res: any) => {
  const SCIENTIFIC_RE = /[Ee][+-]/;
  const VALID_ACCOUNT_RE = /^[0-9]{6,20}$/;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id AS employee_id, e.employee_code, e.full_name, e.mobile, e.email,
            ebd.id AS bank_detail_id, ebd.bank_name, ebd.ifsc_code,
            ebd.account_number, ebd.account_number_enc, ebd.updated_at AS bank_updated_at
       FROM employee_bank_detail ebd
       JOIN employees e ON e.id = ebd.employee_id
      WHERE ebd.account_number_enc IS NULL
        AND ebd.account_number IS NOT NULL
        AND e.active_status = 1
      ORDER BY e.employee_code ASC`
  );

  const corruptRows = (rows as any[]).filter((r) => {
    const raw = r.account_number;
    if (!raw) return false;
    const txt = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
    const trimmed = txt.trim();
    return !trimmed || SCIENTIFIC_RE.test(trimmed) || !VALID_ACCOUNT_RE.test(trimmed);
  }).map((r) => {
    const raw = r.account_number;
    const txt = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
    const trimmed = txt.trim();
    let reason = "unknown_format";
    if (!trimmed) reason = "empty";
    else if (SCIENTIFIC_RE.test(trimmed)) reason = "scientific_notation";
    else if (!/^[0-9]{6,20}$/.test(trimmed)) reason = "non_numeric";
    return {
      employee_id: r.employee_id,
      employee_code: r.employee_code,
      full_name: r.full_name,
      mobile: r.mobile,
      email: r.email,
      bank_detail_id: r.bank_detail_id,
      bank_name: r.bank_name,
      ifsc_code: r.ifsc_code,
      corrupt_value_masked: trimmed.slice(0, 3) + "***",
      reason,
      bank_updated_at: r.bank_updated_at,
    };
  });

  return res.json({
    success: true,
    count: corruptRows.length,
    data: corruptRows,
  });
}));

// ── POST /api/employees/bank-quality/:employeeId/request-resubmission ────────
// HR Admin: send an in-app notification to the employee asking them to update
// their bank details. Idempotent — creates one pending request per employee.
router.post("/bank-quality/:employeeId/request-resubmission", requireAuth, requireRole("hr", "hr_admin", "super_admin"), h(async (req: any, res: any) => {
  const { employeeId } = req.params;

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.full_name, e.user_id FROM employees e WHERE e.id = ? AND e.active_status = 1 LIMIT 1`,
    [employeeId]
  );
  if (!(empRows as any[])[0]) return res.status(404).json({ success: false, message: "Employee not found" });
  const emp = (empRows as any[])[0];

  // Queue an in-app notification via the notification_log channel
  await db.execute(
    `INSERT INTO notification_log
       (id, template_code, recipient_type, recipient_id, recipient_email, channel, subject, body, status, created_at)
     VALUES (UUID(), 'bank_resubmission_request', 'employee', ?, ?,
       'in_app',
       'Action Required: Update Bank Details',
       'Your bank account details could not be verified. Please update your bank details in your employee profile to ensure salary is credited correctly.',
       'pending', NOW())`,
    [employeeId, emp.email ?? null]
  );

  void logSensitiveAction({
    actor_user_id: req.authUser!.id,
    action_type: "BANK_RESUBMISSION_REQUEST",
    module_key: "employees",
    entity_type: "employees",
    entity_id: employeeId,
    change_summary: { employee_code: emp.employee_code, full_name: emp.full_name },
  });

  return res.json({ success: true, message: `Resubmission request sent to ${emp.full_name}` });
}));

export { router as employeeRouter };
