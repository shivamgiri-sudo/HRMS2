import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Building2, CalendarClock, CheckCircle2, ClipboardCheck, Copy, Loader2, MapPin,
  PartyPopper, Search, ShieldCheck, UserRound, UserSearch, X, Zap,
} from "lucide-react";
import { buildQrCodeUrl, buildVisitorStatusQrData } from "@/integrations/apis/qrCode.api";
import {
  toIso, toLocalInputValue, visitorApi,
  type VisitorBranch, type PublicHost, type PublicRegistrationInput,
} from "@/features/visitor/visitorApi";

const CONSENT_VERSION = "1.0";

/* MAS Callnet brand — taken from the logo: red wordmark, blue/green ring.
   Mirrors --brand-500 / --accent-500 / --success-500 in hrms-design-system.css. */
const MAS_BLUE = "#1B6AB5";
const MAS_BLUE_DEEP = "#062b52";
const MAS_RED = "#E8231A";

const VISIT_TYPES = [
  { value: "business", label: "Business meeting" },
  { value: "interview", label: "Interview" },
  { value: "vendor", label: "Vendor / delivery" },
  { value: "audit", label: "Audit / compliance" },
  { value: "training", label: "Training / event" },
  { value: "personal", label: "Personal visit" },
];

const inputClass =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-900 outline-none transition " +
  "placeholder:font-normal placeholder:text-slate-400 focus:border-[#1B6AB5] focus:ring-4 focus:ring-[#1B6AB5]/12 disabled:bg-slate-50 disabled:text-slate-400";

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-[0.08em] text-slate-500">
      {children}
      {required && <span className="ml-0.5 text-[#E8231A]">*</span>}
    </span>
  );
}

