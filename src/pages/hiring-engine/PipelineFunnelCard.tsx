/**
 * Hiring pipeline for the CEO: per drive (Live Meta, Old Meta data, Hiring Engine) how far qualified people have got, what is still
 * queued, when sending resumes, and what the engine did in the last 24 hours. Reads GET /api/he/qualified-followup/pipeline.
 * A zero is always explained: "queued" says how many are still to go and the banner says when the send window opens.
 */
import { useEffect, useState } from "react";
import { Activity, CalendarClock, Clock3 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { pipelineStages, windowBanner, whenIst, type PipelineView } from "./pipelineFunnelModel";

const num = (n: number) => n.toLocaleString("en-IN");

export default function PipelineFunnelCard() {
  const [data, setData] = useState<PipelineView | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => hrmsApi.get<{ data: PipelineView }>("/api/he/qualified-followup/pipeline").then((r) => { if (alive) { setData(r.data); setFailed(false); } }).catch(() => { if (alive) setFailed(true); });
    void load();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);
  if (failed && !data) return null;
  if (!data) return <div className="h-40 animate-pulse rounded-xl border border-slate-200 bg-slate-50 motion-reduce:animate-none" aria-hidden />;
  const banner = windowBanner(data);
  const tiles: Array<[string, number]> = [["Emails sent", data.last24h.emails], ["WhatsApps sent", data.last24h.whatsapps], ["Call results back", data.last24h.callResults], ["Replies received", data.last24h.replies], ["Slots confirmed", data.last24h.confirmations]];
  return (
    <section aria-labelledby="pf-title" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="pf-title" className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100"><Activity className="h-4 w-4 text-blue-600" aria-hidden /> Hiring pipeline: how far each drive has got</h2>
        <span className="text-xs text-slate-600 dark:text-slate-300">Live follow-up only. Updated {whenIst(data.generatedAt)}.</span>
      </div>
      <p className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${data.windowOpen ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100" : "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100"}`} role="status">
        {data.windowOpen ? <Clock3 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
        <span>{banner}</span>
      </p>
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Last 24 hours</p>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {tiles.map(([label, v]) => (
            <li key={label} className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
              <div className="text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{num(v)}</div>
              <div className="text-xs text-slate-600 dark:text-slate-300">{label}</div>
            </li>
          ))}
        </ul>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        {data.sources.map((s) => {
          const stages = pipelineStages(s);
          return (
            <article key={s.sourceType} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700" aria-label={s.label}>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{s.label}</h3>
              {(s.formFillsToday || (s.enrolledToday ?? 0) > 0) && (
                <p className="mt-1 text-xs text-slate-700 dark:text-slate-200">
                  <span className="font-semibold">Today:</span>{s.formFillsToday ? ` ${num(s.formFillsToday.fills)} form fills (${num(s.formFillsToday.qualified)} qualified),` : ""} {num(s.enrolledToday ?? 0)} newly enrolled.
                </p>
              )}
              {s.enrolled === 0 ? <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Nobody has been enrolled in this drive yet.</p> : (
                <ol className="mt-2 space-y-1.5">
                  {stages.map((st) => (
                    <li key={st.key}>
                      <div className="flex items-baseline justify-between text-xs text-slate-700 dark:text-slate-200"><span>{st.label}</span><span className="tabular-nums font-semibold">{num(st.value)}<span className="font-normal text-slate-500"> · {st.pct}%</span></span></div>
                      <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-blue-500" style={{ width: `${st.pct}%` }} /></div>
                    </li>
                  ))}
                </ol>
              )}
              {s.enrolled > 0 && (
                <p className="mt-2 text-xs text-slate-700 dark:text-slate-200">
                  <span className="font-semibold">Still to go:</span> {num(s.waiting.email)} emails, {num(s.waiting.whatsapp)} WhatsApps, {num(s.waiting.call)} calls.
                  {s.lastEmailAt ? ` Last email ${s.lastEmailAt}.` : ""}{s.lastWhatsappAt ? ` Last WhatsApp ${s.lastWhatsappAt}.` : ""}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
