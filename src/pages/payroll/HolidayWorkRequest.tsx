import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";

const ALLOWED_ROLES = ["wfm", "admin", "super_admin"];

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  approved: "default",
  pending: "secondary",
  rejected: "destructive",
};

const api = (path: string, opts?: RequestInit) =>
  fetch(`/api${path}`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}`, "Content-Type": "application/json" }, ...opts });

export default function HolidayWorkRequest() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    holiday_id: "",
    branch_id: "",
    process_id: "",
    cost_centre_id: "",
    policy_id: "",
    remarks: "",
  });
  const [desInput, setDesInput] = useState("");
  const [designationIds, setDesignationIds] = useState<string[]>([]);

  const { data: holidays = [] } = useQuery({ queryKey: ["holiday-master"], queryFn: () => api("/payroll/holiday-master").then(r => r.json()) });
  const { data: policies = [] } = useQuery({ queryKey: ["holiday-work-policies"], queryFn: () => api("/payroll/holiday-work/policies").then(r => r.json()) });
  const { data: requests = [] } = useQuery({ queryKey: ["holiday-work-requests"], queryFn: () => api("/payroll/holiday-work/requests").then(r => r.json()) });

  const submit = useMutation({
    mutationFn: () => api("/payroll/holiday-work/requests", { method: "POST", body: JSON.stringify({ ...form, designation_ids: designationIds }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["holiday-work-requests"] });
      setForm({ holiday_id: "", branch_id: "", process_id: "", cost_centre_id: "", policy_id: "", remarks: "" });
      setDesignationIds([]);
    },
  });

  if (!user || !ALLOWED_ROLES.includes(user.role)) {
    return <div className="p-6 text-red-500">Access denied.</div>;
  }

  const addDesignation = () => {
    const v = desInput.trim();
    if (v && !designationIds.includes(v)) setDesignationIds(p => [...p, v]);
    setDesInput("");
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Holiday Work Request</h1>

      <Card>
        <CardContent className="pt-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Holiday</label>
              <select className="w-full border rounded px-3 py-2 text-sm bg-background" value={form.holiday_id} onChange={e => setForm(p => ({ ...p, holiday_id: e.target.value }))}>
                <option value="">Select holiday</option>
                {holidays.map((h: any) => <option key={h.id} value={h.id}>{h.holiday_date} — {h.holiday_name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Policy</label>
              <select className="w-full border rounded px-3 py-2 text-sm bg-background" value={form.policy_id} onChange={e => setForm(p => ({ ...p, policy_id: e.target.value }))}>
                <option value="">Select policy</option>
                {policies.map((p: any) => <option key={p.id} value={p.id}>{p.policy_name} ({p.payout_type})</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Branch ID</label>
              <Input value={form.branch_id} onChange={e => setForm(p => ({ ...p, branch_id: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Process ID</label>
              <Input value={form.process_id} onChange={e => setForm(p => ({ ...p, process_id: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Cost Centre ID (optional)</label>
              <Input value={form.cost_centre_id} onChange={e => setForm(p => ({ ...p, cost_centre_id: e.target.value }))} />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Designations</label>
            <div className="flex gap-2">
              <Input placeholder="Enter designation ID" value={desInput} onChange={e => setDesInput(e.target.value)} onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addDesignation())} />
              <Button type="button" variant="outline" onClick={addDesignation}>Add</Button>
            </div>
            {designationIds.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {designationIds.map(d => (
                  <Badge key={d} variant="secondary" className="cursor-pointer" onClick={() => setDesignationIds(p => p.filter(x => x !== d))}>
                    {d} ×
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Remarks</label>
            <Textarea value={form.remarks} onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))} rows={3} />
          </div>

          <Button disabled={submit.isPending} onClick={() => submit.mutate()}>Submit Request</Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                {["Holiday Date", "Branch", "Process", "Designations", "Policy", "Status", "Submitted At"].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requests.map((r: any) => (
                <tr key={r.id} className="border-b hover:bg-muted/20">
                  <td className="px-4 py-2">{r.holiday_date}</td>
                  <td className="px-4 py-2">{r.branch_id}</td>
                  <td className="px-4 py-2">{r.process_id}</td>
                  <td className="px-4 py-2">{Array.isArray(r.designation_ids) ? r.designation_ids.length : r.designation_count ?? "—"}</td>
                  <td className="px-4 py-2">{r.policy_name ?? r.policy_id}</td>
                  <td className="px-4 py-2">
                    <Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status}</Badge>
                  </td>
                  <td className="px-4 py-2">{r.submitted_at ? new Date(r.submitted_at).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
