/**
 * Provider hookups (Master tab, admin only): the webhook token and the three URLs to paste into Pinbot (WhatsApp replies and delivery ticks)
 * and Superbot (call feedback, rejected numbers), plus the Superbot settings. The API key is write-only: it is shown as its last four characters.
 */
import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, PhoneCall } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

interface Snapshot {
  webhook: { configured: boolean; source: "env" | "screen" | "none"; urls: { pinbot: string | null; superbotFeedback: string | null; superbotRejected: string | null } };
  superbot: { configured: boolean; apiKey: string | null; superbotId: string | null; campaignId: string | null; baseUrl: string; lang: string; whitelistIps: string[] };
}
const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";
const btn = "cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";

function UrlRow({ label, url }: { label: string; url: string | null }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { if (!url) return; try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* the field stays selectable */ } };
  return (
    <div>
      <label className="text-xs font-medium text-slate-600" htmlFor={`url-${label}`}>{label}</label>
      <div className="mt-1 flex gap-2">
        <input id={`url-${label}`} readOnly value={url ?? "Generate the token first"} onFocus={(e) => e.currentTarget.select()} className={`${input} font-mono text-xs`} />
        <button type="button" disabled={!url} onClick={() => void copy()} className={`${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`} aria-label={`Copy ${label}`}><Copy className="h-4 w-4" aria-hidden /> <span className="sr-only">{copied ? "Copied" : "Copy"}</span></button>
      </div>
    </div>
  );
}

export default function IntegrationsCard() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [denied, setDenied] = useState(false);
  const [form, setForm] = useState({ apiKey: "", superbotId: "", campaignId: "", lang: "en-IN" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const apply = (r: Snapshot) => { setSnap(r); setForm((f) => ({ ...f, apiKey: "", superbotId: r.superbot.superbotId ?? f.superbotId, campaignId: r.superbot.campaignId ?? f.campaignId, lang: r.superbot.lang })); };
  const load = useCallback(async () => {
    try { apply(await hrmsApi.get<Snapshot>("/api/he/integrations")); } catch { setDenied(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (denied || !snap) return null; // not an admin (or still loading): nothing to show

  const run = async (fn: () => Promise<void>) => { setBusy(true); setMsg(null); try { await fn(); } catch (e: unknown) { setMsg({ ok: false, text: (e as { message?: string })?.message || "That did not work" }); } finally { setBusy(false); } };
  const generate = () => run(async () => { apply(await hrmsApi.post<Snapshot>("/api/he/integrations/webhook-token")); setMsg({ ok: true, text: "Token ready. Paste the URLs below into Pinbot and Superbot. If you regenerate it later, paste them again." }); });
  const save = () => run(async () => {
    apply(await hrmsApi.put<Snapshot>("/api/he/integrations/superbot", form));
    setMsg({ ok: true, text: "Saved." });
  });
  const test = () => run(async () => { const r = await hrmsApi.post<{ ok: boolean; message: string }>("/api/he/integrations/superbot/test"); setMsg({ ok: r.ok, text: r.message }); });

  return (
    <section aria-label="Provider hookups" className="space-y-5 rounded-xl border border-slate-200 bg-white p-4">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><KeyRound className="h-4 w-4 text-blue-600" aria-hidden /> Webhook links for Pinbot and Superbot</h2>
        <p className="mt-1 text-xs text-slate-600">Without these, WhatsApp replies, delivery ticks and call results never reach the engine. {snap.webhook.source === "env" ? "The token is set by the server." : snap.webhook.configured ? "Token is set." : "No token yet."}</p>
        {snap.webhook.source !== "env" && <button type="button" disabled={busy} onClick={() => void generate()} className={`${btn} mt-2 bg-blue-600 text-white hover:bg-blue-700`}>{snap.webhook.configured ? "Regenerate token" : "Generate token"}</button>}
        <div className="mt-3 space-y-3">
          <UrlRow label="Pinbot WhatsApp webhook (replies and delivery status)" url={snap.webhook.urls.pinbot} />
          <UrlRow label="Superbot call feedback webhook (share with Superbot)" url={snap.webhook.urls.superbotFeedback} />
          <UrlRow label="Superbot rejected numbers webhook (optional)" url={snap.webhook.urls.superbotRejected} />
        </div>
      </div>

      <div className="border-t border-slate-100 pt-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><PhoneCall className="h-4 w-4 text-emerald-600" aria-hidden /> Voice bot (Superbot) {snap.superbot.configured ? "· connected settings saved" : "· not set up"}</h2>
        <p className="mt-1 text-xs text-slate-600">Superbot must whitelist this server&apos;s IP on their side; they call us from {snap.superbot.whitelistIps.join(" and ")}. The calling script is configured in the Superbot campaign.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div><label className="text-xs font-medium text-slate-600" htmlFor="sb-key">API key {snap.superbot.apiKey ? `(saved ${snap.superbot.apiKey}; leave blank to keep)` : ""}</label><input id="sb-key" type="password" autoComplete="off" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} className={input} /></div>
          <div><label className="text-xs font-medium text-slate-600" htmlFor="sb-id">Superbot id</label><input id="sb-id" value={form.superbotId} onChange={(e) => setForm({ ...form, superbotId: e.target.value })} className={input} /></div>
          <div><label className="text-xs font-medium text-slate-600" htmlFor="sb-camp">Campaign id</label><input id="sb-camp" inputMode="numeric" value={form.campaignId} onChange={(e) => setForm({ ...form, campaignId: e.target.value })} className={input} /></div>
          <div><label className="text-xs font-medium text-slate-600" htmlFor="sb-lang">Language</label><input id="sb-lang" value={form.lang} onChange={(e) => setForm({ ...form, lang: e.target.value })} className={input} /></div>
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={busy} onClick={() => void save()} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>Save</button>
          <button type="button" disabled={busy || !snap.superbot.configured} onClick={() => void test()} className={`${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`}>Test connection</button>
        </div>
      </div>
      {msg && <p role="status" className={`text-sm ${msg.ok ? "text-emerald-700" : "text-rose-700"}`}>{msg.text}</p>}
    </section>
  );
}
