/**
 * PeopleOS Backend Domain Registry
 *
 * Machine-readable map of every backend domain: its API prefix, auth requirements,
 * data classification, current fragmentation count, and ownership.
 *
 * This file is the authoritative reference for:
 * - Knowing which /api/* prefixes belong to which business domain
 * - Identifying domains with payroll/PII data (governs response sanitisation rules)
 * - Tracking router fragmentation (domains with > 3 routers are consolidation candidates)
 * - Future app.ts composition root generation
 *
 * Schema note: update this whenever adding a new domain router or merging two.
 */

export const AUTH_LEVEL = {
  PUBLIC:         "public",    // no token required (candidate forms, public verify)
  AUTHENTICATED:  "auth",      // requires valid JWT, any role
  ROLE_GUARDED:   "role",      // requires specific role via requireRole()
  SCOPE_GUARDED:  "scope",     // requires role + row-scope check via scopeMiddleware
} as const;
export type AuthLevel = typeof AUTH_LEVEL[keyof typeof AUTH_LEVEL];

export const DATA_CLASS = {
  PUBLIC:         "public",       // safe for unauthenticated responses
  INTERNAL:       "internal",     // operational data, authenticated employees
  PII:            "pii",          // name, DOB, address, contact, documents
  PAYROLL:        "payroll",      // salary, tax, bank, PF/UAN/ESIC
  SENSITIVE:      "sensitive",    // PII + payroll combined
} as const;
export type DataClass = typeof DATA_CLASS[keyof typeof DATA_CLASS];

export const DOMAIN_STATUS = {
  PRODUCTION:       "production",
  CONTROLLED_PILOT: "controlled_pilot",
  BETA:             "beta",
  INTERNAL:         "internal",
  DEPRECATED:       "deprecated",
} as const;
export type DomainStatus = typeof DOMAIN_STATUS[keyof typeof DOMAIN_STATUS];

export interface BackendDomain {
  domain_code:       string;
  domain_name:       string;
  api_prefix:        string;
  auth_level:        AuthLevel;
  data_class:        DataClass;
  status:            DomainStatus;
  business_owner:    string;
  router_count:      number;
  consolidation_target: boolean;   // true when router_count > 3 — needs consolidation PR
  notes?:            string;
}

