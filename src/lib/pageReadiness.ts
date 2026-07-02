export type PageMaturity = "prototype" | "beta" | "production" | "restricted" | "deprecated";
export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface PageReadinessRule {
  path: string;
  title: string;
  module: string;
  maturity: PageMaturity;
  risk: RiskLevel;
  dataSourceRequired: boolean;
  auditRequired: boolean;
  exportControlRequired: boolean;
  piiLevel: "none" | "low" | "medium" | "high";
  ownerRole: string;
  missingControls: string[];
  recommendedNextActions: string[];
}

export const pageReadinessRegistry: PageReadinessRule[] = [
  {
    path: "/attendance",
    title: "Attendance",
    module: "WFM",
    maturity: "beta",
    risk: "critical",
    dataSourceRequired: true,
    auditRequired: true,
    exportControlRequired: true,
    piiLevel: "high",
    ownerRole: "WFM + HR + IT",
    missingControls: ["COSEC sync health badge", "branch/process/cost-centre filters", "regularization audit trail", "calculation explanation drawer"],
    recommendedNextActions: ["show last biometric sync timestamp", "add missing-punch diagnostics", "lock payroll-impacting edits behind maker-checker"],
  },
  {
    path: "/reports",
    title: "Reports",
    module: "Analytics",
    maturity: "beta",
    risk: "critical",
    dataSourceRequired: true,
    auditRequired: true,
    exportControlRequired: true,
    piiLevel: "high",
    ownerRole: "HR + Compliance + Payroll",
    missingControls: ["data source labels", "last refresh timestamp", "report validation checks", "export audit logging"],
    recommendedNextActions: ["fix start-of-year active count", "fix termination and payroll trend logic", "add report health panel"],
  },
  {
    path: "/payroll",
    title: "Payroll",
    module: "Payroll",
    maturity: "beta",
    risk: "critical",
    dataSourceRequired: true,
    auditRequired: true,
    exportControlRequired: true,
    piiLevel: "high",
    ownerRole: "Payroll + Finance",
    missingControls: ["maker-checker before publish", "variance warnings", "component-level validation", "salary export watermark"],
    recommendedNextActions: ["verify component breakdown from salary_prep_line_component", "block publish until validation passes", "add payroll freeze/unfreeze audit"],
  },
  {
    path: "/payroll/payslips",
    title: "Payslip Center",
    module: "Payroll",
    maturity: "beta",
    risk: "critical",
    dataSourceRequired: true,
    auditRequired: true,
    exportControlRequired: true,
    piiLevel: "high",
    ownerRole: "Payroll + Finance",
    missingControls: ["download audit", "masked salary preview for unauthorized roles", "PDF version stamp"],
    recommendedNextActions: ["show component source", "add employee acknowledgement", "watermark all PDFs"],
  },
  {
    path: "/wfm/live-tracker",
    title: "WFM Live Tracker",
    module: "WFM",
    maturity: "prototype",
    risk: "high",
    dataSourceRequired: true,
    auditRequired: true,
    exportControlRequired: false,
    piiLevel: "medium",
    ownerRole: "WFM",
    missingControls: ["live refresh status", "COSEC/roster source indicator", "empty/error states", "SLA breach colors"],
    recommendedNextActions: ["add WebSocket/polling health", "show delayed sync warning", "add branch/process filters"],
  },
  {
    path: "/quality/dashboard",
    title: "Quality Dashboard",
    module: "Quality",
    maturity: "prototype",
    risk: "high",
    dataSourceRequired: true,
    auditRequired: true,
    exportControlRequired: true,
    piiLevel: "medium",
    ownerRole: "Quality + Operations",
    missingControls: ["KPI formula versioning", "sample source", "calibration/audit evidence", "drill-down access scope"],
    recommendedNextActions: ["add quality health cards", "show formula and data source", "lock exports behind permission"],
  },
  {
    path: "/operations/dashboard",
    title: "Operations Dashboard",
    module: "Operations",
    maturity: "prototype",
    risk: "high",
    dataSourceRequired: true,
    auditRequired: true,
    exportControlRequired: true,
    piiLevel: "medium",
    ownerRole: "Operations",
    missingControls: ["real-time data source", "branch/process filters", "KPI drilldown", "variance explanation"],
    recommendedNextActions: ["wire Operations KPI data", "add trend validation", "show last sync"],
  },
  {
    path: "/compliance/dpdp",
    title: "DPDP / Privacy",
    module: "Compliance",
    maturity: "beta",
    risk: "critical",
    dataSourceRequired: true,
    auditRequired: true,
    exportControlRequired: true,
    piiLevel: "high",
    ownerRole: "Data Protection Officer",
    missingControls: ["consent register", "DSAR tracker", "retention scheduler", "breach register"],
    recommendedNextActions: ["map personal data fields by module", "add retention policy enforcement", "add breach workflow"],
  },
  {
    path: "/integration-hub",
    title: "Integration Hub",
    module: "System",
    maturity: "beta",
    risk: "critical",
    dataSourceRequired: true,
    auditRequired: true,
    exportControlRequired: false,
    piiLevel: "high",
    ownerRole: "IT Security",
    missingControls: ["secret rotation reminder", "connector test audit", "least-privilege connector roles", "sync failure alerting"],
    recommendedNextActions: ["show connector health cards", "hide secret values permanently", "add rotation due dates"],
  },
  {
    path: "/migration-console",
    title: "Migration Console",
    module: "System",
    maturity: "restricted",
    risk: "critical",
    dataSourceRequired: true,
    auditRequired: true,
    exportControlRequired: false,
    piiLevel: "high",
    ownerRole: "Super Admin + IT Security",
    missingControls: ["dry-run summary", "rollback confirmation", "dual approval", "production lock"],
    recommendedNextActions: ["require confirmation phrase", "create rollback snapshot", "block non-admin access server-side"],
  },
];

export function findPageReadiness(pathname: string): PageReadinessRule | null {
  const normalized = pathname.split("?")[0].replace(/\/$/, "") || "/";
  return (
    pageReadinessRegistry.find((rule) => normalized === rule.path || normalized.startsWith(`${rule.path}/`)) ?? null
  );
}

export function getRiskTone(risk: RiskLevel): string {
  switch (risk) {
    case "critical":
      return "border-red-200 bg-red-50 text-red-950";
    case "high":
      return "border-amber-200 bg-amber-50 text-amber-950";
    case "medium":
      return "border-blue-200 bg-blue-50 text-blue-950";
    default:
      return "border-emerald-200 bg-emerald-50 text-emerald-950";
  }
}
