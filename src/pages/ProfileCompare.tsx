import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  User, Mail, Phone, MapPin, Building2, Calendar,
  Briefcase, Clock, Wallet, Files, Package, Star,
  Users, Cake, Edit3, GitBranch, Landmark,
  HeartHandshake, ShieldCheck, Sparkles, TrendingUp, Award, CheckCircle2,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Mock employee data
const mockEmployee = {
  first_name: "Rahul",
  last_name: "Sharma",
  designation: "Senior Operations Manager",
  status: "active",
  employee_code: "MCN-2024-0847",
  department: { name: "Operations" },
  date_of_joining: "2022-03-15",
  date_of_birth: "1992-08-24",
  official_email: "rahul.sharma@teammas.in",
  mobile: "+91 98765 43210",
  city: "Mumbai",
  reporting_manager_name: "Priya Kapoor",
  gender: "Male",
  marital_status: "Married",
  blood_group: "B+",
};

// ════════════════════════════════════════════════════════════════════════════
// VERSION 1: EXISTING DESIGN (Before)
// ════════════════════════════════════════════════════════════════════════════

function V1InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100">
        <Icon className="h-4 w-4 text-slate-700" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
        <p className="mt-1 break-words text-base font-extrabold leading-6 text-slate-950 uppercase">{value}</p>
      </div>
    </div>
  );
}

function V1SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <span className="h-px flex-1 bg-slate-100" />
      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{children}</span>
      <span className="h-px flex-1 bg-slate-100" />
    </div>
  );
}

