import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  KIND_LABELS, KIND_TONE, fmtDate, fmtDateTime, humanize, personLabel,
  type DetailData, type LedgerKind,
} from "./ledgerTypes";

const SECTION = "text-xs font-bold uppercase tracking-wide text-slate-400";
const DATETIME_KEY = /(_at|_time)$/;
const DATE_KEY = /(_date)$/;

export interface LedgerDrawerTarget { kind: LedgerKind; id: string }

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className={SECTION}>{title}</h3>
      {children}
    </section>
  );
}

function None() {
  return <p className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-sm text-slate-400">None</p>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="break-words text-right font-medium text-slate-900">{value === null || value === undefined || value === "" ? "None" : value}</span>
    </div>
  );
}

function Box({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 px-3">{children}</div>;
}

/** Render one stored value: dates as DD/MM/YYYY [HH:mm], objects as JSON, empty as None. */
function fieldValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "None";
  if (typeof value === "object") return JSON.stringify(value, null, 1);
  if (DATETIME_KEY.test(key) && typeof value === "string") return fmtDateTime(value);
  if (DATE_KEY.test(key) && typeof value === "string") return fmtDate(value);
  return String(value);
}

function ObjectRows({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return <None />;
  return (
    <Box>
      {entries.map(([k, v]) => (
        <Row key={k} label={humanize(k)} value={<span className="whitespace-pre-wrap">{fieldValue(k, v)}</span>} />
      ))}
    </Box>
  );
}

export function LedgerDrawer({ target, onClose }: { target: LedgerDrawerTarget | null; onClose: () => void }) {
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) { setDetail(null); return; }
    let cancelled = false;
    setDetail(null);
    setError(null);
    hrmsApi
      .get<{ success: boolean; data: DetailData }>(`/api/wfm/attendance-ledger/entries/${target.kind}/${encodeURIComponent(target.id)}`)
      .then((res) => { if (!cancelled) setDetail(res.data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load entry"); });
    return () => { cancelled = true; };
  }, [target]);

  const rec = detail?.record;
  const decision = rec ? String(rec.status ?? rec.attendance_status ?? "resolved") : null;
  const stamp = detail?.timeline.length ? detail.timeline[detail.timeline.length - 1].at : null;

  return (
    <Sheet open={Boolean(target)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="h-full w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {detail ? personLabel({ name: detail.employee.name, code: detail.employee.code }) : "Ledger entry"}
            {detail && <Badge className={`${KIND_TONE[detail.kind]} hover:${KIND_TONE[detail.kind]}`}>{KIND_LABELS[detail.kind]}</Badge>}
            {decision && <Badge variant="outline">{humanize(decision)}</Badge>}
          </SheetTitle>
          {detail && (
            <p className="text-sm text-slate-500">
              ID {String(rec?.id)} · {detail.employee.branch_name ?? "None"} · Last activity {fmtDateTime(stamp)}
            </p>
          )}
        </SheetHeader>

        {!detail && !error && <div className="flex justify-center py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>}
        {error && <p className="py-8 text-sm font-medium text-red-700">{error}</p>}

        {detail && rec && (
          <div className="mt-6 space-y-6 pb-8">
            {detail.warnings.length > 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{detail.warnings.join(" ")}</p>
            )}

            <Section title="People involved">
              <Box>
                <Row label="Given to" value={personLabel({ name: detail.employee.name, code: detail.employee.code })} />
                {Object.entries(detail.people).map(([field, p]) => (
                  <Row
                    key={field}
                    label={humanize(field.replace(/_user_id$|_by$/, ""))}
                    value={p ? <>{personLabel(p)}{p.role ? <span className="block text-xs font-normal text-slate-400">{p.role}</span> : null}</> : "None"}
                  />
                ))}
              </Box>
            </Section>

            <Section title="Timeline">
              {detail.timeline.length === 0 ? <None /> : (
                <ol className="space-y-2 border-l-2 border-slate-200 pl-4">
                  {detail.timeline.map((t, i) => (
                    <li key={`${t.label}-${i}`} className="text-sm">
                      <p className="font-semibold text-slate-900">{t.label}</p>
                      <p className="text-xs text-slate-500">{fmtDateTime(t.at)} · {t.by ? personLabel(t.by) : "None"}</p>
                      {t.note && <p className="mt-0.5 text-slate-700">{t.note}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </Section>

            {Object.entries(detail.related).map(([name, rows]) => (
              <Section key={name} title={humanize(name)}>
                {rows.length === 0 ? <None /> : (
                  <div className="space-y-2">
                    {rows.map((row, i) => <ObjectRows key={String(row.id ?? i)} data={row} />)}
                  </div>
                )}
              </Section>
            ))}

            <Section title="Audit trail">
              {detail.audit.length === 0 ? <None /> : (
                <div className="space-y-2">
                  {detail.audit.map((a) => (
                    <div key={a.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                      <p className="font-semibold text-slate-900">{humanize(a.action_type)}</p>
                      <p className="text-xs text-slate-500">
                        {fmtDateTime(a.acted_at)} · {a.actor ? personLabel(a.actor) : "None"}{a.actor_role ? ` · ${a.actor_role}` : ""}
                      </p>
                      {a.reason && <p className="mt-0.5 text-slate-700">{a.reason}</p>}
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Full record">
              <ObjectRows data={rec} />
            </Section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
