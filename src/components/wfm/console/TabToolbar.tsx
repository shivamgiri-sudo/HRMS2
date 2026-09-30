import * as React from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const TOOLBAR_CONTROL = "h-9 bg-white text-sm cursor-pointer";

export interface TabToolbarProps {
  children: React.ReactNode;
  /** Shows a "Clear filters" button when provided. */
  onClear?: () => void;
  /** Right-aligned result count / note. */
  summary?: React.ReactNode;
  /** "embedded" drops the card chrome, for use inside a ConsoleCard (border-b only). */
  variant?: "card" | "embedded";
  label?: string;
  className?: string;
}

/**
 * Single home for a tab's own filters (month, week, date, search, sub-filters). Always sits directly
 * under the tab's header so the layout is the same on every tab: scope bar (global) → tab toolbar (local).
 */
export function TabToolbar({ children, onClear, summary, variant = "card", label = "Tab filters", className }: TabToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      className={cn(
        "flex flex-wrap items-center gap-2",
        variant === "card" ? "mb-3 rounded-lg border border-border bg-card p-2" : "border-b border-border p-3",
        className,
      )}
    >
      {children}
      {onClear && (
        <Button type="button" variant="ghost" size="sm" className="h-9 cursor-pointer" onClick={onClear}>
          <X className="mr-1 h-4 w-4" aria-hidden />Clear filters
        </Button>
      )}
      {summary && <span className="ml-auto text-xs tabular-nums text-slate-600" aria-live="polite">{summary}</span>}
    </div>
  );
}

export interface ToolbarSelectProps {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  label: string;
  className?: string;
}

/** Select whose accessible name is `label`; every option is explicit (include an "All …" option yourself). */
export function ToolbarSelect({ value, onChange, options, label, className }: ToolbarSelectProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn(TOOLBAR_CONTROL, "w-auto min-w-[9rem]", className)} aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function ToolbarSearch({ value, onChange, placeholder, label, className }: { value: string; onChange: (v: string) => void; placeholder: string; label?: string; className?: string }) {
  return (
    <div className={cn("relative w-full sm:w-60", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label ?? placeholder} maxLength={60} className="h-9 bg-white pl-8 text-sm" />
    </div>
  );
}
