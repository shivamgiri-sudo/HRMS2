/**
 * Horizontally scrollable tab strip: edge fades show there is more, and the active tab is
 * scrolled into view so nothing is cut off on narrow screens. Arrow-key navigation comes
 * from Radix Tabs.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export interface ConsoleTabItem {
  key: string;
  label: string;
  icon: React.ElementType;
}

export function ConsoleTabsBar({ tabs, activeKey }: { tabs: ConsoleTabItem[]; activeKey: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setFade({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, tabs.length]);

  useEffect(() => {
    const active = ref.current?.querySelector<HTMLElement>('[data-state="active"]');
    active?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [activeKey]);

  return (
    <div className="relative">
      <TabsList
        ref={ref}
        onScroll={measure}
        className="h-auto w-full flex-nowrap justify-start gap-1 overflow-x-auto rounded-lg p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map(({ key, label, icon: Icon }) => (
          <TabsTrigger key={key} value={key} className="min-h-10 flex-shrink-0 cursor-pointer gap-1.5 rounded-md px-3 text-xs sm:text-sm">
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      <span
        aria-hidden
        className={cn("pointer-events-none absolute inset-y-0 left-0 w-8 rounded-l-lg bg-gradient-to-r from-white to-transparent transition-opacity", fade.left ? "opacity-100" : "opacity-0")}
      />
      <span
        aria-hidden
        className={cn("pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-lg bg-gradient-to-l from-white to-transparent transition-opacity", fade.right ? "opacity-100" : "opacity-0")}
      />
    </div>
  );
}
