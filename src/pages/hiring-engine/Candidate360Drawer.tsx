/**
 * Candidate 360: one person's complete record from GET /api/he/leads/:id/360 - identities, every connect attempt,
 * requisitions touched, walk-ins and decisions, and whether they can be lined up today (with the reason if not).
 */
import { useEffect, useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface Elig { requisitionId: string; code: string; process: string | null; position: string | null; branch: string | null; eligible: boolean; priority: number; blocks: string[]; warnings: string[] }
interface Rec360 {
  lead: { full_name: string | null; mobile10: string; email: string | null; status: string; final_status: string; effort_tier: string; effort_reason: string | null; attempt_count: number; walkin_count: number; last_walkin_date: string | null; conversion_type: string | null; is_employee: number; primary_source: string };
  profile: { gender: string | null; languages: string[] | string | null; certifications: string[] | string | null; typing_wpm: number | null; english_level: string | null; salary_expectation: number | null; last_salary: number | null; education_status: string | null; stream: string | null; prev_industry: string | null; last_employer: string | null; state: string | null; address: string | null; dob: string | null } | null;
  identities: Array<{ kind: string; value: string; is_primary: number }>;
  clashes: Array<{ id: number; kind: string; value: string; status: string; other_mobile: string; other_name: string | null }>;
  attempts: Array<{ attempted_at: string; channel: string; source: string | null; process: string | null; actor: string | null; outcome: string | null }>;
  requisitions: { engine: Array<{ requisition_code: string; process_name: string | null; position: string | null; branch_name: string | null; state: string }>; linked: Array<{ requisition_code: string; process_name: string | null; position: string | null; outcome: string; remarks: string | null }> };
  walkins: Array<{ walk_in_date: string; branch: string | null; process: string | null; prior_decision: string | null }>;
  interviews: Array<{ process: string | null; final_decision: string | null; submitted_at: string | null }>;
  exEmployee: { exit_type: string | null; exit_sub_type: string | null; exit_date: string | null; clean_voluntary: number } | null;
  eligibility: Elig[];
}

const words = (s: string | null | undefined) => (s ? s.replace(/_/g, " ") : "-");
const day = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : "-");
const TIER: Record<string, string> = { high: "bg-emerald-50 text-emerald-700 ring-emerald-200", standard: "bg-blue-50 text-blue-700 ring-blue-200", low: "bg-amber-50 text-amber-700 ring-amber-200", skip: "bg-rose-50 text-rose-700 ring-rose-200" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-5"><h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">{title}</h3>{children}</section>;
}