export const BACKEND_DOMAIN_REGISTRY: BackendDomain[] = [
  {
    domain_code:   "AUTH",
    domain_name:   "Authentication",
    api_prefix:    "/api/auth",
    auth_level:    AUTH_LEVEL.PUBLIC,
    data_class:    DATA_CLASS.SENSITIVE,
    status:        DOMAIN_STATUS.PRODUCTION,
    business_owner: "IT / Security",
    router_count:  1,
    consolidation_target: false,
  },
  {
    domain_code:   "EMPLOYEES",
    domain_name:   "Employee Management",
    api_prefix:    "/api/employees",
    auth_level:    AUTH_LEVEL.SCOPE_GUARDED,
    data_class:    DATA_CLASS.PII,
    status:        DOMAIN_STATUS.PRODUCTION,
    business_owner: "HR Admin",
    router_count:  9,
    consolidation_target: true,
    notes: "employeeRouter + employeeSecureRouter + employeeGovernanceRouter + employeePhotoCompatRouter + employee360Router + employeeReportMasterRouter + employeeJoiningDocumentsRouter + employeeReactivationRouter + employeeVerifyRouter",
  },
  {
    domain_code:   "ATS",
    domain_name:   "Applicant Tracking System",
    api_prefix:    "/api/ats",
    auth_level:    AUTH_LEVEL.ROLE_GUARDED,
    data_class:    DATA_CLASS.PII,
    status:        DOMAIN_STATUS.PRODUCTION,
    business_owner: "Recruitment HR",
    router_count:  20,
    consolidation_target: true,
    notes: "atsRouter + atsPublicRouter (unauth) + atsFormConfigRouter + registrationEnhancedRouter + queueRouter + queuePublicRouter + bgvVerificationRouter + bgvEnhancedRouter + nameConsistencyRouter + jclrRouter + joiningControlRoomRouter + salaryComponentAssignmentRouter + employeeCodeGateRouter + payrollHRRouter + branchHeadApprovalRouter + commandCentreRouter + interviewRouter + candidatePortalRouter + reconciliationRouter + superAdminRouter",
  },
  {
    domain_code:   "ATTENDANCE",
    domain_name:   "Attendance",
    api_prefix:    "/api/attendance",
    auth_level:    AUTH_LEVEL.SCOPE_GUARDED,
    data_class:    DATA_CLASS.INTERNAL,
    status:        DOMAIN_STATUS.PRODUCTION,
    business_owner: "WFM",
    router_count:  3,
    consolidation_target: false,
    notes: "attendanceDisputeRouter + attendanceManualOverrideRouter + billingConfigRouter",
  },
  {
    domain_code:   "WFM",
    domain_name:   "Workforce Management",
    api_prefix:    "/api/wfm",
    auth_level:    AUTH_LEVEL.SCOPE_GUARDED,
    data_class:    DATA_CLASS.INTERNAL,
    status:        DOMAIN_STATUS.PRODUCTION,
    business_owner: "WFM",
    router_count:  14,
    consolidation_target: true,
    notes: "wfmRouter + wfmRegularizationSecureRouter + rosterRouter + rosterActualSecureRouter + autoRosterSyncedRouter + attendanceDailyScopedRouter + attendanceEngineRouter + attendanceAprBulkRouter + attendanceManualMarkRouter + biometricPunchRouter + biometricLogsRouter + cosecSyncRouter + biometricSummaryRouter + mismatchReviewRouter",
  },
  {
    domain_code:   "PAYROLL",
    domain_name:   "Payroll & Statutory",
    api_prefix:    "/api/payroll",
    auth_level:    AUTH_LEVEL.SCOPE_GUARDED,
    data_class:    DATA_CLASS.PAYROLL,
    status:        DOMAIN_STATUS.PRODUCTION,
    business_owner: "Payroll Head",
    router_count:  25,
    consolidation_target: true,
    notes: "payrollRouter + payrollSecureRouter + payrollExtendedRouter + payrollMoreRouter + payrollStatutoryConfigCompatRouter + payrollLinesCompatRouter + payrollReadinessRouter + payrollBranchReadinessRouter + payrollCalendarRouter + payrollCostSummaryRouter + payrollStatutoryFilingRouter + payrollVarianceRouter + payrollAuditTrailRouter + loansRouter + payrollSignoffRouter + payrollCertificatesRouter + reimbursementsRouter + payrollStatutoryOverrideRouter + chequeValidationRouter + disbursalRouter + payrollWindowCronRouter + nocRouter + runningSalaryRouter + payrollEpfComplianceRouter + pfCreationRouter",
  },
  {
    domain_code:   "LEAVE",
    domain_name:   "Leave Management",
    api_prefix:    "/api/leave",
    auth_level:    AUTH_LEVEL.ROLE_GUARDED,
    data_class:    DATA_CLASS.INTERNAL,
    status:        DOMAIN_STATUS.PRODUCTION,
    business_owner: "HR Admin",
    router_count:  1,
    consolidation_target: false,
  },
  {
    domain_code:   "EXIT",
    domain_name:   "Exit & Resignation",
    api_prefix:    "/api/exit",
    auth_level:    AUTH_LEVEL.ROLE_GUARDED,
    data_class:    DATA_CLASS.PII,
    status:        DOMAIN_STATUS.PRODUCTION,
    business_owner: "HR Admin",
    router_count:  5,
    consolidation_target: true,
    notes: "exitRouter + exitSecureRouter + exitCompatRouter + ffApprovalGuardCompatRouter + exitStatusGuardCompatRouter",
  },
  {
    domain_code:   "PERFORMANCE",
    domain_name:   "Performance & KPI",
    api_prefix:    "/api/kpi",
    auth_level:    AUTH_LEVEL.ROLE_GUARDED,
    data_class:    DATA_CLASS.INTERNAL,
    status:        DOMAIN_STATUS.PRODUCTION,
    business_owner: "Operations Manager",
    router_count:  1,
    consolidation_target: false,
  },
  {
    domain_code:   "QUALITY",
    domain_name:   "Quality",
    api_prefix:    "/api/quality",
    auth_level:    AUTH_LEVEL.ROLE_GUARDED,
    data_class:    DATA_CLASS.INTERNAL,
    status:        DOMAIN_STATUS.PRODUCTION,
    business_owner: "QA",
    router_count:  1,
    consolidation_target: false,
  },
  {
    domain_code:   "LMS",
    domain_name:   "LMS Integration",
    api_prefix:    "/api/lms",
    auth_level:    AUTH_LEVEL.ROLE_GUARDED,
    data_class:    DATA_CLASS.INTERNAL,
    status:        DOMAIN_STATUS.CONTROLLED_PILOT,
    business_owner: "HR Admin / Trainer",
    router_count:  1,
    consolidation_target: false,
    notes: "Integration layer only — no LMS content/assessment/certification operations",
  },
  {
    domain_code:   "PORTAL",
    domain_name:   "Client Portal",
    api_prefix:    "/api/portal",
    auth_level:    AUTH_LEVEL.ROLE_GUARDED,
    data_class:    DATA_CLASS.INTERNAL,
    status:        DOMAIN_STATUS.CONTROLLED_PILOT,
    business_owner: "Operations Manager",
    router_count:  1,
    consolidation_target: false,
    notes: "Client-scoped: must never expose payroll/PII data. Aggregate/summary only.",
  },
  {
    domain_code:   "REPORTS",
    domain_name:   "Reports",
    api_prefix:    "/api/reports",
    auth_level:    AUTH_LEVEL.ROLE_GUARDED,
    data_class:    DATA_CLASS.SENSITIVE,
    status:        DOMAIN_STATUS.PRODUCTION,
    business_owner: "HR Admin",
    router_count:  3,
    consolidation_target: false,
    notes: "reportingRouter + enterpriseReportsRouter + reportingLeaveBalanceRouter",
  },
  {
    domain_code:   "ASSETS",
    domain_name:   "Assets",
    api_prefix:    "/api/assets",
    auth_level:    AUTH_LEVEL.ROLE_GUARDED,
    data_class:    DATA_CLASS.INTERNAL,
    status:        DOMAIN_STATUS.PRODUCTION,
    business_owner: "HR Admin",
    router_count:  1,
    consolidation_target: false,
  },
  {
    domain_code:   "INTEGRATION_HUB",
    domain_name:   "Integration Hub",
    api_prefix:    "/api/integration-hub",
    auth_level:    AUTH_LEVEL.ROLE_GUARDED,
    data_class:    DATA_CLASS.INTERNAL,
    status:        DOMAIN_STATUS.PRODUCTION,
    business_owner: "IT / Admin",
    router_count:  1,
    consolidation_target: false,
  },
  {
    domain_code:   "AUDIT",
    domain_name:   "Audit Log",
    api_prefix:    "/api/audit",
    auth_level:    AUTH_LEVEL.ROLE_GUARDED,
    data_class:    DATA_CLASS.SENSITIVE,
    status:        DOMAIN_STATUS.PRODUCTION,
    business_owner: "Admin",
    router_count:  1,
    consolidation_target: false,
  },
  {
    domain_code:   "MANAGEMENT",
    domain_name:   "Management Dashboard",
    api_prefix:    "/api/management",
    auth_level:    AUTH_LEVEL.ROLE_GUARDED,
    data_class:    DATA_CLASS.INTERNAL,
    status:        DOMAIN_STATUS.PRODUCTION,
    business_owner: "CEO / COO",
    router_count:  2,
    consolidation_target: false,
    notes: "managementRouter + managementCommandCenterRouter",
  },
  {
    domain_code:   "FINANCE",
    domain_name:   "Finance & ERP",
    api_prefix:    "/api/finance",
    auth_level:    AUTH_LEVEL.ROLE_GUARDED,
    data_class:    DATA_CLASS.PAYROLL,
    status:        DOMAIN_STATUS.CONTROLLED_PILOT,
    business_owner: "Finance Head",
    router_count:  1,
    consolidation_target: false,
  },
  {
    domain_code:   "COMPLIANCE",
    domain_name:   "Compliance & Statutory",
    api_prefix:    "/api/compliance",
    auth_level:    AUTH_LEVEL.ROLE_GUARDED,
    data_class:    DATA_CLASS.SENSITIVE,
    status:        DOMAIN_STATUS.CONTROLLED_PILOT,
    business_owner: "HR Admin",
    router_count:  1,
    consolidation_target: false,
  },
];

/** Domains requiring payroll data protection in API responses */
export const PAYROLL_DATA_DOMAINS = BACKEND_DOMAIN_REGISTRY
  .filter(d => d.data_class === DATA_CLASS.PAYROLL || d.data_class === DATA_CLASS.SENSITIVE)
  .map(d => d.domain_code);

/** Domains with router_count > 3 — candidates for next consolidation sprint */
export const FRAGMENTED_DOMAINS = BACKEND_DOMAIN_REGISTRY
  .filter(d => d.consolidation_target)
  .map(d => ({ code: d.domain_code, prefix: d.api_prefix, router_count: d.router_count }));
