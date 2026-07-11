import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Copy, KeyRound, Link2, Loader2, MonitorCog, Plus, RefreshCw, RotateCcw, Save, Search, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { cn } from "@/lib/utils";

type ApiResponse<T> = { success: boolean; data: T; message?: string };
type OptionRow = { id: string; branch_name?: string; process_name?: string; name?: string };

type KioskDevice = {
  id: string;
  kiosk_code: string;
  kiosk_name: string;
  branch_id: string | null;
  process_id: string | null;
  branch_name: string | null;
  process_name: string | null;
  allowed_ip_list: string[];
  allowed_device_fingerprints: string[];
  is_active: number | boolean;
  last_used_at: string | null;
  created_by_name: string | null;
  scoped_employee_count: number;
  desk_url: string;
};

type KioskPayload = {
  kiosk_code: string;
  kiosk_name: string;
  branch_id: string | null;
  process_id: string | null;
  token?: string;
  allowed_ip_list: string[];
  allowed_device_fingerprints: string[];
  is_active: boolean;
};

type TokenResult = {
  id: string;
  kiosk_code: string;
  token: string;
  desk_url: string;
};

const emptyForm: KioskPayload = {
  kiosk_code: "",
  kiosk_name: "",
  branch_id: null,
  process_id: null,
  token: "",
  allowed_ip_list: [],
  allowed_device_fingerprints: [],
  is_active: true,
};

function unwrap<T>(payload: ApiResponse<T> | T): T {
  return payload && typeof payload === "object" && "data" in payload ? (payload as ApiResponse<T>).data : payload as T;
}