export default function Candidate360Drawer({ leadId, onClose }: { leadId: string | null; onClose: () => void }) {
  const [rec, setRec] = useState<Rec360 | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (!leadId) return;
    let alive = true;
    setRec(null); setErr(false);
    hrmsApi.get<{ data: Rec360 }>(`/api/he/leads/${leadId}/360`).then((r) => alive && setRec(r.data)).catch(() => alive && setErr(true));
    return () => { alive = false; };
  }, [leadId]);
  const fit = rec?.eligibility.filter((e) => e.eligible).sort((a, b) => a.priority - b.priority) ?? [];
  const blocked = rec?.eligibility.filter((e) => !e.eligible) ?? [];
  return (
    <Sheet open={leadId != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader><SheetTitle>{rec?.lead.full_name || "Candidate record"}</SheetTitle></SheetHeader>
        {err && <p className="mt-4 text-sm text-rose-700">Could not load this record.</p>}
        {!rec && !err && <div className="mt-6 h-40 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none" aria-hidden />}
        {rec && (
          <div className="pb-8">
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-700">
              <span className="font-mono">{rec.lead.mobile10}</span>{rec.lead.email && <span>{rec.lead.email}</span>}
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ring-1 ring-inset ${TIER[rec.lead.effort_tier] ?? ""}`}>effort: {rec.lead.effort_tier}</span>
              <span className="text-xs text-slate-500">{words(rec.lead.effort_reason)}</span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[["Attempts", rec.lead.attempt_count], ["Walk-ins", rec.lead.walkin_count], ["Last walk-in", day(rec.lead.last_walkin_date)], ["Final status", words(rec.lead.final_status)]].map(([k, v]) => (
                <div key={String(k)} className="rounded-lg border border-slate-200 p-2"><dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{k}</dt><dd className="text-base font-semibold capitalize text-slate-900">{v}</dd></div>
              ))}
            </dl>
            {rec.lead.is_employee === 1 && <p className="mt-3 rounded-lg bg-rose-50 p-2 text-sm text-rose-700">Current employee - never shortlisted.</p>}
            {rec.exEmployee && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">Former employee ({words(rec.exEmployee.exit_sub_type)}, left {day(rec.exEmployee.exit_date)}) - {rec.exEmployee.clean_voluntary ? "clean voluntary exit, can be contacted but always last priority" : "not eligible to be contacted"}.</p>}
            {rec.clashes.length > 0 && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">Same {rec.clashes[0].kind} also on {rec.clashes.map((c) => `${c.other_name ?? "unnamed"} (${c.other_mobile})`).join(", ")} - flagged for HR review.</p>}

            {rec.profile && (() => {
              const p = rec.profile; const list = (v: string[] | string | null) => (Array.isArray(v) ? v : (() => { try { return v ? (JSON.parse(v) as string[]) : []; } catch { return []; } })());
              const facts: Array<[string, string | null]> = [
                ["Gender", p.gender], ["Date of birth", day(p.dob)], ["Education", [words(p.education_status), words(p.stream)].filter((x) => x && x !== "-").join(", ") || null],
                ["Previous work", [p.last_employer, p.prev_industry ? words(p.prev_industry) : null].filter(Boolean).join(" · ") || null],
                ["Last salary", p.last_salary ? `Rs ${p.last_salary.toLocaleString("en-IN")}` : null], ["Expected salary", p.salary_expectation ? `Rs ${p.salary_expectation.toLocaleString("en-IN")}` : null],
                ["Languages", list(p.languages).join(", ") || null], ["Certifications", list(p.certifications).join(", ") || null], ["Typing", p.typing_wpm ? `${p.typing_wpm} wpm` : null],
                ["English", p.english_level], ["Location", [p.address, p.state].filter(Boolean).join(", ") || null],
              ];
              const shown = facts.filter(([, v]) => v && v !== "-");
              return shown.length ? (
                <Section title="Profile used for screening">
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">{shown.map(([k, v]) => <div key={k} className="flex gap-2"><dt className="w-28 shrink-0 text-slate-500">{k}</dt><dd className="capitalize text-slate-800">{v}</dd></div>)}</dl>
                </Section>
              ) : null;
            })()}

            <Section title="Can be lined up for">
              {fit.length === 0 && <p className="text-sm text-slate-500">No open requisition fits right now.</p>}
              <ul className="space-y-1.5 text-sm">
                {fit.map((e) => <li key={e.requisitionId} className="flex justify-between gap-2 rounded-lg border border-emerald-100 bg-emerald-50/40 px-3 py-1.5"><span>{e.code} · {e.process ?? "-"} · {e.position ?? "-"} · {e.branch ?? "-"}</span><span className="text-xs text-slate-500">priority {e.priority}{e.warnings.length ? ` · ${e.warnings.map(words).join(", ")}` : ""}</span></li>)}
              </ul>
              {blocked.length > 0 && <details className="mt-2 text-sm"><summary className="cursor-pointer text-slate-600">Not eligible for {blocked.length} open requisition(s)</summary>
                <ul className="mt-1 space-y-1">{blocked.map((e) => <li key={e.requisitionId} className="text-slate-600">{e.code} · {e.process ?? "-"}: <span className="font-medium text-rose-700">{e.blocks.map(words).join(", ")}</span></li>)}</ul></details>}
            </Section>

            <Section title="Requisitions approached for">
              {rec.requisitions.engine.length + rec.requisitions.linked.length === 0 && <p className="text-sm text-slate-500">None yet.</p>}
              <ul className="space-y-1 text-sm text-slate-700">
                {rec.requisitions.engine.map((m, i) => <li key={`e${i}`}>{m.requisition_code} · {m.process_name ?? "-"} · {m.position ?? "-"} · {m.branch_name ?? "-"} - <span className="capitalize">{words(m.state)}</span></li>)}
                {rec.requisitions.linked.map((m, i) => <li key={`l${i}`}>{m.requisition_code} · {m.process_name ?? "-"} · {m.position ?? "-"} - <span className="capitalize">{words(m.outcome)}</span>{m.remarks ? ` (${m.remarks})` : ""}</li>)}
              </ul>
            </Section>

            <Section title="Walk-ins and decisions">
              <ul className="space-y-1 text-sm text-slate-700">
                {rec.walkins.map((w, i) => <li key={`w${i}`}>{day(w.walk_in_date)} · {w.branch ?? "-"} · {w.process ?? "-"}{w.prior_decision ? ` (earlier: ${w.prior_decision})` : ""}</li>)}
                {rec.interviews.map((w, i) => <li key={`i${i}`}>{day(w.submitted_at)} · interviewed for {w.process ?? "-"}: <span className="font-medium">{w.final_decision ?? "-"}</span></li>)}
                {rec.walkins.length + rec.interviews.length === 0 && <li className="text-slate-500">No walk-in on record.</li>}
              </ul>
            </Section>

            <Section title={`Every connect attempt (${rec.attempts.length})`}>
              <ul className="space-y-1 text-sm text-slate-700">
                {rec.attempts.map((a, i) => <li key={i} className="flex gap-2"><span className="w-24 shrink-0 text-xs tabular-nums text-slate-500">{day(a.attempted_at)}</span><span className="capitalize">{words(a.channel)}</span><span className="text-slate-500">{[a.source, a.process, a.actor].filter(Boolean).join(" · ")}</span><span className="ml-auto font-medium">{a.outcome ?? ""}</span></li>)}
                {rec.attempts.length === 0 && <li className="text-slate-500">No attempts recorded.</li>}
              </ul>
            </Section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
