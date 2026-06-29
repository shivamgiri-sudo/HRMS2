import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";

const ALLOWED_ROLES = ["super_admin", "admin", "payroll_head", "payroll_branch"];

const TYPE_BADGE: Record<string, string> = {
  national: "bg-blue-100 text-blue-800",
  regional: "bg-purple-100 text-purple-800",
  restricted: "bg-gray-100 text-gray-800",
  process_specific: "bg-orange-100 text-orange-800",
};

const api = (path: string, opts?: RequestInit) =>
  fetch(`/api${path}`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}`, "Content-Type": "application/json" }, ...opts });

export default function HolidayMaster() {
  const { user } = useAuth();
  const [ccRow, setCcRow] = useState<number | null>(null);
  const [desRow, setDesRow] = useState<number | null>(null);
  const [ccForm, setCcForm] = useState({ branch_id: "", process_id: "", cost_centre_id: "", department_id: "", applies_to_all_in_scope: false });
  const [desForm, setDesForm] = useState({ designation_id: "", applies_to_all_designations: false });

  const { data: holidays = [] } = useQuery({
    queryKey: ["holiday-master"],
    queryFn: () => api("/payroll/holiday-master").then(r => r.json()),
  });

  const ccMutation = useMutation({
    mutationFn: (body: object) => api("/payroll/holiday-master/cc-mapping", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => setCcRow(null),
  });

  const desMutation = useMutation({
    mutationFn: (body: object) => api("/payroll/holiday-master/designation-mapping", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => setDesRow(null),
  });

  if (!user || !ALLOWED_ROLES.includes(user.role)) {
    return <div className="p-6 text-red-500">Access denied.</div>;
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Holiday Master</h1>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                {["Date", "Name", "Type", "Branch", "Active", "Actions"].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {holidays.map((h: any) => (
                <tr key={h.id} className="border-b hover:bg-muted/20">
                  <td className="px-4 py-2">{h.holiday_date}</td>
                  <td className="px-4 py-2">{h.holiday_name}</td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${TYPE_BADGE[h.holiday_type] ?? "bg-gray-100 text-gray-600"}`}>
                      {h.holiday_type}
                    </span>
                  </td>
                  <td className="px-4 py-2">{h.branch_name ?? h.branch_id ?? "—"}</td>
                  <td className="px-4 py-2">
                    <Badge variant={h.active_status ? "default" : "secondary"}>{h.active_status ? "Active" : "Inactive"}</Badge>
                  </td>
                  <td className="px-4 py-2 space-x-2">
                    <Button size="sm" variant="outline" onClick={() => { setCcRow(h.id); setCcForm({ branch_id: "", process_id: "", cost_centre_id: "", department_id: "", applies_to_all_in_scope: false }); }}>
                      Add CC Mapping
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setDesRow(h.id); setDesForm({ designation_id: "", applies_to_all_designations: false }); }}>
                      Add Designation Mapping
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={ccRow !== null} onOpenChange={open => !open && setCcRow(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add CC Mapping</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {(["branch_id", "process_id", "cost_centre_id", "department_id"] as const).map(f => (
              <Input key={f} placeholder={f.replace(/_/g, " ")} value={ccForm[f]} onChange={e => setCcForm(p => ({ ...p, [f]: e.target.value }))} />
            ))}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={ccForm.applies_to_all_in_scope} onChange={e => setCcForm(p => ({ ...p, applies_to_all_in_scope: e.target.checked }))} />
              Applies to all in scope
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCcRow(null)}>Cancel</Button>
            <Button disabled={ccMutation.isPending} onClick={() => ccMutation.mutate({ holiday_id: ccRow, ...ccForm })}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={desRow !== null} onOpenChange={open => !open && setDesRow(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Designation Mapping</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <Input placeholder="Designation ID" value={desForm.designation_id} onChange={e => setDesForm(p => ({ ...p, designation_id: e.target.value }))} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={desForm.applies_to_all_designations} onChange={e => setDesForm(p => ({ ...p, applies_to_all_designations: e.target.checked }))} />
              Applies to all designations
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDesRow(null)}>Cancel</Button>
            <Button disabled={desMutation.isPending} onClick={() => desMutation.mutate({ holiday_id: desRow, ...desForm })}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
