import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ExternalLink,
  Eye,
  EyeOff,
  IndianRupee,
  Mail,
  MapPin,
  Phone,
  UserRoundCheck,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EmployeeJourneyTimeline,
  type EmployeeJourneyEvent,
} from "@/components/employees/EmployeeJourneyTimeline";
import { Employee } from "./EmployeeTable";
import { employeeStatusStyles } from "@/lib/statusStyles";

interface EmployeeViewDialogProps {
  employee: Employee | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface EmployeeStatCard {
  employee: Record<string, any>;
  journey: EmployeeJourneyEvent[];
  attendance?: { attendance_pct?: number | null };
  active_assets?: number;
  pending_docs?: number;
  performance?: { overall_score?: number | null } | null;
  salary?: {
    structure_name: string;
    ctc_annual: number;
    monthly_ctc: number;
    basic: number;
    hra: number;
    other_allowances: number;
  } | null;
}

function formatDate(value?: string | null) {
  if (!value) return "Not recorded";
  // Append T00:00:00 for date-only strings to avoid UTC parsing shifting the date in IST
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
    ? `${value.trim()}T00:00:00`
    : value;
  return new Date(normalized).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function EmployeeViewDialog({ employee, open, onOpenChange }: EmployeeViewDialogProps) {
  const [salaryVisible, setSalaryVisible] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["employee-stat-card", employee?.id],
    queryFn: async () => {
      if (!employee?.id) return null;
      const res = await hrmsApi.get<{ data: EmployeeStatCard }>(
        `/api/employees/${employee.id}/stat-card`
      );
      return res.data;
    },
    enabled: open && !!employee?.id,
  });

  const details = data?.employee;
  const displayName = (employee ? (details?.full_name || employee.name) : "") || "";
  const initials = displayName
    .split(" ")
    .slice(0, 2)
    .map((part: string) => part[0])
    .join("")
    .toUpperCase();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {employee && <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>{displayName} employee profile</DialogTitle>
          <DialogDescription>Employee details and complete lifecycle journey</DialogDescription>
        </DialogHeader>

        <header className="bg-[#073f78] px-6 py-7 text-white sm:px-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
            <Avatar className="size-32 border-4 border-white shadow-xl ring-2 ring-green-300">
              <AvatarImage
                src={details?.avatar_url || details?.photo_url || employee.avatar}
                alt={`${displayName} profile photo`}
              />
              <AvatarFallback className="bg-[#1B6AB5] text-3xl font-black text-white">
                {initials}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1">
              <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-green-200">
                Employee 360 profile
              </p>
              <h2 className="mt-2 text-balance text-3xl font-black">{displayName}</h2>
              <p className="mt-2 text-lg font-bold text-blue-100">
                {details?.designation_name || employee.designation}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge className="border-white/20 bg-white/10 text-white">
                  {details?.employee_code || employee.employeeCode}
                </Badge>
                <Badge className={employeeStatusStyles[employee.status]}>
                  {details?.employment_status || employee.status}
                </Badge>
                {(details?.dept_name || employee.department) && (
                  <Badge className="border-green-300/30 bg-green-300/15 text-green-100">
                    {details?.dept_name || employee.department}
                  </Badge>
                )}
              </div>
            </div>

            <Button asChild variant="secondary" className="shrink-0 rounded-xl font-bold">
              <Link to={`/employee-stat-card/${employee.id}`} onClick={() => onOpenChange(false)}>
                Open full page
                <ExternalLink className="ml-2 size-4" />
              </Link>
            </Button>
          </div>
        </header>

        <Tabs defaultValue="overview" className="px-6 pb-8 pt-5 sm:px-8">
          <TabsList className="h-auto rounded-2xl bg-slate-100 p-1.5">
            <TabsTrigger value="overview" className="rounded-xl px-5 py-2.5 text-sm font-bold">
              Profile overview
            </TabsTrigger>
            <TabsTrigger value="journey" className="rounded-xl px-5 py-2.5 text-sm font-bold">
              Detailed journey
              {data?.journey?.length ? (
                <span className="ml-2 rounded-full bg-[#1B6AB5] px-2 py-0.5 text-xs text-white">
                  {data.journey.length}
                </span>
              ) : null}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-6 space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Attendance", data?.attendance?.attendance_pct != null ? `${data.attendance.attendance_pct}%` : "—"],
                ["Active assets", data?.active_assets ?? "—"],
                ["Pending documents", data?.pending_docs ?? "—"],
                ["Performance", data?.performance?.overall_score != null ? `${data.performance.overall_score}/5` : "—"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</p>
                  <p className="mt-2 text-2xl font-black tabular-nums text-slate-950">{value}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {[
                [Mail, "Email", details?.email || employee.email],
                [Phone, "Phone", details?.mobile || employee.phone || "Not recorded"],
                [Building2, "Department", details?.dept_name || employee.department],
                [BriefcaseBusiness, "Designation", details?.designation_name || employee.designation],
                [MapPin, "Branch / process", [details?.branch_name, details?.process_name].filter(Boolean).join(" · ") || "Not recorded"],
                [Building2, "Cost centre", details?.cost_centre_name || employee.costCentre],
                [UserRoundCheck, "Reporting manager", details?.reporting_manager_name || employee.reportingManager],
                [CalendarDays, "Date of joining", formatDate(details?.date_of_joining || employee.joinDate)],
                [UserRoundCheck, "Employment type", details?.employment_type || "Not recorded"],
              ].map(([Icon, label, value]) => {
                const DetailIcon = Icon as React.ElementType;
                return (
                  <div key={String(label)} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#1B6AB5]">
                      <DetailIcon className="size-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</p>
                      <p className="mt-1 break-words text-base font-bold text-slate-800">{String(value || "Not recorded")}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 font-black text-slate-900">
                    <IndianRupee className="h-4 w-4 text-[#1B6AB5]" /> Salary Components
                  </p>
                  <p className="mt-1 text-xs text-slate-500">Hidden by default for shoulder-surfing protection.</p>
                </div>
                {data?.salary && (
                  <Button variant="outline" size="sm" onClick={() => setSalaryVisible((value) => !value)}>
                    {salaryVisible ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
                    {salaryVisible ? "Hide" : "View"}
                  </Button>
                )}
              </div>
              <div className={`mt-4 grid gap-3 sm:grid-cols-3 ${salaryVisible ? "" : "select-none blur-sm"}`}>
                {data?.salary ? (
                  <>
                    <SalaryValue label="Annual CTC" value={data.salary.ctc_annual} />
                    <SalaryValue label="Basic" value={data.salary.basic} />
                    <SalaryValue label="HRA + Other" value={data.salary.hra + data.salary.other_allowances} />
                  </>
                ) : (
                  <p className="text-sm text-slate-500">No active salary assignment.</p>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="journey" className="mt-6">
            <EmployeeJourneyTimeline
              employeeName={displayName}
              events={data?.journey ?? []}
              loading={isLoading}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>}
    </Dialog>
  );
}

function SalaryValue({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-white p-3">
      <p className="text-xs font-bold uppercase text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-black text-slate-900">
        ₹{Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
      </p>
    </div>
  );
}