function V1Profile() {
  return (
    <div className="space-y-4">
      {/* Hero Banner - Old Style */}
      <div className="relative overflow-hidden rounded-3xl bg-[#073f78] px-5 py-6 text-white shadow-lg">
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-[#1B6AB5]/20 blur-3xl" />

        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center">
          {/* Avatar */}
          <div className="shrink-0">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/20 text-2xl font-black text-white border-2 border-white/30">
              RS
            </div>
          </div>

          {/* Identity */}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-green-200">Employee Profile</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight">
              {mockEmployee.first_name} {mockEmployee.last_name}
            </h1>
            <p className="mt-1 text-sm font-bold text-blue-100">{mockEmployee.designation}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge className="rounded-full px-3 py-0.5 text-xs font-bold bg-emerald-500/20 text-emerald-300 border-emerald-500/30">
                Active
              </Badge>
              <Badge className="rounded-full bg-white/10 px-3 py-0.5 text-xs font-bold text-white border-white/20">
                {mockEmployee.employee_code}
              </Badge>
            </div>
          </div>

          {/* Quick stats */}
          <div className="grid shrink-0 grid-cols-2 gap-2 lg:w-[280px]">
            {[
              { label: "Joined", value: "Mar 15, 2022" },
              { label: "DOB", value: "Aug 24, 1992" },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl border border-white/20 bg-white/10 px-3 py-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-200">{label}</p>
                <p className="mt-0.5 truncate text-xs font-bold text-white">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs - Old Style */}
      <div className="overflow-x-auto">
        <div className="inline-flex h-auto gap-1 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
          {["Profile", "Statutory", "Leaves", "Attendance"].map((tab, i) => (
            <div
              key={tab}
              className={cn(
                "gap-2 rounded-xl px-3 py-2 text-xs font-extrabold",
                i === 0 ? "bg-[#e8f2fc] text-[#073f78]" : "text-slate-600"
              )}
            >
              {tab}
            </div>
          ))}
        </div>
      </div>

      {/* Content - Old Style */}
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* Left card */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <V1SectionTitle>Contact Info</V1SectionTitle>
          <div className="divide-y divide-slate-50">
            <V1InfoRow icon={Mail} label="Email" value={mockEmployee.official_email} />
            <V1InfoRow icon={Phone} label="Phone" value={mockEmployee.mobile} />
            <V1InfoRow icon={MapPin} label="City" value={mockEmployee.city} />
          </div>
        </div>

        {/* Right form */}
        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-sm font-black text-slate-950">Personal Information</h2>
              <p className="mt-0.5 text-xs text-slate-500">Update your details</p>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5 rounded-xl text-xs font-bold">
              <Edit3 className="h-3.5 w-3.5" /> Edit
            </Button>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wide">First Name</Label>
                <Input value={mockEmployee.first_name} disabled className="rounded-xl bg-slate-50" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Last Name</Label>
                <Input value={mockEmployee.last_name} disabled className="rounded-xl bg-slate-50" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// VERSION 2: ENHANCED DESIGN (After)
// ════════════════════════════════════════════════════════════════════════════

function GlassCard({ children, className, glow }: { children: React.ReactNode; className?: string; glow?: 'blue' | 'green' | 'purple' }) {
  const glowColors = {
    blue: 'before:bg-blue-500/20',
    green: 'before:bg-emerald-500/20',
    purple: 'before:bg-purple-500/20',
  };
  return (
    <div className={cn(
      "relative rounded-2xl border border-white/20 bg-white/80 backdrop-blur-xl shadow-lg overflow-hidden",
      "before:absolute before:inset-0 before:rounded-2xl before:opacity-0 before:blur-xl before:transition-opacity",
      "hover:before:opacity-100",
      glow && glowColors[glow],
      className
    )}>
      <div className="relative">{children}</div>
    </div>
  );
}

function StatTile({ icon: Icon, label, value, trend, color = 'blue' }: {
  icon: React.ElementType; label: string; value: string; trend?: number; color?: 'blue' | 'green' | 'purple' | 'amber'
}) {
  const colors = {
    blue: { bg: 'bg-blue-500/10', icon: 'text-blue-600', border: 'border-blue-200' },
    green: { bg: 'bg-emerald-500/10', icon: 'text-emerald-600', border: 'border-emerald-200' },
    purple: { bg: 'bg-purple-500/10', icon: 'text-purple-600', border: 'border-purple-200' },
    amber: { bg: 'bg-amber-500/10', icon: 'text-amber-600', border: 'border-amber-200' },
  };
  const c = colors[color];

  return (
    <div className={cn(
      "group relative rounded-xl border p-3 bg-white/60 backdrop-blur-sm transition-all duration-300",
      "hover:shadow-lg hover:scale-[1.02] hover:-translate-y-0.5",
      c.border
    )}>
      <div className="flex items-start justify-between">
        <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", c.bg)}>
          <Icon className={cn("h-4 w-4", c.icon)} />
        </div>
        {trend !== undefined && (
          <Badge variant="outline" className={cn(
            "text-[9px] font-bold",
            trend >= 0 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"
          )}>
            {trend >= 0 ? '+' : ''}{trend}%
          </Badge>
        )}
      </div>
      <p className="mt-2 text-xl font-black text-slate-900">{value}</p>
      <p className="mt-0.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
    </div>
  );
}

function V2InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="group flex items-start gap-3 py-2.5 px-2 -mx-2 rounded-xl transition-colors hover:bg-slate-50/50">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-slate-100 to-slate-50 border border-slate-200/50 shadow-sm group-hover:shadow-md transition-shadow">
        <Icon className="h-3.5 w-3.5 text-slate-600" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400">{label}</p>
        <p className="mt-0.5 break-words text-sm font-bold leading-5 text-slate-900">{value}</p>
      </div>
    </div>
  );
}

function V2SectionTitle({ children, icon: Icon }: { children: React.ReactNode; icon?: React.ElementType }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      {Icon && (
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-slate-800 to-slate-900">
          <Icon className="h-3 w-3 text-white" />
        </div>
      )}
      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-700">{children}</span>
      <span className="h-px flex-1 bg-gradient-to-r from-slate-200 to-transparent" />
    </div>
  );
}

function V2Profile() {
  return (
    <div className="space-y-4 relative">
      {/* Background gradient */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute top-0 left-1/4 w-[400px] h-[400px] bg-blue-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-[300px] h-[300px] bg-purple-500/5 rounded-full blur-3xl" />
      </div>

      {/* Hero Banner - Enhanced */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0a1628] via-[#0f2847] to-[#1a365d] p-1">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-blue-500/20 via-purple-500/20 to-emerald-500/20 blur-xl" />

        <div className="relative rounded-[calc(1rem-4px)] bg-gradient-to-br from-[#0a1628] via-[#0f2847] to-[#1a365d] px-5 py-6 text-white overflow-hidden">
          {/* Decorative elements */}
          <div className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full bg-blue-500/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-10 left-1/4 h-40 w-40 rounded-full bg-purple-500/10 blur-3xl" />

          {/* Grid pattern */}
          <div className="absolute inset-0 opacity-5" style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)',
            backgroundSize: '30px 30px'
          }} />

          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center">
            {/* Avatar with glow */}
            <div className="shrink-0 relative">
              <div className="absolute inset-0 rounded-full bg-gradient-to-r from-blue-500 to-purple-500 blur-xl opacity-50 scale-110" />
              <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-2xl font-black text-white border-2 border-white/30 shadow-xl">
                RS
              </div>
            </div>

            {/* Identity */}
            <div className="flex-1 min-w-0">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 mb-2">
                <Sparkles className="h-3 w-3 text-emerald-400" />
                <span className="text-[10px] font-bold text-emerald-300 uppercase tracking-wider">Employee Profile</span>
              </div>
              <h1 className="text-2xl font-black tracking-tight bg-gradient-to-r from-white via-blue-100 to-white bg-clip-text text-transparent">
                {mockEmployee.first_name} {mockEmployee.last_name}
              </h1>
              <p className="mt-1 text-sm font-semibold text-blue-200/80">{mockEmployee.designation}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge className="rounded-full px-3 py-0.5 text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  <CheckCircle2 className="h-2.5 w-2.5 mr-1" />
                  Active
                </Badge>
                <Badge className="rounded-full bg-white/10 px-3 py-0.5 text-xs font-bold text-white border border-white/20 font-mono">
                  {mockEmployee.employee_code}
                </Badge>
                <Badge className="rounded-full px-3 py-0.5 text-xs font-bold bg-blue-500/20 text-blue-200 border border-blue-400/30">
                  <Building2 className="h-2.5 w-2.5 mr-1" />
                  {mockEmployee.department.name}
                </Badge>
              </div>
            </div>

            {/* Quick stats - Bento style */}
            <div className="grid shrink-0 grid-cols-2 gap-2 lg:w-[260px]">
              {[
                { label: "Joined", value: "Mar 15, 2022", icon: Calendar, color: 'from-blue-500/20 to-blue-600/10' },
                { label: "Birthday", value: "Aug 24, 1992", icon: Cake, color: 'from-purple-500/20 to-purple-600/10' },
              ].map(({ label, value, icon: Icon, color }) => (
                <div key={label} className={cn(
                  "group relative rounded-xl border border-white/10 bg-gradient-to-br p-3 transition-all duration-300 hover:border-white/20 hover:scale-[1.02]",
                  color
                )}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Icon className="h-3 w-3 text-blue-300/70" />
                    <p className="text-[9px] font-bold uppercase tracking-widest text-blue-200/70">{label}</p>
                  </div>
                  <p className="truncate text-xs font-bold text-white">{value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-4 gap-3">
        <StatTile icon={Calendar} label="Days This Month" value="22" trend={5} color="blue" />
        <StatTile icon={Clock} label="Avg Login" value="9:15" color="green" />
        <StatTile icon={Award} label="Performance" value="4.2" trend={12} color="purple" />
        <StatTile icon={TrendingUp} label="Attendance" value="96%" trend={3} color="amber" />
      </div>

      {/* Tabs - Enhanced */}
      <GlassCard className="inline-flex p-1.5">
        <div className="flex h-auto gap-1 bg-transparent p-0">
          {[
            { label: "Profile", active: true },
            { label: "Statutory", active: false },
            { label: "Leaves", active: false },
            { label: "Attendance", active: false },
          ].map((tab) => (
            <div
              key={tab.label}
              className={cn(
                "gap-2 rounded-xl px-3 py-2 text-xs font-bold transition-all duration-200",
                tab.active
                  ? "bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-500/25"
                  : "text-slate-500 hover:text-slate-700 hover:bg-slate-100/50"
              )}
            >
              {tab.label}
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Content - Enhanced */}
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* Left card */}
        <GlassCard glow="blue" className="p-5">
          <V2SectionTitle icon={Mail}>Contact Info</V2SectionTitle>
          <div className="space-y-0.5">
            <V2InfoRow icon={Mail} label="Email" value={mockEmployee.official_email} />
            <V2InfoRow icon={Phone} label="Phone" value={mockEmployee.mobile} />
            <V2InfoRow icon={MapPin} label="City" value={mockEmployee.city} />
          </div>
        </GlassCard>

        {/* Right form */}
        <GlassCard className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 bg-gradient-to-r from-slate-50/80 to-transparent">
            <div>
              <h2 className="text-sm font-black text-slate-900">Personal Information</h2>
              <p className="mt-0.5 text-xs text-slate-500">Update your details</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 rounded-xl text-xs font-bold bg-white hover:bg-slate-50"
            >
              <Edit3 className="h-3.5 w-3.5" /> Edit Profile
            </Button>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">First Name</Label>
                <Input value={mockEmployee.first_name} disabled className="rounded-xl bg-slate-50/50 border-slate-200" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Last Name</Label>
                <Input value={mockEmployee.last_name} disabled className="rounded-xl bg-slate-50/50 border-slate-200" />
              </div>
            </div>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN COMPARISON PAGE
// ════════════════════════════════════════════════════════════════════════════

export default function ProfileCompare() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <div className="relative border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(59,130,246,0.15),transparent_60%)]" />
        <div className="relative max-w-7xl mx-auto px-6 py-8 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/20 border border-blue-500/30 mb-4">
            <Sparkles className="h-4 w-4 text-blue-400" />
            <span className="text-sm text-blue-300 font-medium">UI/UX Skill Demo</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-3">
            Profile Page: <span className="bg-gradient-to-r from-amber-400 to-blue-400 bg-clip-text text-transparent">Before vs After</span>
          </h1>
          <p className="text-base text-slate-400 max-w-2xl mx-auto">
            See how the ui-ux-pro-max skill transforms a standard HRMS profile page with glassmorphism,
            gradient accents, micro-interactions, and modern visual hierarchy.
          </p>
        </div>
      </div>

      {/* Comparison Grid */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          {/* V1 - Before */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-sm px-3 py-1">
                BEFORE
              </Badge>
              <span className="text-sm text-slate-400">Existing Design</span>
            </div>
            <div className="rounded-2xl bg-slate-100 p-4 border border-slate-200">
              <V1Profile />
            </div>
            <div className="p-4 bg-amber-500/10 rounded-xl border border-amber-500/20">
              <p className="text-xs text-amber-300 font-medium mb-2">Design Characteristics:</p>
              <ul className="text-[11px] text-amber-200/80 space-y-1 list-disc list-inside">
                <li>Flat solid colors</li>
                <li>Basic shadows</li>
                <li>Standard rounded corners</li>
                <li>No visual hierarchy indicators</li>
                <li>Static elements</li>
              </ul>
            </div>
          </div>

          {/* V2 - After */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Badge className="bg-emerald-500 text-white text-sm px-3 py-1">
                AFTER
              </Badge>
              <span className="text-sm text-slate-400">Enhanced with ui-ux-pro-max</span>
            </div>
            <div className="rounded-2xl bg-slate-100 p-4 border border-emerald-500/30 ring-1 ring-emerald-500/20">
              <V2Profile />
            </div>
            <div className="p-4 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
              <p className="text-xs text-emerald-300 font-medium mb-2">Design Improvements:</p>
              <ul className="text-[11px] text-emerald-200/80 space-y-1 list-disc list-inside">
                <li>Glassmorphism cards with backdrop blur</li>
                <li>Gradient accents and glow effects</li>
                <li>Grid pattern overlays</li>
                <li>Quick stats row with trends</li>
                <li>Hover micro-interactions</li>
                <li>Modern tab styling with shadows</li>
                <li>Section icons with gradient backgrounds</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Feature Comparison Table */}
        <div className="mt-12 rounded-2xl bg-slate-800/50 border border-white/10 overflow-hidden">
          <div className="p-5 border-b border-white/10">
            <h2 className="text-lg font-semibold text-white">Design System Comparison</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-slate-800/50">
                <th className="text-left p-4 text-slate-400 font-medium">Element</th>
                <th className="text-center p-4 text-amber-400 font-medium">Before</th>
                <th className="text-center p-4 text-emerald-400 font-medium">After</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {[
                ["Card style", "Solid white bg", "Glassmorphism with blur"],
                ["Hero banner", "Simple gradient", "Multi-layer with grid pattern"],
                ["Avatar", "Basic circle", "Glow effect + gradient ring"],
                ["Badges", "Flat colors", "Semi-transparent with borders"],
                ["Tabs", "Flat background", "Gradient active state + shadows"],
                ["Section headers", "Text dividers", "Icon badges + gradient lines"],
                ["Info rows", "Static", "Hover states with elevation"],
                ["Quick stats", "Not present", "4-tile KPI row with trends"],
                ["Typography", "Standard weights", "Variable weights with tracking"],
                ["Spacing", "Basic padding", "Responsive with visual rhythm"],
              ].map(([element, before, after]) => (
                <tr key={element} className="border-b border-white/5">
                  <td className="p-4">{element}</td>
                  <td className="p-4 text-center text-slate-400">{before}</td>
                  <td className="p-4 text-center text-emerald-400">{after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Back Link */}
        <div className="mt-8 text-center">
          <a href="/ux-skill-demo" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm transition-colors">
            View Full Dashboard Demo <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </div>
    </div>
  );
}
