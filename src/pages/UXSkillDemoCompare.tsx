import { Badge } from '@/components/ui/badge';
import { Calendar, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

// ════════════════════════════════════════════════════════════════════════════
// VERSION 3: Old Heatmap (Green Intensity Only)
// ════════════════════════════════════════════════════════════════════════════

function V3HeatmapRow({ data, label }: { data: number[]; label: string }) {
  const max = Math.max(...data);
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-gray-500 w-8 font-medium">{label}</span>
      <div className="flex gap-1">
        {data.map((v, i) => (
          <div
            key={i}
            className="w-5 h-5 rounded transition-all hover:scale-110"
            style={{ backgroundColor: v === 0 ? '#f3f4f6' : `rgba(16, 185, 129, ${0.15 + (v / max) * 0.85})` }}
            title={`Hours: ${v}`}
          />
        ))}
      </div>
    </div>
  );
}

function V3Heatmap() {
  const data = [
    { day: 'Mon', data: [8, 7, 9, 8, 6, 8, 7] },
    { day: 'Tue', data: [9, 8, 8, 7, 8, 9, 8] },
    { day: 'Wed', data: [7, 9, 8, 9, 7, 8, 9] },
    { day: 'Thu', data: [8, 8, 7, 8, 9, 7, 8] },
    { day: 'Fri', data: [6, 7, 8, 7, 8, 6, 7] },
  ];

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-5 border border-gray-200 shadow-lg">
      <div className="flex items-center gap-2 mb-4">
        <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-300">v3</Badge>
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <Calendar className="h-4 w-4 text-emerald-500" />
          Weekly Attendance
        </h3>
      </div>
      <div className="space-y-2">
        {data.map((row, i) => <V3HeatmapRow key={i} data={row.data} label={row.day} />)}
      </div>
      <div className="flex items-center justify-between mt-4 text-[10px] text-gray-400 pt-3 border-t border-gray-100">
        <span>Low hours</span>
        <div className="flex gap-1">
          {[0.15, 0.35, 0.55, 0.75, 0.95].map((o, i) => (
            <div key={i} className="w-4 h-4 rounded" style={{ backgroundColor: `rgba(16, 185, 129, ${o})` }} />
          ))}
        </div>
        <span>High hours</span>
      </div>
      <div className="mt-4 p-3 bg-amber-50 rounded-lg border border-amber-200">
        <p className="text-xs text-amber-800 font-medium mb-1">⚠️ Limitations:</p>
        <ul className="text-[10px] text-amber-700 space-y-0.5 list-disc list-inside">
          <li>Only shows intensity (green shades)</li>
          <li>Can't distinguish absent vs half-day vs leave</li>
          <li>No holidays or week-offs visible</li>
          <li>Weekends not shown</li>
        </ul>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// VERSION 4: New Heatmap (Status-based Color Coding)
// ════════════════════════════════════════════════════════════════════════════

type AttendanceStatus = 'P' | 'A' | 'H' | 'L' | 'WO' | 'HO';
const statusColors: Record<AttendanceStatus, { bg: string; border: string; label: string; emoji: string }> = {
  'P': { bg: '#10B981', border: '#059669', label: 'Present', emoji: '✓' },
  'A': { bg: '#EF4444', border: '#DC2626', label: 'Absent', emoji: '✗' },
  'H': { bg: '#F59E0B', border: '#D97706', label: 'Half-day', emoji: '½' },
  'L': { bg: '#8B5CF6', border: '#7C3AED', label: 'Leave', emoji: '📋' },
  'WO': { bg: '#94A3B8', border: '#64748B', label: 'Week-off', emoji: '🏠' },
  'HO': { bg: '#3B82F6', border: '#2563EB', label: 'Holiday', emoji: '🎉' },
};

function V4HeatmapRow({ data, label }: { data: AttendanceStatus[]; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-gray-500 w-8 font-medium">{label}</span>
      <div className="flex gap-1">
        {data.map((status, i) => {
          const color = statusColors[status];
          return (
            <div
              key={i}
              className="w-5 h-5 rounded transition-all hover:scale-125 cursor-pointer shadow-sm flex items-center justify-center"
              style={{ backgroundColor: color.bg, border: `1.5px solid ${color.border}` }}
              title={color.label}
            >
              <span className="text-[8px] text-white font-bold">{status}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function V4Heatmap() {
  const data: { day: string; data: AttendanceStatus[] }[] = [
    { day: 'Mon', data: ['P', 'P', 'P', 'H', 'P', 'P', 'P'] },
    { day: 'Tue', data: ['P', 'P', 'L', 'L', 'P', 'P', 'A'] },
    { day: 'Wed', data: ['P', 'H', 'P', 'P', 'P', 'P', 'P'] },
    { day: 'Thu', data: ['P', 'P', 'P', 'P', 'HO', 'HO', 'HO'] },
    { day: 'Fri', data: ['P', 'P', 'P', 'P', 'P', 'P', 'P'] },
    { day: 'Sat', data: ['WO', 'WO', 'WO', 'WO', 'WO', 'WO', 'WO'] },
    { day: 'Sun', data: ['WO', 'WO', 'WO', 'WO', 'WO', 'WO', 'WO'] },
  ];

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-5 border border-emerald-200 shadow-lg ring-2 ring-emerald-500/20">
      <div className="flex items-center gap-2 mb-4">
        <Badge className="bg-emerald-500 text-white">v4</Badge>
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <Calendar className="h-4 w-4 text-emerald-500" />
          Weekly Attendance
        </h3>
        <Badge variant="outline" className="ml-auto text-[9px] bg-emerald-50 text-emerald-700 border-emerald-300">
          Guideline #118
        </Badge>
      </div>
      <div className="space-y-2">
        {data.map((row, i) => <V4HeatmapRow key={i} data={row.data} label={row.day} />)}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-4 pt-3 border-t border-gray-100">
        {Object.entries(statusColors).map(([key, val]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded shadow-sm flex items-center justify-center" style={{ backgroundColor: val.bg, border: `1px solid ${val.border}` }}>
              <span className="text-[7px] text-white font-bold">{key}</span>
            </div>
            <span className="text-[10px] text-gray-600">{val.label}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 p-3 bg-emerald-50 rounded-lg border border-emerald-200">
        <p className="text-xs text-emerald-800 font-medium mb-1">✅ Improvements:</p>
        <ul className="text-[10px] text-emerald-700 space-y-0.5 list-disc list-inside">
          <li>6 distinct status colors</li>
          <li>Clear distinction: Present/Absent/Half-day/Leave</li>
          <li>Holidays (blue) and Week-offs (gray) visible</li>
          <li>Full 7-day week including weekends</li>
          <li>Status code labels inside cells</li>
          <li>Comprehensive legend</li>
        </ul>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN COMPARISON PAGE
// ════════════════════════════════════════════════════════════════════════════

export default function UXSkillDemoCompare() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Ambient Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-20 left-20 w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-20 w-[500px] h-[500px] bg-purple-500/15 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
      </div>

      {/* Header */}
      <div className="relative border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(16,185,129,0.15),transparent_60%)]" />
        <div className="relative max-w-5xl mx-auto px-6 py-10 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 mb-5">
            <Sparkles className="h-4 w-4 text-emerald-400" />
            <span className="text-sm text-emerald-300 font-medium">Version Comparison</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Attendance Heatmap: <span className="bg-gradient-to-r from-amber-400 to-emerald-400 bg-clip-text text-transparent">v3 vs v4</span>
          </h1>
          <p className="text-base text-slate-400 max-w-2xl mx-auto">
            See how the attendance heatmap evolved from simple intensity-based coloring to a comprehensive status-based color coding system following <strong className="text-white">HRMS Guideline #118</strong>.
          </p>
        </div>
      </div>

      {/* Comparison Grid */}
      <div className="relative max-w-5xl mx-auto px-6 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* V3 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-amber-500/20 text-amber-300 border-amber-500/30">Version 3</Badge>
              <span className="text-sm text-slate-400">Intensity-based (Green only)</span>
            </div>
            <V3Heatmap />
          </div>

          {/* V4 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge className="bg-emerald-500 text-white">Version 4</Badge>
              <span className="text-sm text-slate-400">Status-based (6 colors)</span>
            </div>
            <V4Heatmap />
          </div>
        </div>

        {/* Comparison Table */}
        <div className="mt-12 rounded-2xl bg-slate-800/50 border border-white/10 overflow-hidden">
          <div className="p-5 border-b border-white/10">
            <h2 className="text-lg font-semibold text-white">Feature Comparison</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-slate-800/50">
                <th className="text-left p-4 text-slate-400 font-medium">Feature</th>
                <th className="text-center p-4 text-amber-400 font-medium">v3 (Before)</th>
                <th className="text-center p-4 text-emerald-400 font-medium">v4 (After)</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              <tr className="border-b border-white/5">
                <td className="p-4">Color scheme</td>
                <td className="p-4 text-center">Green intensity only</td>
                <td className="p-4 text-center text-emerald-400">6 distinct colors</td>
              </tr>
              <tr className="border-b border-white/5">
                <td className="p-4">Status visibility</td>
                <td className="p-4 text-center">Hours worked</td>
                <td className="p-4 text-center text-emerald-400">P/A/H/L/WO/HO</td>
              </tr>
              <tr className="border-b border-white/5">
                <td className="p-4">Weekend display</td>
                <td className="p-4 text-center text-rose-400">❌ Not shown</td>
                <td className="p-4 text-center text-emerald-400">✅ Sat/Sun as Week-off</td>
              </tr>
              <tr className="border-b border-white/5">
                <td className="p-4">Holiday visibility</td>
                <td className="p-4 text-center text-rose-400">❌ Not distinguishable</td>
                <td className="p-4 text-center text-emerald-400">✅ Blue color</td>
              </tr>
              <tr className="border-b border-white/5">
                <td className="p-4">Leave tracking</td>
                <td className="p-4 text-center text-rose-400">❌ Not visible</td>
                <td className="p-4 text-center text-emerald-400">✅ Purple color</td>
              </tr>
              <tr className="border-b border-white/5">
                <td className="p-4">Half-day tracking</td>
                <td className="p-4 text-center text-rose-400">❌ Looks like low hours</td>
                <td className="p-4 text-center text-emerald-400">✅ Amber color</td>
              </tr>
              <tr className="border-b border-white/5">
                <td className="p-4">Absent visibility</td>
                <td className="p-4 text-center text-rose-400">❌ Gray (unclear)</td>
                <td className="p-4 text-center text-emerald-400">✅ Red (clear)</td>
              </tr>
              <tr className="border-b border-white/5">
                <td className="p-4">Legend</td>
                <td className="p-4 text-center">Low → High</td>
                <td className="p-4 text-center text-emerald-400">All 6 statuses</td>
              </tr>
              <tr>
                <td className="p-4">Cell labels</td>
                <td className="p-4 text-center text-rose-400">❌ No</td>
                <td className="p-4 text-center text-emerald-400">✅ Status codes</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Back Link */}
        <div className="mt-8 text-center">
          <a href="/ux-skill-demo" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm transition-colors">
            ← Back to Full Dashboard Demo
          </a>
        </div>
      </div>
    </div>
  );
}
