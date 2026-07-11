import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useWorkforceAccess } from "@/hooks/useUserRole";

const ALLOWED_ROLES = ["wfm", "admin", "super_admin", "payroll_head"];

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  approved: "default",
  payroll_head_approved: "default",
  superadmin_approved: "default",
  submitted: "secondary",
  pending: "secondary",
  rejected: "destructive",
  cancelled: "destructive",
};

export default function HolidayWorkRequest() {
  const { roleKeys } = useWorkforceAccess();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    holiday_id: "",
    branch_id: "",
    process_id: "",
    cost_centre_id: "",
    policy_id: "",
    request_reason: "",
    remarks: "",
  });
  const [desInput, setDesInput] = useState("");
  const [designationIds, setDesignationIds] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const { data: holidays = [] } = useQuery({
    queryKey: ["holiday-master-active"],
    queryFn: () => hrmsApi.get<any>("/api/payroll/holiday-master").then((d: any) => Array.isArray(d) ? d : d.data ?? []),
  });

  const { data: policies = [] } = useQuery({
    queryKey: ["holiday-work-policies"],
    queryFn: () => hrmsApi.get<any>("/api/payroll/holiday-work/policies").then((d: any) => Array.isArray(d) ? d : d.data ?? []),
  });

  const { data: branches = [] } = useQuery({
    queryKey: ["org-branches"],
    queryFn: () => hrmsApi.get<any>("/api/org/branches").then((d: any) => Array.isArray(d) ? d : d.data ?? []),
  });

  const { data: processes = [] } = useQuery({
    queryKey: ["org-processes"],
    queryFn: () => hrmsApi.get<any>("/api/org/processes").then((d: any) => Array.isArray(d) ? d : d.data ?? []),
  });

  const { data: requests = [], refetch: refetchRequests } = useQuery({
    queryKey: ["holiday-work-requests"],
    queryFn: () => hrmsApi.get<any>("/api/payroll/holiday-work/requests").then((d: any) => Array.isArray(d) ? d : d.data ?? []),
  });

  const submit = useMutation({
    mutationFn: () => hrmsApi.post("/api/payroll/holiday-work/requests", {
      holiday_id: form.holiday_id,
      branch_id: form.branch_id || null,
      process_id: form.process_id || null,
      cost_centre_id: form.cost_centre_id || null,
      payout_policy_id: form.policy_id,
      request_reason: form.request_reason || form.remarks,
      remarks: form.remarks,
      designation_ids: designationIds,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["holiday-work-requests"] });
      setForm({ holiday_id: "", branch_id: "", process_id: "", cost_centre_id: "", policy_id: "", request_reason: "", remarks: "" });
      setDesignationIds([]);
      setSubmitError(null);
      setSubmitSuccess(true);
      setTimeout(() => setSubmitSuccess(false), 3000);
    },
    onError: (e: any) => setSubmitError(e.message ?? "Submission failed"),
  });

  if (!ALLOWED_ROLES.some(r => roleKeys.includes(r))) {
    return (
      <DashboardLayout>
        <div className="p-8 text-red-600">Access denied.</div>
      </DashboardLayout>
    );
  }

  const addDesignation = () => {
    const v = desInput.trim();
    if (v && !designationIds.includes(v)) setDesignationIds(p => [...p, v]);
    setDesInput("");
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Holiday Work Request</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Submit a request to pay employees who worked on a designated holiday. Requires payout policy and multi-stage approval.</p>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">New Request</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Holiday <span className="text-red-500">*</span></label>
                <select
                  className="w-full border rounded px-3 py-2 text-sm bg-background"
                  value={form.holiday_id}
                  onChange={e => setForm(p => ({ ...p, holiday_id: e.target.value }))}
                >
                  <option value="">Select holiday</option>
                  {(holidays as any[]).map((h: any) => (
                    <option key={h.id} value={h.id}>{h.holiday_date?.slice(0, 10)} — {h.holiday_name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Payout Policy <span className="text-red-500">*</span></label>
                <select
                  className="w-full border rounded px-3 py-2 text-sm bg-background"
                  value={form.policy_id}
                  onChange={e => setForm(p => ({ ...p, policy_id: e.target.value }))}
                >
                  <option value="">Select policy</option>
                  {(policies as any[]).map((p: any) => (
                    <option key={p.id} value={p.id}>{p.policy_name} — {p.payout_type}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Branch</label>
                <select
                  className="w-full border rounded px-3 py-2 text-sm bg-background"
                  value={form.branch_id}
                  onChange={e => setForm(p => ({ ...p, branch_id: e.target.value }))}
                >
                  <option value="">All branches</option>
                  {(branches as any[]).map((b: any) => (
                    <option key={b.id} value={b.id}>{b.branch_name ?? b.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Process</label>
                <select
                  className="w-full border rounded px-3 py-2 text-sm bg-background"
                  value={form.process_id}
                  onChange={e => setForm(p => ({ ...p, process_id: e.target.value }))}
                >
                  <option value="">All processes</option>
                  {(processes as any[]).map((proc: any) => (
                    <option key={proc.id} value={proc.id}>{proc.process_name ?? proc.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Eligible Designations <span className="text-xs text-muted-foreground">(optional — leave empty for all)</span></label>
              <div className="flex gap-2">
                <input
                  className="flex-1 border rounded px-3 py-2 text-sm bg-background"
                  placeholder="Enter designation ID and press Add"
                  value={desInput}
                  onChange={e => setDesInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addDesignation())}
                />
                <Button type="button" variant="outline" onClick={addDesignation}>Add</Button>
              </div>
              {designationIds.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {designationIds.map(d => (
                    <Badge key={d} variant="secondary" className="cursor-pointer text-xs" onClick={() => setDesignationIds(p => p.filter(x => x !== d))}>
                      {d} ×
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Reason / Remarks</label>
              <Textarea
                placeholder="Describe the business need for holiday work…"
                value={form.request_reason}
                onChange={e => setForm(p => ({ ...p, request_reason: e.target.value }))}
                rows={3}
              />
            </div>

            {submitError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{submitError}</p>}
            {submitSuccess && <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">Request submitted successfully.</p>}

            <Button
              disabled={submit.isPending || !form.holiday_id || !form.policy_id}
              onClick={() => submit.mutate()}
            >
              {submit.isPending ? "Submitting…" : "Submit Request"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base">Submitted Requests</CardTitle>
            <Button size="sm" variant="ghost" onClick={() => refetchRequests()}>Refresh</Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    {["Holiday", "Branch", "Process", "Policy", "Designations", "Status", "Submitted At"].map(h => (
                      <th key={h} className="px-4 py-3 text-left font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(requests as any[]).map((r: any) => (
                    <tr key={r.id} className="border-b hover:bg-muted/20">
                      <td className="px-4 py-2 whitespace-nowrap">
                        <div className="font-medium">{r.holiday_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{r.holiday_date?.slice(0, 10) ?? ""}</div>
                      </td>
                      <td className="px-4 py-2 text-xs">{r.branch_id ?? "All"}</td>
                      <td className="px-4 py-2 text-xs">{r.process_id ?? "All"}</td>
                      <td className="px-4 py-2 text-xs">
                        <div>{r.policy_name ?? r.payout_policy_id ?? "—"}</div>
                        {r.payout_type && <div className="text-muted-foreground">{r.payout_type}</div>}
                      </td>
                      <td className="px-4 py-2 text-xs">{r.designation_count ?? (Array.isArray(r.designation_ids) ? r.designation_ids.length : "—")}</td>
                      <td className="px-4 py-2">
                        <Badge variant={STATUS_VARIANT[r.status] ?? "outline"} className="text-xs">
                          {r.status?.replace(/_/g, " ")}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {r.created_at ? new Date(r.created_at).toLocaleString("en-IN") : "—"}
                      </td>
                    </tr>
                  ))}
                  {(requests as any[]).length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">No requests found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
