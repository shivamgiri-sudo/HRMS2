/**
 * Hiring Engine - Master tab: the recruitment master at a glance. Reads GET /api/he/master/summary (rollups kept on
 * the lead pool, nothing copied), lets an admin refresh history one mobile prefix at a time, reviews identity clashes,
 * and opens the full candidate record. Effort tier says how much calling effort a person deserves and why.
 */
import { useCallback, useEffect, useState } from "react";
import { RefreshCcw, ShieldAlert } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { EmptyState, num } from "@/components/analytics/analytics-kit";
import Candidate360Drawer from "./Candidate360Drawer";
import CandidateImport from "./CandidateImport";
import PolicyCard from "./PolicyCard";
import FollowupSwitchCard from "./FollowupSwitchCard";
import IntegrationsCard from "./IntegrationsCard";
import DailyPlanCard from "./DailyPlanCard";
import MetaFunnelCard from "./MetaFunnelCard";
import CampaignDashboardCard from "./CampaignDashboardCard";
import CampaignSettingsCard from "./CampaignSettingsCard";
import LaunchCard from "./LaunchCard";
import RecruiterBoard from "./RecruiterBoard";
import PipelineHealthStrip from "./PipelineHealthStrip";
import BmiLinksCard from "./BmiLinksCard";

interface Summary {
  byTier: Array<{ tier: string; n: number }>;
  byReason: Array<{ tier: string; reason: string | null; n: number }>;
  byConversion: Array<{ type: string; n: number }>;
  bySource: Array<{ source: string; n: number }>;
  exEmployees: { total: number; clean: number };
  openClashes: number;
  refreshedAt: string | null;
  stale: number;
}
interface Clash { id: number; kind: string; value: string; mobile_a: string; name_a: string | null; mobile_b: string; name_b: string | null }

const TIERS = [
  { id: "high", label: "High effort", hint: "Booked, interested, walked in before, or selected but not joined", bar: "bg-emerald-500", ring: "border-emerald-200 bg-emerald-50/50", text: "text-emerald-700" },
  { id: "standard", label: "Standard", hint: "Fresh or not yet worked", bar: "bg-blue-500", ring: "border-blue-200 bg-blue-50/50", text: "text-blue-700" },
  { id: "low", label: "Low effort", hint: "Not interested, rejected after a walk-in, or many attempts with no walk-in", bar: "bg-amber-400", ring: "border-amber-200 bg-amber-50/50", text: "text-amber-700" },
  { id: "skip", label: "Do not contact", hint: "Joined, current employee, opted out, wrong number", bar: "bg-rose-400", ring: "border-rose-200 bg-rose-50/50", text: "text-rose-700" },
];
const CACHE_KEY = "he-master-summary-v1";
function readCache(): Summary | null { try { const v = sessionStorage.getItem(CACHE_KEY); return v ? (JSON.parse(v) as Summary) : null; } catch { return null; } }
function writeCache(v: Summary) { try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(v)); } catch { /* storage unavailable: page still works */ } }
const words = (s: string | null) => (s ? s.replace(/_/g, " ") : "-");

