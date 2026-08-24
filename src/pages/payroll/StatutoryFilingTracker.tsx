import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card, CardHeader, CardTitle, CardContent,
} from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertTriangle, CheckCircle2, Clock, RefreshCw, Plus, FileText,
  ShieldCheck, Building2, TrendingUp, Landmark, Banknote,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
interface FilingRecord {
  id: string;
  filing_month: string;
  filing_type: "EPF" | "ESIC" | "PT" | "TDS_24Q" | "LWF";
  state_code: string | null;
  due_date: string;
  amount_due: number | null;
  challan_number: string | null;
  challan_date: string | null;
  filed_at: string | null;
  filed_by: string | null;
  remarks: string | null;
  status: "pending" | "filed" | "overdue";
}

// ─────────────────────────────────────────────────────────────
// Helpers (preserved exactly)
// ─────────────────────────────────────────────────────────────
const TYPE_LABELS: Record<string, string> = {
  EPF: "EPF / PF",
  ESIC: "ESIC",
  PT: "Professional Tax",
  TDS_24Q: "TDS (Form 24Q)",
  LWF: "Labour Welfare Fund",
};

const STATUS_COLORS: Record<string, string> = {
  filed:   "bg-green-100 text-green-800 border-green-200",
  pending: "bg-amber-100 text-amber-800 border-amber-200",
  overdue: "bg-red-100 text-red-800 border-red-200",
};

