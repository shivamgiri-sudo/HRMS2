import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Copy, Download, Eye, Loader2, Pencil, Plus, Printer, Redo2, Save, Settings2, Share2, Trash2, Undo2, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { errorText, useDashboardMutations, useDatasets, useScopeOptions } from "./api";
import DashboardCanvas from "./DashboardCanvas";
import ConfigPanel from "./editor/ConfigPanel";
import SettingsDialog from "./editor/SettingsDialog";
import WidgetGallery from "./editor/WidgetGallery";
import { exportXlsx } from "./export";
import FilterBar from "./FilterBar";
import { defaultQuery, fitQuery, initHistory, newId, nextY, pushHistory, redo, undo, type CrossFilter, type History, type RuntimeFilters } from "./model";
import { THEMES, themeOf } from "./palettes";
import ShareDialog from "./ShareDialog";
import type { DashboardDetail, DashboardSettings, QueryResult, Widget } from "./types";
import type { VizDef } from "./viz/def";
import { prefersTime, vizOf } from "./viz/registry";

interface Doc { name: string; description: string | null; theme: string; settings: DashboardSettings; widgets: Widget[] }
const tb = "inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50";
const tbIcon = `${tb} w-10 justify-center px-0`;
const docOf = (d: DashboardDetail): Doc => ({ name: d.dashboard.name, description: d.dashboard.description, theme: d.dashboard.theme, settings: d.dashboard.settings ?? {}, widgets: d.widgets });

