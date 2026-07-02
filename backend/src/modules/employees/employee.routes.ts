import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireScopedRole } from "../../middleware/scopeMiddleware.js";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { db } from "../../db/mysql.js";
import { employeeController as c } from "./employee.controller.js";
import { appendJourneyEvent, listJourneyEvents, listComprehensiveJourney } from "./journeyLog.service.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { profileApprovalService } from "./profile-approval.service.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// GET /api/employees/me — returns the employee record for the logged-in user with nested details
router.get("/me", h(async (req: any, res: any) => {
  const userId = req.authUser?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  const [rows] = await db.execute(
    `SELECT e.*,
            d.designation_name  AS designation,
            dept.dept_name      AS department_name,
            b.branch_name,
            b.branch_name       AS branch_display_name,
            CONCAT(mgr.first_name, ' ', mgr.last_name) AS reporting_manager_name
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
      ...emp,
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

// GET /api/employees/stats — aggregate counts (must be before /:id to avoid route collision)
router.get("/stats", requireRole("admin", "hr", "manager", "ceo"), h(async (_req: any, res: any) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total_employees,
       COUNT(CASE WHEN employment_status = 'active' THEN 1 END) AS active_employees,
       COUNT(CASE WHEN DATEDIFF(NOW(), date_of_joining) <= 90 THEN 1 END) AS new_joiners_90d
     FROM employees WHERE active_status = 1`
  );
  res.json({ data: rows[0] });
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
  const isAdminOrHR = await hasRole(req.authUser!.id, "admin", "hr", "ceo");
  const selfEmp = await getEmployeeForUser(req.authUser!.id);

  // Access check: admin/hr/ceo can view all; others can only view own
  if (!isAdminOrHR && selfEmp?.id !== targetId) {
    return res.status(403).json({ error: "Access denied" });
  }

  // Core employee with joined master data
  const [[emp]] = await db.execute<RowDataPacket[]>(
    `SELECT e.*, CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS full_name,
            d.designation_name, b.branch_name, b.call_centre_code,
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
         ON eec.employee_id = e.id AND eec.contact_seq = 1
      WHERE e.id = ? LIMIT 1`,
    [targetId]
  );
  if (!emp) return res.status(404).json({ error: "Employee not found" });

  // Leave balances (all types for current year)
  let leaveBalances: RowDataPacket[] = [];
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT lbl.leave_code, lt.leave_name,
              lbl.opening_balance + lbl.accrued_days - lbl.used_days AS available_days,
              lbl.used_days
         FROM leave_balance_ledger lbl
         LEFT JOIN leave_type_master lt ON lt.leave_code = lbl.leave_code
        WHERE lbl.employee_id = ? AND YEAR(lbl.valid_for) = YEAR(NOW())`,
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
         JOIN performance_feedback_request pfq ON pfq.request_id = pfr.request_id
         JOIN performance_feedback_cycle pfc ON pfc.cycle_id = pfq.cycle_id
        WHERE pfq.employee_id = ?
        ORDER BY pfr.created_at DESC LIMIT 1`,
      [targetId]
    );
    performance = perfRows[0] ?? null;
  } catch (_e) { /* table may not exist yet */ }

  // Active assets
  let activeAssets = 0;
  try {
    const [assetRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS active_assets FROM asset_assignment WHERE employee_id = ? AND return_date IS NULL`,
      [targetId]
    );
    activeAssets = Number(assetRows[0]?.active_assets ?? 0);
  } catch (_e) { /* table may not exist yet */ }

  // Pending documents
  let pendingDocs = 0;
  try {
    const [docRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS pending_docs FROM employee_documents WHERE employee_id = ? AND verified = 0`,
      [targetId]
    );
    pendingDocs = Number(docRows[0]?.pending_docs ?? 0);
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
      pending_docs: pendingDocs,
      gamification_tier: gamificationTier,
      journey,
    }
  });
}));

export { router as employeeRouter };
