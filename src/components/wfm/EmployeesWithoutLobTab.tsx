import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useBranches } from "@/hooks/useOrgMasters";
import {
  useBulkAssignLob, useEmployeesWithoutLob, useWithoutLobSummary, type WithoutLobSummaryRow,
} from "@/hooks/useProcessLobMap";

const PAGE_SIZE = 25;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

function EmployeesDrawer({ row, onClose }: { row: WithoutLobSummaryRow | null; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<string[]>([]);
  const [lobId, setLobId] = useState("");
  const list = useEmployeesWithoutLob({ process_id: row?.process_id, page, limit: PAGE_SIZE });
  const bulk = useBulkAssignLob();
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const lobOptions = (row?.lobs ?? []).map((l) => ({ value: l.lob_id, label: l.lob_name, hint: l.lob_code }));

  const run = async (ids?: string[]) => {
    if (!row || !lobId) return;
    try {
      const res = await bulk.mutateAsync({ process_id: row.process_id, lob_id: lobId, employee_ids: ids });
      toast.success(`${res.updated} employee(s) updated${res.skipped ? `, ${res.skipped} skipped` : ""}${res.remaining ? `, ${res.remaining} still remaining (run again)` : ""}`);
      setPicked([]);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const toggle = (id: string, on: boolean) => setPicked((p) => (on ? [...p, id] : p.filter((x) => x !== id)));

  return (
    <Sheet open={!!row} onOpenChange={(o) => { if (!o) { setPicked([]); setLobId(""); setPage(1); onClose(); } }}>
      <SheetContent side="right" className="w-full max-w-2xl sm:max-w-2xl p-0 flex flex-col">
        <SheetHeader className="px-5 pt-5 pb-3 border-b">
          <SheetTitle className="text-base">{row?.process_name}</SheetTitle>
          <p className="text-xs text-slate-500">{row?.branch_name ?? "No branch"} · {row?.employees_without_lob} employees without LOB</p>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Assign LOB</p>
            {lobOptions.length === 0 ? (
              <p className="text-sm text-amber-700">No LOB is mapped to this process yet. Add one on the Process LOBs tab first.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-56">
                  <SearchableSelect options={lobOptions} value={lobId} onChange={setLobId} placeholder="Select LOB" searchPlaceholder="Search LOB" />
                </div>
                <Button size="sm" disabled={!lobId || picked.length === 0 || bulk.isPending} onClick={() => run(picked)}>
                  Assign selected ({picked.length})
                </Button>
                <Button size="sm" variant="outline" disabled={!lobId || bulk.isPending}
                  onClick={() => window.confirm(`Assign this LOB to all ${row?.employees_without_lob} employees without a LOB in this process?`) && run()}>
                  {bulk.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Assign all in process"}
                </Button>
              </div>
            )}
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Employees</p>
            <Table>
              <TableHeader><TableRow><TableHead className="w-10" /><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Branch</TableHead></TableRow></TableHeader>
              <TableBody>
                {list.isLoading ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-6"><Loader2 className="h-5 w-5 animate-spin mx-auto text-slate-400" /></TableCell></TableRow>
                ) : items.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-6 text-sm text-slate-400">None</TableCell></TableRow>
                ) : items.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell><Checkbox aria-label={`Select ${e.employee_code}`} checked={picked.includes(e.id)} onCheckedChange={(c) => toggle(e.id, c === true)} /></TableCell>
                    <TableCell className="text-sm">{e.employee_code}</TableCell>
                    <TableCell className="text-sm">{e.full_name}</TableCell>
                    <TableCell className="text-sm text-slate-500">{e.branch_name ?? "None"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
              <span>{total} total</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <Button size="sm" variant="outline" disabled={page * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function EmployeesWithoutLobTab() {
  const [branchId, setBranchId] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const branches = useBranches();
  const summary = useWithoutLobSummary(branchId || undefined);
  const bulk = useBulkAssignLob();
  const rows = summary.data ?? [];
  const openRow = rows.find((r) => r.process_id === open) ?? null;

  const applyToAll = async (r: WithoutLobSummaryRow) => {
    const lob = r.lobs[0];
    if (!lob || !window.confirm(`Apply "${lob.lob_name}" to all ${r.employees_without_lob} employees of ${r.process_name}?`)) return;
    try {
      const res = await bulk.mutateAsync({ process_id: r.process_id, lob_id: lob.lob_id });
      toast.success(`${res.updated} employee(s) updated${res.remaining ? `, ${res.remaining} still remaining (run again)` : ""}`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="w-56">
        <SearchableSelect
          options={[{ value: "", label: "All branches" }, ...(branches.data ?? []).map((b: any) => ({ value: b.id, label: b.branch_name ?? b.name ?? b.id }))]}
          value={branchId} onChange={setBranchId} placeholder="All branches" searchPlaceholder="Search branch" />
      </div>
      <div className="rounded-lg border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Branch</TableHead><TableHead>Process</TableHead>
              <TableHead className="text-right">Without LOB</TableHead><TableHead>Mapped LOBs</TableHead><TableHead className="w-40" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.isLoading ? (
              <TableRow><TableCell colSpan={5} className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-slate-400" /></TableCell></TableRow>
            ) : summary.isError ? (
              <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-red-600">{errMsg(summary.error)}</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-slate-500">Every active employee in your scope has a LOB.</TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow key={r.process_id} className="cursor-pointer" onClick={() => setOpen(r.process_id)}>
                <TableCell className="text-sm text-slate-600">{r.branch_name ?? "None"}</TableCell>
                <TableCell className="font-medium text-slate-800">{r.process_name}</TableCell>
                <TableCell className="text-right tabular-nums">{r.employees_without_lob.toLocaleString("en-IN")}</TableCell>
                <TableCell className="text-sm text-slate-600">{r.lobs.length ? r.lobs.map((l) => l.lob_name).join(", ") : <span className="text-slate-400">None mapped</span>}</TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {r.lobs.length === 1 && (
                    <Button size="sm" variant="outline" disabled={bulk.isPending} onClick={() => applyToAll(r)}>Apply to all</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <EmployeesDrawer key={open ?? "none"} row={openRow} onClose={() => setOpen(null)} />
    </div>
  );
}
