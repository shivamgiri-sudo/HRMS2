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
  steps: GuideStep[];
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

  super_admin: {
    roleLabel: "Super Admin",
    description: "Full platform control — user management, configuration, security, audit, and all modules.",
    modules: [
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

  hr: {
    roleLabel: "HR Admin",
    description: "Employee lifecycle, attendance, leave, onboarding, exit, letters, and compliance.",
    modules: [
      {
        id: "employee-management",
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
            steps: [
              { step: 1, action: "Go to Support → Letters (/letters)" },
              { step: 2, action: "Click 'New Letter', select the letter type (Offer, Experience, Salary, NOC, etc.)" },
              { step: 3, action: "Search and select the employee" },
              { step: 4, action: "Fill any additional fields (effective date, designation, CTC)" },
              { step: 5, action: "Preview the letter — all placeholders are auto-filled from the employee's profile" },
              { step: 6, action: "Download PDF or send to employee's email" },
            ],
            example: "Mohan needs an experience letter after leaving. Go to Letters, click New, type Experience Letter, select Mohan, preview — his full name, designation, and tenure are pulled automatically. Download PDF.",
          },
        ],
      },
    ],
  },

  recruitment_hr: {
    roleLabel: "Recruitment HR",
    description: "End-to-end hiring: job postings, candidate pipeline, interviews, offers, and joining.",
    modules: [
      {
        id: "job-postings",
        title: "Job Postings",
        icon: <Briefcase className="h-4 w-4" />,
        color: "#6366f1",
        bgColor: "from-indigo-50 to-blue-50",
        borderColor: "border-indigo-200",
        activities: [
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

  payroll: {
    roleLabel: "Payroll",
    description: "Monthly payroll processing, salary configuration, statutory compliance, and payslips.",
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
            steps: [
              { step: 1, action: "Go to Operations → Payroll → Run Payroll" },
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
            steps: [
              { step: 1, action: "After payroll is approved by Payroll Head, go to Payroll → Payslips" },
              { step: 2, action: "Select the month, confirm all records are finalized (not draft)" },
              { step: 3, action: "Click 'Generate All' to create PDFs for all employees" },
              { step: 4, action: "Click 'Release' — employees can now download their payslips from My Space" },
              { step: 5, action: "Optionally send payslip notification emails to all employees" },
            ],
            example: "October payroll approved. Go to Payslips, select Oct 2026, click Generate All (284 PDFs created), click Release. Employees get an in-app notification. They can download from Profile → Payslips.",
          },
        ],
      },
    ],
  },

  finance: {
    roleLabel: "Finance",
    description: "Budget management, GRN, imprest, client billing, vendor payments, and finance reports.",
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
            steps: [
              { step: 1, action: "Go to Operations → Finance → Branch Budget" },
              { step: 2, action: "Select branch and finance year/month from the dropdowns (never free text)" },
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
    ],
  },

  wfm: {
    roleLabel: "WFM (Workforce Management)",
    description: "Roster planning, attendance monitoring, real-time tracking, shrinkage, and forecasting.",
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
            steps: [
              { step: 1, action: "Go to Workforce → WFM / Roster" },
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
            steps: [
              { step: 1, action: "Open the draft roster, confirm Process Manager has approved" },
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
            steps: [
              { step: 1, action: "Go to Workforce → WFM Attendance Dashboard (/wfm-attendance)" },
              { step: 2, action: "Filter by branch or process" },
              { step: 3, action: "View the heat map: green = logged in, amber = on break, red = absent" },
              { step: 4, action: "Click any agent row to see punch times, break history, and current status" },
              { step: 5, action: "Export real-time snapshot for ops reporting if needed" },
            ],
            example: "At 10:30 AM, WFM sees 8 agents red (absent) on the Axis Inbound floor. Click each to confirm they aren't on approved leave. 5 are on leave, 3 are AWOL. Notify Operations Manager for 3 AWOL agents.",
          },
        ],
      },
    ],
  },

  branch_head: {
    roleLabel: "Branch Head",
    description: "Branch overview, team approvals, budget oversight, and operations management.",
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
            steps: [
              { step: 1, action: "Go to Operations → Finance → Branch Budget" },
              { step: 2, action: "Filter to your branch and current month" },
              { step: 3, action: "View each budget head: allocated vs actual vs remaining" },
              { step: 4, action: "Drill into GRN records for any overspent category" },
            ],
            example: "It's 15-Oct. Open Branch Budget for Pune, Oct 2026. Consumables shows ₹18K spent vs ₹15K budget — already over. Click the row to see the GRN records. One large purchase was miscategorised. Flag to Finance.",
          },
        ],
      },
    ],
  },

  process_manager: {
    roleLabel: "Process Manager",
    description: "Daily operations, roster publishing, team attendance, quality monitoring, and client reporting.",
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
            steps: [
              { step: 1, action: "Go to Workforce → Team Attendance (/wfm/team-attendance)" },
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
          },
        ],
      },
    ],
  },

  trainer: {
    roleLabel: "Trainer",
    description: "Training assignments, learner progress tracking, assessments, and LMS coordination.",
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
            steps: [
              { step: 1, action: "Go to Workforce → LMS — the integration summary panel" },
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
          },
        ],
      },
    ],
  },

  qa: {
    roleLabel: "QA / Quality Analyst",
    description: "Call auditing, quality scores, feedback, calibration sessions, and quality reports.",
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
            steps: [
              { step: 1, action: "Go to Operations → Quality Dashboard (/quality-dashboard)" },
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
          },
        ],
      },
    ],
  },

  employee: {
    roleLabel: "Employee",
    description: "Your personal space: attendance, leave, payslips, profile, and support requests.",
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
            steps: [
              { step: 1, action: "Click your avatar or go to My Space → Profile" },
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
            steps: [
              { step: 1, action: "Go to My Space → Leave → Apply Leave" },
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
            steps: [
              { step: 1, action: "Go to My Space → Attendance" },
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
            steps: [
              { step: 1, action: "Go to My Space → Pay & Tax → Payslips" },
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
            steps: [
              { step: 1, action: "Go to Support → Helpdesk (/helpdesk)" },
              { step: 2, action: "Click 'New Ticket'" },
              { step: 3, action: "Select Category (IT, HR, Payroll, etc.) from the dropdown" },
              { step: 4, action: "Select Sub-category (e.g. 'Desktop Issue — System Hang')" },
              { step: 5, action: "Describe the issue clearly, add screenshot if helpful" },
              { step: 6, action: "Submit — the relevant team is notified and you get a ticket number" },
            ],
            example: "Your system is hanging repeatedly. Go to Helpdesk, New Ticket, Category IT, Sub-category 'Desktop Issue — System Hang'. Describe: 'System freezes every 30 minutes since morning'. Submit. IT team gets the alert and you get ticket #HLT-2024.",
          },
        ],
      },
    ],
  },

  client: {
    roleLabel: "Client",
    description: "Approved aggregate view of your process performance, roster coverage, and quality metrics.",
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

  operations_manager: {
    roleLabel: "Operations Manager",
    description: "Operations performance, team KPIs, escalation management, and branch-level reporting.",
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
            steps: [
              { step: 1, action: "Go to Overview → Operations Dashboard (/operations-dashboard)" },
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

          {/* Tip */}
          {activity.tip && (
            <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 p-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800 leading-relaxed">{activity.tip}</p>
              </div>
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
