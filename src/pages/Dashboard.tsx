import { useAuth } from "@/hooks/use-auth";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { CeoLayout } from "@/components/dashboard/layouts/CeoLayout";
import { HrAdminLayout } from "@/components/dashboard/layouts/HrAdminLayout";
import { RecruiterLayout } from "@/components/dashboard/layouts/RecruiterLayout";
import { OpsLayout } from "@/components/dashboard/layouts/OpsLayout";
import { FinanceLayout } from "@/components/dashboard/layouts/FinanceLayout";
import { EmployeeLayout } from "@/components/dashboard/layouts/EmployeeLayout";

type RoleLayoutType = "ceo" | "hr" | "recruiter" | "ops" | "finance" | "employee";

function resolveRoleLayout(role?: string): RoleLayoutType {
  if (!role) return "employee";

  const roleNormalized = role.toLowerCase().replace("_", "");

  // CEO / Super Admin
  if (roleNormalized === "ceo" || roleNormalized === "superadmin") {
    return "ceo";
  }

  // HR Admin
  if (roleNormalized === "hr" || roleNormalized === "admin" || roleNormalized === "hradmin") {
    return "hr";
  }

  // Recruiter
  if (roleNormalized === "recruiter" || roleNormalized === "recruitment") {
    return "recruiter";
  }

  // Operations (Process Manager, Branch Head, Operations Manager)
  if (
    roleNormalized === "processmanager" ||
    roleNormalized === "branchhead" ||
    roleNormalized === "operationsmanager" ||
    roleNormalized === "ops"
  ) {
    return "ops";
  }

  // Finance / Payroll
  if (roleNormalized === "finance" || roleNormalized === "payroll") {
    return "finance";
  }

  // Default: Employee (includes team_leader, qa, trainer, agent, employee)
  return "employee";
}

export default function Dashboard() {
  const { user } = useAuth();
  const layoutType = resolveRoleLayout(user?.role);

  const renderLayout = () => {
    switch (layoutType) {
      case "ceo":
        return <CeoLayout />;
      case "hr":
        return <HrAdminLayout />;
      case "recruiter":
        return <RecruiterLayout />;
      case "ops":
        return <OpsLayout />;
      case "finance":
        return <FinanceLayout />;
      case "employee":
      default:
        return <EmployeeLayout />;
    }
  };

  return <DashboardLayout>{renderLayout()}</DashboardLayout>;
}
