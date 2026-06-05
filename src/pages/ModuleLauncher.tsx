import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
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
  Package,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  WalletCards,
  Zap,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
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
  href: string;
  icon: JSX.Element;
  gradient: string;
  iconTone: string;
  metric: string;
  badge: string;
  progress: number;
};

const experienceCards: ExperienceCard[] = [
  { title: "Employee Home", href: "/dashboard", icon: <Sparkles className="h-5 w-5" />, gradient: "from-blue-600 to-cyan-500", iconTone: "bg-blue-600 text-white", metric: "96%", badge: "My Space", progress: 96 },
  { title: "Payroll", href: "/payroll", icon: <CreditCard className="h-5 w-5" />, gradient: "from-emerald-600 to-teal-400", iconTone: "bg-emerald-600 text-white", metric: "₹", badge: "Pay Hub", progress: 88 },
  { title: "ATS → Onboard", href: "/ats/command-center", icon: <Briefcase className="h-5 w-5" />, gradient: "from-violet-600 to-indigo-500", iconTone: "bg-violet-600 text-white", metric: "AI", badge: "Hiring", progress: 92 },
  { title: "Auto Roster", href: "/wfm/auto-roster", icon: <Calendar className="h-5 w-5" />, gradient: "from-amber-500 to-orange-500", iconTone: "bg-amber-500 text-white", metric: "98%", badge: "WFM", progress: 98 },
  { title: "Engagement", href: "/engagement", icon: <Heart className="h-5 w-5" />, gradient: "from-rose-600 to-pink-500", iconTone: "bg-rose-600 text-white", metric: "4.8", badge: "Pulse", progress: 84 },
  { title: "Offboarding", href: "/exit/command-center", icon: <ClipboardCheck className="h-5 w-5" />, gradient: "from-slate-900 to-slate-600", iconTone: "bg-slate-900 text-white", metric: "F&F", badge: "Exit", progress: 76 },
];

const intelligenceCards = [
  { title: "AI JD", value: "Ready", icon: <Bot className="h-4 w-4" />, tone: "border-blue-100 bg-blue-50 text-blue-700" },
  { title: "Candidate Score", value: "Smart", icon: <Target className="h-4 w-4" />, tone: "border-violet-100 bg-violet-50 text-violet-700" },
  { title: "Assessment", value: "Live", icon: <FileText className="h-4 w-4" />, tone: "border-emerald-100 bg-emerald-50 text-emerald-700" },
  { title: "Agency", value: "Tracked", icon: <Users className="h-4 w-4" />, tone: "border-amber-100 bg-amber-50 text-amber-700" },
];

const workflowSteps = ["Selected", "Onboard", "BGV", "Employee ID", "Payroll"];

const shiftRows = [
  { name: "Morning", team: "Domestic", time: "09:00 - 18:00", color: "bg-amber-400", value: 92 },
  { name: "Evening", team: "Chat", time: "13:00 - 22:00", color: "bg-rose-500", value: 78 },
  { name: "Night", team: "International", time: "22:00 - 07:00", color: "bg-blue-700", value: 86 },
];

