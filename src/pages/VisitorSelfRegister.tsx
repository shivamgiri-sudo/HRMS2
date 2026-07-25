import { useEffect, useMemo, useState } from "react";
import { CompanyLogo } from "@/components/CompanyLogo";
import {
  toIso, toLocalInputValue, visitorApi,
  type VisitorBranch, type PublicHost, type PublicRegistrationInput,
} from "@/features/visitor/visitorApi";

const CONSENT_VERSION = "1.0";

/* ─── Shared input style ─────────────────────────────── */
const ic: React.CSSProperties = {
  width: "100%", height: 44, borderRadius: 12, border: "1.5px solid #e2e8f0",
  background: "#fff", padding: "0 14px", fontSize: 14, fontWeight: 500,
  color: "#0f172a", outline: "none", transition: "border .15s,box-shadow .15s",
  boxSizing: "border-box",
};
const icFocus = { border: "1.5px solid #0d9488", boxShadow: "0 0 0 4px rgba(13,148,136,.1)" };

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      {...props}
      style={{ ...ic, ...(focused ? icFocus : {}), ...props.style }}
      onFocus={e => { setFocused(true); props.onFocus?.(e); }}
      onBlur={e => { setFocused(false); props.onBlur?.(e); }}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const [focused, setFocused] = useState(false);
  return (
    <select
      {...props}
      style={{ ...ic, ...props.style, ...(focused ? icFocus : {}), appearance: "none", cursor: "pointer" }}
      onFocus={e => { setFocused(true); props.onFocus?.(e); }}
      onBlur={e => { setFocused(false); props.onBlur?.(e); }}
    />
  );
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const [focused, setFocused] = useState(false);
  return (
    <textarea
      {...props}
      style={{ ...ic, height: 96, padding: "10px 14px", resize: "none", lineHeight: 1.5, ...props.style, ...(focused ? icFocus : {}) }}
      onFocus={e => { setFocused(true); props.onFocus?.(e); }}
      onBlur={e => { setFocused(false); props.onBlur?.(e); }}
    />
  );
}

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b", marginBottom: 6 }}>
      {children}{required && <span style={{ color: "#e11d48", marginLeft: 2 }}>*</span>}
    </div>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 2px 16px rgba(15,23,42,.06)", border: "1px solid #f1f5f9", ...style }}>
      {children}
    </div>
  );
}

function SectionTitle({ icon, title, subtitle }: { icon: string; title: string; subtitle?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 18 }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#0d9488,#0f766e)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{subtitle}</div>}
      </div>
    </div>
  );
}

function Grid2({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}>{children}</div>;
}

