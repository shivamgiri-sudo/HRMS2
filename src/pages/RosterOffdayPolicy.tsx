import { useEffect, useState } from "react";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { formatDateTime } from "@/pages/ProcessLobMapping";
import { useManageableProcesses, useProcessLobOptions } from "@/hooks/useProcessLobMap";
import {
  FLOATING_OFFS_OPTIONS, MAX_FIXED_WEEKDAYS, OFF_TYPE_OPTIONS, WEEKDAYS, useCreateOffdayPolicy, useOffdayBranches,
  useOffdayPolicies, useOffdayPolicyDetail, useSetOffdayPolicyActive, useUpdateOffdayPolicy,
  type OffType, type OffdayPolicyRow,
} from "@/hooks/useRosterOffdayPolicy";

const PAGE_SIZE = 25;
const ALL = "__all__";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

/** 'YYYY-MM-DD' -> 'DD/MM/YYYY'. */
export function formatYmd(value: string | null | undefined): string {
  if (!value) return "None";
  const [y, m, d] = value.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : "None";
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">{children}</p>;
}

function summarize(p: Pick<OffdayPolicyRow, "off_type" | "fixed_weekdays_label" | "floating_offs_per_week">): string {
  return p.off_type === "FIXED_DAY"
    ? `Every ${p.fixed_weekdays_label ?? "None"}`
    : `${p.floating_offs_per_week ?? 0} off${p.floating_offs_per_week === 1 ? "" : "s"} per week, rotated`;
}

function effectiveRange(p: Pick<OffdayPolicyRow, "effective_from" | "effective_to">): string {
  return `${formatYmd(p.effective_from)} to ${p.effective_to ? formatYmd(p.effective_to) : "open-ended"}`;
}

// ── add / edit dialog ────────────────────────────────────────────────────────

