import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  BookOpen, Users, UserPlus, DollarSign, Calendar, BarChart3, Settings,
  ShieldCheck, Briefcase, Target, GraduationCap, ClipboardList, ChevronDown,
  ChevronRight, Search, Star, Lightbulb, ArrowRight, Users2, FileText,
  Clock, TrendingUp, CreditCard, Building2, Package, Zap, CheckCircle2,
  AlertCircle, Info, HelpCircle, Play,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type GuideStep = { step: number; action: string; detail?: string };

type GuideActivity = {
  id: string;
  title: string;
  description: string;
  path?: string;
  steps: GuideStep[];
  screenGuide?: string;
  example: string;
  tip?: string;
};

type GuideModule = {
  id: string;
  title: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  borderColor: string;
  activities: GuideActivity[];
};

type RoleGuide = {
  roleLabel: string;
  description: string;
  modules: GuideModule[];
};

// ─── Guide Data ───────────────────────────────────────────────────────────────

const GUIDE_DATA: Record<string, RoleGuide> = {

  // ─── SUPER ADMIN ───────────────────────────────────────────────────────────
  super_admin: {
    roleLabel: "Super Admin",
    description: "Full platform control — user management, configuration, security, audit, and all modules across every branch and department. You see everything; you approve everything.",
    modules: [
      {
        id: "sa-user-mgmt",
        title: "User Management & Access Control",
        icon: <Users className="h-4 w-4" />,
        color: "#6366f1",
        bgColor: "from-indigo-50 to-purple-50",
        borderColor: "border-indigo-200",
        activities: [
          {
            id: "create-user",
            title: "Create a New User Account",
            description: "Add a new employee login with the correct role and branch scope.",
            path: "/super-admin/page-access",
            steps: [
              { step: 1, action: "Go to Admin → Access Control", detail: "Menu path: Settings → Access Control — only Super Admins see this." },
              { step: 2, action: "Search the employee by name or EmpCode in the search bar." },
              { step: 3, action: "Click 'Assign Role', select the correct role from the dropdown (e.g. payroll, hr, wfm)." },
              { step: 4, action: "Set Branch scope if the role is branch-level (e.g. HR at Noida)." },
              { step: 5, action: "Save — the employee can now log in with their registered email and the default password." },
              { step: 6, action: "Notify the employee to reset their password on first login." },
            ],
            screenGuide: "The Access Control page shows a searchable table of all employees. Each row has a 'Role' badge column and an 'Actions' dropdown. The assign-role form slides in from the right.",
            example: "New Payroll Head joining Noida. Find her by EmpCode 'EMP1452', click Assign Role → select 'payroll' → Branch = Noida → Save. She logs in with her registered email.",
            tip: "Always assign the narrowest role that fits the job. A branch-level HR does not need Super Admin access.",
          },
          {
            id: "page-access",
            title: "Grant or Revoke Page Access for a Role",
            description: "Control which pages each role can see, beyond default role grants.",
            path: "/super-admin/page-access",
            steps: [
              { step: 1, action: "Go to Admin → Page Access (/super-admin/page-access)." },
              { step: 2, action: "Use the search box to find the page by its code or name (e.g. QUALITY_DASHBOARD)." },
              { step: 3, action: "Click the page row to open the role matrix panel on the right." },
              { step: 4, action: "Toggle the role ON or OFF in the matrix." },
              { step: 5, action: "Changes take effect on the user's next page load — no restart required." },
            ],
            screenGuide: "Left side shows a list of all page codes with their current role list. Right panel shows a grid of every role with a green/grey toggle for that page.",
            example: "You want Trainers to see the Quality Dashboard. Find 'QUALITY_DASHBOARD', open it, flip the 'trainer' toggle to ON. All Trainer-role users now see the Quality Dashboard in their sidebar.",
          },
          {
            id: "reset-password",
            title: "Reset an Employee's Password",
            description: "Force a password reset for an employee who is locked out or forgot their credentials.",
            path: "/super-admin/page-access",
            steps: [
              { step: 1, action: "Go to Access Control, find the employee." },
              { step: 2, action: "Click the three-dot menu on their row → 'Reset Password'." },
              { step: 3, action: "Confirm the reset — the system sets a temporary password and emails the employee." },
              { step: 4, action: "Alternatively, click 'Force Logout' to invalidate all active sessions." },
            ],
            screenGuide: "The three-dot menu on each user row reveals: Edit Role, Reset Password, Force Logout, Deactivate Account.",
            example: "Employee says they are locked out. Find them in Access Control, click Reset Password. They get an email with a one-time link to set a new password.",
          },
        ],
      },
      {
        id: "sa-org",
        title: "Organisation Setup",
        icon: <Building2 className="h-4 w-4" />,
        color: "#0ea5e9",
        bgColor: "from-sky-50 to-cyan-50",
        borderColor: "border-sky-200",
        activities: [
          {
            id: "add-branch",
            title: "Add a New Branch",
            description: "Register a new office location that employees, rosters and payroll can be linked to.",
            path: "/org-masters",
            steps: [
              { step: 1, action: "Go to Admin → Org Masters (/org-masters)." },
              { step: 2, action: "Click the 'Branches' tab at the top of the page." },
              { step: 3, action: "Click 'Add Branch' — a form opens." },
              { step: 4, action: "Fill: Branch Name, City, State, GST State Code (2-digit), and set Active = Yes." },
              { step: 5, action: "Save — the branch is now selectable in employee forms, rosters, and billing." },
            ],
            screenGuide: "Org Masters has six tabs: Branches, Departments, Designations, Cost Centers, Processes, Shifts. Each tab shows a searchable card grid.",
            example: "New office opening in Pune. Add branch 'Pune HO', State = Maharashtra, GST code 27, Active = Yes. All Pune employees and their roster entries can now be assigned here.",
          },
          {
            id: "add-designation",
            title: "Add Designations and Departments",
            description: "Maintain the official designation and department master lists used across profiles and payroll.",
            path: "/org-masters",
            steps: [
              { step: 1, action: "Go to Admin → Org Masters, select the 'Designations' tab." },
              { step: 2, action: "Click 'Add Designation', enter the title and the level/grade." },
              { step: 3, action: "Switch to the 'Departments' tab to add departments similarly." },
              { step: 4, action: "New designations and departments appear immediately in employee profile dropdowns." },
            ],
            screenGuide: "Each tab in Org Masters shows a table with an Add button in the top-right. The add form is an inline modal.",
            example: "New job title 'Senior Process Executive' is approved for band L3. Add it under Designations. HR Admins can now assign this designation during onboarding.",
          },
          {
            id: "holiday-calendar",
            title: "Configure the Holiday Calendar",
            description: "Set the official public holidays and optional/restricted holidays for the year.",
            path: "/calendar",
            steps: [
              { step: 1, action: "Go to Admin → Company Calendar or HR section → Holiday Calendar." },
              { step: 2, action: "Click 'Add Holiday' or 'Import Holiday List'." },
              { step: 3, action: "For each holiday: set date, name, type (National/Regional/Optional), and applicable branches." },
              { step: 4, action: "Publish the calendar — it becomes visible to all employees and affects leave deductions." },
              { step: 5, action: "Employees can see upcoming holidays on their attendance and leave pages." },
            ],
            screenGuide: "The calendar page shows a full 12-month calendar with colour-coded holiday markers. Clicking any date opens an edit popover.",
            example: "For FY 2026-27, upload the Maharashtra holiday list. Diwali (Oct 23) is marked as National; Gudhi Padwa (Mar 30) as Regional for Maharashtra branches only.",
          },
        ],
      },
      {
        id: "sa-employees",
        title: "Employee Management",
        icon: <Users2 className="h-4 w-4" />,
        color: "#10b981",
        bgColor: "from-emerald-50 to-green-50",
        borderColor: "border-emerald-200",
        activities: [
          {
            id: "add-employee",
            title: "Add a New Employee Manually",
            description: "Create a full employee profile with all details — personal, statutory, bank, and employment.",
            path: "/employees",
            steps: [
              { step: 1, action: "Go to Employees → click 'Add Employee' in the top-right." },
              { step: 2, action: "Fill Personal Info: full name, date of birth, gender, phone, personal email." },
              { step: 3, action: "Fill Employment Info: joining date, designation, department, branch, cost centre." },
              { step: 4, action: "Fill Statutory: PAN, Aadhaar, UAN number, bank account and IFSC." },
              { step: 5, action: "Upload joining documents: offer letter, ID proof, education certificates." },
              { step: 6, action: "Save and Generate EmpCode — the system auto-assigns the next code in sequence." },
            ],
            screenGuide: "The Add Employee form is a multi-step wizard with 5 tabs at the top: Personal, Employment, Statutory, Bank, Documents. Progress indicator shows your step.",
            example: "Anjali Sharma joins 01-Nov as Senior Process Executive at Noida for Axis Inbound. Fill all tabs, upload her Aadhaar and PAN, save. EmpCode EMP1531 generated.",
            tip: "Complete all statutory fields (PAN, Aadhaar, bank) before running the first payroll for the employee.",
          },
          {
            id: "bulk-upload-emp",
            title: "Bulk Upload Employee Data",
            description: "Import multiple employees at once from an Excel sheet — useful for large onboarding batches.",
            path: "/bulk-upload",
            steps: [
              { step: 1, action: "Go to Onboarding → Bulk Upload (/bulk-upload)." },
              { step: 2, action: "Download the Excel template by clicking 'Download Template'." },
              { step: 3, action: "Fill the template: one row per employee, all mandatory columns in order." },
              { step: 4, action: "Upload the filled sheet. The system validates each row and shows errors inline." },
              { step: 5, action: "Fix any errors (red rows), re-upload, then click 'Submit for Approval'." },
              { step: 6, action: "An authorised HR Admin reviews and approves the batch before records are created." },
            ],
            screenGuide: "Bulk Upload shows a drag-drop zone at the top, then a row-by-row validation grid below. Red rows have errors; green rows are ready.",
            example: "20 new Axis Inbound joiners. Download template, fill their details, upload. 18 rows pass; 2 have wrong IFSC codes. Fix those 2, re-upload. Submit. HR Admin approves.",
          },
          {
            id: "employee-transfer",
            title: "Transfer an Employee to Another Branch",
            description: "Move an employee to a new branch or process, updating their reporting structure.",
            path: "/employees",
            steps: [
              { step: 1, action: "Open the employee's profile from the Employees directory." },
              { step: 2, action: "Click the 'Transfer' action from the profile menu." },
              { step: 3, action: "Select: new branch, new department, new cost centre, and effective date." },
              { step: 4, action: "Optionally change the reporting manager." },
              { step: 5, action: "Save — the transfer is logged in the employee's career timeline with full audit." },
            ],
            screenGuide: "The Transfer form is a right-side drawer with dropdown fields. The career timeline on the profile tab shows a new entry after saving.",
            example: "Rahul is moving from Delhi to the Pune branch effective 01-Dec. Open his profile → Transfer → select Branch = Pune, Department = Operations, effective 01-Dec → Save.",
          },
        ],
      },
      {
        id: "sa-attendance",
        title: "Attendance Administration",
        icon: <Clock className="h-4 w-4" />,
        color: "#f59e0b",
        bgColor: "from-amber-50 to-yellow-50",
        borderColor: "border-amber-200",
        activities: [
          {
            id: "team-attendance",
            title: "View Team-Wide Attendance Grid",
            description: "See attendance status for every employee across all branches in a single grid.",
            path: "/wfm/team-attendance",
            steps: [
              { step: 1, action: "Go to Attendance → Team Attendance (/wfm/team-attendance)." },
              { step: 2, action: "Select the month and branch/process filter." },
              { step: 3, action: "The grid shows each employee as a row and each day as a column." },
              { step: 4, action: "Colour codes: Green = Present, Red = Absent, Blue = Leave, Grey = Week-off, Yellow = Late." },
              { step: 5, action: "Click any cell to see punch-in/out times and the status reason." },
            ],
            screenGuide: "A large grid — rows are employees, columns are dates. A colour legend appears at the top-right. Filtering dropdowns are at the top-left.",
            example: "It's 15-Nov. Open Team Attendance for the Noida branch. You see 3 employees in red (absent) on 13-Nov with no leave application — investigate with their TL.",
          },
          {
            id: "attendance-dispute",
            title: "Resolve an Attendance Dispute",
            description: "Review and decide on contested attendance records raised by employees.",
            path: "/attendance/disputes",
            steps: [
              { step: 1, action: "Go to Attendance → Attendance Disputes (/attendance/disputes)." },
              { step: 2, action: "See all open disputes listed by employee, date, and dispute reason." },
              { step: 3, action: "Click a dispute to see the employee's claim vs the biometric log." },
              { step: 4, action: "Review evidence (employee's reason, biometric data, supervisor comment)." },
              { step: 5, action: "Accept the correction or reject with a reason. The employee is notified." },
            ],
            screenGuide: "Disputes page shows a card list of open cases. Each card shows the date, type (Missing Punch, Wrong Time, etc.) and the employee's photo and name.",
            example: "Seema disputes 10-Oct as absent — she says the biometric failed. Dispute shows punch-in at 09:22, no punch-out. She provides a supervisor confirmation. Accept the dispute and mark as Present.",
          },
          {
            id: "attendance-lookup",
            title: "Look Up Any Employee's Attendance",
            description: "View detailed punch-by-punch attendance history for any individual.",
            path: "/hr/attendance-lookup",
            steps: [
              { step: 1, action: "Go to Attendance → Attendance Lookup (/hr/attendance-lookup)." },
              { step: 2, action: "Search by EmpCode or name." },
              { step: 3, action: "Select the date range." },
              { step: 4, action: "View: daily status, punch-in, punch-out, total hours, late marks." },
              { step: 5, action: "Export to Excel for payroll reconciliation if needed." },
            ],
            screenGuide: "Attendance Lookup shows a compact calendar month view on the left and a detailed punch log table on the right.",
            example: "Payroll query on EMP1102 — 5 days showing as absent in October. Use Attendance Lookup to verify biometric logs. 3 days had no biometric data at all — escalate to security for device check.",
          },
        ],
      },
      {
        id: "sa-payroll",
        title: "Payroll Administration",
        icon: <DollarSign className="h-4 w-4" />,
        color: "#ef4444",
        bgColor: "from-red-50 to-rose-50",
        borderColor: "border-red-200",
        activities: [
          {
            id: "run-payroll",
            title: "Initiate and Approve the Monthly Payroll Run",
            description: "Trigger the payroll computation for a given month and approve it for disbursement.",
            path: "/payroll-hr/dashboard",
            steps: [
              { step: 1, action: "Go to Payroll → Payroll Dashboard (/payroll-hr/dashboard)." },
              { step: 2, action: "Click 'New Payroll Run' and select the month (e.g. October 2026)." },
              { step: 3, action: "The system pre-checks: attendance data locked, salary revisions applied, LOP counts verified." },
              { step: 4, action: "Click 'Run Computation' — payroll calculates gross, deductions, net for every active employee." },
              { step: 5, action: "Review the summary: total gross, total deductions, total net. Check employee-level breakdown." },
              { step: 6, action: "Click 'Approve' to finalise. Payslips are generated and visible to employees." },
            ],
            screenGuide: "The Payroll Dashboard shows a monthly calendar on the left and a current run status panel on the right with a 5-step progress bar.",
            example: "October 31st. Run payroll for October. System shows 312 employees, gross ₹1.82 Cr, deductions ₹38L, net ₹1.44 Cr. Verify 5 new joiners are included. Approve. Payslips released at midnight.",
            tip: "Never approve if the pre-check shows red. Fix attendance locks or salary revision issues first.",
          },
          {
            id: "salary-config",
            title: "Configure Salary Slabs and Components",
            description: "Set up the salary structure: basic %, HRA %, allowances, PF, ESIC thresholds.",
            path: "/payroll-hr/dashboard",
            steps: [
              { step: 1, action: "Go to Payroll → Statutory Config or Salary Configuration." },
              { step: 2, action: "Select the applicable branch and effective date for the configuration." },
              { step: 3, action: "Set each component: Basic as % of CTC, HRA as % of Basic, Special Allowance as remainder." },
              { step: 4, action: "Set PF basis (Basic or actual), ESIC threshold (₹21,000 per month), PT slab by state." },
              { step: 5, action: "Save — new configuration applies from the set effective date onwards." },
            ],
            screenGuide: "Salary Configuration is a multi-section form with expandable panels for each component group. A preview panel on the right shows a sample payslip with the entered configuration.",
            example: "New statutory rule: PF ceiling increased. Open Salary Config, update PF wage ceiling to ₹15,000 effective 01-Apr-26. All employees earning above ₹15,000 basic will have PF capped at ₹1,800.",
          },
        ],
      },
      {
        id: "sa-ats",
        title: "ATS & Recruitment",
        icon: <Briefcase className="h-4 w-4" />,
        color: "#8b5cf6",
        bgColor: "from-violet-50 to-purple-50",
        borderColor: "border-violet-200",
        activities: [
          {
            id: "ats-overview",
            title: "Review the ATS Recruitment Pipeline",
            description: "Get a bird's-eye view of all active requisitions, candidate stages, and pending actions.",
            path: "/ats/command-center",
            steps: [
              { step: 1, action: "Go to ATS → ATS Command Center (/ats/command-center)." },
              { step: 2, action: "The dashboard shows: Open JRs by process, candidate funnel (Applied → Shortlisted → Offered → Joined)." },
              { step: 3, action: "Filter by branch or process to drill into a specific pipeline." },
              { step: 4, action: "Click any funnel stage number to see the candidate list at that stage." },
              { step: 5, action: "Use the 'Aging' filter to find candidates stuck at a stage for more than 3 days." },
            ],
            screenGuide: "The Command Center has a large funnel chart in the centre. Below it is a card grid per process showing JR count, candidates pending review, and offers outstanding.",
            example: "Axis Inbound has 47 candidates in screening, 12 pending ops round, 5 offers pending acceptance. Two offers are 8 days old — escalate to the hiring manager.",
          },
          {
            id: "offer-approval",
            title: "Approve an Offer Letter",
            description: "Review and approve an offer generated by Recruitment HR before it is sent to the candidate.",
            path: "/ats/offer-approvals",
            steps: [
              { step: 1, action: "Go to ATS → Onboarding → Offer Approvals (/ats/offer-approvals)." },
              { step: 2, action: "See pending offers listed by candidate, role, CTC, and the requesting recruiter." },
              { step: 3, action: "Click an offer to preview the full offer letter PDF." },
              { step: 4, action: "Verify: CTC within the approved band, joining date, designation, and branch are correct." },
              { step: 5, action: "Click Approve — the offer is sent to the candidate's email automatically." },
            ],
            screenGuide: "Offer Approvals shows a list of pending offers with status badges. Clicking any row opens a PDF preview in a right drawer with Approve/Reject buttons at the bottom.",
            example: "Meenakshi applied for Process Executive. Offer: CTC ₹2.2L, joining 01-Dec, Noida. CTC within band. Approve. She receives the email offer letter within 2 minutes.",
          },
        ],
      },
      {
        id: "sa-wfm",
        title: "WFM & Roster",
        icon: <Calendar className="h-4 w-4" />,
        color: "#0ea5e9",
        bgColor: "from-sky-50 to-blue-50",
        borderColor: "border-sky-200",
        activities: [
          {
            id: "roster-rules",
            title: "Configure Roster Rules for a Process",
            description: "Set minimum headcount, week-off pattern, minimum rest hours and shift constraints for a process.",
            path: "/wfm/roster-rules",
            steps: [
              { step: 1, action: "Go to WFM & Roster → Roster Rules (/wfm/roster-rules)." },
              { step: 2, action: "Select the process (e.g. Axis Inbound) from the dropdown." },
              { step: 3, action: "Set: Min Headcount per day, Week-off Pattern (Rotational/Fixed), Min Rest between shifts (hrs)." },
              { step: 4, action: "Add shift templates: Morning (09:00–18:00), Afternoon (13:00–22:00), Night (22:00–06:00)." },
              { step: 5, action: "Save — the Roster Builder will enforce these rules when Process Managers build weekly rosters." },
            ],
            screenGuide: "Roster Rules is a form with three sections: Headcount Constraints, Shift Templates, and Week-off Policy. Each section has inline validation.",
            example: "Axis Inbound must have minimum 15 agents on floor at all times. Set Min Headcount = 15, Week-off = Rotational (1 day/7), Min Rest = 10 hours. Save.",
          },
          {
            id: "live-tracker",
            title: "Monitor Live Attendance and Adherence",
            description: "See real-time who is present, absent, on break, or late across all processes.",
            path: "/wfm/live-tracker",
            steps: [
              { step: 1, action: "Go to Live Monitoring → WFM Tracker (/wfm/live-tracker)." },
              { step: 2, action: "The dashboard auto-refreshes every 60 seconds with live biometric data." },
              { step: 3, action: "Use branch and process filters to narrow the view." },
              { step: 4, action: "Red tiles = agents who should be on shift but are not yet punched in." },
              { step: 5, action: "Click any agent tile to see their shift schedule vs actual punch status." },
            ],
            screenGuide: "Live Tracker shows a coloured tile grid — one tile per agent. Green = On floor, Red = Absent/Late, Blue = Break, Orange = Approaching end of break.",
            example: "At 09:45 AM you see 8 red tiles for Axis Inbound. Click one — agent Suraj was scheduled 09:00 but no biometric. You notify his TL to follow up.",
          },
        ],
      },
      {
        id: "sa-exit",
        title: "Exit Management",
        icon: <UserPlus className="h-4 w-4" />,
        color: "#ef4444",
        bgColor: "from-red-50 to-orange-50",
        borderColor: "border-red-200",
        activities: [
          {
            id: "exit-overview",
            title: "Review All Active Exit Cases",
            description: "Get a consolidated view of every resignation, notice period status, and pending clearance.",
            path: "/exit/command-center",
            steps: [
              { step: 1, action: "Go to Lifecycle → Exit Command Center (/exit/command-center)." },
              { step: 2, action: "Filter by status: Submitted, Notice Period, Clearance Pending, Relieved." },
              { step: 3, action: "Click any case to see the full timeline: resignation date, notice end, clearance tasks." },
              { step: 4, action: "Check overdue clearance tasks — asset return, NOC from IT, salary dues." },
              { step: 5, action: "Escalate or reassign blocked tasks to the responsible department." },
            ],
            screenGuide: "Exit Command Center is a Kanban-style board with columns for each exit stage. Cards show employee name, process, and days remaining in notice.",
            example: "Vikram resigned on 01-Oct with 30-day notice. It is now 01-Nov. His clearance shows IT NOC pending for 12 days. Escalate to IT Head to unblock his F&F.",
          },
          {
            id: "ff-review",
            title: "Review Full & Final Settlement",
            description: "Verify the F&F calculation before final payout approval.",
            path: "/exit/command-center",
            steps: [
              { step: 1, action: "Open an exit case that has reached 'Clearance Complete' status." },
              { step: 2, action: "Click 'View F&F Calculation'." },
              { step: 3, action: "Review: salary for notice period, leave encashment, deductions (notice shortfall, asset loss)." },
              { step: 4, action: "If all is correct, click 'Approve F&F' — Payroll picks it up in the next run." },
              { step: 5, action: "If is_ff_provisional = true, click 'Mark as Final' after verifying all components." },
            ],
            screenGuide: "F&F Calculation is a detailed table showing each earning and deduction component. A summary bar at the bottom shows the net payable amount.",
            example: "Vikram's F&F: 2 days salary + 3 days leave encashment – notice shortfall 0 = net ₹8,400. Approve. Payroll includes in the November run.",
          },
        ],
      },
      {
        id: "sa-reports",
        title: "Reports & Audit Log",
        icon: <BarChart3 className="h-4 w-4" />,
        color: "#f59e0b",
        bgColor: "from-amber-50 to-yellow-50",
        borderColor: "border-amber-200",
        activities: [
          {
            id: "audit-log",
            title: "Review the System Audit Log",
            description: "See every state-changing action taken by any user — who did what, when, and what changed.",
            path: "/audit-log",
            steps: [
              { step: 1, action: "Go to Admin → Audit Log (/audit-log)." },
              { step: 2, action: "Filter by: date range, user, module (e.g. payroll, leave, exit), or action type (create/update/delete)." },
              { step: 3, action: "Click any log entry to see the before/after diff for the changed record." },
              { step: 4, action: "Export the filtered view to CSV for compliance documentation." },
            ],
            screenGuide: "Audit Log shows a reverse-chronological table with columns: Timestamp, User, Module, Action, Record ID. The diff panel opens as a right drawer.",
            example: "An employee disputes a payslip deduction. Filter Audit Log by module=payroll and employee EmpCode. Find the payroll run entry and see exactly which admin approved what values.",
          },
          {
            id: "reports-center",
            title: "Generate Any Module Report",
            description: "Access the central Reports Hub to generate, schedule, or download reports from all modules.",
            path: "/reports",
            steps: [
              { step: 1, action: "Go to Reports (/reports)." },
              { step: 2, action: "Browse the report library by category: HR, Payroll, Attendance, WFM, Quality, ATS, Exit." },
              { step: 3, action: "Click a report card, set date range and filters, click Generate." },
              { step: 4, action: "Download as Excel, PDF, or CSV." },
              { step: 5, action: "For recurring reports, click 'Schedule' to have the system email it weekly/monthly." },
            ],
            screenGuide: "Reports Hub is a card grid sorted by category. Each card shows the report name, output format icons, and an 'On-demand / Scheduled' badge.",
            example: "Month-end. Generate 'Monthly Attendance Register' for October, all branches. Download as Excel. Share with the compliance team for statutory audit.",
          },
        ],
      },
      {
        id: "sa-security",
        title: "Security & Audit",
        icon: <ShieldCheck className="h-4 w-4" />,
        color: "#6366f1",
        bgColor: "from-indigo-50 to-slate-50",
        borderColor: "border-indigo-200",
        activities: [
          {
            id: "two-factor",
            title: "Configure Two-Factor Authentication",
            description: "Enable or require 2FA for sensitive roles to protect the platform.",
            path: "/super-admin/page-access",
            steps: [
              { step: 1, action: "Go to Admin → Security Settings." },
              { step: 2, action: "Under '2FA Policy', choose: Off / Optional / Required for selected roles." },
              { step: 3, action: "Select which roles must use 2FA (recommend: super_admin, payroll, finance)." },
              { step: 4, action: "Save — users in those roles will be prompted to set up 2FA on next login." },
            ],
            screenGuide: "Security Settings is a single-page form with toggles per policy area: 2FA, Session Timeout, Password Complexity, IP Whitelist.",
            example: "Following a security review, require 2FA for super_admin and payroll roles. Enable it in Security Settings. Next time those users log in, they must verify via OTP.",
          },
          {
            id: "workflow-config",
            title: "Configure Approval Workflows",
            description: "Set up multi-stage approval chains for leave, exit, payroll, and expense workflows.",
            path: "/super-admin/page-access",
            steps: [
              { step: 1, action: "Go to Admin → Workflow Configuration." },
              { step: 2, action: "Select the workflow type (e.g. Leave Approval, Exit Clearance, Payroll Approval)." },
              { step: 3, action: "Define stages: select who approves at each stage, escalation timer, bypass rules." },
              { step: 4, action: "Save and activate — all new requests follow the new chain immediately." },
            ],
            screenGuide: "Workflow Config shows a drag-and-drop stage builder. Each stage is a card with approver role, escalation timer, and an optional bypass condition.",
            example: "Leave approval now needs 2 stages: Process Manager → Branch Head. Open Leave workflow, add Stage 2 approver = Branch Head, escalation at 24 hours. Save.",
          },
        ],
      },
      {
        id: "user-management",
        title: "User Management",
        icon: <Users className="h-4 w-4" />,
        color: "#6366f1",
        bgColor: "from-indigo-50 to-purple-50",
        borderColor: "border-indigo-200",
        activities: [
          {
            id: "create-user",
            title: "Create a New User Account",
            description: "Add a new employee login with the correct role and access level.",
            steps: [
              { step: 1, action: "Go to Admin → Access Control (Settings → Access Control)", detail: "Only Super Admins can see this menu item." },
              { step: 2, action: "Click 'New User' or locate the employee in the Employees list" },
              { step: 3, action: "Select the role from the dropdown (e.g. HR Admin, Payroll, WFM)" },
              { step: 4, action: "Set the branch scope if the role is branch-level" },
              { step: 5, action: "Save — the employee can now log in with their registered email" },
            ],
            example: "You hire a new Payroll Head at the Noida branch. Go to Access Control, find the employee, assign role 'payroll_head', set Branch = Noida, and save. They can now access the Payroll dashboard.",
            tip: "Always assign the narrowest role that fits the job. A Payroll HR at a branch doesn't need Super Admin.",
          },
          {
            id: "page-access",
            title: "Grant or Revoke Page Access",
            description: "Control which pages each role can see, beyond the default role grants.",
            steps: [
              { step: 1, action: "Go to Admin → Page Access (super-admin/page-access)" },
              { step: 2, action: "Search for the page by name or code (e.g. PAYROLL_PAYSLIPS)" },
              { step: 3, action: "Click the page to open its role matrix" },
              { step: 4, action: "Toggle access ON/OFF for the target role" },
              { step: 5, action: "Changes take effect on the user's next page load" },
            ],
            example: "You want Trainers to see the Quality Dashboard. Find 'QUALITY_DASHBOARD' in Page Access, enable the 'trainer' role, save. Trainers now see the menu item.",
          },
          {
            id: "module-access",
            title: "Manage Module-Level Permissions",
            description: "Enable or disable entire feature modules for specific roles or branches.",
            steps: [
              { step: 1, action: "Go to Admin → Module Access (super-admin/module-access)" },
              { step: 2, action: "Select the module from the list (e.g. Exit Management, ATS)" },
              { step: 3, action: "Assign the roles that should have access" },
              { step: 4, action: "Save changes" },
            ],
            example: "The client-portal module should be visible only to 'client' role. Open Module Access, find Client Portal, verify only 'client' is listed, remove any accidental HR grants.",
          },
        ],
      },
      {
        id: "org-setup",
        title: "Organisation Setup",
        icon: <Building2 className="h-4 w-4" />,
        color: "#0ea5e9",
        bgColor: "from-sky-50 to-cyan-50",
        borderColor: "border-sky-200",
        activities: [
          {
            id: "add-branch",
            title: "Add a New Branch",
            description: "Register a new office location that employees and rosters can be linked to.",
            steps: [
              { step: 1, action: "Go to Admin → Org Masters (/org-masters)" },
              { step: 2, action: "Click the 'Branches' tab" },
              { step: 3, action: "Click 'Add Branch', fill name, city, state, GST state code" },
              { step: 4, action: "Set whether the branch is active" },
              { step: 5, action: "Save — the branch is now selectable in employee forms and rosters" },
            ],
            example: "New office opening in Pune. Add branch 'Pune HO', state Maharashtra, GST code 27. All Pune employees can now be assigned to this branch.",
          },
          {
            id: "add-designation",
            title: "Add Designations and Departments",
            description: "Maintain the official designation and department master lists.",
            steps: [
              { step: 1, action: "Go to Admin → Org Masters, select 'Designations' tab" },
              { step: 2, action: "Click 'Add Designation', enter the title and level grade" },
              { step: 3, action: "Switch to 'Departments' tab to add departments similarly" },
              { step: 4, action: "Designations and departments are immediately available in employee profiles" },
            ],
            example: "New job title 'Senior Process Executive' is needed. Add it under Designations with grade L3. HR Admins can now assign this designation during onboarding.",
          },
        ],
      },
      {
        id: "security-audit",
        title: "Security & Audit",
        icon: <ShieldCheck className="h-4 w-4" />,
        color: "#ef4444",
        bgColor: "from-red-50 to-rose-50",
        borderColor: "border-red-200",
        activities: [
          {
            id: "audit-log",
            title: "Review the Audit Log",
            description: "See every state-changing action taken on the platform by all users.",
            steps: [
              { step: 1, action: "Go to Admin → Audit Log (/audit-log)" },
              { step: 2, action: "Filter by date range, user, module, or action type" },
              { step: 3, action: "Click any row to see full detail: who did what, when, and what changed" },
              { step: 4, action: "Export to CSV for compliance reporting if needed" },
            ],
            example: "An employee complains their leave was rejected without reason. Open Audit Log, filter by that employee's EmpCode and 'leave' module. You can see exactly who approved or rejected and at what time.",
          },
          {
            id: "fraud-alert",
            title: "Review Fraud Alerts",
            description: "Clear duplicate-identity or data-quality alerts that block employee creation.",
            steps: [
              { step: 1, action: "Go to Settings → Fraud Alerts (/settings/fraud-alerts)" },
              { step: 2, action: "Review each open alert — duplicate phone/Aadhaar/PAN checks" },
              { step: 3, action: "Investigate the flagged records, confirm if it's a legitimate duplicate or a false positive" },
              { step: 4, action: "Mark the alert as cleared with a reason note to unblock the employee's account" },
            ],
            example: "A candidate can't be created because their Aadhaar number matches an existing inactive employee. Review the alert, confirm the person is different, clear the flag, and the recruiter can proceed.",
          },
        ],
      },
      {
        id: "system-config",
        title: "System Configuration",
        icon: <Settings className="h-4 w-4" />,
        color: "#8b5cf6",
        bgColor: "from-violet-50 to-purple-50",
        borderColor: "border-violet-200",
        activities: [
          {
            id: "config-center",
            title: "Configuration Control Center",
            description: "View and manage all platform configuration flags in one place.",
            steps: [
              { step: 1, action: "Go to Admin → Config Center (/admin/configuration)" },
              { step: 2, action: "Browse categories: Payroll, Leave, Attendance, Communication, etc." },
              { step: 3, action: "Click a config item to view its current value and allowed options" },
              { step: 4, action: "Edit value, add an audit reason, and save" },
              { step: 5, action: "Changes are logged in the audit trail automatically" },
            ],
            example: "You need to enable LWP deduction based on calendar days (not working days). Find 'lwp_deduction_basis' in Config Center, switch value to 'calendar_days', save with reason 'Q4 policy update'.",
          },
          {
            id: "workflow-admin",
            title: "Manage Approval Workflows",
            description: "Configure multi-stage approval chains for leave, exit, expenses, and more.",
            steps: [
              { step: 1, action: "Go to Admin → Workflow Admin (/workflow-admin)" },
              { step: 2, action: "Select the workflow type (e.g. Leave Approval, F&F Settlement)" },
              { step: 3, action: "Define the stages: who approves at each stage, escalation time, and bypass rules" },
              { step: 4, action: "Save and activate the workflow" },
            ],
            example: "Leave approval now needs 2 stages: Team Leader → Branch Head. Open Leave workflow, add Stage 2 approver = Branch Head, set escalation at 24 hours. All new leave requests will follow this chain.",
          },
        ],
      },
    ],
  },

  // ─── HR ADMIN ─────────────────────────────────────────────────────────────
  hr: {
    roleLabel: "HR Admin",
    description: "End-to-end employee lifecycle — onboarding, attendance, leave, exit, BGV, documents, payroll support, and all HR compliance activities.",
    modules: [
      {
        id: "hr-emp",
        title: "Employee Management",
        icon: <Users className="h-4 w-4" />,
        color: "#6366f1",
        bgColor: "from-indigo-50 to-blue-50",
        borderColor: "border-indigo-200",
        activities: [
          {
            id: "add-employee",
            title: "Add a New Employee",
            description: "Create a full employee profile with all required fields.",
            steps: [
              { step: 1, action: "Go to People → Employees → Add Employee" },
              { step: 2, action: "Fill in personal details: name, DOB, gender, phone, email, Aadhaar, PAN" },
              { step: 3, action: "Set employment details: branch, department, designation, date of joining, reporting manager" },
              { step: 4, action: "Add bank account details for payroll" },
              { step: 5, action: "Upload joining documents: offer letter, degree, ID proof" },
              { step: 6, action: "Submit — the system assigns an Employee Code automatically" },
            ],
            example: "Ravi Kumar joins as Process Executive at Gurgaon branch on 01-Oct. Fill all fields, upload Aadhaar and degree, assign to Process Manager Amit Sharma. EmpCode GGN0045 is auto-generated.",
            tip: "All fields marked with a red asterisk are mandatory. Missing bank details will block payroll.",
          },
          {
            id: "employee-transfer",
            title: "Transfer an Employee to Another Branch",
            description: "Reassign an employee to a different branch, department, or reporting manager.",
            steps: [
              { step: 1, action: "Open the employee's profile (People → Employees, click the employee row)" },
              { step: 2, action: "Click 'Transfer' in the profile actions menu" },
              { step: 3, action: "Select new branch, new department, new designation (if changed), effective date" },
              { step: 4, action: "Add a reason for the transfer" },
              { step: 5, action: "Submit — the employee's history is preserved, new assignment is recorded" },
            ],
            example: "Priya Mehta is moving from Noida to Pune effective 15-Oct. Open her profile, click Transfer, select Pune branch, Inbound LOB, effective 15-Oct, reason 'Business Requirement'. Done.",
          },
          {
            id: "document-verification",
            title: "Verify Employee Documents",
            description: "Review and approve submitted joining documents.",
            steps: [
              { step: 1, action: "Go to People → Document Verification (/document-verification)" },
              { step: 2, action: "See all pending document uploads in the queue" },
              { step: 3, action: "Click a row to open the document drawer — view file inline" },
              { step: 4, action: "Mark each document as 'Verified' or 'Rejected' with a note" },
              { step: 5, action: "Fully verified employees are marked document-complete in their profile" },
            ],
            example: "New joiner uploaded a blurry Aadhaar photo. Open Document Verification, click their row, view the image, click 'Reject', note 'Photo unclear — re-upload needed'. They receive an automatic notification.",
          },
        ],
      },
      {
        id: "leave-attendance",
        title: "Leave & Attendance",
        icon: <Calendar className="h-4 w-4" />,
        color: "#10b981",
        bgColor: "from-emerald-50 to-green-50",
        borderColor: "border-emerald-200",
        activities: [
          {
            id: "approve-leave",
            title: "Approve or Reject Leave Requests",
            description: "Review and action all pending leave requests for your team or branch.",
            steps: [
              { step: 1, action: "Go to My Space → Leave or check your Work Inbox for pending actions" },
              { step: 2, action: "Open a leave request — the drawer shows dates, type, balance, and reason" },
              { step: 3, action: "Check attendance records for the period if needed" },
              { step: 4, action: "Click 'Approve' with optional remark, or 'Reject' with a mandatory reason" },
              { step: 5, action: "The employee is notified automatically" },
            ],
            example: "Sunita applies for 3 days CL from 20-25 Oct. Open the request — she has 4 CL balance. No attendance issues found. Click Approve. She is notified via system alert.",
          },
          {
            id: "regularize-attendance",
            title: "Regularize Employee Attendance",
            description: "Correct missed punches or wrong attendance status on behalf of an employee.",
            steps: [
              { step: 1, action: "Go to Attendance → Attendance Lookup (for any employee)" },
              { step: 2, action: "Search for the employee and select the date range" },
              { step: 3, action: "Identify the day with missing/wrong punch" },
              { step: 4, action: "Click 'Regularize', fill correct in/out times and reason" },
              { step: 5, action: "Submit for approval if your role requires it, or save directly" },
            ],
            example: "Ajay forgot to punch out on 12-Oct. His attendance shows 'Incomplete'. Go to Attendance Lookup, find him, click 12-Oct, regularize with punch-out 18:30, reason 'System glitch'.",
          },
        ],
      },
      {
        id: "exit-management",
        title: "Exit Management",
        icon: <UserPlus className="h-4 w-4" />,
        color: "#f59e0b",
        bgColor: "from-amber-50 to-yellow-50",
        borderColor: "border-amber-200",
        activities: [
          {
            id: "initiate-exit",
            title: "Initiate an Employee Exit",
            description: "Start the full exit workflow when an employee resigns or is terminated.",
            steps: [
              { step: 1, action: "Go to People → Exit Management" },
              { step: 2, action: "Click 'Initiate Exit', select the employee, type (Resignation/Termination/Absconding)" },
              { step: 3, action: "Fill last working day, notice period details, and any advance recovery" },
              { step: 4, action: "Assign clearance tasks to IT, Finance, Operations as required" },
              { step: 5, action: "Submit — the workflow routes clearance tasks to the relevant teams" },
            ],
            example: "Neha resigns on 01-Oct with LWD 31-Oct. Initiate exit, type Resignation, LWD 31-Oct, notice 30 days served in full. IT and Operations clearance tasks are auto-assigned.",
            tip: "F&F settlement is blocked until all clearance tasks are marked complete.",
          },
          {
            id: "ff-settlement",
            title: "Process Full & Final Settlement",
            description: "Calculate and approve F&F after all clearance is complete.",
            steps: [
              { step: 1, action: "Open the exit record from Exit Management" },
              { step: 2, action: "Confirm all clearance tasks are marked Done" },
              { step: 3, action: "Click 'Calculate F&F' — system shows earned salary, leave encashment, deductions" },
              { step: 4, action: "Review each line item, add any manual adjustments with reason" },
              { step: 5, action: "Submit for Payroll Head approval — they will release the payment" },
            ],
            example: "Neha's clearance is complete. Open her exit record, click Calculate F&F. System shows ₹48,500 earned salary + ₹3,200 leave encashment − ₹0 advance. Submit to Payroll Head for final sign-off.",
          },
        ],
      },
      {
        id: "letters",
        title: "HR Letters",
        icon: <FileText className="h-4 w-4" />,
        color: "#8b5cf6",
        bgColor: "from-violet-50 to-purple-50",
        borderColor: "border-violet-200",
        activities: [
          {
            id: "generate-letter",
            title: "Generate an Offer or Experience Letter",
            description: "Create, preview, and download official HR letters for employees.",
            path: "/offer-letter",
            steps: [
              { step: 1, action: "Go to ATS → Onboarding → Offer Letters (/offer-letter)." },
              { step: 2, action: "Click 'New Letter', select the letter type (Offer, Experience, Salary Certificate, NOC, etc.)." },
              { step: 3, action: "Search and select the employee by name or EmpCode." },
              { step: 4, action: "Fill any additional fields required for the letter type (effective date, CTC, designation)." },
              { step: 5, action: "Preview the letter — all profile fields are auto-populated from the employee record." },
              { step: 6, action: "Download PDF or send directly to the employee's registered email." },
            ],
            screenGuide: "Letter Generator shows a split view — letter type form on the left, live PDF preview on the right. The preview updates as you change fields.",
            example: "Mohan needs an experience letter after resignation. Select 'Experience Letter', pick Mohan (EMP0432), preview — shows joining date 12-Mar-2023, LWD 31-Oct-2026, designation. Download PDF.",
          },
        ],
      },
      {
        id: "hr-onboarding",
        title: "Onboarding & Joining",
        icon: <UserPlus className="h-4 w-4" />,
        color: "#10b981",
        bgColor: "from-emerald-50 to-green-50",
        borderColor: "border-emerald-200",
        activities: [
          {
            id: "onboarding-bridge",
            title: "Process a New Joiner via the Onboarding Bridge",
            description: "Confirm a candidate's joining and convert them into an active employee record.",
            path: "/ats/onboarding-bridge",
            steps: [
              { step: 1, action: "Go to ATS → Onboarding → Onboarding Bridge (/ats/onboarding-bridge)." },
              { step: 2, action: "Find the candidate with status 'Offer Accepted' and joining date today or earlier." },
              { step: 3, action: "Click 'Confirm Joining' — verify their EmpCode, branch, designation, and salary." },
              { step: 4, action: "Upload any missing joining documents (Aadhaar, PAN, degree, bank passbook)." },
              { step: 5, action: "Click 'Convert to Employee' — a full employee profile is created and EmpCode is assigned." },
              { step: 6, action: "Trigger IT Provisioning and Admin Provisioning tasks from the same screen." },
            ],
            screenGuide: "Onboarding Bridge shows a Kanban board — columns: Offer Accepted, Documents Pending, Ready to Join, Converted. Drag cards or click to act.",
            example: "Anjali is joining today as per her offer. Find her in the 'Offer Accepted' column. Click Confirm Joining, verify all details, upload her bank passbook. Click Convert. EmpCode EMP1541 created.",
            tip: "Do not convert until all statutory documents (Aadhaar + PAN) are uploaded — it blocks payroll month-1.",
          },
          {
            id: "joining-documents",
            title: "Track Joining Document Completeness",
            description: "Ensure every new joiner has submitted all required documents before going live.",
            path: "/ats/joining-documents-tracker",
            steps: [
              { step: 1, action: "Go to ATS → Onboarding → Joining Documents (/ats/joining-documents-tracker)." },
              { step: 2, action: "Filter by joining date range (e.g. this month's joiners)." },
              { step: 3, action: "The grid shows each new employee with a colour-coded document checklist." },
              { step: 4, action: "Green = uploaded & verified, Yellow = uploaded but unverified, Red = missing." },
              { step: 5, action: "Click any red cell to send a reminder to the employee or upload on their behalf." },
            ],
            screenGuide: "Joining Documents Tracker is a spreadsheet-style grid. Rows = employees, columns = document types. The header shows the total completion %.",
            example: "15 joiners this month. Filter by Oct 2026. See 3 employees with red PAN cells. Click each to send WhatsApp reminder: 'Please upload PAN card to complete your joining formalities'.",
          },
          {
            id: "appointment-letters",
            title: "Track Appointment Letter E-Signing",
            description: "Monitor which new employees have received and signed their appointment letters.",
            path: "/provisioning/appointment-letter",
            steps: [
              { step: 1, action: "Go to Onboarding → Appointment Letters (/provisioning/appointment-letter)." },
              { step: 2, action: "See the list of all employees with pending or completed e-sign." },
              { step: 3, action: "Green = signed, Red = not yet signed, Yellow = letter not yet sent." },
              { step: 4, action: "Click 'Resend' for anyone who hasn't signed within 3 days of joining." },
              { step: 5, action: "Download signed copies for your records." },
            ],
            screenGuide: "Appointment Letters page shows a table with columns: Employee Name, Letter Sent Date, Signed Date, Status badge. A bulk-resend button is at the top.",
            example: "10 new joiners from 01-Nov batch. 7 have signed. 3 haven't in 5 days. Click Bulk Resend for unsigned records — they each get a fresh email with e-sign link.",
          },
        ],
      },
      {
        id: "hr-bgv",
        title: "BGV & Document Compliance",
        icon: <ShieldCheck className="h-4 w-4" />,
        color: "#f59e0b",
        bgColor: "from-amber-50 to-yellow-50",
        borderColor: "border-amber-200",
        activities: [
          {
            id: "bgv-queue",
            title: "Process BGV (Background Verification) Queue",
            description: "Review and action pending BGV tasks for new and existing employees.",
            path: "/ats/bgv",
            steps: [
              { step: 1, action: "Go to Onboarding → BGV Verification (/ats/bgv)." },
              { step: 2, action: "The queue shows all employees with BGV status: Pending, In-Progress, Clear, Discrepancy." },
              { step: 3, action: "Click any record to see the specific checks: ID verification, education, previous employment." },
              { step: 4, action: "For discrepancies, open the details and decide: Escalate, Accept with note, or Reject (terminate)." },
              { step: 5, action: "Update the BGV status — it reflects on the employee's profile and the onboarding tracker." },
            ],
            screenGuide: "BGV Verification shows a card grid with colour-coded status badges. Each card shows the employee photo, check types completed vs pending, and days since initiation.",
            example: "Rajesh's BGV shows a discrepancy: his stated degree (B.Tech) is not matching the university records (Diploma). Open the case, review the uploaded certificate, mark as Discrepancy and escalate to HR Head.",
          },
          {
            id: "statutory-approvals",
            title: "Approve Statutory Detail Changes (PAN/Aadhaar/UAN)",
            description: "Review and approve employee requests to update sensitive statutory identifiers.",
            path: "/statutory-change-approvals",
            steps: [
              { step: 1, action: "Go to Onboarding → Statutory Detail Approvals (/statutory-change-approvals)." },
              { step: 2, action: "See all pending change requests: employee name, field changing, old value, new value." },
              { step: 3, action: "Click a request to see the uploaded proof document (new Aadhaar/PAN copy)." },
              { step: 4, action: "Verify the document is valid and matches the new value." },
              { step: 5, action: "Approve or Reject. If rejected, add a reason so the employee knows what to resubmit." },
            ],
            screenGuide: "Statutory Approvals is a list with before/after comparison for each changed field. The document proof opens in a side viewer.",
            example: "Divya requests a PAN update — she received a new card after name change post-marriage. Open her request, view the uploaded new PAN PDF, confirm name matches HR records, Approve.",
          },
        ],
      },
      {
        id: "hr-training",
        title: "Training & LMS Coordination",
        icon: <GraduationCap className="h-4 w-4" />,
        color: "#8b5cf6",
        bgColor: "from-violet-50 to-purple-50",
        borderColor: "border-violet-200",
        activities: [
          {
            id: "lms-batch",
            title: "Assign Employees to Training Batches",
            description: "Map new joiners to the appropriate training batch in the LMS system.",
            path: "/lms/coordinator",
            steps: [
              { step: 1, action: "Go to Learning → LMS Coordinator (/lms/coordinator)." },
              { step: 2, action: "Click 'Assign Batch', search by employee names or EmpCodes." },
              { step: 3, action: "Select the process/LOB (e.g. Axis Inbound), batch name, and batch start date." },
              { step: 4, action: "Confirm the assignment — this syncs with the external LMS and enrolls the learners." },
              { step: 5, action: "Verify the assignment by checking the batch roster in the LMS sync status section." },
            ],
            screenGuide: "LMS Coordinator shows a table of all active batches with learner counts. The 'Assign' button opens a search-and-select panel for employees not yet in any batch.",
            example: "8 new Axis Inbound joiners. Go to LMS Coordinator, click Assign Batch, select all 8 names, choose batch 'AX-NOV-B1' starting 04-Nov. Confirm. LMS enrols them in the Axis Inbound curriculum.",
          },
          {
            id: "lms-progress",
            title: "Monitor Training Progress and At-Risk Learners",
            description: "Track who is falling behind in training and take action before it affects quality.",
            path: "/lms/coordinator",
            steps: [
              { step: 1, action: "Go to Learning → LMS Coordinator, click the batch you want to review." },
              { step: 2, action: "See completion % per learner, MCQ scores, and an 'At Risk' flag for those below threshold." },
              { step: 3, action: "Click any learner row to see their module-by-module progress." },
              { step: 4, action: "For at-risk learners, add a comment or raise a support flag for the Trainer to follow up." },
              { step: 5, action: "Export the batch progress report to share with the Training Manager or Process Head." },
            ],
            screenGuide: "Batch progress view is a heatmap table — green cells = modules complete, yellow = in progress, red = not started. At-risk learners have a flame icon on their row.",
            example: "Week-2 review of AX-NOV-B1. 6 of 8 learners completed Module 2. 2 haven't started — one absent, one struggling with MCQs (42/100). Flag both as At Risk. Trainer follows up.",
          },
        ],
      },
    ],
  },

  // ─── RECRUITMENT HR ──────────────────────────────────────────────────────────
  recruitment_hr: {
    roleLabel: "Recruitment HR",
    description: "End-to-end hiring pipeline — job requisitions, candidate sourcing, interviews, offers, BGV, and onboarding handoff.",
    modules: [
      {
        id: "rhr-ats",
        title: "ATS & Candidate Pipeline",
        icon: <Briefcase className="h-4 w-4" />,
        color: "#6366f1",
        bgColor: "from-indigo-50 to-blue-50",
        borderColor: "border-indigo-200",
        activities: [
          {
            id: "ats-command",
            title: "Navigate the ATS Command Center",
            description: "Use the recruitment dashboard to see all open JRs, candidate counts, and pipeline health at a glance.",
            path: "/ats/command-center",
            steps: [
              { step: 1, action: "Go to ATS → ATS Command Center (/ats/command-center)." },
              { step: 2, action: "Review the funnel: Applied → Screened → HR Round → Ops Round → Offered → Joined." },
              { step: 3, action: "Each stage shows a count. Red numbers = candidates stuck > 3 days." },
              { step: 4, action: "Click any stage count to open the candidate list at that stage." },
              { step: 5, action: "Use the process/branch filter to narrow down to a specific LOB." },
            ],
            screenGuide: "The Command Center is a full-width dashboard with a funnel chart at the top, and a process-wise breakdown table below. Red badges highlight aging candidates.",
            example: "Monday morning review. Axis Inbound: 120 Applied, 45 Screened, 18 in HR Round (3 aging > 4 days), 5 in Ops Round, 3 Offered. Focus on the 3 aging HR Round candidates first.",
          },
          {
            id: "create-job",
            title: "Create a Job Opening",
            description: "Post a new position that candidates can apply to.",
            steps: [
              { step: 1, action: "Go to People & Hiring → ATS → Job Openings" },
              { step: 2, action: "Click 'New Opening', fill: title, department, branch, positions needed, CTC range" },
              { step: 3, action: "Set qualification requirements and skills" },
              { step: 4, action: "Set application deadline and whether it's open to internal/external candidates" },
              { step: 5, action: "Publish — the opening is now live on the candidate web form" },
            ],
            example: "Need 5 Process Executives for Hyderabad. Create opening: 'Process Executive', Hyderabad branch, 5 positions, CTC ₹15,000–₹18,000/month, minimum 10+2, published. Candidates can now apply online.",
          },
          {
            id: "sourcing",
            title: "Add Walk-In or Referred Candidates",
            description: "Manually add candidates sourced outside the online form.",
            steps: [
              { step: 1, action: "Go to ATS → Candidates → Add Candidate" },
              { step: 2, action: "Fill candidate details: name, phone, email, source (Walk-In, Referral, Vendor, etc.)" },
              { step: 3, action: "Link to the relevant job opening" },
              { step: 4, action: "Upload resume if available" },
              { step: 5, action: "The candidate appears in the pipeline at the 'Applied' stage" },
            ],
            example: "A candidate walks into the Noida office. Add them manually: Priya Singh, source Walk-In, link to 'Customer Service Executive' opening. They appear in pipeline at Applied stage.",
          },
        ],
      },
      {
        id: "candidate-pipeline",
        title: "Candidate Pipeline",
        icon: <Users2 className="h-4 w-4" />,
        color: "#0ea5e9",
        bgColor: "from-sky-50 to-cyan-50",
        borderColor: "border-sky-200",
        activities: [
          {
            id: "move-stage",
            title: "Move a Candidate Through Stages",
            description: "Advance or reject candidates as they progress through the hiring pipeline.",
            steps: [
              { step: 1, action: "Go to ATS → Pipeline — filter by opening or stage" },
              { step: 2, action: "Click a candidate row to open their full profile drawer" },
              { step: 3, action: "Review their details, resume, and assessment scores" },
              { step: 4, action: "Click 'Move to Next Stage' (Applied → Screening → Interview → Offer → Joining)" },
              { step: 5, action: "Or click 'Reject' with a mandatory reason code" },
            ],
            example: "After screening 20 applications, 8 pass. Select all 8, click Move → Interview. They receive interview scheduling notifications. The 12 who don't pass get rejection SMSes with reason 'Qualification mismatch'.",
          },
          {
            id: "schedule-interview",
            title: "Schedule an Interview",
            description: "Set up a time for the candidate to meet the hiring team.",
            steps: [
              { step: 1, action: "Open the candidate's drawer from the pipeline" },
              { step: 2, action: "Click 'Schedule Interview'" },
              { step: 3, action: "Select interview type (HR, Operations, Final), date, time, interviewer" },
              { step: 4, action: "Add interview location or video link" },
              { step: 5, action: "Save — candidate and interviewer receive notifications" },
            ],
            example: "Rahul passes screening. Schedule HR interview: 18-Oct 11:00 AM, interviewer = HR Priya Joshi, location Noida floor 3 meeting room. Both receive calendar invites.",
          },
        ],
      },
      {
        id: "offer-joining",
        title: "Offer & Joining",
        icon: <CheckCircle2 className="h-4 w-4" />,
        color: "#10b981",
        bgColor: "from-emerald-50 to-green-50",
        borderColor: "border-emerald-200",
        activities: [
          {
            id: "generate-offer",
            title: "Generate and Send an Offer Letter",
            description: "Create a formal offer letter once the candidate clears all rounds.",
            steps: [
              { step: 1, action: "Open the candidate's profile, click 'Generate Offer'" },
              { step: 2, action: "Fill: designation, CTC breakup (Basic, HRA, TA, allowances), joining date" },
              { step: 3, action: "Preview the offer letter — all details auto-populate into the template" },
              { step: 4, action: "Send to candidate's email or download PDF for physical handover" },
              { step: 5, action: "Candidate stage moves to 'Offer Extended'" },
            ],
            example: "Amita clears all rounds. Generate offer: Senior Process Executive, CTC ₹2.2L/year (Basic 50%, HRA 30%, TA ₹800, Other ₹500), joining 01-Nov. Send email. Stage = Offer Extended.",
          },
          {
            id: "convert-employee",
            title: "Convert a Joined Candidate to Employee",
            description: "When the candidate actually joins, convert their ATS record to a full employee profile.",
            steps: [
              { step: 1, action: "Open the candidate's ATS record, confirm stage = 'Joining'" },
              { step: 2, action: "Click 'Convert to Employee'" },
              { step: 3, action: "Verify pre-filled details (name, designation, branch, joining date)" },
              { step: 4, action: "Fill any missing fields (bank account, PF details)" },
              { step: 5, action: "Submit — an Employee Code is generated and HR Admin is notified to complete onboarding" },
            ],
            example: "Amita joins on 01-Nov. Open her ATS record, click Convert to Employee. All her offer details pre-fill. Add bank account number. Submit. EmpCode NOI0089 generated. HR gets notification to upload joining documents.",
          },
        ],
      },
    ],
  },

  // ─── PAYROLL ──────────────────────────────────────────────────────────────
  payroll: {
    roleLabel: "Payroll",
    description: "Monthly payroll computation, statutory compliance (PF/ESIC/TDS), payslip generation, salary revisions, reimbursements, and F&F settlements.",
    modules: [
      {
        id: "payroll-processing",
        title: "Payroll Processing",
        icon: <DollarSign className="h-4 w-4" />,
        color: "#10b981",
        bgColor: "from-emerald-50 to-green-50",
        borderColor: "border-emerald-200",
        activities: [
          {
            id: "run-payroll",
            title: "Run Monthly Payroll",
            description: "Compute salary for all active employees for a given month.",
            path: "/payroll-hr/dashboard",
            steps: [
              { step: 1, action: "Go to Payroll → Payroll Dashboard (/payroll-hr/dashboard)." },
              { step: 2, action: "Select the month and year (e.g. October 2026)" },
              { step: 3, action: "Select branch scope (All Branches or a specific branch)" },
              { step: 4, action: "Click 'Compute' — the system pulls attendance, leave, LWP, advances, and CTC data" },
              { step: 5, action: "Review the payroll register — check gross, deductions, net pay for each employee" },
              { step: 6, action: "Resolve any flagged exceptions (missing bank details, blocked employees)" },
              { step: 7, action: "Submit for Payroll Head approval to finalize" },
            ],
            example: "Running payroll for October 2026. Select Oct 2026, All Branches, click Compute. 284 employees computed, 3 flagged — 2 missing bank details, 1 blocked by F&F provisional. Resolve and recompute. Submit to Payroll Head.",
            tip: "Never finalize payroll until all exception flags are cleared. A single blocked record can affect the entire batch.",
          },
          {
            id: "salary-advances",
            title: "Process Salary Advances",
            description: "Record and recover salary advance payments made to employees.",
            steps: [
              { step: 1, action: "Go to Payroll → Advances" },
              { step: 2, action: "Click 'New Advance', select employee, amount, disbursement date" },
              { step: 3, action: "Set recovery plan: lump sum or EMI over N months" },
              { step: 4, action: "Get Payroll Head approval" },
              { step: 5, action: "The advance is automatically deducted in the configured payroll months" },
            ],
            example: "Vikram requests a ₹10,000 advance. Record it: Vikram Kumar, ₹10,000, disbursed 05-Oct. Recovery: 2 EMIs of ₹5,000 in Oct and Nov payroll. After Payroll Head approves, it auto-deducts in those two months.",
          },
        ],
      },
      {
        id: "statutory-compliance",
        title: "Statutory Compliance",
        icon: <ShieldCheck className="h-4 w-4" />,
        color: "#6366f1",
        bgColor: "from-indigo-50 to-purple-50",
        borderColor: "border-indigo-200",
        activities: [
          {
            id: "pf-esic",
            title: "PF and ESIC Verification",
            description: "Verify PF/UAN and ESIC deductions are computed correctly before submission.",
            steps: [
              { step: 1, action: "After running payroll, open the Statutory Summary from the payroll batch" },
              { step: 2, action: "Check PF deductions: employee 12%, employer 12% of Basic (capped at ₹1,800)" },
              { step: 3, action: "Check ESIC: employee 0.75%, employer 3.25% for employees earning ≤ ₹21,000 gross" },
              { step: 4, action: "Cross-verify with the ECR file download for PF portal submission" },
              { step: 5, action: "Flag any employees with wrong UAN or missing ESIC numbers to HR" },
            ],
            example: "October payroll shows 12 employees flagged for missing UAN. Pull the list, send to HR for UAN update. Recompute those 12 records after UAN is added.",
          },
          {
            id: "payslip-release",
            title: "Generate and Distribute Payslips",
            description: "Release payslips to all employees after payroll is finalized.",
            path: "/payroll/payslips",
            steps: [
              { step: 1, action: "After payroll is approved by Payroll Head, go to Payroll → Payslip Center (/payroll/payslips)." },
              { step: 2, action: "Select the month, confirm all records show status 'Finalized'." },
              { step: 3, action: "Click 'Generate All' — the system creates password-protected PDFs for every employee." },
              { step: 4, action: "Review a sample payslip to spot-check format and values." },
              { step: 5, action: "Click 'Release' — all employees can now download from My Space → Pay & Tax." },
              { step: 6, action: "An in-app notification is sent to all employees simultaneously." },
            ],
            screenGuide: "Payslip Center shows a month/year filter, a list of employees with their payslip status (Draft/Generated/Released), and a bulk-action bar at the bottom.",
            example: "October payroll approved by Payroll Head. Go to Payslip Center, select Oct 2026, click Generate All (284 PDFs created in ~90 seconds), spot-check Priya Kumar's slip, then click Release. Done.",
          },
        ],
      },
      {
        id: "payroll-statutory",
        title: "Statutory Compliance",
        icon: <ShieldCheck className="h-4 w-4" />,
        color: "#6366f1",
        bgColor: "from-indigo-50 to-purple-50",
        borderColor: "border-indigo-200",
        activities: [
          {
            id: "pf-ecr",
            title: "Generate PF ECR File for EPFO Portal",
            description: "Produce the monthly ECR (Electronic Challan-cum-Return) for PF submission.",
            path: "/payroll-hr/dashboard",
            steps: [
              { step: 1, action: "After payroll is finalized, go to Payroll → Statutory → PF." },
              { step: 2, action: "Select the month and click 'Generate ECR'." },
              { step: 3, action: "The system creates a .txt file in the EPFO-prescribed format." },
              { step: 4, action: "Download the ECR file and upload it to the EPFO unified portal (unifiedportal.epfindia.gov.in)." },
              { step: 5, action: "Upload the challan receipt back into HRMS as confirmation." },
            ],
            screenGuide: "PF Statutory section shows employee-wise PF wage, employee PF 12%, employer PF 12%, and EPS amounts. A Download ECR button is at the top-right.",
            example: "November 5th. Generate ECR for October. 284 employees, total PF liability ₹5.12L (employee) + ₹5.12L (employer). Download the .txt, upload to EPFO portal, pay challan, upload receipt back into HRMS.",
            tip: "Always cross-check UAN numbers before generating ECR. Any employee with a wrong/missing UAN will create a submission error.",
          },
          {
            id: "esic-return",
            title: "File ESIC Monthly Return",
            description: "Submit the ESIC contribution details and challan for eligible employees.",
            path: "/payroll-hr/dashboard",
            steps: [
              { step: 1, action: "Go to Payroll → Statutory → ESIC." },
              { step: 2, action: "Review employees eligible for ESIC (gross ≤ ₹21,000/month)." },
              { step: 3, action: "Verify each employee's ESIC number is recorded — flag missing ones to HR." },
              { step: 4, action: "Click 'Generate ESIC Return' — a CSV is created for the ESIC portal." },
              { step: 5, action: "Upload to ESIC Employer Portal (esic.in), pay challan, and upload receipt." },
            ],
            screenGuide: "ESIC page shows eligible employees sorted by Gross Salary. Red rows = missing ESIC number. A summary bar at the top shows total employee contribution (0.75%) and employer contribution (3.25%).",
            example: "October: 68 employees are ESIC eligible. 3 have missing ESIC numbers — HR updates them within the day. Re-run the calculation, generate return CSV, upload to ESIC portal.",
          },
          {
            id: "tds-projection",
            title: "Review TDS Deductions and Form 16",
            description: "Monitor annual TDS projections and generate Form 16 at year end.",
            path: "/payroll-hr/dashboard",
            steps: [
              { step: 1, action: "Go to Payroll → Statutory → TDS / Tax Declaration." },
              { step: 2, action: "Review each employee's declared investments vs projected TDS." },
              { step: 3, action: "For under-declarers, issue a reminder to submit investment proofs before February." },
              { step: 4, action: "At year-end (May), click 'Generate Form 16' for all employees." },
              { step: 5, action: "Download and distribute Form 16 PDFs to employees." },
            ],
            screenGuide: "TDS section shows a table with: employee name, projected annual tax, TDS deducted to date, balance to deduct, and an investment declaration status badge.",
            example: "January review: Priya Kumar's declared HRA exemption is ₹60,000 but her rent receipts are not yet submitted. Send automated reminder. If proofs not uploaded by Feb 28, TDS for March is adjusted upward.",
          },
        ],
      },
      {
        id: "payroll-revisions",
        title: "Salary Revisions",
        icon: <TrendingUp className="h-4 w-4" />,
        color: "#10b981",
        bgColor: "from-emerald-50 to-green-50",
        borderColor: "border-emerald-200",
        activities: [
          {
            id: "process-revision",
            title: "Process a Salary Revision",
            description: "Apply an approved salary revision for an employee, effective from a specific date.",
            path: "/payroll-hr/dashboard",
            steps: [
              { step: 1, action: "Go to Payroll → Salary Revisions. (These come as requests from HR or Branch Head.)" },
              { step: 2, action: "Open a pending revision request — see employee, old CTC, new CTC, effective date." },
              { step: 3, action: "Verify the revised breakup: new Basic, HRA, allowances all add up to the approved CTC." },
              { step: 4, action: "Click 'Apply Revision' — the new salary takes effect from the stated effective date." },
              { step: 5, action: "If effective date is mid-month, the system calculates pro-rata automatically for that month." },
            ],
            screenGuide: "Salary Revisions list shows old vs new CTC side by side. The effective date is highlighted in amber if it is mid-month (meaning pro-rata calculation is needed).",
            example: "Suresh gets a promotion effective 15-Nov with new CTC ₹3.2L (from ₹2.8L). Open the revision, verify breakup, click Apply. November payroll will pay him 14 days at old rate + 17 days at new rate.",
          },
        ],
      },
      {
        id: "payroll-reimbursements",
        title: "Reimbursements",
        icon: <CreditCard className="h-4 w-4" />,
        color: "#f59e0b",
        bgColor: "from-amber-50 to-yellow-50",
        borderColor: "border-amber-200",
        activities: [
          {
            id: "process-reimbursement",
            title: "Process Employee Reimbursement Claims",
            description: "Review and approve submitted expense reimbursement claims for inclusion in payroll.",
            path: "/payroll/reimbursements",
            steps: [
              { step: 1, action: "Go to Pay & Tax → Reimbursements (/payroll/reimbursements)." },
              { step: 2, action: "See all pending claims: employee, claim type (Travel, Medical, etc.), amount, uploaded receipt." },
              { step: 3, action: "Click a claim to review the receipt and verify the amount matches." },
              { step: 4, action: "Click Approve (or Reject with reason)." },
              { step: 5, action: "Approved reimbursements are automatically included in that month's payroll payout." },
            ],
            screenGuide: "Reimbursements page shows a filterable list of claims. Each row has a receipt thumbnail on the right side. Approved claims show a green badge; pending show yellow.",
            example: "Ankit submitted a ₹1,800 travel reimbursement for October. Open the claim, verify the auto-rickshaw bill photo, amounts match. Approve. The ₹1,800 appears as a separate line in his October payslip.",
          },
        ],
      },
    ],
  },

  // ─── FINANCE ──────────────────────────────────────────────────────────────
  finance: {
    roleLabel: "Finance",
    description: "Budget management, GRN/procurement, client billing, payment vouchers, vendor payments, bank reconciliation, GST returns, and finance reports.",
    modules: [
      {
        id: "budget",
        title: "Budget Management",
        icon: <BarChart3 className="h-4 w-4" />,
        color: "#f59e0b",
        bgColor: "from-amber-50 to-yellow-50",
        borderColor: "border-amber-200",
        activities: [
          {
            id: "create-budget",
            title: "Set a Branch Monthly Budget",
            description: "Allocate and approve the operational budget for each branch.",
            path: "/reports",
            steps: [
              { step: 1, action: "Go to Finance → Branch Budget." },
              { step: 2, action: "Select branch and finance year/month from the dropdowns — never use free text for these fields." },
              { step: 3, action: "Fill budget heads: Salary, Rent, Utilities, Consumables, Travel" },
              { step: 4, action: "Submit for Finance Head approval" },
              { step: 5, action: "Once approved, the budget is live and GRN requests are tracked against it" },
            ],
            example: "Setting Pune branch budget for Oct 2026. Select Pune, FY 2026-27, October. Fill: Salary ₹8.5L, Rent ₹90K, Utilities ₹25K, Consumables ₹15K. Submit to Finance Head.",
          },
        ],
      },
      {
        id: "grn",
        title: "GRN & Procurement",
        icon: <Package className="h-4 w-4" />,
        color: "#0ea5e9",
        bgColor: "from-sky-50 to-cyan-50",
        borderColor: "border-sky-200",
        activities: [
          {
            id: "create-grn",
            title: "Create a Goods Receipt Note (GRN)",
            description: "Record the receipt of goods or services from a vendor.",
            steps: [
              { step: 1, action: "Go to Finance → GRN" },
              { step: 2, action: "Click 'New GRN', select vendor from the dropdown, branch, and date" },
              { step: 3, action: "Add line items: item description, quantity, unit rate, GST%" },
              { step: 4, action: "Upload the vendor invoice PDF" },
              { step: 5, action: "Submit for Accounts Head approval — they verify GST and budget" },
            ],
            example: "Received 50 headsets from vendor Sennheiser for Hyderabad. Create GRN: vendor Sennheiser, Hyderabad branch, 50 units × ₹1,200 = ₹60,000 + 18% GST. Upload their invoice. Submit.",
          },
          {
            id: "approve-grn",
            title: "Approve a GRN (Accounts Head)",
            description: "Review and approve a submitted GRN after vendor/GST verification.",
            steps: [
              { step: 1, action: "Go to Finance → GRN → Pending Approvals" },
              { step: 2, action: "Click a GRN to open the drawer — review vendor GST, billing state, and line items" },
              { step: 3, action: "Check if GST registration matches the billing branch state" },
              { step: 4, action: "Click 'Approve' or 'Reject' with a reason" },
              { step: 5, action: "Approved GRNs are added to vendor payables" },
            ],
            example: "A GRN from Delhi vendor for Pune branch shows an IGST mismatch warning (vendor is Delhi-registered, branch is Pune — should be IGST, not CGST+SGST). Reject with reason 'GST type mismatch — vendor to reissue invoice'.",
          },
        ],
      },
      {
        id: "fin-payment-vouchers",
        title: "Payment Vouchers",
        icon: <CreditCard className="h-4 w-4" />,
        color: "#8b5cf6",
        bgColor: "from-violet-50 to-purple-50",
        borderColor: "border-violet-200",
        activities: [
          {
            id: "create-pv",
            title: "Create a Payment Voucher",
            description: "Raise a payment voucher for a vendor or internal expense that needs disbursement.",
            path: "/reports",
            steps: [
              { step: 1, action: "Go to Finance → Payment Vouchers." },
              { step: 2, action: "Click 'New Payment Voucher'. Select Voucher Type (Vendor Payment, Internal, Imprest)." },
              { step: 3, action: "Select Vendor from the dropdown. Do NOT type a vendor name — it must come from the vendor master." },
              { step: 4, action: "Enter amount, bank account (from dropdown), payment mode (NEFT/IMPS/Cheque), and narration." },
              { step: 5, action: "Attach the invoice/bill PDF." },
              { step: 6, action: "Submit for Accounts Head approval." },
            ],
            screenGuide: "Payment Voucher form is a multi-section card. Vendor and bank account fields are searchable dropdowns — never free text. A voucher number is auto-generated after submission.",
            example: "Paying headset vendor ₹72,000 for a GRN that was approved last week. Create PV: Type = Vendor Payment, Vendor = Sennheiser India, Amount ₹72,000, NEFT, narrate 'GRN #GRN-2024-0104'. Attach invoice. Submit.",
            tip: "Finance Year and Month fields must ALWAYS be selected from dropdowns — typing 2026-27 vs 2026-2027 creates duplicate scope keys that break invoice numbering.",
          },
          {
            id: "approve-pv",
            title: "Approve a Payment Voucher (Accounts Head)",
            description: "Review and approve a submitted payment voucher before bank transfer.",
            path: "/reports",
            steps: [
              { step: 1, action: "Go to Finance → Payment Vouchers → Pending Approvals." },
              { step: 2, action: "Click a voucher to see the full detail: vendor, amount, bank, invoice." },
              { step: 3, action: "Verify: invoice attached, amount matches GRN, GST is correctly accounted." },
              { step: 4, action: "Click Approve — the payment is queued for bank processing." },
              { step: 5, action: "Click Reject with reason if anything is incorrect — the submitter is notified." },
            ],
            screenGuide: "Pending Approval list shows vouchers in descending date order. Each card shows the vendor logo (if mapped), amount, and urgency badge (Overdue / Within Terms).",
            example: "Sennheiser PV arrives for approval. Open it, verify invoice amount ₹72,000 matches the GRN, GST type is IGST (correct for inter-state). Approve. Finance team processes the NEFT.",
          },
        ],
      },
      {
        id: "fin-client-billing",
        title: "Client Billing",
        icon: <FileText className="h-4 w-4" />,
        color: "#0ea5e9",
        bgColor: "from-sky-50 to-cyan-50",
        borderColor: "border-sky-200",
        activities: [
          {
            id: "create-invoice",
            title: "Create a Client Invoice (Proforma / Final)",
            description: "Generate a billing invoice for a client based on agreed rates and headcount.",
            path: "/reports",
            steps: [
              { step: 1, action: "Go to Finance → Client Billing → New Invoice." },
              { step: 2, action: "Select Client from the dropdown, Finance Year (dropdown), Month (dropdown — never free text)." },
              { step: 3, action: "Select Invoice Type: Proforma (draft) or Final (for submission)." },
              { step: 4, action: "Add line items: Service Description, Unit Rate, Quantity. GST is auto-calculated." },
              { step: 5, action: "Preview the invoice PDF, verify all client-specific fields (PO number, GST registration)." },
              { step: 6, action: "Submit — invoice number is auto-generated from the client-scope sequence." },
            ],
            screenGuide: "Client Billing shows a split view: form on the left with client/period selectors and line items, invoice PDF preview on the right (live preview updates as you type).",
            example: "Billing Axis Bank for October. Select Client = Axis Bank, FY = 2026-27, Month = Oct-26, Type = Final. Add line: 'BPO Services - Inbound Voice', 1 month, ₹12.8L. Preview shows invoice #AX/2026-27/007. Submit.",
          },
        ],
      },
    ],
  },

  // ─── WFM ──────────────────────────────────────────────────────────────────
  wfm: {
    roleLabel: "WFM (Workforce Management)",
    description: "Roster planning, attendance monitoring, real-time live tracking, capacity planning, TNI analysis, shift management, and shrinkage reporting.",
    modules: [
      {
        id: "roster",
        title: "Roster Planning",
        icon: <Calendar className="h-4 w-4" />,
        color: "#6366f1",
        bgColor: "from-indigo-50 to-blue-50",
        borderColor: "border-indigo-200",
        activities: [
          {
            id: "create-roster",
            title: "Create a Weekly Roster",
            description: "Build the shift roster for a process for the upcoming week.",
            path: "/wfm/roster-builder",
            steps: [
              { step: 1, action: "Go to WFM & Roster → Roster Builder (/wfm/roster-builder)." },
              { step: 2, action: "Select the process/LOB and week (next week's dates)" },
              { step: 3, action: "Click 'Create Roster' — the demand template loads from forecasting" },
              { step: 4, action: "Assign agents to shifts: drag-and-drop or use the allocation wizard" },
              { step: 5, action: "Review coverage gaps — the system highlights understaffed slots in red" },
              { step: 6, action: "Save as Draft, share with Process Manager for review" },
            ],
            example: "Building roster for 'Axis Inbound' for the week 20-26 Oct. Demand = 40 agents per shift. Assign 42 agents (buffer for predicted absenteeism). 2 slots are still short on Friday night — flag to Process Manager.",
            tip: "Always publish roster at least 3 days before the week starts. Late roster disrupts employee planning.",
          },
          {
            id: "publish-roster",
            title: "Publish and Lock a Roster",
            description: "Finalise the roster after Process Manager approval so employees can acknowledge it.",
            path: "/wfm/roster-workspace",
            steps: [
              { step: 1, action: "Open the draft roster in Roster Workspace (/wfm/roster-workspace), confirm Process Manager has approved." },
              { step: 2, action: "Click 'Publish' — employees receive a notification to acknowledge" },
              { step: 3, action: "Track acknowledgement rate — target 100% before week start" },
              { step: 4, action: "On Monday 00:01, click 'Lock' — no changes are allowed without a reason" },
              { step: 5, action: "Locked roster feeds into payroll as the attendance baseline" },
            ],
            example: "Roster for 20-26 Oct is approved. Click Publish at 17:00 on Thursday 17-Oct. 39/42 agents acknowledge by Friday evening. Follow up on 3. Lock on Monday morning.",
          },
        ],
      },
      {
        id: "attendance-monitoring",
        title: "Attendance Monitoring",
        icon: <Clock className="h-4 w-4" />,
        color: "#10b981",
        bgColor: "from-emerald-50 to-green-50",
        borderColor: "border-emerald-200",
        activities: [
          {
            id: "real-time-view",
            title: "Monitor Real-Time Floor Attendance",
            description: "See who is currently logged in, on break, or absent across the floor.",
            path: "/wfm/live-tracker",
            steps: [
              { step: 1, action: "Go to Live Monitoring → WFM Tracker (/wfm/live-tracker)." },
              { step: 2, action: "Filter by branch or process" },
              { step: 3, action: "View the heat map: green = logged in, amber = on break, red = absent" },
              { step: 4, action: "Click any agent row to see punch times, break history, and current status" },
              { step: 5, action: "Export real-time snapshot for ops reporting if needed" },
            ],
            example: "At 10:30 AM, WFM sees 8 agents red (absent) on the Axis Inbound floor. Click each to confirm they aren't on approved leave. 5 are on leave, 3 are AWOL. Notify Operations Manager for 3 AWOL agents.",
            screenGuide: "Live Tracker shows a coloured tile grid — one tile per scheduled agent. Green = punched in, Red = absent, Orange = on break, Grey = day off. A summary bar shows the floor headcount vs scheduled.",
          },
          {
            id: "team-attendance-wfm",
            title: "Review Team Attendance Grid for the Month",
            description: "Get the full month's attendance status for every employee across all processes.",
            path: "/wfm/team-attendance",
            steps: [
              { step: 1, action: "Go to Attendance → Team Attendance (/wfm/team-attendance)." },
              { step: 2, action: "Select month, branch, and process filter." },
              { step: 3, action: "The grid shows employee rows × date columns, colour-coded by status." },
              { step: 4, action: "Click any red (Absent) cell to see if there is a leave application on file." },
              { step: 5, action: "Export to Excel for payroll team or compliance reporting." },
            ],
            screenGuide: "Team Attendance grid is like a spreadsheet: rows = employees, columns = dates 1–31. Totals column on the right shows present count, absent count, and LOP days.",
            example: "Reviewing October for Axis Inbound. Grid shows employee Naveen with 7 red (absent) days. Click each — only 2 have approved leave. 5 are unmarked absences. Flag to Branch Head for LOP processing.",
          },
        ],
      },
      {
        id: "wfm-capacity",
        title: "Capacity & TNI Planning",
        icon: <Target className="h-4 w-4" />,
        color: "#8b5cf6",
        bgColor: "from-violet-50 to-purple-50",
        borderColor: "border-violet-200",
        activities: [
          {
            id: "capacity-dashboard",
            title: "Analyse Capacity vs Demand Gap",
            description: "See how your current headcount compares to the contracted mandate and forecast the hiring need.",
            path: "/wfm/capacity-dashboard",
            steps: [
              { step: 1, action: "Go to WFM & Roster → Capacity Dashboard (/wfm/capacity-dashboard)." },
              { step: 2, action: "Select the process and reporting period." },
              { step: 3, action: "View: Contracted headcount vs actual active employees vs attrition projection." },
              { step: 4, action: "The gap section shows how many new hires are needed to meet mandate." },
              { step: 5, action: "Use the output to raise Job Requisitions with the exact headcount required." },
            ],
            screenGuide: "Capacity Dashboard shows a bar chart: Mandate (target) in blue, Actual in green, Gap in red. Below is a process-wise breakdown table with attrition rate and projected gap for next 30/60/90 days.",
            example: "Axis Inbound mandate is 80. Current active = 72. Attrition projection = 4 more leaving next month. Hiring need = 12. Share this with Recruitment HR to open a JR for 12 Process Executives.",
          },
          {
            id: "tni-analysis",
            title: "Identify Training Needs via TNI Analysis",
            description: "Use the Training Needs Identification heatmap to find which agents need coaching on which parameters.",
            path: "/wfm/tni-analysis",
            steps: [
              { step: 1, action: "Go to WFM & Roster → Training Needs (TNI) (/wfm/tni-analysis)." },
              { step: 2, action: "Select the process and date range (typically last 30 days)." },
              { step: 3, action: "The heatmap shows agent × quality parameter, with red = consistently failing." },
              { step: 4, action: "Click any red cell to see the audit scores behind it." },
              { step: 5, action: "Export the TNI report and share with Trainer and Process Manager for targeted coaching." },
            ],
            screenGuide: "TNI Analysis is a heatmap grid — agents on rows, quality parameters (AHT, Opening, Product Knowledge, etc.) on columns. Dark red = severe gap, light yellow = minor gap, white = performing well.",
            example: "October TNI for Axis Inbound shows 8 agents with deep red in 'Product Knowledge'. 3 also have red for 'AHT'. Share with Trainer: prioritise product knowledge sessions for all 8 agents this week.",
          },
        ],
      },
    ],
  },

  // ─── BRANCH HEAD ──────────────────────────────────────────────────────────
  branch_head: {
    roleLabel: "Branch Head",
    description: "Branch-level ownership: team approvals (leave/exit/offers), roster sign-off, budget review, quality oversight, and escalation management.",
    modules: [
      {
        id: "team-management",
        title: "Team Management",
        icon: <Users className="h-4 w-4" />,
        color: "#6366f1",
        bgColor: "from-indigo-50 to-blue-50",
        borderColor: "border-indigo-200",
        activities: [
          {
            id: "view-my-team",
            title: "View Your Branch Team",
            description: "See all employees under your branch, their status, and today's attendance.",
            steps: [
              { step: 1, action: "Go to Overview → My Team (/my-team)" },
              { step: 2, action: "Filter by department, process, or status" },
              { step: 3, action: "Click any employee row to view their profile, attendance, and leave history" },
              { step: 4, action: "Use the 'Pending Actions' tab to see approvals waiting from you" },
            ],
            example: "Starting Monday morning, open My Team. See 3 leave requests pending your approval. Also notice 2 employees are marked 'On Notice Period' — check their exit clearance status.",
          },
          {
            id: "approve-leave-bh",
            title: "Approve Branch Leave Requests",
            description: "As second-level approver, review and approve leaves after Process Manager.",
            steps: [
              { step: 1, action: "Check Work Inbox — leave approvals needing Branch Head sign-off appear here" },
              { step: 2, action: "Click each request to see: employee, dates, leave type, balance, first approver's note" },
              { step: 3, action: "Check roster impact: is there already a shortage that day?" },
              { step: 4, action: "Approve or reject with a reason" },
            ],
            example: "3 agents from the same shift apply for the same day off. Process Manager approved all 3. As Branch Head, you see roster shows only 38 out of 40 needed that day — reject 1 with note 'Roster constraint, please reschedule'.",
          },
        ],
      },
      {
        id: "branch-budget",
        title: "Budget Oversight",
        icon: <BarChart3 className="h-4 w-4" />,
        color: "#f59e0b",
        bgColor: "from-amber-50 to-yellow-50",
        borderColor: "border-amber-200",
        activities: [
          {
            id: "view-budget-status",
            title: "Review Branch Budget vs Actuals",
            description: "Track how much of your monthly budget has been spent vs allocated.",
            path: "/reports",
            steps: [
              { step: 1, action: "Go to Finance → Branch Budget and filter to your branch." },
              { step: 2, action: "Filter to your branch and current month" },
              { step: 3, action: "View each budget head: allocated vs actual vs remaining" },
              { step: 4, action: "Drill into GRN records for any overspent category" },
            ],
            example: "It's 15-Oct. Open Branch Budget for Pune, Oct 2026. Consumables shows ₹18K spent vs ₹15K budget — already over. Click the row to see the GRN records. One large purchase was miscategorised. Flag to Finance.",
            screenGuide: "Branch Budget shows a table with budget heads as rows and four columns: Allocated, Approved GRNs, Pending GRNs, Remaining. The progress bar turns red when remaining drops below 10%.",
          },
        ],
      },
      {
        id: "bh-quality",
        title: "Quality & Performance Overview",
        icon: <ShieldCheck className="h-4 w-4" />,
        color: "#ef4444",
        bgColor: "from-red-50 to-rose-50",
        borderColor: "border-red-200",
        activities: [
          {
            id: "quality-review",
            title: "Review Branch Quality Scores",
            description: "Track the quality performance across all processes and teams under your branch.",
            path: "/quality-dashboard",
            steps: [
              { step: 1, action: "Go to Overview → Quality Dashboard (/quality-dashboard)." },
              { step: 2, action: "Filter to your branch — the default shows all processes you own." },
              { step: 3, action: "View process-wise quality scores, trend vs last month, and failing agents list." },
              { step: 4, action: "Click any process to drill down to team-level and then agent-level scores." },
              { step: 5, action: "For any process below the target (e.g. <80%), review the audit log and coaching plan." },
            ],
            screenGuide: "Quality Dashboard shows a card per process. Each card has a large quality score number, a trend arrow, and a list of top/bottom 3 agents. Red cards = below target, green = on track.",
            example: "Opening Quality Dashboard for Pune. Axis Inbound = 83% (green). HDFC Outbound = 74% (red). Click HDFC — bottom 3 agents have <65% scores. Schedule team review with the TL and QA for next morning.",
          },
          {
            id: "jd-approval",
            title: "Approve Job Requisitions",
            description: "Review and approve hiring requests from Process Managers before they reach Recruitment.",
            path: "/recruitment/job-requisition",
            steps: [
              { step: 1, action: "Check Work Inbox for pending JR approvals, or go to ATS → Job Requisitions (/recruitment/job-requisition)." },
              { step: 2, action: "Open each pending JR — see process, positions requested, reason, and priority." },
              { step: 3, action: "Verify the headcount gap justification matches your capacity dashboard data." },
              { step: 4, action: "Click Approve — the JR is released to Recruitment HR to start sourcing." },
              { step: 5, action: "Click Reject with a note if the business case is unclear or budget is insufficient." },
            ],
            screenGuide: "Job Requisitions list shows all JRs with status badges (Draft, Pending Branch Head, Approved, Active). Pending approval JRs have a yellow 'Action Required' badge.",
            example: "Process Manager raises JR for 5 Process Executives for Axis Inbound. Open the JR, verify capacity gap report shows 5 seats short, budget is allocated. Approve. Recruitment HR is notified to start sourcing.",
          },
        ],
      },
    ],
  },

  // ─── PROCESS MANAGER ──────────────────────────────────────────────────────
  process_manager: {
    roleLabel: "Process Manager",
    description: "Daily floor operations, first-level roster approval, team attendance and leave decisions, quality monitoring, training needs, and hiring requisitions.",
    modules: [
      {
        id: "daily-ops",
        title: "Daily Operations",
        icon: <Activity className="h-4 w-4" />,
        color: "#0ea5e9",
        bgColor: "from-sky-50 to-cyan-50",
        borderColor: "border-sky-200",
        activities: [
          {
            id: "daily-attendance-check",
            title: "Check Today's Attendance for Your Process",
            description: "Start of day review of who is present, absent, or late for your LOB.",
            path: "/wfm/team-attendance",
            steps: [
              { step: 1, action: "Go to WFM & Roster → Team Attendance (/wfm/team-attendance)." },
              { step: 2, action: "Filter to your process and today's date" },
              { step: 3, action: "Scan for red/amber entries — absent, late login, or missing punch" },
              { step: 4, action: "For each absent agent: check if leave is approved or if it is AWOL" },
              { step: 5, action: "Report AWOL agents to WFM and Branch Head immediately" },
            ],
            example: "At shift start, 2 agents are red. Click each: Agent A has approved CL, Agent B has no leave and no prior intimation — AWOL. Notify WFM to log it and inform Branch Head.",
          },
          {
            id: "roster-approval",
            title: "Approve the Weekly Roster",
            description: "Review the WFM-created roster before publication to your team.",
            steps: [
              { step: 1, action: "WFM will notify you when a draft roster is ready for your process" },
              { step: 2, action: "Go to Workforce → Roster, find the draft for your process and week" },
              { step: 3, action: "Review shift coverage vs client-contracted headcount" },
              { step: 4, action: "Flag any issues back to WFM (e.g. wrong shift for an employee on training)" },
              { step: 5, action: "Click 'Approve' — WFM can now publish it to employees" },
            ],
            example: "WFM sends roster for 20-26 Oct. You notice Agent Ritu is rostered for the night shift but is enrolled in a morning training session on Wed. Flag this to WFM to swap her shift. Once corrected, approve.",
          },
        ],
      },
      {
        id: "leave-management-pm",
        title: "Leave Approvals",
        icon: <CalendarDays className="h-4 w-4" />,
        color: "#10b981",
        bgColor: "from-emerald-50 to-green-50",
        borderColor: "border-emerald-200",
        activities: [
          {
            id: "approve-leave-pm",
            title: "First-Level Leave Approval for Your Team",
            description: "As the first approver, review and action leave requests from your agents.",
            steps: [
              { step: 1, action: "Check Work Inbox for pending leave approvals" },
              { step: 2, action: "Open each request — see dates, leave type, balance, and reason" },
              { step: 3, action: "Check roster coverage on the requested dates (is headcount still met?)" },
              { step: 4, action: "Approve or reject with a note. Branch Head reviews second-level approvals." },
            ],
            example: "Agent Sanjay applies for 2 CL on 22-23 Oct. Open request: balance 5 CL. Check roster — Oct 22 is already short by 1 due to another leave. Reject with note 'Roster constraint on 22-Oct. Please choose different dates.'",
            path: "/work-inbox",
          },
        ],
      },
      {
        id: "pm-quality",
        title: "Quality & Team Performance",
        icon: <ShieldCheck className="h-4 w-4" />,
        color: "#ef4444",
        bgColor: "from-red-50 to-rose-50",
        borderColor: "border-red-200",
        activities: [
          {
            id: "pm-team-quality",
            title: "Review Team Quality Scores",
            description: "Monitor quality audit results for your agents and identify coaching needs.",
            path: "/quality/team",
            steps: [
              { step: 1, action: "Go to Quality → Team Quality (/quality/team)." },
              { step: 2, action: "Filter by your process and the current month." },
              { step: 3, action: "See each agent's average quality score, number of audits, and trend." },
              { step: 4, action: "Click any agent to see their individual audit records and QA feedback." },
              { step: 5, action: "Agents scoring below 75% should be flagged for coaching." },
            ],
            screenGuide: "Team Quality is a table with quality score bars for each agent. Sort by score ascending to quickly identify bottom performers. A process average bar at the top shows team health.",
            example: "October team quality: Priya 91%, Suresh 82%, Rahul 71% (below threshold). Click Rahul — 3 audits, all scoring low on Product Knowledge. Raise a coaching request to QA for Rahul.",
          },
          {
            id: "pm-hiring-request",
            title: "Raise a Job Requisition",
            description: "Request new hiring when your team is short-staffed vs the contracted mandate.",
            path: "/recruitment/job-requisition",
            steps: [
              { step: 1, action: "Go to ATS → Job Requisitions (/recruitment/job-requisition)." },
              { step: 2, action: "Click 'New Requisition'." },
              { step: 3, action: "Fill: Process, Position, Number of Openings, Priority, Expected Joining Date, Reason." },
              { step: 4, action: "Attach any supporting data (capacity gap report, attrition log)." },
              { step: 5, action: "Submit — goes to Branch Head for approval." },
            ],
            screenGuide: "New Requisition is a simple form. The 'Reason' field is free text; all other fields (Process, Position, Priority) are dropdowns. An approver chain preview shows at the bottom of the form.",
            example: "Axis Inbound has 68 active agents vs 80 mandate. You need 12. Create JR: Process = Axis Inbound, Position = Process Executive, Openings = 12, Priority = High, Expected = 01-Dec. Submit to Branch Head.",
          },
        ],
      },
    ],
  },

  // ─── TRAINER ──────────────────────────────────────────────────────────────
  trainer: {
    roleLabel: "Trainer",
    description: "LMS batch coordination, trainee progress monitoring, MCQ performance tracking, training needs identification, and certification readiness.",
    modules: [
      {
        id: "training-assignment",
        title: "Training Assignment",
        icon: <GraduationCap className="h-4 w-4" />,
        color: "#8b5cf6",
        bgColor: "from-violet-50 to-purple-50",
        borderColor: "border-violet-200",
        activities: [
          {
            id: "assign-batch",
            title: "Assign a Batch to Training",
            description: "Link newly joined employees to the appropriate training batch in LMS.",
            path: "/lms/coordinator",
            steps: [
              { step: 1, action: "Go to Learning → LMS Coordinator (/lms/coordinator)." },
              { step: 2, action: "Identify new joiners who have been onboarded but not yet assigned a batch" },
              { step: 3, action: "Click 'Assign Batch', select the process/LOB, batch name, and start date" },
              { step: 4, action: "Confirm assignment — this syncs with the external LMS" },
              { step: 5, action: "The LMS auto-enrolls the employees in the correct curriculum" },
            ],
            example: "10 new joiners for Axis Inbound are ready for training. Assign them to 'AX-OCT-B3' batch starting 07-Oct. LMS receives the assignment and enrols them in the Axis Inbound Product module.",
          },
          {
            id: "track-progress",
            title: "Monitor Trainee Learning Progress",
            description: "Check where each trainee is in the curriculum — modules complete, MCQ scores, at-risk flag.",
            steps: [
              { step: 1, action: "Go to LMS dashboard in HRMS — shows progress synced from the LMS" },
              { step: 2, action: "Filter by batch or individual trainee" },
              { step: 3, action: "Look at completion %, MCQ scores, and the 'at risk' flag (red for trainees falling behind)" },
              { step: 4, action: "Click any trainee row to see module-by-module completion status" },
              { step: 5, action: "For at-risk trainees, schedule extra coaching or mark for extended training" },
            ],
            example: "Week 2 review: 8 of 10 trainees completed Module 2. 2 are behind (one was absent, one struggling with MCQs scoring <60%). Flag both as at-risk. Raise a support session for the MCQ underperformer.",
            path: "/lms/coordinator",
            screenGuide: "Batch progress view is a heatmap table — green = modules complete, yellow = in progress, red = not started. Clicking any learner row opens their module-by-module breakdown in a side drawer.",
          },
        ],
      },
      {
        id: "trainer-tni",
        title: "Training Needs & Progress Reports",
        icon: <BarChart3 className="h-4 w-4" />,
        color: "#0ea5e9",
        bgColor: "from-sky-50 to-cyan-50",
        borderColor: "border-sky-200",
        activities: [
          {
            id: "trainer-tni-action",
            title: "Act on TNI Recommendations",
            description: "Use the TNI analysis to prioritise which agents need coaching on which topics.",
            path: "/wfm/tni-analysis",
            steps: [
              { step: 1, action: "Go to WFM & Roster → Training Needs (TNI) (/wfm/tni-analysis)." },
              { step: 2, action: "Filter by your assigned process and the past 30 days." },
              { step: 3, action: "Identify the parameters with the most red cells (most agents failing)." },
              { step: 4, action: "Design a targeted module or coaching session for those parameters." },
              { step: 5, action: "Record the training delivery in LMS — mark it as completed for each agent." },
            ],
            screenGuide: "TNI heatmap rows = agents, columns = quality parameters. Sort by the column with the most red cells to find the biggest training gap. Export as Excel for training plan documentation.",
            example: "TNI shows 9 agents failing 'Product Knowledge' for Axis card policies. Conduct a 2-hour Product Refresh session on Friday. Record the session in LMS. Recheck TNI in 2 weeks to measure improvement.",
          },
          {
            id: "progress-report",
            title: "Generate a Training Progress Report",
            description: "Produce a weekly or monthly summary of batch completion, MCQ scores, and at-risk learners.",
            path: "/lms/coordinator",
            steps: [
              { step: 1, action: "Go to LMS Coordinator, select the batch." },
              { step: 2, action: "Click 'Export Progress Report'." },
              { step: 3, action: "Choose the date range (weekly or monthly)." },
              { step: 4, action: "The report shows: completion %, MCQ pass/fail, at-risk count, certification readiness." },
              { step: 5, action: "Share with HR Admin and Process Manager for operations handover decisions." },
            ],
            screenGuide: "The Export button generates a formatted Excel with colour-coded completion by module and a summary sheet with batch-level KPIs.",
            example: "Week 3 report for AX-OCT-B3: 9/10 learners ≥75% completion, MCQ pass rate 90%, 1 at-risk (medical leave week 2). Share with Process Manager — 9 are ready for floor certification by end of week.",
          },
        ],
      },
    ],
  },

  // ─── QA / QUALITY ANALYST ───────────────────────────────────────────────
  qa: {
    roleLabel: "QA / Quality Analyst",
    description: "Interaction auditing, quality scoring, coaching sessions, calibration, TNI-linked training requests, and quality reporting.",
    modules: [
      {
        id: "auditing",
        title: "Quality Auditing",
        icon: <ShieldCheck className="h-4 w-4" />,
        color: "#ef4444",
        bgColor: "from-red-50 to-rose-50",
        borderColor: "border-red-200",
        activities: [
          {
            id: "audit-call",
            title: "Audit an Agent Interaction",
            description: "Score a call or chat interaction against the quality rubric.",
            path: "/quality/dashboard",
            steps: [
              { step: 1, action: "Go to Quality → Quality Dashboard (/quality/dashboard)." },
              { step: 2, action: "Click 'New Audit', select agent, date, interaction ID" },
              { step: 3, action: "Score each parameter: Greeting, Product Knowledge, AHT, Compliance, Customer Satisfaction" },
              { step: 4, action: "Add specific feedback notes for each failed parameter" },
              { step: 5, action: "Submit — the agent sees the score in their personal dashboard" },
            ],
            example: "Auditing Rahul's call from 14-Oct. Score: Greeting 10/10, Product Knowledge 7/10 (wrong policy quoted), Compliance 10/10, AHT 8/10, CSAT 8/10. Total 43/50. Note: 'Review Axis Platinum card policy doc'.",
          },
          {
            id: "feedback-session",
            title: "Conduct a Coaching/Feedback Session",
            description: "Record a 1:1 feedback discussion with the agent after the audit.",
            steps: [
              { step: 1, action: "Open the completed audit record from the Quality Dashboard" },
              { step: 2, action: "Click 'Schedule Feedback Session'" },
              { step: 3, action: "Set date/time, confirm agent attendance" },
              { step: 4, action: "After the session, add session notes: what was discussed, agent's acknowledgement, improvement plan" },
              { step: 5, action: "Agent signs off on the notes digitally from their dashboard" },
            ],
            example: "After Rahul's 43/50 audit, schedule feedback on 15-Oct. Discuss the product knowledge gap. Note: 'Reviewed card policy, agent committed to re-certification MCQ by 21-Oct'. Agent acknowledges in system.",
            screenGuide: "Feedback Session form opens from the audit record. It has a date-time picker, attendance confirmation toggle, notes textarea, and a 'Require Agent Acknowledgement' checkbox.",
          },
        ],
      },
      {
        id: "quality-reports",
        title: "Quality Reports",
        icon: <BarChart3 className="h-4 w-4" />,
        color: "#f59e0b",
        bgColor: "from-amber-50 to-yellow-50",
        borderColor: "border-amber-200",
        activities: [
          {
            id: "weekly-quality-report",
            title: "Generate Weekly Quality Summary",
            description: "Produce a quality trend report for the process for the past week.",
            steps: [
              { step: 1, action: "Go to Reports Hub (/reports)" },
              { step: 2, action: "Select 'Quality Summary' from the reports library" },
              { step: 3, action: "Set date range (Mon–Sun of the target week), process, and LOB filter" },
              { step: 4, action: "Click Generate — the report shows agent-wise scores, average, and trend vs last week" },
              { step: 5, action: "Download Excel or PDF for sharing with Operations Manager and Branch Head" },
            ],
            example: "Week ending 19-Oct. Generate Quality Summary for Axis Inbound. Average score: 81% (up 2% vs last week). Top agent: Priya 92%. Bottom: Rahul 43% (being coached). Share with Branch Head.",
            path: "/reports",
            screenGuide: "Quality Summary report is a tabular download. The generated view shows an agent leaderboard, weekly score chart, and a parameter-wise breakdown at the bottom.",
          },
        ],
      },
      {
        id: "qa-call-master",
        title: "Call Master Analytics",
        icon: <BarChart3 className="h-4 w-4" />,
        color: "#6366f1",
        bgColor: "from-indigo-50 to-blue-50",
        borderColor: "border-indigo-200",
        activities: [
          {
            id: "inbound-dashboard",
            title: "Review Inbound Call Analytics",
            description: "Use Call Master data to correlate call volume, AHT, and quality scores.",
            path: "/call-master/inbound",
            steps: [
              { step: 1, action: "Go to Call Master → Inbound Dashboard (/call-master/inbound)." },
              { step: 2, action: "Select the date range and process filter." },
              { step: 3, action: "View: total calls handled, AHT (average handle time), abandon rate, FCR." },
              { step: 4, action: "Compare the AHT of agents who score high on quality vs those who score low." },
              { step: 5, action: "Agents with very low AHT but low quality often rush calls — flag for coaching." },
            ],
            screenGuide: "Inbound Dashboard shows a set of KPI tiles at the top (calls, AHT, abandon %) and an agent-wise table below. Clicking any agent tile filters the chart to their personal trend.",
            example: "Reviewing Oct data: Rahul handles 45 calls/day with AHT 3:10 (below target 4:30 — rushing). His quality score is 68%. This correlation confirms the coaching focus: slow down, use the checklist.",
          },
        ],
      },
    ],
  },

  // ─── EMPLOYEE ─────────────────────────────────────────────────────────────
  employee: {
    roleLabel: "Employee",
    description: "Your personal workspace in PeopleOS — attendance, leave, payslips, roster, learning, profile updates, and support requests.",
    modules: [
      {
        id: "my-profile",
        title: "My Profile",
        icon: <Users className="h-4 w-4" />,
        color: "#6366f1",
        bgColor: "from-indigo-50 to-blue-50",
        borderColor: "border-indigo-200",
        activities: [
          {
            id: "update-profile",
            title: "Update Your Personal Information",
            description: "Keep your contact details, address, and bank account up to date.",
            path: "/profile",
            steps: [
              { step: 1, action: "Click your avatar top-right, or go to My Space → Profile (/profile)." },
              { step: 2, action: "Click 'Edit' on the section you want to update (Personal / Bank / Address)" },
              { step: 3, action: "Make changes and save" },
              { step: 4, action: "Some changes (e.g. bank account) require HR Admin approval before taking effect" },
            ],
            example: "You changed your phone number. Go to Profile → Personal Info → Edit. Update phone to new number. Click Save. The change shows immediately for non-sensitive fields.",
          },
          {
            id: "view-documents",
            title: "View Your Employment Documents",
            description: "Download your offer letter, experience letter, and other HR documents.",
            steps: [
              { step: 1, action: "Go to My Space → Profile → Documents tab" },
              { step: 2, action: "See all documents linked to your profile" },
              { step: 3, action: "Click 'View' to open the document inline, or 'Download' for a copy" },
            ],
            example: "You need your offer letter for a bank account application. Go to Profile → Documents. Find 'Offer Letter — 01-Mar-2025'. Click Download. PDF is on your device.",
          },
        ],
      },
      {
        id: "attendance-leave",
        title: "Attendance & Leave",
        icon: <Calendar className="h-4 w-4" />,
        color: "#10b981",
        bgColor: "from-emerald-50 to-green-50",
        borderColor: "border-emerald-200",
        activities: [
          {
            id: "apply-leave",
            title: "Apply for Leave",
            description: "Submit a leave request for approval by your manager.",
            path: "/leaves",
            steps: [
              { step: 1, action: "Go to My Space → Leave → Apply Leave (/leaves)." },
              { step: 2, action: "Select leave type (Casual Leave, Earned Leave, Sick Leave, etc.) from the dropdown" },
              { step: 3, action: "Pick From and To dates using the date picker" },
              { step: 4, action: "Add reason in the text field" },
              { step: 5, action: "Submit — your Process Manager receives the approval request" },
            ],
            example: "You need 2 days off for a family event on 25-26 Oct. Go to Leave → Apply. Select Casual Leave (balance: 4), from 25-Oct to 26-Oct. Reason: 'Family function'. Submit. Your manager gets notified.",
            tip: "Check your leave balance before applying — the balance is shown when you select the leave type. You cannot apply for more days than your balance.",
          },
          {
            id: "view-attendance",
            title: "View and Check Your Attendance",
            description: "See your attendance record for the month and check for any discrepancies.",
            path: "/attendance",
            steps: [
              { step: 1, action: "Go to My Space → Attendance (/attendance)." },
              { step: 2, action: "The calendar view shows: Present (green), Absent (red), Leave (blue), Week-off (grey)" },
              { step: 3, action: "Click any day to see your punch-in and punch-out times" },
              { step: 4, action: "If you see a wrong or missing punch, click 'Regularize' on that day" },
              { step: 5, action: "Fill the correct times and reason, submit — your manager will approve it" },
            ],
            example: "You notice 14-Oct shows Incomplete. Click that day — punch-in is 09:15 but punch-out is blank. Click Regularize, enter correct punch-out 18:30, reason 'Biometric device issue'. Your TL approves it.",
          },
          {
            id: "view-payslip",
            title: "Download Your Payslip",
            description: "Access and download your monthly payslip.",
            path: "/profile?tab=payslips",
            steps: [
              { step: 1, action: "Go to My Space → Pay & Tax → Payslips (/profile?tab=payslips)." },
              { step: 2, action: "Select the month from the dropdown" },
              { step: 3, action: "Click 'Download' to get the PDF" },
              { step: 4, action: "You can also view it inline to check earnings and deductions before downloading" },
            ],
            example: "Need October payslip for a home loan application. Go to Pay & Tax → Payslips. Select October 2026. Click Download. PDF shows your salary breakup, PF, and TDS.",
          },
        ],
      },
      {
        id: "support",
        title: "Support & Helpdesk",
        icon: <HelpCircle className="h-4 w-4" />,
        color: "#f59e0b",
        bgColor: "from-amber-50 to-yellow-50",
        borderColor: "border-amber-200",
        activities: [
          {
            id: "raise-ticket",
            title: "Raise an IT or HR Support Ticket",
            description: "Log a support request for any system, hardware, or HR issue.",
            path: "/work-inbox",
            steps: [
              { step: 1, action: "Go to Support → Helpdesk." },
              { step: 2, action: "Click 'New Ticket'" },
              { step: 3, action: "Select Category (IT, HR, Payroll, etc.) from the dropdown" },
              { step: 4, action: "Select Sub-category (e.g. 'Desktop Issue — System Hang')" },
              { step: 5, action: "Describe the issue clearly, add screenshot if helpful" },
              { step: 6, action: "Submit — the relevant team is notified and you get a ticket number" },
            ],
            example: "Your system is hanging repeatedly. Go to Helpdesk, New Ticket, Category IT, Sub-category 'Desktop Issue — System Hang'. Describe: 'System freezes every 30 minutes since morning'. Submit. IT team gets the alert.",
            screenGuide: "Helpdesk form has a category dropdown, a sub-category that updates based on category, a description box, and an optional file attachment area.",
          },
        ],
      },
      {
        id: "emp-roster",
        title: "My Roster & Schedule",
        icon: <Calendar className="h-4 w-4" />,
        color: "#8b5cf6",
        bgColor: "from-violet-50 to-purple-50",
        borderColor: "border-violet-200",
        activities: [
          {
            id: "view-my-roster",
            title: "View Your Weekly Roster",
            description: "See your assigned shift schedule for the current and upcoming weeks.",
            path: "/my-roster",
            steps: [
              { step: 1, action: "Go to My Space → Attendance → My Roster (/my-roster)." },
              { step: 2, action: "The calendar shows your shift for each day of the week: Morning / Afternoon / Night / Week-off." },
              { step: 3, action: "Click any day to see your exact shift time (e.g. 09:00–18:00)." },
              { step: 4, action: "If you see a mistake in your roster, contact your Process Manager or use the dispute option." },
            ],
            screenGuide: "My Roster is a 7-day calendar strip. Each day shows a shift badge (M/A/N) or a grey W/O for week-off. A monthly calendar is below for planning ahead.",
            example: "Checking your schedule for the week 20-26 Oct. Mon-Fri: Morning shift 09:00–18:00. Saturday: Afternoon 13:00–22:00. Sunday: Week-off. You can now plan commute and personal schedule.",
          },
          {
            id: "week-off-preference",
            title: "Submit Your Week-Off Preference",
            description: "Request your preferred days off for the upcoming week (subject to WFM approval).",
            path: "/week-off-preferences",
            steps: [
              { step: 1, action: "Go to My Space → Attendance → Week-off Preference (/week-off-preferences)." },
              { step: 2, action: "The form shows the upcoming week. Select your preferred days off from the dropdown." },
              { step: 3, action: "Submit before the WFM deadline (usually Wednesday for next week's roster)." },
              { step: 4, action: "WFM considers your preference when building the roster — it is not guaranteed but is respected when possible." },
            ],
            screenGuide: "Week-off Preference shows the next 4 weeks with a 'My Preference' dropdown for each. Once the roster is published, your assigned day-off is shown on the same page.",
            example: "You want Sunday off next week (a family event). Go to Week-off Preference, select next week, choose Sunday as your preference. Submit before Wednesday. WFM assigns you Sunday off if staffing allows.",
          },
        ],
      },
      {
        id: "emp-learning",
        title: "My Learning (LMS)",
        icon: <GraduationCap className="h-4 w-4" />,
        color: "#10b981",
        bgColor: "from-emerald-50 to-green-50",
        borderColor: "border-emerald-200",
        activities: [
          {
            id: "my-courses",
            title: "View and Complete Your Assigned Courses",
            description: "Access the modules you have been enrolled in and track your own learning progress.",
            path: "/lms/my-learning",
            steps: [
              { step: 1, action: "Go to Learning → My Learning (/lms/my-learning)." },
              { step: 2, action: "You see a list of all courses assigned to your batch." },
              { step: 3, action: "Click any course to launch it — you are taken to the LMS learning portal." },
              { step: 4, action: "Complete modules in order — each module unlocks the next after completion." },
              { step: 5, action: "After each module, take the MCQ. You need a passing score (usually 70%) to advance." },
            ],
            screenGuide: "My Learning shows a vertical list of course modules with a progress bar for each. Completed modules show a green checkmark; locked modules show a padlock icon.",
            example: "You are in the Axis Inbound batch. My Learning shows 3 modules: Module 1 (Complete ✓), Module 2 (In Progress — 60%), Module 3 (Locked). Click Module 2 to continue where you left off.",
          },
        ],
      },
      {
        id: "emp-exit",
        title: "Exit & Resignation",
        icon: <UserPlus className="h-4 w-4" />,
        color: "#ef4444",
        bgColor: "from-red-50 to-rose-50",
        borderColor: "border-red-200",
        activities: [
          {
            id: "submit-resignation",
            title: "Submit Your Resignation",
            description: "Formally raise a resignation request through the system.",
            path: "/exit/resignation",
            steps: [
              { step: 1, action: "Go to My Space → My Resignation (/exit/resignation)." },
              { step: 2, action: "Click 'Raise Resignation'." },
              { step: 3, action: "Fill: Reason for Leaving (from dropdown), Last Working Day preference, and a brief note." },
              { step: 4, action: "Upload your resignation letter PDF (optional but recommended)." },
              { step: 5, action: "Submit — your Process Manager and HR Admin are notified immediately." },
              { step: 6, action: "HR will confirm your LWD and notice period obligations within 24 hours." },
            ],
            screenGuide: "My Resignation shows your current status (Active / Notice Period / Relieved). The 'Raise Resignation' button is prominent at the top. The form has a reason dropdown and a date picker for LWD.",
            example: "You decide to resign on 01-Nov. Go to My Resignation, click Raise Resignation. Select Reason = 'Better Opportunity', LWD = 30-Nov (30 days notice). Upload your letter PDF. Submit. HR confirms within the day.",
            tip: "Do not resign verbally before submitting here. The official notice period clock starts from the date you submit in the system.",
          },
          {
            id: "salary-dispute",
            title: "Raise a Salary Dispute",
            description: "If you believe there is an error in your payslip, raise a formal dispute for payroll to review.",
            path: "/payroll/salary-disputes",
            steps: [
              { step: 1, action: "Go to My Space → Pay & Tax → Salary Disputes (/payroll/salary-disputes)." },
              { step: 2, action: "Click 'New Dispute', select the month in question." },
              { step: 3, action: "Select the dispute type: Wrong LOP, Missing Allowance, Wrong Deduction, etc." },
              { step: 4, action: "Describe the issue clearly (e.g. '3 days LOP deducted but I have approved leave for all 3 days')." },
              { step: 5, action: "Submit — Payroll team reviews and resolves within 5 working days." },
            ],
            screenGuide: "Salary Disputes page shows your dispute history with status badges (Open / Under Review / Resolved). The new dispute form is a simple modal with a type dropdown and text area.",
            example: "Your October payslip deducts 2 extra LOP days. You have approved leave for those days. Go to Salary Disputes, New Dispute, month = Oct 2026, Type = 'Wrong LOP'. Describe the issue. Submit. Payroll resolves it within the week.",
          },
        ],
      },
    ],
  },

  // ─── CLIENT ────────────────────────────────────────────────────────────────
  client: {
    roleLabel: "Client",
    description: "Approved, aggregate-only view of your contracted process performance, roster coverage, quality scores, and workforce metrics. No individual employee data is visible.",
    modules: [
      {
        id: "process-performance",
        title: "Process Performance",
        icon: <TrendingUp className="h-4 w-4" />,
        color: "#6366f1",
        bgColor: "from-indigo-50 to-blue-50",
        borderColor: "border-indigo-200",
        activities: [
          {
            id: "view-metrics",
            title: "View Your Process KPIs",
            description: "See the approved performance metrics for your contracted LOBs.",
            steps: [
              { step: 1, action: "Log in to the Client Portal — you are automatically scoped to your contracted processes" },
              { step: 2, action: "Go to the Performance Dashboard" },
              { step: 3, action: "View metrics: headcount, attendance %, AHT, quality score, CSAT" },
              { step: 4, action: "Use date filters to see daily, weekly, or monthly trends" },
              { step: 5, action: "Click any metric card to see the breakdown by shift or team" },
            ],
            example: "As the client for Axis Inbound LOB, open your dashboard. See today: 42 agents present (95% attendance), AHT 4:20 (within SLA), Quality 82%. Click Quality 82% to see agent-level scores in aggregate.",
            tip: "Individual employee names, salaries, and personal data are never visible on the client portal. All views show aggregate data only.",
          },
          {
            id: "view-roster",
            title: "View Approved Roster Coverage",
            description: "Check the confirmed headcount coverage for your LOB for the upcoming week.",
            steps: [
              { step: 1, action: "Go to Client Portal → Roster Coverage" },
              { step: 2, action: "Select the week from the date picker" },
              { step: 3, action: "See aggregate headcount per shift per day (no individual names are shown)" },
              { step: 4, action: "Red cells indicate slots where coverage is below contracted minimum" },
              { step: 5, action: "Raise a concern via the portal message if coverage gaps are visible" },
            ],
            example: "Checking roster for the week 20-26 Oct. Wednesday night shift shows 36/40 contracted agents. This is below SLA. Use the portal message to flag this to your account manager.",
          },
        ],
      },
    ],
  },

  // ─── OPERATIONS MANAGER ────────────────────────────────────────────────────
  operations_manager: {
    roleLabel: "Operations Manager",
    description: "Operations-level oversight: daily performance dashboard, call analytics, quality monitoring, ops round approvals, sales analytics, and escalation management.",
    modules: [
      {
        id: "operations-performance",
        title: "Operations Performance",
        icon: <Target className="h-4 w-4" />,
        color: "#ef4444",
        bgColor: "from-red-50 to-rose-50",
        borderColor: "border-red-200",
        activities: [
          {
            id: "view-ops-dashboard",
            title: "Review Daily Operations Dashboard",
            description: "Get a top-down view of all processes under your scope.",
            path: "/operations-dashboard",
            steps: [
              { step: 1, action: "Go to Overview → Operations Dashboard (/operations-dashboard)." },
              { step: 2, action: "See all processes: headcount, AHT, quality score, and absenteeism" },
              { step: 3, action: "Click any process to drill down to team-level detail" },
              { step: 4, action: "Use the shift filter to compare performance across shifts" },
            ],
            example: "Monday morning, open Operations Dashboard. See 5 processes. Axis Inbound shows 88% attendance (low). Click to drill — 4 agents AWOL on morning shift. Notify Process Manager to arrange backup.",
          },
          {
            id: "kpi-tracking",
            title: "Track Team KPIs and Scorecards",
            description: "Monitor each team leader and agent's monthly KPI scores.",
            steps: [
              { step: 1, action: "Go to Operations → Performance (KPI Scorecard)" },
              { step: 2, action: "Select the period (month) and process" },
              { step: 3, action: "View the leaderboard: top and bottom performers" },
              { step: 4, action: "Click any TL or agent row to see their individual scorecard" },
              { step: 5, action: "Export for monthly performance review meetings" },
            ],
            example: "End of October. Open KPI Scorecard for Axis Inbound. Top performer: Divya TL (94/100). Bottom: Suresh TL (61/100 — quality gap). Schedule review with Suresh and assign coaching plan.",
            path: "/operations-dashboard",
            screenGuide: "Operations Dashboard shows process cards arranged in a grid. Each card has: headcount bar, AHT gauge, quality score, and a 3-day trend mini-chart. Clicking a card opens the TL-level drill-down.",
          },
        ],
      },
      {
        id: "ops-ats",
        title: "ATS Ops Round",
        icon: <Briefcase className="h-4 w-4" />,
        color: "#6366f1",
        bgColor: "from-indigo-50 to-blue-50",
        borderColor: "border-indigo-200",
        activities: [
          {
            id: "ops-interview",
            title: "Conduct Operations Interview for Candidates",
            description: "Review and approve/reject candidates referred by HR for the operations round.",
            path: "/ats/walkin-queue",
            steps: [
              { step: 1, action: "Go to ATS → Ops Round (/ats/walkin-queue) — you see candidates pending your round." },
              { step: 2, action: "Click a candidate to open their full profile: resume, HR notes, initial assessment." },
              { step: 3, action: "Conduct the interview (in-person or virtual) based on the predefined ops checklist." },
              { step: 4, action: "Record your verdict: Approve for Joining, Conditional (training needed), Reject." },
              { step: 5, action: "Add interview notes that are visible to HR for the offer letter and onboarding." },
            ],
            screenGuide: "Ops Round queue is a list of candidate cards. Each card shows the candidate's name, applied process, HR interview score, and the time they have been waiting. Click to expand details.",
            example: "Reviewing Kapil for Axis Inbound Ops Round. He has 2 years of inbound voice experience, strong product knowledge. Conduct ops interview, score 78/100. Verdict = Approve. Note: 'Confident, good product fit'.",
          },
        ],
      },
      {
        id: "ops-quality",
        title: "Quality & Call Analytics",
        icon: <ShieldCheck className="h-4 w-4" />,
        color: "#ef4444",
        bgColor: "from-red-50 to-rose-50",
        borderColor: "border-red-200",
        activities: [
          {
            id: "ops-quality-overview",
            title: "Monitor Quality Across All Processes",
            description: "See the quality score summary for every process and identify the ones needing attention.",
            path: "/quality-dashboard",
            steps: [
              { step: 1, action: "Go to Overview → Quality Dashboard (/quality-dashboard)." },
              { step: 2, action: "View quality scores for all processes in your scope." },
              { step: 3, action: "Sort by score ascending — lowest quality processes appear first." },
              { step: 4, action: "Click any process to see the TL-level and agent-level breakdown." },
              { step: 5, action: "Escalate to the respective Process Manager for any process below target." },
            ],
            screenGuide: "Quality Dashboard is a grid of process cards. Red cards = below target, green = on track. The header shows the overall branch quality score and a trend arrow.",
            example: "Monthly review: 4 of 6 processes are green (>80%). HDFC Outbound is 71% (red). Click it — 3 agents score below 65%. Call an ops-QA calibration session for HDFC Outbound by end of week.",
          },
          {
            id: "call-master-ops",
            title: "Analyse Call Volume and AHT Trends",
            description: "Use Call Master data to spot process anomalies — sudden volume drops, AHT spikes.",
            path: "/call-master",
            steps: [
              { step: 1, action: "Go to Call Master → Call Master Dashboard (/call-master)." },
              { step: 2, action: "Select the date range and filter by process." },
              { step: 3, action: "Look for anomalies: days where AHT is 30%+ above the process average." },
              { step: 4, action: "Cross-reference with the quality dashboard — high AHT + low quality = skill gap." },
              { step: 5, action: "Share findings with the Process Manager and Trainer for targeted intervention." },
            ],
            screenGuide: "Call Master shows a line chart of daily calls and AHT over the selected period. Below it is a table of each agent's call count, AHT, and abandonment rate.",
            example: "Axis Inbound: AHT jumped from 4:20 to 5:45 on Oct 18 (Friday). Check quality that day — 3 agents audited, all scored low on 'Product Knowledge'. A new card variant was launched that day. Flag for immediate product training.",
          },
        ],
      },
    ],
  },
};

