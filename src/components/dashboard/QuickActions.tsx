import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UserPlus, Calendar, FileText, Package, Target, ClipboardList } from "lucide-react";
import { Link } from "react-router-dom";
import { useIsAdminOrHR } from "@/hooks/useUserRole";

const adminActions = [
  {
    label: "Add Employee",
    icon: <UserPlus className="h-5 w-5" />,
    href: "/onboarding",
    variant: "default" as const,
  },
  {
    label: "Manage Assets",
    icon: <Package className="h-5 w-5" />,
    href: "/assets",
    variant: "secondary" as const,
  },
  {
    label: "View Payroll",
    icon: <FileText className="h-5 w-5" />,
    href: "/payroll",
    variant: "secondary" as const,
  },
];

const employeeActions = [
  {
    label: "Request Leave",
    icon: <Calendar className="h-5 w-5" />,
    href: "/leaves",
    variant: "default" as const,
  },
  {
    label: "My Goals",
    icon: <Target className="h-5 w-5" />,
    href: "/performance",
    variant: "secondary" as const,
  },
  {
    label: "View Attendance",
    icon: <ClipboardList className="h-5 w-5" />,
    href: "/attendance",
    variant: "secondary" as const,
  },
];

export function QuickActions() {
  const { isAdminOrHR, isLoading } = useIsAdminOrHR();
  
  const actions = isAdminOrHR ? adminActions : employeeActions;

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 w-full animate-pulse rounded-md bg-muted" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-semibold">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {actions.map((action, index) => (
          <Link key={action.label} to={action.href} className={index < actions.length - 1 ? "mb-2 block" : "block"}>
            <Button
              variant={action.variant}
              className="w-full justify-start gap-3"
            >
              {action.icon}
              <span>{action.label}</span>
            </Button>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
