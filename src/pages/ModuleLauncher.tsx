import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Bot,
  Briefcase,
  Calendar,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock,
  CreditCard,
  FileText,
  GraduationCap,
  Heart,
  Landmark,
  MessageSquare,
  Package,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  WalletCards,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";

const iconMap: Record<string, JSX.Element> = {
  HRMS: <Users className="h-5 w-5" />,
  ATS: <Briefcase className="h-5 w-5" />,
  LMS: <GraduationCap className="h-5 w-5" />,
  WFM: <Clock className="h-5 w-5" />,
  QUALITY: <ShieldCheck className="h-5 w-5" />,
  OPERATIONS: <BarChart3 className="h-5 w-5" />,
  PERFORMANCE: <Target className="h-5 w-5" />,
  SETTINGS: <Package className="h-5 w-5" />,
};

type PageRow = {
  page_code: string;
  module_code: string;
  page_name: string;
  page_description: string | null;
  route_path: string | null;
  display_order: number;
  is_base_hrms_page?: boolean;
  module_master?: { module_name: string; module_group: string | null } | null;
};

type ExperienceCard = {
  title: string;
  description: string;
  href: string;
  icon: JSX.Element;
  tone: string;
  badge?: string;
};

const roleExperienceCards: ExperienceCard[] = [
  {
    title: "Employee Home",
    description: "Attendance, leave, requests, quick links, celebrations and profile readiness in one card-based workspace.",
    href: "/dashboard",
    icon: <Sparkles className="h-5 w-5" />,
    tone: "from-blue-50 to-sky-50 text-blue-700 ring-blue-100",
    badge: "My Space",
  },
  {
    title: "Payroll Self-Service",
    description: "Gross/net pay, deductions, payslips, tax declaration, reimbursement, loans and F&F status.",
    href: "/payroll",
    icon: <CreditCard className="h-5 w-5" />,
    tone: "from-emerald-50 to-teal-50 text-emerald-700 ring-emerald-100",
    badge: "Finance Ready",
  },
  {
    title: "ATS → Auto-Onboard",
    description: "Candidate selected to onboarding, BGV, employee profile, login, payroll and attendance setup.",
    href: "/ats/command-center",
    icon: <Briefcase className="h-5 w-5" />,
    tone: "from-indigo-50 to-violet-50 text-indigo-700 ring-indigo-100",
    badge: "Hire to HRMS",
  },
  {
    title: "WFM Roster Cockpit",
    description: "Shift coverage, week-off planning, shrinkage buffer, manager approval and change notifications.",
    href: "/wfm/auto-roster",
    icon: <Calendar className="h-5 w-5" />,
    tone: "from-amber-50 to-orange-50 text-amber-700 ring-amber-100",
    badge: "Roster AI",
  },
  {
    title: "Engagement Wall",
    description: "Kudos, badges, rewards, birthdays, referrals, pulse surveys, happiness index and smart alerts.",
    href: "/engagement",
    icon: <Heart className="h-5 w-5" />,
    tone: "from-rose-50 to-pink-50 text-rose-700 ring-rose-100",
    badge: "Experience",
  },
  {
    title: "Offboarding Control",
    description: "Resignation, manager review, retention, clearance, assets, access revoke, F&F and letters.",
    href: "/exit/command-center",
    icon: <ClipboardCheck className="h-5 w-5" />,
    tone: "from-slate-50 to-gray-50 text-slate-700 ring-slate-200",
    badge: "Exit Flow",
  },
];

const atsAiCards = [
  { title: "AI JD Generator", detail: "Generate process-wise JD and publish-ready description.", icon: <Bot className="h-4 w-4" /> },
  { title: "AI Candidate Scoring", detail: "Score CVs, skills, experience and role alignment.", icon: <Target className="h-4 w-4" /> },
  { title: "Assessment Builder", detail: "MCQ, typing, process test, video and anti-cheat readiness.", icon: <FileText className="h-4 w-4" /> },
  { title: "Agency Attribution", detail: "Unique source links, vendor quality and hiring conversion.", icon: <Users className="h-4 w-4" /> },
];

const onboardingSteps = [
  "Candidate selected",
  "Onboarding link sent",
  "Documents & BGV verified",
  "Employee record created",
  "Payroll + attendance setup",
];

const shiftRows = [
  { name: "Morning", team: "Domestic Voice", time: "09:00 - 18:00", color: "bg-amber-400" },
  { name: "Evening", team: "Chat Support", time: "13:00 - 22:00", color: "bg-rose-500" },
  { name: "Night", team: "International", time: "22:00 - 07:00", color: "bg-blue-700" },
];

