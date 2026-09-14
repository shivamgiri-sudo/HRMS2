/**
 * Employee Profile field ownership — the single source of truth.
 *
 * Before this file, "who can edit which field" was decided ad hoc, differently, in at
 * least three places that disagreed with each other: the live self-service allowlist
 * (employee.routes.ts), and two dead ones (employee.controller.ts's updateMyProfile,
 * employee.profile.service.ts) — all three now deleted or reconciled against this file.
 * See fieldOwnershipMatrix.test.ts's "matches the live ALLOWED_FIELDS" assertion for how
 * this stays load-bearing rather than becoming a fourth list that drifts on its own.
 *
 * OWNERSHIP MODEL
 *   employeeEditable   — the employee can change it directly via PATCH /me or the /me/*
 *                         sub-resource routes (emergency contact, nominee), no approval.
 *   hrEditable         — HR/admin can change it directly via PATCH /:id or the
 *                         :employeeId/* HR-entry routes, no approval.
 *   approvalRequired   — an employee-submitted change is not applied directly; it is
 *                         routed to profile_update_approval and only takes effect once
 *                         reviewed (payroll for bank_details, HR for statutory_details).
 *   immutable          — no route accepts a direct write to this field at all today
 *                         (employee_code is a notable case: accepted by the update schema
 *                         and validated, but employee.service.ts never reads it into a SET
 *                         clause — a silent no-op, not a 403 or a validation error).
 *
 * A field can be both hrEditable and approvalRequired when the two audiences differ:
 * bank/statutory fields are approval-gated for the employee but directly editable by HR
 * (PUT /:employeeId/bank-details, PUT /:employeeId/statutory-details — "HR entry for a
 * manually-onboarded employee", a deliberate bypass, not an oversight).
 */

export type ProfileTab = "personal" | "employment" | "identity" | "bank" | "documents";

export interface FieldOwnership {
  tab: ProfileTab;
  employeeEditable: boolean;
  hrEditable: boolean;
  approvalRequired: boolean;
  immutable: boolean;
  /** The route(s) that actually enforce this — not aspirational, what's live today. */
  liveRoute: string;
  /**
   * The real `employees` column this field writes to, when it differs from the object key
   * (the wire/request-body field name). Omit when they're the same. Only needed for
   * address_line1 today — see its notes.
   */
  dbColumn?: string;
  notes?: string;
}