function splitList(value: string) {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function joinList(value: string[]) {
  return value.join("\n");
}

function fullDeskUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${window.location.origin}${path}`;
}

function formatDateTime(value: string | null) {
  if (!value) return "Never";
  const parsed = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export default function BreakDeskDevices() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "inactive" | "all">("active");
  const [selected, setSelected] = useState<KioskDevice | null>(null);
  const [form, setForm] = useState<KioskPayload>(emptyForm);
  const [ipText, setIpText] = useState("");
  const [fingerprintText, setFingerprintText] = useState("");
  const [tokenResult, setTokenResult] = useState<TokenResult | null>(null);

  const kioskQuery = useMemo(() => {
    const params = new URLSearchParams({ status, limit: "150" });
    if (search.trim()) params.set("search", search.trim());
    return params.toString();
  }, [search, status]);

  const kiosks = useQuery({
    queryKey: ["break-kiosks", kioskQuery],
    queryFn: async () => unwrap<{ rows: KioskDevice[] }>(await hrmsApi.get(`/api/break-management/kiosks?${kioskQuery}`)).rows ?? [],
  });

  const branches = useQuery({
    queryKey: ["org-branches"],
    queryFn: async () => {
      const payload = unwrap<any>(await hrmsApi.get("/api/org/branches"));
      return Array.isArray(payload) ? payload as OptionRow[] : payload?.rows ?? [];
    },
  });

  const processes = useQuery({
    queryKey: ["org-processes"],
    queryFn: async () => {
      const payload = unwrap<any>(await hrmsApi.get("/api/org/processes"));
      return Array.isArray(payload) ? payload as OptionRow[] : payload?.rows ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        kiosk_code: form.kiosk_code.trim().toUpperCase(),
        kiosk_name: form.kiosk_name.trim(),
        branch_id: form.branch_id || null,
        process_id: form.process_id || null,
        token: form.token?.trim() || undefined,
        allowed_ip_list: splitList(ipText),
        allowed_device_fingerprints: splitList(fingerprintText),
      };
      if (!selected) {
        const created = unwrap<TokenResult>(await hrmsApi.post("/api/break-management/kiosks", payload));
        return { mode: "create" as const, data: created };
      }
      await hrmsApi.put(`/api/break-management/kiosks/${selected.id}`, payload);
      return { mode: "update" as const, data: null };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["break-kiosks"] });
      if (result.mode === "create" && result.data) {
        setTokenResult(result.data);
        toast.success("Break desk ID created. Token is visible once.");
        resetForm();
      } else {
        toast.success("Break desk mapping updated");
      }
    },
    onError: (error: any) => toast.error(error?.message ?? "Unable to save break desk ID"),
  });

  const rotate = useMutation({
    mutationFn: async (device: KioskDevice) => unwrap<TokenResult>(await hrmsApi.post(`/api/break-management/kiosks/${device.id}/rotate-token`, {})),
    onSuccess: (result) => {
      setTokenResult(result);
      qc.invalidateQueries({ queryKey: ["break-kiosks"] });
      toast.success("Token rotated. Update the guard desk login.");
    },
    onError: (error: any) => toast.error(error?.message ?? "Unable to rotate token"),
  });

  const rows = kiosks.data ?? [];
  const activeCount = rows.filter((row) => Boolean(row.is_active)).length;
  const unmappedCount = rows.filter((row) => !row.branch_id || !row.process_id).length;

  function resetForm() {
    setSelected(null);
    setForm(emptyForm);
    setIpText("");
    setFingerprintText("");
  }

  function editDevice(device: KioskDevice) {
    setSelected(device);
    setForm({
      kiosk_code: device.kiosk_code,
      kiosk_name: device.kiosk_name,
      branch_id: device.branch_id,
      process_id: device.process_id,
      allowed_ip_list: device.allowed_ip_list ?? [],
      allowed_device_fingerprints: device.allowed_device_fingerprints ?? [],
      is_active: Boolean(device.is_active),
    });
    setIpText(joinList(device.allowed_ip_list ?? []));
    setFingerprintText(joinList(device.allowed_device_fingerprints ?? []));
  }

  async function copyText(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  }

  return (
    <DashboardLayout>
      <style>{`
        .input-desk {
          width: 100%;
          border-radius: 0.75rem;
          border: 1px solid rgb(226 232 240);
          background: white;
          padding: 0.625rem 0.75rem;
          font-size: 0.875rem;
          outline: none;
          transition: border-color 160ms ease, box-shadow 160ms ease;
        }
        .input-desk:focus {
          border-color: #145da0;
          box-shadow: 0 0 0 3px rgba(20, 93, 160, 0.12);
        }
      `}</style>
      <div className="min-h-screen bg-[linear-gradient(135deg,#f7fbff_0%,#eef7f1_42%,#fff7f3_100%)] p-3 text-slate-900 sm:p-5">
        <div className="mx-auto max-w-[1500px] space-y-4">
          <section className="overflow-hidden rounded-2xl border border-white/70 bg-white/90 shadow-sm">
            <div className="grid gap-4 border-b border-slate-200 bg-[linear-gradient(120deg,#0a2c60,#145da0_58%,#2a8f4d)] p-4 text-white lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-white/75">
                  <ShieldCheck className="h-4 w-4" />
                  Security desk access control
                </div>
                <h1 className="mt-1 text-2xl font-black tracking-tight">Break Desk Devices</h1>
                <p className="mt-1 max-w-3xl text-sm text-white/80">
                  Create guard desk IDs, lock each desk to a branch and process, and rotate tokens without exposing stored secrets.
                </p>
              </div>
              <button onClick={resetForm} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-[#145da0] shadow-sm transition hover:bg-slate-50">
                <Plus className="h-4 w-4" />
                New desk ID
              </button>
            </div>

            <div className="grid gap-3 p-3 sm:grid-cols-3">
              <Metric label="Total desks" value={String(rows.length)} tone="border-[#145da0]/20 bg-[#145da0]/8 text-[#145da0]" />
              <Metric label="Active desks" value={String(activeCount)} tone="border-emerald-500/20 bg-emerald-500/8 text-emerald-700" />
              <Metric label="Need mapping" value={String(unmappedCount)} tone={unmappedCount ? "border-amber-500/25 bg-amber-500/10 text-amber-700" : "border-slate-200 bg-slate-50 text-slate-600"} />
            </div>
          </section>

          {tokenResult ? (
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sm font-black text-emerald-800">
                    <KeyRound className="h-4 w-4" />
                    One-time token for {tokenResult.kiosk_code}
                  </div>
                  <p className="mt-1 text-xs text-emerald-700">Store this token securely. After this panel is closed, only token rotation can reveal a new token.</p>
                </div>
                <button onClick={() => setTokenResult(null)} className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-800">Close token panel</button>
              </div>
              <div className="mt-3 grid gap-2 lg:grid-cols-[1fr_1.7fr]">
                <CopyBox label="Token" value={tokenResult.token} onCopy={() => copyText(tokenResult.token, "Token")} />
                <CopyBox label="Desk URL" value={fullDeskUrl(tokenResult.desk_url)} onCopy={() => copyText(fullDeskUrl(tokenResult.desk_url), "Desk URL")} />
              </div>
            </section>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-200 p-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-base font-black">Desk registry</h2>
                  <p className="text-xs text-slate-500">Only mapped desks should be used on production floors.</p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <label className="flex h-10 min-w-[260px] items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3">
                    <Search className="h-4 w-4 text-slate-400" />
                    <input value={search} onChange={(event) => setSearch(event.target.value)} className="h-full w-full bg-transparent text-sm outline-none" placeholder="Search desk, branch, process" />
                  </label>
                  <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none">
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="all">All</option>
                  </select>
                </div>
              </div>

              <div className="overflow-auto">
                <table className="w-full min-w-[980px] text-sm">
                  <thead className="bg-slate-50 text-left text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
                    <tr>
                      <th className="px-3 py-3">Desk ID</th>
                      <th className="px-3 py-3">Mapped scope</th>
                      <th className="px-3 py-3 text-center">Employees</th>
                      <th className="px-3 py-3">Restrictions</th>
                      <th className="px-3 py-3">Last use</th>
                      <th className="px-3 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {kiosks.isLoading ? (
                      <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-500"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />Loading devices</td></tr>
                    ) : rows.length === 0 ? (
                      <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-500">No break desk IDs found.</td></tr>
                    ) : rows.map((device) => {
                      const mapped = Boolean(device.branch_id && device.process_id);
                      return (
                        <tr key={device.id} className={cn("align-top transition hover:bg-slate-50", selected?.id === device.id && "bg-sky-50/60")}>
                          <td className="px-3 py-3">
                            <div className="flex items-start gap-2">
                              <div className={cn("mt-0.5 rounded-xl p-2", device.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")}>
                                <MonitorCog className="h-4 w-4" />
                              </div>
                              <div>
                                <div className="font-black text-slate-900">{device.kiosk_code}</div>
                                <div className="text-xs text-slate-500">{device.kiosk_name}</div>
                                <div className={cn("mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em]", device.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")}>
                                  {device.is_active ? "Active" : "Inactive"}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <div className={cn("inline-flex rounded-xl px-2.5 py-1 text-xs font-bold", mapped ? "bg-[#145da0]/10 text-[#145da0]" : "bg-amber-50 text-amber-700")}>
                              {mapped ? "Branch + Process locked" : "Mapping incomplete"}
                            </div>
                            <div className="mt-2 text-xs text-slate-600">{device.branch_name ?? "All branches"}</div>
                            <div className="text-xs text-slate-500">{device.process_name ?? "All processes"}</div>
                          </td>
                          <td className="px-3 py-3 text-center font-black text-slate-800">{Number(device.scoped_employee_count ?? 0)}</td>
                          <td className="px-3 py-3 text-xs text-slate-600">
                            <div>{device.allowed_ip_list?.length ? `${device.allowed_ip_list.length} IP allowed` : "Any IP"}</div>
                            <div>{device.allowed_device_fingerprints?.length ? `${device.allowed_device_fingerprints.length} device locks` : "Any device"}</div>
                          </td>
                          <td className="px-3 py-3 text-xs text-slate-600">{formatDateTime(device.last_used_at)}</td>
                          <td className="px-3 py-3">
                            <div className="flex justify-end gap-2">
                              <button onClick={() => editDevice(device)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50">
                                Edit
                              </button>
                              <button onClick={() => rotate.mutate(device)} disabled={rotate.isPending} className="inline-flex items-center gap-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 transition hover:bg-amber-100 disabled:opacity-60">
                                <RotateCcw className="h-3.5 w-3.5" />
                                Token
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-3">
                <div className="flex items-center gap-2 text-base font-black">
                  <SlidersHorizontal className="h-4 w-4 text-[#145da0]" />
                  {selected ? "Edit desk mapping" : "Create desk ID"}
                </div>
                <p className="mt-1 text-xs text-slate-500">Branch and process are enforced by backend before search, punch, or break actions.</p>
              </div>

              <div className="space-y-3 p-3">
                <Field label="Kiosk code">
                  <input value={form.kiosk_code} onChange={(event) => setForm((current) => ({ ...current, kiosk_code: event.target.value.toUpperCase() }))} placeholder="NOIDA-SALES-FLOOR-1" className="input-desk" />
                </Field>
                <Field label="Desk name">
                  <input value={form.kiosk_name} onChange={(event) => setForm((current) => ({ ...current, kiosk_name: event.target.value }))} placeholder="Noida Sales Floor 1 Security Desk" className="input-desk" />
                </Field>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Branch">
                    <select value={form.branch_id ?? ""} onChange={(event) => setForm((current) => ({ ...current, branch_id: event.target.value || null }))} className="input-desk">
                      <option value="">All branches</option>
                      {(branches.data ?? []).map((branch) => <option key={branch.id} value={branch.id}>{branch.branch_name ?? branch.name ?? branch.id}</option>)}
                    </select>
                  </Field>
                  <Field label="Process">
                    <select value={form.process_id ?? ""} onChange={(event) => setForm((current) => ({ ...current, process_id: event.target.value || null }))} className="input-desk">
                      <option value="">All processes</option>
                      {(processes.data ?? []).map((process) => <option key={process.id} value={process.id}>{process.process_name ?? process.name ?? process.id}</option>)}
                    </select>
                  </Field>
                </div>

                {!form.branch_id || !form.process_id ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                    Production desks should be locked to both branch and process.
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                    <CheckCircle2 className="h-4 w-4" />
                    Scope locked for this desk.
                  </div>
                )}

                {!selected ? (
                  <Field label="Initial token">
                    <input value={form.token ?? ""} onChange={(event) => setForm((current) => ({ ...current, token: event.target.value }))} placeholder="Leave blank to auto-generate" className="input-desk" />
                  </Field>
                ) : null}

                <Field label="Allowed IPs">
                  <textarea value={ipText} onChange={(event) => setIpText(event.target.value)} rows={3} placeholder="One IP per line. Leave blank to allow any IP." className="input-desk min-h-[84px] resize-none" />
                </Field>

                <Field label="Device fingerprints">
                  <textarea value={fingerprintText} onChange={(event) => setFingerprintText(event.target.value)} rows={3} placeholder="Optional device fingerprints. Leave blank to allow any browser/device." className="input-desk min-h-[84px] resize-none" />
                </Field>

                <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
                  Active desk
                  <input type="checkbox" checked={form.is_active} onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))} className="h-4 w-4 accent-[#145da0]" />
                </label>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <button onClick={() => save.mutate()} disabled={save.isPending || !form.kiosk_code.trim() || !form.kiosk_name.trim()} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#145da0] px-4 text-sm font-black text-white transition hover:bg-[#0a2c60] disabled:opacity-60">
                    {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {selected ? "Save mapping" : "Create desk ID"}
                  </button>
                  {selected ? (
                    <button onClick={resetForm} className="h-11 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-50">Cancel</button>
                  ) : null}
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={cn("rounded-2xl border px-4 py-3", tone)}>
      <div className="text-[11px] font-black uppercase tracking-[0.16em] opacity-75">{label}</div>
      <div className="mt-1 text-2xl font-black">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function CopyBox({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-white p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">{label}</span>
        <button onClick={onCopy} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 px-2 py-1 text-[11px] font-bold text-emerald-800">
          {label === "Desk URL" ? <Link2 className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          Copy
        </button>
      </div>
      <div className="break-all rounded-lg bg-emerald-50 px-2 py-2 font-mono text-xs text-emerald-950">{value}</div>
    </div>
  );
}