function PolicyDialog({ open, editing, onClose }: { open: boolean; editing: OffdayPolicyRow | null; onClose: () => void }) {
  const isEdit = !!editing;
  const create = useCreateOffdayPolicy();
  const update = useUpdateOffdayPolicy();
  const branches = useOffdayBranches();
  const processes = useManageableProcesses({ page: 1, limit: 200 });
  const [processId, setProcessId] = useState("");
  const [lobId, setLobId] = useState(ALL);
  const [branchId, setBranchId] = useState(ALL);
  const [offType, setOffType] = useState<OffType>("FIXED_DAY");
  const [days, setDays] = useState<number[]>([]);
  const [offsPerWeek, setOffsPerWeek] = useState("1");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const lobOptions = useProcessLobOptions(isEdit ? "" : processId);

  useEffect(() => {
    if (!open) return;
    setProcessId(editing?.process_id ?? "");
    setLobId(editing?.lob_id ?? ALL);
    setBranchId(editing?.branch_id ?? ALL);
    setOffType(editing?.off_type ?? "FIXED_DAY");
    setDays(editing?.fixed_weekdays ?? []);
    setOffsPerWeek(String(editing?.floating_offs_per_week ?? 1));
    setFrom(editing?.effective_from ?? "");
    setTo(editing?.effective_to ?? "");
  }, [open, editing]);

  const toggleDay = (d: number) =>
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : cur.length >= MAX_FIXED_WEEKDAYS ? cur : [...cur, d].sort((a, b) => a - b)));

  const valid = !!processId && !!from && (offType === "FLOATING" || days.length >= 1) && (!to || to >= from);
  const busy = create.isPending || update.isPending;

  const submit = async () => {
    const shape = {
      off_type: offType,
      fixed_weekdays: offType === "FIXED_DAY" ? days : [],
      floating_offs_per_week: offType === "FLOATING" ? Number(offsPerWeek) : null,
      effective_from: from,
      effective_to: to || null,
    };
    try {
      if (editing) await update.mutateAsync({ id: editing.id, body: shape });
      else await create.mutateAsync({ process_id: processId, lob_id: lobId === ALL ? null : lobId, branch_id: branchId === ALL ? null : branchId, ...shape });
      toast.success(isEdit ? "Policy updated" : "Policy added");
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const processOptions = (processes.data?.items ?? []).map((p) => ({ value: p.id, label: p.process_name, hint: p.branch_name ?? undefined }));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit off-day policy" : "Add off-day policy"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Process, LOB and branch cannot be changed; add a new policy for a different scope." : "Applies to employees in this scope from the effective date."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Process</Label>
            {isEdit ? (
              <p className="mt-1 text-sm text-slate-800">{editing?.process_name}</p>
            ) : (
              <SearchableSelect options={processOptions} value={processId}
                onChange={(v) => { setProcessId(v); setLobId(ALL); }}
                placeholder="Select process" searchPlaceholder="Search process" loading={processes.isLoading} />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>LOB</Label>
              {isEdit ? <p className="mt-1 text-sm text-slate-800">{editing?.lob_name ?? "All LOBs"}</p> : (
                <Select value={lobId} onValueChange={setLobId} disabled={!processId}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="All LOBs" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All LOBs of the process</SelectItem>
                    {(lobOptions.data?.options ?? []).map((l) => <SelectItem key={l.lob_id} value={l.lob_id}>{l.lob_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div>
              <Label>Branch</Label>
              {isEdit ? <p className="mt-1 text-sm text-slate-800">{editing?.branch_name ?? "All branches"}</p> : (
                <Select value={branchId} onValueChange={setBranchId}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="All branches" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All branches</SelectItem>
                    {(branches.data ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <div>
            <Label>Off type</Label>
            <Select value={offType} onValueChange={(v) => setOffType(v as OffType)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{OFF_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {offType === "FIXED_DAY" ? (
            <div>
              <Label>Off weekday{MAX_FIXED_WEEKDAYS > 1 ? "s" : ""} (choose 1 or {MAX_FIXED_WEEKDAYS})</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {WEEKDAYS.map((name, d) => (
                  <label key={name} className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm cursor-pointer ${days.includes(d) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}>
                    <Checkbox checked={days.includes(d)} onCheckedChange={() => toggleDay(d)}
                      disabled={!days.includes(d) && days.length >= MAX_FIXED_WEEKDAYS} />
                    {name}
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <Label>Offs per week</Label>
              <Select value={offsPerWeek} onValueChange={setOffsPerWeek}>
                <SelectTrigger className="mt-1 w-32"><SelectValue /></SelectTrigger>
                <SelectContent>{FLOATING_OFFS_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
              </Select>
              <p className="mt-1 text-xs text-slate-500">Which days are off is decided by the existing preference and fairness allocation.</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="offday-from">Effective from</Label><Input id="offday-from" type="date" className="mt-1" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><Label htmlFor="offday-to">Effective to (optional)</Label><Input id="offday-to" type="date" className="mt-1" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!valid || busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : isEdit ? "Save changes" : "Add policy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── drill-down drawer ────────────────────────────────────────────────────────

function PolicyDrawer({ id, onClose, onEdit }: { id: string | null; onClose: () => void; onEdit: (p: OffdayPolicyRow) => void }) {
  const detail = useOffdayPolicyDetail(id);
  const setActive = useSetOffdayPolicyActive();
  const p = detail.data?.policy;

  const toggle = async () => {
    if (!p) return;
    if (p.active_status && !window.confirm("Deactivate this policy? Roster generation and import checks stop using it.")) return;
    try {
      await setActive.mutateAsync({ id: p.id, active: !p.active_status });
      toast.success(p.active_status ? "Policy deactivated" : "Policy reactivated");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const fields: Array<[string, string]> = p ? [
    ["Process", `${p.process_name}${p.process_code ? ` (${p.process_code})` : ""}`],
    ["LOB", p.lob_name ? `${p.lob_name} (${p.lob_code})` : "All LOBs of the process"],
    ["Branch", p.branch_name ?? "All branches"],
    ["Off type", p.off_type === "FIXED_DAY" ? "Fixed day" : "Floating"],
    ["Rule", summarize(p)],
    ["Effective", effectiveRange(p)],
    ["Employees in scope", String(detail.data?.employees_in_scope ?? 0)],
    ["Created", formatDateTime(p.created_at)],
    ["Last updated", formatDateTime(p.updated_at)],
    ["Policy ID", p.id],
  ] : [];

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full max-w-2xl sm:max-w-2xl p-0 flex flex-col">
        <SheetHeader className="px-5 pt-5 pb-3 border-b">
          <div className="flex items-center gap-2">
            <SheetTitle className="text-base">{p ? `${p.process_name}${p.lob_name ? ` / ${p.lob_name}` : ""}` : "Off-day policy"}</SheetTitle>
            {p && <Badge variant={p.active_status ? "default" : "secondary"}>{p.active_status ? "Active" : "Inactive"}</Badge>}
          </div>
          <p className="text-xs text-slate-500">{p ? `Created ${formatDateTime(p.created_at)}` : ""}</p>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {detail.isLoading && <div className="py-6 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-slate-400" /></div>}
          {detail.isError && <p className="text-sm text-red-600">Could not load policy detail.</p>}
          {p && detail.data && (
            <>
              <div>
                <SectionLabel>Policy</SectionLabel>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  {fields.map(([k, v]) => <div key={k}><dt className="text-xs text-slate-400">{k}</dt><dd className="text-slate-800 break-all">{v}</dd></div>)}
                </dl>
              </div>
              <div>
                <SectionLabel>Actions</SectionLabel>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => onEdit(p)}><Pencil className="h-3.5 w-3.5 mr-1" />Edit</Button>
                  <Button size="sm" variant="outline" onClick={toggle} disabled={setActive.isPending}>{p.active_status ? "Deactivate" : "Reactivate"}</Button>
                </div>
              </div>
              <div>
                <SectionLabel>Audit trail</SectionLabel>
                {detail.data.audit.length === 0 ? <p className="text-sm text-slate-400">None</p> : (
                  <ul className="space-y-2">
                    {detail.data.audit.map((a) => (
                      <li key={a.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                        <span className="font-medium text-slate-800">{a.action_type}</span>
                        <span className="text-slate-500"> by {a.actor_email ?? a.actor_user_id} </span>
                        <span className="text-xs text-slate-400">{formatDateTime(a.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function RosterOffdayPolicy() {
  const [processId, setProcessId] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; editing: OffdayPolicyRow | null }>({ open: false, editing: null });
  const processes = useManageableProcesses({ page: 1, limit: 200 });
  const query = useOffdayPolicies({ process_id: processId || undefined, include_inactive: includeInactive, page, limit: PAGE_SIZE });
  const rows = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Roster Off-day Policy</h1>
            <p className="text-sm text-slate-500">Set a fixed weekly off or a floating number of offs per week for a process, LOB or branch. With no policy, rosters behave exactly as before.</p>
          </div>
          <Button onClick={() => setDialog({ open: true, editing: null })}><Plus className="h-4 w-4 mr-1" />Add policy</Button>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64">
            <SearchableSelect
              options={[{ value: "", label: "All processes" }, ...(processes.data?.items ?? []).map((p) => ({ value: p.id, label: p.process_name, hint: p.branch_name ?? undefined }))]}
              value={processId} onChange={(v) => { setProcessId(v); setPage(1); }} placeholder="All processes" searchPlaceholder="Search process" />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <Checkbox checked={includeInactive} onCheckedChange={(c) => { setIncludeInactive(c === true); setPage(1); }} />
            Show inactive
          </label>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Process</TableHead><TableHead>LOB</TableHead><TableHead>Branch</TableHead>
                <TableHead>Off type</TableHead><TableHead>Days / count</TableHead><TableHead>Effective</TableHead><TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-slate-400" /></TableCell></TableRow>
              ) : query.isError ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-red-600">{errMsg(query.error)}</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-slate-500">No off-day policies in your scope. Rosters use the existing week-off rules.</TableCell></TableRow>
              ) : rows.map((p) => (
                <TableRow key={p.id} className={`cursor-pointer ${p.active_status ? "" : "opacity-60"}`} onClick={() => setDrawer(p.id)}>
                  <TableCell className="font-medium text-slate-800">{p.process_name}</TableCell>
                  <TableCell className="text-sm text-slate-600">{p.lob_name ?? "All LOBs"}</TableCell>
                  <TableCell className="text-sm text-slate-600">{p.branch_name ?? "All branches"}</TableCell>
                  <TableCell><Badge variant="secondary">{p.off_type === "FIXED_DAY" ? "Fixed day" : "Floating"}</Badge></TableCell>
                  <TableCell className="text-sm text-slate-600">{summarize(p)}</TableCell>
                  <TableCell className="text-sm text-slate-600 whitespace-nowrap">{effectiveRange(p)}</TableCell>
                  <TableCell><Badge variant={p.active_status ? "default" : "secondary"}>{p.active_status ? "Active" : "Inactive"}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{total} polic{total === 1 ? "y" : "ies"}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button size="sm" variant="outline" disabled={page * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>

        <PolicyDialog open={dialog.open} editing={dialog.editing} onClose={() => setDialog({ open: false, editing: null })} />
        <PolicyDrawer id={drawer} onClose={() => setDrawer(null)} onEdit={(p) => setDialog({ open: true, editing: p })} />
      </div>
    </DashboardLayout>
  );
}
