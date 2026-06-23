/**
 * Demo credentials for role-based testing.
 * Each entry creates a local mock session — backend API only.
 * Local-only demo passwords are placeholders, enabled only by explicit demo mode.
 */

export interface DemoCred {
  email: string;
  password: string;
  role: string;
  label: string;
  userId: string;
  fullName: string;
  employeeId: string;
  employeeCode: string;
  /** page codes this role can access */
  pages: string[];
}

const ALL_PAGES = [
  "ATS_DASHBOARD","ATS_RECRUITER_QUEUE","ATS_RECRUITER_WORKSPACE","ATS_WAITING_QUEUE",
  "ATS_CANDIDATE_MASTER","ATS_ONBOARDING_BRIDGE","ATS_EXTENSIONS",
  "LMS_MY_LEARNING","LMS_COORDINATOR","LMS_ADMIN","LMS_MANAGEMENT_DASHBOARD","LMS_INTEGRATION",
  "WFM_ROSTER","WFM_LIVE_TRACKER","WFM_EXTENSIONS",
  "QUALITY_DASHBOARD","OPERATIONS_DASHBOARD","WORKFORCE_COMMAND_CENTER",
  "ACCESS_CONTROL","ASSETS_MANAGER","HELPDESK","LETTERS","EMPLOYEE_LIFECYCLE",
  "ORG_MASTERS","WORKFLOW_ADMIN","MANAGEMENT_DASHBOARD","BENEFITS","CAREER_PLANNING",
  "PIP_MANAGEMENT","ERP","GOALS","WORK_INBOX","MOBILITY","JOBS_PORTAL",
  "ADVANCED_REPORTS","STATUTORY_COMPLIANCE","LABOUR_COMPLIANCE","DPDP_COMPLIANCE",
  "INTEGRATION_HUB","CLIENT_MASTER","PAYROLL_PAYSLIPS","TAX_DECLARATION","FULL_FINAL",
  "STATUTORY_CONFIG","KPI_CONFIG","OPERATIONS_KPI","PORTAL_DATA_MANAGER","PROCESS_CONFIG",
  "LEAVE_TYPES","RTA_BOARD",
];

