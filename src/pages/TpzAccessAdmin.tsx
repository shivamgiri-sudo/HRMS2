import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

/**
 * Settings -> TPZ Access. An admin gives ANY user access to TPZ Process (Process Performance V2), chooses which processes and/or
 * branches they may open, and switches Dashboards / Uploader / MIS on or off for each. The same rules are enforced by the API
 * (backend/src/modules/tpz-access), so nothing here is only cosmetic.
 */

interface Option { companies: Array<{ key: string; label: string; hasUploaders: boolean }>; branches: Array<{ id: string; name: string; companies: string[] }> }
interface UserRow { id: string; email: string | null; employee_code: string | null; full_name: string | null; roles: string[] }
interface OverviewRow { id: string; email: string | null; employee_code: string | null; full_name: string | null; restrict_to_grants: boolean; grant_count: number }
interface Grant {
  id?: string; scope_type: "all" | "company" | "branch"; company_key: string | null; branch_id: string | null;
  can_dashboards: boolean; can_upload: boolean; can_mis: boolean;
}
interface Detail { user: UserRow; restrict_to_grants: boolean; notes: string | null; grants: Grant[] }
type Caps = { d: boolean; u: boolean; m: boolean };
const NO_CAPS: Caps = { d: false, u: false, m: false };
const anyCap = (c: Caps | undefined): boolean => Boolean(c && (c.d || c.u || c.m));

const personName = (u: { full_name: string | null; email: string | null }): string => u.full_name?.trim() || u.email || "Unknown user";

function CapChecks({ caps, onChange, uploadEnabled = true }: { caps: Caps; onChange: (c: Caps) => void; uploadEnabled?: boolean }) {
  const box = (label: string, key: keyof Caps, disabled = false) => (
    <label className={`flex items-center gap-1.5 text-xs ${disabled ? "text-slate-300" : "text-slate-600"}`}>
      <Checkbox checked={caps[key]} disabled={disabled} onCheckedChange={(v) => onChange({ ...caps, [key]: v === true })} />
      {label}
    </label>
  );
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-1">{box("Dashboards", "d")}{box("Uploader", "u", !uploadEnabled)}{box("MIS", "m")}</div>;
}

