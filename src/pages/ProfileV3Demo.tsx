/**
 * ProfileV3Demo - Public demo version with mock data
 * This is a temporary demo page to showcase the UI design without requiring authentication
 */
import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2, User, Mail, Phone, MapPin, Building2, Calendar,
  Briefcase, Save, Clock, Wallet, Files, Package, Star,
  Users, Cake, Edit3, X, GitBranch, Landmark, CheckCircle2,
  HeartHandshake, ShieldCheck, TrendingUp, AlertCircle, FileText, Key
} from "lucide-react";
import { cn } from "@/lib/utils";

// Mock employee data
const MOCK_EMPLOYEE = {
  id: "demo-123",
  first_name: "Shivam",
  last_name: "Shiv Giri",
  employee_code: "MAS47814",
  official_email: "shivam.giri@teammas.in",
  mobile: "9999746258",
  alternate_mobile: "9582602464",
  city: "Greater Noida",
  designation: "Manager",
  department: { name: "Training and Quality" },
  reporting_manager_name: "Vachher Manish Nareshkumar",
  date_of_joining: "2021-03-15",
  date_of_birth: "1991-02-02",
  status: "Active",
  gender: "Male",
  marital_status: "Married",
  blood_group: "B+",
  working_days: [1, 2, 3, 4, 5, 6],
};

const MOCK_LEAVE_BALANCES = [
  { id: 1, leave_code: "CL", leave_type: { name: "Casual Leave" }, allocated_days: 7, used_days: 4.5, available_days: 2.5, annual_entitlement: 7 },
  { id: 2, leave_code: "EL", leave_type: { name: "Earned Leave" }, allocated_days: 18, used_days: 14, available_days: 4, annual_entitlement: 18 },
  { id: 3, leave_code: "LWP", leave_type: { name: "Leave Without Pay" }, allocated_days: 0, used_days: 0, available_days: 0, annual_entitlement: 0 },
  { id: 4, leave_code: "ML", leave_type: { name: "Medical Leave" }, allocated_days: 5, used_days: 2, available_days: 3, annual_entitlement: 5 },
  { id: 5, leave_code: "MTRL", leave_type: { name: "Maternity Leave" }, allocated_days: 0, used_days: 0, available_days: 0, annual_entitlement: 0 },
  { id: 6, leave_code: "PTRL", leave_type: { name: "Paternity Leave" }, allocated_days: 4, used_days: 0, available_days: 4, annual_entitlement: 4 },
];

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

// ═══════════════════════════════════════════════════════════════════════════════
// DESIGN SYSTEM COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function Donut({ v, max, color, size = 56 }: { v: number; max: number; color: string; size?: number }) {
  const pct = max > 0 ? (v / max) * 100 : 0;
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="-rotate-90" width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e5e7eb" strokeWidth="5" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c} className="transition-all duration-700 drop-shadow-sm" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-black text-gray-800">{(max - v).toFixed(0)}</span>
      </div>
    </div>
  );
}

function GlassCard({ children, className, gradient }: { children: React.ReactNode; className?: string; gradient?: string }) {
  return (
    <div className={cn(
      "rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm transition-all duration-200 hover:shadow-md",
      gradient && `bg-gradient-to-br ${gradient}`,
      className
    )}>
      {children}
    </div>
  );
}

function InfoField({ icon: Icon, label, value, color = "#6366F1" }: { icon: React.ElementType; label: string; value: string | null | undefined; color?: string }) {
  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-xl bg-white/80 border border-gray-100 hover:border-gray-200 transition-all">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shadow-sm" style={{ backgroundColor: `${color}20` }}>
        <Icon className="h-4 w-4" style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{label}</p>
        <p className="text-sm font-bold text-gray-900 truncate">{value || "—"}</p>
      </div>
    </div>
  );
}

