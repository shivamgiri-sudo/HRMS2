export type InsightSeverity = "info" | "success" | "warning" | "critical";

export type RoleInsightDefinition = {
  id: string;
  roles: string[];
  title: string;
  description: string;
  severity: InsightSeverity;
  actionLabel: string;
  actionPath: string;
};

export const roleInsightsCatalog: RoleInsightDefinition[] = [
  {
    id: "hr-pending-leaves",
    roles: ["super_admin", "admin", "hr"],
    title: "Pending leave approvals",
    description: "Leave requests waiting for HR or manager review.",
    severity: "warning",
    actionLabel: "Review leaves",
    actionPath: "/leaves",
  },
  {
    id: "hr-missing-manager",
    roles: ["super_admin", "admin", "hr"],
    title: "Missing reporting managers",
    description: "Active employees without a valid reporting manager mapping.",
    severity: "critical",
    actionLabel: "Open employee report",
    actionPath: "/reports",
  },
  {
    id: "wfm-unreconciled-attendance",
    roles: ["super_admin", "admin", "hr", "wfm"],
    title: "Unreconciled attendance",
    description: "Attendance rows needing WFM correction before payroll freeze.",
    severity: "critical",
    actionLabel: "Open attendance",
    actionPath: "/attendance",
  },
  {
    id: "wfm-cosec-unmapped",
    roles: ["super_admin", "admin", "hr", "wfm"],
    title: "Unmapped COSEC punches",
    description: "Biometric records that do not map to an HRMS employee.",
    severity: "critical",
    actionLabel: "Open biometric center",
    actionPath: "/wfm/live-tracker",
  },
  {
    id: "payroll-readiness",
    roles: ["super_admin", "admin", "finance", "payroll"],
    title: "Payroll readiness blockers",
    description: "Missing salary, bank, attendance, or statutory data before payroll run.",
    severity: "critical",
    actionLabel: "Open payroll",
    actionPath: "/payroll",
  },
  {
    id: "payroll-payslip-ack",
    roles: ["super_admin", "admin", "finance", "payroll"],
    title: "Payslip acknowledgement pending",
    description: "Released payslips still not acknowledged by employees.",
    severity: "warning",
    actionLabel: "Open payslips",
    actionPath: "/payroll/payslips",
  },
  {
    id: "manager-team-leave",
    roles: ["manager", "team_leader", "tl", "process_manager", "assistant_manager"],
    title: "Team leave requests",
    description: "Team leave requests waiting for your action.",
    severity: "warning",
    actionLabel: "Review leaves",
    actionPath: "/leaves",
  },
  {
    id: "manager-team-absence",
    roles: ["manager", "team_leader", "tl", "process_manager", "assistant_manager"],
    title: "Team absence exceptions",
    description: "Team members marked absent or unreconciled today.",
    severity: "warning",
    actionLabel: "Open attendance",
    actionPath: "/attendance",
  },
  {
    id: "employee-my-leaves",
    roles: ["employee"],
    title: "My pending leave requests",
    description: "Your leave requests waiting for approval.",
    severity: "info",
    actionLabel: "Open leaves",
    actionPath: "/leaves",
  },
  {
    id: "employee-my-payslips",
    roles: ["employee"],
    title: "Payslips to acknowledge",
    description: "Payslips released to you but not yet acknowledged.",
    severity: "warning",
    actionLabel: "Open payslips",
    actionPath: "/payroll/payslips",
  },
];

export function insightsForRoles(roleKeys: string[] = []) {
  const normalized = new Set(roleKeys.map((role) => role.toLowerCase()));
  if (normalized.has("super_admin")) return roleInsightsCatalog;
  return roleInsightsCatalog.filter((item) => item.roles.some((role) => normalized.has(role.toLowerCase())));
}
