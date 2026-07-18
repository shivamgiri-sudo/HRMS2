import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireScopedRole } from "../../middleware/scopeMiddleware.js";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { db } from "../../db/mysql.js";
import { employeeController as c } from "./employee.controller.js";
import { employeeService } from "./employee.service.js";
import { employeeFiltersSchema } from "./employee.validation.js";
import { appendJourneyEvent, listJourneyEvents, listComprehensiveJourney } from "./journeyLog.service.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { profileApprovalService } from "./profile-approval.service.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// GET /api/employees/me — returns the employee record for the logged-in user with nested details
router.get("/me", h(async (req: any, res: any) => {
  const userId = req.authUser?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  const [rows] = await db.execute(
    `SELECT
       e.id, e.employee_code, e.user_id,
       e.first_name, e.last_name,
       e.email, e.official_email, e.official_email_compliant,
       e.mobile, e.personal_email, e.personal_phone, e.personal_mobile, e.alternate_mobile,
       e.avatar_url, e.photo_url,
       e.gender, e.date_of_birth, e.marital_status, e.blood_group,
       e.address, e.address_line1, e.city, e.state, e.country, e.pincode,
       e.status, e.employment_status, e.employment_type,
       e.designation_id, e.department_id, e.branch_id, e.process_id,
       e.reporting_manager_id, e.manager_id,
       e.date_of_joining, e.hire_date, e.salary_start_date,
       e.working_hours_start, e.working_hours_end, e.working_days,
       e.is_manager, e.emergency_contact_name,
       e.pan_verified_on, e.aadhaar_verified_on,
       e.pan_number, e.uan_number, e.epf_number, e.esic_number,
       e.aadhaar_number, e.aadhaar_last4,
       d.designation_name  AS designation,
       dept.dept_name      AS department_name,
       b.branch_name,
       b.branch_name       AS branch_display_name,
       CONCAT(mgr.first_name, ' ', COALESCE(mgr.last_name, '')) AS reporting_manager_name
     FROM employees e
     LEFT JOIN designation_master d    ON d.id    = e.designation_id
     LEFT JOIN department_master  dept ON dept.id = e.department_id
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
    // Bank details — account_number is varbinary; read as Buffer then mask last-4
    db.execute(
      "SELECT bank_name, account_holder_name, bank_branch, ifsc_code, account_type, account_number, verified FROM employee_bank_detail WHERE employee_id = ? AND active_status = 1 LIMIT 1",
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
      official_email_compliant: emp.official_email_compliant,
      mobile:                   emp.mobile,
      personal_email:           emp.personal_email,
      personal_phone:           emp.personal_phone,
      personal_mobile:          emp.personal_mobile,
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
      bank_account_number:      emp.bank_account_number != null ? true : null,
      emergency_contact_name:   emp.emergency_contact_name,
      // Nested shapes expected by frontend
      department: emp.department_name ? { name: emp.department_name } : null,
      bank_details: (() => {
        if (!bankRows.length) return null;
        const b = bankRows[0];
        // account_number is stored as varbinary — convert Buffer to string then mask
        let rawAcct: string | null = null;
        if (b.account_number) {
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

  // official_email is the canonical login identity — keep it out of self-service
  // address→address_line1, no "address" or "country" column in prod schema
  const ALLOWED_FIELDS = [
    "mobile", "personal_email", "personal_phone", "alternate_mobile",
    "address_line1", "address_line2", "city", "state", "pincode",
    "date_of_birth", "gender", "marital_status",
    "blood_group", "working_hours_start", "working_hours_end", "working_days"
  ];

  const updates: string[] = [];
  const values: any[] = [];
  for (const field of ALLOWED_FIELDS) {
    if (req.body[field] !== undefined) {
      updates.push(`\`${field}\` = ?`);
      values.push(req.body[field]);
    }
  }

  // official_email update: sync to auth_user.email as login identity
  const newOfficialEmail = req.body.official_email !== undefined
    ? String(req.body.official_email).toLowerCase().trim()
    : null;

  if (newOfficialEmail) {
    updates.push("`official_email` = ?");
    values.push(newOfficialEmail);
  }

  if (!updates.length) return res.status(400).json({ success: false, error: "No updatable fields provided" });

  values.push(empId);
  await db.execute(`UPDATE employees SET ${updates.join(", ")} WHERE id = ?`, values);

  // Sync auth_user.email = official_email (login identity)
  if (newOfficialEmail) {
    const [conflict] = await db.execute(
      "SELECT id FROM auth_user WHERE LOWER(email) = ? AND id != ? LIMIT 1",
      [newOfficialEmail, userId]
    ) as any[];
    if (!(conflict as any[]).length) {
      await db.execute("UPDATE auth_user SET email = ? WHERE id = ?", [newOfficialEmail, userId]);
    } else {
      return res.status(409).json({ success: false, error: "This official email is already used by another account." });
    }
  }

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

  // Fetch existing bank details for old_values record
  const [existing] = await db.execute<RowDataPacket[]>(
    "SELECT bank_name, account_holder_name, bank_branch, ifsc_code, account_type, masked_account_number FROM employee_bank_detail WHERE employee_id = ? AND is_primary = 1 LIMIT 1",
    [empId]
  );

  const result = await profileApprovalService.submitBankDetailsForApproval(
    userId,
    empId,
    { bank_name, account_holder_name, bank_branch, ifsc_code, account_type, account_number },
    existing[0] ?? {}
  );

  return res.json({ success: true, ...result });
}));

