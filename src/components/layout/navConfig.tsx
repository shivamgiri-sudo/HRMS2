import type { FC, SVGProps } from "react";
import {
  Activity, BarChart3, Bell, Briefcase, Building2, Calendar,
  CalendarDays, ClipboardList, Clock, CreditCard, FileCheck,
  FileText, GitBranch, GraduationCap, Heart, Home, Landmark,
  Network, Package, Search, Server, Settings, Settings2, ShieldCheck, Sparkles,
  Target, TrendingUp, Upload, User, UserMinus, UserPlus, Users, Users2, Wallet,
  Zap, DollarSign, ShoppingCart, LayoutDashboard, Crown, Receipt, CheckCircle,
  Plus, Send, Lock, Shield, ShieldAlert, PenSquare, Eye, UsersRound,
} from "lucide-react";
import type { NavGroup } from "./SidebarNav";

const sz = "h-[15px] w-[15px]";
const ic = (I: FC<SVGProps<SVGSVGElement>>) => <I className={sz} />;

export const navGroups: NavGroup[] = [
  /* ── OVERVIEW ─────────────────────────────────────────────── */
  {
    title: "Overview",
    items: [
      { label: "Dashboard",     href: "/dashboard",     icon: ic(Home),          description: "Workspace" },
      { label: "My Modules",    href: "/modules",       icon: ic(Package),       description: "All allowed pages" },
      { label: "Notifications", href: "/notifications", icon: ic(Bell),          description: "Personal updates" },
      { label: "Work Inbox",    href: "/work-inbox",    icon: ic(ClipboardList), pageCode: "WORK_INBOX", description: "Pending actions" },
      { label: "My Team",        href: "/my-team",       icon: ic(Users2),        roles: ["manager","process_manager","tl","team_leader","assistant_manager","branch_head"], description: "Team attendance, leave, KPI & approvals" },
      { label: "Reports",       href: "/reports",       icon: ic(BarChart3),     roles: ["admin","hr","manager","ceo","coo","branch_head"], description: "Reports" },
      { label: "My Dashboard",     href: "/my-dashboard",     icon: ic(LayoutDashboard), pageCode: "EMPLOYEE_SELF_DASHBOARD", description: "Employee dashboard" },
      { label: "CEO Dashboard",    href: "/ceo/dashboard",    icon: ic(Crown),           pageCode: "CEO_DASHBOARD", roles: ["ceo"], description: "CEO dashboard" },
      { label: "HR Dashboard",     href: "/hr/dashboard",     icon: ic(Users),           pageCode: "HR_DASHBOARD", roles: ["hr", "admin"], description: "HR dashboard" },
      { label: "WFM Dashboard",    href: "/wfm/dashboard",    icon: ic(Calendar),        pageCode: "WFM_DASHBOARD", roles: ["wfm"], description: "WFM dashboard" },
      { label: "Payroll Dashboard", href: "/payroll-hr/dashboard", icon: ic(Receipt),    pageCode: "PAYROLL_HR_DASHBOARD", roles: ["payroll_head", "payroll"], description: "Payroll dashboard" },
      { label: "Manager Dashboard", href: "/manager/dashboard", icon: ic(Briefcase),     pageCode: "MANAGEMENT_DASHBOARD", roles: ["manager", "process_manager"], description: "Manager dashboard" },
    ],
  },

  /* ── MY SPACE ──────────────────────────────────────────────── */
  {
    title: "My Space",
    items: [
      { label: "Profile",    href: "/profile",    icon: ic(User),         description: "Profile",    pageCode: "MY_PROFILE" },
      { label: "Calendar",   href: "/calendar",   icon: ic(Calendar),     description: "Company calendar" },
      {
        label: "Attendance", href: "/attendance", icon: ic(Clock), description: "Attendance & roster",
        children: [
          { label: "Attendance",               href: "/attendance",                    icon: ic(Clock),         description: "Attendance" },
          { label: "My Punch Logs",            href: "/attendance/biometric-logs",     icon: ic(Search),        description: "Read-only biometric punch history" },
          { label: "Regularization",           href: "/attendance/regularizations",    icon: ic(Clock),         pageCode: "ATTENDANCE_REGULARIZATION", description: "Regularize" },
          { label: "Attendance Disputes", href: "/attendance/disputes", icon: ic(ClipboardList), roles: ["admin","hr","wfm","manager","super_admin"], description: "Review attendance disputes" },
          { label: "Attendance Lookup",        href: "/hr/attendance-lookup",          icon: ic(Search),        roles: ["super_admin","admin","hr","payroll_head","payroll_admin","wfm"], description: "View any employee's attendance" },
          { label: "My Roster",                href: "/my-roster",                     icon: ic(Calendar),      description: "Roster" },
          { label: "Week-off Preference",      href: "/week-off-preferences",          icon: ic(CalendarDays),  description: "Week-off" },
          { label: "Roster Preference",        href: "/roster-preference",             icon: ic(Calendar),      pageCode: "WFM_ROSTER", description: "Roster preferences" },
        ],
      },
      {
        label: "Leave",      href: "/leaves",     icon: ic(CalendarDays), description: "Leave management",
        children: [
          { label: "Apply Leave",        href: "/leaves",                      icon: ic(CalendarDays), description: "Leave" },
        ],
      },
      {
        label: "Pay & Tax",  href: "/profile?tab=payslips", icon: ic(CreditCard), description: "Payslips & tax",
        children: [
          { label: "Payslips",         href: "/profile?tab=payslips",      icon: ic(CreditCard), description: "Payslips" },
          { label: "Payslip Center",   href: "/payroll/payslips",          icon: ic(CreditCard), pageCode: "PAYROLL_PAYSLIPS", description: "Download payslips" },
          { label: "Tax Declaration",  href: "/payroll/tax-declaration",   icon: ic(Landmark),   description: "Tax" },
          { label: "Reimbursements", href: "/payroll/reimbursements", icon: ic(Receipt), description: "Employee reimbursements" },
        ],
      },
      {
        label: "Engage",     href: "/engagement", icon: ic(Sparkles), description: "Engagement & feedback",
        children: [
          { label: "Engagement",         href: "/engagement",                          icon: ic(Sparkles),       description: "Engagement" },
          { label: "Company Feed",       href: "/engagement/company-feed",             icon: ic(Send),           description: "Approved company updates" },
          { label: "Creator Studio",     href: "/engagement/company-feed/create",      icon: ic(PenSquare),      description: "Submit posts for moderation" },
          { label: "Approval Queue",     href: "/engagement/company-feed/approvals",   icon: ic(ShieldCheck),    roles: ["hr_head","admin","super_admin"], description: "Review pending posts" },
          { label: "Feed Management",    href: "/engagement/company-feed/manage",      icon: ic(Eye),            roles: ["hr_head","admin","super_admin"], description: "Manage published and reviewed posts" },
          { label: "Leaderboard",        href: "/engagement/leaderboard",              icon: ic(TrendingUp),     description: "Leaderboard" },
          { label: "Kudos Wall",         href: "/engagement/kudos",                    icon: ic(Heart),          description: "Kudos" },
          { label: "Badges",             href: "/engagement/badges",                   icon: ic(ShieldCheck),    description: "Badges" },
          { label: "Surveys",            href: "/engagement/surveys",                  icon: ic(ClipboardList),  description: "Surveys" },
          { label: "Feedback",           href: "/performance-feedback/my-reports",     icon: ic(FileText),       description: "Feedback" },
          { label: "Dev. Plans",         href: "/performance-feedback/development-plan",icon: ic(Target),        description: "Dev plans" },
        ],
      },
      {
        label: "Comm. Prefs", href: "/communication/preferences", icon: ic(Bell), description: "Communication settings",
        children: [
          { label: "Notification Prefs", href: "/notification-preferences",  icon: ic(Bell), description: "Alert settings" },
          { label: "Comm. Preferences",  href: "/communication/preferences", icon: ic(Bell), description: "Comm preferences" },
        ],
      },
      { label: "My Resignation",   href: "/exit/resignation",        icon: ic(UserMinus), pageCode: "RESIGNATION_MY_REQUEST", description: "Raise resignation request" },
      { label: "DPDP Withdrawal",  href: "/privacy/dpdp-withdrawal", icon: ic(ShieldCheck), pageCode: "DPDP_WITHDRAWAL",       description: "Withdraw data consent" },
    ],
  },

  /* ── PEOPLE & HIRING ──────────────────────────────────────── */
  {
    title: "People & Hiring",
    items: [
      { label: "Employees",    href: "/employees",   icon: ic(Users),      roles: ["admin","hr","manager","branch_head","process_manager"], description: "Directory" },
      { label: "Org Chart",    href: "/org-chart",   icon: ic(GitBranch),  pageCode: "ORG_CHART", description: "Company hierarchy" },
      { label: "Departments",  href: "/departments", icon: ic(Building2),  roles: ["admin","hr","manager","ceo","coo","branch_head"], description: "Departments" },
      {
        label: "ATS",          href: "/ats/command-center", icon: ic(Briefcase), pageCode: "ATS_DASHBOARD", description: "Recruitment",
        children: [
          { label: "ATS Command",       href: "/ats/command-center",           icon: ic(Briefcase),    pageCode: "ATS_DASHBOARD",         description: "ATS" },
          { label: "Candidate Master",  href: "/ats/candidate-master",         icon: ic(Users),        pageCode: "ATS_CANDIDATE_MASTER",  description: "Candidate DB" },
          { label: "Walk-in Queue",     href: "/ats/walkin-queue",             icon: ic(Users),        pageCode: "ATS_WALKIN_QUEUE",     description: "Queue" },
          { label: "Ops Round",         href: "/ats/walkin-queue",             icon: ic(UsersRound),   pageCode: "ATS_WALKIN_QUEUE",     roles: ["operations_manager"],    description: "Candidates pending ops round interview" },
          { label: "My Candidates",     href: "/ats/recruiter/my-candidates",  icon: ic(ClipboardList),pageCode: "ATS_RECRUITER_QUEUE",   description: "Candidates" },
          { label: "Hiring Entry",      href: "/ats/recruiter/hiring-entry",   icon: ic(UserPlus),     pageCode: "ATS_RECRUITER_QUEUE",   description: "Tracker entry" },
          { label: "Hiring Dashboard",  href: "/ats/recruiter/hiring-dashboard", icon: ic(BarChart3),   pageCode: "ATS_DASHBOARD",         description: "Recruiter KPIs" },
          { label: "Waiting Queue", href: "/ats/waiting-queue", icon: ic(Users), pageCode: "ATS_WAITING_QUEUE", description: "Candidate waiting workflow" },
          { label: "Recruiter Portal", href: "/ats/recruiter-portal", icon: ic(Briefcase), pageCode: "ATS_RECRUITER_PORTAL", description: "Recruiter interview workspace" },
          { label: "ATS Sourcing",      href: "/ats/sourcing-analysis",        icon: ic(BarChart3),    pageCode: "ATS_DASHBOARD",         roles: ["admin","hr"], description: "Sourcing analytics" },
          { label: "Name Consistency", href: "/ats/name-consistency", icon: ic(FileCheck), pageCode: "NAME_CONSISTENCY_MATRIX", description: "Candidate identity consistency" },
          { label: "ATS Reconciliation", href: "/ats/reconciliation", icon: ic(CheckCircle), roles: ["admin","hr","super_admin"], description: "Recruitment reconciliation" },
          { label: "Form Config",       href: "/ats/form-config",              icon: ic(Settings2),                                               roles: ["admin","hr","super_admin"], description: "Interview form & branch aliases" },
          // Jobs Portal removed per business requirement
        ],
      },
      {
        label: "Onboarding",   href: "/onboarding",  icon: ic(UserPlus), roles: ["admin","hr"], description: "Onboarding & BGV",
        children: [
          { label: "Onboarding Bridge",   href: "/ats/onboarding-bridge",    icon: ic(UserPlus),    pageCode: "ATS_ONBOARDING_BRIDGE", roles: ["admin","hr"], description: "Bridge" },
          { label: "Onboarding Requests", href: "/ats/onboarding-requests",  icon: ic(ClipboardList),pageCode: "ATS_ONBOARDING_BRIDGE", roles: ["admin","hr"], description: "HR onboarding" },
          { label: "Payroll HR Validation", href: "/ats/payroll-hr-validation", icon: ic(ShieldCheck), pageCode: "ATS_PAYROLL_HR", description: "Validate joining payroll data" },
          { label: "Joining Control",      href: "/ats/joining-control-room", icon: ic(ClipboardList),pageCode: "ATS_JOINING_CONTROL_ROOM", roles: ["admin","hr","payroll_hr","super_admin"], description: "Payroll HR & JCLR" },
          { label: "Offer Letters",       href: "/offer-letter",             icon: ic(FileText),    pageCode: "ATS_OFFER",         roles: ["admin","hr"], description: "Generate offers" },
          { label: "Offer Approvals",     href: "/ats/offer-approvals",      icon: ic(FileCheck),   pageCode: "ATS_OFFER_APPROVALS", roles: ["admin","super_admin","hr","branch_head"], description: "Offer approvals" },
          { label: "IT Provisioning",     href: "/provisioning/it",          icon: ic(Server),      pageCode: "PROVISIONING_IT",   roles: ["it","admin","super_admin"], description: "Domain, email & assets" },
          { label: "Admin Provisioning",  href: "/provisioning/admin",       icon: ic(ShieldCheck), pageCode: "PROVISIONING_ADMIN", roles: ["admin","branch_admin","hr","super_admin"], description: "Biometric & ID card" },
          { label: "WFM Alignment",       href: "/provisioning/wfm-alignment", icon: ic(Clock),     pageCode: "PROVISIONING_WFM_ALIGNMENT", roles: ["wfm","admin","super_admin"], description: "Roster & shift alignment" },
          { label: "Appointment Letters", href: "/provisioning/appointment-letter", icon: ic(FileText), pageCode: "PROVISIONING_APPOINTMENT_LETTER", roles: ["hr","admin","super_admin"], description: "E-sign tracking" },
          { label: "Joining Documents",   href: "/ats/joining-documents-tracker", icon: ic(FileCheck), roles: ["admin","hr","payroll_hr","super_admin"], description: "Joining doc formalities" },
          { label: "Document Verification",href: "/document-verification",   icon: ic(FileCheck),   roles: ["admin","hr"],         description: "Documents" },
          { label: "BGV Verification",    href: "/ats/bgv",                  icon: ic(FileCheck),   pageCode: "ATS_BGV",           roles: ["admin","hr","payroll_hr","payroll"], description: "BGV center" },
          { label: "Enhanced BGV", href: "/ats/bgv-enhanced", icon: ic(ShieldCheck), roles: ["admin","hr","super_admin"], description: "Enhanced verification workflow" },
          { label: "BGV Reports",         href: "/ats/bgv-report",           icon: ic(FileCheck),   roles: ["admin","hr","payroll_hr","payroll"],         description: "BGV" },
          { label: "BGV API Monitor",     href: "/ats/bgv-api-monitor",      icon: ic(Activity),    roles: ["admin","hr","super_admin"],                  description: "BGV API monitoring" },
          { label: "Employee BGV Status", href: "/employees/bgv-status",     icon: ic(ShieldCheck), roles: ["admin","hr","payroll_hr","payroll","super_admin"], description: "Employee BGV status" },
          { label: "Bulk Upload",         href: "/bulk-upload",              icon: ic(Package),     roles: ["admin","hr","super_admin","wfm","payroll","payroll_hr"], description: "Bulk data import" },
          { label: "Historical Import",   href: "/ats/bulk-import",          icon: ic(Upload),      roles: ["admin","super_admin"], description: "Import historical candidates" },
        ],
      },
      {
        label: "Lifecycle",    href: "/employee-lifecycle", icon: ic(Users), pageCode: "EMPLOYEE_LIFECYCLE", description: "Employee lifecycle",
        children: [
          { label: "Employee Stat Cards", href: "/employee-stat-card", icon: ic(Users), description: "Employee profile and live stats" },
          { label: "Career Timeline",         href: "/employee-journey",      icon: ic(TrendingUp), description: "Career progression timeline" },
          { label: "Employee Lifecycle", href: "/employee-lifecycle",    icon: ic(Users),     pageCode: "EMPLOYEE_LIFECYCLE", roles: ["admin","hr"], description: "Lifecycle" },
          { label: "Career Planning",    href: "/career-planning",       icon: ic(TrendingUp),pageCode: "CAREER_PLANNING",   description: "Career paths" },
          { label: "Exit Command Center",  href: "/exit/command-center",     icon: ic(UserMinus), pageCode: "EXIT_COMMAND_CENTER",     description: "Exit ops" },
          { label: "Exit Management",      href: "/exit-management",         icon: ic(UserMinus), roles: ["admin","hr"],               description: "Exit" },
          { label: "Employee Reactivation",href: "/employees/reactivation",  icon: ic(UserPlus),  roles: ["hr","admin","super_admin","branch_head","payroll_head"], description: "Reactivate ex-employees" },
          { label: "Maternity Leave",      href: "/maternity-leave",         icon: ic(Heart),     roles: ["admin","hr"],               description: "Maternity" },
        ],
      },
    ],
  },

  /* ── WORKFORCE ────────────────────────────────────────────── */
  {
    title: "Workforce",
    items: [
      {
        label: "Learning",     href: "/lms/my-learning", icon: ic(GraduationCap), pageCode: "LMS_MY_LEARNING", description: "LMS & training",
        children: [
          { label: "My Learning",    href: "/lms/my-learning",  icon: ic(GraduationCap), pageCode: "LMS_MY_LEARNING",  description: "LMS" },
          { label: "LMS Coordinator",href: "/lms/coordinator",  icon: ic(Users),         pageCode: "LMS_COORDINATOR",  description: "Training" },
          { label: "LMS Admin",      href: "/lms/admin",        icon: ic(GraduationCap), pageCode: "LMS_ADMIN",        description: "LMS admin" },
          { label: "Progress Dashboard", href: "/lms/progress-dashboard", icon: ic(BarChart3), pageCode: "LMS_PROGRESS_DASHBOARD", roles: ["admin","hr","manager","super_admin"], description: "Training progress analytics" },
        ],
      },
      {
        label: "WFM & Roster",  href: "/wfm/roster", icon: ic(Clock), pageCode: "WFM_ROSTER", description: "Workforce management",
        children: [
          { label: "Roster Planning",        href: "/wfm/roster",                icon: ic(Clock),         pageCode: "WFM_ROSTER",      description: "Roster" },
          { label: "Auto Roster",            href: "/wfm/auto-roster",           icon: ic(Calendar),      pageCode: "WFM_AUTO_ROSTER", description: "Auto roster" },
          { label: "Roster Master Builder",  href: "/roster-master-builder",     icon: ic(Calendar),      pageCode: "ROSTER_MASTER",   description: "Build roster masters" },
          { label: "Roster Capacity Config", href: "/roster-capacity-config",    icon: ic(Settings2),     pageCode: "ROSTER_MASTER",   description: "Capacity settings" },
          { label: "WFM Manager Approvals", href: "/wfm-manager-approvals", icon: ic(ShieldCheck), pageCode: "WFM_ROSTER", description: "Manager roster approvals" },
          { label: "Week-off Day Rules",     href: "/wfm/weekoff-day-rules",     icon: ic(CalendarDays),  roles: ["admin","hr","wfm","manager","super_admin"], description: "Day-level rules" },
          { label: "WFM Planning Rules",     href: "/wfm/planning-rules",        icon: ic(Settings2),     roles: ["admin","hr","wfm","manager","super_admin"], description: "Shift planning rules" },
          { label: "Slot Requirements",      href: "/wfm/slot-requirements",     icon: ic(Calendar),      roles: ["admin","hr","wfm","manager","super_admin"], description: "Slot capacity" },
          { label: "Workforce Planning",     href: "/workforce-planning",        icon: ic(Users),         pageCode: "WFM_AUTO_ROSTER", description: "Headcount planning" },
          { label: "Week-off Fairness",      href: "/wfm/weekoff-fairness",      icon: ic(Target),        roles: ["admin","super_admin","wfm"], description: "Fairness scores & allocation" },
        ],
      },
      {
        label: "Live Monitoring", href: "/wfm/live-tracker", icon: ic(Activity), pageCode: "WFM_LIVE_TRACKER", description: "Live tracking",
        children: [
          { label: "WFM Tracker",           href: "/wfm/live-tracker",          icon: ic(Clock),     pageCode: "WFM_LIVE_TRACKER", description: "Live" },
          { label: "RTA Board",             href: "/rta-board",                 icon: ic(Activity),  pageCode: "RTA_BOARD",        description: "RTA" },
          { label: "Attendance Exceptions", href: "/wfm/attendance-exceptions", icon: ic(Clock),     pageCode: "WFM_LIVE_TRACKER", description: "Exception engine" },
          { label: "Attendance Mismatch", href: "/wfm/mismatch-queue", icon: ic(ClipboardList), roles: ["admin","hr","wfm","manager","super_admin"], description: "Resolve attendance mismatches" },
          { label: "Attendance Billing", href: "/attendance/billing-config", icon: ic(Settings2), roles: ["admin","hr","wfm","super_admin"], description: "Attendance billing rules" },
          { label: "COSEC Monitoring",      href: "/wfm/cosec-monitoring",      icon: ic(Activity),  pageCode: "WFM_LIVE_TRACKER", description: "Biometric sync" },
          { label: "Break Desk",            href: "/break-desk",                icon: ic(ShieldCheck),                             description: "Guard desk portal" },
          { label: "Break Reports",         href: "/break-reports",             icon: ic(Clock),     roles: ["super_admin","admin","hr","wfm","manager","process_manager"], description: "Daily break & attendance report" },
          { label: "Break Desk Devices",    href: "/break-management/devices",  icon: ic(Settings2), roles: ["super_admin","admin","wfm"], description: "Kiosk tokens & devices" },
        ],
      },
    ],
  },

  /* ── OPERATIONS ───────────────────────────────────────────── */
  {
    title: "Operations",
    items: [
      {
        label: "Call Master",  href: "/call-master", icon: ic(Activity), roles: ["super_admin","admin","ceo","manager","process_manager","operations_manager","qa","quality_analyst"], description: "Call analytics & quality",
        children: [
          { label: "Call Master",       href: "/call-master",          icon: ic(Activity),    roles: ["super_admin","admin","ceo","manager","process_manager","operations_manager","qa","quality_analyst"], description: "KPIs, quality, agents" },
          { label: "Inbound Dashboard", href: "/call-master/inbound",  icon: ic(TrendingUp),  roles: ["super_admin","admin","ceo","manager","process_manager","operations_manager","qa","quality_analyst"], description: "All-project inbound" },
        ],
      },
      {
        label: "Brand Sales",  href: "/sales/brand-analytics", icon: ic(ShoppingCart), roles: ["super_admin","admin","ceo","manager","process_manager","operations_manager"], description: "Bellavita & GNC analytics",
        children: [
          { label: "Brand Analytics",   href: "/sales/brand-analytics", icon: ic(ShoppingCart), roles: ["super_admin","admin","ceo","manager","process_manager","operations_manager"], description: "Sales dashboards & upload" },
        ],
      },
      {
        label: "Quality",      href: "/quality/dashboard", icon: ic(ShieldCheck), pageCode: "QUALITY_DASHBOARD", description: "Quality management",
        children: [
          { label: "Quality Dashboard",  href: "/quality/dashboard",     icon: ic(BarChart3),  pageCode: "QUALITY_DASHBOARD",   description: "Quality dashboard" },
          { label: "My Quality",         href: "/quality/my-dashboard",  icon: ic(ShieldCheck),description: "My quality score" },
          { label: "Team Quality",       href: "/quality/team",          icon: ic(Users),      description: "Team quality" },
          { label: "QA Audit",           href: "/quality/audit",         icon: ic(FileCheck),  description: "QA audit" },
          { label: "Executive Quality",  href: "/quality/executive",     icon: ic(BarChart3),  description: "Executive view" },
        ],
      },
      {
        label: "Performance",  href: "/performance", icon: ic(Target), description: "Performance management",
        children: [
          { label: "Performance Hub",      href: "/performance-hub",            icon: ic(BarChart3),    description: "Role-scoped KPI hub" },
          { label: "Performance",          href: "/performance",                icon: ic(Target),       description: "Performance" },
          { label: "Performance Command",  href: "/performance/command-center", icon: ic(Target),       pageCode: "WORKFORCE_COMMAND_CENTER", description: "Perf command" },
          { label: "Agent Performance",    href: "/agent-performance",          icon: ic(Activity),     roles: ["admin","hr","ceo","coo","qa","analyst","manager","process_manager","branch_head"], description: "Cross-source KPI" },
          { label: "KPI Config",           href: "/kpi-config",                 icon: ic(Target),       pageCode: "KPI_CONFIG", roles: ["admin","hr","manager","process_manager"], description: "KPI" },
          { label: "KPI Master", href: "/kpi-master", icon: ic(Settings2), pageCode: "KPI_MASTER", description: "KPI master configuration" },
          { label: "My KPI", href: "/my-kpi", icon: ic(Target), pageCode: "MY_KPI", description: "Personal KPI dashboard" },
          { label: "PIP Management", href: "/pip-management", icon: ic(ClipboardList), pageCode: "PIP_MANAGEMENT", description: "Performance improvement plans" },
          { label: "TAT Matrix", href: "/governance/tat-matrix", icon: ic(Settings2), pageCode: "TAT_MATRIX", description: "Turnaround-time policy" },
          { label: "TAT Dashboard", href: "/governance/tat-dashboard", icon: ic(BarChart3), pageCode: "TAT_DASHBOARD", description: "Turnaround-time monitoring" },
          { label: "Operations KPI",       href: "/operations-kpi",             icon: ic(Target),       pageCode: "OPERATIONS_KPI",          description: "Ops KPI" },
          { label: "Operations Dashboard", href: "/operations/dashboard",       icon: ic(Target),       pageCode: "OPERATIONS_DASHBOARD",    description: "Ops dashboard" },
          { label: "Feedback Assignments", href: "/performance-feedback/assignments",  icon: ic(ClipboardList), description: "Feedback tasks" },
          { label: "Team Reports",         href: "/performance-feedback/team-reports", icon: ic(BarChart3),     roles: ["admin","hr","manager"], description: "Team feedback" },
        ],
      },
      {
        label: "Payroll",      href: "/payroll", icon: ic(CreditCard), roles: ["admin","hr","finance","payroll"], description: "Payroll & statutory",
        children: [
          { label: "Payroll",               href: "/payroll",                      icon: ic(CreditCard), roles: ["admin","hr","finance","payroll"],                    description: "Payroll" },
          { label: "Incentives", href: "/payroll/incentives", icon: ic(TrendingUp), pageCode: "PAYROLL_INCENTIVES", description: "Incentive management" },
          { label: "Payroll Readiness",      href: "/payroll/branch-readiness",     icon: ic(Building2),  roles: ["super_admin","payroll_head","branch_head","payroll_branch","admin","hr","finance","payroll"], description: "Branch-wise payroll readiness" },
          { label: "Payroll Calendar",      href: "/payroll/calendar",             icon: ic(CalendarDays), roles: ["super_admin","payroll_head","payroll_branch"], description: "Payroll planning calendar" },
          { label: "HO Queues",             href: "/payroll/ho-queues",            icon: ic(ClipboardList), roles: ["admin","hr","finance","payroll","super_admin"],   description: "HO approval queues" },
          { label: "Cheque Validation",     href: "/payroll/cheque-validation",    icon: ic(FileCheck),     roles: ["payroll","payroll_head","super_admin","finance"], description: "Cheque name validation" },
          { label: "Full & Final",          href: "/payroll/full-final",           icon: ic(Zap),        roles: ["admin","hr","finance","payroll"],                    description: "F&F" },
          { label: "Salary Packages",       href: "/payroll/salary-packages",      icon: ic(Wallet),     roles: ["admin","finance"],                                  description: "Pay matrix" },
          { label: "Package Admin",        href: "/payroll/package-admin",       icon: ic(Wallet),     roles: ["admin","super_admin","payroll"],                    description: "Manage bands, packages, cost centres" },
          { label: "Statutory Config",      href: "/payroll/statutory-config",     icon: ic(Landmark),   roles: ["admin","hr","finance"],                             description: "Statutory" },
          { label: "EPF Compliance",        href: "/payroll/epf-compliance",       icon: ic(ShieldCheck), roles: ["admin","super_admin","payroll_hr","payroll","hr","manager"], description: "EPF/PF compliance tracking" },
          { label: "Statutory Filing",      href: "/payroll/statutory-filing",     icon: ic(FileCheck),  roles: ["super_admin","payroll_head","finance","admin"], description: "Statutory filing tracker" },
          { label: "Compliance",            href: "/compliance/statutory",         icon: ic(Landmark),   roles: ["admin","hr","finance"],                             description: "Compliance" },
          { label: "Labour Compliance",     href: "/compliance/labour",            icon: ic(Landmark),   pageCode: "LABOUR_COMPLIANCE", roles: ["admin","hr","finance"], description: "Labour" },
          { label: "Compliance Audit Report", href: "/compliance/audit-report",  icon: ic(FileCheck),  roles: ["admin","hr","super_admin"], description: "Comprehensive compliance audit" },
          { label: "Holiday Master",         href: "/payroll/holiday-master",       icon: ic(CalendarDays), roles: ["admin","super_admin","payroll_head","payroll_branch"],  description: "Holidays & CC mapping" },
          { label: "Holiday Work Requests",  href: "/payroll/holiday-work-requests",icon: ic(ClipboardList), roles: ["admin","super_admin","wfm","payroll_head","payroll_branch"], description: "Raise holiday work requests" },
          { label: "Holiday Work Approvals", href: "/payroll/holiday-work-approvals",icon: ic(ShieldCheck), roles: ["admin","super_admin","payroll_head","payroll_branch","wfm"], description: "Approve holiday work" },
          { label: "Overtime Management",    href: "/payroll/overtime",             icon: ic(Clock),      roles: ["admin","super_admin","wfm","payroll","payroll_head"], description: "Overtime calculation & approvals" },
          { label: "Running Payroll",        href: "/payroll/running-breakdown",    icon: ic(TrendingUp), roles: ["admin","super_admin","payroll_head","payroll_branch","wfm"], description: "Mid-month earned salary" },
          { label: "Payroll Validation",     href: "/payroll/validation",           icon: ic(ShieldCheck),roles: ["super_admin","payroll_head"],                           description: "Validate run before salary transfer" },
          { label: "NOC Management",         href: "/payroll/noc",                  icon: ic(FileCheck),  roles: ["super_admin","payroll_head","payroll_branch","payroll","admin"], description: "Upload & validate No-Objection Certificates" },
          { label: "Recalculation Queue",    href: "/payroll/recalculation-queue",  icon: ic(Settings2),  roles: ["admin","super_admin","payroll_head","payroll_branch"],  description: "Payroll recalc queue" },
          { label: "Config Flags",           href: "/payroll/config-flags",         icon: ic(Settings),   roles: ["admin","super_admin","payroll_head","payroll_branch"],  description: "Payroll configuration flags" },
          { label: "Payroll Masters",        href: "/payroll/masters",              icon: ic(Settings2),  roles: ["admin","super_admin","payroll","finance"],              description: "Salary slabs, bands, min wages" },
          { label: "PF Creation Queue",     href: "/payroll/pf-creation-queue",    icon: ic(FileCheck),  roles: ["admin","super_admin","payroll_hr","payroll"],           description: "Bulk PF/EPFO creation workflow" },
          { label: "PF Batches",            href: "/payroll/pf-batches",           icon: ic(FileCheck),  roles: ["admin","super_admin","payroll_hr","payroll"],           description: "PF creation batch management" },
          { label: "Cost Summary",          href: "/payroll/cost-summary",         icon: ic(DollarSign), roles: ["super_admin","payroll_head","finance"],                 description: "Payroll cost analysis" },
          { label: "Variance Report",       href: "/payroll/variance",             icon: ic(BarChart3),  roles: ["super_admin","payroll_head","finance","admin"],         description: "Month-over-month variance" },
          { label: "Audit Trail",           href: "/payroll/audit-trail",          icon: ic(FileText),   roles: ["super_admin","payroll_head","finance","admin"],         description: "Payroll changes audit log" },
          { label: "Disbursal Management",  href: "/payroll/disbursal",            icon: ic(Send),       pageCode: "PAYROLL_DISBURSAL", roles: ["super_admin","payroll_head","finance"], description: "Salary disbursal tracking" },
          { label: "Bulk Outputs", href: "/payroll/bulk-outputs", icon: ic(Package), roles: ["super_admin","payroll_head","admin"], description: "Bulk payroll documents" },
          { label: "Payroll Sign-off", href: "/payroll/sign-off", icon: ic(CheckCircle), roles: ["super_admin","payroll_head","finance","ceo","admin"], description: "Payroll approval and sign-off" },
          { label: "Salary Increment", href: "/salary-increment", icon: ic(TrendingUp), pageCode: "SALARY_INCREMENT", description: "Salary revision workflow" },
          { label: "Loan Management",       href: "/payroll/loans",                icon: ic(CreditCard), pageCode: "PAYROLL_LOANS", roles: ["super_admin","payroll_head","hr"], description: "Employee loan management" },
          { label: "Salary Certificates",   href: "/payroll/salary-certificates",  icon: ic(FileText),   pageCode: "SALARY_CERTIFICATE", description: "Generate salary certificates" },
        ],
      },
      {
        label: "Finance",      href: "/finance/process-pnl", icon: ic(DollarSign), roles: ["admin","finance","super_admin","ceo","coo","finance_head","accounts_head","payroll_head"], description: "Finance & procurement",
        children: [
          { label: "Process P&L",             href: "/finance/process-pnl",              icon: ic(BarChart3),    roles: ["admin","finance","super_admin","ceo","coo","finance_head","accounts_head","payroll_head"], description: "Profitability command centre" },
          { label: "P&L Configuration",       href: "/finance/process-pnl/configuration", icon: ic(Settings2),   roles: ["admin","finance","super_admin","ceo","coo","finance_head","accounts_head","payroll_head"], description: "Contracts, plans and rates" },
          { label: "P&L Period Close",        href: "/finance/process-pnl/period-close",  icon: ic(CheckCircle), roles: ["admin","finance","super_admin","ceo","coo","finance_head","accounts_head","payroll_head"], description: "Signoff and lock" },
          { label: "Branch Budget",           href: "/finance/branch-budget",            icon: ic(Wallet),       roles: ["admin","finance","super_admin","finance_head","accounts_head","branch_head","branch_admin"], description: "Monthly branch budgets and approval" },
          { label: "GRN Management",          href: "/finance/grn",                      icon: ic(ShoppingCart), roles: ["admin","finance","super_admin","finance_head","accounts_head","payroll_head"], description: "Goods receipt notes" },
          { label: "Vendor Payments",         href: "/finance/vendor-payment-tracking",  icon: ic(DollarSign),   roles: ["admin","finance","super_admin","finance_head","accounts_head","payroll_head"], description: "Vendor payment tracking" },
          { label: "Vendors", href: "/vendors", icon: ic(Users), roles: ["admin","super_admin","finance","manager"], description: "Vendor master" },
          { label: "Procurement", href: "/procurement", icon: ic(ShoppingCart), pageCode: "PROCUREMENT", description: "Procurement requests" },
          { label: "Expense Finance Queue",   href: "/expenses/finance",                 icon: ic(Receipt),      roles: ["admin","finance","super_admin","finance_head","accounts_head"], description: "Expense reimbursement control" },
          { label: "Expense Reports",         href: "/expenses/reports",                 icon: ic(BarChart3),    roles: ["admin","finance","super_admin","finance_head","accounts_head"], description: "Expense analytics" },
        ],
      },
      {
        label: "Management",   href: "/management/dashboard", icon: ic(BarChart3), pageCode: "MANAGEMENT_DASHBOARD", description: "Management dashboards",
        children: [
          { label: "Management Dashboard",     href: "/management/dashboard",          icon: ic(BarChart3),  pageCode: "MANAGEMENT_DASHBOARD",   description: "Management" },
          { label: "Business Command Center",  href: "/business-command-center",       icon: ic(Briefcase),  roles: ["admin","ceo","coo","hr","manager","process_manager"],           description: "Business ops center" },
          { label: "Business Actions",         href: "/business-actions",              icon: ic(ClipboardList), roles: ["admin","ceo","coo","hr","manager","process_manager","team_leader","tl"], description: "Action queue" },
          { label: "People Experience",        href: "/people-experience/command-center", icon: ic(Users),   pageCode: "PEOPLE_EXPERIENCE",      description: "People ops" },
          { label: "Control Tower", href: "/control-tower", icon: ic(Activity), roles: ["admin","super_admin","hr","manager"], description: "Cross-functional operations" },
        ],
      },
    ],
  },

  /* ── EXPENSES ─────────────────────────────────────────────── */
  {
    title: "Expenses",
    items: [
      { label: "My Expenses",    href: "/expenses",           icon: ic(Receipt),      pageCode: "MY_EXPENSES", description: "My expense claims" },
      { label: "New Claim",      href: "/expenses/new",       icon: ic(Plus),         pageCode: "EXPENSE_CREATE", description: "New expense claim" },
      { label: "Approvals",      href: "/expenses/approvals", icon: ic(CheckCircle),  pageCode: "EXPENSE_APPROVALS", roles: ["manager", "admin"], description: "Approve team expenses" },
      { label: "Finance Queue",  href: "/expenses/finance",   icon: ic(DollarSign),   pageCode: "EXPENSE_FINANCE", roles: ["finance", "admin", "super_admin", "finance_head", "accounts_head"], description: "Finance approval queue" },
      { label: "Reports",        href: "/expenses/reports",   icon: ic(BarChart3),    pageCode: "EXPENSE_REPORTS", roles: ["admin", "finance", "super_admin", "finance_head", "accounts_head"], description: "Expense analytics" },
    ],
  },

  /* ── SUPPORT ──────────────────────────────────────────────── */
  {
    title: "Support",
    items: [
      { label: "Helpdesk",       href: "/helpdesk",                          icon: ic(ShieldCheck), description: "Helpdesk" },
      { label: "Support Command",href: "/support/command-center",            icon: ic(ShieldCheck), pageCode: "SUPPORT_COMMAND_CENTER",    description: "Support ops" },
      { label: "Grievance",      href: "/support/grievance-command-center",  icon: ic(ClipboardList), pageCode: "GRIEVANCE_COMMAND_CENTER", description: "Grievances" },
      { label: "Benefits",       href: "/benefits",                          icon: ic(ShieldCheck), description: "Benefits" },
      { label: "Letters",        href: "/letters",                           icon: ic(FileText),    pageCode: "LETTERS", roles: ["admin","hr"], description: "HR letters" },
      { label: "Appointment E-sign", href: "/letters/appointment-esign",     icon: ic(FileCheck),   pageCode: "APPOINTMENT_ESIGN", roles: ["admin","hr","super_admin"], description: "Appointment letter e-signature tracking" },
    ],
  },

  /* ── ADMIN ─────────────────────────────────────────────────── */
  {
    title: "Admin",
    items: [
      {
        label: "Access & Settings", href: "/settings", icon: ic(Settings), description: "Access & configuration",
        children: [
          { label: "Settings",         href: "/settings",                    icon: ic(Settings),   description: "Settings" },
          { label: "Access Control",   href: "/settings/access-control",    icon: ic(Settings),   pageCode: "ACCESS_CONTROL", roles: ["admin"], description: "Access" },
          { label: "Page Access",      href: "/super-admin/page-access",    icon: ic(ShieldCheck),roles: ["admin"],            description: "Page access" },
          { label: "Module Access",    href: "/super-admin/module-access",  icon: ic(Lock),       pageCode: "MODULE_ACCESS", roles: ["super_admin"], description: "Module permissions" },
          { label: "Policy Engine",    href: "/super-admin/policy-engine",  icon: ic(Settings2),  roles: ["super_admin"], description: "Master business policy configuration" },
          { label: "Feed Creators",    href: "/super-admin/company-feed-creators", icon: ic(UsersRound), roles: ["super_admin"], description: "Grant company feed posting rights" },
          { label: "AI Providers",     href: "/settings/ai-providers",           icon: ic(Settings2), roles: ["super_admin"], description: "Configure AI models" },
          { label: "PeopleOS Copilot", href: "/peopleos/copilot", icon: ic(Sparkles), roles: ["super_admin","admin","hr","manager"], description: "AI-assisted HR workspace" },
          { label: "Super Admin Dashboard", href: "/super-admin/dashboard", icon: ic(Shield),     pageCode: "SUPER_ADMIN_DASHBOARD", roles: ["super_admin"], description: "Super admin dashboard" },
          { label: "Security Center",  href: "/security-center",            icon: ic(ShieldAlert),pageCode: "SECURITY_CENTER", roles: ["super_admin", "admin"], description: "Security monitoring" },
          { label: "DPDP / Privacy",   href: "/compliance/dpdp",            icon: ic(ShieldCheck),roles: ["admin","hr"],       description: "DPDP" },
          { label: "DPDP Withdrawal Admin", href: "/compliance/dpdp-withdrawal-admin", icon: ic(ShieldCheck), pageCode: "DPDP_WITHDRAWAL_ADMIN", description: "Review privacy withdrawal requests" },
          { label: "Audit Log",        href: "/audit-log",                  icon: ic(FileText),   roles: ["admin","super_admin","payroll_head","hr","wfm"], description: "Audit trail" },
          { label: "Document Templates", href: "/settings/document-templates", icon: ic(FileText), roles: ["admin","super_admin","hr"], description: "Joining document templates" },
          { label: "Email Template Import", href: "/settings/email-templates/bulk-import", icon: ic(Upload), roles: ["admin","super_admin"], description: "Bulk import communication templates" },
        ],
      },
      {
        label: "Organisation",  href: "/org-masters", icon: ic(Building2), roles: ["admin","hr"], description: "Org masters",
        children: [
          { label: "Org Masters",         href: "/org-masters",                  icon: ic(Building2), roles: ["admin","hr"],              description: "Masters" },
          { label: "Location & Policies", href: "/org-masters/locations-policies",icon: ic(Building2),pageCode: "ORG_MASTERS", roles: ["admin","hr"], description: "Locations" },
          { label: "Process Config",      href: "/process-config",               icon: ic(Network),   roles: ["admin","hr","process_manager"], description: "Process" },
          { label: "Leave Types",         href: "/leave-types",                  icon: ic(CalendarDays), roles: ["admin","hr"],             description: "Leave types" },
          { label: "Attendance Rules",    href: "/attendance-rules-master",      icon: ic(Settings2), roles: ["admin","hr"],              description: "Attendance rules" },
          { label: "Client Master",       href: "/client-master",                icon: ic(Users),     roles: ["admin","hr"],              description: "Clients" },
          { label: "Org Chart Settings", href: "/org-chart/settings", icon: ic(Settings2), roles: ["admin","hr","super_admin"], description: "Organisation chart rules" },
        ],
      },
      {
        label: "Integrations",   href: "/integration-hub", icon: ic(Network), roles: ["admin"], description: "Integrations & system",
        children: [
          { label: "Integration Hub",   href: "/integration-hub",    icon: ic(Network),   roles: ["admin"],                             description: "Integration" },
          { label: "LMS Integration",   href: "/lms/integration",    icon: ic(Network),   pageCode: "LMS_INTEGRATION", roles: ["admin"], description: "LMS integration" },
          { label: "Workflow Admin",    href: "/workflow-admin",      icon: ic(Network),   pageCode: "WORKFLOW_ADMIN",                   description: "Workflows" },
          { label: "Migration Console", href: "/migration-console",   icon: ic(Server),    roles: ["admin"],                             description: "Data migration" },
          { label: "Call Centre Config",href: "/settings/call-centre-config", icon: ic(Settings2), roles: ["admin"],                    description: "Call centre" },
          { label: "Comm. Config",      href: "/settings/communication-config", icon: ic(Settings2), roles: ["admin"],                  description: "Email/SMS" },
          { label: "Comm. Templates",   href: "/communication/templates",        icon: ic(FileText),  roles: ["admin","hr"],             description: "Message templates" },
          { label: "Comm. Dispatch",    href: "/communication/dispatch",         icon: ic(Bell),      roles: ["admin","hr"],             description: "Send messages" },
          { label: "Comm. History",     href: "/communication/history",          icon: ic(FileText),  roles: ["admin","hr"],             description: "Dispatch history" },
        ],
      },
      {
        label: "System",         href: "/customization", icon: ic(Settings2), description: "System tools",
        children: [
          { label: "Customization",    href: "/customization",      icon: ic(Settings2), pageCode: "CUSTOMIZATION_MANAGER", description: "Customization rules" },
          { label: "Visitor Mgmt",    href: "/visitor-management", icon: ic(UserPlus),                                     description: "Visitor access & security" },
          { label: "Visitor Approvals", href: "/visitor-management/approvals", icon: ic(CheckCircle), roles: ["admin","super_admin","hr","branch_head"], description: "Visitor approval queue" },
          { label: "Visitor Desk", href: "/visitor-management/desk", icon: ic(UserPlus), roles: ["super_admin","admin","security_head","visitor_security","visitor_reception","branch_head","branch_hr","hr_branch"], description: "Reception and check-in desk" },
          { label: "Visitor Security", href: "/visitor-management/security", icon: ic(ShieldCheck), roles: ["super_admin","admin","security_head","visitor_security","visitor_reception","branch_head","branch_hr","hr_branch"], description: "Visitor security operations" },
          { label: "Assets",           href: "/assets",             icon: ic(Package),                                      description: "Assets" },
          { label: "Assets Manager",   href: "/assets-manager",     icon: ic(Package),   pageCode: "ASSETS_MANAGER",        description: "Asset management" },
          { label: "Mobility",         href: "/mobility",           icon: ic(Users),     pageCode: "MOBILITY",              description: "Mobility" },
          { label: "ERP",              href: "/erp",                icon: ic(Server),    pageCode: "ERP",                   description: "ERP" },
          { label: "Portal Data Mgr",  href: "/portal-data-manager",icon: ic(Server),    pageCode: "PORTAL_DATA_MANAGER",   description: "Portal data" },
          { label: "WFM Extensions",   href: "/wfm/extensions",     icon: ic(Settings2), pageCode: "WFM_EXTENSIONS",        description: "WFM extensions" },
          { label: "Changelog", href: "/changelog", icon: ic(FileText), roles: ["admin","super_admin"], description: "Release history" },
        ],
      },
    ],
  },
];
