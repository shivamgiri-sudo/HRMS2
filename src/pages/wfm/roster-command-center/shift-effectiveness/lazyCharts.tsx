import { Suspense, lazy, type ComponentProps, type ComponentType } from "react";

/** Wrap a named export of ./Charts in React.lazy + a fixed-size skeleton so recharts loads on demand with no layout shift. */
function make<K extends keyof typeof import("./Charts")>(name: K) {
  const Lazy = lazy(() => import("./Charts").then((m) => ({ default: m[name] as unknown as ComponentType<any> })));
  type P = ComponentProps<(typeof import("./Charts"))[K]>;
  return function LazyChart(props: P) {
    return (
      <Suspense fallback={<div className="h-full w-full animate-pulse rounded-md bg-slate-100 motion-reduce:animate-none" role="status" aria-label="Loading chart" />}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}

export const AdherenceTrendChart = make("AdherenceTrendChart");
export const ShiftComparisonChart = make("ShiftComparisonChart");
export const BreakBarChart = make("BreakBarChart");
export const BreakTrendChart = make("BreakTrendChart");
export const DailyBreakChart = make("DailyBreakChart");
