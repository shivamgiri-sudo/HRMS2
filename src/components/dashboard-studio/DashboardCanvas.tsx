import { useMemo, useState } from "react";
import { Responsive, WidthProvider, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { BREAKPOINTS, COLS, ROW_HEIGHT, applyLayout, layoutsFor, type Breakpoint, type CrossFilter, type RuntimeFilters } from "./model";
import type { DashboardSettings, DatasetDef, QueryResult, Theme, Widget } from "./types";
import WidgetFrame from "./WidgetFrame";

const Grid = WidthProvider(Responsive);

interface Props {
  widgets: Widget[]; theme: Theme; datasets: DatasetDef[]; settings: DashboardSettings; runtime: RuntimeFilters; editing: boolean;
  selectedId: string | null; crossSourceId?: string;
  onSelect: (id: string | null) => void; onWidgets: (next: Widget[]) => void; onDuplicate: (id: string) => void; onDelete: (id: string) => void;
  onCrossFilter: (f: CrossFilter, sourceId: string) => void; onResult: (id: string, r: QueryResult | null) => void;
}

/** The dashboard grid. Drag by a widget's title, resize from its corner; phones get one stacked column. */
export default function DashboardCanvas({ widgets, theme, datasets, settings, runtime, editing, selectedId, crossSourceId, onSelect, onWidgets, onDuplicate, onDelete, onCrossFilter, onResult }: Props) {
  const [bp, setBp] = useState<Breakpoint>("lg");
  const layouts = useMemo(() => layoutsFor(widgets), [widgets]);
  // The grid reports a "drag stop" for a plain click too (and re-compacts positions when it does). Only a drag or
  // resize that actually moved the item is a change worth storing.
  const commit = (layout: Layout[], before?: Layout, after?: Layout) => {
    if (before && after && before.x === after.x && before.y === after.y && before.w === after.w && before.h === after.h) {
      // The drag handle swallows the click, so a press-and-release without movement is the selection gesture.
      if (editing) onSelect(after.i);
      return;
    }
    onWidgets(applyLayout(widgets, bp, layout.map((l) => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h }))));
  };
  return (
    <div onClick={editing ? () => onSelect(null) : undefined} className="studio-canvas min-h-[50vh] rounded-xl p-1 sm:p-2" style={{ background: theme.canvas, colorScheme: theme.dark ? "dark" : "light" }}>
      <Grid
        className="layout" layouts={layouts} breakpoints={BREAKPOINTS} cols={COLS} rowHeight={ROW_HEIGHT} margin={[12, 12]} containerPadding={[4, 4]}
        isDraggable={editing && bp !== "xs"} isResizable={editing && bp !== "xs"} draggableHandle=".studio-drag-handle" compactType="vertical"
        onBreakpointChange={(b) => setBp(b as Breakpoint)} onDragStop={commit} onResizeStop={commit} useCSSTransforms measureBeforeMount={false}
      >
        {widgets.map((w) => (
          <div key={w.id}>
            <WidgetFrame widget={w} theme={theme} datasets={datasets} settings={settings} runtime={runtime} editing={editing} selected={selectedId === w.id}
              crossSourceId={crossSourceId} onSelectWidget={() => onSelect(w.id)} onDuplicate={() => onDuplicate(w.id)} onDelete={() => onDelete(w.id)}
              onCrossFilter={(f) => onCrossFilter(f, w.id)} onResult={onResult} />
          </div>
        ))}
      </Grid>
    </div>
  );
}
