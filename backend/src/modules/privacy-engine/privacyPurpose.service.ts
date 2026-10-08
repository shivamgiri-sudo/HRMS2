/**
 * Processing Purpose definitions for the HRMS.
 * These are the lawful bases under which personal data is processed.
 * Legal sign-off required before treating any purpose as "legally_required".
 */

export type LawfulBasis =
  | "consent"              // Data principal gave explicit consent
  | "employment_contract"  // Processing necessary for employment relationship
  | "legal_obligation"     // Statutory/legal requirement (PF, ESIC, TDS, etc.)
  | "legitimate_interest"  // Legitimate operational interest
  | "vital_interest"       // Emergency/safety
  | "public_task";         // Not applicable for private HRMS

export interface ProcessingPurpose {
  code: string;
  name: string;
  description: string;
  lawfulBasis: LawfulBasis;
  dataCategories: string[];
  canBeWithdrawn: boolean;   // Can the data principal withdraw consent for this?
  retentionDays?: number;
  requiresConsentVersion: boolean;
  sensitivityLevel: "standard" | "sensitive" | "highly_sensitive";
}

export const PROCESSING_PURPOSES: ProcessingPurpose[] = [
  {
    code: "employment",
    name: "Employment Administration",
    description: "Processing necessary to fulfil the employment contract",
    lawfulBasis: "employment_contract",
    dataCategories: ["identity", "contact", "employment"],
    canBeWithdrawn: false, // Employment data cannot be withdrawn while employed
    requiresConsentVersion: false,
    sensitivityLevel: "standard",
  },
  {
    code: "payroll",
    name: "Payroll and Statutory Compliance",
    description: "Salary calculation, tax deduction, PF/ESIC filing",
    lawfulBasis: "legal_obligation",
    dataCategories: ["financial", "payroll", "statutory"],
    canBeWithdrawn: false, // Legally required
    requiresConsentVersion: false,
    sensitivityLevel: "highly_sensitive",
  },
  {
    code: "communication",
    name: "HR Communications",
    description: "Sending payslips, HR notices, policy updates",
    lawfulBasis: "consent",
    dataCategories: ["contact", "communication"],
    canBeWithdrawn: true,
    requiresConsentVersion: true,
    sensitivityLevel: "standard",
  },
  {
    code: "lms",
    name: "Learning Management System Integration",
    description: "Sharing employee data with the internal LMS for training",
    lawfulBasis: "employment_contract",
    dataCategories: ["identity", "employment", "performance"],
    canBeWithdrawn: false, // Required for employment
    requiresConsentVersion: false,
    sensitivityLevel: "standard",
  },
  {
    code: "recruitment",
    name: "Recruitment and Selection",
    description: "Processing candidate data during hiring",
    lawfulBasis: "consent",
    dataCategories: ["identity", "contact", "recruitment", "bgv"],
    canBeWithdrawn: true,
    retentionDays: 365,
    requiresConsentVersion: true,
    sensitivityLevel: "standard",
  },
  {
    code: "health",
    name: "Occupational Health",
    description: "Medical information for workplace health compliance",
    lawfulBasis: "legal_obligation",
    dataCategories: ["health"],
    canBeWithdrawn: false,
    requiresConsentVersion: false,
    sensitivityLevel: "highly_sensitive",
  },
  {
    code: "biometric",
    name: "Biometric Attendance",
    description: "Biometric data for attendance and access control",
    lawfulBasis: "employment_contract",
    dataCategories: ["biometric", "attendance"],
    canBeWithdrawn: false,
    requiresConsentVersion: false,
    sensitivityLevel: "highly_sensitive",
  },
  {
    code: "bgv",
    name: "Background Verification",
    description: "Identity, address, criminal, employment background checks",
    lawfulBasis: "consent",
    dataCategories: ["identity", "bgv"],
    canBeWithdrawn: true,
    requiresConsentVersion: true,
    sensitivityLevel: "sensitive",
  },
  {
    code: "optional_photo",
    name: "Photo/Publication",
    description: "Using employee photo in internal directories or communications",
    lawfulBasis: "consent",
    dataCategories: ["identity"],
    canBeWithdrawn: true,
    requiresConsentVersion: true,
    sensitivityLevel: "standard",
  },
  {
    code: "optional_ai",
    name: "AI-Powered Features",
    description: "Using employment context for AI-generated insights",
    lawfulBasis: "consent",
    dataCategories: ["employment", "performance", "attendance"],
    canBeWithdrawn: true,
    requiresConsentVersion: true,
    sensitivityLevel: "standard",
  },
];

export function getPurpose(code: string): ProcessingPurpose | undefined {
  return PROCESSING_PURPOSES.find((p) => p.code === code);
}

export function isWithdrawable(purposeCode: string): boolean {
  return getPurpose(purposeCode)?.canBeWithdrawn ?? false;
}