const fallbackPages: PageRow[] = [
  { page_code: "DASHBOARD", module_code: "HRMS", page_name: "Dashboard", page_description: "", route_path: "/dashboard", display_order: 1 },
  { page_code: "ATS_DASHBOARD", module_code: "ATS", page_name: "ATS Command", page_description: "", route_path: "/ats/command-center", display_order: 2 },
  { page_code: "WFM_AUTO_ROSTER", module_code: "WFM", page_name: "Auto Roster", page_description: "", route_path: "/wfm/auto-roster", display_order: 3 },
  { page_code: "KPI_CONFIG", module_code: "PERFORMANCE", page_name: "KPI Config", page_description: "", route_path: "/kpi-config", display_order: 4 },
  { page_code: "PAYROLL", module_code: "HRMS", page_name: "Payroll", page_description: "", route_path: "/payroll", display_order: 5 },
  { page_code: "ENGAGEMENT", module_code: "HRMS", page_name: "Engagement", page_description: "", route_path: "/engagement", display_order: 6 },
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
      <div className="min-h-screen space-y-6 bg-[#f6f8fc] pb-8">
        <Card className="overflow-hidden rounded-[2rem] border-slate-200 bg-slate-950 text-white shadow-2xl shadow-slate-300/50">
          <div className="grid xl:grid-cols-[1.15fr_0.85fr]">
            <CardContent className="relative p-6 sm:p-8">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,rgba(59,130,246,0.45),transparent_30%),radial-gradient(circle_at_80%_20%,rgba(16,185,129,0.22),transparent_28%),radial-gradient(circle_at_70%_100%,rgba(244,63,94,0.24),transparent_30%)]" />
              <div className="relative">
                <Badge className="border border-white/15 bg-white/10 text-cyan-100 hover:bg-white/10">
                  <CheckCircle2 className="mr-2 h-3.5 w-3.5" /> Premium PeopleOS
                </Badge>
                <h1 className="mt-5 max-w-3xl text-3xl font-black tracking-tight sm:text-5xl">MAS Command Workspace</h1>
                <div className="mt-6 grid max-w-3xl gap-3 sm:grid-cols-3">
                  {[["Role Views", "12+"], ["Live Modules", "40+"], ["Workflow Ready", "100%"]].map(([title, value]) => (
                    <Card key={title} className="rounded-2xl border-white/10 bg-white/10 text-white shadow-none backdrop-blur-md">
                      <CardContent className="p-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">{title}</p>
                        <p className="mt-1 text-2xl font-black">{value}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </CardContent>

            <CardContent className="border-t border-white/10 bg-white/[0.04] p-5 xl:border-l xl:border-t-0">
              <Card className="rounded-[1.75rem] border-white/10 bg-white/10 text-white shadow-2xl backdrop-blur-md">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">My Space</p>
                      <h2 className="mt-1 text-2xl font-black">Today</h2>
                    </div>
                    <Badge className="bg-emerald-400 text-emerald-950 hover:bg-emerald-400">Live</Badge>
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-400 p-4 shadow-lg shadow-blue-950/20">
                      <p className="text-xs font-bold text-blue-50">Check-in</p>
                      <Button className="mt-8 w-full bg-white text-blue-700 hover:bg-blue-50">Start</Button>
                    </div>
                    <div className="space-y-3">
                      <div className="rounded-2xl bg-white p-3 text-slate-950"><p className="text-xs font-bold text-slate-500">Attendance</p><p className="text-xl font-black">96%</p></div>
                      <div className="rounded-2xl bg-white p-3 text-slate-950"><p className="text-xs font-bold text-slate-500">Punctuality</p><p className="text-xl font-black">91%</p></div>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-2 text-xs font-black text-slate-950">
                    {[["Pay", <WalletCards className="h-4 w-4" />], ["Leave", <Calendar className="h-4 w-4" />], ["Kudos", <Heart className="h-4 w-4" />], ["Help", <Zap className="h-4 w-4" />]].map(([label, icon]) => (
                      <div key={String(label)} className="flex flex-col items-center gap-1 rounded-2xl bg-white p-3">
                        {icon}<span>{label}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </CardContent>
          </div>
        </Card>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {experienceCards.map((card) => (
            <Card key={card.title} className="group overflow-hidden rounded-[1.6rem] border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-2xl hover:shadow-slate-300/60">
              <div className={`h-1.5 bg-gradient-to-r ${card.gradient}`} />
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div className={`rounded-2xl p-3 shadow-lg ${card.iconTone}`}>{card.icon}</div>
                  <Badge className="bg-slate-950 text-white hover:bg-slate-900">{card.badge}</Badge>
                </div>
                <div className="mt-5 flex items-end justify-between">
                  <div>
                    <CardTitle className="text-lg font-black text-slate-950">{card.title}</CardTitle>
                    <p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-400">Open module</p>
                  </div>
                  <p className="text-3xl font-black text-slate-900">{card.metric}</p>
                </div>
                <Progress value={card.progress} className="mt-4 h-2 bg-slate-100 [&>div]:bg-slate-950" />
                <Button asChild variant="ghost" className="mt-4 h-8 px-0 text-blue-700 hover:bg-transparent hover:text-blue-900">
                  <Link to={card.href}>Open <ArrowRight className="ml-1 h-4 w-4" /></Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
          <Card className="rounded-[1.6rem] border-slate-200 bg-white shadow-sm">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.12em] text-blue-700">Onboarding</p>
                <CardTitle className="text-2xl font-black text-slate-950">Hire → Employee</CardTitle>
              </div>
              <div className="rounded-2xl bg-blue-600 p-3 text-white shadow-lg shadow-blue-200"><TrendingUp className="h-5 w-5" /></div>
            </CardHeader>
            <CardContent className="grid gap-3 pt-3">
              {workflowSteps.map((step, index) => (
                <div key={step} className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-2xl text-sm font-black text-white ${index < 3 ? "bg-emerald-500" : "bg-blue-600"}`}>{index < 3 ? "✓" : index + 1}</div>
                  <div className="flex-1 rounded-2xl bg-slate-50 px-4 py-3 font-black text-slate-900">{step}</div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-[1.6rem] border-slate-200 bg-white shadow-sm">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.12em] text-emerald-700">Roster</p>
                <CardTitle className="text-2xl font-black text-slate-950">Coverage View</CardTitle>
              </div>
              <div className="rounded-2xl bg-emerald-500 p-3 text-white shadow-lg shadow-emerald-200"><Clock className="h-5 w-5" /></div>
            </CardHeader>
            <CardContent className="pt-3">
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <div className="grid grid-cols-3 bg-slate-950 text-xs font-black uppercase tracking-wide text-white">
                  <div className="p-3">Shift</div><div className="p-3">Team</div><div className="p-3">Coverage</div>
                </div>
                {shiftRows.map((row) => (
                  <div key={row.name} className="grid grid-cols-3 border-t border-slate-200 text-sm">
                    <div className="flex items-center gap-3 p-3"><span className={`h-4 w-4 rounded-full ${row.color}`} /> <span className="font-black text-slate-900">{row.name}</span></div>
                    <div className="p-3 font-semibold text-slate-600">{row.team}</div>
                    <div className="p-3">
                      <Progress value={row.value} className="h-2 bg-slate-100 [&>div]:bg-slate-950" />
                      <p className="mt-1 text-[11px] font-bold text-slate-400">{row.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 lg:grid-cols-4">
          {intelligenceCards.map((card) => (
            <Card key={card.title} className="rounded-[1.4rem] border-slate-200 bg-white shadow-sm">
              <CardContent className="p-5">
                <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${card.tone}`}>{card.icon}</div>
                <p className="mt-4 text-sm font-black text-slate-950">{card.title}</p>
                <p className="mt-1 text-2xl font-black text-slate-900">{card.value}</p>
              </CardContent>
            </Card>
          ))}
        </section>

        <Card className="rounded-[1.6rem] border-slate-200 bg-white shadow-sm">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Navigation</p>
              <CardTitle className="text-2xl font-black text-slate-950">Role Map</CardTitle>
            </div>
            {isLoading && <Badge variant="secondary">Loading</Badge>}
          </CardHeader>
          <CardContent className="grid gap-5 pt-3 lg:grid-cols-2">
            {Object.entries(grouped).map(([moduleCode, modulePages]) => (
              <div key={moduleCode} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-4 flex items-center gap-3">
                  <div className="rounded-2xl bg-slate-950 p-3 text-white shadow-lg shadow-slate-300">{iconMap[moduleCode] ?? <ArrowRight className="h-5 w-5" />}</div>
                  <div>
                    <h3 className="text-base font-black text-slate-950">{modulePages[0]?.module_master?.module_name ?? moduleCode}</h3>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{moduleCode}</p>
                  </div>
                </div>
                <div className="grid gap-2">
                  {modulePages.slice(0, 6).map((page) => (
                    <Button key={page.page_code} asChild variant="outline" className="h-auto justify-between rounded-xl border-slate-200 bg-white p-3 font-bold text-slate-900 hover:border-blue-300 hover:bg-blue-50">
                      <Link to={page.route_path || "/dashboard"}>
                        <span>{page.page_name}</span>
                        <ChevronRight className="h-4 w-4 text-slate-500" />
                      </Link>
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
