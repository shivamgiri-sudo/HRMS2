import { useEffect, useState } from "react";
import { Bookmark, BookmarkPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const KEY = "ops-command-saved-views-v1";

interface SavedView {
  name: string;
  search: string;
}

function read(): SavedView[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => x && typeof x.name === "string" && typeof x.search === "string").slice(0, 20) : [];
  } catch {
    return [];
  }
}

function write(v: SavedView[]) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage blocked: views just aren't remembered */ }
}

/** Personal saved views (tab + filters + grouping + period), kept in this browser only. */
export function OpsSavedViews({ currentSearch, onApply }: { currentSearch: string; onApply: (search: string) => void }) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [name, setName] = useState("");
  useEffect(() => setViews(read()), []);

  const save = () => {
    const n = name.trim().slice(0, 40);
    if (!n) return;
    const next = [{ name: n, search: currentSearch }, ...views.filter((v) => v.name !== n)].slice(0, 20);
    setViews(next);
    write(next);
    setName("");
  };
  const remove = (n: string) => {
    const next = views.filter((v) => v.name !== n);
    setViews(next);
    write(next);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5"><Bookmark className="h-3.5 w-3.5" /> Views{views.length ? ` (${views.length})` : ""}</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 p-3">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Save this view</p>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. NOIDA attrition, weekly" maxLength={40}
              className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring" aria-label="View name" />
            <Button type="submit" size="sm" className="gap-1" disabled={!name.trim()}><BookmarkPlus className="h-3.5 w-3.5" /> Save</Button>
          </form>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your views</p>
          {!views.length ? <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">None saved yet.</p> : (
            <ul className="max-h-60 space-y-1 overflow-auto">
              {views.map((v) => (
                <li key={v.name} className="flex items-center gap-1">
                  <button type="button" onClick={() => onApply(v.search)} className="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{v.name}</button>
                  <button type="button" onClick={() => remove(v.name)} aria-label={`Delete view ${v.name}`} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">Saved in this browser only. Filters, tab, grouping and dates are restored; data is always live.</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