const fallbackPages: PageRow[] = [
  { page_code: "DASHBOARD", module_code: "HRMS", page_name: "Employee Dashboard", page_description: "My Space, Team Space, attendance and pending actions", route_path: "/dashboard", display_order: 1 },
  { page_code: "ATS_DASHBOARD", module_code: "ATS", page_name: "ATS Command Center", page_description: "Candidate pipeline, onboarding bridge and BGV", route_path: "/ats/command-center", display_order: 2 },
  { page_code: "WFM_AUTO_ROSTER", module_code: "WFM", page_name: "Auto Roster", page_description: "Slot coverage, week-offs, shrinkage and roster publish", route_path: "/wfm/auto-roster", display_order: 3 },
  { page_code: "KPI_CONFIG", module_code: "PERFORMANCE", page_name: "KPI Configuration", page_description: "Process-wise and role-wise KPI target engine", route_path: "/kpi-config", display_order: 4 },
  { page_code: "PAYROLL", module_code: "HRMS", page_name: "Payroll Workspace", page_description: "Salary, tax, payslip, reimbursement and F&F", route_path: "/payroll", display_order: 5 },
  { page_code: "ENGAGEMENT", module_code: "HRMS", page_name: "Engagement Wall", page_description: "Kudos, badges, pulse and celebrations", route_path: "/engagement", display_order: 6 },
];

