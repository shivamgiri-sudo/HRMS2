import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Card, CardHeader, CardTitle, CardContent,
} from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, FileText, Mail, CheckCircle2, Clock, AlertTriangle } from "lucide-react";

interface RunSummary {
  id: string;
  run_month: string;
  status: string;
}

interface BulkSummary {
  runId: string;
  total: number;
  generated: number;
  emailed: number;
  pending: number;
  first_generated_at: string | null;
  last_generated_at: string | null;
}

interface GenerateJobStatus {
  runId: string;
  status: "pending" | "running" | "done" | "error" | "unknown";
  total: number;
  done: number;
  failed: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

function pct(done: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((done / total) * 100);
}

export default function BulkOutputs() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedRun, setSelectedRun] = useState<string>("");
  const [pollingEnabled, setPollingEnabled] = useState(false);

  const { data: runsData } = useQuery({
    queryKey: ["payroll-runs-for-bulk"],
    queryFn: () => hrmsApi.get<{ success: boolean; data: RunSummary[] }>(
      "/payroll/runs?limit=24"
    ).then(r => r.data),
  });

  const runs: RunSummary[] = runsData?.data ?? [];

  const { data: summaryData, refetch: refetchSummary } = useQuery({
    queryKey: ["bulk-payslip-summary", selectedRun],
    queryFn: () => hrmsApi.get<{ success: boolean; data: BulkSummary }>(
      `/payroll/runs/${selectedRun}/bulk-payslip-summary`
    ).then(r => r.data),
    enabled: !!selectedRun,
  });

  const { data: jobData } = useQuery({
    queryKey: ["bulk-generate-status", selectedRun],
    queryFn: () => hrmsApi.get<{ success: boolean; data: GenerateJobStatus }>(
      `/payroll/runs/${selectedRun}/bulk-generate-status`
    ).then(r => r.data),
    enabled: !!selectedRun && pollingEnabled,
    refetchInterval: pollingEnabled ? 2000 : false,
  });

  const job = jobData?.data;

  // Stop polling when done or error
  if (pollingEnabled && job && (job.status === "done" || job.status === "error")) {
    setPollingEnabled(false);
    qc.invalidateQueries({ queryKey: ["bulk-payslip-summary", selectedRun] });
  }

  const generateMut = useMutation({
    mutationFn: () => hrmsApi.post(`/payroll/runs/${selectedRun}/bulk-generate-payslips`, {}),
    onSuccess: () => {
      toast({ title: "Bulk generation started" });
      setPollingEnabled(true);
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message ?? "Error starting generation", variant: "destructive" }),
  });

  const emailMut = useMutation({
    mutationFn: () => hrmsApi.post(`/payroll/runs/${selectedRun}/email-payslips`, {}),
    onSuccess: (res: any) => {
      const cnt = res.data?.data?.emailed ?? 0;
      toast({ title: `${cnt} payslips marked as emailed` });
      qc.invalidateQueries({ queryKey: ["bulk-payslip-summary", selectedRun] });
    },
    onError: () => toast({ title: "Error emailing payslips", variant: "destructive" }),
  });

  const summary: BulkSummary | null = summaryData?.data ?? null;

  const isGenerating = pollingEnabled && job?.status === "running";
  const genPct = job ? pct(job.done, job.total) : (summary ? pct(summary.generated, summary.total) : 0);

  return (
    <DashboardLayout>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Bulk Payslip Outputs</h1>
          <p className="text-slate-500 text-sm mt-0.5">Generate, track and distribute payslips in bulk for a payroll run</p>
        </div>

        {/* Run selector */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Select Payroll Run</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={selectedRun} onValueChange={setSelectedRun}>
              <SelectTrigger className="max-w-sm">
                <SelectValue placeholder="Choose a run…" />
              </SelectTrigger>
              <SelectContent>
                {runs.map(r => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.run_month} — {r.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {selectedRun && summary && (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Total Employees", value: summary.total, icon: FileText, color: "text-slate-800" },
                { label: "Generated", value: summary.generated, icon: CheckCircle2, color: "text-green-700" },
                { label: "Emailed", value: summary.emailed, icon: Mail, color: "text-blue-700" },
                { label: "Pending", value: summary.pending, icon: Clock, color: summary.pending > 0 ? "text-amber-700" : "text-slate-400" },
              ].map(k => (
                <Card key={k.label} className="text-center py-4">
                  <k.icon className={`w-5 h-5 mx-auto mb-1 ${k.color}`} />
                  <div className={`text-3xl font-bold ${k.color}`}>{k.value}</div>
                  <div className="text-slate-500 text-xs mt-0.5">{k.label}</div>
                </Card>
              ))}
            </div>

            {/* Progress */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  Generation Progress
                  <Button variant="ghost" size="sm" onClick={() => refetchSummary()}>
                    <RefreshCw className="w-3.5 h-3.5" />
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between text-xs text-slate-500 mb-1">
                    <span>Payslip Generation</span>
                    <span>{genPct}% ({isGenerating ? `${job?.done ?? 0}` : summary.generated}/{summary.total})</span>
                  </div>
                  <Progress value={genPct} className="h-2" />
                  {isGenerating && (
                    <div className="flex items-center gap-2 mt-2 text-sm text-amber-700">
                      <div className="w-3 h-3 rounded-full bg-amber-400 animate-pulse" />
                      Generation in progress… ({job?.done}/{job?.total})
                    </div>
                  )}
                  {job?.status === "error" && (
                    <div className="flex items-center gap-2 mt-2 text-sm text-red-600">
                      <AlertTriangle className="w-4 h-4" />
                      Error: {job.error}
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex justify-between text-xs text-slate-500 mb-1">
                    <span>Email Distribution</span>
                    <span>{pct(summary.emailed, summary.generated)}% ({summary.emailed}/{summary.generated})</span>
                  </div>
                  <Progress value={pct(summary.emailed, summary.generated)} className="h-2" />
                </div>

                {summary.last_generated_at && (
                  <p className="text-xs text-slate-400">
                    Last generated: {new Date(summary.last_generated_at).toLocaleString("en-IN")}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Actions */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Actions</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <Button
                  onClick={() => generateMut.mutate()}
                  disabled={generateMut.isPending || isGenerating}
                  className="flex items-center gap-2"
                >
                  <FileText className="w-4 h-4" />
                  {isGenerating ? "Generating…" : summary.generated === summary.total && summary.total > 0 ? "Re-generate All" : "Generate All Payslips"}
                </Button>

                <Button
                  variant="outline"
                  onClick={() => emailMut.mutate()}
                  disabled={emailMut.isPending || summary.generated === 0}
                  className="flex items-center gap-2"
                >
                  <Mail className="w-4 h-4" />
                  {emailMut.isPending ? "Marking…" : `Email All (${summary.generated} ready)`}
                </Button>
              </CardContent>
            </Card>

            {/* Info notes */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
              <strong>How this works:</strong>
              <ul className="list-disc list-inside mt-1 space-y-1 text-xs">
                <li>"Generate All Payslips" marks each payroll line as payslip-generated in the database.</li>
                <li>"Email All" marks all generated payslips as emailed — actual delivery is handled by the notification service.</li>
                <li>Generation runs server-side asynchronously — poll the page to see progress.</li>
              </ul>
            </div>
          </>
        )}

        {selectedRun && !summary && (
          <div className="p-8 text-center text-slate-400">Loading run data…</div>
        )}

        {!selectedRun && (
          <div className="p-12 text-center text-slate-400 border-2 border-dashed border-slate-200 rounded-lg">
            Select a payroll run above to manage bulk outputs
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