export default function MasterTab() {
  const [data, setData] = useState<Summary | null>(readCache);
  const [clashes, setClashes] = useState<Clash[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [lookup, setLookup] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, c] = await Promise.all([
        hrmsApi.get<Summary>("/api/he/master/summary"),
        hrmsApi.get<{ data: Clash[] }>("/api/he/identity/clashes"),
      ]);
      setData(s); writeCache(s); setClashes(c.data ?? []);
    } catch (e: unknown) { setError((e as { message?: string })?.message || "Unable to load the master"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const refreshAll = async () => {
    try {
      setProgress("Preparing...");
      const first = await hrmsApi.post<{ prefixes: string[] }>("/api/he/master/refresh", {});
      const prefixes = first.prefixes ?? [];
      for (let i = 0; i < prefixes.length; i++) {
        setProgress(`Refreshing history ${i + 1} of ${prefixes.length}`);
        await hrmsApi.post("/api/he/master/refresh", { prefix: prefixes[i] }, 120000);
      }
      let after: string | null = null, batch = 0;
      do {
        setProgress(`Updating former employees (batch ${++batch})...`);
        const r: { data: { next: string | null } } = await hrmsApi.post("/api/he/master/ex-employees/refresh", { after }, 120000);
        after = r.data?.next ?? null;
      } while (after);
      setProgress("Learning from past outcomes...");
      await hrmsApi.post("/api/he/model/learn", {}, 120000);
      setProgress(null); await load();
    } catch (e: unknown) { setProgress(null); setError((e as { message?: string })?.message || "Refresh stopped part-way; run it again, finished parts are kept"); }
  };
  const resolve = async (id: number, status: string) => { await hrmsApi.post(`/api/he/identity/clashes/${id}/resolve`, { status }); await load(); };
  const find = async () => {
    const q = lookup.trim(); if (!q) return;
    try { const r = await hrmsApi.get<{ data: Array<{ id: string }> }>(`/api/he/leads?page=1&size=1&q=${encodeURIComponent(q)}`); if (r.data?.[0]) setOpen(r.data[0].id); else setError("No candidate found for that number or name"); }
    catch { setError("Search failed"); }
  };

  const tier = (id: string) => Number(data?.byTier.find((t) => t.tier === id)?.n ?? 0);
  const totalPool = TIERS.reduce((a, t) => a + tier(t.id), 0);
  return (
    <div className="space-y-5">
      <PipelineHealthStrip />
      <BmiLinksCard />
      <CampaignDashboardCard />
      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="m-lookup">Find a candidate</label>
          <input id="m-lookup" value={lookup} onChange={(e) => setLookup(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void find(); }} placeholder="Mobile or name" className="w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" />
          <button type="button" onClick={() => void find()} className="cursor-pointer rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Open full record</button>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          {data && <span>{data.refreshedAt ? `History refreshed ${new Date(data.refreshedAt).toLocaleString()}` : "History never refreshed"}{data.stale > 0 ? ` · ${num(data.stale)} leads not yet refreshed` : ""}</span>}
          <button type="button" disabled={progress != null} onClick={() => void refreshAll()} className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <RefreshCcw className={`h-4 w-4 ${progress ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden /> {progress ?? "Refresh history"}
          </button>
        </div>
      </div>

      <section aria-label="Effort by tier" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {!data ? TIERS.map((t) => <div key={t.id} className="h-28 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" aria-hidden />) : TIERS.map((t) => {
          const n = tier(t.id); const share = totalPool ? Math.round((n / totalPool) * 100) : 0;
          return (
            <div key={t.id} title={t.hint} className={`rounded-xl border p-4 transition-shadow duration-200 hover:shadow-md ${t.ring}`}>
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t.label}</div>
              <div className={`mt-1 text-3xl font-bold tabular-nums leading-none ${t.text}`}>{num(n)}</div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/80"><div className={`h-full rounded-full transition-all duration-500 motion-reduce:transition-none ${t.bar}`} style={{ width: `${share}%` }} /></div>
              <div className="mt-1 text-xs text-slate-500">{share}% of the pool</div>
            </div>
          );
        })}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Why people sit in each tier</h2>
          {!data?.byReason.length ? <EmptyState label="Nothing refreshed yet" hint="Use Refresh history to compute tiers from attempts, walk-ins and employee records." height={120} /> : (
            <table className="w-full text-sm"><tbody className="divide-y divide-slate-100">
              {data.byReason.map((r, i) => <tr key={i}><td className="py-1.5 capitalize text-slate-700">{r.tier}</td><td className="py-1.5 text-slate-600">{words(r.reason)}</td><td className="py-1.5 text-right font-semibold tabular-nums">{num(Number(r.n))}</td></tr>)}
            </tbody></table>
          )}
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Where the pool came from</h2>
          <table className="w-full text-sm"><tbody className="divide-y divide-slate-100">
            {(data?.bySource ?? []).map((r) => <tr key={r.source}><td className="py-1.5 capitalize text-slate-700">{words(r.source)}</td><td className="py-1.5 text-right font-semibold tabular-nums">{num(Number(r.n))}</td></tr>)}
          </tbody></table>
          <h2 className="mb-2 mt-4 text-sm font-semibold text-slate-900">Lead age at walk-in</h2>
          <table className="w-full text-sm"><tbody className="divide-y divide-slate-100">
            {(data?.byConversion ?? []).map((r) => <tr key={r.type}><td className="py-1.5 text-slate-700">{r.type}</td><td className="py-1.5 text-right font-semibold tabular-nums">{num(Number(r.n))}</td></tr>)}
          </tbody></table>
          {data && <p className="mt-3 text-xs text-slate-500">Former employees on file: {num(data.exEmployees.total)}, of which {num(data.exEmployees.clean)} left voluntarily and cleanly. They are contacted last.</p>}
        </section>
      </div>

      <RecruiterBoard />

      <MetaFunnelCard />
      <CampaignSettingsCard />
      <LaunchCard />
      <DailyPlanCard />
      <FollowupSwitchCard />
      <PolicyCard />
      <IntegrationsCard />
      <CandidateImport onDone={() => void load()} />

      <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><ShieldAlert className="h-4 w-4 text-amber-600" aria-hidden /> Possible same person ({clashes.length})</h2>
        <p className="mb-2 text-xs text-slate-600">The same email, Aadhaar or PAN appeared on two different mobile numbers. Nothing is merged automatically.</p>
        {clashes.length === 0 ? <p className="text-sm text-slate-500">No clashes to review.</p> : (
          <ul className="space-y-2">
            {clashes.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-100 bg-white p-2 text-sm">
                <span className="font-mono text-xs">{c.kind === "aadhaar_hash" ? "Same Aadhaar" : c.kind === "pan_hash" ? "Same PAN" : c.value}</span>
                <span>{c.name_a ?? "unnamed"} ({c.mobile_a}) / {c.name_b ?? "unnamed"} ({c.mobile_b})</span>
                <span className="ml-auto flex gap-1">
                  {[["different", "Different people"], ["same_person", "Same person"], ["ignored", "Ignore"]].map(([s, l]) => <button key={s} type="button" onClick={() => void resolve(c.id, s)} className="cursor-pointer rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{l}</button>)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Candidate360Drawer leadId={open} onClose={() => setOpen(null)} />
    </div>
  );
}
