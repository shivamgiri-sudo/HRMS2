import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldX } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ScopedFilterBar } from "@/components/dashboard";
import { Skeleton } from "@/components/ui/skeleton";
import { useExecutiveQualitySummary } from "@/hooks/useExecutiveQuality";
import { useOrgKpiSummary } from "@/hooks/useOrgKpiSummary";
import { useUserRole } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";
import { canAccessRoleDashboard, type RoleDashboardVariant } from "./roleDashboardAccess";
import {
  asArray,
  asRecord,
  type DashboardSummary,
  type EmployeeDashboardData,
  type JsonRecord,
  type ReferenceDashboardData,
} from "./reference-dashboard-model";
import { ReferenceError, UpdatedControl } from "./ReferenceDashboardUI";
import { CeoReferenceLayout } from "./reference/CeoReferenceLayout";
import { EmployeeReferenceLayout } from "./reference/EmployeeReferenceLayout";
import { HrReferenceLayout } from "./reference/HrReferenceLayout";
import { ManagerReferenceLayout } from "./reference/ManagerReferenceLayout";
import { PayrollReferenceLayout } from "./reference/PayrollReferenceLayout";
import { SuperAdminReferenceLayout } from "./reference/SuperAdminReferenceLayout";
import { WfmReferenceLayout } from "./reference/WfmReferenceLayout";
import "./role-dashboard-reference.css";

const DASHBOARD_CODE: Record<RoleDashboardVariant, string> = {
  employee: "EMPLOYEE_SELF_DASHBOARD",
  wfm: "WFM_DASHBOARD",
  hr: "HR_DASHBOARD",
  ceo: "CEO_DASHBOARD",
  payroll: "PAYROLL_HR_DASHBOARD",
  manager: "MANAGEMENT_DASHBOARD",
  super_admin: "CEO_DASHBOARD",
};

function unwrap(value: unknown): unknown {
  const record = asRecord(value);
  return record.data ?? value;
}

async function loadEmployee(employeeId?: string | null): Promise<EmployeeDashboardData> {
  const [attendance, leave, onboarding, lms, engagement] = await Promise.all([
    hrmsApi.get<unknown>("/api/wfm/my-attendance"),
    hrmsApi.get<unknown>("/api/leave/balance"),
    hrmsApi.get<unknown>("/api/ats/my-onboarding-status"),
    employeeId ? hrmsApi.get<unknown>(`/api/lms/learner-progress/${employeeId}`) : Promise.resolve({}),
    hrmsApi.get<unknown>("/api/engagement/me"),
  ]);
  const leavePayload = unwrap(leave);
  return {
    attendance: asRecord(unwrap(attendance)),
    balances: Array.isArray(leavePayload)
      ? asArray(leavePayload)
      : asArray(asRecord(leavePayload).balances ?? asRecord(leavePayload).data),
    onboarding: asRecord(unwrap(onboarding)),
    lms: asRecord(unwrap(lms)),
    engagement: asRecord(unwrap(engagement)),
  };
}

const EMPTY_EMPLOYEE: EmployeeDashboardData = {
  attendance: {},
  balances: [],
  onboarding: {},
  lms: {},
  engagement: {},
};