function FormField({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="text-[11px] font-bold text-gray-700 uppercase tracking-wide mb-1.5 block">{label}</Label>
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEAVES TAB DEMO
// ═══════════════════════════════════════════════════════════════════════════════

function LeavesTabDemo() {
  const balances = MOCK_LEAVE_BALANCES;
  const leaveColors: Record<string, string> = {
    CL: "#3B82F6", ML: "#8B5CF6", EL: "#10B981", LWP: "#F59E0B", PL: "#EC4899", MTRL: "#06B6D4", PTRL: "#6366F1"
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        {/* Leave Balance Header */}
        <GlassCard className="p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
              <Calendar className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">Leave Balance</h3>
              <p className="text-xs text-gray-500">FY 2026</p>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {balances?.map(b => {
              const total = b.annual_entitlement ?? (b.leave_code === "CL" ? 7 : b.leave_code === "ML" ? 5 : b.allocated_days);
              const color = leaveColors[b.leave_code || ""] || "#6B7280";
              const remaining = total - b.used_days;
              const bgColors: Record<string, string> = {
                CL: "from-blue-50 to-indigo-50 border-blue-200",
                ML: "from-purple-50 to-violet-50 border-purple-200",
                EL: "from-emerald-50 to-green-50 border-emerald-200",
                LWP: "from-amber-50 to-orange-50 border-amber-200",
                PL: "from-pink-50 to-rose-50 border-pink-200",
                MTRL: "from-cyan-50 to-teal-50 border-cyan-200",
                PTRL: "from-indigo-50 to-blue-50 border-indigo-200",
              };
              const bgClass = bgColors[b.leave_code || ""] || "from-gray-50 to-slate-50 border-gray-200";
              return (
                <div key={b.id} className={cn("group relative p-4 rounded-xl border bg-gradient-to-br hover:shadow-lg transition-all duration-200", bgClass)}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-gray-800 truncate">{b.leave_type?.name || b.leave_code}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">{b.leave_code}</p>
                      <div className="mt-2">
                        <p className="text-2xl font-black" style={{ color }}>{remaining.toFixed(1)}</p>
                        <p className="text-[10px] text-gray-600">of {total} days left</p>
                      </div>
                    </div>
                    <Donut v={b.used_days} max={total} color={color} />
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-white/60 overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(b.used_days / total) * 100}%`, backgroundColor: color }} />
                  </div>
                  <p className="text-[10px] text-gray-500 mt-1">{b.used_days.toFixed(1)} used</p>
                </div>
              );
            })}
          </div>
        </GlassCard>
      </div>

      {/* Apply Leave Form */}
      <GlassCard className="h-fit sticky top-4 overflow-visible">
        <div className="bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 p-5 text-white relative overflow-hidden rounded-t-2xl">
          <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 30% 20%, white, transparent 50%)' }} />
          <div className="relative">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                <Calendar className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold">Request Leave</h3>
                <p className="text-sm text-white/80">Submit for approval</p>
              </div>
            </div>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-2">Select Leave Type</label>
            <div className="space-y-1.5">
              {balances?.filter(b => (b.allocated_days - b.used_days) > 0 || b.leave_code === "LWP").slice(0, 5).map(b => {
                const color = leaveColors[b.leave_code] || "#6B7280";
                const remaining = b.allocated_days - b.used_days;
                return (
                  <div key={b.id} className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border-2 border-gray-200 bg-gray-50 hover:bg-gray-100 transition-all">
                    <span className="text-sm font-semibold text-gray-800">{b.leave_type?.name || b.leave_code}</span>
                    <span className="text-sm font-black" style={{ color }}>{remaining.toFixed(1)} <span className="text-xs font-normal text-gray-500">days</span></span>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-2">Date Range</label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-gray-500 font-medium mb-1 block">From</label>
                <input type="date" className="w-full h-10 px-3 rounded-lg border-2 border-gray-200 text-sm font-medium bg-white" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 font-medium mb-1 block">To</label>
                <input type="date" className="w-full h-10 px-3 rounded-lg border-2 border-gray-200 text-sm font-medium bg-white" />
              </div>
            </div>
          </div>
          <button className="w-full py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg">
            Submit Request
          </button>
        </div>
      </GlassCard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROFILE TAB DEMO
// ═══════════════════════════════════════════════════════════════════════════════

function ProfileTabDemo() {
  const employee = MOCK_EMPLOYEE;
  return (
    <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
      {/* Info Cards */}
      <div className="space-y-3">
        <GlassCard className="p-4">
          <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Mail className="h-3 w-3" /> Contact
          </p>
          <div className="space-y-2">
            <InfoField icon={Mail} label="Email" value={employee.official_email} color="#6366F1" />
            <InfoField icon={Phone} label="Phone" value={employee.mobile} color="#10B981" />
            <InfoField icon={Phone} label="Alternate" value={employee.alternate_mobile} color="#F59E0B" />
            <InfoField icon={MapPin} label="City" value={employee.city} color="#EF4444" />
          </div>
        </GlassCard>
        <GlassCard className="p-4">
          <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Briefcase className="h-3 w-3" /> Work
          </p>
          <div className="space-y-2">
            <InfoField icon={Briefcase} label="Designation" value={employee.designation} color="#10B981" />
            <InfoField icon={Building2} label="Department" value={employee.department?.name} color="#3B82F6" />
            <InfoField icon={Users} label="Manager" value={employee.reporting_manager_name} color="#8B5CF6" />
            <InfoField icon={Calendar} label="Joined" value={formatDate(employee.date_of_joining)} color="#F59E0B" />
          </div>
        </GlassCard>
        <GlassCard className="p-4">
          <p className="text-[10px] font-bold text-purple-600 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <User className="h-3 w-3" /> Personal
          </p>
          <div className="space-y-2">
            <InfoField icon={Cake} label="Birthday" value={formatDate(employee.date_of_birth)} color="#EC4899" />
            <InfoField icon={User} label="Gender" value={employee.gender} color="#6366F1" />
            <InfoField icon={HeartHandshake} label="Marital" value={employee.marital_status} color="#EF4444" />
            <InfoField icon={User} label="Blood Group" value={employee.blood_group} color="#DC2626" />
          </div>
        </GlassCard>
      </div>

      {/* Editable Form */}
      <GlassCard className="overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-indigo-50/50 to-transparent">
          <div>
            <h3 className="text-sm font-bold text-gray-900">Personal Information</h3>
            <p className="text-[10px] text-gray-500">Update your contact & schedule</p>
          </div>
          <Button size="sm" variant="outline" className="h-8 text-xs rounded-lg">
            <Edit3 className="h-3.5 w-3.5 mr-1.5" />Edit
          </Button>
        </div>
        <div className="p-5 space-y-4">
          {/* Identity Section */}
          <div className="rounded-xl bg-gradient-to-br from-indigo-50/80 to-blue-50/50 border border-indigo-100 p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center">
                <User className="h-3.5 w-3.5 text-indigo-600" />
              </div>
              <p className="text-xs font-bold text-indigo-700 uppercase tracking-wider">Identity</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="First Name"><Input value={employee.first_name} disabled className="h-9 text-sm font-semibold text-gray-800 rounded-lg bg-white border-indigo-200" /></FormField>
              <FormField label="Last Name"><Input value={employee.last_name} disabled className="h-9 text-sm font-semibold text-gray-800 rounded-lg bg-white border-indigo-200" /></FormField>
              <FormField label="Employee Code"><Input value={employee.employee_code} disabled className="h-9 text-sm font-bold text-indigo-700 rounded-lg bg-white border-indigo-200 font-mono" /></FormField>
              <FormField label="Official Email"><Input value={employee.official_email} disabled className="h-9 text-sm font-semibold text-gray-800 rounded-lg bg-white border-indigo-200" /></FormField>
            </div>
          </div>
          {/* Contact Section */}
          <div className="rounded-xl bg-gradient-to-br from-emerald-50/80 to-teal-50/50 border border-emerald-100 p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center">
                <Phone className="h-3.5 w-3.5 text-emerald-600" />
              </div>
              <p className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Contact</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Phone"><Input value={employee.mobile} disabled className="h-9 text-sm font-semibold text-gray-800 rounded-lg bg-white border-emerald-200" /></FormField>
              <FormField label="Personal Email"><Input value="shivamshivgiri@gmail.com" disabled className="h-9 text-sm font-semibold text-gray-800 rounded-lg bg-white border-emerald-200" /></FormField>
              <FormField label="Address" className="sm:col-span-2"><Input value="RZ2008, Rose Apartment, Flat no 15" disabled className="h-9 text-sm font-semibold text-gray-800 rounded-lg bg-white border-emerald-200" /></FormField>
              <FormField label="City"><Input value={employee.city} disabled className="h-9 text-sm font-semibold text-gray-800 rounded-lg bg-white border-emerald-200" /></FormField>
              <FormField label="Date of Birth"><Input value="1991-02-02" disabled className="h-9 text-sm font-semibold text-gray-800 rounded-lg bg-white border-emerald-200" /></FormField>
            </div>
          </div>
          {/* Schedule Section */}
          <div className="rounded-xl bg-gradient-to-br from-amber-50/80 to-orange-50/50 border border-amber-100 p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center">
                <Clock className="h-3.5 w-3.5 text-amber-600" />
              </div>
              <p className="text-xs font-bold text-amber-700 uppercase tracking-wider">Working Schedule</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DAY_LABELS.map((d, i) => {
                const active = employee.working_days.includes(i);
                return (
                  <div key={i} className={cn(
                    "w-10 h-10 rounded-xl text-xs font-bold flex items-center justify-center",
                    active ? "bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-lg" : "bg-white/80 text-gray-500 border border-amber-200"
                  )}>{d}</div>
                );
              })}
            </div>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ATTENDANCE TAB DEMO
// ═══════════════════════════════════════════════════════════════════════════════

function AttendanceTabDemo() {
  const stats = [
    { label: "Present", value: 18, color: "#10B981", bg: "from-emerald-50 to-green-50 border-emerald-200", icon: CheckCircle2 },
    { label: "Absent", value: 2, color: "#EF4444", bg: "from-red-50 to-rose-50 border-red-200", icon: X },
    { label: "Half Day", value: 1, color: "#F59E0B", bg: "from-amber-50 to-orange-50 border-amber-200", icon: Clock },
    { label: "On Leave", value: 1, color: "#8B5CF6", bg: "from-purple-50 to-violet-50 border-purple-200", icon: Calendar },
  ];

  return (
    <div className="space-y-4">
      <GlassCard className="overflow-hidden">
        <div className="bg-gradient-to-r from-teal-600 via-cyan-600 to-teal-700 p-5 text-white relative">
          <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 30% 50%, white, transparent 60%)' }} />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                <Clock className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold">Attendance Summary</h3>
                <p className="text-sm text-white/80">August 2026</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-3xl font-black">84.1%</p>
              <p className="text-xs text-white/70">Attendance Rate</p>
            </div>
          </div>
        </div>
      </GlassCard>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map(s => (
          <div key={s.label} className={cn("rounded-xl border bg-gradient-to-br p-4 transition-all hover:shadow-md", s.bg)}>
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center shadow-sm" style={{ backgroundColor: `${s.color}20` }}>
                <s.icon className="h-5 w-5" style={{ color: s.color }} />
              </div>
              <div>
                <p className="text-2xl font-black text-gray-900">{s.value}</p>
                <p className="text-xs font-bold text-gray-600 uppercase">{s.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <GlassCard className="overflow-hidden">
        <div className="bg-gradient-to-r from-slate-50 to-gray-50 border-b border-gray-100 px-5 py-3">
          <p className="text-sm font-bold text-gray-800">Monthly Calendar</p>
          <p className="text-xs text-gray-500">Click on a date to view details</p>
        </div>
        <div className="p-5">
          <div className="text-center py-8 text-gray-400">
            <Calendar className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm">Calendar component preview</p>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN DEMO COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function ProfileV3Demo() {
  const [activeTab, setActiveTab] = useState("profile");
  const employee = MOCK_EMPLOYEE;

  const tabs = [
    { v: "profile", i: User }, { v: "statutory", i: Landmark }, { v: "emergency", i: HeartHandshake },
    { v: "journey", i: GitBranch }, { v: "leaves", i: Calendar }, { v: "attendance", i: Clock },
    { v: "assets", i: Package }, { v: "reviews", i: Star }, { v: "payslips", i: Wallet },
    { v: "documents", i: Files }, { v: "security", i: ShieldCheck },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-4">
        {/* DEMO BANNER */}
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-4 py-2 rounded-xl text-center">
          <p className="text-sm font-bold">DESIGN DEMO - Using Mock Data (No Backend Required)</p>
        </div>

        {/* HERO */}
        <GlassCard className="overflow-hidden">
          <div className="bg-gradient-to-r from-[#0f172a] via-[#1e293b] to-[#334155] p-6 lg:p-8 text-white relative">
            <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, rgba(99, 102, 241, 0.4), transparent 50%), radial-gradient(circle at 80% 50%, rgba(168, 85, 247, 0.4), transparent 50%)' }} />
            <div className="absolute inset-0 opacity-5" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
            <div className="relative flex items-center gap-6">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-3xl font-black">
                SS
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-indigo-300 uppercase tracking-widest">Employee Profile</p>
                <h1 className="text-3xl lg:text-4xl font-black mt-1 truncate">{employee.first_name} {employee.last_name}</h1>
                <p className="text-base text-gray-300 font-medium mt-1">{employee.designation}</p>
                <div className="flex flex-wrap gap-2 mt-3">
                  <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-xs font-semibold px-3 py-1"><CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />{employee.status}</Badge>
                  <Badge className="bg-white/10 text-white border-white/20 text-xs font-mono px-3 py-1">{employee.employee_code}</Badge>
                  <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30 text-xs px-3 py-1"><Building2 className="h-3.5 w-3.5 mr-1.5" />{employee.department.name}</Badge>
                </div>
              </div>
              <div className="hidden lg:flex gap-3">
                {[
                  { label: "Joined", value: formatDate(employee.date_of_joining), color: "from-blue-500/20 to-indigo-500/10" },
                  { label: "Birthday", value: formatDate(employee.date_of_birth), color: "from-pink-500/20 to-rose-500/10" },
                ].map(({ label, value, color }) => (
                  <div key={label} className={cn("rounded-xl px-4 py-3 min-w-[120px] bg-gradient-to-br border border-white/10", color)}>
                    <p className="text-[9px] font-bold text-white/60 uppercase tracking-wide">{label}</p>
                    <p className="text-sm font-bold text-white mt-0.5">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </GlassCard>

        {/* TABS */}
        <GlassCard className="p-1.5">
          <div className="flex flex-wrap gap-1">
            {tabs.map(({ v, i: I }) => (
              <button key={v} onClick={() => setActiveTab(v)} className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all duration-200 capitalize",
                activeTab === v
                  ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/25"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              )}>
                <I className="h-3.5 w-3.5" /><span className="hidden sm:inline">{v === "statutory" ? "Bank" : v}</span>
              </button>
            ))}
          </div>
        </GlassCard>

        {/* TAB CONTENT */}
        {activeTab === "profile" && <ProfileTabDemo />}
        {activeTab === "leaves" && <LeavesTabDemo />}
        {activeTab === "attendance" && <AttendanceTabDemo />}

        {/* Placeholder for other tabs */}
        {!["profile", "leaves", "attendance"].includes(activeTab) && (
          <GlassCard className="overflow-hidden">
            <div className="bg-gradient-to-r from-gray-600 via-slate-600 to-gray-700 p-5 text-white relative">
              <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 30% 50%, white, transparent 60%)' }} />
              <div className="relative flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                  {tabs.find(t => t.v === activeTab)?.i && (() => { const Icon = tabs.find(t => t.v === activeTab)!.i; return <Icon className="h-6 w-6" />; })()}
                </div>
                <div>
                  <h3 className="text-lg font-bold capitalize">{activeTab === "statutory" ? "Bank & Statutory" : activeTab}</h3>
                  <p className="text-sm text-white/80">Demo content</p>
                </div>
              </div>
            </div>
            <div className="p-8 text-center">
              <p className="text-gray-500">This tab showcases the gradient header design pattern.</p>
              <p className="text-sm text-gray-400 mt-2">Content would be loaded from the API in production.</p>
            </div>
          </GlassCard>
        )}
      </div>
    </DashboardLayout>
  );
}
