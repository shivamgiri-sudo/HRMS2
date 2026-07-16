import { useEffect, useMemo, useState } from "react";
import { BriefcaseBusiness, Loader2, Search, UserRoundCheck, X } from "lucide-react";
import {
  toIso,
  toLocalInputValue,
  visitorApi,
  type VisitorBranch,
  type VisitorHost,
  type VisitorInput,
} from "@/features/visitor/visitorApi";

const inputClass = "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#2784c4] focus:ring-4 focus:ring-blue-50";
const labelClass = "mb-1.5 block text-xs font-black uppercase tracking-[0.08em] text-slate-500";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label className="block"><span className={labelClass}>{label}{required ? " *" : ""}</span>{children}</label>;
}

export function VisitorRegistrationDialog({ mode, onClose, onCreated }: {
  mode: "invitation" | "desk";
  onClose: () => void;
  onCreated: (result: { visit_number: string; tracking_token: string }) => void;
}) {
  const now = useMemo(() => new Date(), []);
  const [branches, setBranches] = useState<VisitorBranch[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [hostSearch, setHostSearch] = useState("");
  const [hosts, setHosts] = useState<VisitorHost[]>([]);
  const [searchingHosts, setSearchingHosts] = useState(false);
  const [selectedHost, setSelectedHost] = useState<VisitorHost | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    full_name: "",
    mobile: "",
    email: "",
    company_name: "",
    branch_id: "",
    visit_type: "business",
    purpose: "",
    scheduled_start: toLocalInputValue(now),
    scheduled_end: toLocalInputValue(new Date(now.getTime() + 60 * 60 * 1000)),
    vehicle_number: "",
    vehicle_type: "Car",
    item_type: "",
    item_description: "",
    serial_number: "",
  });

  useEffect(() => {
    let active = true;
    visitorApi.branches()
      .then((data) => {
        if (!active) return;
        setBranches(data);
        if (data.length === 1) setForm((current) => ({ ...current, branch_id: data[0].id }));
      })
      .catch((error) => active && setMessage(error instanceof Error ? error.message : "Unable to load branches"))
      .finally(() => active && setLoadingBranches(false));
    return () => { active = false; };
  }, []);

  const update = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === "branch_id") {
      setSelectedHost(null);
      setHosts([]);
      setHostSearch("");
    }
  };

  const findHosts = async () => {
    if (hostSearch.trim().length < 2) {
      setMessage("Enter at least 2 characters of the host name or employee code.");
      return;
    }
    setSearchingHosts(true);
    setMessage("");
    try {
      setHosts(await visitorApi.hosts(hostSearch.trim(), form.branch_id || undefined));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to search hosts");
    } finally {
      setSearchingHosts(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage("");
    if (mode === "desk" && !selectedHost) {
      setMessage("Select the employee who is hosting this visitor.");
      return;
    }
    if (new Date(form.scheduled_end).getTime() <= new Date(form.scheduled_start).getTime()) {
      setMessage("Visit end must be later than the start time.");
      return;
    }

    const input: VisitorInput = {
      visitor: {
        full_name: form.full_name.trim(),
        mobile: form.mobile.trim(),
        email: form.email.trim() || undefined,
        company_name: form.company_name.trim() || undefined,
      },
      branch_id: form.branch_id,
      host_employee_id: selectedHost?.id,
      visit_type: form.visit_type,
      purpose: form.purpose.trim(),
      scheduled_start: toIso(form.scheduled_start),
      scheduled_end: toIso(form.scheduled_end),
      vehicle: form.vehicle_number.trim() ? {
        vehicle_number: form.vehicle_number.trim().toUpperCase(),
        vehicle_type: form.vehicle_type,
      } : undefined,
      belongings: form.item_type.trim() ? [{
        item_type: form.item_type.trim(),
        description: form.item_description.trim() || undefined,
        serial_number: form.serial_number.trim() || undefined,
      }] : undefined,
    };

    setSaving(true);
    try {
      const result = mode === "desk"
        ? await visitorApi.deskRegister(input as VisitorInput & { host_employee_id: string })
        : await visitorApi.invite(input);
      onCreated(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to register visitor");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="visitor-form-title">
      <div className="max-h-[95vh] w-full max-w-4xl overflow-y-auto rounded-t-[2rem] bg-white shadow-2xl sm:rounded-[2rem]">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white/95 px-5 py-5 backdrop-blur sm:px-7">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#2784c4]">{mode === "desk" ? "Reception workflow" : "Employee invitation"}</p>
            <h2 id="visitor-form-title" className="mt-1 text-2xl font-black text-slate-950">{mode === "desk" ? "Register a walk-in visitor" : "Invite a visitor"}</h2>
            <p className="mt-1 text-sm text-slate-500">{mode === "desk" ? "Capture the visit at the front desk and send it for host approval." : "Create a scheduled visit where you are the assigned host."}</p>
          </div>
          <button onClick={onClose} className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-100" aria-label="Close visitor registration"><X className="h-5 w-5" /></button>
        </div>

        <form onSubmit={submit} className="space-y-7 p-5 sm:p-7">
          {message && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{message}</div>}

          <section>
            <div className="mb-4 flex items-center gap-2"><UserRoundCheck className="h-5 w-5 text-[#ed1c24]" /><h3 className="font-black text-slate-950">Visitor details</h3></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" required><input className={inputClass} value={form.full_name} onChange={(e) => update("full_name", e.target.value)} minLength={2} maxLength={200} required placeholder="Visitor's legal name" /></Field>
              <Field label="Mobile number" required><input className={inputClass} value={form.mobile} onChange={(e) => update("mobile", e.target.value)} minLength={8} maxLength={20} required inputMode="tel" placeholder="e.g. 9876543210" /></Field>
              <Field label="Work email"><input className={inputClass} value={form.email} onChange={(e) => update("email", e.target.value)} type="email" maxLength={255} placeholder="visitor@company.com" /></Field>
              <Field label="Company"><input className={inputClass} value={form.company_name} onChange={(e) => update("company_name", e.target.value)} maxLength={255} placeholder="Organisation name" /></Field>
            </div>
          </section>

          <section className="border-t border-slate-100 pt-6">
            <div className="mb-4 flex items-center gap-2"><BriefcaseBusiness className="h-5 w-5 text-[#2784c4]" /><h3 className="font-black text-slate-950">Visit plan</h3></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="MAS branch" required>
                <select className={inputClass} value={form.branch_id} onChange={(e) => update("branch_id", e.target.value)} required disabled={loadingBranches}>
                  <option value="">{loadingBranches ? "Loading branches…" : "Select branch"}</option>
                  {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.branch_name}{branch.city ? ` · ${branch.city}` : ""}</option>)}
                </select>
              </Field>
              <Field label="Visit type" required>
                <select className={inputClass} value={form.visit_type} onChange={(e) => update("visit_type", e.target.value)} required>
                  <option value="business">Business meeting</option>
                  <option value="interview">Interview</option>
                  <option value="vendor">Vendor / delivery</option>
                  <option value="audit">Audit / compliance</option>
                  <option value="training">Training / event</option>
                  <option value="personal">Personal visit</option>
                </select>
              </Field>
              <Field label="Start time" required><input className={inputClass} type="datetime-local" value={form.scheduled_start} onChange={(e) => update("scheduled_start", e.target.value)} required /></Field>
              <Field label="End time" required><input className={inputClass} type="datetime-local" value={form.scheduled_end} onChange={(e) => update("scheduled_end", e.target.value)} required /></Field>
              <div className="sm:col-span-2"><Field label="Purpose" required><textarea className={`${inputClass} h-24 resize-none py-3`} value={form.purpose} onChange={(e) => update("purpose", e.target.value)} minLength={5} maxLength={500} required placeholder="Describe the purpose of this visit" /></Field></div>
            </div>

            {mode === "desk" && (
              <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
                <Field label="Search host employee" required>
                  <div className="flex gap-2">
                    <input className={inputClass} value={hostSearch} onChange={(e) => setHostSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void findHosts(); } }} placeholder="Name or employee code" />
                    <button type="button" onClick={findHosts} disabled={searchingHosts} className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white disabled:opacity-50">
                      {searchingHosts ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search
                    </button>
                  </div>
                </Field>
                {hosts.length > 0 && !selectedHost && <div className="mt-3 grid max-h-44 gap-2 overflow-y-auto sm:grid-cols-2">{hosts.map((host) => (
                  <button type="button" key={host.id} onClick={() => setSelectedHost(host)} className="rounded-xl border border-blue-100 bg-white p-3 text-left hover:border-blue-400">
                    <p className="text-sm font-black text-slate-900">{host.full_name}</p><p className="mt-1 text-xs text-slate-500">{host.employee_code}{host.dept_name ? ` · ${host.dept_name}` : ""}</p>
                  </button>
                ))}</div>}
                {selectedHost && <div className="mt-3 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-3"><div><p className="text-sm font-black text-emerald-900">{selectedHost.full_name}</p><p className="text-xs text-emerald-700">{selectedHost.employee_code}{selectedHost.designation_name ? ` · ${selectedHost.designation_name}` : ""}</p></div><button type="button" onClick={() => setSelectedHost(null)} className="text-xs font-black text-emerald-800 underline">Change</button></div>}
              </div>
            )}
          </section>

          <section className="border-t border-slate-100 pt-6">
            <h3 className="font-black text-slate-950">Optional security details</h3>
            <p className="mt-1 text-sm text-slate-500">Record a vehicle and one carried item now; security can verify these at exit.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Vehicle number"><input className={inputClass} value={form.vehicle_number} onChange={(e) => update("vehicle_number", e.target.value.toUpperCase())} maxLength={30} placeholder="DL 01 AB 1234" /></Field>
              <Field label="Vehicle type"><select className={inputClass} value={form.vehicle_type} onChange={(e) => update("vehicle_type", e.target.value)}><option>Car</option><option>Motorcycle</option><option>Commercial vehicle</option><option>Other</option></select></Field>
              <Field label="Carried item"><input className={inputClass} value={form.item_type} onChange={(e) => update("item_type", e.target.value)} maxLength={80} placeholder="Laptop, camera, equipment…" /></Field>
              <Field label="Serial number"><input className={inputClass} value={form.serial_number} onChange={(e) => update("serial_number", e.target.value)} maxLength={150} placeholder="Optional asset serial" /></Field>
              <div className="sm:col-span-2"><Field label="Item description"><input className={inputClass} value={form.item_description} onChange={(e) => update("item_description", e.target.value)} maxLength={255} placeholder="Brand, colour, identifying details" /></Field></div>
            </div>
          </section>

          <div className="sticky bottom-0 -mx-5 -mb-5 flex flex-col-reverse gap-3 border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur sm:-mx-7 sm:-mb-7 sm:flex-row sm:justify-end sm:px-7">
            <button type="button" onClick={onClose} className="h-11 rounded-xl border border-slate-200 px-5 text-sm font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving || loadingBranches} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#ed1c24] px-6 text-sm font-black text-white shadow-lg shadow-red-100 hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}{mode === "desk" ? "Register walk-in" : "Create invitation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