function useIsWide(): boolean {
  const [wide, setWide] = useState(() => (typeof window === "undefined" ? true : window.matchMedia("(min-width: 1280px)").matches));
  useEffect(() => { const m = window.matchMedia("(min-width: 1280px)"); const f = () => setWide(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return wide;
}

interface Props { detail: DashboardDetail; startEditing?: boolean; onBack: () => void; onOpen: (id: string) => void }

/** One open dashboard: view it, or edit it with a gallery, a drag-and-resize canvas and a config panel. */
export default function StudioEditor({ detail, startEditing, onBack, onOpen }: Props) {
  const { toast } = useToast();
  const { data: datasets = [] } = useDatasets();
  const { data: scope } = useScopeOptions();
  const mut = useDashboardMutations();
  const wide = useIsWide();
  const canEdit = detail.canEdit;

  // One object for both: "unsaved" means the present document is not the saved one (identity), so they must start equal.
  const [initial] = useState<Doc>(() => docOf(detail));
  const [hist, setHist] = useState<History<Doc>>(() => initHistory(initial));
  const [saved, setSaved] = useState<Doc>(initial);
  const [version, setVersion] = useState(detail.dashboard.version);
  const [editing, setEditing] = useState(!!startEditing && canEdit);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<"none" | "gallery" | "retype">("none");
  const [runtime, setRuntime] = useState<RuntimeFilters>({ values: {}, cross: [] });
  const [crossSource, setCrossSource] = useState<string | undefined>();
  const [shareOpen, setShareOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Filters a viewer changes are theirs for this visit only; they never alter or "unsave" the dashboard.
  const [viewFilters, setViewFilters] = useState<Partial<DashboardSettings>>({});
  const results = useRef(new Map<string, QueryResult>());

  const doc = hist.present;
  const dirty = doc !== saved;
  const theme = themeOf(doc.theme);
  const settings = useMemo(() => (editing ? doc.settings : { ...doc.settings, ...viewFilters }), [editing, doc.settings, viewFilters]);
  const selected = doc.widgets.find((w) => w.id === selectedId) ?? null;
  const change = useCallback((patch: Partial<Doc>) => setHist((h) => pushHistory(h, { ...h.present, ...patch })), []);
  const setWidgets = useCallback((widgets: Widget[]) => setHist((h) => (widgets === h.present.widgets ? h : pushHistory(h, { ...h.present, widgets }))), []);
  const patchWidget = (id: string, patch: Partial<Widget>) => setWidgets(doc.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)));

  useEffect(() => {
    if (!dirty) return;
    const f = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", f); return () => window.removeEventListener("beforeunload", f);
  }, [dirty]);

  useEffect(() => {
    if (!editing) return;
    const f = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); setHist((h) => (e.shiftKey ? redo(h) : undo(h))); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); setHist(redo); }
    };
    window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f);
  }, [editing]);

  const addWidget = (def: VizDef) => {
    const ds = datasets[0];
    const w: Widget = {
      id: newId(), widgetType: def.type, title: def.noQuery ? null : def.label, subtitle: null,
      query: def.noQuery || !ds ? null : defaultQuery(ds, def.needs, prefersTime(def)),
      viz: def.noQuery ? { text: def.type === "header" ? "Section title" : "Write something here." } : {},
      layout: { lg: { x: 0, y: nextY(doc.widgets), w: def.defaultSize.w, h: def.defaultSize.h } },
    };
    setWidgets([...doc.widgets, w]); setSelectedId(w.id); setPanel("none");
  };
  const retype = (def: VizDef) => {
    if (!selected) return;
    patchWidget(selected.id, { widgetType: def.type, query: def.noQuery ? null : fitQuery(selected.query, def.needs) ?? (datasets[0] ? defaultQuery(datasets[0], def.needs, prefersTime(def)) : null) });
    setPanel("none");
  };
  const duplicate = (id: string) => {
    const w = doc.widgets.find((x) => x.id === id); if (!w) return;
    const copy: Widget = { ...w, id: newId(), title: w.title ? `${w.title} (copy)` : w.title, layout: { lg: { ...(w.layout.lg ?? { x: 0, w: 6, h: 6, y: 0 }), y: nextY(doc.widgets) } } };
    setWidgets([...doc.widgets, copy]); setSelectedId(copy.id);
  };
  const removeWidget = (id: string) => { setWidgets(doc.widgets.filter((w) => w.id !== id)); if (selectedId === id) setSelectedId(null); };

  const save = async () => {
    setSaving(true);
    try {
      const present = doc;
      const a = await mut.update.mutateAsync({ id: detail.dashboard.id, input: { name: present.name.trim() || "Untitled dashboard", description: present.description, theme: present.theme, homeBranchId: detail.dashboard.homeBranchId, homeProcessId: detail.dashboard.homeProcessId, settings: present.settings, version } });
      const b = await mut.saveWidgets.mutateAsync({ id: detail.dashboard.id, widgets: present.widgets, version: a.dashboard.version });
      setVersion(b.dashboard.version); setSaved(present);
      toast({ title: "Dashboard saved" });
    } catch (e) { toast({ title: "Could not save", description: errorText(e), variant: "destructive" }); }
    finally { setSaving(false); }
  };
  const leaveEdit = () => {
    if (dirty && !window.confirm("Discard the changes you have not saved?")) return;
    if (dirty) setHist(initHistory(saved));
    setEditing(false); setSelectedId(null); setPanel("none");
  };
  const back = () => { if (dirty && !window.confirm("Leave without saving your changes?")) return; onBack(); };
  const exportAll = () => {
    const sheets = doc.widgets.map((w) => ({ title: w.title ?? vizOf(w.widgetType)?.label ?? "Widget", result: results.current.get(w.id) })).filter((s): s is { title: string; result: QueryResult } => !!s.result && s.result.rows.length > 0);
    if (!sheets.length) { toast({ title: "Nothing to export yet", description: "Wait for the widgets to load." }); return; }
    void exportXlsx(doc.name, sheets);
  };
  const duplicateDashboard = async () => {
    try { const d = await mut.duplicate.mutateAsync({ id: detail.dashboard.id, name: `${doc.name} (copy)` }); toast({ title: "Copy created" }); onOpen(d.dashboard.id); }
    catch (e) { toast({ title: "Could not copy", description: errorText(e), variant: "destructive" }); }
  };
  const removeDashboard = async () => {
    if (!window.confirm(`Delete “${doc.name}”? This cannot be undone.`)) return;
    try { await mut.remove.mutateAsync(detail.dashboard.id); toast({ title: "Dashboard deleted" }); onBack(); }
    catch (e) { toast({ title: "Could not delete", description: errorText(e), variant: "destructive" }); }
  };
  const onCross = (f: CrossFilter, sourceId: string) => {
    setCrossSource(sourceId);
    setRuntime((r) => ({ ...r, cross: r.cross.some((c) => c.field === f.field && c.value === f.value) ? r.cross.filter((c) => !(c.field === f.field && c.value === f.value)) : [...r.cross.filter((c) => c.field !== f.field), f] }));
  };
  const onResult = useCallback((id: string, r: QueryResult | null) => { if (r) results.current.set(id, r); else results.current.delete(id); }, []);
  const usedDatasets = useMemo(() => [...new Set(doc.widgets.map((w) => w.query?.dataset).filter((x): x is string => !!x))], [doc.widgets]);

  const sidePanel = editing && panel !== "none"
    ? <div className="p-3"><WidgetGallery onPick={panel === "gallery" ? addWidget : retype} current={panel === "retype" ? selected?.widgetType : undefined} /></div>
    : editing && selected ? <ConfigPanel widget={selected} datasets={datasets} onChange={(p) => patchWidget(selected.id, p)} onChangeType={() => setPanel("retype")} /> : null;
  const sideTitle = panel === "gallery" ? "Add a widget" : panel === "retype" ? "Change chart type" : selected ? selected.title ?? vizOf(selected.widgetType)?.label ?? "Widget" : "";
  const closeSide = () => { if (panel !== "none") setPanel("none"); else setSelectedId(null); };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <button type="button" onClick={back} className={tbIcon} aria-label="Back to all dashboards"><ArrowLeft className="h-4 w-4" /></button>
        <div className="min-w-[12rem] flex-1">
          {editing ? (
            <input aria-label="Dashboard name" value={doc.name} maxLength={128} onChange={(e) => change({ name: e.target.value })}
              className="h-10 w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 text-base font-bold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600" />
          ) : <h1 className="truncate text-lg font-bold text-slate-900">{doc.name}</h1>}
          {!editing && doc.description && <p className="truncate text-xs text-slate-600">{doc.description}</p>}
        </div>
        {editing ? <>
          <button type="button" className={tb} onClick={() => { setPanel("gallery"); setSelectedId(null); }}><Plus className="h-4 w-4" />Add widget</button>
          <button type="button" className={tbIcon} aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!hist.past.length} onClick={() => setHist(undo)}><Undo2 className="h-4 w-4" /></button>
          <button type="button" className={tbIcon} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!hist.future.length} onClick={() => setHist(redo)}><Redo2 className="h-4 w-4" /></button>
          <label className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white pl-3 pr-1 text-sm text-slate-700">
            <span className="text-xs font-semibold text-slate-500">Theme</span>
            <select aria-label="Dashboard theme" value={doc.theme} onChange={(e) => change({ theme: e.target.value })} className="h-9 cursor-pointer bg-transparent text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
              {THEMES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </label>
          <button type="button" className={tbIcon} aria-label="Dashboard settings" onClick={() => setSettingsOpen(true)}><Settings2 className="h-4 w-4" /></button>
          <button type="button" className={tb} onClick={leaveEdit}><Eye className="h-4 w-4" />{dirty ? "Discard" : "Done"}</button>
          <button type="button" onClick={() => void save()} disabled={!dirty || saving}
            className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg bg-blue-800 px-4 text-sm font-semibold text-white transition-colors duration-150 hover:bg-blue-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{dirty ? "Save" : "Saved"}
          </button>
        </> : <>
          <button type="button" className={tbIcon} aria-label="Download all widgets as Excel" title="Download Excel" onClick={exportAll}><Download className="h-4 w-4" /></button>
          <button type="button" className={tbIcon} aria-label="Print or save as PDF" title="Print / PDF" onClick={() => window.print()}><Printer className="h-4 w-4" /></button>
          <button type="button" className={tbIcon} aria-label="Make a copy" title="Make a copy" onClick={() => void duplicateDashboard()}><Copy className="h-4 w-4" /></button>
          {detail.dashboard.isOwner && <button type="button" className={tb} onClick={() => setShareOpen(true)}><Share2 className="h-4 w-4" />Share</button>}
          {detail.dashboard.isOwner && <button type="button" className={`${tbIcon} hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700`} aria-label="Delete dashboard" onClick={() => void removeDashboard()}><Trash2 className="h-4 w-4" /></button>}
          {canEdit && <button type="button" onClick={() => setEditing(true)} className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg bg-blue-800 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"><Pencil className="h-4 w-4" />Edit</button>}
        </>}
      </div>

      <FilterBar settings={settings} onSettings={(p) => (editing ? change({ settings: { ...doc.settings, ...p } }) : setViewFilters((v) => ({ ...v, ...p })))}
        runtime={runtime} onRuntime={setRuntime} scope={scope} datasets={datasets} usedDatasets={usedDatasets} />

      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {!doc.widgets.length ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
              <p className="text-sm font-semibold text-slate-800">This dashboard is empty.</p>
              <p className="mt-1 text-sm text-slate-600">{canEdit ? "Add a chart, a number tile or a table to get started." : "Its owner has not added anything yet."}</p>
              {canEdit && <button type="button" onClick={() => { setEditing(true); setPanel("gallery"); }} className="mt-4 inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg bg-blue-800 px-4 text-sm font-semibold text-white hover:bg-blue-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"><Plus className="h-4 w-4" />Add a widget</button>}
            </div>
          ) : (
            <DashboardCanvas widgets={doc.widgets} theme={theme} datasets={datasets} settings={settings} runtime={runtime} editing={editing} selectedId={selectedId} crossSourceId={crossSource}
              onSelect={(id) => { setSelectedId(id); if (id) setPanel("none"); }} onWidgets={setWidgets} onDuplicate={duplicate} onDelete={removeWidget} onCrossFilter={onCross} onResult={onResult} />
          )}
        </div>
        {wide && sidePanel && (
          <aside aria-label={sideTitle} className="sticky top-2 max-h-[calc(100vh-1rem)] w-[340px] shrink-0 overflow-y-auto rounded-xl border border-slate-200 bg-white print:hidden">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2">
              <h2 className="truncate text-sm font-bold text-slate-900">{sideTitle}</h2>
              <button type="button" onClick={closeSide} aria-label="Close panel" className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"><X className="h-4 w-4" /></button>
            </div>
            {sidePanel}
          </aside>
        )}
      </div>

      {!wide && (
        <Sheet open={!!sidePanel} onOpenChange={(o) => { if (!o) closeSide(); }}>
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md" style={{ padding: 0 }}>
            <SheetHeader className="border-b border-slate-200 px-3 py-3 text-left"><SheetTitle className="text-sm">{sideTitle}</SheetTitle><SheetDescription className="sr-only">Widget settings</SheetDescription></SheetHeader>
            {sidePanel}
          </SheetContent>
        </Sheet>
      )}

      {detail.dashboard.isOwner && <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} dashboardId={detail.dashboard.id} shares={detail.shares} />}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} doc={doc} datasets={datasets} usedDatasets={usedDatasets} onChange={change} />
    </div>
  );
}
