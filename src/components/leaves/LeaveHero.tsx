import type { ReactNode } from "react";
import { CheckCircle2, Clock, Plus, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  stats?: { pending: number; approved: number; rejected: number; cancelled: number };
  onApply: () => void;
  /** Export control, only for roles that have one. */
  exportSlot?: ReactNode;
}

const CHIPS = [
  { key: "pending", label: "Pending", Icon: Clock },
  { key: "approved", label: "Approved", Icon: CheckCircle2 },
  { key: "rejected", label: "Rejected", Icon: XCircle },
] as const;

/**
 * Page header. Gradient is built from the app theme (sidebar navy → MAS blue) rather than a
 * page-specific palette, so it follows the product theme. White text on the darkest stop keeps
 * AA contrast.
 */
export function LeaveHero({ stats, onApply, exportSlot }: Props) {
  return (
    <section
      aria-labelledby="leave-hero-title"
      className="relative overflow-hidden rounded-3xl p-5 text-white shadow-lg sm:p-8"
      style={{ background: "linear-gradient(135deg, hsl(var(--sidebar-background)) 0%, hsl(var(--primary)) 100%)" }}
    >
      <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-20 -left-10 h-48 w-48 rounded-full bg-sky-300/20 blur-2xl" aria-hidden="true" />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/70">Leave Management</p>
          <h1 id="leave-hero-title" className="mt-2 text-2xl font-bold tracking-tight">Leave</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-white/85">
            Apply for leave, follow your requests and act on your team's.
          </p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            {CHIPS.map(({ key, label, Icon }) => (
              <div key={key} className="flex items-center gap-2.5 rounded-2xl border border-white/25 bg-white/15 px-4 py-2.5 backdrop-blur-sm">
                <Icon className="h-4 w-4 text-white/90" aria-hidden="true" />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-white/70">{label}</p>
                  <p className="text-lg font-bold leading-tight">{stats ? stats[key] : "–"}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button onClick={onApply} className="rounded-xl bg-white font-semibold text-primary shadow-md hover:bg-white/90">
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            Apply for leave
          </Button>
          {exportSlot}
        </div>
      </div>
    </section>
  );
}
