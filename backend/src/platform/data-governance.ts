/**
 * PeopleOS Data Governance Register
 *
 * Canonical source-of-truth declarations for every data domain in the platform.
 * This file is the authoritative reference for:
 *
 * - Which system owns each data domain
 * - Whether HRMS reads or writes to a given domain
 * - Data sensitivity classification
 * - Retention and audit requirements
 * - Sync/integration patterns for upstream sources
 *
 * Schema: update this whenever a new integration or domain is added.
 * CI test: data-governance.test.ts enforces structural invariants.
 */

export const DATA_OWNER = {
  HRMS_MYSQL:     "hrms_mysql",       // mas_hrms MySQL — writable by PeopleOS
  LMS_EXTERNAL:   "lms_external",     // Deployed internal LMS — read-only from PeopleOS
  CALL_MASTER:    "call_master",      // Call Master upstream — read-only from PeopleOS
  COSEC:          "cosec",            // COSEC biometric system — read-only sync
  DIALER:         "dialer",           // Auto-dialer / telephony system
  FILESYSTEM:     "filesystem",       // Local uploads directory
} as const;
export type DataOwner = typeof DATA_OWNER[keyof typeof DATA_OWNER];

export const ACCESS_PATTERN = {
  READ_WRITE:       "rw",   // HRMS is the system of record; full CRUD
  READ_ONLY:        "ro",   // HRMS reads from upstream; never writes back
  WRITE_ONLY:       "wo",   // HRMS writes outbound (webhooks, exports)
  SYNC_SNAPSHOT:    "sync", // Periodic snapshot into mas_hrms read cache
  INTEGRATION_ONLY: "int",  // Integration scaffolding only; upstream is SoR
} as const;
export type AccessPattern = typeof ACCESS_PATTERN[keyof typeof ACCESS_PATTERN];

export const RETENTION_CLASS = {
  PERMANENT:        "permanent",   // Never auto-deleted (payroll, PF, legal)
  LONG_TERM:        "long_term",   // 7+ years (statutory requirements)
  MEDIUM_TERM:      "medium_term", // 3–7 years (HR operational)
  SHORT_TERM:       "short_term",  // < 3 years (operational/transactional)
  SESSION:          "session",     // Cleared on session end (temp tokens, OTP)
} as const;
export type RetentionClass = typeof RETENTION_CLASS[keyof typeof RETENTION_CLASS];

export interface DataDomain {
  domain_code:        string;
  domain_name:        string;
  data_owner:         DataOwner;
  access_pattern:     AccessPattern;
  sensitivity:        "public" | "internal" | "pii" | "payroll" | "sensitive";
  retention:          RetentionClass;
  audit_required:     boolean;
  pii_contains:       boolean;
  payroll_contains:   boolean;
  integration_notes?: string;
  tables:             string[];   // key mas_hrms tables (or upstream table names for sync)
}

