/**
 * Field-level projection policy for employee and candidate resources.
 * Returns the set of fields a given role may receive.
 *
 * Convention:
 *  - ALLOWED: field is returned as-is
 *  - MASKED:  field is returned but masked (see privacyMasking.service.ts)
 *  - absent:  field is not returned at all
 */

export type FieldPolicy = "allow" | "mask" | "deny";

export interface ProjectionPolicy {
  role: string;
  resource: "employee" | "candidate";
  fields: Record<string, FieldPolicy>;
}

const SENSITIVE_FIELDS = [
  "pan_number", "pan_number_encrypted",
  "aadhaar_number", "aadhaar_last4",
  "bank_account_no", "bank_account_number",
  "ifsc_code",
  "uan", "pf_number", "esic_number",
  "passport_number",
  "salary", "gross_salary", "net_salary", "ctc",
  "personal_email", "personal_phone", "alternate_mobile",
  "address_line1", "address_line2",
  "emergency_contact_name", "emergency_contact_phone",
  "nominee_name", "nominee_phone",
  "medical_info",
] as const;

// Fields every role can see for any employee in their scope
const BASE_EMPLOYEE_FIELDS: Record<string, FieldPolicy> = {
  id: "allow",
  employee_code: "allow",
  full_name: "allow",
  designation: "allow",
  department: "allow",
  branch_id: "allow",
  process_id: "allow",
  employment_type: "allow",
  employment_status: "allow",
  date_of_joining: "allow",
};

// Field policy by role — only lists exceptions from BASE; unlisted fields default to "deny"
const EMPLOYEE_POLICY: Record<string, Record<string, FieldPolicy>> = {
  employee_self: {
    ...BASE_EMPLOYEE_FIELDS,
    personal_email: "allow",
    personal_phone: "allow",
    alternate_mobile: "allow",
    address_line1: "allow",
    address_line2: "allow",
    pan_number: "mask",
    aadhaar_last4: "allow",
    uan: "mask",
    pf_number: "mask",
    bank_account_no: "mask",
    ifsc_code: "allow",
    emergency_contact_name: "allow",
    emergency_contact_phone: "mask",
    nominee_name: "allow",
    date_of_birth: "allow",
    gender: "allow",
    official_email: "allow",
    reporting_manager_id: "allow",
  },
  team_leader: {
    ...BASE_EMPLOYEE_FIELDS,
    official_email: "allow",
    reporting_manager_id: "allow",
    // NO: pan, aadhaar, bank, salary, emergency address
  },
  manager: {
    ...BASE_EMPLOYEE_FIELDS,
    official_email: "allow",
    reporting_manager_id: "allow",
    date_of_birth: "mask",
    // NO: pan, aadhaar, bank, salary, emergency address
  },
  hr: {
    ...BASE_EMPLOYEE_FIELDS,
    personal_email: "allow",
    personal_phone: "allow",
    alternate_mobile: "allow",
    official_email: "allow",
    date_of_birth: "allow",
    gender: "allow",
    nationality: "allow",
    address_line1: "allow",
    pan_number: "mask",
    aadhaar_last4: "allow",
    reporting_manager_id: "allow",
    emergency_contact_name: "allow",
    emergency_contact_phone: "allow",
  },
  payroll: {
    ...BASE_EMPLOYEE_FIELDS,
    official_email: "allow",
    pan_number: "allow",    // payroll legitimately needs raw PAN for statutory filing
    aadhaar_last4: "allow",
    uan: "allow",
    pf_number: "allow",
    esic_number: "allow",
    bank_account_no: "allow",
    ifsc_code: "allow",
    salary: "allow",
    gross_salary: "allow",
    net_salary: "allow",
    ctc: "allow",
    date_of_birth: "allow",
    // NO: medical, nominee personal contact, emergency personal address
  },
  recruiter: {
    ...BASE_EMPLOYEE_FIELDS,
    official_email: "allow",
    // NO: payroll, pan, aadhaar, bank
  },
  dpo: {
    ...BASE_EMPLOYEE_FIELDS,
    // DPO can access privacy metadata but not raw payroll data by default
    personal_email: "mask",
    official_email: "allow",
    pan_number: "mask",
    aadhaar_last4: "allow",
  },
  admin: {
    ...BASE_EMPLOYEE_FIELDS,
    personal_email: "allow",
    personal_phone: "allow",
    official_email: "allow",
    pan_number: "mask",
    aadhaar_last4: "allow",
    bank_account_no: "mask",
    ifsc_code: "allow",
    date_of_birth: "allow",
    gender: "allow",
  },
  super_admin: {
    // Super admin sees everything — break-glass; every access is audited
    ...BASE_EMPLOYEE_FIELDS,
    personal_email: "allow",
    personal_phone: "allow",
    alternate_mobile: "allow",
    official_email: "allow",
    date_of_birth: "allow",
    gender: "allow",
    pan_number: "allow",
    aadhaar_last4: "allow",
    uan: "allow",
    pf_number: "allow",
    bank_account_no: "allow",
    ifsc_code: "allow",
    salary: "allow",
    gross_salary: "allow",
    net_salary: "allow",
    ctc: "allow",
    address_line1: "allow",
    emergency_contact_name: "allow",
    emergency_contact_phone: "allow",
    nominee_name: "allow",
  },
};

export function getProjectionForRole(
  role: string,
  resource: "employee" | "candidate",
  isSelf = false
): Record<string, FieldPolicy> {
  if (resource === "employee") {
    const effectiveRole = isSelf ? "employee_self" : (role in EMPLOYEE_POLICY ? role : "hr");
    return EMPLOYEE_POLICY[effectiveRole] ?? BASE_EMPLOYEE_FIELDS;
  }
  // Candidate projection — simpler; recruiter and HR see most fields
  return BASE_EMPLOYEE_FIELDS;
}

/**
 * Filter a record object to only the fields allowed for a role.
 * Masked fields are returned as-is (caller should run through privacyMasking).
 * Denied fields are omitted.
 */
export function projectRecord(
  record: Record<string, unknown>,
  policy: Record<string, FieldPolicy>
): { allowed: Record<string, unknown>; toMask: string[] } {
  const allowed: Record<string, unknown> = {};
  const toMask: string[] = [];

  for (const [key, value] of Object.entries(record)) {
    const fieldPolicy = policy[key];
    if (!fieldPolicy || fieldPolicy === "deny") continue;
    allowed[key] = value;
    if (fieldPolicy === "mask") toMask.push(key);
  }

  return { allowed, toMask };
}

export { SENSITIVE_FIELDS };
