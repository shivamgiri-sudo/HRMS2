import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Users, TrendingUp, TrendingDown, Calendar, Clock, CheckCircle2, XCircle, ChevronRight, Eye, MessageSquare,
  Download, FileText, ArrowUpRight, ArrowDownRight, Sparkles, Briefcase, Award, Activity, Bell, Search, Mail, UserPlus,
  BarChart3, PieChart, Target, Coffee, Zap, Heart, Star, Flame, Shield, Globe, Laptop, CreditCard, Building
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ════════════════════════════════════════════════════════════════════════════
// BEFORE: Generic Dashboard
// ════════════════════════════════════════════════════════════════════════════
function BeforeDashboard() {
  return (
    <div className="p-4 space-y-3 bg-gray-100 min-h-[600px] font-sans">
      <h1 className="text-lg font-bold text-gray-800">HR Dashboard</h1>
      <div className="grid grid-cols-2 gap-3">
        {[{ l: 'Total Employees', v: '1,247' }, { l: 'Attrition Rate', v: '4.2%' }, { l: 'Open Positions', v: '23' }, { l: 'Pending Approvals', v: '15' }].map((x, i) => (
          <div key={i} className="bg-white p-3 rounded shadow-sm">
            <p className="text-xs text-gray-500">{x.l}</p>
            <p className="text-xl font-bold">{x.v}</p>
          </div>
        ))}
      </div>
      <div className="bg-white p-3 rounded shadow-sm">
        <h2 className="font-bold mb-2 text-sm">Recent Employees</h2>
        <table className="w-full text-xs">
          <thead><tr className="border-b text-gray-500 text-left"><th className="p-1">Name</th><th className="p-1">Salary</th><th className="p-1">PAN</th></tr></thead>
          <tbody>
            <tr className="border-b"><td className="p-1">John Doe</td><td className="p-1 text-red-600 font-mono">₹85,000</td><td className="p-1 text-red-600 font-mono">ABCDE1234F</td></tr>
            <tr><td className="p-1">Jane Smith</td><td className="p-1 text-red-600 font-mono">₹92,000</td><td className="p-1 text-red-600 font-mono">FGHIJ5678K</td></tr>
          </tbody>
        </table>
        <p className="text-[10px] text-red-500 mt-2">⚠️ Sensitive data exposed!</p>
      </div>
      <div className="bg-white p-3 rounded shadow-sm">
        <h2 className="font-bold mb-1 text-sm">Leave Balance</h2>
        <p className="text-xs text-gray-600">Casual Leave: 5/12 • Sick Leave: 3/6 • Earned Leave: 8/15</p>
      </div>
      <div className="bg-white p-3 rounded shadow-sm">
        <h2 className="font-bold mb-2 text-sm">Pending Approvals</h2>
        <div className="flex gap-2">
          <button className="bg-green-500 text-white px-3 py-1 rounded text-xs">Approve</button>
          <button className="bg-red-500 text-white px-3 py-1 rounded text-xs">Reject</button>
        </div>
        <p className="text-[10px] text-gray-400 mt-2">No workflow visibility</p>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// CHART COMPONENTS
// ════════════════════════════════════════════════════════════════════════════
function AnimNum({ v, s = '' }: { v: number; s?: string }) {
  const [d, setD] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const animate = (now: number) => {
      const p = Math.min((now - start) / 1000, 1);
      setD(Math.floor(v * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [v]);
  return <>{d.toLocaleString()}{s}</>;
}

function Sparkline({ data, color, height = 28 }: { data: number[]; color: string; height?: number }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * 100},${100 - ((v - min) / range) * 80}`).join(' ');
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ height, width: '100%' }}>
      <defs>
        <linearGradient id={`spark-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,100 ${points} 100,100`} fill={`url(#spark-${color.replace('#', '')})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AreaChart({ data, color, h = 50 }: { data: number[]; color: string; h?: number }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * 100},${100 - ((v - min) / range) * 85}`).join(' ');
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ height: h, width: '100%' }}>
      <defs>
        <linearGradient id={`area-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <polygon points={`0,100 ${points} 100,100`} fill={`url(#area-${color.replace('#', '')})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Donut({ v, max, color, size = 44 }: { v: number; max: number; color: string; size?: number }) {
  const pct = (v / max) * 100;
  const c = 2 * Math.PI * 16;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size/2} cy={size/2} r="16" fill="none" stroke="#e5e7eb" strokeWidth="4" />
      <circle cx={size/2} cy={size/2} r="16" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c} className="transition-all duration-1000 drop-shadow-sm" />
    </svg>
  );
}

function Gauge({ value, color }: { value: number; color: string }) {
  return (
    <div className="relative w-20 h-10 overflow-hidden">
      <svg viewBox="0 0 100 50" className="w-full h-full">
        <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="#e5e7eb" strokeWidth="8" strokeLinecap="round" />
        <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(value / 100) * 126} 126`} className="transition-all duration-1000 drop-shadow-sm" />
      </svg>
      <div className="absolute inset-0 flex items-end justify-center pb-1">
        <span className="text-sm font-bold" style={{ color }}>{value}%</span>
      </div>
    </div>
  );
}

// Attendance status: P=Present, A=Absent, H=Half-day, L=Leave, WO=Week-off, HO=Holiday
type AttendanceStatus = 'P' | 'A' | 'H' | 'L' | 'WO' | 'HO';
const attendanceColors: Record<AttendanceStatus, { bg: string; border: string; label: string }> = {
  'P': { bg: '#10B981', border: '#059669', label: 'Present' },      // Green
  'A': { bg: '#EF4444', border: '#DC2626', label: 'Absent' },       // Red
  'H': { bg: '#F59E0B', border: '#D97706', label: 'Half-day' },     // Amber
  'L': { bg: '#8B5CF6', border: '#7C3AED', label: 'Leave' },        // Purple
  'WO': { bg: '#94A3B8', border: '#64748B', label: 'Week-off' },    // Slate
  'HO': { bg: '#3B82F6', border: '#2563EB', label: 'Holiday' },     // Blue
};

function HeatmapRow({ data, label }: { data: AttendanceStatus[]; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] text-gray-500 w-8 font-medium">{label}</span>
      <div className="flex gap-[3px]">
        {data.map((status, i) => {
          const color = attendanceColors[status];
          return (
            <div
              key={i}
              className="w-4 h-4 rounded transition-all hover:scale-125 cursor-pointer shadow-sm"
              style={{ backgroundColor: color.bg, border: `1px solid ${color.border}` }}
              title={color.label}
            />
          );
        })}
      </div>
    </div>
  );
}

function FunnelBar({ label, value, max, color, icon: Icon }: { label: string; value: number; max: number; color: string; icon: any }) {
  const pct = (value / max) * 100;
  return (
    <div className="flex items-center gap-3">
      <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${color}15` }}>
        <Icon className="h-4 w-4" style={{ color }} />
      </div>
      <div className="flex-1">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-gray-600">{label}</span>
          <span className="font-semibold" style={{ color }}>{value}</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${pct}%`, backgroundColor: color }} />
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// AFTER: Premium Dashboard with Full Width + Colors
// ════════════════════════════════════════════════════════════════════════════
function AfterDashboard() {
  const kpis = [
    { icon: Users, label: 'Total Employees', value: 1247, trend: 'up', change: '+12', color: '#6366F1', bg: 'from-indigo-500/10 to-violet-500/5', data: [40,45,42,48,52,58,62,67] },
    { icon: TrendingDown, label: 'Attrition Rate', value: 4.2, suffix: '%', trend: 'down', change: '-0.5%', color: '#10B981', bg: 'from-emerald-500/10 to-teal-500/5', data: [5.2,4.8,4.9,4.5,4.3,4.2,4.1] },
    { icon: Briefcase, label: 'Open Positions', value: 23, trend: 'up', change: '+5', color: '#F59E0B', bg: 'from-amber-500/10 to-orange-500/5', data: [15,18,16,20,22,21,23] },
    { icon: Bell, label: 'Pending Actions', value: 15, trend: 'neutral', change: '', color: '#EF4444', bg: 'from-rose-500/10 to-pink-500/5', data: [12,8,15,10,18,14,15] },
  ];

  const employees = [
    { name: 'Rajesh Kumar', role: 'Senior Developer', dept: 'Engineering', color: 'from-blue-500 to-indigo-600', status: 'online' },
    { name: 'Priya Sharma', role: 'HR Manager', dept: 'Human Resources', color: 'from-purple-500 to-pink-600', status: 'online' },
    { name: 'Amit Patel', role: 'QA Lead', dept: 'Quality', color: 'from-emerald-500 to-teal-600', status: 'away' },
    { name: 'Sneha Reddy', role: 'Product Manager', dept: 'Product', color: 'from-amber-500 to-orange-600', status: 'online' },
    { name: 'Vikram Mehta', role: 'DevOps Engineer', dept: 'Engineering', color: 'from-cyan-500 to-blue-600', status: 'offline' },
    { name: 'Neha Gupta', role: 'UI Designer', dept: 'Product', color: 'from-rose-500 to-pink-600', status: 'online' },
  ];

  const leaves = [
    { type: 'Casual', short: 'CL', available: 5, total: 12, color: '#EF4444' },
    { type: 'Sick', short: 'SL', available: 3, total: 6, color: '#F59E0B' },
    { type: 'Earned', short: 'EL', available: 12, total: 15, color: '#10B981' },
  ];

  const quickStats = [
    { icon: UserPlus, label: 'New Joins', value: '8', sub: 'this month', color: '#10B981', bg: 'from-emerald-500/10 to-teal-500/5' },
    { icon: Award, label: 'Birthdays', value: '3', sub: 'this week', color: '#EC4899', bg: 'from-pink-500/10 to-rose-500/5' },
    { icon: Target, label: 'Goals Met', value: '87%', sub: 'Q3 target', color: '#6366F1', bg: 'from-indigo-500/10 to-purple-500/5' },
    { icon: Coffee, label: 'Avg Tenure', value: '2.4y', sub: 'company', color: '#F59E0B', bg: 'from-amber-500/10 to-orange-500/5' },
  ];

  const attendanceData: { day: string; data: AttendanceStatus[] }[] = [
    { day: 'Mon', data: ['P', 'P', 'P', 'H', 'P', 'P', 'P'] },
    { day: 'Tue', data: ['P', 'P', 'L', 'L', 'P', 'P', 'A'] },
    { day: 'Wed', data: ['P', 'H', 'P', 'P', 'P', 'P', 'P'] },
    { day: 'Thu', data: ['P', 'P', 'P', 'P', 'HO', 'HO', 'HO'] },
    { day: 'Fri', data: ['P', 'P', 'P', 'P', 'P', 'P', 'P'] },
    { day: 'Sat', data: ['WO', 'WO', 'WO', 'WO', 'WO', 'WO', 'WO'] },
    { day: 'Sun', data: ['WO', 'WO', 'WO', 'WO', 'WO', 'WO', 'WO'] },
  ];

  const growthData = [120, 180, 280, 420, 580, 720, 850, 980, 1100, 1180, 1247];

  const stages = [
    { name: 'Submitted', status: 'done', time: '9:30 AM', approver: 'Employee' },
    { name: 'Manager', status: 'done', time: '2:15 PM', approver: 'Rajesh K.' },
    { name: 'HR Review', status: 'current', approver: 'Priya S.' },
    { name: 'Finance', status: 'pending', approver: 'Amit P.' },
  ];

  return (
    <div className="min-h-[600px] bg-gradient-to-br from-slate-50 via-white to-indigo-50/30 relative overflow-hidden">
      {/* Decorative Orbs */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-indigo-500/15 via-purple-500/10 to-transparent rounded-full blur-3xl" />
      <div className="absolute bottom-0 left-0 w-48 h-48 bg-gradient-to-tr from-emerald-500/15 via-teal-500/10 to-transparent rounded-full blur-3xl" />
      <div className="absolute top-1/2 right-1/4 w-32 h-32 bg-gradient-to-br from-pink-500/10 via-rose-500/5 to-transparent rounded-full blur-2xl" />
      <div className="absolute bottom-1/3 left-1/3 w-40 h-40 bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-transparent rounded-full blur-2xl" />

      {/* Announcement Bar */}
      <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 text-white px-4 py-2 text-xs flex items-center justify-center gap-2 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
        <Sparkles className="h-3.5 w-3.5 text-amber-300" />
        <span className="font-medium">New: AI-powered salary insights now available</span>
        <span className="text-white/60">•</span>
        <span className="underline cursor-pointer hover:text-amber-200 transition-colors">Explore now →</span>
      </div>

      <div className="relative p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
              <BarChart3 className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">HR Dashboard</h1>
              <p className="text-xs text-gray-500">Real-time workforce analytics</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/80 border border-gray-200 text-gray-400 text-xs hover:border-gray-300 cursor-pointer transition-colors">
              <Search className="h-3.5 w-3.5" />
              <span>Search...</span>
              <kbd className="ml-1 px-1.5 py-0.5 rounded bg-gray-100 text-[10px] font-mono">⌘K</kbd>
            </div>
            <Badge variant="outline" className="gap-1.5 bg-white/80 border-emerald-200 text-emerald-700">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </Badge>
            <Button size="sm" className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white shadow-lg shadow-indigo-500/25">
              <Download className="h-4 w-4 mr-1.5" />
              Export
            </Button>
          </div>
        </div>

        {/* KPI Tiles */}
        <div className="grid grid-cols-4 gap-3">
          {kpis.map((kpi, i) => {
            const Icon = kpi.icon;
            const TrendIcon = kpi.trend === 'up' ? ArrowUpRight : kpi.trend === 'down' ? ArrowDownRight : null;
            const tc = kpi.trend === 'up' ? 'text-emerald-600' : kpi.trend === 'down' ? 'text-rose-600' : 'text-gray-400';
            return (
              <div key={i} className={cn(
                "group relative bg-gradient-to-br rounded-2xl p-4 border border-white/60 shadow-lg shadow-black/5",
                "hover:shadow-xl hover:scale-[1.02] hover:-translate-y-0.5 transition-all duration-300 cursor-pointer overflow-hidden",
                kpi.bg
              )}>
                <div className="absolute inset-0 bg-white/40 backdrop-blur-sm" />
                <div className="relative">
                  <div className="flex items-center justify-between mb-2">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-white/80 shadow-sm group-hover:scale-110 group-hover:rotate-3 transition-transform" style={{ color: kpi.color }}>
                      <Icon className="h-5 w-5" />
                    </div>
                    {TrendIcon && (
                      <span className={cn("flex items-center gap-0.5 text-xs font-bold px-2 py-0.5 rounded-full bg-white/80", tc)}>
                        <TrendIcon className="h-3.5 w-3.5" />{kpi.change}
                      </span>
                    )}
                  </div>
                  <p className="text-2xl font-bold text-gray-900 mb-0.5">
                    <AnimNum v={kpi.value} s={kpi.suffix} />
                  </p>
                  <p className="text-xs text-gray-600 mb-2">{kpi.label}</p>
                  <Sparkline data={kpi.data} color={kpi.color} height={32} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-4 gap-3">
          {quickStats.map((stat, i) => {
            const Icon = stat.icon;
            return (
              <div key={i} className={cn(
                "flex items-center gap-3 rounded-xl p-3 border border-white/60 bg-gradient-to-br",
                "hover:shadow-md transition-all cursor-pointer",
                stat.bg
              )}>
                <div className="relative">
                  <div className="absolute inset-0 rounded-xl blur-md" style={{ backgroundColor: `${stat.color}20` }} />
                  <div className="relative w-10 h-10 rounded-xl flex items-center justify-center bg-white/80 shadow-sm" style={{ color: stat.color }}>
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
                <div>
                  <p className="text-lg font-bold text-gray-900">{stat.value}</p>
                  <p className="text-xs text-gray-500">{stat.label}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-12 gap-4">
          {/* Employee Growth + Funnel */}
          <div className="col-span-4 space-y-4">
            {/* Growth Chart */}
            <div className="bg-white/60 backdrop-blur-sm rounded-2xl p-4 border border-white/60 shadow-lg">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-indigo-500" />
                  Employee Growth
                </h3>
                <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">+940% YoY</Badge>
              </div>
              <AreaChart data={growthData} color="#6366F1" h={60} />
              <div className="flex justify-between text-[10px] text-gray-400 mt-2">
                <span>Jan</span><span>Apr</span><span>Jul</span><span>Oct</span><span>Dec</span>
              </div>
            </div>

            {/* Hiring Funnel */}
            <div className="bg-white/60 backdrop-blur-sm rounded-2xl p-4 border border-white/60 shadow-lg">
              <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Target className="h-4 w-4 text-amber-500" />
                Hiring Funnel
              </h3>
              <div className="space-y-3">
                <FunnelBar label="Applications" value={248} max={248} color="#6366F1" icon={FileText} />
                <FunnelBar label="Screened" value={156} max={248} color="#8B5CF6" icon={Eye} />
                <FunnelBar label="Interviewed" value={89} max={248} color="#EC4899" icon={MessageSquare} />
                <FunnelBar label="Offered" value={34} max={248} color="#F59E0B" icon={Mail} />
                <FunnelBar label="Joined" value={23} max={248} color="#10B981" icon={CheckCircle2} />
              </div>
            </div>
          </div>

          {/* Employees Grid */}
          <div className="col-span-5 space-y-4">
            <div className="bg-white/60 backdrop-blur-sm rounded-2xl p-4 border border-white/60 shadow-lg">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <Users className="h-4 w-4 text-indigo-500" />
                  Recent Team Members
                </h3>
                <span className="text-xs text-indigo-600 hover:underline cursor-pointer flex items-center gap-1">
                  View all <ChevronRight className="h-3 w-3" />
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {employees.map((emp, i) => (
                  <div key={i} className="group flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/80 transition-all cursor-pointer">
                    <div className="relative">
                      <div className={cn("w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center text-white text-sm font-semibold shadow-md", emp.color)}>
                        {emp.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <span className={cn(
                        "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white",
                        emp.status === 'online' ? 'bg-emerald-500' : emp.status === 'away' ? 'bg-amber-500' : 'bg-gray-400'
                      )} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-gray-900 truncate">{emp.name}</p>
                      <p className="text-[10px] text-gray-500 truncate">{emp.role}</p>
                      <Badge variant="outline" className="mt-1 text-[9px] px-1.5 py-0">{emp.dept}</Badge>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Eye className="h-4 w-4 text-gray-400 hover:text-indigo-500 cursor-pointer" />
                      <MessageSquare className="h-4 w-4 text-gray-400 hover:text-indigo-500 cursor-pointer" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Attendance Heatmap */}
            <div className="bg-white/60 backdrop-blur-sm rounded-2xl p-4 border border-white/60 shadow-lg">
              <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-emerald-500" />
                Weekly Attendance
              </h3>
              <div className="space-y-1.5">
                {attendanceData.map((row, i) => <HeatmapRow key={i} data={row.data} label={row.day} />)}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-[9px] text-gray-500">
                {Object.entries(attendanceColors).map(([key, val]) => (
                  <div key={key} className="flex items-center gap-1">
                    <div className="w-2.5 h-2.5 rounded" style={{ backgroundColor: val.bg }} />
                    <span>{val.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column */}
          <div className="col-span-3 space-y-4">
            {/* Performance Gauges */}
            <div className="bg-white/60 backdrop-blur-sm rounded-2xl p-4 border border-white/60 shadow-lg">
              <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-500" />
                Performance
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-600">Goals Met</span>
                  <Gauge value={87} color="#10B981" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-600">Attendance</span>
                  <Gauge value={92} color="#6366F1" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-600">Training</span>
                  <Gauge value={78} color="#F59E0B" />
                </div>
              </div>
            </div>

            {/* Leave Balance */}
            <div className="bg-white/60 backdrop-blur-sm rounded-2xl p-4 border border-white/60 shadow-lg">
              <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-indigo-500" />
                Leave Balance
              </h3>
              <div className="space-y-3">
                {leaves.map((l, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="relative">
                      <Donut v={l.available} max={l.total} color={l.color} size={44} />
                      <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-gray-700">{l.available}</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-medium text-gray-700">{l.type}</span>
                        <span className="text-gray-500">{l.available}/{l.total}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${(l.available / l.total) * 100}%`, backgroundColor: l.color }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Dept Pie */}
            <div className="bg-white/60 backdrop-blur-sm rounded-2xl p-4 border border-white/60 shadow-lg">
              <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <PieChart className="h-4 w-4 text-indigo-500" />
                By Department
              </h3>
              <div className="flex items-center gap-4">
                <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
                  <circle cx="18" cy="18" r="14" fill="none" stroke="#6366F1" strokeWidth="5" strokeDasharray="35 65" className="drop-shadow-sm" />
                  <circle cx="18" cy="18" r="14" fill="none" stroke="#10B981" strokeWidth="5" strokeDasharray="25 75" strokeDashoffset="-35" className="drop-shadow-sm" />
                  <circle cx="18" cy="18" r="14" fill="none" stroke="#F59E0B" strokeWidth="5" strokeDasharray="22 78" strokeDashoffset="-60" className="drop-shadow-sm" />
                  <circle cx="18" cy="18" r="14" fill="none" stroke="#EC4899" strokeWidth="5" strokeDasharray="18 82" strokeDashoffset="-82" className="drop-shadow-sm" />
                </svg>
                <div className="space-y-1 text-xs">
                  <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />Engineering 35%</div>
                  <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />Operations 25%</div>
                  <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" />Sales 22%</div>
                  <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-pink-500" />HR 18%</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Approval Workflow */}
        <div className="bg-white/60 backdrop-blur-sm rounded-2xl p-5 border border-white/60 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
                <FileText className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Leave Request #LR-2024-0847</h3>
                <p className="text-xs text-gray-500">Casual Leave • 3 days (12 Aug - 14 Aug) • Rajesh Kumar</p>
              </div>
            </div>
            <Badge className="bg-indigo-100 text-indigo-700 border-indigo-200">In Review</Badge>
          </div>

          {/* Timeline */}
          <div className="relative flex items-center justify-between py-4">
            <div className="absolute top-1/2 left-6 right-6 h-1 bg-gray-200 -translate-y-1/2 rounded-full" />
            <div className="absolute top-1/2 left-6 h-1 bg-gradient-to-r from-emerald-500 to-indigo-500 -translate-y-1/2 rounded-full w-1/2" />
            {stages.map((s, i) => (
              <div key={i} className="relative flex flex-col items-center z-10">
                <div className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold border-2 shadow-lg transition-all",
                  s.status === 'done' && "bg-gradient-to-br from-emerald-400 to-emerald-600 border-emerald-400 text-white shadow-emerald-500/30",
                  s.status === 'current' && "bg-gradient-to-br from-indigo-400 to-purple-600 border-indigo-400 text-white shadow-indigo-500/30 animate-pulse",
                  s.status === 'pending' && "bg-white border-gray-200 text-gray-400"
                )}>
                  {s.status === 'done' ? <CheckCircle2 className="h-5 w-5" /> : s.status === 'current' ? <Clock className="h-5 w-5" /> : i + 1}
                </div>
                <p className="text-xs font-semibold text-gray-700 mt-2">{s.name}</p>
                <p className="text-[10px] text-gray-500">{s.approver}</p>
                {s.time && <p className="text-[10px] text-emerald-600 font-medium">{s.time}</p>}
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-4 border-t border-gray-100">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Avatar className="h-8 w-8 border-2 border-white shadow-md">
                <AvatarFallback className="bg-gradient-to-br from-purple-400 to-pink-500 text-white text-xs font-semibold">PS</AvatarFallback>
              </Avatar>
              <span>Awaiting <strong>Priya Sharma</strong> (HR Manager)</span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="border-rose-200 text-rose-600 hover:bg-rose-50">
                <XCircle className="h-4 w-4 mr-1.5" />Reject
              </Button>
              <Button className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg shadow-emerald-500/25">
                <CheckCircle2 className="h-4 w-4 mr-1.5" />Approve
              </Button>
            </div>
          </div>
        </div>
      </div>

      <style>{`@keyframes shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}.animate-shimmer{animation:shimmer 2s infinite}`}</style>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════════
export default function UXSkillDemo() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Ambient Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-20 left-20 w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-20 right-20 w-[500px] h-[500px] bg-purple-500/15 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 w-72 h-72 bg-pink-500/10 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute top-1/3 right-1/3 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl" />
      </div>

      {/* Hero Header */}
      <div className="relative border-b border-white/10 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.2),transparent_60%)]" />
        <div className="relative max-w-7xl mx-auto px-6 py-10 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-500/20 border border-indigo-500/30 mb-5">
            <Sparkles className="h-4 w-4 text-indigo-400" />
            <span className="text-sm text-indigo-300 font-medium">UI/UX Pro Max Skill v2.0</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
            See the <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">Difference</span>
          </h1>
          <p className="text-base text-slate-400 max-w-2xl mx-auto mb-8">
            Compare a generic HRMS dashboard with one built using <strong className="text-white">102 styles</strong>, <strong className="text-white">28 motion patterns</strong>, and <strong className="text-white">122 UX guidelines</strong> including 8 HRMS-specific patterns.
          </p>
          <div className="flex items-center justify-center gap-8 text-sm">
            {[
              { v: '102', l: 'Styles', c: 'from-indigo-400 to-purple-400' },
              { v: '28', l: 'Motion', c: 'from-emerald-400 to-teal-400' },
              { v: '122', l: 'UX Rules', c: 'from-amber-400 to-orange-400' },
              { v: '8', l: 'HRMS', c: 'from-pink-400 to-rose-400' },
            ].map((s, i) => (
              <div key={i} className="text-center">
                <p className={cn("text-3xl font-bold bg-gradient-to-r bg-clip-text text-transparent", s.c)}>{s.v}</p>
                <p className="text-slate-500">{s.l}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="relative max-w-7xl mx-auto px-6 py-8">
        <Tabs defaultValue="split" className="w-full">
          <TabsList className="grid w-full max-w-sm mx-auto grid-cols-3 mb-8 bg-slate-800/50 p-1 rounded-xl">
            <TabsTrigger value="split" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-slate-900">Split View</TabsTrigger>
            <TabsTrigger value="before" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-slate-900">Before</TabsTrigger>
            <TabsTrigger value="after" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-slate-900">After</TabsTrigger>
          </TabsList>

          <TabsContent value="split">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div className="flex items-center gap-2 px-2">
                  <Badge variant="destructive">Before</Badge>
                  <span className="text-sm text-slate-400">Generic Dashboard (No Skill)</span>
                </div>
                <div className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
                  <BeforeDashboard />
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-2 px-2">
                  <Badge className="bg-emerald-500">After</Badge>
                  <span className="text-sm text-slate-400">With UI/UX Pro Max Skill</span>
                </div>
                <div className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
                  <AfterDashboard />
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="before">
            <div className="max-w-3xl mx-auto rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
              <BeforeDashboard />
            </div>
          </TabsContent>

          <TabsContent value="after">
            <div className="max-w-5xl mx-auto rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
              <AfterDashboard />
            </div>
          </TabsContent>
        </Tabs>

        {/* Applied Patterns */}
        <div className="mt-10 rounded-2xl bg-slate-800/50 border border-white/10 p-6">
          <h2 className="text-lg font-semibold text-white mb-2">Applied Patterns</h2>
          <p className="text-sm text-slate-400 mb-6">UI/UX skill guidelines used in the "After" dashboard</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { id: '#116', name: 'Employee Profile Card', desc: 'Avatar, initials, department badge, quick actions — no sensitive data' },
              { id: '#117', name: 'Leave Balance Widget', desc: 'Donut charts, color-coded status (green/amber/red), progress bars' },
              { id: '#120', name: 'Approval Workflow', desc: 'Timeline with stages, timestamps, approver names, animated progress' },
              { id: '#123', name: 'Dashboard KPI Tiles', desc: 'Animated counters, sparklines, trend arrows, gradient backgrounds' },
              { id: '#39', name: 'Bento Grid Layout', desc: 'Modular cards, varied sizes, asymmetric grid, soft shadows' },
              { id: '#3', name: 'Glassmorphism Cards', desc: 'Frosted glass effect, backdrop-blur, translucent borders' },
              { id: '#98', name: 'Dark Glow Effects', desc: 'Ambient gradients, spotlight orbs, neon accents' },
              { id: '#118', name: 'Attendance Heatmap', desc: 'Color-coded grid, weekly view, intensity scale' },
            ].map((p) => (
              <div key={p.id} className="p-4 rounded-xl bg-slate-700/30 border border-white/5 hover:border-indigo-500/30 transition-colors">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className="font-mono text-xs border-indigo-500/30 text-indigo-400">{p.id}</Badge>
                  <span className="font-medium text-white text-sm">{p.name}</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