export const DATA_GOVERNANCE_REGISTER: DataDomain[] = [
  // ── Employee & HR ────────────────────────────────────────────────────────────
  {
    domain_code:   "EMPLOYEE_MASTER",
    domain_name:   "Employee Master",
    data_owner:    DATA_OWNER.HRMS_MYSQL,
    access_pattern: ACCESS_PATTERN.READ_WRITE,
    sensitivity:   "pii",
    retention:     RETENTION_CLASS.PERMANENT,
    audit_required: true,
    pii_contains:  true,
    payroll_contains: false,
    tables: ["employees", "employee_profiles", "employee_documents", "user_master"],
  },
  {
    domain_code:   "ATS_CANDIDATE",
    domain_name:   "ATS Candidate",
    data_owner:    DATA_OWNER.HRMS_MYSQL,
    access_pattern: ACCESS_PATTERN.READ_WRITE,
    sensitivity:   "pii",
    retention:     RETENTION_CLASS.MEDIUM_TERM,
    audit_required: true,
    pii_contains:  true,
    payroll_contains: false,
    tables: ["ats_candidates", "ats_hiring_entry", "ats_bgv_records", "ats_candidate_documents"],
  },
  // ── Attendance & WFM ─────────────────────────────────────────────────────────
  {
    domain_code:   "ATTENDANCE",
    domain_name:   "Attendance Records",
    data_owner:    DATA_OWNER.HRMS_MYSQL,
    access_pattern: ACCESS_PATTERN.READ_WRITE,
    sensitivity:   "internal",
    retention:     RETENTION_CLASS.LONG_TERM,
    audit_required: true,
    pii_contains:  false,
    payroll_contains: false,
    tables: ["attendance_records", "attendance_regularizations", "daily_attendance"],
  },
  {
    domain_code:   "COSEC_BIOMETRIC",
    domain_name:   "COSEC Biometric Sync",
    data_owner:    DATA_OWNER.COSEC,
    access_pattern: ACCESS_PATTERN.SYNC_SNAPSHOT,
    sensitivity:   "internal",
    retention:     RETENTION_CLASS.MEDIUM_TERM,
    audit_required: true,
    pii_contains:  false,
    payroll_contains: false,
    integration_notes: "Read-only sync from COSEC hardware. PeopleOS stores snapshots in ncosec_* tables. No writeback to COSEC.",
    tables: ["ncosec_attendance", "ncosec_sync_log"],
  },
  {
    domain_code:   "WFM_ROSTER",
    domain_name:   "WFM Roster",
    data_owner:    DATA_OWNER.HRMS_MYSQL,
    access_pattern: ACCESS_PATTERN.READ_WRITE,
    sensitivity:   "internal",
    retention:     RETENTION_CLASS.LONG_TERM,
    audit_required: true,
    pii_contains:  false,
    payroll_contains: false,
    tables: ["roster_entries", "roster_master", "wfm_shift_assignments"],
  },
  // ── Leave ────────────────────────────────────────────────────────────────────
  {
    domain_code:   "LEAVE",
    domain_name:   "Leave Management",
    data_owner:    DATA_OWNER.HRMS_MYSQL,
    access_pattern: ACCESS_PATTERN.READ_WRITE,
    sensitivity:   "internal",
    retention:     RETENTION_CLASS.LONG_TERM,
    audit_required: true,
    pii_contains:  false,
    payroll_contains: false,
    tables: ["leave_requests", "leave_balances", "leave_types"],
  },
  // ── Payroll ──────────────────────────────────────────────────────────────────
  {
    domain_code:   "PAYROLL_SALARY",
    domain_name:   "Payroll & Salary",
    data_owner:    DATA_OWNER.HRMS_MYSQL,
    access_pattern: ACCESS_PATTERN.READ_WRITE,
    sensitivity:   "payroll",
    retention:     RETENTION_CLASS.PERMANENT,
    audit_required: true,
    pii_contains:  true,
    payroll_contains: true,
    integration_notes: "NEVER exposed via Client Portal or any non-payroll endpoint. PAYROLL_ROLES enforced at API level.",
    tables: ["payroll_runs", "payroll_records", "salary_assignments", "payslips", "statutory_config"],
  },
  {
    domain_code:   "TAX_STATUTORY",
    domain_name:   "Tax & Statutory (PF/UAN/ESIC/TDS)",
    data_owner:    DATA_OWNER.HRMS_MYSQL,
    access_pattern: ACCESS_PATTERN.READ_WRITE,
    sensitivity:   "payroll",
    retention:     RETENTION_CLASS.PERMANENT,
    audit_required: true,
    pii_contains:  true,
    payroll_contains: true,
    tables: ["uan_records", "esic_records", "tds_declarations", "form16_data"],
  },
  // ── Documents ────────────────────────────────────────────────────────────────
  {
    domain_code:   "DOCUMENT_VAULT",
    domain_name:   "Document Vault",
    data_owner:    DATA_OWNER.HRMS_MYSQL,
    access_pattern: ACCESS_PATTERN.READ_WRITE,
    sensitivity:   "sensitive",
    retention:     RETENTION_CLASS.LONG_TERM,
    audit_required: true,
    pii_contains:  true,
    payroll_contains: false,
    tables: ["document_vault_inventory", "document_download_token", "document_access_log"],
  },
  {
    domain_code:   "FILE_STORAGE",
    domain_name:   "File Storage (disk)",
    data_owner:    DATA_OWNER.FILESYSTEM,
    access_pattern: ACCESS_PATTERN.READ_WRITE,
    sensitivity:   "sensitive",
    retention:     RETENTION_CLASS.LONG_TERM,
    audit_required: true,
    pii_contains:  true,
    payroll_contains: false,
    integration_notes: "Physical files in backend/uploads/. All access logged via document_access_log. Short-lived tokens for download links.",
    tables: [],
  },
  // ── LMS (read-only integration) ──────────────────────────────────────────────
  {
    domain_code:   "LMS_CURRICULUM",
    domain_name:   "LMS Curriculum & Content",
    data_owner:    DATA_OWNER.LMS_EXTERNAL,
    access_pattern: ACCESS_PATTERN.INTEGRATION_ONLY,
    sensitivity:   "internal",
    retention:     RETENTION_CLASS.PERMANENT,
    audit_required: false,
    pii_contains:  false,
    payroll_contains: false,
    integration_notes: "System of record is the deployed internal LMS. PeopleOS MUST NOT rebuild curriculum/content/certification. Integration layer provides readiness snapshots only.",
    tables: [],   // no mas_hrms tables own this data
  },
  {
    domain_code:   "LMS_PROGRESS",
    domain_name:   "LMS Learner Progress Snapshots",
    data_owner:    DATA_OWNER.LMS_EXTERNAL,
    access_pattern: ACCESS_PATTERN.SYNC_SNAPSHOT,
    sensitivity:   "internal",
    retention:     RETENTION_CLASS.MEDIUM_TERM,
    audit_required: true,
    pii_contains:  false,
    payroll_contains: false,
    integration_notes: "Periodic sync of learner progress/certification status into mas_hrms for dashboard display. No write-back to LMS.",
    tables: ["lms_learner_progress_cache", "lms_certification_snapshot"],
  },
  // ── Operations / Call Master ─────────────────────────────────────────────────
  {
    domain_code:   "CALL_MASTER_METRICS",
    domain_name:   "Call Master Performance Metrics",
    data_owner:    DATA_OWNER.CALL_MASTER,
    access_pattern: ACCESS_PATTERN.SYNC_SNAPSHOT,
    sensitivity:   "internal",
    retention:     RETENTION_CLASS.SHORT_TERM,
    audit_required: false,
    pii_contains:  false,
    payroll_contains: false,
    integration_notes: "Read-only connector reads approved KPI datapoints into mas_hrms. No writeback to Call Master.",
    tables: ["kpi_daily_metrics", "inbound_performance_cache"],
  },
  // ── Client Portal ────────────────────────────────────────────────────────────
  {
    domain_code:   "CLIENT_PORTAL",
    domain_name:   "Client Portal (aggregate only)",
    data_owner:    DATA_OWNER.HRMS_MYSQL,
    access_pattern: ACCESS_PATTERN.READ_ONLY,
    sensitivity:   "internal",
    retention:     RETENTION_CLASS.SHORT_TERM,
    audit_required: true,
    pii_contains:  false,
    payroll_contains: false,
    integration_notes: "NEVER expose payroll/PII/salary to client portal. Aggregate/summary metrics only. Client role is excluded from PAYROLL_ROLES and PII_READ_ROLES.",
    tables: ["portal_process_metrics", "portal_shrinkage_summary"],
  },
  // ── Audit & Governance ───────────────────────────────────────────────────────
  {
    domain_code:   "AUDIT_LOG",
    domain_name:   "System Audit Log",
    data_owner:    DATA_OWNER.HRMS_MYSQL,
    access_pattern: ACCESS_PATTERN.WRITE_ONLY,
    sensitivity:   "sensitive",
    retention:     RETENTION_CLASS.PERMANENT,
    audit_required: false,   // audit log itself cannot be audited — it's the root
    pii_contains:  true,
    payroll_contains: false,
    tables: ["audit_log", "document_access_log"],
  },
];

/**
 * Domains where write-back to the upstream source is PROHIBITED.
 * Any code attempting to write to these sources must get explicit approval first.
 */
export const WRITE_PROHIBITED_DOMAINS: string[] = DATA_GOVERNANCE_REGISTER
  .filter(d => d.access_pattern === ACCESS_PATTERN.READ_ONLY
            || d.access_pattern === ACCESS_PATTERN.SYNC_SNAPSHOT
            || d.access_pattern === ACCESS_PATTERN.INTEGRATION_ONLY)
  .map(d => d.domain_code);

/**
 * Domains containing payroll data — must never be served through Client Portal
 * or any non-payroll endpoint.
 */
export const PAYROLL_DOMAINS: string[] = DATA_GOVERNANCE_REGISTER
  .filter(d => d.payroll_contains)
  .map(d => d.domain_code);

/**
 * Domains that require an audit trail for every mutation.
 */
export const AUDIT_REQUIRED_DOMAINS: string[] = DATA_GOVERNANCE_REGISTER
  .filter(d => d.audit_required)
  .map(d => d.domain_code);
