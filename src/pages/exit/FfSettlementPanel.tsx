/**
 * Extracted from NativeExitCommandCenter.tsx (owner ruling 2026-09-26: split the 2600+
 * line page into smaller files). Shared types/consts/primitives live in ./shared.ts.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, IndianRupee } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";
import type { ExitRow, FullFinalCalc } from "./shared";

// ─────────────────────────────────────────────────────────────────────────────
// F&F Settlement Panel
// ─────────────────────────────────────────────────────────────────────────────
export function FfSettlementPanel({ exitRequests }: { exitRequests: ExitRow[] }) {
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string>("");
  const [ff, setFf] = useState<FullFinalCalc | null>(null);
  const [loadingFf, setLoadingFf] = useState(false);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState(false);
  const [advances, setAdvances] = useState<{
    outstanding_amount: number;
    advances: Array<{
      id: string;
      advance_date: string;
      amount: number;
      recovered_amount: number;
      remaining: number;
      notes: string | null;
    }>;
  } | null>(null);
  const [loadingAdvances, setLoadingAdvances] = useState(false);
  const [form, setForm] = useState({
    noticePeriodDays: 0,
    noticeShortfallDays: 0,
    noticeRecovery: 0,
    gratuityAmount: 0,
    salaryHold: 0,
    advancesRecovery: 0,
    netPayable: 0,
  });

  const loadFf = async (exitRequestId: string) => {
    setLoadingFf(true);
    setFf(null);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: FullFinalCalc }>(
        `/api/exit/ff/${exitRequestId}`,
      );
      setFf(res.data);
      setForm({
        noticePeriodDays: res.data.notice_period_days ?? 0,
        noticeShortfallDays: res.data.notice_shortfall_days ?? 0,
        noticeRecovery: res.data.notice_recovery ?? 0,
        gratuityAmount: res.data.gratuity_amount ?? 0,
        salaryHold: res.data.salary_hold ?? 0,
        advancesRecovery: res.data.advances_recovery ?? 0,
        netPayable: res.data.net_payable ?? 0,
      });
    } catch {
      setFf(null);
      setForm({
        noticePeriodDays: 0,
        noticeShortfallDays: 0,
        noticeRecovery: 0,
        gratuityAmount: 0,
        salaryHold: 0,
        advancesRecovery: 0,
        netPayable: 0,
      });
    } finally {
      setLoadingFf(false);
    }
  };

  const handleSelect = (id: string) => {
    setSelectedId(id);
    if (id) void loadFf(id);
    else setFf(null);
  };

  useEffect(() => {
    if (!selectedId) {
      setAdvances(null);
      return;
    }
    setLoadingAdvances(true);
    hrmsApi
      .get<{
        success: boolean;
        data: { outstanding_amount: number; advances: any[] };
      }>(`/api/exit/ff/${selectedId}/outstanding-advances`)
      .then((r) => setAdvances((r as any).data))
      .catch(() => setAdvances(null))
      .finally(() => setLoadingAdvances(false));
  }, [selectedId]);

  const handleSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      await hrmsApi.post(`/api/exit/ff/${selectedId}`, {
        calculationDate: new Date().toISOString().slice(0, 10),
        earnedLeaveEncashment: 0,
        ...form,
      });
      toast({ title: "F&F calculation saved" });
      await loadFf(selectedId);
    } catch (err: any) {
      toast({
        title: "Save failed",
        description: err?.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async () => {
    if (!ff) return;
    const reason = window
      .prompt("Reason for clearing the provisional F&F calculation:")
      ?.trim();
    if (!reason) return;
    setActing(true);
    try {
      await hrmsApi.post(`/api/exit/ff/${ff.id}/verify`, { reason });
      toast({ title: "Marked as verified — provisional cleared" });
      await loadFf(selectedId);
    } catch (err: any) {
      toast({
        title: "Verify failed",
        description: err?.message,
        variant: "destructive",
      });
    } finally {
      setActing(false);
    }
  };

  const handleApprove = async () => {
    if (!ff) return;
    setActing(true);
    try {
      await hrmsApi.post(`/api/exit/ff/${ff.id}/approve`, {});
      toast({ title: "F&F approved" });
      await loadFf(selectedId);
    } catch (err: any) {
      toast({
        title: "Approve failed",
        description: err?.message,
        variant: "destructive",
      });
    } finally {
      setActing(false);
    }
  };

  const fmt = (n: number) =>
    `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
  const eligible = exitRequests.filter((e) =>
    ["accepted", "notice_serving", "exited", "exit_confirmed"].includes(
      e.status,
    ),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Label className="whitespace-nowrap text-sm font-medium">
          Employee Exit
        </Label>
        <Select value={selectedId} onValueChange={handleSelect}>
          <SelectTrigger className="w-80">
            <SelectValue placeholder="Select an exit request…" />
          </SelectTrigger>
          <SelectContent>
            {eligible.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.employee_name ?? e.employee_id} —{" "}
                {e.status.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!selectedId && (
        <div className="rounded-xl border border-dashed border-slate-200 py-16 text-center text-slate-400 text-sm">
          Select an accepted or exited employee to view or create their F&amp;F
          settlement.
        </div>
      )}

      {selectedId && loadingFf && (
        <div className="py-8 text-center text-sm text-slate-500">
          Loading F&amp;F data…
        </div>
      )}

      {selectedId && !loadingFf && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="rounded-2xl border-white/60 bg-white/95 backdrop-blur-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {ff ? "Current F&F Calculation" : "Create F&F Calculation"}
              </CardTitle>
              {ff?.is_ff_provisional === 1 && (
                <div className="flex items-center gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Provisional — must be verified before approval
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {(
                [
                  ["noticePeriodDays", "Notice Period (days)"],
                  ["noticeShortfallDays", "Notice Shortfall (days)"],
                  ["noticeRecovery", "Notice Recovery (₹)"],
                  ["gratuityAmount", "Gratuity (₹)"],
                  ["salaryHold", "Salary Hold (₹)"],
                  ["advancesRecovery", "Advances Recovery (₹)"],
                  ["netPayable", "Net Payable (₹)"],
                ] as [keyof typeof form, string][]
              ).map(([key, label]) => (
                <div key={key} className="grid grid-cols-2 items-center gap-2">
                  <Label className="text-sm">{label}</Label>
                  <Input
                    type="number"
                    value={form[key]}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        [key]: Number(e.target.value),
                      }))
                    }
                    className="h-8 text-right text-sm"
                  />
                </div>
              ))}
              {!loadingAdvances &&
                advances &&
                advances.outstanding_amount > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 flex items-start justify-between gap-3">
                    <span>
                      Auto-detected outstanding advances:{" "}
                      <strong>{fmt(advances.outstanding_amount)}</strong>
                    </span>
                    <button
                      type="button"
                      className="shrink-0 rounded bg-amber-700 px-2 py-1 text-xs font-bold text-white hover:bg-amber-800"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          advancesRecovery: advances.outstanding_amount,
                        }))
                      }
                    >
                      Use this amount
                    </button>
                  </div>
                )}
              <Button
                size="sm"
                className="w-full mt-2"
                onClick={() => void handleSave()}
                disabled={saving}
              >
                {saving
                  ? "Saving…"
                  : ff
                    ? "Update & Recalculate"
                    : "Create F&F Calculation"}
              </Button>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-white/60 bg-white/95 backdrop-blur-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <IndianRupee className="h-4 w-4" />
                Settlement Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg bg-slate-50 p-3 space-y-2 text-sm">
                {(
                  [
                    ["Gratuity", form.gratuityAmount, false],
                    ["Notice Recovery", form.noticeRecovery, true],
                    ["Salary Hold", form.salaryHold, true],
                    ["Advances Recovery", form.advancesRecovery, true],
                  ] as [string, number, boolean][]
                ).map(([label, val, negative]) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-slate-600">
                      {label}
                      {negative ? " (−)" : ""}
                    </span>
                    <span
                      className={negative ? "text-red-600" : "text-slate-900"}
                    >
                      {fmt(val)}
                    </span>
                  </div>
                ))}
                <div className="border-t border-slate-200 pt-2 flex justify-between font-semibold">
                  <span>Net Payable</span>
                  <span className="text-emerald-700">
                    {fmt(form.netPayable)}
                  </span>
                </div>
              </div>

              {ff && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant={ff.status === "approved" ? "default" : "secondary"}
                  >
                    {ff.status}
                  </Badge>
                  {ff.is_ff_provisional === 1 && (
                    <Badge
                      variant="outline"
                      className="text-amber-700 border-amber-300"
                    >
                      Provisional
                    </Badge>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-2 mt-2">
                {ff &&
                  ff.is_ff_provisional === 1 &&
                  ff.status !== "approved" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleVerify()}
                      disabled={acting}
                    >
                      {acting
                        ? "Working…"
                        : "Mark as Verified (Clear Provisional)"}
                    </Button>
                  )}
                {ff &&
                  ff.is_ff_provisional === 0 &&
                  ff.status !== "approved" && (
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700"
                      onClick={() => void handleApprove()}
                      disabled={acting}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      {acting ? "Approving…" : "Approve F&F"}
                    </Button>
                  )}
                {ff?.status === "approved" && (
                  <div className="flex items-center gap-2 text-sm text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" />
                    Approved — ready for disbursement
                  </div>
                )}
                {!ff && (
                  <p className="text-xs text-slate-500">
                    No F&amp;F calculation exists yet. Fill the form and save to
                    create one.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