function Section({
  step, icon, title, subtitle, children, tint,
}: {
  step: string; icon: React.ReactNode; title: string; subtitle: string;
  children: React.ReactNode; tint?: boolean;
}) {
  return (
    <section
      className={`rounded-2xl border p-5 shadow-sm sm:p-6 ${
        tint ? "border-[#1B6AB5]/20 bg-[#1B6AB5]/[0.04]" : "border-slate-200/80 bg-white"
      }`}
    >
      <div className="mb-5 flex items-start gap-3.5">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm"
          style={{ background: `linear-gradient(135deg, ${MAS_BLUE}, ${MAS_BLUE_DEEP})` }}
          aria-hidden
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] font-black tabular-nums text-[#1B6AB5]">{step}</span>
            <h2 className="text-[15px] font-extrabold text-slate-900">{title}</h2>
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export default function VisitorSelfRegister() {
  const now = useMemo(() => new Date(), []);
  const [params] = useSearchParams();
  const branchFromQr = params.get("branch") ?? "";

  const [branches, setBranches] = useState<VisitorBranch[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [hostSearch, setHostSearch] = useState("");
  const [hosts, setHosts] = useState<PublicHost[]>([]);
  const [searchingHosts, setSearchingHosts] = useState(false);
  const [hostTouched, setHostTouched] = useState(false);
  const [selectedHost, setSelectedHost] = useState<PublicHost | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{ visit_number: string; tracking_token: string } | null>(null);
  const [consent, setConsent] = useState(false);
  const [statusQr, setStatusQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [form, setForm] = useState({
    full_name: "", mobile: "", email: "", company_name: "",
    branch_id: "", visit_type: "business", purpose: "",
    scheduled_start: toLocalInputValue(now),
    scheduled_end: toLocalInputValue(new Date(now.getTime() + 60 * 60 * 1000)),
    vehicle_number: "", vehicle_type: "Car",
    item_type: "", item_description: "", serial_number: "",
  });

  const up = (key: keyof typeof form, v: string) => {
    setForm(f => ({ ...f, [key]: v }));
    if (key === "branch_id") { setSelectedHost(null); setHosts([]); setHostSearch(""); setHostTouched(false); }
  };

  useEffect(() => {
    visitorApi.branches()
      .then(d => {
        setBranches(d);
        // A QR printed for one reception desk pre-selects that branch; otherwise
        // auto-select when there is only one to pick from.
        const preset = d.find(b => b.id === branchFromQr)?.id ?? (d.length === 1 ? d[0].id : "");
        if (preset) setForm(f => ({ ...f, branch_id: preset }));
      })
      .catch(() => setError("Unable to load branches. Please refresh the page."))
      .finally(() => setLoadingBranches(false));
  }, [branchFromQr]);

  // Live host search. Previously this sat behind a Search button, which meant a
  // visitor could type a name, see nothing happen, and submit with no host.
  const searchSeq = useRef(0);
  useEffect(() => {
    const q = hostSearch.trim();
    if (!form.branch_id || q.length < 2 || selectedHost) { setHosts([]); setSearchingHosts(false); return; }
    const seq = ++searchSeq.current;
    setSearchingHosts(true);
    const t = setTimeout(() => {
      visitorApi.publicHosts(form.branch_id, q)
        .then(r => { if (seq === searchSeq.current) { setHosts(r); setHostTouched(true); } })
        .catch(() => { if (seq === searchSeq.current) setHosts([]); })
        .finally(() => { if (seq === searchSeq.current) setSearchingHosts(false); });
    }, 300);
    return () => clearTimeout(t);
  }, [hostSearch, form.branch_id, selectedHost]);

  useEffect(() => {
    if (!success) return;
    void buildQrCodeUrl(buildVisitorStatusQrData(success.tracking_token), 512)
      .then(setStatusQr)
      .catch(() => setStatusQr(null));
  }, [success]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError("");
    if (!consent) { setError("Please accept the privacy notice to continue."); return; }
    if (new Date(form.scheduled_end) <= new Date(form.scheduled_start)) {
      setError("Visit end time must be after the start time."); return;
    }
    const input: PublicRegistrationInput = {
      visitor: {
        full_name: form.full_name.trim(), mobile: form.mobile.trim(),
        email: form.email.trim() || undefined, company_name: form.company_name.trim() || undefined,
      },
      branch_id: form.branch_id,
      host_employee_code: selectedHost?.employee_code,
      visit_type: form.visit_type, purpose: form.purpose.trim(),
      scheduled_start: toIso(form.scheduled_start), scheduled_end: toIso(form.scheduled_end),
      consent: { accepted: true, consent_type: "visitor_privacy", consent_version: CONSENT_VERSION },
      vehicle: form.vehicle_number.trim()
        ? { vehicle_number: form.vehicle_number.trim().toUpperCase(), vehicle_type: form.vehicle_type }
        : undefined,
      belongings: form.item_type.trim()
        ? [{ item_type: form.item_type.trim(), description: form.item_description.trim() || undefined, serial_number: form.serial_number.trim() || undefined }]
        : undefined,
    };
    setSaving(true);
    try { setSuccess(await visitorApi.registerPublic(input)); }
    catch (err) { setError(err instanceof Error ? err.message : "Registration failed. Please try again."); }
    finally { setSaving(false); }
  };

  /* ─── Success ────────────────────────────────────────── */
  if (success) {
    const statusUrl = buildVisitorStatusQrData(success.tracking_token);
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md">
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
            <div className="px-7 pb-7 pt-8 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#3BAD49]/12 text-[#3BAD49]">
                <PartyPopper className="h-8 w-8" />
              </div>
              <h1 className="text-xl font-black text-slate-900">You're registered</h1>
              <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-slate-500">
                {selectedHost
                  ? <>We've notified <span className="font-semibold text-slate-700">{selectedHost.full_name}</span> to approve your visit.</>
                  : "Our reception team will review and approve your visit shortly."}
              </p>

              <div
                className="mt-6 rounded-2xl px-5 py-4 text-white"
                style={{ background: `linear-gradient(135deg, ${MAS_BLUE}, ${MAS_BLUE_DEEP})` }}
              >
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/70">Your visit number</div>
                <div className="mt-1 text-3xl font-black tracking-wide tabular-nums">{success.visit_number}</div>
              </div>

              {/* The QR is the point: the visitor scans it with their own phone and
                  keeps the tracking link, instead of copying a 70-character URL. */}
              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
                <div className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-slate-500">
                  Scan to track your visit
                </div>
                <div className="mt-3 flex justify-center">
                  {statusQr ? (
                    <img
                      src={statusQr}
                      alt="QR code linking to your visit status page"
                      className="h-40 w-40 rounded-xl border border-slate-200 bg-white p-2"
                    />
                  ) : (
                    <div className="flex h-40 w-40 items-center justify-center rounded-xl border border-dashed border-slate-300">
                      <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
                    </div>
                  )}
                </div>
                <p className="mt-3 text-xs leading-relaxed text-slate-500">
                  Point your phone camera at this code to save your status link and request check-out later.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(statusUrl).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    });
                  }}
                  className="mt-3 inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                >
                  {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-[#3BAD49]" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Link copied" : "Copy link instead"}
                </button>
              </div>

              <a
                href={statusUrl}
                className="mt-5 flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl text-sm font-black text-white transition hover:brightness-110"
                style={{ background: MAS_RED }}
              >
                <ClipboardCheck className="h-4 w-4" /> Track my visit
              </a>
              <a href="/visitor-register" className="mt-3 inline-block cursor-pointer text-xs font-bold text-[#1B6AB5] hover:underline">
                Register another visit
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ─── Form ───────────────────────────────────────────── */
  const selectedBranch = branches.find(b => b.id === form.branch_id);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Hero */}
      <header className="relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${MAS_BLUE_DEEP} 0%, ${MAS_BLUE} 55%, #2784c4 100%)` }}>
        {/* Echoes the ring in the MAS mark without competing with the logo itself */}
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full border-[28px] border-white/[0.07]" />
        <div aria-hidden className="pointer-events-none absolute -bottom-28 -left-10 h-56 w-56 rounded-full border-[22px] border-white/[0.05]" />
        <div className="relative mx-auto max-w-2xl px-4 pb-9 pt-8 text-center">
          <div className="inline-flex items-center justify-center rounded-2xl bg-white px-4 py-2.5 shadow-lg">
            <img src="/mcn-logo.png" alt="MAS Callnet" className="h-9 w-auto" />
          </div>
          <h1 className="mt-4 text-[26px] font-black leading-tight text-white sm:text-3xl">Visitor Registration</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-white/75">
            Welcome to MAS Callnet. Register below and your host will be notified straight away.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {[
              { icon: <ShieldCheck className="h-3.5 w-3.5" />, label: "DPDP Act compliant" },
              { icon: <Zap className="h-3.5 w-3.5" />, label: "Instant host alert" },
              { icon: <ClipboardCheck className="h-3.5 w-3.5" />, label: "Takes under 2 minutes" },
            ].map(chip => (
              <span key={chip.label} className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-3 py-1.5 text-[11px] font-bold text-white ring-1 ring-inset ring-white/15">
                {chip.icon}{chip.label}
              </span>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 pb-16 pt-6">
        <form onSubmit={submit} className="flex flex-col gap-4">
          {error && (
            <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
              <X className="mt-0.5 h-4 w-4 shrink-0" />{error}
            </div>
          )}

          <Section step="01" icon={<UserRound className="h-5 w-5" />} title="Your details" subtitle="Used to identify you at the security gate.">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block"><Label required>Full name</Label>
                <input className={inputClass} value={form.full_name} onChange={e => up("full_name", e.target.value)} minLength={2} maxLength={200} required autoComplete="name" placeholder="Your full legal name" />
              </label>
              <label className="block"><Label required>Mobile number</Label>
                <input className={inputClass} value={form.mobile} onChange={e => up("mobile", e.target.value)} minLength={8} maxLength={20} required inputMode="tel" autoComplete="tel" placeholder="9876543210" />
              </label>
              <label className="block"><Label>Work email</Label>
                <input className={inputClass} value={form.email} onChange={e => up("email", e.target.value)} type="email" maxLength={255} autoComplete="email" placeholder="you@company.com" />
              </label>
              <label className="block"><Label>Company / organisation</Label>
                <input className={inputClass} value={form.company_name} onChange={e => up("company_name", e.target.value)} maxLength={255} autoComplete="organization" placeholder="Your company name" />
              </label>
            </div>
          </Section>

          <Section step="02" icon={<Building2 className="h-5 w-5" />} title="Visit details" subtitle="Where you're going and why.">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block"><Label required>MAS branch</Label>
                <select className={`${inputClass} cursor-pointer appearance-none`} value={form.branch_id} onChange={e => up("branch_id", e.target.value)} required disabled={loadingBranches}>
                  <option value="">{loadingBranches ? "Loading branches…" : "Select a branch"}</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.branch_name}{b.city ? ` · ${b.city}` : ""}</option>)}
                </select>
                {selectedBranch?.state && (
                  <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
                    <MapPin className="h-3 w-3" />{selectedBranch.state}
                  </span>
                )}
              </label>
              <label className="block"><Label required>Visit type</Label>
                <select className={`${inputClass} cursor-pointer appearance-none`} value={form.visit_type} onChange={e => up("visit_type", e.target.value)} required>
                  {VISIT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              <label className="block"><Label required>Visit start</Label>
                <input className={`${inputClass} cursor-pointer`} type="datetime-local" value={form.scheduled_start} onChange={e => up("scheduled_start", e.target.value)} required />
              </label>
              <label className="block"><Label required>Visit end</Label>
                <input className={`${inputClass} cursor-pointer`} type="datetime-local" value={form.scheduled_end} onChange={e => up("scheduled_end", e.target.value)} required />
              </label>
            </div>
            <label className="mt-4 block"><Label required>Purpose of visit</Label>
              <textarea
                className={`${inputClass} h-24 resize-none py-2.5 leading-relaxed`}
                value={form.purpose} onChange={e => up("purpose", e.target.value)}
                minLength={5} maxLength={500} required
                placeholder="Briefly describe why you're visiting MAS Callnet today"
              />
              <span className="mt-1 block text-right text-[11px] tabular-nums text-slate-400">{form.purpose.length}/500</span>
            </label>
          </Section>

          <Section step="03" icon={<UserSearch className="h-5 w-5" />} title="Who are you meeting?" subtitle="Search your host by name or employee code." tint>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className={`${inputClass} pl-10`}
                value={selectedHost ? selectedHost.full_name : hostSearch}
                onChange={e => { setSelectedHost(null); setHostSearch(e.target.value); }}
                disabled={!form.branch_id}
                placeholder={form.branch_id ? "Start typing a name or code…" : "Select a branch first"}
                aria-label="Search for your host"
              />
              {searchingHosts && <Loader2 className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[#1B6AB5]" />}
              {selectedHost && !searchingHosts && (
                <button type="button" onClick={() => { setSelectedHost(null); setHostSearch(""); }} aria-label="Clear selected host"
                  className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-slate-200 text-slate-600 transition hover:bg-slate-300">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {selectedHost ? (
              <div className="mt-3 flex items-center gap-3 rounded-xl border border-[#3BAD49]/30 bg-[#3BAD49]/[0.07] px-4 py-3">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-[#3BAD49]" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-extrabold text-slate-900">{selectedHost.full_name}</div>
                  <div className="truncate text-[11px] font-medium text-slate-500">
                    {selectedHost.employee_code}{selectedHost.designation_name ? ` · ${selectedHost.designation_name}` : ""}
                  </div>
                </div>
              </div>
            ) : hosts.length > 0 ? (
              <ul className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                {hosts.map(h => (
                  <li key={h.employee_code}>
                    <button type="button" onClick={() => { setSelectedHost(h); setHosts([]); }}
                      className="flex w-full cursor-pointer items-center gap-3 border-b border-slate-100 px-4 py-2.5 text-left transition last:border-0 hover:bg-[#1B6AB5]/[0.06]">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1B6AB5]/10 text-[11px] font-black text-[#1B6AB5]">
                        {h.full_name.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold text-slate-900">{h.full_name}</span>
                        <span className="block truncate text-[11px] text-slate-500">
                          {h.employee_code}{h.designation_name ? ` · ${h.designation_name}` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : hostTouched && !searchingHosts && hostSearch.trim().length >= 2 ? (
              <p className="mt-2.5 text-xs text-slate-500">
                No match at this branch. You can still continue — reception will route you.
              </p>
            ) : null}
          </Section>

          <Section step="04" icon={<CalendarClock className="h-5 w-5" />} title="Vehicle & belongings" subtitle="Optional, but speeds up your gate check.">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block"><Label>Vehicle number</Label>
                <input className={inputClass} value={form.vehicle_number} onChange={e => up("vehicle_number", e.target.value.toUpperCase())} maxLength={30} placeholder="DL 01 AB 1234" />
              </label>
              <label className="block"><Label>Vehicle type</Label>
                <select className={`${inputClass} cursor-pointer appearance-none`} value={form.vehicle_type} onChange={e => up("vehicle_type", e.target.value)}>
                  <option>Car</option><option>Motorcycle</option><option>Commercial vehicle</option><option>Other</option>
                </select>
              </label>
              <label className="block"><Label>Carried item</Label>
                <input className={inputClass} value={form.item_type} onChange={e => up("item_type", e.target.value)} maxLength={80} placeholder="Laptop, camera, equipment…" />
              </label>
              <label className="block"><Label>Serial number</Label>
                <input className={inputClass} value={form.serial_number} onChange={e => up("serial_number", e.target.value)} maxLength={150} placeholder="Optional asset serial" />
              </label>
            </div>
          </Section>

          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5">
            <input
              type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}
              className="mt-0.5 h-[18px] w-[18px] shrink-0 cursor-pointer accent-[#1B6AB5]"
            />
            <span className="text-[13px] leading-relaxed text-slate-600">
              I agree that <strong className="text-slate-900">MAS Callnet</strong> may record and process my visit details for
              security and access management under the{" "}
              <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="font-bold text-[#1B6AB5] hover:underline">Privacy Policy</a>
              {" "}(Digital Personal Data Protection Act, 2023). My data is retained only as long as the law requires.
            </span>
          </label>

          <button
            type="submit"
            disabled={saving || loadingBranches || !consent}
            className="flex h-13 min-h-[52px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl text-[15px] font-black text-white shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:brightness-100"
            style={{ background: MAS_RED, boxShadow: "0 8px 22px rgba(232,35,26,.26)" }}
          >
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Submitting your request…</> : <>Register my visit<CheckCircle2 className="h-4 w-4" /></>}
          </button>

          <p className="text-center text-xs text-slate-500">
            Already registered?{" "}
            <a href="/visitor-status" className="cursor-pointer font-bold text-[#1B6AB5] hover:underline">Check your visit status</a>
          </p>
        </form>
      </main>
    </div>
  );
}
