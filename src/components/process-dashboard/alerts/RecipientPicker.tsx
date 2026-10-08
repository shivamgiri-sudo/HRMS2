import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { FOCUS } from "../ui";
import { alertsKey, previewRecipients, searchPeople, type RecipientSpec } from "./api";
import { VIEWER_ROLE_OPTIONS, field } from "./alertUi";

interface Props { processId: string; value: RecipientSpec; onChange: (v: RecipientSpec) => void; tlOptions: string[] }

/** Roles, team leaders and named people. Everything is re-checked against the process scope server-side; the live line below shows who actually qualifies. */
export function RecipientPicker({ processId, value, onChange, tlOptions }: Props) {
  const id = useId();
  const [q, setQ] = useState(""); const [dq, setDq] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const hits = useQuery({ queryKey: alertsKey(processId, "people", dq), queryFn: () => searchPeople(processId, dq), enabled: dq.length >= 2, staleTime: 30_000 });
  const specKey = JSON.stringify(value);
  const [dSpec, setDSpec] = useState(specKey);
  useEffect(() => { const t = setTimeout(() => setDSpec(specKey), 400); return () => clearTimeout(t); }, [specKey]);
  const empty = !value.roles.length && !value.tls.length && !value.employeeIds.length;
  const preview = useQuery({ queryKey: alertsKey(processId, "recipient-preview", dSpec), queryFn: () => previewRecipients(processId, JSON.parse(dSpec) as RecipientSpec), enabled: !empty, staleTime: 15_000 });
  const toggle = (k: "roles" | "tls", v: string) => onChange({ ...value, [k]: value[k].includes(v) ? value[k].filter((x) => x !== v) : [...value[k], v] });
  const addPerson = (p: { employeeId: string; name: string }) => { setNames((n) => ({ ...n, [p.employeeId]: p.name })); if (!value.employeeIds.includes(p.employeeId)) onChange({ ...value, employeeIds: [...value.employeeIds, p.employeeId] }); setQ(""); };
  return (
    <fieldset className="space-y-3 rounded-xl border border-slate-200 p-3">
      <legend className="px-1 text-xs font-bold text-slate-800">Who gets notified</legend>
      <div>
        <p className="mb-1 text-[11px] font-semibold text-slate-700">Roles (only people who can view this process)</p>
        <div className="flex flex-wrap gap-1.5">
          {VIEWER_ROLE_OPTIONS.map(([k, label]) => (
            <label key={k} className={`inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold ring-1 ${value.roles.includes(k) ? "bg-blue-50 text-blue-900 ring-blue-400" : "bg-white text-slate-800 ring-slate-300"}`}>
              <input type="checkbox" checked={value.roles.includes(k)} onChange={() => toggle("roles", k)} className="h-3.5 w-3.5" />{label}</label>
          ))}
        </div>
      </div>
      {tlOptions.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-semibold text-slate-700">Team leaders</p>
          <div className="flex flex-wrap gap-1.5">
            {tlOptions.map((t) => (
              <label key={t} className={`inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold ring-1 ${value.tls.includes(t) ? "bg-blue-50 text-blue-900 ring-blue-400" : "bg-white text-slate-800 ring-slate-300"}`}>
                <input type="checkbox" checked={value.tls.includes(t)} onChange={() => toggle("tls", t)} className="h-3.5 w-3.5" />{t}</label>
            ))}
          </div>
        </div>
      )}
      <div>
        <label htmlFor={`${id}-q`} className="mb-1 block text-[11px] font-semibold text-slate-700">Specific people</label>
        <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input id={`${id}-q`} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name or employee code" className={`${field} pl-8`} autoComplete="off" /></div>
        {dq.length >= 2 && (
          <ul aria-label="Matching people" className="mt-1 max-h-40 overflow-auto rounded-lg border border-slate-200 bg-white text-sm">
            {hits.isLoading && <li className="px-3 py-2 text-xs text-slate-600">Searching…</li>}
            {hits.data?.length === 0 && <li className="px-3 py-2 text-xs text-slate-600">No one with access to this process matches.</li>}
            {hits.data?.map((p) => (
              <li key={p.employeeId}><button type="button" onClick={() => addPerson(p)} className={`flex min-h-[40px] w-full cursor-pointer items-center justify-between px-3 text-left hover:bg-slate-50 ${FOCUS}`}>
                <span>{p.name}</span><span className="text-[11px] text-slate-600">{p.hasEmail ? "in-app + email" : "in-app only"}</span></button></li>
            ))}
          </ul>
        )}
        {value.employeeIds.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Selected people">
            {value.employeeIds.map((e) => (
              <li key={e} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-3 pr-1 text-xs font-semibold text-slate-900">{names[e] ?? "Saved person"}
                <button type="button" aria-label={`Remove ${names[e] ?? "person"}`} onClick={() => onChange({ ...value, employeeIds: value.employeeIds.filter((x) => x !== e) })} className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded-full hover:bg-slate-200 ${FOCUS}`}><X className="h-3.5 w-3.5" aria-hidden="true" /></button></li>
            ))}
          </ul>
        )}
      </div>
      <p role="status" aria-live="polite" className="text-xs text-slate-700">
        {empty ? "Nobody selected yet." : preview.isLoading ? "Checking who qualifies…" : preview.data
          ? `${preview.data.count} ${preview.data.count === 1 ? "person qualifies" : "people qualify"} (${preview.data.withEmail} with an official e-mail)${preview.data.dropped ? `, ${preview.data.dropped} skipped: no access to this process` : ""}${preview.data.names.length ? ` — ${preview.data.names.join(", ")}${preview.data.count > preview.data.names.length ? "…" : ""}` : ""}.` : ""}
      </p>
    </fieldset>
  );
}
