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
import { AlertTriangle, CheckCircle2, Clock, RefreshCw, Plus, FileText } from "lucide-react";

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
  if (status === "filed") return <span className="text-green-600 text-sm font-medium">Filed</span>;
  const days = daysFromToday(dueDate);
  if (days < 0) return <span className="text-red-600 text-sm font-semibold">{Math.abs(days)}d overdue</span>;
  if (days === 0) return <span className="text-red-600 text-sm font-semibold">Due today!</span>;
  if (days <= 3)  return <span className="text-amber-600 text-sm font-medium">Due in {days}d</span>;
  return <span className="text-slate-500 text-sm">{days}d left</span>;
}

function fmtAmt(v: number | null) {
  if (v == null) return "—";
  return `₹${(v / 100000).toFixed(2)}L`;
}

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
      `/payroll/statutory-filing?month=${month}`
    ).then(r => r.data),
  });

  const { data: overdueData } = useQuery({
    queryKey: ["statutory-filing-overdue"],
    queryFn: () => hrmsApi.get<{ success: boolean; data: FilingRecord[] }>(
      "/payroll/statutory-filing/overdue"
    ).then(r => r.data),
  });

  const initMut = useMutation({
    mutationFn: () => hrmsApi.post(`/payroll/statutory-filing/initialize/${month}`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["statutory-filing"] }); toast({ title: "Obligations initialized" }); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const markFiledMut = useMutation({
    mutationFn: (id: string) => hrmsApi.patch(`/payroll/statutory-filing/${id}/mark-filed`, {
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

  const records: FilingRecord[] = data?.data ?? [];
  const overdueCount = overdueData?.data?.length ?? 0;

  const filedCount   = records.filter(r => r.status === "filed").length;
  const pendingCount = records.filter(r => r.status === "pending").length;
  const overdueInMonth = records.filter(r => r.status === "overdue").length;

  const openRecord = markDialogId ? records.find(r => r.id === markDialogId) : null;

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Statutory Filing Tracker</h1>
            <p className="text-slate-500 text-sm mt-0.5">Track EPF, ESIC, PT, TDS compliance deadlines</p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="month"
              value={month}
              onChange={e => setMonth(e.target.value)}
              className="w-40"
            />
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button size="sm" onClick={() => initMut.mutate()} disabled={initMut.isPending}>
              <Plus className="w-4 h-4 mr-1" />
              Initialize Month
            </Button>
          </div>
        </div>

        {/* Overdue alert */}
        {overdueCount > 0 && (
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg p-4">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
            <span className="text-red-800 font-medium">
              {overdueCount} overdue filing{overdueCount > 1 ? "s" : ""} across all months — action required
            </span>
          </div>
        )}

        {/* KPI strip */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Filed", value: filedCount, color: "text-green-700" },
            { label: "Pending", value: pendingCount, color: "text-amber-700" },
            { label: "Overdue", value: overdueInMonth, color: "text-red-700" },
          ].map(k => (
            <Card key={k.label} className="text-center py-4">
              <div className={`text-3xl font-bold ${k.color}`}>{k.value}</div>
              <div className="text-slate-500 text-sm mt-1">{k.label}</div>
            </Card>
          ))}
        </div>

        {/* Filing table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filing Obligations — {month}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-slate-400">Loading…</div>
            ) : records.length === 0 ? (
              <div className="p-8 text-center text-slate-400">
                No filings for this month.
                <Button variant="link" onClick={() => initMut.mutate()} className="ml-1 p-0 h-auto">
                  Initialize now
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      {["Type", "Due Date", "Amount Due", "Status", "Challan No.", "Filed On", ""].map(h => (
                        <th key={h} className="px-4 py-3 text-left font-medium text-slate-600 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {records.map(r => (
                      <tr key={r.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-4 py-3 font-medium">
                          <div>{TYPE_LABELS[r.filing_type] ?? r.filing_type}</div>
                          {r.state_code && <div className="text-xs text-slate-400">{r.state_code}</div>}
                        </td>
                        <td className="px-4 py-3">
                          <div>{new Date(r.due_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</div>
                          <DueDateChip dueDate={r.due_date} status={r.status} />
                        </td>
                        <td className="px-4 py-3 font-mono">{fmtAmt(r.amount_due)}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={`capitalize ${STATUS_COLORS[r.status]}`}>
                            {r.status === "filed" && <CheckCircle2 className="w-3 h-3 mr-1" />}
                            {r.status === "overdue" && <AlertTriangle className="w-3 h-3 mr-1" />}
                            {r.status === "pending" && <Clock className="w-3 h-3 mr-1" />}
                            {r.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{r.challan_number ?? "—"}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {r.filed_at ? new Date(r.filed_at).toLocaleDateString("en-IN") : "—"}
                        </td>
                        <td className="px-4 py-3">
                          {r.status !== "filed" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setMarkDialogId(r.id);
                                setAmountFiled(r.amount_due != null ? String(r.amount_due) : "");
                              }}
                            >
                              <FileText className="w-3 h-3 mr-1" />
                              Mark Filed
                            </Button>
                          )}
                          {r.remarks && r.status === "filed" && (
                            <span className="text-xs text-slate-400 italic">{r.remarks}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Mark as Filed Dialog */}
      <Dialog open={!!markDialogId} onOpenChange={open => !open && setMarkDialogId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mark as Filed — {openRecord ? TYPE_LABELS[openRecord.filing_type] : ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Challan Number *</Label>
              <Input
                value={challanNo}
                onChange={e => setChallanNo(e.target.value)}
                placeholder="Enter challan / acknowledgement number"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Challan Date</Label>
              <Input
                type="date"
                value={challanDate}
                onChange={e => setChallanDate(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Amount Paid (₹)</Label>
              <Input
                type="number"
                value={amountFiled}
                onChange={e => setAmountFiled(e.target.value)}
                placeholder="e.g. 125000"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Remarks</Label>
              <Textarea
                value={remarksTxt}
                onChange={e => setRemarksTxt(e.target.value)}
                rows={2}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkDialogId(null)}>Cancel</Button>
            <Button
              onClick={() => markDialogId && markFiledMut.mutate(markDialogId)}
              disabled={!challanNo.trim() || markFiledMut.isPending}
            >
              {markFiledMut.isPending ? "Saving…" : "Mark as Filed"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