// PUT /api/employees/me/bank-details — upsert bank details for logged-in user
router.put("/me/bank-details", h(async (req: any, res: any) => {
  const userId = req.authUser?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  const [rows] = await db.execute(
    "SELECT id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1",
    [userId]
  ) as any[];
  if (!rows.length) return res.status(404).json({ success: false, error: "No employee record for this user" });
  const empId = rows[0].id;

  const { bank_name, account_holder_name, bank_branch, ifsc_code, account_type, account_number } = req.body;

  const fields: string[] = ["employee_id", "bank_name", "account_holder_name", "bank_branch", "ifsc_code", "account_type", "verification_status"];
  const vals: any[] = [empId, bank_name, account_holder_name, bank_branch, ifsc_code, account_type, "pending"];
  const onDup: string[] = ["bank_name = VALUES(bank_name)", "account_holder_name = VALUES(account_holder_name)", "bank_branch = VALUES(bank_branch)", "ifsc_code = VALUES(ifsc_code)", "account_type = VALUES(account_type)", "verification_status = 'pending'"];

  if (account_number) {
    const masked = "****" + String(account_number).slice(-4);
    fields.push("account_number", "masked_account_number");
    vals.push(account_number, masked);
    onDup.push("account_number = VALUES(account_number)", "masked_account_number = VALUES(masked_account_number)");
  }

  const placeholders = fields.map(() => "?").join(", ");
  await db.execute(
    `INSERT INTO employee_bank_detail (${fields.join(", ")}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${onDup.join(", ")}`,
    vals
  );
  return res.json({ success: true, message: "Bank details saved" });
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
  addStat("aadhaar_id", aadhaar_id);
  addStat("pf_eligible", pf_eligible);
  addStat("esi_eligible", esi_eligible);
  addStat("epf_date", epf_date);

  if (STAT_FIELDS.length > 1) {
    const placeholders = STAT_FIELDS.map(() => "?").join(", ");
    const dupClause = statOnDup.length ? `ON DUPLICATE KEY UPDATE ${statOnDup.join(", ")}` : "";
    await db.execute(
      `INSERT INTO employee_statutory_info (${STAT_FIELDS.join(", ")}) VALUES (${placeholders}) ${dupClause}`,
      statVals
    ).catch(() => {
      // If ON DUPLICATE KEY not applicable (no unique key), fall through silently
    });
  }

  // Also sync uan_number to employees table if provided
  if (uan_number !== undefined) {
    await db.execute("UPDATE employees SET uan_number = ? WHERE id = ?", [uan_number, empId]).catch(() => {});
  }

  // Audit every self-service statutory change — these fields feed payroll, PF filings, and TDS.
  // Record which fields were submitted (not values — PAN/Aadhaar are sensitive).
  const changedFields = [
    epf_number  !== undefined && "epf_number",
    esi_number  !== undefined && "esi_number",
    uan_number  !== undefined && "uan_number",
    pan_number  !== undefined && "pan_number",
    aadhaar_id  !== undefined && "aadhaar_id",
    pf_eligible !== undefined && "pf_eligible",
    esi_eligible!== undefined && "esi_eligible",
    epf_date    !== undefined && "epf_date",
  ].filter(Boolean);

  void logSensitiveAction({
    actor_user_id: userId,
    action_type: "STATUTORY_SELF_UPDATE",
    module_key: "employees",
    entity_type: "employee",
    entity_id: empId,
    change_summary: { fields_updated: changedFields },
    req,
  });

  return res.json({ success: true, message: "Statutory details saved" });
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
router.get("/stats", requireRole("admin", "hr", "manager", "ceo"), h(async (_req: any, res: any) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total_employees,
       COUNT(CASE WHEN active_status = 1 AND LOWER(COALESCE(employment_status, 'active')) NOT IN ('inactive','terminated','offboarded','absconded','resigned','left','separated') THEN 1 END) AS active_employees,
       COUNT(CASE WHEN LOWER(COALESCE(employment_status, '')) IN ('inactive','terminated','offboarded','absconded','resigned','left','separated') THEN 1 END) AS inactive_employees,
       COUNT(CASE WHEN DATEDIFF(NOW(), date_of_joining) <= 90 THEN 1 END) AS new_joiners_90d
     FROM employees WHERE active_status = 1`
  );
  res.json({ data: rows[0] });
}));

// GET /api/employees/hr-hub/today-summary — live today attendance counts for the hub header strip
router.get("/hr-hub/today-summary", requireRole("super_admin", "admin", "hr", "payroll_head", "payroll_admin"), h(async (req: any, res: any) => {
  // IST today: UTC+5:30
  const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const today = nowIST.toISOString().slice(0, 10);
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
     WHERE e.active_status = 1 AND e.employment_status = 'Active'`,
    [today]
  );
  const [totalRow] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM employees WHERE active_status = 1 AND employment_status = 'Active'`
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
router.get("/hr-hub", requireRole("super_admin", "admin", "hr", "payroll_head", "payroll_admin"), h(async (req: any, res: any) => {
  const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ success: false, error: "month must be YYYY-MM" });
  }
  const monthStart = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const monthEnd = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;

  const scoped = await buildScopeWhereClause(
    req.authUser!.id,
    ["hr", "manager"],
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
    conds.push("(e.full_name LIKE ? OR e.employee_code LIKE ? OR e.official_email LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (scoped.sql && scoped.sql !== "1=1") {
    conds.push(`(${scoped.sql.replace(/^WHERE\s+/i, "").trim()})`);
    params.push(...(scoped.params ?? []));
  }
  const where = `WHERE ${conds.join(" AND ")}`;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code,
            CONCAT(COALESCE(e.first_name,''), ' ', COALESCE(e.last_name,'')) AS full_name,
            e.employment_status, e.date_of_joining,
            bm.branch_name, pm.process_name, dm.designation_name, dept.dept_name,
            (SELECT COUNT(*) FROM attendance_daily_record adr
               WHERE adr.employee_id = e.id
                 AND adr.record_date BETWEEN ? AND ?
                 AND adr.attendance_status = 'present') AS present_days,
            (SELECT COALESCE(SUM(adr2.lwp_value),0) FROM attendance_daily_record adr2
               WHERE adr2.employee_id = e.id
                 AND adr2.record_date BETWEEN ? AND ?
                 AND adr2.attendance_status NOT IN ('week_off','holiday','leave_approved')) AS lwp_days,
            (SELECT COALESCE(SUM(adr3.late_mark),0) FROM attendance_daily_record adr3
               WHERE adr3.employee_id = e.id
                 AND adr3.record_date BETWEEN ? AND ?) AS late_marks,
            (SELECT COUNT(*) FROM attendance_daily_record adr4
               WHERE adr4.employee_id = e.id
                 AND adr4.record_date BETWEEN ? AND ?
                 AND adr4.attendance_status = 'missing_punch') AS missing_punch_count,
            (SELECT spl.net_salary FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
               WHERE spl.employee_id = e.id
               ORDER BY spr.run_month DESC LIMIT 1) AS last_salary_net,
            (SELECT spr2.run_month FROM salary_prep_line spl2
               JOIN salary_prep_run spr2 ON spr2.id = spl2.run_id
               WHERE spl2.employee_id = e.id
               ORDER BY spr2.run_month DESC LIMIT 1) AS last_salary_month
       FROM employees e
       LEFT JOIN branch_master bm       ON bm.id   = e.branch_id
       LEFT JOIN process_master pm      ON pm.id   = e.process_id
       LEFT JOIN designation_master dm  ON dm.id   = e.designation_id
       LEFT JOIN department_master dept ON dept.id = e.department_id
       ${where}
       ${anomalyOnly ? "HAVING lwp_days > 2 OR missing_punch_count > 0" : ""}
       ORDER BY e.employee_code ASC
       LIMIT ${limit} OFFSET ${offset}`,
    // month dates first (8 params for the 4 subqueries), then WHERE filter params
    [monthStart, monthEnd, monthStart, monthEnd, monthStart, monthEnd, monthStart, monthEnd, ...params]
  );

  const countQuery = anomalyOnly
    ? `SELECT COUNT(*) AS total FROM (
         SELECT e.id,
           (SELECT COALESCE(SUM(adr2.lwp_value),0) FROM attendance_daily_record adr2
              WHERE adr2.employee_id = e.id
                AND adr2.record_date BETWEEN ? AND ?
                AND adr2.attendance_status NOT IN ('week_off','holiday','leave_approved')) AS lwp_days,
           (SELECT COUNT(*) FROM attendance_daily_record adr4
              WHERE adr4.employee_id = e.id
                AND adr4.record_date BETWEEN ? AND ?
                AND adr4.attendance_status = 'missing_punch') AS missing_punch_count
         FROM employees e ${where}
         HAVING lwp_days > 2 OR missing_punch_count > 0
       ) AS anomaly_count`
    : `SELECT COUNT(*) AS total FROM employees e ${where}`;

  const countParams = anomalyOnly
    ? [monthStart, monthEnd, monthStart, monthEnd, ...params]
    : params;

  const [countRows] = await db.execute<RowDataPacket[]>(countQuery, countParams);

  const data = (rows as any[]).map((r: any) => ({
    ...r,
    has_anomaly: Number(r.lwp_days) > 2 || Number(r.missing_punch_count) > 0,
  }));

  return res.json({ success: true, data, total: Number((countRows as any[])[0]?.total ?? 0), page, limit });
}));

