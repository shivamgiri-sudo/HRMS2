import { useEffect, useState } from "react";
import { Loader2, Trash2, UserPlus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errorText, searchUsers, useDashboardMutations, useShareTargets } from "./api";
import type { Share } from "./types";

const TYPE_LABEL: Record<Share["principalType"], string> = { role: "Everyone with a role", branch: "Everyone in a branch", process: "Everyone in a process", user: "One person" };
const sel = "h-10 w-full cursor-pointer rounded-md border border-slate-300 bg-white px-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600";

interface Props { open: boolean; onClose: () => void; dashboardId: string; shares: Share[] }

/** Who can open this dashboard. Sharing shows the layout; each person still only sees data for their own branches and processes. */
export default function ShareDialog({ open, onClose, dashboardId, shares }: Props) {
  const [list, setList] = useState<Share[]>(shares);
  const [names, setNames] = useState<Record<string, string>>({});
  const [type, setType] = useState<Share["principalType"]>("role");
  const [value, setValue] = useState("");
  const [permission, setPermission] = useState<Share["permission"]>("view");
  const [userQ, setUserQ] = useState("");
  const [users, setUsers] = useState<Array<{ userId: string; name: string; code: string }>>([]);
  const [err, setErr] = useState<string | null>(null);
  const { data: targets, isLoading } = useShareTargets(open);
  const { saveShares } = useDashboardMutations();

  useEffect(() => { if (open) { setList(shares); setErr(null); setValue(""); } }, [open, shares]);
  useEffect(() => {
    if (type !== "user" || userQ.trim().length < 2) { setUsers([]); return; }
    let live = true;
    const t = setTimeout(() => { searchUsers(userQ.trim()).then((r) => { if (live) setUsers(r); }).catch(() => { if (live) setUsers([]); }); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [userQ, type]);

  const options = type === "role" ? (targets?.roles ?? []).map((r) => ({ value: r, label: r.replace(/_/g, " ") }))
    : type === "branch" ? (targets?.branches ?? []).map((b) => ({ value: b.id, label: b.name }))
    : type === "process" ? (targets?.processes ?? []).map((p) => ({ value: p.id, label: p.name }))
    : users.map((u) => ({ value: u.userId, label: `${u.name} (${u.code})` }));
  const labelOf = (s: Share) => names[`${s.principalType}:${s.principalValue}`]
    ?? (s.principalType === "role" ? s.principalValue.replace(/_/g, " ")
      : s.principalType === "branch" ? targets?.branches.find((b) => b.id === s.principalValue)?.name
      : s.principalType === "process" ? targets?.processes.find((p) => p.id === s.principalValue)?.name : undefined)
    ?? s.principalValue;

  const add = () => {
    if (!value) return;
    const label = options.find((o) => o.value === value)?.label;
    if (label) setNames((n) => ({ ...n, [`${type}:${value}`]: label }));
    setList((l) => [...l.filter((s) => !(s.principalType === type && s.principalValue === value)), { principalType: type, principalValue: value, permission }]);
    setValue("");
  };
  const save = async () => {
    setErr(null);
    try { await saveShares.mutateAsync({ id: dashboardId, shares: list }); onClose(); } catch (e) { setErr(errorText(e)); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Share this dashboard</DialogTitle>
          <DialogDescription>People you share with can open the dashboard. Each person still sees only the data for their own branches and processes.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 rounded-lg border border-slate-200 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div><label htmlFor="share-type" className="mb-1 block text-xs font-semibold text-slate-700">Share with</label>
              <select id="share-type" className={sel} value={type} onChange={(e) => { setType(e.target.value as Share["principalType"]); setValue(""); }}>
                {(Object.keys(TYPE_LABEL) as Share["principalType"][]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </select></div>
            <div><label htmlFor="share-perm" className="mb-1 block text-xs font-semibold text-slate-700">They can</label>
              <select id="share-perm" className={sel} value={permission} onChange={(e) => setPermission(e.target.value as Share["permission"])}>
                <option value="view">View</option><option value="edit">View and edit</option>
              </select></div>
          </div>
          {type === "user" && <div><label htmlFor="share-search" className="mb-1 block text-xs font-semibold text-slate-700">Find a person</label>
            <input id="share-search" value={userQ} onChange={(e) => setUserQ(e.target.value)} placeholder="Name or employee code (2+ letters)" className={sel.replace("cursor-pointer ", "")} /></div>}
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1"><label htmlFor="share-value" className="mb-1 block text-xs font-semibold text-slate-700">{type === "role" ? "Role" : type === "branch" ? "Branch" : type === "process" ? "Process" : "Person"}</label>
              <select id="share-value" className={sel} value={value} onChange={(e) => setValue(e.target.value)} disabled={isLoading}>
                <option value="">{isLoading ? "Loading…" : options.length ? "Choose…" : type === "user" ? "Search above first" : "Nothing available"}</option>
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select></div>
            <button type="button" onClick={add} disabled={!value} className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-md bg-blue-800 px-3 text-sm font-semibold text-white transition-colors hover:bg-blue-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50"><UserPlus className="h-4 w-4" />Add</button>
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold text-slate-700">Shared with</p>
          {!list.length && <p className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-600">Only you can open this dashboard.</p>}
          <ul className="space-y-1.5">
            {list.map((s) => (
              <li key={`${s.principalType}:${s.principalValue}`} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold capitalize text-slate-600">{s.principalType}</span>
                <span className="min-w-0 flex-1 truncate capitalize text-slate-900">{labelOf(s)}</span>
                <select aria-label={`Permission for ${labelOf(s)}`} value={s.permission} className="h-8 cursor-pointer rounded-md border border-slate-300 bg-white px-1 text-xs"
                  onChange={(e) => setList((l) => l.map((x) => (x === s ? { ...x, permission: e.target.value as Share["permission"] } : x)))}>
                  <option value="view">View</option><option value="edit">Edit</option>
                </select>
                <button type="button" aria-label={`Stop sharing with ${labelOf(s)}`} onClick={() => setList((l) => l.filter((x) => x !== s))}
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-slate-500 hover:bg-rose-50 hover:text-rose-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        </div>

        {err && <p role="alert" className="rounded-md bg-rose-50 p-2 text-sm text-rose-700">{err}</p>}
        <DialogFooter>
          <button type="button" onClick={onClose} className="h-10 cursor-pointer rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={() => void save()} disabled={saveShares.isPending} className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-blue-800 px-4 text-sm font-semibold text-white hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-60">
            {saveShares.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save sharing
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