export const FIELD_OWNERSHIP: Record<string, FieldOwnership> = {
  // ── Personal ──────────────────────────────────────────────────────────────
  first_name: {
    tab: "personal", employeeEditable: false, hrEditable: true,
    approvalRequired: false, immutable: false,
    liveRoute: "PATCH /:id",
  },
  last_name: {
    tab: "personal", employeeEditable: false, hrEditable: true,
    approvalRequired: false, immutable: false,
    liveRoute: "PATCH /:id",
  },
  mobile: {
    tab: "personal", employeeEditable: true, hrEditable: true,
    approvalRequired: false, immutable: false,
    liveRoute: "PATCH /me, PATCH /:id",
  },
  personal_email: {
    tab: "personal", employeeEditable: true, hrEditable: true,
    approvalRequired: false, immutable: false,
    liveRoute: "PATCH /me, PATCH /:id",
  },
  personal_phone: {
    tab: "personal", employeeEditable: true, hrEditable: true,
    approvalRequired: false, immutable: false,
    liveRoute: "PATCH /me, PATCH /:id",
  },
  alternate_mobile: {
    tab: "personal", employeeEditable: true, hrEditable: false,
    approvalRequired: false, immutable: false,
    liveRoute: "PATCH /me",
  },
  address_line1: {
    tab: "personal", employeeEditable: true, hrEditable: true,
    approvalRequired: false, immutable: false,
    liveRoute: "PATCH /me, PATCH /:id",
    dbColumn: "address1",
    notes: "Live-schema check done 2026-08-13 (was previously just flagged): address1 is " +
      "the real, populated column (30,120 of 58,840 rows) — used by admin PATCH /:id, " +
      "onboarding creation and every document/form-fill path. address_line1 is a near-empty " +
      "column (2 of 58,840 rows) that only GET/PATCH /me ever touched, so an employee's own " +
      "Profile page showed a blank address for ~99.99% of accounts, and any self-service " +
      "address edit silently landed in a column nothing else reads — invisible to HR, ID " +
      "cards and offer letters, which all read address1. GET/PATCH /me now read and write " +
      "address1 too, keeping address_line1 only as the wire field name (Profile.tsx's " +
      "contract), not the storage column — see dbColumn.",
  },
  address_line2: {
    tab: "personal", employeeEditable: true, hrEditable: false,
    approvalRequired: false, immutable: false,
    liveRoute: "PATCH /me",
  },
  city: {
    tab: "personal", employeeEditable: true, hrEditable: true,
    approvalRequired: false, immutable: false,
    liveRoute: "PATCH /me, PATCH /:id",
  },
  state: {
    tab: "personal", employeeEditable: true, hrEditable: false,
    approvalRequired: false, immutable: false,
    liveRoute: "PATCH /me",
  },
  pincode: {
    tab: "personal", employeeEditable: true, hrEditable: false,
    approvalRequired: false, immutable: false,
    liveRoute: "PATCH /me",
  },
  date_of_birth: {
    tab: "personal", employeeEditable: true, hrEditable: true,
    approvalRequired: false, immutable: false,
    liveRoute: "PATCH /me, PATCH /:id",
  },
  gender: {
    tab: "personal", employeeEditable: true, hrEditable: true,
    approvalRequired: false, immutable: false,
    liveRoute: "PATCH /me, PATCH /:id",
  },
  marital_status: {
    tab: "personal", employeeEditable: true, hrEditable: false,
    approvalRequired: false, immutable: false,
    liveRoute: "PATCH /me",
    notes: "Not in employee.validation.ts's updateEmployeeSchema — HR cannot set this via PATCH /:id.",
  },
  blood_group: {
    tab: "personal", employeeEditable: true, hrEditable: true,
    approvalRequired: false, immutable: false,
    liveRoute: "PATCH /me, PATCH /:id",
    notes: "Self-edit-only until 2026-09-03, which is why 448 of 1,028 active employees " +
      "reached their ID card with a blank Blood Group and HR had no field to fill it in. " +
      "Now in updateEmployeeSchema as `bloodGroup`, restricted to the eight canonical " +
      "groups; both routes normalise through bloodGroup.util.ts, so the legacy free-text " +
      "values ('NA', 'B+ve', 'O +') cannot be written back.",
  },
  official_email: {
    tab: "personal", employeeEditable: false, hrEditable: true,
    approvalRequired: false, immutable: false,
    liveRoute: "PATCH /:id",
    notes: "The canonical login identity. PATCH /me explicitly rejects this key with a 403 " +
      "regardless of value — 'Contact HR.' HR/admin edits also sync auth_user.email.",
  },
  working_hours_start: {
    tab: "personal", employeeEditable: true, hrEditable: false,
    approvalRequired: false, immutable: false,
    liveRoute: "PATCH /me",
  },
  working_hours_end: {
    tab: "personal", employeeEditable: true, hrEditable: false,
    approvalRequired: false, immutable: false,
    liveRoute: "PATCH /me",
  },
  working_days: {
    tab: "personal", employeeEditable: true, hrEditable: false,
    approvalRequired: false, immutable: false,
    liveRoute: "PATCH /me",
  },
  emergency_contact: {
    tab: "personal", employeeEditable: true, hrEditable: true,
    approvalRequired: false, immutable: false,
    liveRoute: "PUT /me/emergency-contact, PUT /:employeeId/emergency-contact",
  },
  nominee: {
    tab: "personal", employeeEditable: true, hrEditable: true,
    approvalRequired: false, immutable: false,
    liveRoute: "PUT /me/nominee, PUT /:employeeId/nominee",
    notes: "Determines who a death-benefit payout goes to.",
  },

  // ── Employment ────────────────────────────────────────────────────────────
  employee_code: {
    tab: "employment", employeeEditable: false, hrEditable: false,
    approvalRequired: false, immutable: true,
    liveRoute: "n/a",
    notes: "Accepted by updateEmployeeSchema and validated, but employee.service.ts never " +
      "reads input.employeeCode into a SET clause — a submitted change is silently dropped, " +
      "not rejected. Immutable in practice, not by an explicit guard.",
  },
  date_of_joining: {
    tab: "employment", employeeEditable: false, hrEditable: true,
    approvalRequired: false, immutable: false,
    liveRoute: "PATCH /:id",
    notes: "Feeds payroll/tenure calculations elsewhere. Now audited (was previously outside SENSITIVE_FIELDS).",
  },
  department_id: {
    tab: "employment", employeeEditable: false, hrEditable: true,
    approvalRequired: false, immutable: false,
    liveRoute: "PATCH /:id",
  },
  designation_id: {
    tab: "employment", employeeEditable: false, hrEditable: true,
    approvalRequired: false, immutable: false,
    liveRoute: "PATCH /:id",
  },
  process_id: {
    tab: "employment", employeeEditable: false, hrEditable: true,
    approvalRequired: false, immutable: false,
    liveRoute: "PATCH /:id",
  },
  branch_id: {
    tab: "employment", employeeEditable: false, hrEditable: true,
    approvalRequired: false, immutable: false,
    liveRoute: "PATCH /:id",
  },
  reporting_manager_id: {
    tab: "employment", employeeEditable: false, hrEditable: true,
    approvalRequired: true, immutable: false,
    liveRoute: "POST /api/rm-change (submit), POST /api/rm-change/:id/action (review); PATCH /:id (direct, HR)",
    notes: "The one pending-approval workflow in this module that was already fully wired " +
      "end to end before this engagement — used as the reference pattern for the statutory-" +
      "details reviewer added alongside this file.",
  },
  employment_status: {
    tab: "employment", employeeEditable: false, hrEditable: true,
    approvalRequired: false, immutable: false,
    liveRoute: "PATCH /:id (Active/Inactive/On Notice/Onboarding only); exit flow (Terminated/Absconded)",
    notes: "updateEmployeeSchema's enum deliberately excludes Terminated/Absconded — those " +
      "only reach employment_status through the dedicated exit module, never a profile edit. " +
      "Reactivation (Inactive -> Active) is also refused here; it requires " +
      "Employees -> Reactivation, a separate approved flow.",
  },

  // ── Identity ──────────────────────────────────────────────────────────────
  pan_number: {
    tab: "identity", employeeEditable: false, hrEditable: true,
    approvalRequired: true, immutable: false,
    liveRoute: "PUT /me/statutory-details (submit) -> PATCH /api/statutory-change-requests/:id (review); PUT /:employeeId/statutory-details (direct, HR)",
    notes: "Format-validated on every write path (statutoryFormat.ts). Dual-write: plaintext " +
      "+ pan_number_encrypted + pan_blind_index on the HR-entry and approval-apply paths.",
  },
  aadhaar_id: {
    tab: "identity", employeeEditable: false, hrEditable: true,
    approvalRequired: true, immutable: false,
    liveRoute: "PUT /me/statutory-details (submit) -> PATCH /api/statutory-change-requests/:id (review); PUT /:employeeId/statutory-details (direct, HR)",
    notes: "Format-validated (12 digits). No encrypted sibling column exists for this field.",
  },
  uan_number: {
    tab: "identity", employeeEditable: false, hrEditable: true,
    approvalRequired: true, immutable: false,
    liveRoute: "PUT /me/statutory-details (submit) -> PATCH /api/statutory-change-requests/:id (review); PUT /:employeeId/statutory-details (direct, HR)",
    notes: "Format-validated (12 digits). No encrypted sibling column exists for this field.",
  },
  esi_number: {
    tab: "identity", employeeEditable: false, hrEditable: true,
    approvalRequired: true, immutable: false,
    liveRoute: "PUT /me/statutory-details (submit) -> PATCH /api/statutory-change-requests/:id (review); PUT /:employeeId/statutory-details (direct, HR)",
    notes: "Format-validated (17 digits). No encrypted sibling column exists for this field.",
  },
  epf_number: {
    tab: "identity", employeeEditable: false, hrEditable: true,
    approvalRequired: true, immutable: false,
    liveRoute: "PUT /me/statutory-details (submit) -> PATCH /api/statutory-change-requests/:id (review); PUT /:employeeId/statutory-details (direct, HR)",
    notes: "Format-validated (<=40 chars, no fixed pattern — PF member number formats vary by state/establishment).",
  },

  // ── Bank ──────────────────────────────────────────────────────────────────
  bank_name: {
    tab: "bank", employeeEditable: false, hrEditable: true,
    approvalRequired: true, immutable: false,
    liveRoute: "POST /me/bank-change-request (submit) -> PATCH /api/payroll/bank-change-requests/:id (review, Payroll HO); PUT /:employeeId/bank-details (direct, HR)",
  },
  account_holder_name: {
    tab: "bank", employeeEditable: false, hrEditable: true,
    approvalRequired: true, immutable: false,
    liveRoute: "POST /me/bank-change-request (submit) -> PATCH /api/payroll/bank-change-requests/:id (review, Payroll HO); PUT /:employeeId/bank-details (direct, HR)",
  },
  ifsc_code: {
    tab: "bank", employeeEditable: false, hrEditable: true,
    approvalRequired: true, immutable: false,
    liveRoute: "POST /me/bank-change-request (submit) -> PATCH /api/payroll/bank-change-requests/:id (review, Payroll HO); PUT /:employeeId/bank-details (direct, HR)",
    notes: "Format-validated + uppercased on every write path (statutoryFormat.ts).",
  },
  account_number: {
    tab: "bank", employeeEditable: false, hrEditable: true,
    approvalRequired: true, immutable: false,
    liveRoute: "POST /me/bank-change-request (submit) -> PATCH /api/payroll/bank-change-requests/:id (review, Payroll HO); PUT /:employeeId/bank-details (direct, HR)",
    notes: "AES-256-GCM encrypted at rest (account_number_enc), random IV per write. " +
      "Cross-employee duplicate check drafted but not yet active — see bankAccountDuplicate.ts.",
  },
  primary_account_flag: {
    tab: "bank", employeeEditable: false, hrEditable: false,
    approvalRequired: false, immutable: false,
    liveRoute: "n/a (system-managed)",
    notes: "Set automatically on approval — the newly-approved account becomes primary and " +
      "the prior one is archived (is_primary=0, active_status=0). No direct write path.",
  },

  // ── Documents ─────────────────────────────────────────────────────────────
  document_upload: {
    tab: "documents", employeeEditable: true, hrEditable: true,
    approvalRequired: false, immutable: false,
    liveRoute: "POST /api/employee-docs/:employeeId/upload",
    notes: "Uploads land as verified=0 (pending). Registered in document_vault_inventory " +
      "(access_level 'pii') as of this engagement — previously unregistered uploads could " +
      "not be viewed or downloaded by anyone, including the uploader.",
  },
  document_verification_status: {
    tab: "documents", employeeEditable: false, hrEditable: true,
    approvalRequired: false, immutable: false,
    liveRoute: "PATCH /api/employee-docs/:employeeId/:docId/verify",
    notes: "HR/admin only — verified/rejected, with remarks.",
  },
};

