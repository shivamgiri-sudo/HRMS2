/**
 * Per Meta campaign settings (Master tab): who does the outreach (the old Meta flow or the Hiring Engine), which channels may be used, and which
 * Superbot campaign the bot call goes to. A campaign handed to the Hiring Engine gets email, WhatsApp, bot call, reminders, location, arrival and
 * no-show follow-up; the old Meta flow stops messaging its leads.
 */
import { useCallback, useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { num } from "@/components/analytics/analytics-kit";

interface Cfg { campaignId: string; campaignName: string; status: string; requisitionCode: string | null; branchName: string | null; qualified: number; owner: "meta" | "he"; emailOn: boolean; whatsappOn: boolean; voiceOn: boolean; superbotCampaign: string | null }

export default function CampaignSettingsCard() {
  const [rows, setRows] = useState<Cfg[] | null>(null);
  const [draft, setDraft] = useState<Record<string, Cfg>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    try { const r = await hrmsApi.get<{ data: Cfg[] }>("/api/he/campaign-config"); setRows(r.data); setDraft({}); }
    catch { setMsg({ ok: false, text: "Could not load the campaign settings" }); setRows([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const cur = (c: Cfg) => draft[c.campaignId] ?? c;
  const edit = (c: Cfg, p: Partial<Cfg>) => setDraft((d) => ({ ...d, [c.campaignId]: { ...cur(c), ...p } }));
  const save = async (c: Cfg) => {
    const v = cur(c); setBusy(c.campaignId); setMsg(null);
    try {
      await hrmsApi.put(`/api/he/campaign-config/${c.campaignId}`, { owner: v.owner, emailOn: v.emailOn, whatsappOn: v.whatsappOn, voiceOn: v.voiceOn, superbotCampaign: v.superbotCampaign?.trim() || null });
      setMsg({ ok: true, text: `Saved: ${c.campaignName}` }); await load();
    } catch (e: unknown) { setMsg({ ok: false, text: (e as { message?: string })?.message || "Only an admin can change campaign settings" }); }
    finally { setBusy(null); }
  };
  const box = "h-4 w-4 cursor-pointer";
  return (
    <section aria-label="Campaign settings" className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><SlidersHorizontal className="h-4 w-4 text-indigo-600" aria-hidden /> Meta campaign settings: owner, channels, bot</h2>
      <p className="mt-1 text-xs text-slate-600">Set a campaign to <b>Hiring Engine</b> and its qualified leads join the engine as they arrive (email, WhatsApp, bot call, reminders, location, arrival, no-show follow-up); the old Meta flow stops messaging them. Turn a channel off to skip it for that campaign. Leave the Superbot campaign empty to use the default one.</p>
      {!rows ? <div className="mt-3 h-24 animate-pulse rounded-lg bg-slate-50 motion-reduce:animate-none" aria-hidden /> : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500"><tr><th className="px-3 py-2">Campaign</th><th className="px-3 py-2">Qualified</th><th className="px-3 py-2">Outreach by</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">WhatsApp</th><th className="px-3 py-2">Bot call</th><th className="px-3 py-2">Superbot campaign</th><th className="px-3 py-2" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c) => {
                const v = cur(c); const dirty = Boolean(draft[c.campaignId]);
                return (
                  <tr key={c.campaignId}>
                    <td className="px-3 py-2"><div className="font-medium text-slate-900">{c.campaignName}</div><div className="text-xs text-slate-500">{c.status}{c.requisitionCode ? ` · ${c.requisitionCode}` : ""}{c.branchName ? ` · ${c.branchName}` : ""}</div></td>
                    <td className="px-3 py-2 tabular-nums">{num(c.qualified)}</td>
                    <td className="px-3 py-2">
                      <label className="sr-only" htmlFor={`own-${c.campaignId}`}>Outreach owner for {c.campaignName}</label>
                      <select id={`own-${c.campaignId}`} value={v.owner} onChange={(e) => edit(c, { owner: e.target.value as "meta" | "he" })} className={`rounded-md border px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${v.owner === "he" ? "border-emerald-300 bg-emerald-50" : "border-slate-300"}`}>
                        <option value="meta">Old Meta flow</option><option value="he">Hiring Engine</option>
                      </select>
                    </td>
                    {(["emailOn", "whatsappOn", "voiceOn"] as const).map((k) => (
                      <td key={k} className="px-3 py-2"><input type="checkbox" className={box} aria-label={`${k === "emailOn" ? "Email" : k === "whatsappOn" ? "WhatsApp" : "Bot call"} for ${c.campaignName}`} checked={v[k]} onChange={(e) => edit(c, { [k]: e.target.checked } as Partial<Cfg>)} /></td>
                    ))}
                    <td className="px-3 py-2"><input aria-label={`Superbot campaign for ${c.campaignName}`} value={v.superbotCampaign ?? ""} onChange={(e) => edit(c, { superbotCampaign: e.target.value })} placeholder="default" maxLength={40} className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" /></td>
                    <td className="px-3 py-2 text-right"><button type="button" disabled={!dirty || busy === c.campaignId} onClick={() => void save(c)} className="cursor-pointer rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{busy === c.campaignId ? "Saving…" : "Save"}</button></td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">No Meta campaigns yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {msg && <p role="status" className={`mt-2 text-sm ${msg.ok ? "text-emerald-700" : "text-rose-700"}`}>{msg.text}</p>}
    </section>
  );
}
