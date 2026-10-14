/**
 * HRMS Guide — the self-service manual for every role.
 *
 * Content lives in src/data/hrmsGuide/roles/* (one file per role, loaded on demand). This page:
 *  - opens the guide that matches the signed-in user's role automatically,
 *  - adds the shared "Getting started" and "Self-service" sections for staff,
 *  - searches the current guide or every guide,
 *  - deep-links to a role / module / activity (?role=&module=&activity=) so a link can be shared.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Activity, AlertCircle, AlertTriangle, ArrowRight, Award, BarChart3, Bell, BookOpen, Briefcase, Building2,
  Calendar, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, ClipboardList,
  Clock, Coffee, CreditCard, DollarSign, Download, Eye, FileCheck, FileText, Gauge, GitBranch,
  GraduationCap, Headset, Heart, HelpCircle, Inbox, IndianRupee, Info, Key, Landmark, Laptop,
  LayoutDashboard, Lightbulb, Link2, ListChecks, Loader2, Lock, LogIn, Mail, Map, MessageSquare, Network,
  Package, Phone, Receipt, RotateCcw, Route, Search, Server, Settings, Shield, ShieldAlert, ShieldCheck,
  ShoppingCart, Sparkles, Star, Target, TrendingUp, Truck, Upload, User, UserCheck, UserMinus, UserPlus,
  Users, Video, Wallet, Wrench, X, Zap,
} from "lucide-react";
import {
  ROLE_GUIDES, ROLE_GUIDE_GROUPS, getRoleGuideMeta, guidesForRoles, loadAllRoleGuides,
  loadRoleGuide, searchGuides,
  type GuideActivity, type GuideIconKey, type GuideModule, type GuideTone, type RoleGuide, type GuideSearchHit,
} from "@/data/hrmsGuide";

// ─── Icon & colour maps (data files reference these by key) ──────────────────

const ICONS: Record<GuideIconKey, typeof BookOpen> = {
  book: BookOpen, users: Users, user: User, userPlus: UserPlus, userMinus: UserMinus, userCheck: UserCheck,
  dollar: DollarSign, rupee: IndianRupee, calendar: Calendar, calendarDays: CalendarDays, clock: Clock,
  chart: BarChart3, trending: TrendingUp, settings: Settings, shield: ShieldCheck, shieldAlert: ShieldAlert,
  briefcase: Briefcase, target: Target, graduation: GraduationCap, clipboard: ClipboardList, fileText: FileText,
  fileCheck: FileCheck, creditCard: CreditCard, building: Building2, package: Package, zap: Zap, bell: Bell,
  inbox: Inbox, message: MessageSquare, mail: Mail, phone: Phone, headset: Headset, heart: Heart,
  sparkles: Sparkles, lock: Lock, key: Key, "log-in": LogIn, layout: LayoutDashboard, activity: Activity,
  receipt: Receipt, wallet: Wallet, landmark: Landmark, upload: Upload, download: Download, search: Search,
  network: Network, server: Server, laptop: Laptop, truck: Truck, shoppingCart: ShoppingCart, gauge: Gauge,
  award: Award, help: HelpCircle, eye: Eye, video: Video, map: Map, gitBranch: GitBranch, rotate: RotateCcw,
  alert: AlertTriangle, check: CheckCircle2, star: Star, coffee: Coffee,
};

// Full class strings so Tailwind keeps them.
const TONES: Record<GuideTone, { text: string; soft: string; ring: string; header: string }> = {
  indigo:  { text: "text-indigo-600",  soft: "bg-indigo-50",  ring: "border-indigo-200",  header: "from-indigo-50 to-violet-50" },
  sky:     { text: "text-sky-600",     soft: "bg-sky-50",     ring: "border-sky-200",     header: "from-sky-50 to-cyan-50" },
  emerald: { text: "text-emerald-600", soft: "bg-emerald-50", ring: "border-emerald-200", header: "from-emerald-50 to-green-50" },
  amber:   { text: "text-amber-600",   soft: "bg-amber-50",   ring: "border-amber-200",   header: "from-amber-50 to-orange-50" },
  rose:    { text: "text-rose-600",    soft: "bg-rose-50",    ring: "border-rose-200",    header: "from-rose-50 to-pink-50" },
  violet:  { text: "text-violet-600",  soft: "bg-violet-50",  ring: "border-violet-200",  header: "from-violet-50 to-purple-50" },
  teal:    { text: "text-teal-600",    soft: "bg-teal-50",    ring: "border-teal-200",    header: "from-teal-50 to-emerald-50" },
  orange:  { text: "text-orange-600",  soft: "bg-orange-50",  ring: "border-orange-200",  header: "from-orange-50 to-amber-50" },
  slate:   { text: "text-slate-600",   soft: "bg-slate-100",  ring: "border-slate-200",   header: "from-slate-50 to-gray-100" },
  pink:    { text: "text-pink-600",    soft: "bg-pink-50",    ring: "border-pink-200",    header: "from-pink-50 to-rose-50" },
  cyan:    { text: "text-cyan-600",    soft: "bg-cyan-50",    ring: "border-cyan-200",    header: "from-cyan-50 to-sky-50" },
  lime:    { text: "text-lime-700",    soft: "bg-lime-50",    ring: "border-lime-200",    header: "from-lime-50 to-green-50" },
  blue:    { text: "text-blue-600",    soft: "bg-blue-50",    ring: "border-blue-200",    header: "from-blue-50 to-indigo-50" },
  red:     { text: "text-red-600",     soft: "bg-red-50",     ring: "border-red-200",     header: "from-red-50 to-rose-50" },
  purple:  { text: "text-purple-600",  soft: "bg-purple-50",  ring: "border-purple-200",  header: "from-purple-50 to-fuchsia-50" },
  green:   { text: "text-green-600",   soft: "bg-green-50",   ring: "border-green-200",   header: "from-green-50 to-emerald-50" },
};

const FREQUENCY_LABEL: Record<string, string> = {
  daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly", "as-needed": "As needed", "one-time": "One-time",
};

function ModuleIcon({ icon, className }: { icon: GuideIconKey; className?: string }) {
  const I = ICONS[icon] ?? BookOpen;
  return <I className={className ?? "h-4 w-4"} aria-hidden="true" />;
}

// ─── Section model: a role's modules plus the shared staff sections ──────────

type Section = { id: string; title: string; guideKey: string; modules: GuideModule[] };

const modKey = (guideKey: string, moduleId: string) => `${guideKey}:${moduleId}`;

function buildSections(primary: RoleGuide, everyone?: RoleGuide, employee?: RoleGuide): Section[] {
  const meta = getRoleGuideMeta(primary.key);
  const sections: Section[] = [{ id: primary.key, title: `${primary.roleLabel}`, guideKey: primary.key, modules: primary.modules }];
  if (meta?.audience === "staff") {
    if (employee && primary.key !== "employee" && primary.key !== "everyone") {
      sections.push({ id: "employee", title: "My self-service (every employee)", guideKey: "employee", modules: employee.modules });
    }
    if (everyone && primary.key !== "everyone") {
      sections.push({ id: "everyone", title: "Getting started & help (everyone)", guideKey: "everyone", modules: everyone.modules });
    }
  }
  return sections;
}

function buildActivityLink(roleKey: string, guideKey: string, moduleId: string, activityId: string) {
  const p = new URLSearchParams({ role: roleKey, module: modKey(guideKey, moduleId), activity: activityId });
  return `${window.location.origin}/guide?${p.toString()}`;
}

// ─── Activity card ───────────────────────────────────────────────────────────

function Block({ tone, icon, title, children }: { tone: "blue" | "purple" | "amber" | "emerald" | "slate"; icon: ReactNode; title: string; children: ReactNode }) {
  const map = {
    blue: "bg-blue-50 border-blue-200 text-blue-900 [&_.ttl]:text-blue-700",
    purple: "bg-purple-50 border-purple-200 text-purple-900 [&_.ttl]:text-purple-700",
    amber: "bg-amber-50 border-amber-200 text-amber-900 [&_.ttl]:text-amber-700",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-900 [&_.ttl]:text-emerald-700",
    slate: "bg-slate-50 border-slate-200 text-slate-800 [&_.ttl]:text-slate-600",
  } as const;
  return (
    <div className={cn("rounded-xl border p-4", map[tone])}>
      <div className="flex items-center gap-2 mb-1.5">
        {icon}
        <p className="ttl text-xs font-bold uppercase tracking-wide">{title}</p>
      </div>
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}

function ActivityCard({
  activity, roleKey, guideKey, moduleId, open, onToggle, highlight,
}: {
  activity: GuideActivity; roleKey: string; guideKey: string; moduleId: string;
  open: boolean; onToggle: () => void; highlight?: boolean;
}) {
  const [openQa, setOpenQa] = useState<number | null>(null);
  const bodyId = `guide-act-${guideKey}-${moduleId}-${activity.id}`;
  const isExternalPath = activity.path ? /^(\/portal|\/candidate-portal|\/interview-registration|\/visitor-|\/display\/)/.test(activity.path) : false;

  const copyLink = async () => {
    const url = buildActivityLink(roleKey, guideKey, moduleId, activity.id);
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", description: "Share it so others land on this exact activity." });
    } catch {
      toast({ title: "Copy failed", description: url });
    }
  };

  return (
    <div
      id={`act-${guideKey}-${moduleId}-${activity.id}`}
      className={cn(
        "rounded-xl border bg-white overflow-hidden transition-colors scroll-mt-24",
        highlight ? "border-indigo-400 ring-2 ring-indigo-200" : "border-slate-200 hover:border-slate-300",
      )}
    >
      <button
        type="button"
        className="w-full flex items-start gap-3 px-5 py-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={bodyId}
      >
        <span className="flex-shrink-0 mt-0.5 w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center">
          {open ? <ChevronDown className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-slate-800">{activity.title}</span>
          <span className="block text-xs text-slate-500 mt-0.5 leading-relaxed">{activity.description}</span>
          <span className="mt-2 flex flex-wrap gap-1.5">
            {activity.frequency && (
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                <Clock className="h-3 w-3" aria-hidden="true" />{FREQUENCY_LABEL[activity.frequency] ?? activity.frequency}
              </span>
            )}
            {activity.menuPath && (
              <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 max-w-full">
                <Route className="h-3 w-3 flex-shrink-0" aria-hidden="true" /><span className="truncate">{activity.menuPath}</span>
              </span>
            )}
            {activity.steps.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                <ListChecks className="h-3 w-3" aria-hidden="true" />{activity.steps.length} steps
              </span>
            )}
          </span>
        </span>
      </button>

      {open && (
        <div id={bodyId} className="px-5 pb-5 border-t border-slate-100 space-y-4">
          {activity.prerequisites && activity.prerequisites.length > 0 && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2 flex items-center gap-1.5">
                <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />Before you start
              </p>
              <ul className="space-y-1.5">
                {activity.prerequisites.map((p, i) => (
                  <li key={i} className="flex gap-2 text-sm text-slate-700">
                    <Check className="h-4 w-4 text-emerald-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className={activity.prerequisites?.length ? "" : "mt-4"}>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">Steps</p>
            <ol className="space-y-2.5">
              {activity.steps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center mt-0.5" aria-hidden="true">{i + 1}</span>
                  <div>
                    <p className="text-sm text-slate-700 font-medium">{s.action}</p>
                    {s.detail && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{s.detail}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {activity.screenGuide && (
            <Block tone="purple" icon={<Eye className="h-3.5 w-3.5 text-purple-600" aria-hidden="true" />} title="What you'll see on screen">
              {activity.screenGuide}
            </Block>
          )}

          <Block tone="blue" icon={<Lightbulb className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />} title="Example">
            {activity.example}
          </Block>

          {activity.tip && (
            <Block tone="amber" icon={<AlertCircle className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />} title="Tip">
              {activity.tip}
            </Block>
          )}

          {activity.afterThis && (
            <Block tone="emerald" icon={<ArrowRight className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />} title="What happens next">
              {activity.afterThis}
            </Block>
          )}

          {activity.troubleshooting && activity.troubleshooting.length > 0 && (
            <div className="rounded-xl border border-rose-200 overflow-hidden">
              <p className="px-4 py-2.5 bg-rose-50 text-xs font-bold uppercase tracking-wide text-rose-700 flex items-center gap-1.5">
                <Wrench className="h-3.5 w-3.5" aria-hidden="true" />If something goes wrong
              </p>
              <ul className="divide-y divide-rose-100">
                {activity.troubleshooting.map((t, i) => {
                  const isOpen = openQa === i;
                  return (
                    <li key={i}>
                      <button
                        type="button"
                        className="w-full flex items-start gap-2 px-4 py-2.5 text-left text-sm text-slate-800 hover:bg-rose-50/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                        onClick={() => setOpenQa(isOpen ? null : i)}
                        aria-expanded={isOpen}
                      >
                        {isOpen ? <ChevronDown className="h-4 w-4 text-rose-500 flex-shrink-0 mt-0.5" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 text-rose-500 flex-shrink-0 mt-0.5" aria-hidden="true" />}
                        <span className="font-medium">{t.q}</span>
                      </button>
                      {isOpen && <p className="px-10 pb-3 text-sm text-slate-600 leading-relaxed">{t.a}</p>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {activity.path && !isExternalPath && (
              <Link
                to={activity.path}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-3 py-2 transition-colors"
              >
                <ArrowRight className="h-3 w-3" aria-hidden="true" />Open this page
              </Link>
            )}
            {activity.path && isExternalPath && (
              <a
                href={activity.path}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-3 py-2 transition-colors"
              >
                <ArrowRight className="h-3 w-3" aria-hidden="true" />Open page in a new tab
              </a>
            )}
            <button
              type="button"
              onClick={copyLink}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 transition-colors"
            >
              <Link2 className="h-3 w-3" aria-hidden="true" />Copy link to this activity
            </button>
            {activity.tags && activity.tags.length > 0 && (
              <span className="ml-auto flex flex-wrap gap-1">
                {activity.tags.slice(0, 6).map((t) => (
                  <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">#{t}</span>
                ))}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Role picker ─────────────────────────────────────────────────────────────

function RolePicker({ value, onChange, mine }: { value: string; onChange: (k: string) => void; mine: string[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Choose a role guide"
      className="h-10 px-3 rounded-xl border-2 border-white/30 bg-white/10 text-white focus:border-white/60 focus:outline-none focus:bg-white/20 transition-all min-w-[260px] text-sm"
    >
      <option value="" className="text-slate-800 bg-white">— Choose a role —</option>
      {mine.length > 0 && (
        <optgroup label="Your roles" className="text-slate-800 bg-white">
          {mine.map((k) => <option key={`mine-${k}`} value={k} className="text-slate-800 bg-white">{getRoleGuideMeta(k)?.roleLabel}</option>)}
        </optgroup>
      )}
      {ROLE_GUIDE_GROUPS.map((grp) => (
        <optgroup key={grp} label={grp} className="text-slate-800 bg-white">
          {ROLE_GUIDES.filter((g) => g.group === grp).map((g) => (
            <option key={g.key} value={g.key} className="text-slate-800 bg-white">{g.roleLabel}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function NativeHrmsGuide() {
  const [params, setParams] = useSearchParams();
  const { data: roleData, isLoading: rolesLoading } = useUserRole();

  const myGuides = useMemo(() => guidesForRoles(roleData?.roleKeys ?? roleData?.roles ?? []), [roleData]);
  const myGuideKeys = useMemo(() => myGuides.map((g) => g.key), [myGuides]);

  const urlRole = params.get("role") ?? "";
  const urlModule = params.get("module");
  const urlActivity = params.get("activity");

  const [roleKey, setRoleKey] = useState<string>(getRoleGuideMeta(urlRole) ? urlRole : "");
  const [autoPicked, setAutoPicked] = useState(false);
  const [guides, setGuides] = useState<Record<string, RoleGuide>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [selectedModule, setSelectedModule] = useState<string | null>(urlModule);
  const [openActs, setOpenActs] = useState<Set<string>>(() => new Set(urlActivity && urlModule ? [`${urlModule}/${urlActivity}`] : []));
  const [highlightAct, setHighlightAct] = useState<string | null>(urlActivity && urlModule ? `${urlModule}/${urlActivity}` : null);
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [searchAll, setSearchAll] = useState(false);
  const [allGuides, setAllGuides] = useState<RoleGuide[] | null>(null);
  const [showRoutine, setShowRoutine] = useState(true);
  const scrolledRef = useRef(false);

  // Auto-select the user's own guide once their roles are known.
  useEffect(() => {
    if (roleKey || rolesLoading) return;
    if (myGuideKeys.length > 0) {
      setRoleKey(myGuideKeys[0]);
      setAutoPicked(true);
    }
  }, [roleKey, rolesLoading, myGuideKeys]);

  // Load the selected guide plus the shared sections.
  useEffect(() => {
    if (!roleKey) return;
    let cancelled = false;
    setLoadError(null);
    const keys = [roleKey];
    if (getRoleGuideMeta(roleKey)?.audience === "staff") keys.push("employee", "everyone");
    Promise.all(keys.map((k) => loadRoleGuide(k).then((g) => [k, g] as const)))
      .then((pairs) => {
        if (cancelled) return;
        setGuides((prev) => {
          const next = { ...prev };
          for (const [k, g] of pairs) next[k] = g;
          return next;
        });
      })
      .catch(() => { if (!cancelled) setLoadError("The guide could not be loaded. Check your connection and try again."); });
    return () => { cancelled = true; };
  }, [roleKey, reloadNonce]);

  // Load every guide when the user searches across all roles.
  useEffect(() => {
    if (!searchAll || allGuides) return;
    loadAllRoleGuides().then(setAllGuides).catch(() => setLoadError("Could not load all guides for searching."));
  }, [searchAll, allGuides]);

  const primary = roleKey ? guides[roleKey] : undefined;
  const sections = useMemo(
    () => (primary ? buildSections(primary, guides.everyone, guides.employee) : []),
    [primary, guides.everyone, guides.employee],
  );

  const allModules = useMemo(
    () => sections.flatMap((s) => s.modules.map((m) => ({ key: modKey(s.guideKey, m.id), guideKey: s.guideKey, module: m }))),
    [sections],
  );
  const activeModule = allModules.find((m) => m.key === selectedModule) ?? allModules[0] ?? null;

  // Keep the URL in step so the current view can be shared or bookmarked.
  useEffect(() => {
    const next = new URLSearchParams();
    if (roleKey) next.set("role", roleKey);
    if (activeModule && selectedModule) next.set("module", activeModule.key);
    if (highlightAct && highlightAct.startsWith(`${activeModule?.key}/`)) next.set("activity", highlightAct.split("/").pop()!);
    if (params.toString() !== next.toString()) setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleKey, activeModule?.key, selectedModule, highlightAct]);

  // Scroll to a deep-linked activity once it is rendered.
  useEffect(() => {
    if (scrolledRef.current || !highlightAct || !activeModule) return;
    const [mk, actId] = [highlightAct.slice(0, highlightAct.lastIndexOf("/")), highlightAct.slice(highlightAct.lastIndexOf("/") + 1)];
    if (mk !== activeModule.key) return;
    const el = document.getElementById(`act-${activeModule.guideKey}-${activeModule.module.id}-${actId}`);
    if (el) {
      scrolledRef.current = true;
      requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }, [highlightAct, activeModule]);

  const changeRole = (k: string) => {
    setRoleKey(k);
    setAutoPicked(false);
    setSelectedModule(null);
    setOpenActs(new Set());
    setHighlightAct(null);
    setQuery("");
    window.scrollTo({ top: 0 });
  };

  const toggleAct = useCallback((key: string) => {
    setOpenActs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const openModule = (key: string) => {
    setSelectedModule(key);
    setHighlightAct(null);
    setQuery("");
    document.getElementById("guide-content")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const goToHit = (hit: GuideSearchHit, guideKey: string) => {
    const mk = modKey(guideKey, hit.module.id);
    const actKey = `${mk}/${hit.activity.id}`;
    // A hit outside the current guide switches guide (keeping shared sections where they belong).
    const inCurrent = sections.some((s) => s.guideKey === guideKey);
    if (!inCurrent) {
      setRoleKey(hit.roleKey);
      setAutoPicked(false);
    }
    setSelectedModule(mk);
    setOpenActs(new Set([actKey]));
    setHighlightAct(actKey);
    setQuery("");
    setSearchAll(false);
    scrolledRef.current = false;
  };

  // Search
  const searchPool = useMemo(() => {
    if (searchAll) return allGuides ?? [];
    return sections.map((s) => guides[s.guideKey]).filter(Boolean) as RoleGuide[];
  }, [searchAll, allGuides, sections, guides]);
  const hits = useMemo(() => (query.trim().length >= 2 ? searchGuides(searchPool, query) : []), [searchPool, query]);
  const searching = query.trim().length >= 2;

  const totalActs = sections.reduce((n, s) => n + s.modules.reduce((k, m) => k + m.activities.length, 0), 0);
  const allExpanded = activeModule ? activeModule.module.activities.every((a) => openActs.has(`${activeModule.key}/${a.id}`)) : false;

  const setModuleExpanded = (expand: boolean) => {
    if (!activeModule) return;
    setOpenActs((prev) => {
      const next = new Set(prev);
      for (const a of activeModule.module.activities) {
        const k = `${activeModule.key}/${a.id}`;
        if (expand) next.add(k); else next.delete(k);
      }
      return next;
    });
  };

  const meta = getRoleGuideMeta(roleKey);

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/30 to-purple-50/20">

        {/* ── Header ── */}
        <div className="relative overflow-hidden bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 px-4 sm:px-6 pt-8 pb-8">
          <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: "radial-gradient(circle at 30% 20%, white, transparent 50%)" }} />
          <div className="relative max-w-6xl mx-auto">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                <BookOpen className="h-5 w-5 text-white" aria-hidden="true" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">HRMS Guide</h1>
                <p className="text-indigo-100 text-sm">Step-by-step help for every task in HRMS, written for your role</p>
              </div>
            </div>

            <div className="mt-5 flex flex-col lg:flex-row gap-3 lg:items-center">
              <label className="text-white/85 text-sm font-medium whitespace-nowrap" htmlFor="guide-role">Guide for:</label>
              <div id="guide-role"><RolePicker value={roleKey} onChange={changeRole} mine={myGuideKeys} /></div>
              {primary && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/20 border border-white/30">
                  <Star className="h-3.5 w-3.5 text-yellow-300" aria-hidden="true" />
                  <span className="text-white text-xs font-medium">{allModules.length} modules · {totalActs} activities</span>
                </div>
              )}
              {autoPicked && meta && (
                <span className="text-xs text-white/85">Opened automatically from your login role.</span>
              )}
            </div>

            {myGuideKeys.length > 1 && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-white/80">Your roles:</span>
                {myGuideKeys.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => changeRole(k)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium border transition-colors",
                      k === roleKey ? "bg-white text-indigo-700 border-white" : "bg-white/10 text-white border-white/30 hover:bg-white/20",
                    )}
                  >
                    {getRoleGuideMeta(k)?.roleLabel}
                  </button>
                ))}
              </div>
            )}

            {/* Search */}
            <div className="mt-5 relative max-w-3xl">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                placeholder={roleKey ? "What do you want to do? e.g. apply leave, download payslip, approve GRN…" : "Search every guide… e.g. reset password, Form 16, roster upload"}
                value={query}
                onChange={(e) => { setQuery(e.target.value); if (!roleKey) setSearchAll(true); }}
                aria-label="Search the guide"
                className="w-full h-11 pl-9 pr-10 rounded-xl border-2 border-white/40 bg-white text-sm text-slate-700 placeholder-slate-400 focus:border-white focus:outline-none shadow-sm"
              />
              {query && (
                <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {roleKey && (
              <label className="mt-2 inline-flex items-center gap-2 text-xs text-white/90 cursor-pointer select-none">
                <input type="checkbox" checked={searchAll} onChange={(e) => setSearchAll(e.target.checked)} className="rounded border-white/50" />
                Search all roles' guides, not just this one
              </label>
            )}
          </div>
        </div>

        {loadError && (
          <div className="max-w-6xl mx-auto px-4 sm:px-6 mt-4">
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex items-center gap-3">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
              <span className="flex-1">{loadError}</span>
              <button type="button" onClick={() => { setLoadError(null); setAllGuides(null); setReloadNonce((n) => n + 1); }} className="text-xs font-semibold underline">Retry</button>
            </div>
          </div>
        )}

        {/* ── Search results ── */}
        {searching && (
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-slate-700">
                {searchAll && !allGuides ? "Loading every guide…" : `${hits.length}${hits.length === 60 ? "+" : ""} result${hits.length === 1 ? "" : "s"} for "${query.trim()}"`}
                {!searchAll && primary && <span className="font-normal text-slate-500"> in {primary.roleLabel} and shared sections</span>}
              </p>
              {searchAll && !allGuides && <Loader2 className="h-4 w-4 animate-spin text-indigo-500" aria-hidden="true" />}
            </div>
            <div className="space-y-2">
              {hits.map((h) => {
                // A hit from Employee/Everyone while viewing a staff role stays in its shared section.
                const sectionForHit = sections.find((s) => s.guideKey === h.roleKey);
                const guideKey = sectionForHit ? sectionForHit.guideKey : h.roleKey;
                return (
                  <button
                    key={`${h.roleKey}-${h.module.id}-${h.activity.id}`}
                    type="button"
                    onClick={() => goToHit(h, guideKey)}
                    className="w-full text-left rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  >
                    <div className="flex items-start gap-3">
                      <span className={cn("mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0", TONES[h.module.tone]?.soft, TONES[h.module.tone]?.text)}>
                        <ModuleIcon icon={h.module.icon} />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-slate-800">{h.activity.title}</span>
                        <span className="block text-xs text-slate-500 mt-0.5">{h.activity.description}</span>
                        <span className="mt-1.5 block text-[11px] text-slate-400">
                          {h.roleLabel} → {h.module.title}{h.activity.menuPath ? ` · ${h.activity.menuPath}` : ""}
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0 mt-1" aria-hidden="true" />
                    </div>
                  </button>
                );
              })}
              {hits.length === 0 && !(searchAll && !allGuides) && (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
                  <p className="text-sm text-slate-600">No activity matches "{query.trim()}".</p>
                  <p className="text-xs text-slate-500 mt-1">Try fewer or different words (for example "payslip" instead of "salary slip").</p>
                  {!searchAll && roleKey && (
                    <button type="button" onClick={() => setSearchAll(true)} className="mt-3 text-xs font-semibold text-indigo-600 hover:text-indigo-700">
                      Search all roles' guides instead
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── No role selected ── */}
        {!roleKey && !searching && (
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
            {rolesLoading ? (
              <div className="flex items-center justify-center gap-2 text-sm text-slate-500 py-10">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Finding the guide for your role…
              </div>
            ) : (
              <>
                <div className="text-center mb-8">
                  <h2 className="text-xl font-bold text-slate-700 mb-2">Pick the guide for your role</h2>
                  <p className="text-slate-500 max-w-xl mx-auto text-sm">
                    Each guide lists every task you can do in HRMS, with the exact menu path, steps, screenshots-in-words, worked examples and fixes for common problems.
                  </p>
                </div>
                <div className="space-y-6">
                  {ROLE_GUIDE_GROUPS.map((grp) => (
                    <div key={grp}>
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">{grp}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {ROLE_GUIDES.filter((g) => g.group === grp).map((g) => (
                          <button
                            key={g.key}
                            type="button"
                            onClick={() => changeRole(g.key)}
                            className="px-4 py-3 rounded-xl border border-slate-200 bg-white text-left hover:bg-indigo-50 hover:border-indigo-300 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                          >
                            <span className="block text-sm font-semibold text-slate-700">{g.roleLabel}</span>
                            <span className="block text-xs text-slate-500 mt-0.5">{g.blurb}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Guide content ── */}
        {roleKey && !searching && (
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
            {!primary && !loadError && (
              <div className="flex items-center justify-center gap-2 text-sm text-slate-500 py-16">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading the {meta?.roleLabel ?? ""} guide…
              </div>
            )}

            {primary && (
              <>
                {/* Role description + routine */}
                <div className="mb-5 rounded-xl bg-white border border-slate-200">
                  <div className="p-4 flex items-start gap-3">
                    <Info className="h-4 w-4 text-indigo-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-slate-700">{primary.roleLabel} — what you do in HRMS</p>
                      <p className="text-sm text-slate-500 mt-0.5 leading-relaxed">{primary.description}</p>
                    </div>
                    {primary.routine && primary.routine.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowRoutine((v) => !v)}
                        aria-expanded={showRoutine}
                        className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 whitespace-nowrap"
                      >
                        {showRoutine ? "Hide checklist" : "Show checklist"}
                      </button>
                    )}
                  </div>
                  {showRoutine && primary.routine && primary.routine.length > 0 && (
                    <div className="border-t border-slate-100 p-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      {primary.routine.map((r) => (
                        <div key={r.when}>
                          <p className="text-xs font-bold uppercase tracking-wide text-indigo-600 mb-2 flex items-center gap-1.5">
                            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />{r.when}
                          </p>
                          <ul className="space-y-1.5">
                            {r.items.map((it, i) => (
                              <li key={i} className="flex gap-2 text-xs text-slate-600 leading-relaxed">
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
                                <span>{it}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Mobile module picker */}
                <div className="md:hidden mb-4">
                  <label htmlFor="guide-module-mobile" className="sr-only">Choose a module</label>
                  <select
                    id="guide-module-mobile"
                    value={activeModule?.key ?? ""}
                    onChange={(e) => openModule(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border-2 border-slate-200 bg-white text-sm text-slate-700"
                  >
                    {sections.map((s) => (
                      <optgroup key={s.id} label={s.title}>
                        {s.modules.map((m) => (
                          <option key={modKey(s.guideKey, m.id)} value={modKey(s.guideKey, m.id)}>
                            {m.title} ({m.activities.length})
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                <div className="flex gap-5">
                  {/* Left: module list */}
                  <nav className="hidden md:block w-64 flex-shrink-0" aria-label="Guide modules">
                    <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto pr-1 space-y-5">
                      {sections.map((s) => (
                        <div key={s.id}>
                          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2 px-1">{s.title}</p>
                          <div className="space-y-1">
                            {s.modules.map((m) => {
                              const k = modKey(s.guideKey, m.id);
                              const isActive = k === activeModule?.key;
                              const tone = TONES[m.tone] ?? TONES.indigo;
                              return (
                                <button
                                  key={k}
                                  type="button"
                                  onClick={() => openModule(k)}
                                  aria-current={isActive ? "page" : undefined}
                                  className={cn(
                                    "w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-all border-2",
                                    isActive ? "bg-white border-indigo-200 shadow-sm" : "border-transparent hover:bg-white/70",
                                  )}
                                >
                                  <span className={cn("w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0", tone.soft, tone.text)}>
                                    <ModuleIcon icon={m.icon} />
                                  </span>
                                  <span className="min-w-0">
                                    <span className={cn("block text-xs font-semibold leading-tight", isActive ? "text-indigo-700" : "text-slate-700")}>{m.title}</span>
                                    <span className="block text-[10px] text-slate-400 mt-0.5">{m.activities.length} activit{m.activities.length === 1 ? "y" : "ies"}</span>
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </nav>

                  {/* Right: activities */}
                  <div id="guide-content" className="flex-1 min-w-0 scroll-mt-4">
                    {activeModule && (
                      <>
                        <div className={cn("rounded-2xl bg-gradient-to-r border p-5 mb-4", (TONES[activeModule.module.tone] ?? TONES.indigo).header, (TONES[activeModule.module.tone] ?? TONES.indigo).ring)}>
                          <div className="flex items-center gap-3">
                            <span className={cn("w-10 h-10 rounded-xl flex items-center justify-center bg-white/70", (TONES[activeModule.module.tone] ?? TONES.indigo).text)}>
                              <ModuleIcon icon={activeModule.module.icon} className="h-5 w-5" />
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                {sections.find((s) => s.guideKey === activeModule.guideKey)?.title}
                              </p>
                              <h2 className="text-base font-bold text-slate-800">{activeModule.module.title}</h2>
                              <p className="text-xs text-slate-500">
                                {activeModule.module.summary ? `${activeModule.module.summary} · ` : ""}
                                {activeModule.module.activities.length} activities
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setModuleExpanded(!allExpanded)}
                              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 bg-white/70 border border-white rounded-lg px-3 py-1.5 whitespace-nowrap"
                            >
                              {allExpanded ? "Collapse all" : "Expand all"}
                            </button>
                          </div>
                        </div>

                        <div className="space-y-3">
                          {activeModule.module.activities.map((a) => {
                            const k = `${activeModule.key}/${a.id}`;
                            return (
                              <ActivityCard
                                key={k}
                                activity={a}
                                roleKey={roleKey}
                                guideKey={activeModule.guideKey}
                                moduleId={activeModule.module.id}
                                open={openActs.has(k)}
                                onToggle={() => { toggleAct(k); setHighlightAct(k); scrolledRef.current = true; }}
                                highlight={highlightAct === k}
                              />
                            );
                          })}
                        </div>
                      </>
                    )}

                    {/* Still stuck */}
                    <div className="mt-8 rounded-xl border border-slate-200 bg-white p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                      <HelpCircle className="h-6 w-6 text-indigo-500 flex-shrink-0" aria-hidden="true" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-slate-700">Still stuck?</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Search above with different words, or check "Troubleshooting & FAQ" under Getting started. If the screen does not match this guide, report it so the guide can be corrected.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Link to="/helpdesk" className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg px-3 py-2">
                          <Headset className="h-3.5 w-3.5" aria-hidden="true" />Raise a Helpdesk ticket
                        </Link>
                        <Link to="/uat/feedback" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                          <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />Report a problem
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