export default function ReferenceRoleDashboard({ variant }: { variant: RoleDashboardVariant }) {
  const { data: roleData, isLoading: roleLoading } = useUserRole();
  const [branchId, setBranchId] = useState("");
  const [processId, setProcessId] = useState("");

  const roleKeys = roleData?.roleKeys ?? [];
  const accessGranted = canAccessRoleDashboard(variant, roleKeys);
  const code = DASHBOARD_CODE[variant];

  const params = useMemo(() => {
    const query = new URLSearchParams();
    if (branchId) query.set("branchId", branchId);
    if (processId) query.set("processId", processId);
    return query.toString() ? `?${query.toString()}` : "";
  }, [branchId, processId]);

  const summaryQuery = useQuery({
    queryKey: ["reference-dashboard-summary", code, branchId, processId],
    queryFn: async () => asRecord(unwrap(await hrmsApi.get<unknown>(`/api/dashboards/${code}/summary${params}`))) as DashboardSummary,
    enabled: accessGranted && variant !== "employee",
    staleTime: 30_000,
    retry: 1,
  });

  const employeeQuery = useQuery({
    queryKey: ["reference-dashboard-employee", roleData?.employeeId],
    queryFn: () => loadEmployee(roleData?.employeeId),
    enabled: accessGranted && variant === "employee" && !!roleData,
    staleTime: 30_000,
    retry: 1,
  });

  const atsQuery = useQuery({
    queryKey: ["reference-dashboard-ats", variant, branchId, processId],
    queryFn: async () => asRecord(unwrap(await hrmsApi.get<unknown>(`/api/ats/stats${params}`))),
    enabled: accessGranted && ["hr", "ceo", "manager", "super_admin"].includes(variant),
    staleTime: 60_000,
    retry: 1,
  });

  const systemQuery = useQuery({
    queryKey: ["reference-dashboard-system"],
    queryFn: async () => asRecord(unwrap(await hrmsApi.get<unknown>("/api/management/system-dashboard"))),
    enabled: accessGranted && variant === "super_admin",
    staleTime: 30_000,
    retry: 1,
  });

  const workforceQuery = useQuery({
    queryKey: ["reference-dashboard-workforce", variant, branchId, processId],
    queryFn: async () => asRecord(unwrap(await hrmsApi.get<unknown>(`/api/management/workforce-dashboard${params}`))),
    enabled: accessGranted && ["ceo", "manager", "super_admin"].includes(variant),
    staleTime: 60_000,
    retry: 1,
  });

  const pnlQuery = useQuery({
    queryKey: ["reference-dashboard-pnl", variant, branchId, processId],
    queryFn: async () => asRecord(unwrap(await hrmsApi.get<unknown>(`/api/finance/pnl/summary${params}`))),
    enabled: accessGranted && ["ceo", "payroll", "super_admin"].includes(variant),
    staleTime: 60_000,
    retry: 1,
  });

  const payrollQuery = useQuery({
    queryKey: ["reference-dashboard-payroll"],
    queryFn: async () => asRecord(unwrap(await hrmsApi.get<unknown>("/api/dashboards/PAYROLL_HR_DASHBOARD/operational-summary"))),
    enabled: accessGranted && ["payroll", "super_admin"].includes(variant),
    staleTime: 60_000,
    retry: 1,
  });

  const biometricQuery = useQuery({
    queryKey: ["reference-dashboard-biometric", variant, branchId, processId],
    queryFn: async () => asRecord(unwrap(await hrmsApi.get<unknown>(`/api/wfm/biometric-summary/adherence-summary${params}`))),
    enabled: accessGranted && ["wfm", "manager"].includes(variant),
    staleTime: 30_000,
    retry: 1,
  });

  const devicesQuery = useQuery({
    queryKey: ["reference-dashboard-devices", branchId],
    queryFn: async () => asRecord(unwrap(await hrmsApi.get<unknown>(`/api/wfm/biometric-summary/device-status${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ""}`))),
    enabled: accessGranted && variant === "wfm",
    staleTime: 30_000,
    retry: 1,
  });

  const pulseQuery = useQuery({
    queryKey: ["reference-dashboard-pulse", variant, branchId, processId],
    queryFn: async () => asRecord(unwrap(await hrmsApi.get<unknown>(`/api/bi/daily-operations-pulse${params}`))),
    enabled: accessGranted && ["wfm", "manager", "ceo", "super_admin"].includes(variant),
    staleTime: 30_000,
    retry: 1,
  });

  const managerLeavesQuery = useQuery({
    queryKey: ["reference-dashboard-manager-leaves"],
    queryFn: async () => {
      const value = unwrap(await hrmsApi.get<unknown>("/api/leave/requests?limit=100"));
      const record = asRecord(value);
      return Array.isArray(value) ? asArray(value) : asArray(record.rows ?? record.requests ?? record.data);
    },
    enabled: accessGranted && variant === "manager",
    staleTime: 30_000,
    retry: 1,
  });

  const qualityQuery = useExecutiveQualitySummary(30);
  const orgKpiQuery = useOrgKpiSummary();

  const summary = (summaryQuery.data ?? {}) as DashboardSummary;
  const data: ReferenceDashboardData = {
    variant,
    summary,
    metrics: summary.metrics ?? {},
    employee: employeeQuery.data ?? EMPTY_EMPLOYEE,
    ats: atsQuery.data ?? {},
    system: systemQuery.data ?? {},
    workforce: workforceQuery.data ?? {},
    pnl: pnlQuery.data ?? {},
    payroll: payrollQuery.data ?? {},
    biometric: biometricQuery.data ?? {},
    devices: devicesQuery.data ?? {},
    opsPulse: pulseQuery.data ?? {},
    managerLeaves: managerLeavesQuery.data ?? [],
    quality: asRecord(unwrap(qualityQuery.data as unknown)),
    orgKpi: asRecord(unwrap(orgKpiQuery.data as unknown)),
    loading: roleLoading || (variant === "employee" ? employeeQuery.isLoading : summaryQuery.isLoading),
    refreshing: [summaryQuery, employeeQuery, atsQuery, systemQuery, workforceQuery, pnlQuery, payrollQuery, biometricQuery, devicesQuery, pulseQuery, managerLeavesQuery].some((query) => query.isFetching),
    generatedAt: summary.generatedAt,
  };

  const allQueries = [summaryQuery, employeeQuery, atsQuery, systemQuery, workforceQuery, pnlQuery, payrollQuery, biometricQuery, devicesQuery, pulseQuery, managerLeavesQuery];
  const hasError = allQueries.some((query) => query.isError);
  const refreshAll = () => {
    for (const query of allQueries) {
      if (query.isEnabled) void query.refetch();
    }
  };

  const filterControl = variant === "employee" ? undefined : (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <ScopedFilterBar
        onBranchChange={setBranchId}
        onProcessChange={setProcessId}
        onDateRangeChange={() => {}}
        showDateRange={false}
        className="border-0 bg-transparent p-0 shadow-none"
      />
      <UpdatedControl generatedAt={data.generatedAt} refreshing={data.refreshing} onRefresh={refreshAll} />
    </div>
  );

  if (roleLoading) {
    return (
      <DashboardLayout>
        <div className="space-y-4 p-2"><Skeleton className="h-12 w-80" /><Skeleton className="h-28 w-full" /><Skeleton className="h-80 w-full" /></div>
      </DashboardLayout>
    );
  }

  if (!accessGranted) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[65vh] items-center justify-center p-6">
          <div className="w-full max-w-md rounded-xl border border-[#ffdadd] bg-white p-8 text-center shadow-sm">
            <ShieldX className="mx-auto h-12 w-12 text-[#ef4444]" />
            <h1 className="mt-4 text-xl font-bold text-[#0b1f44]">Access Restricted</h1>
            <p className="mt-2 text-sm text-[#61708a]">Your assigned roles do not permit access to this dashboard.</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const employeeName = roleData?.employeeName ?? "Employee";

  return (
    <DashboardLayout>
      <main className="role-dashboard-reference" aria-label={`${variant} dashboard`}>
        {hasError ? (
          <div className="mb-4"><ReferenceError message="Some live dashboard sources could not be loaded. Available data is still displayed." onRetry={refreshAll} /></div>
        ) : null}
        {variant === "employee" ? <EmployeeReferenceLayout data={data} employeeName={employeeName} /> : null}
        {variant === "wfm" ? <WfmReferenceLayout data={data} filters={filterControl} /> : null}
        {variant === "hr" ? <HrReferenceLayout data={data} /> : null}
        {variant === "ceo" ? <CeoReferenceLayout data={data} filters={filterControl} /> : null}
        {variant === "payroll" ? <PayrollReferenceLayout data={data} /> : null}
        {variant === "manager" ? <ManagerReferenceLayout data={data} managerName={employeeName} /> : null}
        {variant === "super_admin" ? <SuperAdminReferenceLayout data={data} /> : null}
      </main>
    </DashboardLayout>
  );
}
