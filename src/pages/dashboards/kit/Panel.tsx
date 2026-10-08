import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Panel({ title, subtitle, action, href, hrefLabel = "View all", children, className, bodyClassName }: {
  title: string; subtitle?: ReactNode; action?: ReactNode; href?: string; hrefLabel?: string; children: ReactNode; className?: string; bodyClassName?: string;
}) {
  return (
    <section className={cn("kit-card kit-rise flex min-w-0 flex-col", className)}>
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-[14px] font-bold text-slate-900">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[12px] text-slate-500">{subtitle}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          {href ? <Link to={href} className="inline-flex items-center gap-1 text-[12px] font-semibold text-blue-600 hover:text-blue-800">{hrefLabel}<ArrowRight className="h-3 w-3" /></Link> : null}
        </div>
      </header>
      <div className={cn("flex-1 p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/**
 * Defers rendering below-the-fold sections until they near the viewport, so the hero + first row
 * paint immediately. Falls back to immediate render without IntersectionObserver (tests / old browsers).
 */
export function LazySection({ children, minHeight = 220, eager = false }: { children: ReactNode; minHeight?: number; eager?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(eager || typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (shown || !ref.current) return;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setShown(true); io.disconnect(); } }, { rootMargin: "300px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [shown]);
  return <div ref={ref} style={shown ? undefined : { minHeight }}>{shown ? children : <div className="kit-shimmer rounded-2xl" style={{ height: minHeight }} />}</div>;
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mt-2 flex items-baseline gap-3">
      <h2 className="text-[13px] font-extrabold uppercase tracking-[.14em] text-slate-500">{children}</h2>
      {hint ? <span className="text-[12px] text-slate-400">{hint}</span> : null}
      <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-slate-200 to-transparent" />
    </div>
  );
}

export function DashSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading dashboard">
      <div className="kit-shimmer h-56 rounded-3xl" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <div key={i} className="kit-shimmer h-28 rounded-2xl" />)}</div>
    </div>
  );
}
