import type { ReactNode } from "react";
import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export function FilterBar({
  search,
  filters,
  children,
  onClear,
  activeFilterCount = 0,
  actions,
  className,
}: {
  search?: ReactNode;
  filters?: ReactNode;
  children?: ReactNode;
  onClear?: () => void;
  activeFilterCount?: number;
  actions?: ReactNode;
  className?: string;
}) {
  const filterContent = filters || children;

  return (
    <div className={cn("rounded-[var(--r-lg)] border border-[var(--border-hairline)] bg-[var(--surface-0)] p-3 shadow-[var(--shadow-2xs)]", className)}>
      <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_auto_auto] lg:items-center">
        {search}
        <div className="hidden flex-wrap items-center gap-2 lg:flex">{filterContent}</div>
        <div className="flex items-center justify-between gap-2 lg:justify-end">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" className="h-10 rounded-[var(--r-md)] lg:hidden">
                <Filter className="mr-2 h-4 w-4" />
                Filters
                {activeFilterCount > 0 && <span className="ml-2 rounded-full bg-[var(--brand-50)] px-2 text-xs text-[var(--brand-600)]">{activeFilterCount}</span>}
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-[var(--r-xl)]">
              <SheetHeader>
                <SheetTitle>Filters</SheetTitle>
              </SheetHeader>
              <div className="mt-4 grid gap-3">{filterContent}</div>
            </SheetContent>
          </Sheet>
          {onClear && activeFilterCount > 0 && (
            <Button type="button" variant="ghost" className="h-10 rounded-[var(--r-md)]" onClick={onClear}>
              <X className="mr-2 h-4 w-4" />
              Clear
            </Button>
          )}
          {actions}
        </div>
      </div>
    </div>
  );
}