function AccessEditor({ userId, options, onClose, onSaved }: { userId: string; options: Option; onClose: () => void; onSaved: () => void }) {
  const detailQ = useQuery({
    queryKey: ["tpz-access-admin", "user", userId],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: Detail }>(`/api/tpz-access/users/${userId}`)).data,
  });
  const [restrict, setRestrict] = useState(false);
  const [notes, setNotes] = useState("");
  const [all, setAll] = useState<Caps>(NO_CAPS);
  const [companies, setCompanies] = useState<Record<string, Caps>>({});
  const [branches, setBranches] = useState<Record<string, Caps>>({});

  useEffect(() => {
    const d = detailQ.data;
    if (!d) return;
    setRestrict(d.restrict_to_grants);
    setNotes(d.notes ?? "");
    const toCaps = (g: Grant): Caps => ({ d: g.can_dashboards, u: g.can_upload, m: g.can_mis });
    setAll(toCaps(d.grants.find((g) => g.scope_type === "all") ?? { scope_type: "all", company_key: null, branch_id: null, can_dashboards: false, can_upload: false, can_mis: false }));
    setCompanies(Object.fromEntries(d.grants.filter((g) => g.scope_type === "company" && g.company_key).map((g) => [g.company_key as string, toCaps(g)])));
    setBranches(Object.fromEntries(d.grants.filter((g) => g.scope_type === "branch" && g.branch_id).map((g) => [g.branch_id as string, toCaps(g)])));
  }, [detailQ.data]);

  const grants = useMemo<Grant[]>(() => {
    const out: Grant[] = [];
    const push = (scope_type: Grant["scope_type"], key: string | null, c: Caps) => {
      if (!anyCap(c)) return;
      out.push({
        scope_type, company_key: scope_type === "company" ? key : null, branch_id: scope_type === "branch" ? key : null,
        can_dashboards: c.d, can_upload: c.u, can_mis: c.m,
      });
    };
    push("all", null, all);
    for (const [k, c] of Object.entries(companies)) push("company", k, c);
    for (const [k, c] of Object.entries(branches)) push("branch", k, c);
    return out;
  }, [all, companies, branches]);

  const save = useMutation({
    mutationFn: async () => hrmsApi.put(`/api/tpz-access/users/${userId}`, { restrict_to_grants: restrict, notes: notes.trim() || null, grants }),
    onSuccess: () => { toast.success("TPZ access saved"); onSaved(); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save TPZ access"),
  });

  const user = detailQ.data?.user;
  const isAdmin = user?.roles.some((r) => r === "admin" || r === "super_admin") ?? false;

  // What the user will be able to open, worked out from the same selections the API will receive.
  const preview = useMemo(() => {
    const line = (c: Caps) => [c.d && "Dashboards", c.u && "Uploader", c.m && "MIS"].filter(Boolean).join(", ");
    const rows: string[] = [];
    if (anyCap(all)) rows.push(`Every process — ${line(all)}`);
    for (const c of options.companies) if (anyCap(companies[c.key])) rows.push(`${c.label} — ${line(companies[c.key])}`);
    for (const b of options.branches) if (anyCap(branches[b.id])) rows.push(`Branch ${b.name}${b.companies.length ? ` (${b.companies.join(", ")})` : " (no TPZ process mapped yet)"} — ${line(branches[b.id])}`);
    return rows;
  }, [all, companies, branches, options]);

  return (
    <div className="space-y-5 px-1 pb-8">
      {detailQ.isLoading && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>}
      {detailQ.isError && <p className="rounded-lg border border-red-100 bg-red-50 p-3 text-xs text-red-700">Could not load this user.</p>}
      {user && (
        <>
          <section>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">User</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-800">{personName(user)}</span>
              {user.employee_code && <Badge variant="outline">{user.employee_code}</Badge>}
              {user.roles.map((r) => <Badge key={r} variant="secondary">{r}</Badge>)}
            </div>
            {user.email && <p className="text-xs text-slate-500">{user.email}</p>}
          </section>

          <section className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Restriction</p>
            <label className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
              <Switch checked={restrict && !isAdmin} disabled={isAdmin} onCheckedChange={setRestrict} />
              <span className="text-xs text-slate-600">
                <span className="block font-semibold text-slate-800">Limit this user to the grants below</span>
                Users whose role already opens TPZ (manager, CEO, process manager …) see every process. Turn this on to narrow them to what is
                granted here. Leave it off to keep their role access and simply add grants.
                {isAdmin && <span className="mt-1 block text-amber-700">Admins and super admins always keep full access.</span>}
              </span>
            </label>
          </section>

          <section className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Every process</p>
            <div className="rounded-xl border border-slate-100 p-3">
              <p className="mb-1.5 text-xs text-slate-500">Full access — all processes and all branches.</p>
              <CapChecks caps={all} onChange={setAll} />
            </div>
          </section>

          <section className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Specific processes</p>
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-100">
              {options.companies.map((c) => (
                <div key={c.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="text-sm font-medium text-slate-700">{c.label}</span>
                  <CapChecks caps={companies[c.key] ?? NO_CAPS} uploadEnabled={c.hasUploaders} onChange={(v) => setCompanies((prev) => ({ ...prev, [c.key]: v }))} />
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Specific branches</p>
            <p className="text-xs text-slate-500">A branch grant covers every TPZ process mapped to that branch. Branches with no mapped process open nothing yet.</p>
            <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-100">
              {options.branches.map((b) => (
                <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-700">{b.name}</span>
                    <span className="block truncate text-[11px] text-slate-400">{b.companies.length ? b.companies.join(", ") : "No TPZ process mapped"}</span>
                  </span>
                  <CapChecks caps={branches[b.id] ?? NO_CAPS} onChange={(v) => setBranches((prev) => ({ ...prev, [b.id]: v }))} />
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Note</p>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={255} placeholder="Why this access was given (optional)" className="text-xs" />
          </section>

          <section className="space-y-1.5">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">This user will be able to open</p>
            {preview.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-400">
                {restrict && !isAdmin ? "Nothing — a restricted user with no grants loses TPZ access." : "Nothing is granted yet."}
              </p>
            ) : (
              <ul className="space-y-1 rounded-lg bg-indigo-50/50 p-3 text-xs text-slate-700">{preview.map((p) => <li key={p}>• {p}</li>)}</ul>
            )}
          </section>

          <div className="sticky bottom-0 -mx-1 flex items-center justify-between gap-2 border-t border-slate-100 bg-white px-1 py-3">
            <Button
              variant="ghost" size="sm" className="text-red-600 hover:text-red-700"
              onClick={() => { setRestrict(false); setAll(NO_CAPS); setCompanies({}); setBranches({}); }}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />Clear all
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
              <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
                {save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Save access
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function TpzAccessAdmin() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [openUser, setOpenUser] = useState<string | null>(null);

  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 300); return () => clearTimeout(t); }, [search]);

  const optionsQ = useQuery({
    queryKey: ["tpz-access-admin", "options"],
    staleTime: 5 * 60_000,
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: Option }>("/api/tpz-access/options")).data,
  });
  const overviewQ = useQuery({
    queryKey: ["tpz-access-admin", "overview"],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: OverviewRow[] }>("/api/tpz-access/overview")).data,
  });
  const searchQ = useQuery({
    queryKey: ["tpz-access-admin", "users", debounced],
    enabled: debounced.length >= 2,
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: UserRow[] }>(`/api/tpz-access/users?search=${encodeURIComponent(debounced)}`)).data,
  });

  return (
    <DashboardLayout>
      <div className="space-y-5 p-4 sm:p-6">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900"><ShieldCheck className="h-5 w-5 text-indigo-600" />TPZ Access</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Give any user access to TPZ Process — every process, chosen processes, or chosen branches — and decide separately whether they may use the
            uploaders and download MIS. The server enforces this on every request.
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Give a user access</CardTitle>
            <CardDescription>Search by name, e-mail or employee code, then click the user.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type at least 2 characters…" className="pl-9" />
            </div>
            {debounced.length >= 2 && (
              <Table>
                <TableHeader><TableRow><TableHead>User</TableHead><TableHead>Employee code</TableHead><TableHead>Roles</TableHead></TableRow></TableHeader>
                <TableBody>
                  {searchQ.isLoading && <TableRow><TableCell colSpan={3} className="text-center text-xs text-slate-400">Searching…</TableCell></TableRow>}
                  {!searchQ.isLoading && (searchQ.data ?? []).length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-xs text-slate-400">None</TableCell></TableRow>}
                  {(searchQ.data ?? []).map((u) => (
                    <TableRow key={u.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpenUser(u.id)}>
                      <TableCell><span className="block text-sm font-medium">{personName(u)}</span><span className="block text-[11px] text-slate-400">{u.email}</span></TableCell>
                      <TableCell className="text-xs">{u.employee_code ?? "—"}</TableCell>
                      <TableCell className="space-x-1">{u.roles.map((r) => <Badge key={r} variant="secondary" className="text-[10px]">{r}</Badge>)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Users with TPZ grants or restrictions</CardTitle>
            <CardDescription>Click a user to see and change what they can open.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>User</TableHead><TableHead>Employee code</TableHead><TableHead>Grants</TableHead><TableHead>Limited to grants</TableHead></TableRow></TableHeader>
              <TableBody>
                {overviewQ.isLoading && <TableRow><TableCell colSpan={4} className="text-center text-xs text-slate-400">Loading…</TableCell></TableRow>}
                {!overviewQ.isLoading && (overviewQ.data ?? []).length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-xs text-slate-400">None</TableCell></TableRow>}
                {(overviewQ.data ?? []).map((u) => (
                  <TableRow key={u.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpenUser(u.id)}>
                    <TableCell><span className="block text-sm font-medium">{personName(u)}</span><span className="block text-[11px] text-slate-400">{u.email}</span></TableCell>
                    <TableCell className="text-xs">{u.employee_code ?? "—"}</TableCell>
                    <TableCell className="text-xs">{u.grant_count}</TableCell>
                    <TableCell>{u.restrict_to_grants ? <Badge>Yes</Badge> : <Badge variant="outline">No</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Sheet open={openUser !== null} onOpenChange={(o) => { if (!o) setOpenUser(null); }}>
        <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>TPZ access</SheetTitle>
            <SheetDescription>Which TPZ processes this user can open, and what they can do in each.</SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            {openUser && optionsQ.data && (
              <AccessEditor
                key={openUser} userId={openUser} options={optionsQ.data} onClose={() => setOpenUser(null)}
                onSaved={() => { void qc.invalidateQueries({ queryKey: ["tpz-access-admin"] }); void qc.invalidateQueries({ queryKey: ["tpz-access", "me"] }); }}
              />
            )}
            {openUser && optionsQ.isLoading && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>}
          </div>
        </SheetContent>
      </Sheet>
    </DashboardLayout>
  );
}
