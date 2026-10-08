import { useMemo, useState } from "react";
import { Database, LayoutDashboard, Loader2, Plus, Search, Sparkles, Users } from "lucide-react";
import { errorText, useDashboardMutations, useDashboards, useDatasets } from "./api";
import { themeOf } from "./palettes";
import { availableTemplates, buildTemplate, type Template } from "./templates";

interface Props { onOpen: (id: string, edit?: boolean) => void; isAdmin: boolean; onManageDatasets: () => void }
const primary = "inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg bg-blue-800 px-4 text-sm font-semibold text-white transition-colors duration-150 hover:bg-blue-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60";

/** Home of the Studio: your dashboards, those shared with you, and starter templates. */
export default function DashboardList({ onOpen, isAdmin, onManageDatasets }: Props) {
  const { data, isLoading, isError, error } = useDashboards();
  const { data: datasets } = useDatasets();
  const { create, saveWidgets } = useDashboardMutations();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"mine" | "shared">("mine");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const templates = useMemo(() => availableTemplates(datasets ?? []), [datasets]);

  const list = (data ?? []).filter((d) => (tab === "mine" ? d.isOwner : !d.isOwner)).filter((d) => !q.trim() || d.name.toLowerCase().includes(q.trim().toLowerCase()));
  const sharedCount = (data ?? []).filter((d) => !d.isOwner).length;

  const createBlank = async () => {
    setBusy("blank"); setErr(null);
    try { const d = await create.mutateAsync({ name: "Untitled dashboard", theme: "light", settings: { crossFilter: true } }); onOpen(d.dashboard.id, true); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(null); }
  };
  const useTemplate = async (t: Template) => {
    setBusy(t.key); setErr(null);
    try {
      const d = await create.mutateAsync({ name: t.name, description: t.description, theme: t.theme, settings: { crossFilter: true } });
      await saveWidgets.mutateAsync({ id: d.dashboard.id, widgets: buildTemplate(t), version: d.dashboard.version });
      onOpen(d.dashboard.id);
    } catch (e) { setErr(errorText(e)); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900"><LayoutDashboard className="h-5 w-5 text-blue-800" aria-hidden />Dashboard Studio</h1>
          <p className="text-sm text-slate-600">Build your own dashboards from any dataset. You only ever see data for your own branches and processes.</p>
        </div>
        {isAdmin && <button type="button" onClick={onManageDatasets} className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"><Database className="h-4 w-4" />Datasets</button>}
        <button type="button" onClick={() => void createBlank()} disabled={busy !== null} className={primary}>{busy === "blank" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}New dashboard</button>
      </div>
      {err && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{err}</p>}

      {templates.length > 0 && (
        <section aria-labelledby="tpl-h">
          <h2 id="tpl-h" className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-800"><Sparkles className="h-4 w-4 text-amber-500" aria-hidden />Start from a template</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {templates.map((t) => {
              const th = themeOf(t.theme);
              return (
                <button key={t.key} type="button" onClick={() => void useTemplate(t)} disabled={busy !== null}
                  className="group cursor-pointer rounded-xl border border-slate-200 bg-white p-3 text-left transition-colors duration-150 hover:border-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:cursor-wait disabled:opacity-60">
                  <div className="mb-2 flex h-16 items-end gap-1 rounded-lg p-2" style={{ background: th.canvas, border: `1px solid ${th.border}` }} aria-hidden>
                    {[40, 70, 55, 90, 65, 80].map((h, i) => <span key={i} className="flex-1 rounded-sm" style={{ height: `${h}%`, background: th.accent, opacity: 0.35 + i * 0.1 }} />)}
                  </div>
                  <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">{t.name}{busy === t.key && <Loader2 className="h-4 w-4 animate-spin" />}</p>
                  <p className="text-xs leading-snug text-slate-600">{t.description}</p>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section aria-label="Dashboards">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div role="tablist" aria-label="Which dashboards" className="inline-flex rounded-lg bg-slate-100 p-1">
            {([["mine", "My dashboards"], ["shared", `Shared with me${sharedCount ? ` (${sharedCount})` : ""}`]] as const).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={`h-9 cursor-pointer rounded-md px-3 text-sm font-semibold transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${tab === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>{label}</button>
            ))}
          </div>
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-3 h-4 w-4 text-slate-400" aria-hidden />
            <input aria-label="Search dashboards" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search dashboards" className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-8 pr-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600" />
          </div>
        </div>

        {isLoading && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" />)}</div>}
        {isError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{errorText(error)}</p>}
        {!isLoading && !isError && !list.length && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <p className="text-sm font-semibold text-slate-800">{q ? "No dashboard matches that search." : tab === "mine" ? "You have not built a dashboard yet." : "Nobody has shared a dashboard with you yet."}</p>
            {!q && tab === "mine" && <p className="mt-1 text-sm text-slate-600">Start from a template above, or press “New dashboard” for a blank canvas.</p>}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((d) => {
            const th = themeOf(d.theme);
            return (
              <button key={d.id} type="button" onClick={() => onOpen(d.id)}
                className="cursor-pointer rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors duration-150 hover:border-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 h-9 w-9 shrink-0 rounded-lg" style={{ background: th.accent }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{d.name}</p>
                    <p className="line-clamp-2 text-xs text-slate-600">{d.description || "No description"}</p>
                  </div>
                </div>
                <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                  <span>{d.widgetCount ?? 0} widget{d.widgetCount === 1 ? "" : "s"}</span>
                  <span>Updated {new Date(d.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                  {!d.isOwner && <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" aria-hidden />{d.ownerName ?? "Shared"}{d.canEdit ? " · can edit" : ""}</span>}
                  {d.isTemplate && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">Template</span>}
                </p>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