export default function VisitorSelfRegister() {
  const now = useMemo(() => new Date(), []);
  const [branches, setBranches] = useState<VisitorBranch[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [hostSearch, setHostSearch] = useState("");
  const [hosts, setHosts] = useState<PublicHost[]>([]);
  const [searchingHosts, setSearchingHosts] = useState(false);
  const [selectedHost, setSelectedHost] = useState<PublicHost | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{ visit_number: string; tracking_token: string } | null>(null);
  const [consent, setConsent] = useState(false);

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
    if (key === "branch_id") { setSelectedHost(null); setHosts([]); setHostSearch(""); }
  };

  useEffect(() => {
    visitorApi.branches()
      .then(d => { setBranches(d); if (d.length === 1) setForm(f => ({ ...f, branch_id: d[0].id })); })
      .catch(() => setError("Unable to load branches. Please refresh."))
      .finally(() => setLoadingBranches(false));
  }, []);

  const searchHosts = async () => {
    if (hostSearch.trim().length < 2) { setError("Enter at least 2 characters."); return; }
    if (!form.branch_id) { setError("Please select a branch first."); return; }
    setSearchingHosts(true); setError("");
    try { setHosts(await visitorApi.publicHosts(form.branch_id, hostSearch.trim())); }
    catch { setError("Unable to search hosts. Please try again."); }
    finally { setSearchingHosts(false); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError("");
    if (!consent) { setError("Please accept the privacy notice to continue."); return; }
    if (new Date(form.scheduled_end) <= new Date(form.scheduled_start)) {
      setError("Visit end time must be after the start time."); return;
    }
    const input: PublicRegistrationInput = {
      visitor: { full_name: form.full_name.trim(), mobile: form.mobile.trim(), email: form.email.trim() || undefined, company_name: form.company_name.trim() || undefined },
      branch_id: form.branch_id,
      host_employee_code: selectedHost?.employee_code,
      visit_type: form.visit_type, purpose: form.purpose.trim(),
      scheduled_start: toIso(form.scheduled_start), scheduled_end: toIso(form.scheduled_end),
      consent: { accepted: true, consent_type: "visitor_privacy", consent_version: CONSENT_VERSION },
      vehicle: form.vehicle_number.trim() ? { vehicle_number: form.vehicle_number.trim().toUpperCase(), vehicle_type: form.vehicle_type } : undefined,
      belongings: form.item_type.trim() ? [{ item_type: form.item_type.trim(), description: form.item_description.trim() || undefined, serial_number: form.serial_number.trim() || undefined }] : undefined,
    };
    setSaving(true);
    try { setSuccess(await visitorApi.registerPublic(input)); }
    catch (err) { setError(err instanceof Error ? err.message : "Registration failed. Please try again."); }
    finally { setSaving(false); }
  };

  /* ─── Success screen ──────────────────────────────────── */
  if (success) {
    const statusUrl = `${window.location.origin}/visitor-status/${success.tracking_token}`;
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#f0fdfa 0%,#e0f2fe 50%,#f8fafc 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div style={{ width: "100%", maxWidth: 440 }}>
          <Card style={{ textAlign: "center", padding: 36 }}>
            <div style={{ width: 72, height: 72, borderRadius: "50%", background: "linear-gradient(135deg,#0d9488,#0f766e)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", fontSize: 32 }}>✓</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a" }}>Visit Registered!</div>
            <div style={{ fontSize: 14, color: "#64748b", marginTop: 6, lineHeight: 1.5 }}>Your visit request is awaiting host approval. You'll be notified once approved.</div>

            <div style={{ margin: "20px 0 0", padding: 16, borderRadius: 14, background: "linear-gradient(135deg,#0d9488,#0f766e)", color: "#fff" }}>
              <div style={{ fontSize: 11, fontWeight: 700, opacity: .8, textTransform: "uppercase", letterSpacing: "0.1em" }}>Visit Number</div>
              <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: "0.05em", marginTop: 4 }}>{success.visit_number}</div>
            </div>

            <div style={{ marginTop: 16, padding: 14, borderRadius: 12, background: "#f0fdfa", border: "1px solid #99f6e4" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#0f766e", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Your Status Tracking Link</div>
              <a href={statusUrl} style={{ display: "block", fontSize: 12, color: "#0d9488", wordBreak: "break-all", textDecoration: "underline" }}>{statusUrl}</a>
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 10 }}>Save this link to check your visit status and request check-out.</div>

            <a href={statusUrl} style={{ display: "flex", alignItems: "center", justifyContent: "center", marginTop: 20, height: 48, borderRadius: 14, background: "linear-gradient(135deg,#0d9488,#0f766e)", color: "#fff", fontWeight: 800, fontSize: 14, textDecoration: "none", gap: 8 }}>
              🔍 Track My Visit
            </a>
            <a href="/visitor-register" style={{ display: "block", marginTop: 10, fontSize: 12, color: "#0d9488", textDecoration: "underline" }}>Register another visit</a>
          </Card>
        </div>
      </div>
    );
  }

  /* ─── Registration form ───────────────────────────────── */
  return (
    <>
      <style>{`
        @keyframes vsrFadeUp { from { opacity:0; transform:translateY(18px); } to { opacity:1; transform:translateY(0); } }
        .vsr-card { animation: vsrFadeUp .35s ease forwards; }
        .vsr-btn-primary { background:linear-gradient(135deg,#0d9488,#0f766e); color:#fff; border:none; border-radius:14px; height:50px; font-size:15px; font-weight:900; cursor:pointer; transition:opacity .15s,transform .1s; box-shadow:0 6px 20px rgba(13,148,136,.3); width:100%; }
        .vsr-btn-primary:hover:not(:disabled) { opacity:.92; transform:translateY(-1px); }
        .vsr-btn-primary:disabled { opacity:.5; cursor:not-allowed; transform:none; }
        .vsr-host-card { border-radius:12px; border:1.5px solid #e2e8f0; background:#fff; padding:12px 14px; cursor:pointer; transition:border .15s,background .15s; text-align:left; width:100%; }
        .vsr-host-card:hover { border-color:#0d9488; background:#f0fdfa; }
        input[type="checkbox"].vsr-check { width:18px; height:18px; accent-color:#0d9488; cursor:pointer; margin-top:2px; flex-shrink:0; }
      `}</style>

      <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#f0fdfa 0%,#e0f2fe 60%,#f8fafc 100%)" }}>

        {/* Hero header */}
        <div style={{ background: "linear-gradient(130deg,#0f172a 0%,#0d9488 60%,#0e7490 100%)", padding: "28px 16px 32px", textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
            <CompanyLogo size="lg" />
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: "#fff", marginTop: 4 }}>MAS Callnet — Visitor Registration</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,.75)", marginTop: 4 }}>Please fill in your details. Your host will receive an approval notification.</div>
          <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 16 }}>
            {["🆔 Identity verified", "🔒 Secure & private", "⚡ Instant notification"].map(t => (
              <div key={t} style={{ background: "rgba(255,255,255,.12)", borderRadius: 20, padding: "5px 12px", fontSize: 11, color: "#fff", fontWeight: 600 }}>{t}</div>
            ))}
          </div>
        </div>

        <div style={{ maxWidth: 680, margin: "0 auto", padding: "24px 16px 40px" }}>
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {error && (
              <div className="vsr-card" style={{ padding: "12px 16px", borderRadius: 12, background: "linear-gradient(135deg,#fef2f2,#fee2e2)", border: "1px solid #fca5a5", color: "#b91c1c", fontSize: 13, fontWeight: 600 }}>
                ⚠️ {error}
              </div>
            )}

            {/* Your Details */}
            <Card className="vsr-card">
              <SectionTitle icon="👤" title="Your Details" subtitle="We'll use this to identify you at the gate" />
              <Grid2>
                <div><Label required>Full Name</Label><Input value={form.full_name} onChange={e => up("full_name", e.target.value)} minLength={2} maxLength={200} required placeholder="Your full legal name" /></div>
                <div><Label required>Mobile Number</Label><Input value={form.mobile} onChange={e => up("mobile", e.target.value)} minLength={8} maxLength={20} required inputMode="tel" placeholder="e.g. 9876543210" /></div>
                <div><Label>Work Email</Label><Input value={form.email} onChange={e => up("email", e.target.value)} type="email" maxLength={255} placeholder="your@company.com" /></div>
                <div><Label>Company / Organisation</Label><Input value={form.company_name} onChange={e => up("company_name", e.target.value)} maxLength={255} placeholder="Your company name" /></div>
              </Grid2>
            </Card>

            {/* Visit Details */}
            <Card className="vsr-card">
              <SectionTitle icon="🏢" title="Visit Details" subtitle="Tell us when and why you are visiting" />
              <Grid2>
                <div>
                  <Label required>MAS Branch</Label>
                  <Select value={form.branch_id} onChange={e => up("branch_id", e.target.value)} required disabled={loadingBranches}>
                    <option value="">{loadingBranches ? "Loading branches…" : "Select branch"}</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.branch_name}{b.city ? ` · ${b.city}` : ""}</option>)}
                  </Select>
                </div>
                <div>
                  <Label required>Visit Type</Label>
                  <Select value={form.visit_type} onChange={e => up("visit_type", e.target.value)} required>
                    <option value="business">💼 Business Meeting</option>
                    <option value="interview">📋 Interview</option>
                    <option value="vendor">📦 Vendor / Delivery</option>
                    <option value="audit">🔍 Audit / Compliance</option>
                    <option value="training">🎓 Training / Event</option>
                    <option value="personal">🤝 Personal Visit</option>
                  </Select>
                </div>
                <div>
                  <Label required>Visit Start</Label>
                  <Input type="datetime-local" value={form.scheduled_start} onChange={e => up("scheduled_start", e.target.value)} required />
                </div>
                <div>
                  <Label required>Visit End</Label>
                  <Input type="datetime-local" value={form.scheduled_end} onChange={e => up("scheduled_end", e.target.value)} required />
                </div>
              </Grid2>
              <div style={{ marginTop: 14 }}>
                <Label required>Purpose of Visit</Label>
                <TextArea value={form.purpose} onChange={e => up("purpose", e.target.value)} minLength={5} maxLength={500} required placeholder="Briefly describe why you are visiting MAS Callnet today" />
              </div>
            </Card>

            {/* Host Search */}
            <Card className="vsr-card" style={{ background: "linear-gradient(135deg,#f0fdfa,#fff)" }}>
              <SectionTitle icon="🔍" title="Find Your Host" subtitle="Search the employee you are here to meet" />
              <div style={{ display: "flex", gap: 10 }}>
                <Input
                  value={hostSearch}
                  onChange={e => setHostSearch(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void searchHosts(); } }}
                  placeholder="Enter name or employee code (min 2 chars)"
                  disabled={!form.branch_id}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  onClick={searchHosts}
                  disabled={searchingHosts || !form.branch_id}
                  style={{ height: 44, padding: "0 18px", borderRadius: 12, background: "linear-gradient(135deg,#0f172a,#1e293b)", color: "#fff", border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer", flexShrink: 0, opacity: (!form.branch_id || searchingHosts) ? .4 : 1 }}
                >
                  {searchingHosts ? "⏳" : "🔍"} Search
                </button>
              </div>
              {!form.branch_id && <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>Select a branch first to search for a host.</div>}

              {hosts.length > 0 && !selectedHost && (
                <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 8, maxHeight: 180, overflowY: "auto" }}>
                  {hosts.map(h => (
                    <button key={h.employee_code} type="button" className="vsr-host-card" onClick={() => { setSelectedHost(h); setHosts([]); }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>{h.full_name}</div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{h.employee_code}{h.designation_name ? ` · ${h.designation_name}` : ""}</div>
                    </button>
                  ))}
                </div>
              )}

              {selectedHost && (
                <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderRadius: 12, background: "linear-gradient(135deg,#ecfdf5,#d1fae5)", border: "1.5px solid #6ee7b7" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#065f46" }}>✅ {selectedHost.full_name}</div>
                    <div style={{ fontSize: 11, color: "#047857", marginTop: 1 }}>{selectedHost.employee_code}{selectedHost.designation_name ? ` · ${selectedHost.designation_name}` : ""}</div>
                  </div>
                  <button type="button" onClick={() => setSelectedHost(null)} style={{ fontSize: 11, fontWeight: 800, color: "#047857", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>Change</button>
                </div>
              )}
            </Card>

            {/* Security Details */}
            <Card className="vsr-card">
              <SectionTitle icon="🛡️" title="Security Details" subtitle="Optional — vehicle and carried items for gate verification" />
              <Grid2>
                <div><Label>Vehicle Number</Label><Input value={form.vehicle_number} onChange={e => up("vehicle_number", e.target.value.toUpperCase())} maxLength={30} placeholder="e.g. DL 01 AB 1234" /></div>
                <div>
                  <Label>Vehicle Type</Label>
                  <Select value={form.vehicle_type} onChange={e => up("vehicle_type", e.target.value)}>
                    <option>Car</option><option>Motorcycle</option><option>Commercial vehicle</option><option>Other</option>
                  </Select>
                </div>
                <div><Label>Carried Item</Label><Input value={form.item_type} onChange={e => up("item_type", e.target.value)} maxLength={80} placeholder="Laptop, camera, equipment…" /></div>
                <div><Label>Serial Number</Label><Input value={form.serial_number} onChange={e => up("serial_number", e.target.value)} maxLength={150} placeholder="Optional asset serial" /></div>
              </Grid2>
            </Card>

            {/* Privacy Consent */}
            <Card className="vsr-card" style={{ background: "linear-gradient(135deg,#fefce8,#fef9c3)", border: "1px solid #fde047" }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" }}>
                <input type="checkbox" className="vsr-check" checked={consent} onChange={e => setConsent(e.target.checked)} />
                <span style={{ fontSize: 13, color: "#713f12", lineHeight: 1.6 }}>
                  I agree that <strong>MAS Callnet</strong> may record and process my visit details for security and access management purposes under the{" "}
                  <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" style={{ color: "#0d9488", fontWeight: 700 }}>Privacy Policy</a>
                  {" "}(Digital Personal Data Protection Act 2023 compliant). My data will be retained only as required by law.
                </span>
              </label>
            </Card>

            <button type="submit" className="vsr-btn-primary" disabled={saving || loadingBranches || !consent}>
              {saving ? "⏳ Submitting your visit request…" : "✅ Register My Visit →"}
            </button>

            <div style={{ textAlign: "center", fontSize: 12, color: "#94a3b8" }}>
              Already registered?{" "}
              <a href="/visitor-status" style={{ color: "#0d9488", fontWeight: 700, textDecoration: "underline" }}>Check your visit status</a>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