router.get("/", requireRole("super_admin", "admin", "hr", "manager", "ceo"), h(async (req, res) => {
  const scoped = await buildScopeWhereClause(
    req.authUser!.id,
    ["hr", "manager"],
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
router.get("/:id", requireRole("super_admin", "admin", "hr", "manager"), h(c.getEmployee));
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
router.get("/:id/stat-card", requireAuth, h(async (req: any, res: any) => {
  const { db } = await import("../../db/mysql.js");
  const targetId = req.params.id;
  const selfEmp = await getEmployeeForUser(req.authUser!.id);

  // Check if requesting own stat card
  if (selfEmp?.id === targetId) {
    // Always allowed
  } else {
    // Requesting someone else's card — check role + scope
    const isSuperAdmin = await hasRole(req.authUser!.id, "super_admin");
    const isPayroll = await hasRole(req.authUser!.id, "payroll_head", "payroll");
    const isCEO = await hasRole(req.authUser!.id, "ceo");
    const isAdmin = await hasRole(req.authUser!.id, "admin");
    const isHR = await hasRole(req.authUser!.id, "hr");
    const isBranchHead = await hasRole(req.authUser!.id, "branch_head");
    const isManager = await hasRole(req.authUser!.id, "manager");

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
            b.address AS branch_address, b.city AS branch_city, b.state AS branch_state, b.hr_contact AS branch_hr_contact,
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
         SUM(CASE WHEN status IN ('pending_hr_upload','pending_candidate_esign','pending_generation','rejected') AND mandatory = 1 THEN 1 ELSE 0 END) AS checklist_missing,
         SUM(CASE WHEN status IN ('uploaded','submitted','pending_verification','signed') THEN 1 ELSE 0 END) AS checklist_awaiting,
         SUM(CASE WHEN status IN ('verified','signed_verified','completed') THEN 1 ELSE 0 END) AS checklist_verified
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
      `SELECT ets.tier_name, ets.total_points
         FROM employee_tier_status ets
        WHERE ets.employee_id = ? LIMIT 1`,
      [targetId]
    );
    gamificationTier = tierRows[0] ?? null;
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
      gamification_tier: gamificationTier,
      journey,
    }
  });
}));

export { router as employeeRouter };
