import { useEffect, useState, useCallback } from "react";
import { Activity, AlertTriangle, Users, TrendingUp, Clock, RefreshCw, Download, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Types
type InboundProject = {
  key: string;
  name: string;
  icon?: string;
  color?: string;
  mandate?: number;
  required?: number;
  hasFCR?: boolean;
  offered: number;
  answered: number;
  abandoned: number;
  sl_percent: number;
  al_percent: number;
  acht: number;
  repeat_percent?: number;
  fcr_percent?: number;
  logged_in: number;
};

type AgentStatus = {
  agent_id: string;
  agent_name: string;
  status: "Logged In" | "Logged Out" | "On Break" | "Absent";
  duration: number;
  process_name?: string;
  branch_name?: string;
};

type OperationsSummary = {
  total_agents: number;
  logged_in: number;
  on_break: number;
  logged_out: number;
  adherence_percent?: number;
};

type EscalationSignal = {
  call_id: string;
  agent_name: string;
  process_name: string;
  signal_type: string;
  timestamp: string;
  notes?: string;
};

type ProcessUtilization = {
  process_name: string;
  rostered: number;
  logged_in: number;
  required: number;
  shrinkage_percent: number;
};

// Countdown Ring Component
function CountdownRing({ seconds, maxSeconds }: { seconds: number; maxSeconds: number }) {
  const percent = ((maxSeconds - seconds) / maxSeconds) * 100;
  const circumference = 2 * Math.PI * 18;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <div className="relative inline-flex h-10 w-10 items-center justify-center">
      <svg className="h-10 w-10 -rotate-90 transform">
        <circle
          cx="20"
          cy="20"
          r="18"
          stroke="currentColor"
          strokeWidth="3"
          fill="none"
          className="text-slate-200"
        />
        <circle
          cx="20"
          cy="20"
          r="18"
          stroke="currentColor"
          strokeWidth="3"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="text-blue-500 transition-all duration-1000"
        />
      </svg>
      <span className="absolute text-xs font-bold text-slate-700">{seconds}</span>
    </div>
  );
}

