import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";
import {
  Activity,
  UserPlus,
  CalendarCheck,
  CalendarX,
  AlertTriangle,
  LogOut,
  Package,
  FileText,
  Bell,
} from "lucide-react";
import { useIsAdminOrHR } from "@/hooks/useUserRole";
import { useWorkforceAccess } from "@/hooks/useUserRole";

interface FeedItem {
  id: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  title: string;
  subtitle: string;
  timeAgo: string;
}

const getInitials = (name: string) =>
  name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

async function fetchAdminFeed(): Promise<FeedItem[]> {
  const items: FeedItem[] = [];

  const [employeesRes, leaveRes, auditRes] = await Promise.allSettled([
    hrmsApi.get<{ data: any[] }>("/api/employees?limit=5&sort=created_at&order=desc"),
    hrmsApi.get<{ data: any[] }>("/api/leave/requests?limit=8&status=approved,rejected"),
    hrmsApi.get<{ data: any[] }>("/api/access/audit-log?limit=20&module=resignation"),
  ]);

  if (employeesRes.status === "fulfilled") {
    const employees = employeesRes.value.data ?? [];
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    for (const emp of employees) {
      const createdAt = emp.created_at ?? emp.joining_date;
      if (!createdAt) continue;
      const ts = new Date(createdAt).getTime();
      if (ts < cutoff) continue;
      items.push({
        id: `emp-${emp.id}`,
        icon: UserPlus,
        iconColor: "text-emerald-600",
        iconBg: "bg-emerald-50",
        title: `${emp.full_name ?? emp.name ?? "New employee"} joined`,
        subtitle: emp.designation ?? emp.department ?? "New hire",
        timeAgo: formatDistanceToNow(new Date(createdAt), { addSuffix: true }),
      });
    }
  }

  if (leaveRes.status === "fulfilled") {
    const requests = leaveRes.value.data ?? [];
    for (const req of requests) {
      const isApproved = String(req.status ?? "").toLowerCase() === "approved";
      const isRejected = String(req.status ?? "").toLowerCase() === "rejected";
      if (!isApproved && !isRejected) continue;
      const name = req.employee_name ?? req.name ?? "An employee";
      const leaveType = req.leave_type ?? req.type ?? "leave";
      const updatedAt = req.updated_at ?? req.created_at;
      items.push({
        id: `leave-${req.id ?? req.request_id}`,
        icon: isApproved ? CalendarCheck : CalendarX,
        iconColor: isApproved ? "text-sky-600" : "text-rose-600",
        iconBg: isApproved ? "bg-sky-50" : "bg-rose-50",
        title: isApproved
          ? `${name}'s ${leaveType} leave approved`
          : `${name}'s ${leaveType} leave rejected`,
        subtitle: req.from_date
          ? `${req.from_date}${req.to_date ? ` → ${req.to_date}` : ""}`
          : "Leave request",
        timeAgo: updatedAt
          ? formatDistanceToNow(new Date(updatedAt), { addSuffix: true })
          : "",
      });
    }
  }

  if (auditRes.status === "fulfilled") {
    const logs = auditRes.value.data ?? [];
    for (const log of logs) {
      if (log.entity_type !== "resignation") continue;
      const name =
        (log.details as any)?.employee_name ?? log.actor_name ?? "An employee";
      items.push({
        id: `resign-${log.id}`,
        icon: LogOut,
        iconColor: "text-orange-600",
        iconBg: "bg-orange-50",
        title: `${name} submitted a resignation`,
        subtitle: "Pending exit process",
        timeAgo: formatDistanceToNow(new Date(log.created_at ?? log.timestamp), {
          addSuffix: true,
        }),
      });
    }
  }

  items.sort((a, b) => {
    const tsA = parseTimeAgo(a.timeAgo);
    const tsB = parseTimeAgo(b.timeAgo);
    return tsA - tsB;
  });

  return items.slice(0, 10);
}

