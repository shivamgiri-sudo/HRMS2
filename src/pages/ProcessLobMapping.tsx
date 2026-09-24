import { useState } from "react";
import { Loader2, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { EmployeesWithoutLobTab } from "@/components/wfm/EmployeesWithoutLobTab";
import { useBranches } from "@/hooks/useOrgMasters";
import {
  useActiveLobs, useAddMapping, useCreateLob, useManageableProcesses, useMappingDetail,
  useSetMappingActive, type ProcessRow,
} from "@/hooks/useProcessLobMap";

const PAGE_SIZE = 25;

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "None";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "None";
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    hour12: false, timeZone: "Asia/Kolkata",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">{children}</p>;
}

function NewLobDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const createLob = useCreateLob();
  const submit = async () => {
    try {
      const lob = await createLob.mutateAsync({ lob_name: name.trim() });
      toast.success(`LOB "${lob.lob_name}" created`);
      setName("");
      onCreated(lob.id);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add new LOB</DialogTitle>
          <DialogDescription>Creates a LOB in the shared list. The code is generated from the name.</DialogDescription>
        </DialogHeader>
        <div>
          <Label htmlFor="new-lob-name">LOB name</Label>
          <Input id="new-lob-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={255} className="mt-1" autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={name.trim().length < 2 || createLob.isPending}>
            {createLob.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create LOB"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddLobDialog({ process, onClose }: { process: ProcessRow | null; onClose: () => void }) {
  const lobs = useActiveLobs();
  const addMapping = useAddMapping();
  const [lobId, setLobId] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const mapped = new Set((process?.lobs ?? []).filter((l) => l.active_status === 1).map((l) => l.lob_id));
  const options = (lobs.data ?? []).filter((l) => !mapped.has(l.id))
    .map((l) => ({ value: l.id, label: l.lob_name, hint: l.lob_code }));

  const close = () => { setLobId(""); onClose(); };
  const submit = async () => {
    if (!process || !lobId) return;
    try {
      await addMapping.mutateAsync({ process_id: process.id, lob_id: lobId });
      toast.success("LOB mapped to process");
      close();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <>
      <Dialog open={!!process} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add LOB to {process?.process_name}</DialogTitle>
            <DialogDescription>Employees of this process can then be assigned this LOB.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>LOB</Label>
            <SearchableSelect
              options={options}
              value={lobId}
              onChange={setLobId}
              placeholder="Select LOB"
              searchPlaceholder="Search LOB"
              emptyText="No more LOBs available"
              loading={lobs.isLoading}
            />
            <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => setNewOpen(true)}>
              LOB not in the list? Add new LOB
            </button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button onClick={submit} disabled={!lobId || addMapping.isPending}>
              {addMapping.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add LOB"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <NewLobDialog open={newOpen} onClose={() => setNewOpen(false)} onCreated={(id) => { setLobId(id); setNewOpen(false); }} />
    </>
  );
}

function MappingDetailBlock({ mapId }: { mapId: string }) {
  const detail = useMappingDetail(mapId);
  if (detail.isLoading) return <div className="py-6 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-slate-400" /></div>;
  if (detail.isError || !detail.data) return <p className="text-sm text-red-600">Could not load mapping detail.</p>;
  const { mapping: m, audit, employees_with_lob } = detail.data;
  const fields: Array<[string, string]> = [
    ["LOB", `${m.lob_name} (${m.lob_code})`],
    ["LOB master status", m.lob_active ? "Active" : "Inactive"],
    ["Mapping status", m.active_status ? "Active" : "Inactive"],
    ["Employees on this LOB", String(employees_with_lob)],
    ["Created", formatDateTime(m.created_at)],
    ["Last updated", formatDateTime(m.updated_at)],
    ["Mapping ID", m.id],
  ];
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        {fields.map(([k, v]) => (
          <div key={k}><dt className="text-xs text-slate-400">{k}</dt><dd className="text-slate-800 break-all">{v}</dd></div>
        ))}
      </dl>
      <div>
        <SectionLabel>Audit trail</SectionLabel>
        {audit.length === 0 ? <p className="text-sm text-slate-400">None</p> : (
          <ul className="space-y-2">
            {audit.map((a) => (
              <li key={a.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                <span className="font-medium text-slate-800">{a.action_type}</span>
                <span className="text-slate-500"> by {a.actor_email ?? a.actor_user_id} </span>
                <span className="text-xs text-slate-400">{formatDateTime(a.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ProcessDrawer({ process, onClose }: { process: ProcessRow | null; onClose: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const activeMapId = selected ?? process?.lobs[0]?.map_id ?? null;
  return (
    <Sheet open={!!process} onOpenChange={(o) => { if (!o) { setSelected(null); onClose(); } }}>
      <SheetContent side="right" className="w-full max-w-2xl sm:max-w-2xl p-0 flex flex-col">
        <SheetHeader className="px-5 pt-5 pb-3 border-b">
          <SheetTitle className="text-base">{process?.process_name}</SheetTitle>
          <p className="text-xs text-slate-500">{process?.process_code ?? "No code"} · {process?.branch_name ?? "No branch"}</p>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          <div>
            <SectionLabel>Mapped LOBs</SectionLabel>
            {!process?.lobs.length ? <p className="text-sm text-slate-400">None</p> : (
              <div className="flex flex-wrap gap-2">
                {process.lobs.map((l) => (
                  <button key={l.map_id} type="button" onClick={() => setSelected(l.map_id)}
                    className={`rounded-full border px-3 py-1 text-xs ${l.map_id === activeMapId ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"} ${l.active_status ? "" : "opacity-60 line-through"}`}>
                    {l.lob_name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <SectionLabel>Selected mapping</SectionLabel>
            {activeMapId ? <MappingDetailBlock mapId={activeMapId} /> : <p className="text-sm text-slate-400">None</p>}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MappingsTab() {
  const [search, setSearch] = useState("");
  const [branchId, setBranchId] = useState("");
  const [onlyUnmapped, setOnlyUnmapped] = useState(false);
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState<string | null>(null);
  const [addFor, setAddFor] = useState<ProcessRow | null>(null);
  const branches = useBranches();
  const setActive = useSetMappingActive();
  const query = useManageableProcesses({ branch_id: branchId || undefined, search: search.trim() || undefined, only_unmapped: onlyUnmapped, page, limit: PAGE_SIZE });
  const rows = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const drawerProcess = rows.find((r) => r.id === drawer) ?? null;

  const deactivate = async (mapId: string, name: string) => {
    if (!window.confirm(`Deactivate LOB "${name}" for this process? Employees keep their current LOB.`)) return;
    try {
      await setActive.mutateAsync({ id: mapId, active: false });
      toast.success("Mapping deactivated");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input aria-label="Search process" placeholder="Search process" className="pl-8" value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <div className="w-56">
          <SearchableSelect
            options={[{ value: "", label: "All branches" }, ...(branches.data ?? []).map((b: any) => ({ value: b.id, label: b.branch_name ?? b.name ?? b.id }))]}
            value={branchId} onChange={(v) => { setBranchId(v); setPage(1); }} placeholder="All branches" searchPlaceholder="Search branch" />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <Checkbox checked={onlyUnmapped} onCheckedChange={(c) => { setOnlyUnmapped(c === true); setPage(1); }} />
          Only processes without a LOB
        </label>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Branch</TableHead><TableHead>Process</TableHead><TableHead>Mapped LOBs</TableHead><TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              <TableRow><TableCell colSpan={4} className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-slate-400" /></TableCell></TableRow>
            ) : query.isError ? (
              <TableRow><TableCell colSpan={4} className="py-8 text-center text-sm text-red-600">{errMsg(query.error)}</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="py-8 text-center text-sm text-slate-500">No processes in your scope match these filters.</TableCell></TableRow>
            ) : rows.map((p) => (
              <TableRow key={p.id} className="cursor-pointer" onClick={() => setDrawer(p.id)}>
                <TableCell className="text-sm text-slate-600">{p.branch_name ?? "None"}</TableCell>
                <TableCell><div className="font-medium text-slate-800">{p.process_name}</div><div className="text-xs text-slate-400">{p.process_code}</div></TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <div className="flex flex-wrap gap-1.5">
                    {p.lobs.filter((l) => l.active_status === 1).length === 0 && <span className="text-xs text-slate-400">None mapped</span>}
                    {p.lobs.filter((l) => l.active_status === 1).map((l) => (
                      <Badge key={l.map_id} variant="secondary" className="gap-1 pr-1">
                        {l.lob_name}
                        <button type="button" aria-label={`Deactivate ${l.lob_name}`} className="rounded hover:bg-slate-300 p-0.5"
                          onClick={() => deactivate(l.map_id, l.lob_name)}><X className="h-3 w-3" /></button>
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="outline" onClick={() => setAddFor(p)}><Plus className="h-3.5 w-3.5 mr-1" />Add LOB</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>{total} process{total === 1 ? "" : "es"}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <Button size="sm" variant="outline" disabled={page * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>

      <AddLobDialog process={addFor} onClose={() => setAddFor(null)} />
      <ProcessDrawer process={drawerProcess} onClose={() => setDrawer(null)} />
    </div>
  );
}

export default function ProcessLobMapping() {
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Process LOB Mapping</h1>
          <p className="text-sm text-slate-500">Define which LOBs each process runs, then assign employees to them.</p>
        </div>
        <Tabs defaultValue="mapping">
          <TabsList>
            <TabsTrigger value="mapping">Process LOBs</TabsTrigger>
            <TabsTrigger value="without-lob">Employees without LOB</TabsTrigger>
          </TabsList>
          <TabsContent value="mapping" className="mt-4"><MappingsTab /></TabsContent>
          <TabsContent value="without-lob" className="mt-4"><EmployeesWithoutLobTab /></TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
