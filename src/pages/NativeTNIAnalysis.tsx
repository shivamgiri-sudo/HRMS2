/**
 * NativeTNIAnalysis — Training Need Identification
 *
 * Shows a heatmap of agent × parameter pass rates so QA managers can identify
 * exactly who needs coaching on exactly which of the 19 inbound quality parameters.
 *
 * API:
 *  GET /api/quality-dashboard/tni-analysis?from=&to=&client_id=
 *  GET /api/quality-dashboard/tni-agent-params?from=&to=&agent_code=&param=&client_id=
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users, AlertTriangle, Award, BarChart2, Download, RefreshCcw,
  X, ChevronDown, CheckCircle2, XCircle, BookOpen, GraduationCap,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

// ── Date helpers ───────────────────────────────────────────────────────────────

function today() { return new Date().toISOString().slice(0, 10); }
function firstOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PARAMS = [
  { key: "call_answered_within_5_seconds",      label: "Answered 5s" },
  { key: "customer_concern_acknowledged",        label: "Concern Ack" },
  { key: "professionalism_maintained",           label: "Professionalism" },
  { key: "assurance_or_appreciation_provided",   label: "Assurance" },
  { key: "pronunciation_and_clarity",            label: "Clarity" },
  { key: "enthusiasm_and_no_fumbling",           label: "Enthusiasm" },
  { key: "active_listening",                     label: "Active Listen" },
  { key: "politeness_and_no_sarcasm",            label: "Politeness" },
  { key: "proper_grammar",                       label: "Grammar" },
  { key: "accurate_issue_probing",               label: "Probing" },
  { key: "proper_hold_procedure",                label: "Hold Proc" },
  { key: "proper_transfer_and_language",         label: "Transfer" },
  { key: "dead_air_under_10_seconds",            label: "Dead Air" },
  { key: "case_escalated_correctly",             label: "Escalation" },
  { key: "address_recorded_completely",          label: "Address Rec" },
  { key: "correct_and_complete_information",     label: "Info Correct" },
  { key: "upselling_or_offers_suggested",        label: "Upsell" },
  { key: "further_assistance_offered",           label: "Further Assist" },
  { key: "proper_call_closure",                  label: "Call Closure" },
] as const;

type ParamKey = (typeof PARAMS)[number]["key"];

const TNI_THRESHOLD = 60;  // pass% below this = needs training
const AMBER_THRESHOLD = 80; // pass% 60–79 = amber

// ── Types ─────────────────────────────────────────────────────────────────────

interface TniAgentRow {
  agent_code: string;
  agent_name: string;
  audit_count: number;
  avg_cq_score: number;
  params: Record<ParamKey, number>;
  tni_flag_count: number;
}

interface TniSummary {
  total_agents: number;
  agents_with_tni: number;
  most_failed_param: string;
  most_failed_param_pass_pct: number;
  avg_cq_score: number;
}

interface TniCallRecord {
  lead_id: string;
  call_date: string;
  cq_score: number;
  param_pass: 0 | 1;
  scenario: string;
  client: string;
}

interface SidePanelState {
  agentCode: string;
  agentName: string;
  param: ParamKey;
  paramLabel: string;
}

// ── Cell color helper ─────────────────────────────────────────────────────────

function cellClass(pct: number): string {
  if (pct >= AMBER_THRESHOLD) return "bg-emerald-50 text-emerald-700 font-medium";
  if (pct >= TNI_THRESHOLD)   return "bg-amber-50 text-amber-700 font-semibold";
  return "bg-red-100 text-red-700 font-bold cursor-pointer hover:bg-red-200 transition-colors";
}

function cellBg(pct: number): string {
  if (pct >= AMBER_THRESHOLD) return "bg-emerald-100 text-emerald-800";
  if (pct >= TNI_THRESHOLD)   return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
    </div>
  );
}

function StatCard({
  icon, label, value, sub, color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
}) {
  return (
    <Card className="border border-slate-100 shadow-sm">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
          </div>
          <div className={`rounded-xl p-2 ${color.replace("text-", "bg-").replace("700", "50")}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Side panel: per-agent per-param call records ──────────────────────────────

function SidePanel({
  panel, from, to, clientId, onClose,
}: {
  panel: SidePanelState;
  from: string;
  to: string;
  clientId: string;
  onClose: () => void;
}) {
  const qs = new URLSearchParams({
    from, to,
    agent_code: panel.agentCode,
    param: panel.param,
    ...(clientId && clientId !== "all" ? { client_id: clientId } : {}),
  }).toString();

  const { data, isLoading } = useQuery({
    queryKey: ["tni-agent-params", panel.agentCode, panel.param, from, to, clientId],
    queryFn: () =>
      hrmsApi.get<{ calls: TniCallRecord[] }>(`/api/quality-dashboard/tni-agent-params?${qs}`)
        .then((r) => r.calls ?? []),
  });

  const calls = data ?? [];
  const failCalls = calls.filter((c) => c.param_pass === 0);

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-[480px] bg-white shadow-2xl border-l border-slate-200 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50">
        <div>
          <p className="text-sm font-bold text-slate-800">{panel.agentName}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
              TNI: {panel.paramLabel}
            </span>
          </p>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-200 text-slate-500">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Summary strip */}
      {!isLoading && (
        <div className="flex items-center gap-4 px-5 py-3 bg-red-50 border-b border-red-100 text-xs font-semibold text-red-700">
          <span>{calls.length} total calls audited</span>
          <span>·</span>
          <span>{failCalls.length} fails ({calls.length > 0 ? Math.round(failCalls.length / calls.length * 100) : 0}% fail rate)</span>
        </div>
      )}

      {/* Call records */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {isLoading ? (
          <Spinner />
        ) : calls.length === 0 ? (
          <p className="text-center text-sm text-slate-400 py-10">No call records found for this range.</p>
        ) : (
          calls.map((c, i) => (
            <div
              key={c.lead_id || i}
              className={`rounded-xl border px-4 py-3 text-sm ${
                c.param_pass === 0
                  ? "border-red-200 bg-red-50"
                  : "border-emerald-100 bg-emerald-50"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-slate-700">{c.call_date}</span>
                <span className={`inline-flex items-center gap-1 text-xs font-bold rounded-full px-2 py-0.5 ${
                  c.param_pass === 1
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-red-100 text-red-700"
                }`}>
                  {c.param_pass === 1
                    ? <><CheckCircle2 className="h-3 w-3" /> Pass</>
                    : <><XCircle className="h-3 w-3" /> Fail</>}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500 gap-2 flex-wrap">
                <span>CQ: <strong className="text-slate-700">{c.cq_score}%</strong></span>
                <span>{c.scenario}</span>
                <span className="text-slate-400">{c.client}</span>
                {c.lead_id && <span className="font-mono text-slate-400 text-[10px]">{c.lead_id}</span>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NativeTNIAnalysis() {
  const [from, setFrom]       = useState(firstOfMonth());
  const [to, setTo]           = useState(today());
  const [clientId, setClientId] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sidePanel, setSidePanel] = useState<SidePanelState | null>(null);

  const qs = new URLSearchParams({
    from, to,
    ...(clientId !== "all" ? { client_id: clientId } : {}),
  }).toString();

  const tniQ = useQuery({
    queryKey: ["tni-analysis", from, to, clientId],
    queryFn: () =>
      hrmsApi.get<{ agents: TniAgentRow[]; summary: TniSummary }>(
        `/api/quality-dashboard/tni-analysis?${qs}`
      ),
  });

  const agents: TniAgentRow[] = tniQ.data?.agents ?? [];
  const summary: TniSummary | null = tniQ.data?.summary ?? null;

  // Param label lookup
  const paramLabelMap = useMemo(() => {
    const m: Record<string, string> = {};
    PARAMS.forEach((p) => { m[p.key] = p.label; });
    return m;
  }, []);

  const friendlyParamName = (key: string) =>
    key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  // Export CSV
  const exportCsv = useCallback(() => {
    if (!agents.length) return;
    const headers = [
      "Agent Code", "Agent Name", "Audit Count", "Avg CQ Score",
      "TNI Flag Count",
      ...PARAMS.map((p) => p.label),
    ];
    const rows = agents.map((a) => [
      a.agent_code, a.agent_name, a.audit_count, a.avg_cq_score, a.tni_flag_count,
      ...PARAMS.map((p) => a.params[p.key]),
    ]);
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tni_analysis_${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [agents, from, to]);

  // Multi-select
  const toggleSelect = (code: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  };
  const selectAll = () => setSelected(new Set(agents.map((a) => a.agent_code)));
  const clearAll  = () => setSelected(new Set());

  // Action handlers
  const handleSendToQA = () => {
    if (!selected.size) return;
    alert(`${selected.size} agent(s) flagged for QA coaching. (Integrate with coaching workflow)`);
  };

  const handleAssignLMS = () => {
    if (!selected.size) return;
    hrmsApi.post("/api/lms-integration/assign", {
      agent_codes: [...selected],
      reason: "TNI coaching assignment",
    }).then(() => {
      alert(`LMS module assigned to ${selected.size} agent(s).`);
    }).catch(() => {
      alert("LMS module assignment — coming soon or LMS endpoint not configured.");
    });
  };

  const openPanel = (a: TniAgentRow, paramKey: ParamKey) => {
    const paramInfo = PARAMS.find((p) => p.key === paramKey);
    setSidePanel({
      agentCode: a.agent_code,
      agentName: a.agent_name,
      param: paramKey,
      paramLabel: paramInfo?.label ?? paramKey,
    });
  };

  return (
    <DashboardLayout>
      {/* Page header */}
      <div className="px-6 pt-6 pb-4 border-b border-slate-100 bg-white">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-indigo-600" />
              Training Need Identification
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Identify which agents need coaching on which quality parameters
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => tniQ.refetch()} disabled={tniQ.isFetching}>
              <RefreshCcw className={`h-3.5 w-3.5 mr-1.5 ${tniQ.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Export CSV
            </Button>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">

        {/* ── Filters ─────────────────────────────────────────────────────── */}
        <Card className="border border-slate-100 shadow-sm">
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                  From
                </label>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                  To
                </label>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                  Client / Process
                </label>
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger className="w-48 h-9 text-sm border-slate-200">
                    <SelectValue placeholder="All Clients" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Clients</SelectItem>
                    {/* Client list can be loaded via /api/quality-dashboard/clients if needed */}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Summary cards ────────────────────────────────────────────────── */}
        {tniQ.isLoading ? (
          <Spinner />
        ) : tniQ.isError ? (
          <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            Could not load TNI data. Quality source may be temporarily unavailable.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                icon={<Users className="h-5 w-5 text-blue-600" />}
                label="Total Agents Audited"
                value={summary?.total_agents ?? 0}
                sub={`${from} → ${to}`}
                color="text-blue-700"
              />
              <StatCard
                icon={<AlertTriangle className="h-5 w-5 text-red-600" />}
                label="Agents with TNI"
                value={summary?.agents_with_tni ?? 0}
                sub={
                  summary && summary.total_agents > 0
                    ? `${Math.round((summary.agents_with_tni / summary.total_agents) * 100)}% of audited`
                    : "—"
                }
                color="text-red-700"
              />
              <StatCard
                icon={<BarChart2 className="h-5 w-5 text-amber-600" />}
                label="Most Failed Parameter"
                value={summary ? (paramLabelMap[summary.most_failed_param] ?? summary.most_failed_param) : "—"}
                sub={summary ? `${summary.most_failed_param_pass_pct}% avg pass rate` : ""}
                color="text-amber-700"
              />
              <StatCard
                icon={<Award className="h-5 w-5 text-emerald-600" />}
                label="Avg CQ Score"
                value={summary ? `${summary.avg_cq_score}%` : "—"}
                sub="across all agents in range"
                color="text-emerald-700"
              />
            </div>

            {/* ── Legend ──────────────────────────────────────────────────── */}
            <div className="flex items-center gap-4 text-xs font-medium">
              <span className="text-slate-500">Legend:</span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-4 h-4 rounded bg-emerald-100 border border-emerald-200" />
                ≥80% — Pass (no action)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-4 h-4 rounded bg-amber-100 border border-amber-200" />
                60–79% — Monitor
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-4 h-4 rounded bg-red-100 border border-red-200" />
                &lt;60% — Needs Training (click to drill in)
              </span>
            </div>

            {/* ── Heatmap grid table ───────────────────────────────────────── */}
            {agents.length === 0 ? (
              <Card className="border border-slate-100">
                <CardContent className="py-16 text-center text-slate-400 text-sm">
                  No audit data found for the selected range.
                </CardContent>
              </Card>
            ) : (
              <Card className="border border-slate-100 shadow-sm overflow-hidden">
                <CardHeader className="py-3 px-4 border-b border-slate-100">
                  <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <BarChart2 className="h-4 w-4 text-indigo-500" />
                    Agent × Parameter Pass Rate Heatmap
                    <Badge variant="secondary" className="ml-2">{agents.length} agents</Badge>
                  </CardTitle>
                </CardHeader>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead className="sticky left-0 z-10 bg-slate-50 w-8 px-3">
                          <input
                            type="checkbox"
                            className="rounded border-slate-300"
                            checked={selected.size === agents.length && agents.length > 0}
                            onChange={() => selected.size === agents.length ? clearAll() : selectAll()}
                          />
                        </TableHead>
                        <TableHead className="sticky left-8 z-10 bg-slate-50 min-w-[180px] text-xs font-semibold text-slate-600">
                          Agent
                        </TableHead>
                        <TableHead className="text-xs font-semibold text-slate-600 text-center w-16">
                          Audits
                        </TableHead>
                        <TableHead className="text-xs font-semibold text-slate-600 text-center w-16">
                          CQ %
                        </TableHead>
                        <TableHead className="text-xs font-semibold text-slate-600 text-center w-16">
                          Flags
                        </TableHead>
                        {PARAMS.map((p) => (
                          <TableHead
                            key={p.key}
                            className="text-xs font-semibold text-slate-500 text-center min-w-[72px] whitespace-nowrap"
                            title={friendlyParamName(p.key)}
                          >
                            <span className="block max-w-[72px] overflow-hidden text-ellipsis">{p.label}</span>
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {agents.map((a) => (
                        <TableRow
                          key={a.agent_code}
                          className={`hover:bg-slate-50 transition-colors ${
                            selected.has(a.agent_code) ? "bg-indigo-50" : ""
                          }`}
                        >
                          {/* Checkbox */}
                          <TableCell className="sticky left-0 z-10 bg-inherit px-3">
                            <input
                              type="checkbox"
                              className="rounded border-slate-300"
                              checked={selected.has(a.agent_code)}
                              onChange={() => toggleSelect(a.agent_code)}
                            />
                          </TableCell>
                          {/* Agent name */}
                          <TableCell className="sticky left-8 z-10 bg-inherit">
                            <div className="text-sm font-semibold text-slate-800 whitespace-nowrap">
                              {a.agent_name}
                            </div>
                            <div className="text-xs text-slate-400">{a.agent_code}</div>
                          </TableCell>
                          {/* Audit count */}
                          <TableCell className="text-center text-xs text-slate-600">
                            {a.audit_count}
                          </TableCell>
                          {/* CQ Score */}
                          <TableCell className="text-center">
                            <span className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold ${cellBg(a.avg_cq_score)}`}>
                              {a.avg_cq_score}%
                            </span>
                          </TableCell>
                          {/* TNI flag count */}
                          <TableCell className="text-center">
                            {a.tni_flag_count > 0 ? (
                              <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">
                                {a.tni_flag_count}
                              </Badge>
                            ) : (
                              <CheckCircle2 className="h-4 w-4 text-emerald-400 mx-auto" />
                            )}
                          </TableCell>
                          {/* Param cells */}
                          {PARAMS.map((p) => {
                            const pct = a.params[p.key] ?? 0;
                            const isRed = pct < TNI_THRESHOLD;
                            return (
                              <TableCell
                                key={p.key}
                                className={`text-center text-xs px-2 py-2 ${cellClass(pct)}`}
                                title={`${a.agent_name} — ${friendlyParamName(p.key)}: ${pct}% pass`}
                                onClick={() => isRed && openPanel(a, p.key)}
                              >
                                {pct}%
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            )}

            {/* ── Action Panel ─────────────────────────────────────────────── */}
            {agents.length > 0 && (
              <Card className="border border-indigo-100 bg-indigo-50 shadow-sm">
                <CardHeader className="py-3 px-4 border-b border-indigo-100">
                  <CardTitle className="text-sm font-semibold text-indigo-800 flex items-center gap-2">
                    <BookOpen className="h-4 w-4" />
                    Action Panel
                    {selected.size > 0 && (
                      <Badge className="bg-indigo-200 text-indigo-800 text-xs">
                        {selected.size} selected
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-3 pb-4">
                  <div className="flex flex-wrap items-center gap-3">
                    {selected.size === 0 ? (
                      <p className="text-xs text-indigo-600">
                        Select agents from the heatmap above using the checkboxes, then take action.
                      </p>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          className="bg-amber-600 hover:bg-amber-700 text-white"
                          onClick={handleSendToQA}
                        >
                          <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
                          Send to QA for Coaching
                        </Button>
                        <Button
                          size="sm"
                          className="bg-indigo-600 hover:bg-indigo-700 text-white"
                          onClick={handleAssignLMS}
                        >
                          <GraduationCap className="h-3.5 w-3.5 mr-1.5" />
                          Assign LMS Module
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-slate-500"
                          onClick={clearAll}
                        >
                          Clear selection
                        </Button>
                      </>
                    )}
                    <div className="ml-auto text-xs text-indigo-500">
                      Agents with TNI: <strong className="text-indigo-700">{summary?.agents_with_tni ?? 0}</strong>
                      {" "}/ Total: <strong className="text-indigo-700">{summary?.total_agents ?? 0}</strong>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      {/* ── Side Panel (drill-down) ────────────────────────────────────────── */}
      {sidePanel && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
            onClick={() => setSidePanel(null)}
          />
          <SidePanel
            panel={sidePanel}
            from={from}
            to={to}
            clientId={clientId}
            onClose={() => setSidePanel(null)}
          />
        </>
      )}
    </DashboardLayout>
  );
}
