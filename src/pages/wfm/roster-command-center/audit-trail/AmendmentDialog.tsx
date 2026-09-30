import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi as api } from "@/lib/hrmsApi";
import { ASSIGNMENT_TYPE_OPTIONS, daysInRange, fmtDate, fmtWeek } from "./auditModel";

interface Options {
  cycles: Array<{ id: string; status: string; weekStart: string; weekEnd: string; processName: string | null; branchName: string | null }>;
  employees: Array<{ id: string; code: string; name: string }>;
  shifts: Array<{ id: string; code: string; name: string; startTime: string; endTime: string }>;
}

const MIN_REASON = 5;

/** Post-publication amendment form. Every closed-set field is a dropdown; the API needs cycle + employee + date + type (+ shift) + reason. */
export function AmendmentDialog({ open, onOpenChange, scope }: { open: boolean; onOpenChange: (o: boolean) => void; scope: URLSearchParams }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [cycleId, setCycleId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState("");
  const [type, setType] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [reason, setReason] = useState("");

  const reset = () => { setCycleId(""); setEmployeeId(""); setDate(""); setType(""); setShiftId(""); setReason(""); };
  useEffect(() => { if (!open) reset(); }, [open]);
  // Changing the cycle invalidates every dependent choice.
  useEffect(() => { setEmployeeId(""); setDate(""); setShiftId(""); }, [cycleId]);
  useEffect(() => { if (type !== "SHIFT") setShiftId(""); }, [type]);

  const scopeKey = scope.toString();
  const opts = useQuery({
    queryKey: ["roster-audit-amendment-options", scopeKey, cycleId],
    queryFn: async () => {
      const p = new URLSearchParams();
      const b = scope.get("branchId"); const pr = scope.get("processId");
      if (b) p.set("branchId", b);
      if (pr) p.set("processId", pr);
      if (cycleId) p.set("cycleId", cycleId);
      return (await api.get(`/api/roster-audit/amendment-options?${p}`)) as Options;
    },
    enabled: open,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const cycle = opts.data?.cycles.find((c) => c.id === cycleId);
  const days = useMemo(() => (cycle ? daysInRange(cycle.weekStart.slice(0, 10), cycle.weekEnd.slice(0, 10)) : []), [cycle]);
  const reasonOk = reason.trim().length >= MIN_REASON;
  const valid = !!cycleId && !!employeeId && !!date && !!type && (type !== "SHIFT" || !!shiftId) && reasonOk;

  const save = useMutation({
    mutationFn: async () => (await api.post(`/api/roster-gov/cycles/${cycleId}/amendments`, {
      employeeId, date, newAssignmentType: type, newShiftId: type === "SHIFT" ? shiftId : undefined, reason: reason.trim(),
    })).data,
    onSuccess: () => {
      toast({ title: "Amendment recorded", description: "It now appears in the audit trail." });
      qc.invalidateQueries({ queryKey: ["roster-audit-trails"] });
      qc.invalidateQueries({ queryKey: ["roster-audit-summary"] });
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Could not record amendment", description: e?.message ?? "Unknown error", variant: "destructive" }),
  });

  const field = "space-y-1.5";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Record post-publication amendment</DialogTitle>
          <DialogDescription>Only published, acknowledged or active roster cycles can be amended. The change and its reason are logged in the audit trail.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className={field}>
            <Label htmlFor="amend-cycle">Roster cycle</Label>
            <Select value={cycleId} onValueChange={setCycleId}>
              <SelectTrigger id="amend-cycle" className="min-h-[44px] sm:min-h-10"><SelectValue placeholder={opts.isLoading ? "Loading cycles..." : "Select a published cycle"} /></SelectTrigger>
              <SelectContent>
                {(opts.data?.cycles ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{`${c.processName ?? "Process"} · ${c.branchName ?? "All branches"} · ${fmtWeek(c.weekStart, c.weekEnd)} · ${c.status}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {opts.isError && <p className="text-xs text-red-800" role="alert">Could not load cycles.</p>}
            {!opts.isLoading && !opts.isError && !(opts.data?.cycles.length) && <p className="text-xs text-slate-600">No published cycles in the selected branch/process.</p>}
          </div>
          <div className={field}>
            <Label htmlFor="amend-employee">Employee</Label>
            <SearchableSelect id="amend-employee" aria-label="Employee" disabled={!cycleId} loading={!!cycleId && opts.isFetching}
              options={(opts.data?.employees ?? []).map((e) => ({ value: e.id, label: e.name, hint: e.code, keywords: e.code }))}
              value={employeeId} onChange={setEmployeeId} placeholder={cycleId ? "Select employee" : "Select a cycle first"} searchPlaceholder="Search name or code" emptyText="No rostered employees" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={field}>
              <Label htmlFor="amend-date">Roster date</Label>
              <Select value={date} onValueChange={setDate} disabled={!cycleId}>
                <SelectTrigger id="amend-date" className="min-h-[44px] sm:min-h-10"><SelectValue placeholder="Select date" /></SelectTrigger>
                <SelectContent>{days.map((d) => <SelectItem key={d} value={d}>{fmtDate(d)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className={field}>
              <Label htmlFor="amend-type">New assignment</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="amend-type" className="min-h-[44px] sm:min-h-10"><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>{ASSIGNMENT_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {type === "SHIFT" && (
            <div className={field}>
              <Label htmlFor="amend-shift">New shift</Label>
              <Select value={shiftId} onValueChange={setShiftId}>
                <SelectTrigger id="amend-shift" className="min-h-[44px] sm:min-h-10"><SelectValue placeholder="Select shift" /></SelectTrigger>
                <SelectContent>{(opts.data?.shifts ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{`${s.name} (${s.startTime.slice(0, 5)}-${s.endTime.slice(0, 5)})`}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className={field}>
            <Label htmlFor="amend-reason">Reason</Label>
            <Textarea id="amend-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} placeholder="What changed and why (minimum 5 characters)" aria-invalid={reason.length > 0 && !reasonOk} />
            <p className="text-right text-[11px] tabular-nums text-slate-600">{reason.length}/500</p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" className="min-h-[44px] cursor-pointer sm:min-h-10" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" className="min-h-[44px] cursor-pointer sm:min-h-10" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}
            {save.isPending ? "Saving..." : "Save amendment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
