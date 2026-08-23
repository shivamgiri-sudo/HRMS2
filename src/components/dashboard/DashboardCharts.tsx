import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  Users, TrendingUp, Calendar, CheckCircle2, Clock, ChevronRight,
  Eye, MessageSquare, FileText, Mail, Target, Zap, PieChart
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';

// Animated Number Counter
export function AnimNum({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [displayed, setDisplayed] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const animate = (now: number) => {
      const progress = Math.min((now - start) / 1000, 1);
      setDisplayed(Math.floor(value * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [value]);
  return <>{displayed.toLocaleString()}{suffix}</>;
}

// Sparkline Chart
export function Sparkline({ data, color, height = 28 }: { data: number[]; color: string; height?: number }) {
  if (!data.length) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * 100},${100 - ((v - min) / range) * 80}`).join(' ');
  const gradientId = `spark-${color.replace('#', '')}-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ height, width: '100%' }}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,100 ${points} 100,100`} fill={`url(#${gradientId})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Area Chart
export function AreaChart({ data, color, height = 50 }: { data: number[]; color: string; height?: number }) {
  if (!data.length) return <div className="flex h-12 items-center justify-center text-xs text-slate-400">No data</div>;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * 100},${100 - ((v - min) / range) * 85}`).join(' ');
  const gradientId = `area-${color.replace('#', '')}-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ height, width: '100%' }}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <polygon points={`0,100 ${points} 100,100`} fill={`url(#${gradientId})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// Donut Chart
export function DonutChart({ value, max, color, size = 44 }: { value: number; max: number; color: string; size?: number }) {
  const pct = Math.min((value / max) * 100, 100);
  const circumference = 2 * Math.PI * 16;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size/2} cy={size/2} r="16" fill="none" stroke="#e5e7eb" strokeWidth="4" />
      <circle
        cx={size/2} cy={size/2} r="16" fill="none" stroke={color} strokeWidth="4"
        strokeLinecap="round" strokeDasharray={circumference}
        strokeDashoffset={circumference - (pct / 100) * circumference}
        className="transition-all duration-1000 drop-shadow-sm"
      />
    </svg>
  );
}

// Semi-circle Gauge
export function Gauge({ value, color, label }: { value: number; color: string; label?: string }) {
  return (
    <div className="relative w-20 h-10 overflow-hidden">
      <svg viewBox="0 0 100 50" className="w-full h-full">
        <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="#e5e7eb" strokeWidth="8" strokeLinecap="round" />
        <path
          d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke={color} strokeWidth="8"
          strokeLinecap="round" strokeDasharray={`${(value / 100) * 126} 126`}
          className="transition-all duration-1000 drop-shadow-sm"
        />
      </svg>
      <div className="absolute inset-0 flex items-end justify-center pb-1">
        <span className="text-sm font-bold" style={{ color }}>{value}%</span>
      </div>
    </div>
  );
}

// Attendance Heatmap Types
export type AttendanceStatus = 'P' | 'A' | 'H' | 'L' | 'WO' | 'HO';
export const attendanceColors: Record<AttendanceStatus, { bg: string; border: string; label: string }> = {
  'P': { bg: '#10B981', border: '#059669', label: 'Present' },
  'A': { bg: '#EF4444', border: '#DC2626', label: 'Absent' },
  'H': { bg: '#F59E0B', border: '#D97706', label: 'Half-day' },
  'L': { bg: '#8B5CF6', border: '#7C3AED', label: 'Leave' },
  'WO': { bg: '#94A3B8', border: '#64748B', label: 'Week-off' },
  'HO': { bg: '#3B82F6', border: '#2563EB', label: 'Holiday' },
};

// Heatmap Row
export function HeatmapRow({ data, label }: { data: AttendanceStatus[]; label: string }) {
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

// Attendance Heatmap Widget
export function AttendanceHeatmap({ data }: { data?: { day: string; statuses: AttendanceStatus[] }[] }) {
  const defaultData: { day: string; statuses: AttendanceStatus[] }[] = [
    { day: 'Mon', statuses: ['P', 'P', 'P', 'H', 'P', 'P', 'P'] },
    { day: 'Tue', statuses: ['P', 'P', 'L', 'L', 'P', 'P', 'A'] },
    { day: 'Wed', statuses: ['P', 'H', 'P', 'P', 'P', 'P', 'P'] },
    { day: 'Thu', statuses: ['P', 'P', 'P', 'P', 'HO', 'HO', 'HO'] },
    { day: 'Fri', statuses: ['P', 'P', 'P', 'P', 'P', 'P', 'P'] },
    { day: 'Sat', statuses: ['WO', 'WO', 'WO', 'WO', 'WO', 'WO', 'WO'] },
    { day: 'Sun', statuses: ['WO', 'WO', 'WO', 'WO', 'WO', 'WO', 'WO'] },
  ];
  const heatmapData = data || defaultData;

  return (
    <div className="bg-white/60 backdrop-blur-sm rounded-2xl p-4 border border-white/60 shadow-lg">
      <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
        <Calendar className="h-4 w-4 text-emerald-500" />
        Weekly Attendance
      </h3>
      <div className="space-y-1.5">
        {heatmapData.map((row, i) => <HeatmapRow key={i} data={row.statuses} label={row.day} />)}
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
  );
}

// Funnel Bar
export function FunnelBar({ label, value, max, color, icon: Icon }: { label: string; value: number; max: number; color: string; icon: React.ElementType }) {
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

// Hiring Funnel Widget
export function HiringFunnel({ data }: { data?: { label: string; value: number; color: string; icon: React.ElementType }[] }) {
  const defaultData = [
    { label: 'Applications', value: 248, color: '#6366F1', icon: FileText },
    { label: 'Screened', value: 156, color: '#8B5CF6', icon: Eye },
    { label: 'Interviewed', value: 89, color: '#EC4899', icon: MessageSquare },
    { label: 'Offered', value: 34, color: '#F59E0B', icon: Mail },
    { label: 'Joined', value: 23, color: '#10B981', icon: CheckCircle2 },
  ];
  const funnelData = data || defaultData;
  const maxValue = Math.max(...funnelData.map(d => d.value));

  return (
    <div className="bg-white/60 backdrop-blur-sm rounded-2xl p-4 border border-white/60 shadow-lg">
      <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
        <Target className="h-4 w-4 text-amber-500" />
        Hiring Funnel
      </h3>
      <div className="space-y-3">
        {funnelData.map((item, i) => (
          <FunnelBar key={i} label={item.label} value={item.value} max={maxValue} color={item.color} icon={item.icon} />
        ))}
      </div>
    </div>
  );
}

// Performance Gauges Widget
export function PerformanceGauges({ metrics }: { metrics?: { label: string; value: number; color: string }[] }) {
  const defaultMetrics = [
    { label: 'Goals Met', value: 87, color: '#10B981' },
    { label: 'Attendance', value: 92, color: '#6366F1' },
    { label: 'Training', value: 78, color: '#F59E0B' },
  ];
  const gaugeMetrics = metrics || defaultMetrics;

  return (
    <div className="bg-white/60 backdrop-blur-sm rounded-2xl p-4 border border-white/60 shadow-lg">
      <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
        <Zap className="h-4 w-4 text-amber-500" />
        Performance
      </h3>
      <div className="space-y-3">
        {gaugeMetrics.map((metric, i) => (
          <div key={i} className="flex items-center justify-between">
            <span className="text-xs text-gray-600">{metric.label}</span>
            <Gauge value={metric.value} color={metric.color} />
          </div>
        ))}
      </div>
    </div>
  );
}

// Leave Balance Widget
export function LeaveBalanceWidget({ leaves }: { leaves?: { type: string; available: number; total: number; color: string }[] }) {
  const defaultLeaves = [
    { type: 'Casual', available: 5, total: 12, color: '#EF4444' },
    { type: 'Sick', available: 3, total: 6, color: '#F59E0B' },
    { type: 'Earned', available: 12, total: 15, color: '#10B981' },
  ];
  const leaveData = leaves || defaultLeaves;

  return (
    <div className="bg-white/60 backdrop-blur-sm rounded-2xl p-4 border border-white/60 shadow-lg">
      <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
        <Calendar className="h-4 w-4 text-indigo-500" />
        Leave Balance
      </h3>
      <div className="space-y-3">
        {leaveData.map((leave, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="relative">
              <DonutChart value={leave.available} max={leave.total} color={leave.color} size={44} />
              <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-gray-700">
                {leave.available}
              </span>
            </div>
            <div className="flex-1">
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium text-gray-700">{leave.type}</span>
                <span className="text-gray-500">{leave.available}/{leave.total}</span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000"
                  style={{ width: `${(leave.available / leave.total) * 100}%`, backgroundColor: leave.color }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Department Pie Chart Widget
export function DepartmentPieChart({ departments }: { departments?: { name: string; percentage: number; color: string }[] }) {
  const defaultDepts = [
    { name: 'Engineering', percentage: 35, color: '#6366F1' },
    { name: 'Operations', percentage: 25, color: '#10B981' },
    { name: 'Sales', percentage: 22, color: '#F59E0B' },
    { name: 'HR', percentage: 18, color: '#EC4899' },
  ];
  const deptData = departments || defaultDepts;

  let offset = 0;
  const segments = deptData.map(d => {
    const segment = { ...d, offset };
    offset += d.percentage;
    return segment;
  });

  return (
    <div className="bg-white/60 backdrop-blur-sm rounded-2xl p-4 border border-white/60 shadow-lg">
      <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
        <PieChart className="h-4 w-4 text-indigo-500" />
        By Department
      </h3>
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
          {segments.map((seg, i) => (
            <circle
              key={i}
              cx="18" cy="18" r="14" fill="none"
              stroke={seg.color} strokeWidth="5"
              strokeDasharray={`${seg.percentage * 0.88} 88`}
              strokeDashoffset={-seg.offset * 0.88}
              className="drop-shadow-sm"
            />
          ))}
        </svg>
        <div className="space-y-1 text-xs">
          {deptData.map((dept, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: dept.color }} />
              {dept.name} {dept.percentage}%
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Employee Growth Chart Widget
export function EmployeeGrowthChart({ data, yoyGrowth }: { data?: number[]; yoyGrowth?: string }) {
  const defaultData = [120, 180, 280, 420, 580, 720, 850, 980, 1100, 1180, 1247];
  const growthData = data || defaultData;

  return (
    <div className="bg-white/60 backdrop-blur-sm rounded-2xl p-4 border border-white/60 shadow-lg">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-indigo-500" />
          Employee Growth
        </h3>
        {yoyGrowth && <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">{yoyGrowth}</Badge>}
      </div>
      <AreaChart data={growthData} color="#6366F1" height={60} />
      <div className="flex justify-between text-[10px] text-gray-400 mt-2">
        <span>Jan</span><span>Apr</span><span>Jul</span><span>Oct</span><span>Dec</span>
      </div>
    </div>
  );
}

// Team Members Widget
export function TeamMembersWidget({ members }: { members?: { name: string; role: string; dept: string; color: string; status: 'online' | 'away' | 'offline' }[] }) {
  const defaultMembers = [
    { name: 'Rajesh Kumar', role: 'Senior Developer', dept: 'Engineering', color: 'from-blue-500 to-indigo-600', status: 'online' as const },
    { name: 'Priya Sharma', role: 'HR Manager', dept: 'Human Resources', color: 'from-purple-500 to-pink-600', status: 'online' as const },
    { name: 'Amit Patel', role: 'QA Lead', dept: 'Quality', color: 'from-emerald-500 to-teal-600', status: 'away' as const },
    { name: 'Sneha Reddy', role: 'Product Manager', dept: 'Product', color: 'from-amber-500 to-orange-600', status: 'online' as const },
    { name: 'Vikram Mehta', role: 'DevOps Engineer', dept: 'Engineering', color: 'from-cyan-500 to-blue-600', status: 'offline' as const },
    { name: 'Neha Gupta', role: 'UI Designer', dept: 'Product', color: 'from-rose-500 to-pink-600', status: 'online' as const },
  ];
  const teamMembers = members || defaultMembers;

  return (
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
        {teamMembers.map((emp, i) => (
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
          </div>
        ))}
      </div>
    </div>
  );
}

// Quick Stats Row
export function QuickStatsRow({ stats }: { stats?: { icon: React.ElementType; label: string; value: string; sub: string; color: string; bg: string }[] }) {
  const defaultStats = [
    { icon: Users, label: 'New Joins', value: '8', sub: 'this month', color: '#10B981', bg: 'from-emerald-500/10 to-teal-500/5' },
    { icon: Calendar, label: 'Birthdays', value: '3', sub: 'this week', color: '#EC4899', bg: 'from-pink-500/10 to-rose-500/5' },
    { icon: Target, label: 'Goals Met', value: '87%', sub: 'Q3 target', color: '#6366F1', bg: 'from-indigo-500/10 to-purple-500/5' },
    { icon: Clock, label: 'Avg Tenure', value: '2.4y', sub: 'company', color: '#F59E0B', bg: 'from-amber-500/10 to-orange-500/5' },
  ];
  const quickStats = stats || defaultStats;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
  );
}
