import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Mail, Phone, Building2, Briefcase, Calendar, UserCheck, Crown, Hash } from "lucide-react";
import { Employee } from "./EmployeeTable";
interface EmployeeViewDialogProps {
  employee: Employee | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const statusStyles = {
  active: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  inactive: "bg-muted text-muted-foreground border-border",
  onboarding: "bg-primary/10 text-primary border-primary/20",
  offboarded: "bg-destructive/10 text-destructive border-destructive/20",
};

export function EmployeeViewDialog({ employee, open, onOpenChange }: EmployeeViewDialogProps) {
  // Fetch extended employee details including manager and department head
  const { data: extendedDetails } = useQuery({
    queryKey: ["employee-extended-details", employee?.id],
    queryFn: async () => {
      if (!employee?.id) return null;
      const res = await hrmsApi.get<{success:boolean;data:any}>("/api/employees");
      return res.data ?? null;
    },
    enabled: open && !!employee?.id,
  });

  if (!employee) return null;

  const manager = extendedDetails?.manager;
  const managerName = manager 
    ? Array.isArray(manager) && manager.length > 0
      ? `${manager[0].first_name} ${manager[0].last_name}`
      : !Array.isArray(manager)
        ? `${(manager as { first_name: string; last_name: string }).first_name} ${(manager as { first_name: string; last_name: string }).last_name}`
        : null
    : null;
  
  const departmentHead = extendedDetails?.department?.department_head;
  const departmentHeadName = departmentHead 
    ? Array.isArray(departmentHead) && departmentHead.length > 0
      ? `${departmentHead[0].first_name} ${departmentHead[0].last_name}`
      : !Array.isArray(departmentHead)
        ? `${(departmentHead as { first_name: string; last_name: string }).first_name} ${(departmentHead as { first_name: string; last_name: string }).last_name}`
        : null
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Employee Profile</DialogTitle>
        </DialogHeader>
        <div className="space-y-6">
          {/* Profile Header */}
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={employee.avatar} />
              <AvatarFallback className="text-lg">
                {employee.name.split(" ").map((n) => n[0]).join("")}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="text-xs font-mono text-muted-foreground mb-1">{employee.employeeCode}</p>
              <h3 className="text-lg font-semibold text-foreground">{employee.name}</h3>
              <Badge variant="outline" className={statusStyles[employee.status]}>
                {employee.status}
              </Badge>
            </div>
          </div>

          {/* Details */}
          <Card>
            <CardContent className="space-y-4 pt-4">
              <div className="flex items-center gap-3 text-sm">
                <Hash className="h-4 w-4 text-muted-foreground" />
                <span className="font-mono text-muted-foreground">{employee.employeeCode}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">{employee.email}</span>
              </div>
              {employee.phone && (
                <div className="flex items-center gap-3 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{employee.phone}</span>
                </div>
              )}
              <div className="flex items-center gap-3 text-sm">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">{employee.department}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Briefcase className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">{employee.designation}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Joined {employee.joinDate}</span>
              </div>
              {managerName && (
                <div className="flex items-center gap-3 text-sm">
                  <UserCheck className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Reports to {managerName}</span>
                </div>
              )}
              {departmentHeadName && (
                <div className="flex items-center gap-3 text-sm">
                  <Crown className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Dept. Head: {departmentHeadName}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