export const DEMO_CREDENTIALS: DemoCred[] = [
  {
    email:        "admin@mascallnet.com",
    password:     "local-demo-admin",
    role:         "admin",
    label:        "Admin",
    userId:       "demo-admin-id",
    fullName:     "Arjun Sharma",
    employeeId:   "demo-emp-admin",
    employeeCode: "EMP-ADM-001",
    pages:        ALL_PAGES,
  },
  {
    email:        "hr@mascallnet.com",
    password:     "local-demo-hr",
    role:         "hr",
    label:        "HR Manager",
    userId:       "demo-hr-id",
    fullName:     "Priya Nair",
    employeeId:   "demo-emp-hr",
    employeeCode: "EMP-HR-001",
    pages: [
      "ATS_DASHBOARD","ATS_RECRUITER_QUEUE","ATS_RECRUITER_WORKSPACE","ATS_WAITING_QUEUE",
      "ATS_CANDIDATE_MASTER","ATS_ONBOARDING_BRIDGE","ATS_EXTENSIONS",
      "LMS_MY_LEARNING","LMS_COORDINATOR","LMS_ADMIN","LMS_MANAGEMENT_DASHBOARD","LMS_INTEGRATION",
      "HELPDESK","LETTERS","EMPLOYEE_LIFECYCLE","ORG_MASTERS","WORKFLOW_ADMIN",
      "BENEFITS","CAREER_PLANNING","MOBILITY","JOBS_PORTAL","ADVANCED_REPORTS",
      "STATUTORY_COMPLIANCE","LABOUR_COMPLIANCE","DPDP_COMPLIANCE","LEAVE_TYPES",
      "PAYROLL_PAYSLIPS","TAX_DECLARATION","FULL_FINAL","STATUTORY_CONFIG",
      "ASSETS_MANAGER","WORK_INBOX","KPI_CONFIG","PROCESS_CONFIG",
    ],
  },
  {
    email:        "recruiter@mascallnet.com",
    password:     "local-demo-recruiter",
    role:         "recruiter",
    label:        "Recruiter",
    userId:       "demo-recruiter-id",
    fullName:     "Ravi Kumar",
    employeeId:   "demo-emp-recruiter",
    employeeCode: "EMP-REC-001",
    pages: [
      "ATS_DASHBOARD","ATS_RECRUITER_QUEUE","ATS_RECRUITER_WORKSPACE",
      "ATS_WAITING_QUEUE","ATS_CANDIDATE_MASTER","ATS_ONBOARDING_BRIDGE","ATS_EXTENSIONS",
      "HELPDESK","WORK_INBOX",
    ],
  },
  {
    email:        "manager@mascallnet.com",
    password:     "local-demo-manager",
    role:         "process_manager",
    label:        "Process Manager",
    userId:       "demo-manager-id",
    fullName:     "Sunita Reddy",
    employeeId:   "demo-emp-manager",
    employeeCode: "EMP-MGR-001",
    pages: [
      "WFM_ROSTER","WFM_LIVE_TRACKER","RTA_BOARD","WORKFORCE_COMMAND_CENTER",
      "MANAGEMENT_DASHBOARD","KPI_CONFIG","OPERATIONS_KPI","PROCESS_CONFIG",
      "HELPDESK","WORK_INBOX","ADVANCED_REPORTS","CAREER_PLANNING","PIP_MANAGEMENT",
      "GOALS","LMS_MY_LEARNING",
    ],
  },
  {
    email:        "tl@mascallnet.com",
    password:     "local-demo-team-lead",
    role:         "team_leader",
    label:        "Team Leader",
    userId:       "demo-tl-id",
    fullName:     "Vikram Mehta",
    employeeId:   "demo-emp-tl",
    employeeCode: "EMP-TL-001",
    pages: [
      "WFM_ROSTER","RTA_BOARD","HELPDESK","WORK_INBOX",
      "GOALS","LMS_MY_LEARNING","CAREER_PLANNING",
    ],
  },
  {
    email:        "qa@mascallnet.com",
    password:     "local-demo-quality",
    role:         "qa",
    label:        "QA Analyst",
    userId:       "demo-qa-id",
    fullName:     "Deepa Iyer",
    employeeId:   "demo-emp-qa",
    employeeCode: "EMP-QA-001",
    pages: [
      "QUALITY_DASHBOARD","OPERATIONS_DASHBOARD","HELPDESK","WORK_INBOX",
      "ADVANCED_REPORTS","GOALS","LMS_MY_LEARNING",
    ],
  },
  {
    email:        "wfm@mascallnet.com",
    password:     "local-demo-workforce",
    role:         "wfm",
    label:        "WFM Analyst",
    userId:       "demo-wfm-id",
    fullName:     "Karan Gupta",
    employeeId:   "demo-emp-wfm",
    employeeCode: "EMP-WFM-001",
    pages: [
      "WFM_ROSTER","WFM_LIVE_TRACKER","WFM_EXTENSIONS","RTA_BOARD",
      "OPERATIONS_DASHBOARD","OPERATIONS_KPI","MANAGEMENT_DASHBOARD",
      "HELPDESK","WORK_INBOX","ADVANCED_REPORTS",
    ],
  },
  {
    email:        "finance@mascallnet.com",
    password:     "local-demo-finance",
    role:         "finance",
    label:        "Finance",
    userId:       "demo-finance-id",
    fullName:     "Meera Joshi",
    employeeId:   "demo-emp-finance",
    employeeCode: "EMP-FIN-001",
    pages: [
      "PAYROLL_PAYSLIPS","TAX_DECLARATION","FULL_FINAL","STATUTORY_CONFIG",
      "STATUTORY_COMPLIANCE","LABOUR_COMPLIANCE","ADVANCED_REPORTS","WORK_INBOX",
    ],
  },
  {
    email:        "employee@mascallnet.com",
    password:     "local-demo-employee",
    role:         "employee",
    label:        "Employee (Self-service)",
    userId:       "demo-employee-id",
    fullName:     "Ananya Singh",
    employeeId:   "demo-emp-employee",
    employeeCode: "EMP-STF-001",
    pages: [
      "LMS_MY_LEARNING","HELPDESK","WORK_INBOX","PAYROLL_PAYSLIPS","TAX_DECLARATION",
      "GOALS","CAREER_PLANNING","BENEFITS",
    ],
  },
  {
    email:        "ceo@mascallnet.com",
    password:     "local-demo-ceo",
    role:         "ceo",
    label:        "CEO / Leadership",
    userId:       "demo-ceo-id",
    fullName:     "Rajesh Kapoor",
    employeeId:   "demo-emp-ceo",
    employeeCode: "EMP-CEO-001",
    pages: [
      "MANAGEMENT_DASHBOARD","WORKFORCE_COMMAND_CENTER","OPERATIONS_DASHBOARD",
      "OPERATIONS_KPI","ADVANCED_REPORTS","KPI_CONFIG","QUALITY_DASHBOARD",
      "PORTAL_DATA_MANAGER","CLIENT_MASTER","WORK_INBOX",
    ],
  },
  {
    email:        "trainer@mascallnet.com",
    password:     "local-demo-trainer",
    role:         "trainer",
    label:        "Trainer / L&D",
    userId:       "demo-trainer-id",
    fullName:     "Pooja Bansal",
    employeeId:   "demo-emp-trainer",
    employeeCode: "EMP-TRN-001",
    pages: [
      "LMS_MY_LEARNING","LMS_COORDINATOR","LMS_ADMIN","LMS_MANAGEMENT_DASHBOARD","LMS_INTEGRATION",
      "HELPDESK","WORK_INBOX",
    ],
  },
  // Legacy alias — stays for backward compat
  {
    email:        "demo@mascallnet.com",
    password:     "local-demo-generic",
    role:         "admin",
    label:        "Demo (legacy)",
    userId:       "demo-user-id",
    fullName:     "Demo Admin",
    employeeId:   "demo-employee-id",
    employeeCode: "EMP-DEMO-001",
    pages:        ALL_PAGES,
  },
];

/** Look up a demo credential by email — O(1) via Map */
const _byEmail = new Map(DEMO_CREDENTIALS.map(c => [c.email.toLowerCase(), c]));

export function getDemoCred(email: string): DemoCred | undefined {
  return _byEmail.get(email.toLowerCase());
}

/** Build demo session for localStorage — plain shape, no external auth types */
export function buildDemoSession(cred: DemoCred) {
  return {
    access_token: `mock-token-${cred.role}`,
    user: {
      id:    cred.userId,
      email: cred.email,
    },
  };
}