// Process Card Component
function ProcessCard({ project, onClick }: { project: InboundProject; onClick?: () => void }) {
  const slColor = project.sl_percent >= 80 ? "text-green-600" : project.sl_percent >= 60 ? "text-amber-600" : "text-red-600";
  const alColor = project.al_percent >= 80 ? "text-green-600" : project.al_percent >= 60 ? "text-amber-600" : "text-red-600";
  const achtColor = project.acht <= 300 ? "text-green-600" : "text-amber-600";
  const loginDeficit = (project.mandate ?? 0) > project.logged_in;

  return (
    <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={onClick}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <CardTitle className="text-base font-semibold">{project.name}</CardTitle>
          {project.color && (
            <div className={`h-3 w-3 rounded-full`} style={{ backgroundColor: project.color }} />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Offered / Answered / Abandoned */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-2xl font-bold text-slate-900">{project.offered}</p>
            <p className="text-xs text-slate-500">Offered</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-green-600">{project.answered}</p>
            <p className="text-xs text-slate-500">Answered</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-red-600">{project.abandoned}</p>
            <p className="text-xs text-slate-500">Abandoned</p>
          </div>
        </div>

        {/* SL & AL */}
        <div className="flex gap-4 justify-center">
          <div>
            <span className="text-xs text-slate-500">SL%: </span>
            <span className={`text-lg font-bold ${slColor}`}>{project.sl_percent.toFixed(1)}%</span>
          </div>
          <div>
            <span className="text-xs text-slate-500">AL%: </span>
            <span className={`text-lg font-bold ${alColor}`}>{project.al_percent.toFixed(1)}%</span>
          </div>
        </div>

        {/* ACHT & Repeat */}
        <div className="flex gap-4 justify-center text-sm">
          <div>
            <span className="text-xs text-slate-500">ACHT: </span>
            <span className={`font-semibold ${achtColor}`}>{project.acht}s</span>
          </div>
          {project.repeat_percent !== undefined && (
            <div>
              <span className="text-xs text-slate-500">Repeat: </span>
              <span className={`font-semibold ${project.repeat_percent <= 20 ? 'text-green-600' : 'text-amber-600'}`}>
                {project.repeat_percent.toFixed(1)}%
              </span>
            </div>
          )}
          {project.hasFCR && project.fcr_percent !== undefined && (
            <div>
              <span className="text-xs text-slate-500">FCR: </span>
              <span className="font-semibold text-slate-700">{project.fcr_percent.toFixed(1)}%</span>
            </div>
          )}
        </div>

        {/* Login vs Mandate */}
        <div className="flex items-center justify-center gap-2 pt-2 border-t">
          <span className="text-sm font-medium text-slate-700">
            {project.logged_in}/{project.mandate ?? project.required ?? 0}
          </span>
          <span className="text-xs text-slate-500">logged in</span>
          {loginDeficit && (
            <Badge variant="destructive" className="text-xs">
              -{(project.mandate ?? project.required ?? 0) - project.logged_in}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function NativeOpsCommandCenter() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Section 1: Inbound Live
  const [inboundProjects, setInboundProjects] = useState<InboundProject[]>([]);
  const [inboundUnavailable, setInboundUnavailable] = useState(false);
  const [countdown, setCountdown] = useState(90);

  // Section 2: Live Agent Status
  const [agentSummary, setAgentSummary] = useState<OperationsSummary | null>(null);
  const [agentStatusList, setAgentStatusList] = useState<AgentStatus[]>([]);

  // Section 3: Escalation Signals
  const [fraudSignals, setFraudSignals] = useState<EscalationSignal[]>([]);
  const [socialSignals, setSocialSignals] = useState<EscalationSignal[]>([]);
  const [abuseSignals, setAbuseSignals] = useState<EscalationSignal[]>([]);
  const [lowQualityAgents, setLowQualityAgents] = useState<any[]>([]);

  // Section 4: Process Utilization
  const [processUtilization, setProcessUtilization] = useState<ProcessUtilization[]>([]);

  // Modal state
  const [drillModal, setDrillModal] = useState<{ open: boolean; title: string; data: any[] }>({
    open: false,
    title: "",
    data: [],
  });

  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  // Fetch all data
  const fetchAllData = useCallback(async () => {
    try {
      setRefreshing(true);

      /*
       * Both feeds below used to call prefixes nothing serves — /api/call-master/inbound/today
       * and /api/operations-live/summary — so each returned 401 (a missing /api/* route 401s in
       * this app rather than 404s) and both sections showed their unavailable state on every
       * load. Neither endpoint was missing; both were mounted under a different prefix:
       *   /api/call-master/inbound/today  ->  /api/inbound/today
       *   /api/operations-live/summary    ->  /api/operations/live-status (.summary)
       */

      // Section 1: Inbound Live (today's data)
      try {
        const inboundRes = await hrmsApi.get<{ success?: boolean; data?: unknown[]; _unavailable?: boolean }>(
          "/api/inbound/today",
        );
        // The route reports an upstream failure as success:true with _unavailable set, rather
        // than throwing — so an empty list from a degraded source is not read as "no projects".
        if (inboundRes?.success && !inboundRes._unavailable) {
          setInboundProjects((inboundRes.data as typeof inboundProjects) || []);
          setInboundUnavailable(false);
        } else {
          setInboundUnavailable(true);
        }
      } catch {
        setInboundUnavailable(true);
      }

      // Section 2: Live Agent Status
      try {
        const liveRes = await hrmsApi.get<{ success?: boolean; data?: { summary?: OperationsSummary } }>(
          "/api/operations/live-status",
        );
        // live-status returns {agents, summary, timestamp}; this panel only renders the summary.
        setAgentSummary(liveRes?.success ? (liveRes.data?.summary ?? null) : null);
      } catch {
        setAgentSummary(null);
      }

      // Section 3: Escalation Signals (mock for now - replace with real endpoints)
      // In production, these would come from quality-dashboard endpoints
      setFraudSignals([]);
      setSocialSignals([]);
      setAbuseSignals([]);
      setLowQualityAgents([]);

      // Section 4: Process Utilization (derived from inbound + roster data)
      // This would ideally come from a dedicated endpoint combining WFM roster + live login
      setProcessUtilization([]);

      setLastUpdated(new Date());
      setCountdown(90);
    } catch (error: any) {
      toast({
        title: "Failed to load data",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  // Initial load
  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // Auto-refresh every 90 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          fetchAllData();
          return 90;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [fetchAllData]);

  // Export current snapshot as CSV
  const handleExport = () => {
    const csvRows = [
      ["Process", "Offered", "Answered", "Abandoned", "SL%", "AL%", "ACHT", "Logged In", "Mandate"],
      ...inboundProjects.map((p) => [
        p.name,
        p.offered,
        p.answered,
        p.abandoned,
        p.sl_percent.toFixed(1),
        p.al_percent.toFixed(1),
        p.acht,
        p.logged_in,
        p.mandate ?? p.required ?? 0,
      ]),
    ];
    const csvContent = csvRows.map((row) => row.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ops-command-center-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Exported", description: "Data exported to CSV" });
  };

  return (
    <DashboardLayout title="Ops Command Center" description="Unified operations control room">
      <div className="space-y-6">
        {/* Header Controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button onClick={fetchAllData} disabled={refreshing} size="sm" variant="outline">
              <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button onClick={handleExport} size="sm" variant="outline">
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Clock className="h-4 w-4" />
              Last updated: {lastUpdated.toLocaleTimeString()}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500">Auto-refresh in</span>
            <CountdownRing seconds={countdown} maxSeconds={90} />
          </div>
        </div>

        {/* Section 1: Inbound Live */}
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-slate-900">Inbound Live Performance</h2>
            <Badge variant="outline" className="text-xs">
              Auto-refreshes every 90s
            </Badge>
          </div>

          {inboundUnavailable ? (
            <Card className="bg-amber-50 border-amber-200">
              <CardContent className="py-8 text-center">
                <AlertTriangle className="mx-auto h-12 w-12 text-amber-600 mb-3" />
                <p className="text-amber-800 font-medium">Inbound data unavailable</p>
                <p className="text-amber-700 text-sm mt-1">Dialer source may be offline</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {inboundProjects.map((project) => (
                <ProcessCard key={project.key} project={project} />
              ))}
            </div>
          )}
        </div>

        {/* Section 2: Live Agent Status */}
        <div>
          <h2 className="text-xl font-semibold text-slate-900 mb-4">Live Agent Status</h2>
          {agentSummary ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="bg-gradient-to-br from-green-50 to-white border-green-200">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-600">Logged In</p>
                      <p className="text-3xl font-bold text-green-600 mt-1">{agentSummary.logged_in}</p>
                    </div>
                    <Users className="h-10 w-10 text-green-600 opacity-60" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-amber-50 to-white border-amber-200">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-600">On Break</p>
                      <p className="text-3xl font-bold text-amber-600 mt-1">{agentSummary.on_break}</p>
                    </div>
                    <Clock className="h-10 w-10 text-amber-600 opacity-60" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-red-50 to-white border-red-200">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-600">Absent / Not Logged</p>
                      <p className="text-3xl font-bold text-red-600 mt-1">{agentSummary.logged_out}</p>
                    </div>
                    <AlertTriangle className="h-10 w-10 text-red-600 opacity-60" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-blue-50 to-white border-blue-200">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-600">Adherence Avg</p>
                      <p className="text-3xl font-bold text-blue-600 mt-1">
                        {agentSummary.adherence_percent?.toFixed(1) ?? "N/A"}%
                      </p>
                    </div>
                    <TrendingUp className="h-10 w-10 text-blue-600 opacity-60" />
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-slate-500">
                Data unavailable
              </CardContent>
            </Card>
          )}
        </div>

        {/* Section 3: Escalation Signals */}
        <div>
          <h2 className="text-xl font-semibold text-slate-900 mb-4">Escalation Signals (Today)</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() =>
                setDrillModal({ open: true, title: "Fraud/Scam Alerts", data: fraudSignals })
              }
            >
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-600">Fraud / Scam Alerts</p>
                    <p className={`text-3xl font-bold mt-1 ${fraudSignals.length > 0 ? "text-red-600" : "text-slate-400"}`}>
                      {fraudSignals.length}
                    </p>
                  </div>
                  <ShieldAlert className={`h-10 w-10 ${fraudSignals.length > 0 ? "text-red-600" : "text-slate-300"}`} />
                </div>
              </CardContent>
            </Card>

            <Card
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() =>
                setDrillModal({ open: true, title: "Social Media / Court Threats", data: socialSignals })
              }
            >
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-600">Social / Court Threats</p>
                    <p className={`text-3xl font-bold mt-1 ${socialSignals.length > 0 ? "text-orange-600" : "text-slate-400"}`}>
                      {socialSignals.length}
                    </p>
                  </div>
                  <AlertTriangle className={`h-10 w-10 ${socialSignals.length > 0 ? "text-orange-600" : "text-slate-300"}`} />
                </div>
              </CardContent>
            </Card>

            <Card
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() =>
                setDrillModal({ open: true, title: "Abuse / Negative Signals", data: abuseSignals })
              }
            >
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-600">Abuse / Negative</p>
                    <p className={`text-3xl font-bold mt-1 ${abuseSignals.length > 0 ? "text-amber-600" : "text-slate-400"}`}>
                      {abuseSignals.length}
                    </p>
                  </div>
                  <AlertTriangle className={`h-10 w-10 ${abuseSignals.length > 0 ? "text-amber-600" : "text-slate-300"}`} />
                </div>
              </CardContent>
            </Card>

            <Card
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() =>
                setDrillModal({ open: true, title: "Low Quality Agents (CQ < 75%)", data: lowQualityAgents })
              }
            >
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-600">Low Quality Agents</p>
                    <p className={`text-3xl font-bold mt-1 ${lowQualityAgents.length > 0 ? "text-red-600" : "text-slate-400"}`}>
                      {lowQualityAgents.length}
                    </p>
                  </div>
                  <Activity className={`h-10 w-10 ${lowQualityAgents.length > 0 ? "text-red-600" : "text-slate-300"}`} />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Section 4: Process Utilization */}
        <div>
          <h2 className="text-xl font-semibold text-slate-900 mb-4">Process Utilization</h2>
          {processUtilization.length > 0 ? (
            <Card>
              <CardContent className="pt-6 space-y-4">
                {processUtilization.map((p) => (
                  <div key={p.process_name} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-900">{p.process_name}</span>
                      <Badge variant="outline">Shrinkage: {p.shrinkage_percent.toFixed(1)}%</Badge>
                    </div>
                    <div className="flex gap-4 text-sm text-slate-600">
                      <span>Rostered: {p.rostered}</span>
                      <span>Logged In: {p.logged_in}</span>
                      <span>Required: {p.required}</span>
                    </div>
                    <Progress value={(p.logged_in / p.required) * 100} className="h-2" />
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-slate-500">
                Process utilization data not available
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Drill-down Modal */}
      <Dialog open={drillModal.open} onOpenChange={(open) => setDrillModal({ ...drillModal, open })}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{drillModal.title}</DialogTitle>
            <DialogDescription>
              {drillModal.data.length} record(s) found
            </DialogDescription>
          </DialogHeader>
          {drillModal.data.length === 0 ? (
            <p className="text-center py-8 text-slate-500">No records</p>
          ) : (
            <div className="space-y-2">
              {drillModal.data.map((item: any, idx: number) => (
                <Card key={idx}>
                  <CardContent className="py-3">
                    <pre className="text-xs text-slate-700">{JSON.stringify(item, null, 2)}</pre>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
