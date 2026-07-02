import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function KpiCardGrid({
  children,
  dense = false,
  className,
}: {
  children: ReactNode;
  dense?: boolean;
  className?: string;
}) {
  return (
    <section className={cn("grid gap-4 sm:grid-cols-2", dense ? "2xl:grid-cols-6" : "xl:grid-cols-4", className)}>
      {children}
    </section>
  );
}