// Keys in FIELD_OWNERSHIP that don't map 1:1 onto an `employees` table column — they're
// composite (a whole sub-resource, e.g. emergency contact/nominee live in their own tables)
// or represent a state the app manages rather than a field a request body sets directly.
// Excluded from SELF_EDITABLE_PERSONAL_COLUMNS below for that reason, not because they're
// any less real.
const NON_COLUMN_FIELDS = new Set([
  "emergency_contact", "nominee", "primary_account_flag",
  "document_upload", "document_verification_status",
]);

/**
 * The exact set of request-body field names PATCH /me (employee.routes.ts) is allowed to
 * write — derived from this matrix rather than hand-maintained a second time, so the
 * route's allowlist and this file's employeeEditable flags cannot silently drift apart
 * again. Almost every entry is also the literal `employees` column name; where the wire
 * name and the real column differ (address_line1 → address1), use dbColumnFor() below to
 * get the column PATCH /me should actually write and GET /me should actually read.
 */
export const SELF_EDITABLE_PERSONAL_COLUMNS: string[] = Object.entries(FIELD_OWNERSHIP)
  .filter(([key, f]) => f.tab === "personal" && f.employeeEditable && !NON_COLUMN_FIELDS.has(key))
  .map(([key]) => key);

/** The real `employees` column a self-editable field name writes to. Same as `field` unless FIELD_OWNERSHIP declares a dbColumn override. */
export function dbColumnFor(field: string): string {
  return FIELD_OWNERSHIP[field]?.dbColumn ?? field;
}