function daysFromToday(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due   = new Date(dateStr); due.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

function DueDateChip({ dueDate, status }: { dueDate: string; status: string }) {
  if (status === "filed") return <span className="text-green-600 text-xs font-medium">Filed</span>;
  const days = daysFromToday(dueDate);
  if (days < 0) return <span className="text-red-600 text-xs font-semibold">{Math.abs(days)}d overdue</span>;
  if (days === 0) return <span className="text-red-600 text-xs font-semibold">Due today!</span>;
  if (days <= 3)  return <span className="text-amber-600 text-xs font-medium">Due in {days}d</span>;
  return <span className="text-slate-500 text-xs">{days}d left</span>;
}

function fmtAmt(v: number | null) {
  if (v == null) return "—";
  return `₹${(v / 100000).toFixed(2)}L`;
}

// ─────────────────────────────────────────────────────────────
// Visual config per filing type
// ─────────────────────────────────────────────────────────────
interface TypeVisual {
  iconEl: React.ReactNode;
  iconBg: string;
}

const TYPE_VISUAL: Record<string, TypeVisual> = {
  EPF: {
    iconEl: <ShieldCheck className="w-4 h-4 text-blue-600" />,
    iconBg: "bg-blue-50",
  },
  ESIC: {
    iconEl: <Building2 className="w-4 h-4 text-violet-600" />,
    iconBg: "bg-violet-50",
  },
  PT: {
    iconEl: <Landmark className="w-4 h-4 text-amber-600" />,
    iconBg: "bg-amber-50",
  },
  TDS_24Q: {
    iconEl: <TrendingUp className="w-4 h-4 text-indigo-600" />,
    iconBg: "bg-indigo-50",
  },
  LWF: {
    iconEl: <Banknote className="w-4 h-4 text-teal-600" />,
    iconBg: "bg-teal-50",
  },
};

const TYPE_ORDER = ["EPF", "ESIC", "PT", "TDS_24Q", "LWF"] as const;

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
export default function StatutoryFilingTracker() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const [month, setMonth] = useState(defaultMonth);
  const [markDialogId, setMarkDialogId] = useState<string | null>(null);
  const [challanNo, setChallanNo] = useState("");
  const [challanDate, setChallanDate] = useState("");
  const [remarksTxt, setRemarksTxt] = useState("");
  const [amountFiled, setAmountFiled] = useState("");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["statutory-filing", month],
    queryFn: () => hrmsApi.get<{ success: boolean; data: FilingRecord[] }>(
      `/api/payroll/statutory-filing?month=${month}`
    ),
  });

  const { data: overdueData } = useQuery({
    queryKey: ["statutory-filing-overdue"],
    queryFn: () => hrmsApi.get<{ success: boolean; data: FilingRecord[] }>(
      "/api/payroll/statutory-filing/overdue"
    ),
  });

  const initMut = useMutation({
    mutationFn: () => hrmsApi.post(`/api/payroll/statutory-filing/initialize/${month}`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["statutory-filing"] }); toast({ title: "Obligations initialized" }); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const markFiledMut = useMutation({
    mutationFn: (id: string) => hrmsApi.patch(`/api/payroll/statutory-filing/${id}/mark-filed`, {
      challan_number: challanNo,
      challan_date: challanDate || undefined,
      remarks: remarksTxt || undefined,
      amount_due: amountFiled ? Number(amountFiled) : undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["statutory-filing"] });
      qc.invalidateQueries({ queryKey: ["statutory-filing-overdue"] });
      toast({ title: "Marked as filed" });
      setMarkDialogId(null); setChallanNo(""); setChallanDate(""); setRemarksTxt(""); setAmountFiled("");
    },
    onError: () => toast({ title: "Error marking as filed", variant: "destructive" }),
  });

  // ── Derived state ──
  const records: FilingRecord[] = data?.data ?? [];
  const overdueCount = overdueData?.data?.length ?? 0;

  const filedCount     = records.filter(r => r.status === "filed").length;
  const pendingCount   = records.filter(r => r.status === "pending").length;
  const overdueInMonth = records.filter(r => r.status === "overdue").length;
  const totalCount     = records.length;
  const healthScore    = totalCount > 0 ? Math.round((filedCount / totalCount) * 100) : 0;

  const openRecord = markDialogId ? records.find(r => r.id === markDialogId) : null;

  // Group table rows: filed → pending → overdue
  const sortedRecords = [
    ...records.filter(r => r.status === "filed"),
    ...records.filter(r => r.status === "pending"),
    ...records.filter(r => r.status === "overdue"),
  ];

  // Index records by type for bento cards
  const recordByType: Partial<Record<string, FilingRecord>> = {};
  for (const r of records) recordByType[r.filing_type] = r;

  // Health badge styling
  const healthBadgeCls =
    healthScore >= 90
      ? "bg-emerald-500/20 border-emerald-400/40 text-emerald-100"
      : healthScore >= 60
      ? "bg-amber-500/20 border-amber-400/40 text-amber-100"
      : "bg-red-500/20 border-red-400/40 text-red-100";

  // ── Render ──
  return (
    <TooltipProvider>
      <DashboardLayout>
        <div className="p-6 max-w-6xl mx-auto space-y-5">

          {/* ═══════════════════════════════════════════════════════
              GRADIENT HEADER BANNER
          ═══════════════════════════════════════════════════════ */}
          <div className="rounded-2xl bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-600 text-white p-6 shadow-lg">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">

              {/* Title block */}
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold tracking-tight leading-tight">
                    Statutory Compliance Dashboard
                  </h1>
                  <p className="text-violet-200 text-sm mt-0.5">
                    EPF · ESIC · Prof. Tax · TDS 24Q · LWF — unified filing control centre
                  </p>
                </div>
              </div>

              {/* Controls */}
              <div className="flex flex-wrap items-center gap-2">
                {totalCount > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold border cursor-default ${healthBadgeCls}`}>
                        <CheckCircle2 className="w-4 h-4" />
                        {healthScore}% Compliant
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p>{filedCount} of {totalCount} obligations filed this month</p>
                    </TooltipContent>
                  </Tooltip>
                )}

                <Input
                  type="month"
                  value={month}
                  onChange={e => setMonth(e.target.value)}
                  className="w-40 bg-white/10 border-white/30 text-white [color-scheme:dark] focus-visible:ring-white/40"
                />

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetch()}
                  className="bg-white/10 border-white/30 text-white hover:bg-white/20 hover:text-white"
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>

                <Button
                  size="sm"
                  onClick={() => initMut.mutate()}
                  disabled={initMut.isPending}
                  className="bg-white text-violet-700 hover:bg-violet-50 font-semibold shadow-sm"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Initialize Month
                </Button>
              </div>
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════
              OVERDUE PENALTY ALERT
          ═══════════════════════════════════════════════════════ */}
          {overdueCount > 0 && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 shadow-sm transition-all duration-200">
              <div className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="text-red-800 font-semibold text-sm">
                  {overdueCount} overdue filing{overdueCount > 1 ? "s" : ""} detected across all months — immediate action required
                </p>
                <p className="text-red-600 text-xs mt-1 leading-relaxed">
                  Penalty risk active. Late deposits attract interest at 12% p.a. (EPF / ESIC) and prosecution under respective Acts.
                  Each overdue day increases liability — resolve before the next audit cycle.
                </p>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════
              KPI OVERVIEW STRIP
          ═══════════════════════════════════════════════════════ */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

            <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50 p-5 shadow-sm transition-all duration-200 hover:shadow-md">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide">Filed</p>
                  <p className="text-4xl font-bold text-emerald-700 mt-1 leading-none">{filedCount}</p>
                  <p className="text-xs text-emerald-500 mt-2">obligations completed · {month}</p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-5 shadow-sm transition-all duration-200 hover:shadow-md">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide">Pending</p>
                  <p className="text-4xl font-bold text-amber-700 mt-1 leading-none">{pendingCount}</p>
                  <p className="text-xs text-amber-500 mt-2">awaiting submission · {month}</p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center">
                  <Clock className="w-6 h-6 text-amber-600" />
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-red-200 bg-gradient-to-br from-red-50 to-rose-50 p-5 shadow-sm transition-all duration-200 hover:shadow-md">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-red-600 uppercase tracking-wide">Overdue</p>
                  <p className="text-4xl font-bold text-red-700 mt-1 leading-none">{overdueCount}</p>
                  <p className="text-xs text-red-500 mt-2">across all months · needs action</p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center">
                  <AlertTriangle className="w-6 h-6 text-red-600" />
                </div>
              </div>
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════
              FILING TYPE HEALTH CARDS — BENTO GRID
          ═══════════════════════════════════════════════════════ */}
          {(records.length > 0 || isLoading) && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                Filing Type Status — {month}
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                {TYPE_ORDER.map(type => {
                  const rec = recordByType[type];
                  const vis = TYPE_VISUAL[type];

                  if (!rec) {
                    return (
                      <div
                        key={type}
                        className="rounded-2xl border border-slate-100 bg-white/80 p-4 flex flex-col gap-2 opacity-50 select-none"
                      >
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${vis.iconBg}`}>
                          {vis.iconEl}
                        </div>
                        <p className="text-xs font-bold text-slate-500 leading-tight">{TYPE_LABELS[type]}</p>
                        <p className="text-xs text-slate-400">Not initialized</p>
                      </div>
                    );
                  }

                  const cardBorder =
                    rec.status === "overdue"
                      ? "border-red-300 bg-red-50/30"
                      : rec.status === "filed"
                      ? "border-emerald-200"
                      : "border-slate-200";

                  const statusDot =
                    rec.status === "filed"
                      ? "bg-emerald-400"
                      : rec.status === "overdue"
                      ? "bg-red-500 animate-pulse"
                      : "bg-amber-400 animate-pulse";

                  return (
                    <div
                      key={type}
                      className={`rounded-2xl border bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-all duration-200 hover:scale-[1.01] p-4 flex flex-col gap-2 ${cardBorder}`}
                    >
                      {/* Icon + status dot */}
                      <div className="flex items-center justify-between">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${vis.iconBg}`}>
                          {vis.iconEl}
                        </div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className={`w-2.5 h-2.5 rounded-full cursor-default ${statusDot}`} />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="capitalize">{rec.status}</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>

                      {/* Label */}
                      <div>
                        <p className="text-xs font-bold text-slate-800 leading-tight">{TYPE_LABELS[type]}</p>
                        {rec.state_code && (
                          <p className="text-xs text-slate-400 mt-0.5">{rec.state_code}</p>
                        )}
                      </div>

                      {/* Status badge */}
                      <span className={`self-start inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full border ${STATUS_COLORS[rec.status]}`}>
                        {rec.status === "filed"   && <CheckCircle2 className="w-3 h-3" />}
                        {rec.status === "overdue" && <AlertTriangle className="w-3 h-3" />}
                        {rec.status === "pending" && <Clock className="w-3 h-3" />}
                        <span className="capitalize">{rec.status}</span>
                      </span>

                      {/* Due date + amount */}
                      <div className="space-y-0.5">
                        <DueDateChip dueDate={rec.due_date} status={rec.status} />
                        <p className="font-mono text-xs font-semibold text-slate-600">{fmtAmt(rec.amount_due)}</p>
                      </div>

                      {/* Challan if filed */}
                      {rec.status === "filed" && rec.challan_number && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <p className="text-xs font-mono text-emerald-600 truncate cursor-default">
                              #{rec.challan_number}
                            </p>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Challan: {rec.challan_number}</p>
                          </TooltipContent>
                        </Tooltip>
                      )}

                      {/* Mark Filed CTA */}
                      {rec.status !== "filed" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className={`mt-auto text-xs h-7 transition-all duration-150 ${
                            rec.status === "overdue"
                              ? "border-red-200 text-red-700 hover:bg-red-50"
                              : "border-violet-200 text-violet-700 hover:bg-violet-50"
                          }`}
                          onClick={() => {
                            setMarkDialogId(rec.id);
                            setAmountFiled(rec.amount_due != null ? String(rec.amount_due) : "");
                          }}
                        >
                          <FileText className="w-3 h-3 mr-1" />
                          Mark Filed
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════
              FILING TIMELINE TABLE
          ═══════════════════════════════════════════════════════ */}
          <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-all duration-200">

            <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-slate-100">
              <div>
                <h2 className="text-sm font-bold text-slate-800">Filing Obligations Register</h2>
                <p className="text-xs text-slate-500 mt-0.5">{month} — sorted by completion status</p>
              </div>
              {records.length > 0 && (
                <span className="text-xs font-semibold text-slate-400 tabular-nums">
                  {records.length} obligation{records.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>

            {isLoading ? (
              <div className="p-12 text-center text-slate-400">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-violet-400" />
                <p className="text-sm">Loading obligations…</p>
              </div>
            ) : records.length === 0 ? (
              <div className="p-12 text-center text-slate-400">
                <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center mx-auto mb-3">
                  <FileText className="w-6 h-6 text-slate-300" />
                </div>
                <p className="text-sm font-semibold text-slate-500">No obligations for {month}</p>
                <p className="text-xs text-slate-400 mt-1 mb-3">Initialize this month to create filing records</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => initMut.mutate()}
                  disabled={initMut.isPending}
                  className="border-violet-200 text-violet-700 hover:bg-violet-50"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Initialize {month}
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50/80">
                    <tr>
                      {["Type", "Due Date", "Amount Due", "Status", "Challan No.", "Filed On", "Action"].map(h => (
                        <th
                          key={h}
                          className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sortedRecords.map(r => {
                      const vis = TYPE_VISUAL[r.filing_type];

                      const rowAccent =
                        r.status === "overdue"
                          ? "border-l-4 border-l-red-400 bg-red-50/30"
                          : r.status === "filed"
                          ? "border-l-4 border-l-emerald-400"
                          : "border-l-4 border-l-transparent";

                      return (
                        <tr
                          key={r.id}
                          className={`hover:bg-slate-50/60 transition-colors duration-150 ${rowAccent}`}
                        >
                          {/* Type */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className={`w-7 h-7 rounded-md flex items-center justify-center ${vis?.iconBg ?? "bg-slate-50"}`}>
                                {vis?.iconEl}
                              </div>
                              <div>
                                <p className="font-semibold text-slate-800 text-xs leading-tight">
                                  {TYPE_LABELS[r.filing_type] ?? r.filing_type}
                                </p>
                                {r.state_code && (
                                  <p className="text-xs text-slate-400">{r.state_code}</p>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Due date */}
                          <td className="px-4 py-3">
                            <p className="text-xs text-slate-600 font-medium">
                              {new Date(r.due_date).toLocaleDateString("en-IN", {
                                day: "numeric", month: "short", year: "numeric",
                              })}
                            </p>
                            <DueDateChip dueDate={r.due_date} status={r.status} />
                          </td>

                          {/* Amount */}
                          <td className="px-4 py-3">
                            <span className="font-mono text-xs font-semibold text-slate-700">
                              {fmtAmt(r.amount_due)}
                            </span>
                          </td>

                          {/* Status */}
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full border ${STATUS_COLORS[r.status]}`}>
                              {r.status === "filed"   && <CheckCircle2 className="w-3 h-3" />}
                              {r.status === "overdue" && <AlertTriangle className="w-3 h-3" />}
                              {r.status === "pending" && <Clock className="w-3 h-3" />}
                              <span className="capitalize">{r.status}</span>
                            </span>
                          </td>

                          {/* Challan */}
                          <td className="px-4 py-3">
                            {r.challan_number ? (
                              <span className="font-mono text-xs text-slate-700 bg-slate-100 rounded px-1.5 py-0.5">
                                {r.challan_number}
                              </span>
                            ) : (
                              <span className="text-slate-300 text-xs">—</span>
                            )}
                          </td>

                          {/* Filed on */}
                          <td className="px-4 py-3">
                            {r.filed_at ? (
                              <div>
                                <p className="text-xs text-slate-600 font-medium">
                                  {new Date(r.filed_at).toLocaleDateString("en-IN")}
                                </p>
                                {r.filed_by && (
                                  <p className="text-xs text-slate-400 truncate max-w-28">{r.filed_by}</p>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-300 text-xs">—</span>
                            )}
                          </td>

                          {/* Action */}
                          <td className="px-4 py-3">
                            {r.status !== "filed" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className={`text-xs h-7 transition-all duration-150 ${
                                  r.status === "overdue"
                                    ? "border-red-200 text-red-700 hover:bg-red-50"
                                    : "border-violet-200 text-violet-700 hover:bg-violet-50"
                                }`}
                                onClick={() => {
                                  setMarkDialogId(r.id);
                                  setAmountFiled(r.amount_due != null ? String(r.amount_due) : "");
                                }}
                              >
                                <FileText className="w-3 h-3 mr-1" />
                                Mark Filed
                              </Button>
                            ) : (
                              r.remarks && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="text-xs text-slate-400 italic cursor-help block truncate max-w-28">
                                      {r.remarks}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="left">
                                    <p className="max-w-xs break-words">{r.remarks}</p>
                                  </TooltipContent>
                                </Tooltip>
                              )
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════
            MARK AS FILED DIALOG (logic preserved, visuals enhanced)
        ═══════════════════════════════════════════════════════ */}
        <Dialog open={!!markDialogId} onOpenChange={open => !open && setMarkDialogId(null)}>
          <DialogContent className="max-w-lg p-0 overflow-hidden gap-0">

            {/* Gradient dialog header */}
            <div className="bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-600 px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-white font-bold text-base leading-tight">Mark as Filed</h3>
                  <p className="text-violet-200 text-xs mt-0.5">
                    {openRecord ? TYPE_LABELS[openRecord.filing_type] : ""} — {month}
                  </p>
                </div>
              </div>
            </div>

            {/* Form body */}
            <div className="px-6 py-5 space-y-4 bg-white">

              <div>
                <Label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                  Challan Number{" "}
                  <span className="text-red-500 normal-case font-normal tracking-normal">required</span>
                </Label>
                <div className="relative mt-1.5">
                  <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <Input
                    value={challanNo}
                    onChange={e => setChallanNo(e.target.value)}
                    placeholder="Challan / acknowledgement number"
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Challan Date</Label>
                  <Input
                    type="date"
                    value={challanDate}
                    onChange={e => setChallanDate(e.target.value)}
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Amount Paid (₹)</Label>
                  <Input
                    type="number"
                    value={amountFiled}
                    onChange={e => setAmountFiled(e.target.value)}
                    placeholder="e.g. 125000"
                    className="mt-1.5"
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Remarks</Label>
                <Textarea
                  value={remarksTxt}
                  onChange={e => setRemarksTxt(e.target.value)}
                  rows={2}
                  placeholder="Optional notes about this filing…"
                  className="mt-1.5 resize-none"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setMarkDialogId(null)}
                className="border-slate-200"
              >
                Cancel
              </Button>
              <Button
                onClick={() => markDialogId && markFiledMut.mutate(markDialogId)}
                disabled={!challanNo.trim() || markFiledMut.isPending}
                className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:opacity-90 shadow-sm"
              >
                <CheckCircle2 className="w-4 h-4 mr-1.5" />
                {markFiledMut.isPending ? "Saving…" : "Mark as Filed"}
              </Button>
            </div>

          </DialogContent>
        </Dialog>

      </DashboardLayout>
    </TooltipProvider>
  );
}