export default function ModuleLauncher() {
  const access = useWorkforceAccess();

  const { data: pages = [], isLoading } = useQuery({
    queryKey: ["workforce-module-launcher", access.visiblePageCodes],
    queryFn: async () => {
      try {
        const res = await hrmsApi.get<{ success?: boolean; data?: PageRow[] }>("/api/access/pages/catalog");
        const catalog = Array.isArray(res.data) ? res.data : [];
        if (!access.visiblePageCodes.length) return catalog;
        return catalog.filter((page) => access.visiblePageCodes.includes(page.page_code));
      } catch {
        return fallbackPages;
      }
    },
    enabled: !access.isLoading,
  });

  const grouped = useMemo(() => {
    const source = pages.length ? pages : fallbackPages;
    return source.reduce<Record<string, PageRow[]>>((acc, page) => {
      acc[page.module_code] = acc[page.module_code] || [];
      acc[page.module_code].push(page);
      return acc;
    }, {});
  }, [pages]);

  return (
    <DashboardLayout>
      <div className="space-y-6 bg-slate-50/40 pb-6">
        <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-0 xl:grid-cols-[1.25fr_0.75fr]">
            <div className="relative p-6 sm:p-8">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.10),_transparent_35%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.12),_transparent_35%)]" />
              <div className="relative">
                <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  MAS PeopleOS experience blueprint
                </div>
                <h1 className="mt-5 max-w-3xl text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
                  One modern workspace for hiring, onboarding, payroll, WFM, KPI and engagement.
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                  Built contract-first so every attractive card, graph and workflow is backed by a stable API or a safe placeholder until the backend is ready. Existing MAS logo and branding remain untouched.
                </p>
                <div className="mt-6 grid gap-3 sm:grid-cols-3">
                  {[
                    ["Role based", "Cards change by employee, TL, HR, WFM, payroll and leadership"],
                    ["Mobile ready", "Employee actions fit the phone-first dashboard pattern"],
                    ["No API breaks", "UI calls service layer and falls back safely while APIs mature"],
                  ].map(([title, text]) => (
                    <div key={title} className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur">
                      <p className="text-sm font-semibold text-slate-950">{title}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">{text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 bg-slate-950 p-6 text-white xl:border-l xl:border-t-0">
              <div className="rounded-[1.75rem] border border-white/10 bg-white/10 p-4 shadow-2xl">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-200">Employee app preview</p>
                    <h2 className="mt-1 text-xl font-semibold">My Space</h2>
                  </div>
                  <div className="rounded-full bg-blue-500 px-3 py-1 text-xs font-bold">Live</div>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-blue-600 p-4">
                    <p className="text-xs text-blue-100">Check-in Required</p>
                    <button className="mt-4 w-full rounded-xl bg-white py-2 text-xs font-bold text-blue-700">Check-in</button>
                  </div>
                  <div className="space-y-3">
                    <div className="rounded-2xl bg-white p-3 text-slate-900"><p className="text-xs text-slate-500">Attendance</p><p className="text-lg font-bold">96%</p></div>
                    <div className="rounded-2xl bg-white p-3 text-slate-900"><p className="text-xs text-slate-500">Punctuality</p><p className="text-lg font-bold">91%</p></div>
                  </div>
                </div>
                <div className="mt-3 rounded-2xl bg-white p-4 text-slate-900">
                  <p className="text-sm font-semibold">Quick Links</p>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    {[
                      ["Payslip", <WalletCards className="h-4 w-4" />],
                      ["Leave", <Calendar className="h-4 w-4" />],
                      ["Kudos", <Heart className="h-4 w-4" />],
                      ["Helpdesk", <MessageSquare className="h-4 w-4" />],
                    ].map(([label, icon]) => (
                      <div key={String(label)} className="flex items-center gap-2 rounded-xl bg-slate-50 p-2 font-medium text-slate-700">
                        {icon}<span>{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {roleExperienceCards.map((card) => (
            <Link key={card.title} to={card.href} className="group rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-xl">
              <div className="flex items-start justify-between gap-4">
                <div className={`rounded-2xl bg-gradient-to-br p-3 ring-1 ${card.tone}`}>{card.icon}</div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">{card.badge}</span>
              </div>
              <h3 className="mt-5 text-lg font-semibold text-slate-950">{card.title}</h3>
              <p className="mt-2 min-h-[3.75rem] text-sm leading-6 text-slate-500">{card.description}</p>
              <div className="mt-4 flex items-center text-sm font-semibold text-blue-700">Open workspace <ArrowRight className="ml-2 h-4 w-4 transition group-hover:translate-x-1" /></div>
            </Link>
          ))}
        </section>

        <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Hire to onboard flow</p>
                <h2 className="mt-1 text-xl font-semibold text-slate-950">Visual workflow timeline</h2>
              </div>
              <BadgeCheck className="h-6 w-6 text-emerald-600" />
            </div>
            <div className="mt-5 space-y-4">
              {onboardingSteps.map((step, index) => (
                <div key={step} className="flex items-center gap-4">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white ${index < 3 ? "bg-emerald-600" : "bg-blue-600"}`}>{index < 3 ? "✓" : index + 1}</div>
                  <div className="flex-1 rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-sm font-semibold text-slate-900">{step}</p>
                    <p className="text-xs text-slate-500">API contract: status, owner, SLA, action link, audit log</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Roster planning</p>
                <h2 className="mt-1 text-xl font-semibold text-slate-950">Shift view with icons and colors</h2>
              </div>
              <Clock className="h-6 w-6 text-blue-700" />
            </div>
            <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
              <div className="grid grid-cols-3 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <div className="p-3">Shift Type</div><div className="p-3">Team</div><div className="p-3">Working Hours</div>
              </div>
              {shiftRows.map((row) => (
                <div key={row.name} className="grid grid-cols-3 border-t border-slate-200 text-sm">
                  <div className="flex items-center gap-3 p-3"><span className={`h-5 w-5 rounded-full ${row.color}`} /> <span className="font-semibold text-slate-900">{row.name}</span></div>
                  <div className="p-3 text-slate-600">{row.team}</div>
                  <div className="p-3 font-semibold text-slate-900">{row.time}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-4">
          {atsAiCards.map((card) => (
            <div key={card.title} className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50 text-blue-700 ring-1 ring-blue-100">{card.icon}</div>
              <h3 className="mt-4 text-sm font-semibold text-slate-950">{card.title}</h3>
              <p className="mt-2 text-xs leading-5 text-slate-500">{card.detail}</p>
            </div>
          ))}
        </section>

        <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Available modules</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-950">Role-based navigation map</h2>
            </div>
            {isLoading && <span className="text-xs text-slate-500">Loading access…</span>}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {Object.entries(grouped).map(([moduleCode, modulePages]) => (
              <div key={moduleCode} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="mb-4 flex items-center gap-3">
                  <div className="rounded-2xl bg-white p-3 text-slate-700 shadow-sm ring-1 ring-slate-200">{iconMap[moduleCode] ?? <ArrowRight className="h-5 w-5" />}</div>
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">{modulePages[0]?.module_master?.module_name ?? moduleCode}</h3>
                    <p className="text-xs uppercase tracking-wide text-slate-500">{moduleCode}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {modulePages.map((page) => (
                    <Link key={page.page_code} to={page.route_path || "/dashboard"} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 transition hover:border-blue-200 hover:bg-blue-50/50">
                      <div>
                        <p className="font-medium text-slate-900">{page.page_name}</p>
                        <p className="text-sm text-slate-500">{page.page_description || "Open workspace"}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-slate-400" />
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}
