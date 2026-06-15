import {
  AlertCircle,
  ArrowRight,
  Award,
  BriefcaseBusiness,
  Building2,
  CircleDollarSign,
  GitBranch,
  HeartHandshake,
  LogOut,
  RefreshCcw,
  ShieldCheck,
  TrendingUp,
  UserCheck,
  UserRoundCog,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface EmployeeJourneyEvent {
  id?: string;
  event_type: string;
  event_date: string;
  description?: string | null;
  old_value?: string | null;
  new_value?: string | null;
  module?: string | null;
  actor_name?: string | null;
  status?: string | null;
  source?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface EmployeeJourneyTimelineProps {
  events: EmployeeJourneyEvent[];
  loading?: boolean;
  employeeName?: string;
  compact?: boolean;
}

const EVENT_META: Record<string, {
  icon: React.ElementType;
  label: string;
  iconClass: string;
  panelClass: string;
}> = {
  hire: { icon: UserCheck, label: "Hired", iconClass: "text-emerald-700", panelClass: "border-emerald-200 bg-emerald-50" },
  hired: { icon: UserCheck, label: "Hired", iconClass: "text-emerald-700", panelClass: "border-emerald-200 bg-emerald-50" },
  hiring: { icon: UserCheck, label: "Hired", iconClass: "text-emerald-700", panelClass: "border-emerald-200 bg-emerald-50" },
  hiring_stage: { icon: UserRoundCog, label: "Hiring stage", iconClass: "text-sky-700", panelClass: "border-sky-200 bg-sky-50" },
  joining: { icon: UserCheck, label: "Joined", iconClass: "text-emerald-700", panelClass: "border-emerald-200 bg-emerald-50" },
  confirmation: { icon: ShieldCheck, label: "Confirmed", iconClass: "text-teal-700", panelClass: "border-teal-200 bg-teal-50" },
  promotion: { icon: TrendingUp, label: "Promotion", iconClass: "text-blue-700", panelClass: "border-blue-200 bg-blue-50" },
  increment: { icon: CircleDollarSign, label: "Increment", iconClass: "text-green-700", panelClass: "border-green-200 bg-green-50" },
  salary_setup: { icon: CircleDollarSign, label: "Salary setup", iconClass: "text-green-700", panelClass: "border-green-200 bg-green-50" },
  transfer: { icon: RefreshCcw, label: "Transfer", iconClass: "text-violet-700", panelClass: "border-violet-200 bg-violet-50" },
  department_change: { icon: Building2, label: "Department change", iconClass: "text-cyan-700", panelClass: "border-cyan-200 bg-cyan-50" },
  designation_change: { icon: BriefcaseBusiness, label: "Designation change", iconClass: "text-indigo-700", panelClass: "border-indigo-200 bg-indigo-50" },
  role_change: { icon: BriefcaseBusiness, label: "Role change", iconClass: "text-indigo-700", panelClass: "border-indigo-200 bg-indigo-50" },
  process_change: { icon: RefreshCcw, label: "Process change", iconClass: "text-violet-700", panelClass: "border-violet-200 bg-violet-50" },
  branch_change: { icon: Building2, label: "Branch change", iconClass: "text-cyan-700", panelClass: "border-cyan-200 bg-cyan-50" },
  reporting_change: { icon: UserRoundCog, label: "Manager change", iconClass: "text-sky-700", panelClass: "border-sky-200 bg-sky-50" },
  appreciation: { icon: HeartHandshake, label: "Appreciation", iconClass: "text-amber-700", panelClass: "border-amber-200 bg-amber-50" },
  award: { icon: Award, label: "Award", iconClass: "text-amber-700", panelClass: "border-amber-200 bg-amber-50" },
  pip_started: { icon: AlertCircle, label: "PIP started", iconClass: "text-rose-700", panelClass: "border-rose-200 bg-rose-50" },
  pip_checkpoint: { icon: AlertCircle, label: "PIP checkpoint", iconClass: "text-orange-700", panelClass: "border-orange-200 bg-orange-50" },
  pip_outcome: { icon: ShieldCheck, label: "PIP outcome", iconClass: "text-slate-700", panelClass: "border-slate-200 bg-slate-50" },
  exit_initiated: { icon: LogOut, label: "Exit initiated", iconClass: "text-orange-700", panelClass: "border-orange-200 bg-orange-50" },
  exit_stage: { icon: LogOut, label: "Exit stage", iconClass: "text-orange-700", panelClass: "border-orange-200 bg-orange-50" },
  exit: { icon: LogOut, label: "Exited", iconClass: "text-rose-700", panelClass: "border-rose-200 bg-rose-50" },
};

function getEventMeta(type: string) {
  const normalized = type.toLowerCase();
  if (EVENT_META[normalized]) return EVENT_META[normalized];
  if (normalized.endsWith("_change")) return EVENT_META.role_change;
  if (normalized.includes("pip")) return EVENT_META.pip_checkpoint;
  return {
    icon: GitBranch,
    label: normalized.replace(/_/g, " "),
    iconClass: "text-slate-700",
    panelClass: "border-slate-200 bg-slate-50",
  };
}

function formatDate(value: string) {
  if (!value) return "Date not recorded";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatValue(value?: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "object" && parsed) {
      return Object.entries(parsed)
        .map(([key, item]) => `${key.replace(/_/g, " ")}: ${String(item)}`)
        .join(", ");
    }
  } catch {
    return value;
  }
  return value;
}

export function EmployeeJourneyTimeline({
  events,
  loading = false,
  employeeName,
  compact = false,
}: EmployeeJourneyTimelineProps) {
  const careerMoves = events.filter((event) =>
    ["promotion", "transfer", "department_change", "designation_change", "role_change", "increment"]
      .includes(event.event_type.toLowerCase())
  ).length;
  const recognitions = events.filter((event) =>
    ["appreciation", "award"].includes(event.event_type.toLowerCase())
  ).length;
  const pipEvents = events.filter((event) => event.event_type.toLowerCase().includes("pip")).length;

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-36 rounded-3xl" />
        {[1, 2, 3].map((item) => <Skeleton key={item} className="h-28 rounded-2xl" />)}
      </div>
    );
  }

  return (
    <section className="space-y-5">
      {!compact && (
        <header className="rounded-3xl bg-[#073f78] px-6 py-6 text-white shadow-sm">
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-green-200">
            Complete employee lifecycle
          </p>
          <h2 className="mt-2 text-balance text-2xl font-black">
            {employeeName ? `${employeeName}'s journey` : "My employee journey"}
          </h2>
          <p className="mt-2 max-w-3xl text-pretty text-sm leading-6 text-blue-100">
            Hiring decisions, joining, role and salary changes, performance actions,
            appreciation, promotions, transfers and exit activity in one audit-ready view.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            {[
              ["Events captured", events.length],
              ["Career moves", careerMoves],
              ["Recognition", recognitions],
              ["PIP activity", pipEvents],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3">
                <p className="text-xs font-semibold text-blue-100">{label}</p>
                <p className="mt-1 text-2xl font-black tabular-nums text-white">{value}</p>
              </div>
            ))}
          </div>
        </header>
      )}

      {events.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <GitBranch className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-base font-bold text-slate-700">No journey events recorded yet</p>
          <p className="mt-1 text-sm text-slate-500">
            New hiring, lifecycle, payroll and performance actions will appear here.
          </p>
        </div>
      ) : (
        <ol className="relative space-y-4">
          <div className="absolute bottom-5 left-6 top-5 w-px bg-slate-200" aria-hidden="true" />
          {events.map((event, index) => {
            const meta = getEventMeta(event.event_type);
            const Icon = meta.icon;
            const oldValue = formatValue(event.old_value);
            const newValue = formatValue(event.new_value);
            return (
              <li key={event.id ?? `${event.event_type}-${event.event_date}-${index}`} className="relative flex gap-4">
                <div className={cn(
                  "relative z-10 flex size-12 shrink-0 items-center justify-center rounded-2xl border-2 shadow-sm",
                  meta.panelClass
                )}>
                  <Icon className={cn("size-5", meta.iconClass)} />
                </div>

                <article className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={cn("rounded-lg font-extrabold capitalize", meta.panelClass, meta.iconClass)}>
                        {meta.label}
                      </Badge>
                      {event.module && (
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                          {event.module}
                        </span>
                      )}
                      {event.status && (
                        <Badge variant="secondary" className="rounded-lg capitalize">
                          {event.status.replace(/_/g, " ")}
                        </Badge>
                      )}
                    </div>
                    <time className="shrink-0 text-xs font-bold text-slate-500">
                      {formatDate(event.event_date)}
                    </time>
                  </div>

                  {event.description && (
                    <p className="mt-3 text-pretty text-sm font-semibold leading-6 text-slate-800">
                      {event.description}
                    </p>
                  )}

                  {(oldValue || newValue) && (
                    <div className="mt-3 flex flex-col gap-2 rounded-xl bg-slate-50 p-3 text-sm sm:flex-row sm:items-center">
                      {oldValue && <span className="rounded-lg bg-white px-3 py-1.5 font-medium text-slate-600">{oldValue}</span>}
                      {oldValue && newValue && <ArrowRight className="size-4 shrink-0 text-slate-400" />}
                      {newValue && <span className="rounded-lg bg-emerald-50 px-3 py-1.5 font-bold text-emerald-800">{newValue}</span>}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <UserRoundCog className="size-3.5" />
                    <span>
                      Action by <strong className="font-bold text-slate-700">{event.actor_name || "System / HR team"}</strong>
                    </span>
                    {event.source && <span className="text-slate-300">•</span>}
                    {event.source && <span className="capitalize">{event.source.replace(/_/g, " ")}</span>}
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
