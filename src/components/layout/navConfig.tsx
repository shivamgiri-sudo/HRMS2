import type { FC, SVGProps } from "react";
import {
  Activity, BarChart3, Bell, Briefcase, Building2, Calendar,
  CalendarDays, ClipboardList, Clock, CreditCard, FileCheck,
  FileText, GraduationCap, Heart, Home, Landmark,
  Network, Package, Server, Settings, Settings2, ShieldCheck, Sparkles,
  Target, TrendingUp, User, UserMinus, UserPlus, Users, Wallet,
  Zap, DollarSign, ShoppingCart,
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
      { label: "Reports",       href: "/reports",       icon: ic(BarChart3),     roles: ["admin","hr","manager","ceo","branch_head"], description: "Reports" },
    ],
  },

  /* ── MY SPACE ──────────────────────────────────────────────── */
  {
    title: "My Space",
    items: [
      { label: "Profile",    href: "/profile",    icon: ic(User),         description: "Profile" },
      { label: "Calendar",   href: "/calendar",   icon: ic(Calendar),     description: "Company calendar" },
      {
        label: "Attendance", href: "/attendance", icon: ic(Clock), description: "Attendance & roster",
        children: [
          { label: "Attendance",               href: "/attendance",                    icon: ic(Clock),         description: "Attendance" },
          { label: "Regularization",           href: "/attendance/regularizations",    icon: ic(Clock),         pageCode: "ATTENDANCE_REGULARIZATION", description: "Regularize" },
          { label: "Disputes",                 href: "/attendance/disputes",           icon: ic(ClipboardList), description: "Disputes" },
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
        ],
      },
      {
        label: "Engage",     href: "/engagement", icon: ic(Sparkles), description: "Engagement & feedback",
        children: [
          { label: "Engagement",         href: "/engagement",                          icon: ic(Sparkles),       description: "Engagement" },
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
    ],
  },

  /* ── PEOPLE & HIRING ──────────────────────────────────────── */
  {
    title: "People & Hiring",
    items: [
      { label: "Employees",    href: "/employees",   icon: ic(Users),     roles: ["admin","hr","manager","branch_head","process_manager"], description: "Directory" },
      { label: "Departments",  href: "/departments", icon: ic(Building2), roles: ["admin","hr","manager","ceo","branch_head"], description: "Departments" },
      {
        label: "ATS",          href: "/ats/command-center", icon: ic(Briefcase), pageCode: "ATS_DASHBOARD", description: "Recruitment",
        children: [
          { label: "ATS Command",       href: "/ats/command-center",           icon: ic(Briefcase),    pageCode: "ATS_DASHBOARD",         description: "ATS" },
          { label: "Candidate Master",  href: "/ats/candidate-master",         icon: ic(Users),        pageCode: "ATS_CANDIDATE_MASTER",  description: "Candidate DB" },
          { label: "Walk-in Queue",     href: "/ats/walkin-queue",             icon: ic(Users),        pageCode: "ATS_WAITING_QUEUE",     description: "Queue" },
          { label: "My Candidates",     href: "/ats/recruiter/my-candidates",  icon: ic(ClipboardList),pageCode: "ATS_RECRUITER_QUEUE",   description: "Candidates" },
          { label: "ATS Sourcing",      href: "/ats/sourcing-analysis",        icon: ic(BarChart3),    pageCode: "ATS_DASHBOARD",         roles: ["admin","hr"], description: "Sourcing analytics" },
          // Jobs Portal removed per business requirement
        ],
      },
      {
        label: "Onboarding",   href: "/onboarding",  icon: ic(UserPlus), roles: ["admin","hr"], description: "Onboarding & BGV",
        children: [
          { label: "Onboarding Bridge",   href: "/ats/onboarding-bridge",    icon: ic(UserPlus),    pageCode: "ATS_ONBOARDING_BRIDGE", roles: ["admin","hr"], description: "Bridge" },
          { label: "Onboarding Requests", href: "/ats/onboarding-requests",  icon: ic(ClipboardList),pageCode: "ATS_ONBOARDING_BRIDGE", roles: ["admin","hr"], description: "HR onboarding" },
          { label: "Offer Letters",       href: "/offer-letter",             icon: ic(FileText),    pageCode: "ATS_OFFER",         roles: ["admin","hr"], description: "Generate offers" },
          { label: "Offer Approvals",     href: "/ats/offer-approvals",      icon: ic(FileCheck),   pageCode: "ATS_OFFER",         roles: ["admin","hr"], description: "Offer approvals" },
          { label: "Document Verification",href: "/document-verification",   icon: ic(FileCheck),   roles: ["admin","hr"],         description: "Documents" },
          { label: "BGV Verification",    href: "/ats/bgv",                  icon: ic(FileCheck),   pageCode: "ATS_BGV",           roles: ["admin","hr"], description: "BGV center" },
          { label: "BGV Reports",         href: "/ats/bgv-report",           icon: ic(FileCheck),   roles: ["admin","hr"],         description: "BGV" },
          { label: "Employee BGV Status", href: "/employees/bgv-status",     icon: ic(ShieldCheck), roles: ["admin","hr","super_admin"], description: "Employee BGV status" },
          { label: "Bulk Upload",         href: "/bulk-upload",              icon: ic(Package),     pageCode: "EMPLOYEE_MANAGEMENT", roles: ["admin","hr"], description: "Bulk data import" },
        ],
      },
      {
        label: "Lifecycle",    href: "/employee-lifecycle", icon: ic(Users), pageCode: "EMPLOYEE_LIFECYCLE", description: "Employee lifecycle",
        children: [
          { label: "Employee Journey",   href: "/employee-stat-card",    icon: ic(Users),     description: "Journey" },
          { label: "Employee Lifecycle", href: "/employee-lifecycle",    icon: ic(Users),     pageCode: "EMPLOYEE_LIFECYCLE", roles: ["admin","hr"], description: "Lifecycle" },
          { label: "Career Planning",    href: "/career-planning",       icon: ic(TrendingUp),pageCode: "CAREER_PLANNING",   description: "Career paths" },
          { label: "Exit Command Center",href: "/exit/command-center",   icon: ic(UserMinus), pageCode: "EXIT_COMMAND_CENTER", description: "Exit ops" },
          { label: "Exit Management",    href: "/exit-management",       icon: ic(UserMinus), roles: ["admin","hr"],         description: "Exit" },
          { label: "Maternity Leave",    href: "/maternity-leave",       icon: ic(Heart),     roles: ["admin","hr"],         description: "Maternity" },
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
        ],
      },
      {
        label: "WFM & Roster",  href: "/wfm/roster", icon: ic(Clock), pageCode: "WFM_ROSTER", description: "Workforce management",
        children: [
          { label: "Roster Planning",        href: "/wfm/roster",                icon: ic(Clock),         pageCode: "WFM_ROSTER",      description: "Roster" },
          { label: "Auto Roster",            href: "/wfm/auto-roster",           icon: ic(Calendar),      pageCode: "WFM_AUTO_ROSTER", description: "Auto roster" },
          { label: "Roster Master Builder",  href: "/roster-master-builder",     icon: ic(Calendar),      pageCode: "ROSTER_MASTER",   description: "Build roster masters" },
          { label: "Roster Capacity Config", href: "/roster-capacity-config",    icon: ic(Settings2),     pageCode: "ROSTER_MASTER",   description: "Capacity settings" },
          { label: "Roster Dispute Queue",   href: "/wfm/roster-dispute-queue",  icon: ic(ClipboardList), roles: ["admin","hr","wfm","manager","branch_head","super_admin"], description: "Roster disputes" },
          { label: "Week-off Day Rules",     href: "/wfm/weekoff-day-rules",     icon: ic(CalendarDays),  roles: ["admin","hr","wfm","manager","super_admin"], description: "Day-level rules" },
          { label: "WFM Planning Rules",     href: "/wfm/planning-rules",        icon: ic(Settings2),     roles: ["admin","hr","wfm","manager","super_admin"], description: "Shift planning rules" },
          { label: "Slot Requirements",      href: "/wfm/slot-requirements",     icon: ic(Calendar),      roles: ["admin","hr","wfm","manager","super_admin"], description: "Slot capacity" },
          { label: "Workforce Planning",     href: "/workforce-planning",        icon: ic(Users),         pageCode: "WFM_AUTO_ROSTER", description: "Headcount planning" },
        ],
      },
      {
        label: "Live Monitoring", href: "/wfm/live-tracker", icon: ic(Activity), pageCode: "WFM_LIVE_TRACKER", description: "Live tracking",
        children: [
          { label: "WFM Tracker",           href: "/wfm/live-tracker",          icon: ic(Clock),     pageCode: "WFM_LIVE_TRACKER", description: "Live" },
          { label: "RTA Board",             href: "/rta-board",                 icon: ic(Activity),  pageCode: "RTA_BOARD",        description: "RTA" },
          { label: "Attendance Exceptions", href: "/wfm/attendance-exceptions", icon: ic(Clock),     pageCode: "WFM_LIVE_TRACKER", description: "Exception engine" },
          { label: "COSEC Monitoring",      href: "/wfm/cosec-monitoring",      icon: ic(Activity),  pageCode: "WFM_LIVE_TRACKER", description: "Biometric sync" },
        ],
      },
    ],
  },

  /* ── OPERATIONS ───────────────────────────────────────────── */
  {
    title: "Operations",
    items: [
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
          { label: "Performance",          href: "/performance",                icon: ic(Target),       description: "Performance" },
          { label: "Performance Command",  href: "/performance/command-center", icon: ic(Target),       pageCode: "WORKFORCE_COMMAND_CENTER", description: "Perf command" },
          { label: "Agent Performance",    href: "/agent-performance",          icon: ic(Activity),     roles: ["admin","hr","ceo","qa","analyst","manager","process_manager","branch_head"], description: "Cross-source KPI" },
          // Goals, Reviews Management, PIP Management removed per business requirement
          { label: "KPI Config",           href: "/kpi-config",                 icon: ic(Target),       pageCode: "KPI_CONFIG", roles: ["admin","hr","manager","process_manager"], description: "KPI" },
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
          { label: "Payroll Readiness",     href: "/payroll/readiness",            icon: ic(CreditCard), pageCode: "PAYROLL",  roles: ["admin","hr","finance","payroll"], description: "Payroll readiness" },
          { label: "HO Queues",             href: "/payroll/ho-queues",            icon: ic(ClipboardList), roles: ["admin","hr","finance","payroll","super_admin"],   description: "HO approval queues" },
          { label: "Full & Final",          href: "/payroll/full-final",           icon: ic(Zap),        roles: ["admin","hr","finance","payroll"],                    description: "F&F" },
          { label: "Salary Packages",       href: "/payroll/salary-packages",      icon: ic(Wallet),     roles: ["admin","finance"],                                  description: "Pay matrix" },
          { label: "Statutory Config",      href: "/payroll/statutory-config",     icon: ic(Landmark),   roles: ["admin","hr","finance"],                             description: "Statutory" },
          { label: "Compliance",            href: "/compliance/statutory",         icon: ic(Landmark),   roles: ["admin","hr","finance"],                             description: "Compliance" },
          { label: "Labour Compliance",     href: "/compliance/labour",            icon: ic(Landmark),   pageCode: "LABOUR_COMPLIANCE", roles: ["admin","hr","finance"], description: "Labour" },
        ],
      },
      {
        label: "Finance",      href: "/finance/grn", icon: ic(DollarSign), roles: ["admin","finance","super_admin"], description: "Finance & procurement",
        children: [
          { label: "GRN Management",          href: "/finance/grn",                      icon: ic(ShoppingCart), roles: ["admin","finance","super_admin"], description: "Goods receipt notes" },
          { label: "Vendor Payments",         href: "/finance/vendor-payment-tracking",  icon: ic(DollarSign),   roles: ["admin","finance","super_admin"], description: "Vendor payment tracking" },
        ],
      },
      {
        label: "Management",   href: "/management/dashboard", icon: ic(BarChart3), pageCode: "MANAGEMENT_DASHBOARD", description: "Management dashboards",
        children: [
          { label: "Management Dashboard",     href: "/management/dashboard",          icon: ic(BarChart3),  pageCode: "MANAGEMENT_DASHBOARD",   description: "Management" },
          { label: "CEO Command Center",       href: "/management/ceo-command-center", icon: ic(BarChart3),  roles: ["admin","hr","ceo","finance","process_manager","manager"], description: "CEO dashboard" },
          { label: "Business Command Center",  href: "/business-command-center",       icon: ic(Briefcase),  roles: ["admin","ceo","hr","manager","process_manager"],           description: "Business ops center" },
          { label: "Business Actions",         href: "/business-actions",              icon: ic(ClipboardList), roles: ["admin","ceo","hr","manager","process_manager","team_leader","tl"], description: "Action queue" },
          { label: "Control Tower",            href: "/control-tower",                 icon: ic(Activity),   pageCode: "CONTROL_TOWER",          description: "Control tower" },
          { label: "Master Reports",           href: "/master-reports",                icon: ic(BarChart3),  pageCode: "ADVANCED_REPORTS",       description: "Master reports" },
          { label: "Advanced Reports",         href: "/advanced-reports",              icon: ic(BarChart3),  pageCode: "ADVANCED_REPORTS",       description: "Advanced reports" },
          { label: "Enterprise Reports",       href: "/reports/enterprise",            icon: ic(BarChart3),  pageCode: "ADVANCED_REPORTS",       description: "Enterprise reports" },
          { label: "People Experience",        href: "/people-experience/command-center", icon: ic(Users),   pageCode: "PEOPLE_EXPERIENCE",      description: "People ops" },
        ],
      },
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
          { label: "DPDP / Privacy",   href: "/compliance/dpdp",            icon: ic(ShieldCheck),roles: ["admin","hr"],       description: "DPDP" },
          { label: "Audit Log",        href: "/audit-log",                  icon: ic(FileText),   roles: ["admin","super_admin","payroll_head","hr","wfm"], description: "Audit trail" },
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
          { label: "Assets",           href: "/assets",             icon: ic(Package),                                      description: "Assets" },
          { label: "Assets Manager",   href: "/assets-manager",     icon: ic(Package),   pageCode: "ASSETS_MANAGER",        description: "Asset management" },
          { label: "Mobility",         href: "/mobility",           icon: ic(Users),     pageCode: "MOBILITY",              description: "Mobility" },
          { label: "ERP",              href: "/erp",                icon: ic(Server),    pageCode: "ERP",                   description: "ERP" },
          { label: "Portal Data Mgr",  href: "/portal-data-manager",icon: ic(Server),    pageCode: "PORTAL_DATA_MANAGER",   description: "Portal data" },
          { label: "WFM Extensions",   href: "/wfm/extensions",     icon: ic(Settings2), pageCode: "WFM_EXTENSIONS",        description: "WFM extensions" },
        ],
      },
    ],
  },
];
