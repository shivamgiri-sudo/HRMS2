import * as React from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export interface DetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  /** Record id / number shown under the title. */
  subtitle?: React.ReactNode;
  /** Status badge etc, shown beside the title. */
  badge?: React.ReactNode;
  children: React.ReactNode;
}

/** Right slide-over per the platform Drill-Down Mandate (max-w-2xl, full height, scrollable). */
export function DetailDrawer({ open, onOpenChange, title, subtitle, badge, children }: DetailDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex h-full w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="sticky top-0 z-10 border-b border-border bg-background px-5 py-4 text-left">
          <div className="flex items-center gap-2 pr-8">
            <SheetTitle className="text-base font-semibold">{title}</SheetTitle>
            {badge}
          </div>
          {subtitle ? <SheetDescription className="text-xs">{subtitle}</SheetDescription> : <SheetDescription className="sr-only">Details</SheetDescription>}
        </SheetHeader>
        <div className="space-y-5 px-5 py-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

export function DrawerSection({ label, children, className }: { label: string; children?: React.ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-2", className)}>
      <h4 className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</h4>
      {children ?? <p className="text-sm text-slate-500">None</p>}
    </section>
  );
}

export function FieldGrid({ fields }: { fields: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
      {fields.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[11px] font-medium text-slate-500">{k}</dt>
          <dd className="truncate text-sm text-slate-900">{v === null || v === undefined || v === "" ? "—" : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default DetailDrawer;
