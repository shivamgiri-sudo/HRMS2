import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { Building2, ClipboardCheck, LayoutDashboard, ShieldCheck, UserRoundPlus } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import type { VisitorStatus } from "@/features/visitor/visitorApi";

const navigation = [
  { href: "/visitor-management", label: "Command center", icon: LayoutDashboard },
  { href: "/visitor-management/approvals", label: "Host approvals", icon: ClipboardCheck },
  { href: "/visitor-management/desk", label: "Guard desk", icon: UserRoundPlus },
  { href: "/visitor-management/security", label: "Security operations", icon: ShieldCheck },
];

const statusStyles: Record<VisitorStatus, string> = {
  pending_approval: "border-amber-200 bg-amber-50 text-amber-800",
  approved: "border-blue-200 bg-blue-50 text-blue-800",
  rejected: "border-rose-200 bg-rose-50 text-rose-800",
  checked_in: "border-emerald-200 bg-emerald-50 text-emerald-800",
  checked_out: "border-slate-200 bg-slate-100 text-slate-700",
  cancelled: "border-slate-200 bg-slate-100 text-slate-600",
  expired: "border-orange-200 bg-orange-50 text-orange-800",
};

export function VisitorStatusBadge({ status }: { status: VisitorStatus }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold capitalize ${statusStyles[status] ?? statusStyles.cancelled}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function VisitorStat({ label, value, hint, icon }: { label: string; value: string | number; hint: string; icon: ReactNode }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-black text-slate-950">{value}</p>
          <p className="mt-1 text-xs font-medium text-slate-400">{hint}</p>
        </div>
        <div className="rounded-2xl bg-slate-950 p-3 text-white">{icon}</div>
      </div>
    </div>
  );
}

export function VisitorEmpty({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 text-center">
      <div className="rounded-2xl bg-white p-3 text-slate-500 shadow-sm"><Building2 className="h-6 w-6" /></div>
      <h3 className="mt-4 text-base font-black text-slate-900">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>
    </div>
  );
}

export function VisitorShell({
  eyebrow,
  title,
  description,
  action,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <DashboardLayout>
      <div className="space-y-6 pb-10">
        <section className="overflow-hidden rounded-[2rem] bg-slate-950 text-white shadow-xl shadow-slate-200">
          <div className="grid gap-6 px-6 py-7 sm:px-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="flex items-start gap-4">
              <Link to="/visitor-management" className="flex h-16 w-24 shrink-0 items-center justify-center rounded-2xl bg-white p-3 shadow-lg">
                <img src="/mcn-logo.png" alt="MAS Services" className="h-auto max-h-10 w-full object-contain" />
              </Link>
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-[#6fbf45]">{eyebrow}</p>
                <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">{title}</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{description}</p>
              </div>
            </div>
            {action && <div className="flex flex-wrap gap-2 lg:justify-end">{action}</div>}
          </div>
          <div className="h-1 bg-gradient-to-r from-[#69bd45] via-[#2784c4] to-[#ed1c24]" />
        </section>

        <nav aria-label="Visitor management sections" className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          {navigation.map(({ href, label, icon: Icon }) => (
            <NavLink
              key={href}
              to={href}
              end={href === "/visitor-management"}
              className={({ isActive }) => `inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition ${isActive ? "bg-slate-950 text-white shadow-md" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        {children}
      </div>
    </DashboardLayout>
  );
}
