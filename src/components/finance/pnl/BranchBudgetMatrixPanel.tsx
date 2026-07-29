import { useState } from "react";
import { Bookmark, Loader2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useColumnPinning } from "@/hooks/useColumnPinning";
import { useSavedViews } from "@/hooks/useSavedViews";
import type { BranchBudgetLineRecord, CostCentreOption } from "@/hooks/useBranchBudget";
import { BranchBudgetMatrixTable } from "@/components/finance/pnl/BranchBudgetMatrixTable";
import { BranchBudgetLineDrawer } from "@/components/finance/pnl/BranchBudgetLineDrawer";

const MODULE_KEY = "branch_budget_matrix";

interface MatrixViewConfig {
  pinnedIds: string[];
}

export function BranchBudgetMatrixPanel({
  lines,
  costCentres,
}: {
  lines: BranchBudgetLineRecord[];
  costCentres: CostCentreOption[];
}) {
  const { pinnedIds, togglePin, replacePinned } = useColumnPinning();
  const { savedViewsQuery, saveView, deleteView } = useSavedViews(MODULE_KEY);
  const savedViews = savedViewsQuery.data ?? [];
  const [selectedLine, setSelectedLine] = useState<BranchBudgetLineRecord | null>(null);
  const [newViewName, setNewViewName] = useState("");
  const [selectedViewId, setSelectedViewId] = useState("");

  async function handleSaveView() {
    try {
      if (!newViewName.trim()) throw new Error("Enter a name for this view");
      const config: MatrixViewConfig = { pinnedIds: Array.from(pinnedIds) };
      await saveView.mutateAsync({ viewName: newViewName.trim(), config });
      setNewViewName("");
      toast.success("View saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "View could not be saved");
    }
  }

  function applyView(viewId: string) {
    setSelectedViewId(viewId);
    const view = savedViews.find((v) => v.id === viewId);
    if (!view) return;
    const config = view.config as MatrixViewConfig | undefined;
    replacePinned(Array.isArray(config?.pinnedIds) ? config.pinnedIds : []);
    toast.success(`Applied view "${view.viewName}"`);
  }

  async function handleDeleteView(viewId: string) {
    try {
      await deleteView.mutateAsync(viewId);
      if (selectedViewId === viewId) setSelectedViewId("");
      toast.success("View deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "View could not be deleted");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <Bookmark className="h-4 w-4" />Saved views
        </div>
        <div className="min-w-[220px] space-y-1">
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={selectedViewId}
            onChange={(event) => applyView(event.target.value)}
          >
            <option value="">Default (no pinned columns)</option>
            {savedViews.map((view) => (
              <option key={view.id} value={view.id}>{view.viewName}</option>
            ))}
          </select>
        </div>
        {selectedViewId && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={deleteView.isPending}
            onClick={() => void handleDeleteView(selectedViewId)}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5 text-rose-500" />Delete
          </Button>
        )}
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Input
              className="h-9 w-48"
              placeholder="Save current pins as..."
              value={newViewName}
              onChange={(event) => setNewViewName(event.target.value)}
            />
          </div>
          <Button type="button" size="sm" disabled={saveView.isPending} onClick={() => void handleSaveView()}>
            {saveView.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
            Save view
          </Button>
        </div>
      </div>

      <BranchBudgetMatrixTable
        lines={lines}
        costCentres={costCentres}
        pinnedIds={pinnedIds}
        onTogglePin={togglePin}
        onOpenLine={setSelectedLine}
      />

      {selectedLine && (
        <BranchBudgetLineDrawer
          line={selectedLine}
          onOpenChange={(open) => {
            if (!open) setSelectedLine(null);
          }}
        />
      )}
    </div>
  );
}
