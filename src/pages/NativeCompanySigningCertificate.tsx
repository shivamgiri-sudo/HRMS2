/**
 * Super Admin — company signing certificate.
 *
 * Appointment letters are signed by the company before they reach the employee.
 * This is where that credential lives.
 *
 * The page is deliberately blunt about the legal difference: a self-signed
 * certificate gets you a working pipeline today, but only a CCA-licensed DSC
 * makes the signature legally binding, and letters signed with the former say so
 * on their face.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, BadgeCheck, CheckCircle2, Clock, Loader2, ShieldAlert,
  ShieldCheck, Trash2, Upload, Wand2,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

type Certificate = {
  id: string;
  label: string;
  subjectCn: string | null;
  issuerCn: string | null;
  serialNumber: string | null;
  validFrom: string | null;
  validTo: string | null;
  fingerprintSha256: string | null;
  isSelfSigned: boolean;
  isCaIssued: boolean;
  signerName: string;
  signerDesignation: string;
  activeStatus: boolean;
  uploadedAt: string | null;
  expired: boolean;
  expiringSoon: boolean;
  legalStanding: string;
};

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export default function NativeCompanySigningCertificate() {
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [active, setActive] = useState<Certificate | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [signerName, setSignerName] = useState("");
  const [signerDesignation, setSignerDesignation] = useState("HR Manager / Authorised Signatory");
  const [passphrase, setPassphrase] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await hrmsApi.get<{ data: { certificates: Certificate[]; active: Certificate | null } }>(
        "/api/signing/certificates",
      );
      setCertificates(res.data?.certificates ?? []);
      setActive(res.data?.active ?? null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load signing certificates.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const requireSignatory = () => {
    if (!signerName.trim() || !signerDesignation.trim()) {
      setError("Signatory name and designation are required — they are printed on every letter.");
      return false;
    }
    return true;
  };

  const generate = async () => {
    if (!requireSignatory()) return;
    setBusy("generate"); setError(null); setNotice(null);
    try {
      const res = await hrmsApi.post<{ warning?: string }>("/api/signing/certificates/generate", {
        signer_name: signerName.trim(),
        signer_designation: signerDesignation.trim(),
        organisation: "Mas Callnet India Pvt. Ltd.",
      });
      setNotice(res.warning ?? "Self-signed certificate generated and activated.");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not generate a certificate.");
    } finally { setBusy(null); }
  };

  const uploadCertificate = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { setError("Choose a .pfx or .p12 certificate file first."); return; }
    if (!requireSignatory()) return;
    setBusy("upload"); setError(null); setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("passphrase", passphrase);
      form.append("signer_name", signerName.trim());
      form.append("signer_designation", signerDesignation.trim());
      await hrmsApi.postForm("/api/signing/certificates/upload", form);
      setNotice("Certificate uploaded and activated.");
      setPassphrase("");
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not upload the certificate.");
    } finally { setBusy(null); }
  };

  const activate = async (id: string) => {
    setBusy(id); setError(null);
    try { await hrmsApi.post(`/api/signing/certificates/${id}/activate`, {}); await load(); }
    catch (err: unknown) { setError(err instanceof Error ? err.message : "Could not activate."); }
    finally { setBusy(null); }
  };

  const remove = async (id: string) => {
    setBusy(id); setError(null);
    try { await hrmsApi.delete(`/api/signing/certificates/${id}`); await load(); }
    catch (err: unknown) { setError(err instanceof Error ? err.message : "Could not remove."); }
    finally { setBusy(null); }
  };

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-5xl space-y-5">
        <header>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-300">Super Admin</p>
          <h1 className="mt-1 text-3xl font-black">Company Signing Certificate</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">
            The credential used to sign appointment letters on behalf of Mas Callnet, before they are sent
            to the employee for their own Aadhaar eSign.
          </p>
        </header>

        {/* Current standing — the most important thing on the page. */}
        {!loading && (
          active
            ? active.expired
              ? <Banner tone="danger" icon={<ShieldAlert className="h-5 w-5" />}
                  title="Signing is blocked — the active certificate has expired"
                  body={`"${active.label}" expired on ${fmt(active.validTo)}. No letter can be issued until a current certificate is activated. Signing under a lapsed certificate would invalidate every letter produced after it expired.`} />
              : active.isCaIssued
                ? <Banner tone="ok" icon={<ShieldCheck className="h-5 w-5" />}
                    title="Legally binding signatures are active"
                    body={`Signed by ${active.signerName} (${active.signerDesignation}) using a CA-issued certificate from ${active.issuerCn ?? "a licensed CA"}. Satisfies IT Act 2000 s.3.`} />
                : <Banner tone="warn" icon={<AlertTriangle className="h-5 w-5" />}
                    title="Running on a self-signed certificate"
                    body="Letters are being signed and are tamper-evident, but this is NOT a CCA-licensed digital signature. PDF readers will report the signature as untrusted, and every letter carries a visible notice saying so. Upload a Class-3 organisation DSC to remove it."/>
            : <Banner tone="danger" icon={<ShieldAlert className="h-5 w-5" />}
                title="No signing certificate — appointment letters cannot be issued"
                body="Generate a self-signed certificate to start immediately, or upload a Class-3 organisation DSC from a CCA-licensed Certifying Authority (eMudhra, Sify, (n)Code, Capricorn, VSign, XtraTrust)." />
        )}

        {active && !active.expired && active.expiringSoon && (
          <Banner tone="warn" icon={<Clock className="h-5 w-5" />}
            title="Certificate expires soon"
            body={`"${active.label}" expires on ${fmt(active.validTo)}. Renew before then — signing stops the day it lapses.`} />
        )}

        {error && <Banner tone="danger" icon={<AlertTriangle className="h-5 w-5" />} title="Something went wrong" body={error} />}
        {notice && <Banner tone="ok" icon={<CheckCircle2 className="h-5 w-5" />} title="Done" body={notice} />}

        {/* Signatory — printed on every letter. */}
        <section className="rounded-[24px] border border-white/10 bg-white/5 p-5">
          <h2 className="text-sm font-black uppercase tracking-[0.16em] text-slate-400">Signatory</h2>
          <p className="mt-1 text-xs text-slate-400">
            Printed on each letter as “Digitally signed/authorised by”.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Name" value={signerName} onChange={setSignerName} placeholder="e.g. Rajesh Ramachandran" />
            <Field label="Designation" value={signerDesignation} onChange={setSignerDesignation} placeholder="HR Manager / Authorised Signatory" />
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* Upload the real thing */}
          <section className="rounded-[24px] border border-white/10 bg-white/5 p-5">
            <h2 className="flex items-center gap-2 text-base font-black"><Upload className="h-4 w-4 text-cyan-300" /> Upload a DSC</h2>
            <p className="mt-1 text-xs text-slate-400">
              A Class-3 organisation certificate (.pfx / .p12) issued in the company’s name. This is what
              makes letters legally binding.
            </p>
            <input ref={fileRef} type="file" accept=".pfx,.p12"
              className="mt-4 block w-full rounded-2xl border border-white/10 bg-black/20 p-3 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-cyan-500 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-slate-950" />
            <label className="mt-3 block">
              <span className="mb-1.5 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">Certificate password</span>
              <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)}
                className="min-h-[44px] w-full rounded-2xl border border-white/10 bg-black/20 px-3 text-sm outline-none focus:border-cyan-400"
                placeholder="Password protecting the .pfx file" />
            </label>
            <p className="mt-2 text-[11px] text-slate-500">
              Stored encrypted. Never displayed again and never returned by the API.
            </p>
            <button type="button" onClick={() => void uploadCertificate()} disabled={busy !== null}
              className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-4 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60">
              {busy === "upload" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Upload &amp; activate
            </button>
          </section>

          {/* Get going now */}
          <section className="rounded-[24px] border border-amber-400/25 bg-amber-500/[0.06] p-5">
            <h2 className="flex items-center gap-2 text-base font-black"><Wand2 className="h-4 w-4 text-amber-300" /> Generate a self-signed certificate</h2>
            <p className="mt-1 text-xs text-slate-400">
              Creates a working certificate immediately, so issuance is not blocked while a DSC is procured.
            </p>
            <ul className="mt-3 space-y-1.5 text-xs text-amber-200/90">
              <li>• Letters are signed and tamper-evident</li>
              <li>• Adobe shows “Signature validity is UNKNOWN”</li>
              <li>• Each letter carries a visible “not a CCA-licensed digital signature” notice</li>
              <li>• Swapping to a real DSC later is an upload — nothing is rebuilt</li>
            </ul>
            <button type="button" onClick={() => void generate()} disabled={busy !== null}
              className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl border border-amber-400/40 bg-amber-500/15 px-4 text-sm font-semibold text-amber-100 hover:bg-amber-500/25 disabled:opacity-60">
              {busy === "generate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              Generate &amp; activate
            </button>
          </section>
        </div>

        <section className="rounded-[24px] border border-white/10 bg-white/5 p-5">
          <h2 className="text-sm font-black uppercase tracking-[0.16em] text-slate-400">Certificates</h2>
          {loading ? (
            <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
          ) : certificates.length === 0 ? (
            <p className="mt-4 text-sm text-slate-400">None yet.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {certificates.map((c) => (
                <div key={c.id} className={`rounded-2xl border p-4 ${c.activeStatus ? "border-cyan-400/40 bg-cyan-500/[0.07]" : "border-white/10 bg-black/20"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{c.label}</span>
                        {c.activeStatus && <Tag tone="ok">Active</Tag>}
                        {c.isCaIssued ? <Tag tone="ok"><BadgeCheck className="mr-1 inline h-3 w-3" />CA-issued</Tag> : <Tag tone="warn">Self-signed</Tag>}
                        {c.expired && <Tag tone="danger">Expired</Tag>}
                        {!c.expired && c.expiringSoon && <Tag tone="warn">Expiring soon</Tag>}
                      </div>
                      <p className="mt-2 text-xs text-slate-400">
                        Subject {c.subjectCn ?? "—"} · Issuer {c.issuerCn ?? "—"} · Valid {fmt(c.validFrom)} – {fmt(c.validTo)}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        Signs as {c.signerName} ({c.signerDesignation})
                      </p>
                      {c.fingerprintSha256 && (
                        <p className="mt-1 break-all font-mono text-[10px] text-slate-500">SHA-256 {c.fingerprintSha256}</p>
                      )}
                      <p className={`mt-2 text-xs ${c.isCaIssued ? "text-emerald-300/90" : "text-amber-300/90"}`}>{c.legalStanding}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {!c.activeStatus && !c.expired && (
                        <button type="button" onClick={() => void activate(c.id)} disabled={busy !== null}
                          className="rounded-xl border border-white/15 px-3 py-1.5 text-xs font-semibold hover:bg-white/10 disabled:opacity-60">
                          {busy === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Activate"}
                        </button>
                      )}
                      {!c.activeStatus && (
                        <button type="button" onClick={() => void remove(c.id)} disabled={busy !== null}
                          className="rounded-xl border border-red-400/30 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/15 disabled:opacity-60">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Banner({ tone, icon, title, body }: {
  tone: "ok" | "warn" | "danger"; icon: React.ReactNode; title: string; body: string;
}) {
  const cls = tone === "ok" ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
    : tone === "warn" ? "border-amber-400/30 bg-amber-500/10 text-amber-100"
    : "border-red-400/30 bg-red-500/10 text-red-100";
  return (
    <div className={`rounded-2xl border px-4 py-3 ${cls}`}>
      <div className="flex gap-3">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <div>
          <p className="font-bold">{title}</p>
          <p className="mt-1 text-sm opacity-90">{body}</p>
        </div>
      </div>
    </div>
  );
}

function Tag({ tone, children }: { tone: "ok" | "warn" | "danger"; children: React.ReactNode }) {
  const cls = tone === "ok" ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-200"
    : tone === "warn" ? "border-amber-400/30 bg-amber-500/15 text-amber-200"
    : "border-red-400/30 bg-red-500/15 text-red-200";
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cls}`}>{children}</span>;
}

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="min-h-[44px] w-full rounded-2xl border border-white/10 bg-black/20 px-3 text-sm outline-none focus:border-cyan-400" />
    </label>
  );
}