async function fetchEmployeeFeed(employeeId: string | null): Promise<FeedItem[]> {
  const items: FeedItem[] = [];

  const [myLeaveRes, myAuditRes] = await Promise.allSettled([
    hrmsApi.get<{ data: any[] }>("/api/leave/requests/my?limit=6"),
    hrmsApi.get<{ data: any[] }>(
      `/api/access/audit-log?limit=20${employeeId ? `&employeeId=${employeeId}` : ""}`
    ),
  ]);

  if (myLeaveRes.status === "fulfilled") {
    const requests = myLeaveRes.value.data ?? [];
    for (const req of requests) {
      const status = String(req.status ?? "").toLowerCase();
      const leaveType = req.leave_type ?? req.type ?? "Leave";
      const updatedAt = req.updated_at ?? req.created_at;
      let icon: React.ElementType = CalendarCheck;
      let iconColor = "text-sky-600";
      let iconBg = "bg-sky-50";
      let verb = "requested";
      if (status === "approved") { icon = CalendarCheck; iconColor = "text-emerald-600"; iconBg = "bg-emerald-50"; verb = "approved"; }
      else if (status === "rejected") { icon = CalendarX; iconColor = "text-rose-600"; iconBg = "bg-rose-50"; verb = "rejected"; }
      else if (status === "pending") { icon = Bell; iconColor = "text-amber-600"; iconBg = "bg-amber-50"; verb = "pending approval"; }

      items.push({
        id: `myleave-${req.id ?? req.request_id}`,
        icon,
        iconColor,
        iconBg,
        title: `${leaveType} leave ${verb}`,
        subtitle: req.from_date ? `${req.from_date}${req.to_date ? ` → ${req.to_date}` : ""}` : "Leave request",
        timeAgo: updatedAt ? formatDistanceToNow(new Date(updatedAt), { addSuffix: true }) : "",
      });
    }
  }

  if (myAuditRes.status === "fulfilled") {
    const logs = myAuditRes.value.data ?? [];
    for (const log of logs) {
      const details = (log.details as any) ?? {};
      if (log.entity_type === "asset_assignment") {
        const assetName = details.asset_name ?? "an asset";
        const isReturn = String(log.action ?? "").toLowerCase().includes("return");
        items.push({
          id: `myasset-${log.id}`,
          icon: Package,
          iconColor: "text-violet-600",
          iconBg: "bg-violet-50",
          title: isReturn ? `Returned ${assetName}` : `Assigned: ${assetName}`,
          subtitle: "Asset update",
          timeAgo: formatDistanceToNow(new Date(log.created_at ?? log.timestamp), { addSuffix: true }),
        });
      }
      if (log.entity_type === "payslip") {
        const month = details.month ?? details.salary_month ?? "";
        items.push({
          id: `payslip-${log.id}`,
          icon: FileText,
          iconColor: "text-indigo-600",
          iconBg: "bg-indigo-50",
          title: `Payslip ready${month ? ` — ${month}` : ""}`,
          subtitle: "View in Payroll",
          timeAgo: formatDistanceToNow(new Date(log.created_at ?? log.timestamp), { addSuffix: true }),
        });
      }
    }
  }

  items.sort((a, b) => parseTimeAgo(a.timeAgo) - parseTimeAgo(b.timeAgo));
  return items.slice(0, 10);
}

function parseTimeAgo(str: string): number {
  if (!str) return Infinity;
  const m = str.match(/(\d+)\s*(second|minute|hour|day|week|month|year)/);
  if (!m) return Infinity;
  const n = parseInt(m[1], 10);
  const unit = m[2];
  const multipliers: Record<string, number> = {
    second: 1, minute: 60, hour: 3600, day: 86400,
    week: 604800, month: 2592000, year: 31536000,
  };
  return n * (multipliers[unit] ?? 1);
}

function FeedList({ items }: { items: FeedItem[] }) {
  return (
    <div className="space-y-1">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={item.id}
            className="flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/40"
          >
            <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${item.iconBg}`}>
              <Icon className={`h-4 w-4 ${item.iconColor}`} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-snug text-foreground">{item.title}</p>
              <p className="text-xs text-muted-foreground">{item.subtitle}</p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap pt-0.5">
              {item.timeAgo}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-3 w-14 shrink-0" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted mb-3">
        <Activity className="h-6 w-6 text-muted-foreground/50" />
      </div>
      <p className="text-sm font-medium text-muted-foreground">
        {isAdmin ? "All quiet today" : "No recent activity"}
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        {isAdmin
          ? "New joins, leave decisions and exceptions will appear here"
          : "Your leave status, assets and payslips will appear here"}
      </p>
    </div>
  );
}

export function RecentActivity() {
  const { isAdminOrHR, roleKeys } = useIsAdminOrHR();
  const { employeeId } = useWorkforceAccess();
  const isBranchHead = roleKeys.includes("branch_head");
  const isAdmin = isAdminOrHR || isBranchHead;

  const { data: items, isLoading } = useQuery({
    queryKey: ["recent-activity-feed", isAdmin, employeeId],
    queryFn: () => (isAdmin ? fetchAdminFeed() : fetchEmployeeFeed(employeeId)),
    enabled: roleKeys.length > 0,
    staleTime: 60_000,
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-1">
        {isLoading ? (
          <LoadingState />
        ) : !items || items.length === 0 ? (
          <EmptyState isAdmin={isAdmin} />
        ) : (
          <FeedList items={items} />
        )}
      </CardContent>
    </Card>
  );
}