// ─── Role options for the Select dropdown ────────────────────────────────────

const ROLE_OPTIONS = [
  { value: "super_admin",       label: "Super Admin" },
  { value: "hr",                label: "HR Admin" },
  { value: "recruitment_hr",    label: "Recruitment HR" },
  { value: "payroll",           label: "Payroll" },
  { value: "finance",           label: "Finance" },
  { value: "wfm",               label: "WFM (Workforce Management)" },
  { value: "branch_head",       label: "Branch Head" },
  { value: "operations_manager",label: "Operations Manager" },
  { value: "process_manager",   label: "Process Manager" },
  { value: "trainer",           label: "Trainer" },
  { value: "qa",                label: "QA / Quality Analyst" },
  { value: "employee",          label: "Employee" },
  { value: "client",            label: "Client" },
];

// ─── Activity component ───────────────────────────────────────────────────────

function ActivityCard({ activity }: { activity: GuideActivity }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden hover:border-slate-300 transition-colors">
      <button
        className="w-full flex items-start gap-3 px-5 py-4 text-left"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex-shrink-0 mt-0.5">
          <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center">
            <Play className="h-3 w-3 text-slate-500 ml-0.5" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-slate-800">{activity.title}</h4>
            {expanded
              ? <ChevronDown className="h-4 w-4 text-slate-400 flex-shrink-0" />
              : <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />
            }
          </div>
          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{activity.description}</p>
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 border-t border-slate-100">
          {/* Steps */}
          <div className="mt-4">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">Steps</p>
            <ol className="space-y-2.5">
              {activity.steps.map(s => (
                <li key={s.step} className="flex gap-3">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center mt-0.5">{s.step}</span>
                  <div>
                    <p className="text-sm text-slate-700 font-medium">{s.action}</p>
                    {s.detail && <p className="text-xs text-slate-400 mt-0.5">{s.detail}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Example */}
          <div className="mt-5 rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Lightbulb className="h-3.5 w-3.5 text-blue-600" />
              <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Example</p>
            </div>
            <p className="text-sm text-blue-900 leading-relaxed">{activity.example}</p>
          </div>

          {/* Screen guide */}
          {activity.screenGuide && (
            <div className="mt-3 rounded-xl bg-purple-50 border border-purple-200 p-4">
              <div className="flex items-start gap-2">
                <Info className="h-3.5 w-3.5 text-purple-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-purple-700 mb-1">What You'll See on Screen</p>
                  <p className="text-sm text-purple-900 leading-relaxed">{activity.screenGuide}</p>
                </div>
              </div>
            </div>
          )}

          {/* Tip */}
          {activity.tip && (
            <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 p-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800 leading-relaxed">{activity.tip}</p>
              </div>
            </div>
          )}

          {/* Go to page */}
          {activity.path && (
            <div className="mt-3 flex">
              <a
                href={activity.path}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg px-3 py-2 transition-colors"
              >
                <ArrowRight className="h-3 w-3" />
                Open this page in HRMS
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Missing icon import shim ─────────────────────────────────────────────────
// CalendarDays and Activity are used in GUIDE_DATA but not imported above.
// Inline them from lucide-react to avoid refactoring the data structure.

function Activity(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  );
}
function CalendarDays(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/>
      <line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/>
      <path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/>
      <path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/>
    </svg>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NativeHrmsGuide() {
  const [selectedRole, setSelectedRole] = useState<string>("");
  const [selectedModule, setSelectedModule] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const guide = selectedRole ? GUIDE_DATA[selectedRole] : null;

  const filteredModules = guide?.modules.filter(m => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      m.title.toLowerCase().includes(q) ||
      m.activities.some(a => a.title.toLowerCase().includes(q) || a.description.toLowerCase().includes(q))
    );
  }) ?? [];

  const activeModule = filteredModules.find(m => m.id === selectedModule) ?? filteredModules[0] ?? null;

  const handleRoleChange = (role: string) => {
    setSelectedRole(role);
    setSelectedModule(null);
    setSearchQuery("");
  };

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/30 to-purple-50/20">

        {/* ── Header ── */}
        <div className="relative overflow-hidden bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 px-6 pt-8 pb-10">
          <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 30% 20%, white, transparent 50%)' }} />
          <div className="relative max-w-6xl mx-auto">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                <BookOpen className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">HRMS Guide</h1>
                <p className="text-indigo-200 text-sm">Step-by-step how-to guide for every role and module</p>
              </div>
            </div>

            {/* Role Selector */}
            <div className="mt-6 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
              <label className="text-white/80 text-sm font-medium whitespace-nowrap">Select your role:</label>
              <select
                value={selectedRole}
                onChange={e => handleRoleChange(e.target.value)}
                className="h-10 px-3 rounded-xl border-2 border-white/30 bg-white/10 text-white placeholder-white/60 focus:border-white/60 focus:outline-none focus:bg-white/20 transition-all min-w-[260px] text-sm"
              >
                <option value="" className="text-slate-800 bg-white">— Choose your role —</option>
                {ROLE_OPTIONS.map(r => (
                  <option key={r.value} value={r.value} className="text-slate-800 bg-white">{r.label}</option>
                ))}
              </select>
              {guide && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/20 border border-white/30">
                  <Star className="h-3.5 w-3.5 text-yellow-300" />
                  <span className="text-white text-xs font-medium">{filteredModules.length} modules available</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── No role selected ── */}
        {!selectedRole && (
          <div className="max-w-6xl mx-auto px-6 py-16 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-100 mb-4">
              <BookOpen className="h-8 w-8 text-indigo-500" />
            </div>
            <h2 className="text-xl font-bold text-slate-700 mb-2">Select Your Role to Get Started</h2>
            <p className="text-slate-500 max-w-lg mx-auto">
              Choose your role from the dropdown above to see a tailored guide covering every module, activity, and workflow available to you in PeopleOS.
            </p>
            <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-w-2xl mx-auto">
              {ROLE_OPTIONS.map(r => (
                <button
                  key={r.value}
                  onClick={() => handleRoleChange(r.value)}
                  className="px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 transition-all text-left"
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Guide content ── */}
        {guide && (
          <div className="max-w-6xl mx-auto px-6 py-6">

            {/* Role description */}
            <div className="mb-5 p-4 rounded-xl bg-white border border-slate-200 flex items-start gap-3">
              <Info className="h-4 w-4 text-indigo-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-slate-700">{guide.roleLabel} — What you can do</p>
                <p className="text-sm text-slate-500 mt-0.5">{guide.description}</p>
              </div>
            </div>

            {/* Search */}
            <div className="mb-5 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search modules or activities…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full h-10 pl-9 pr-4 rounded-xl border-2 border-slate-200 bg-white text-sm text-slate-700 placeholder-slate-400 focus:border-indigo-400 focus:outline-none transition-colors"
              />
            </div>

            {/* Two-column layout */}
            <div className="flex gap-5">

              {/* Left: Module list */}
              <div className="w-56 flex-shrink-0">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3 px-1">Modules</p>
                <div className="space-y-1">
                  {filteredModules.map(m => {
                    const isActive = m.id === (activeModule?.id ?? "");
                    return (
                      <button
                        key={m.id}
                        onClick={() => setSelectedModule(m.id)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all ${
                          isActive
                            ? "bg-white border-2 border-indigo-200 shadow-sm"
                            : "hover:bg-white/60 border-2 border-transparent"
                        }`}
                      >
                        <div
                          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: `${m.color}18`, color: m.color }}
                        >
                          {m.icon}
                        </div>
                        <div className="min-w-0">
                          <p className={`text-xs font-semibold leading-tight truncate ${isActive ? "text-indigo-700" : "text-slate-700"}`}>
                            {m.title}
                          </p>
                          <p className="text-[10px] text-slate-400 mt-0.5">{m.activities.length} activit{m.activities.length === 1 ? "y" : "ies"}</p>
                        </div>
                      </button>
                    );
                  })}
                  {filteredModules.length === 0 && (
                    <p className="text-xs text-slate-400 px-3 py-4 text-center">No modules match your search</p>
                  )}
                </div>
              </div>

              {/* Right: Activities */}
              <div className="flex-1 min-w-0">
                {activeModule ? (
                  <>
                    {/* Module header */}
                    <div className={`rounded-2xl bg-gradient-to-r ${activeModule.bgColor} border ${activeModule.borderColor} p-5 mb-4`}>
                      <div className="flex items-center gap-3">
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center"
                          style={{ backgroundColor: `${activeModule.color}20`, color: activeModule.color }}
                        >
                          {activeModule.icon}
                        </div>
                        <div>
                          <h2 className="text-base font-bold text-slate-800">{activeModule.title}</h2>
                          <p className="text-xs text-slate-500">{activeModule.activities.length} activities · Click each to expand steps and examples</p>
                        </div>
                      </div>
                    </div>

                    {/* Activity cards */}
                    <div className="space-y-3">
                      {activeModule.activities
                        .filter(a => {
                          if (!searchQuery) return true;
                          const q = searchQuery.toLowerCase();
                          return a.title.toLowerCase().includes(q) || a.description.toLowerCase().includes(q);
                        })
                        .map(a => <ActivityCard key={a.id} activity={a} />)
                      }
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
                    Select a module on the left to view activities
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
