import type * as React from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/** Small chip explaining that a filter does not apply to a section. */
export function FilterNote({ children = "LOB filter not applied to this section", className }: { children?: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900", className)}>
      <Info className="h-3 w-3" aria-hidden />
      {children}
    </span>
  );
}

export default FilterNote;
