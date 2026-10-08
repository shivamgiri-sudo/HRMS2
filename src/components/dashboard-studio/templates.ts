import { newId } from "./model";
import type { DatasetDef, GridPos, QuerySpec, VizStyle, Widget } from "./types";

/** Starter dashboards built on the seeded datasets. A template is offered only when its dataset exists for the viewer. */
export interface Template { key: string; name: string; description: string; dataset: string; theme: string; build: () => Widget[] }

const w = (widgetType: string, title: string, pos: GridPos, query: QuerySpec | null, viz: VizStyle = {}): Widget =>
  ({ id: newId(), widgetType, title, subtitle: null, query, viz, layout: { lg: pos } });
const last30 = { preset: "last_30" as const };

export const TEMPLATES: Template[] = [
  {
    key: "attendance", name: "Attendance overview", description: "Who was present, absent or late, by day and by process.", dataset: "attendance_daily", theme: "light",
    build: () => {
      const d = "attendance_daily";
      return [
        w("header", "Attendance", { x: 0, y: 0, w: 12, h: 2 }, null, { text: "Attendance overview" }),
        w("kpi", "People with a record", { x: 0, y: 2, w: 3, h: 4 }, { dataset: d, dimensions: [{ field: "date", grain: "day" }], measures: [{ field: "employees", agg: "count_distinct" }], dateRange: last30 }),
        w("kpi", "Late marks", { x: 3, y: 2, w: 3, h: 4 }, { dataset: d, dimensions: [{ field: "date", grain: "day" }], measures: [{ field: "late_marks", agg: "sum" }], dateRange: last30 }, { higherIsBetter: false }),
        w("donut", "By status", { x: 6, y: 2, w: 6, h: 8 }, { dataset: d, dimensions: [{ field: "status" }], measures: [{ agg: "count", alias: "Records" }], dateRange: last30, sort: [{ key: "m0", dir: "desc" }] }),
        w("kpi", "Average minutes late", { x: 0, y: 6, w: 3, h: 4 }, { dataset: d, dimensions: [], measures: [{ field: "late_minutes", agg: "avg" }], dateRange: last30 }, { higherIsBetter: false, decimals: 1 }),
        w("kpi", "Mismatches", { x: 3, y: 6, w: 3, h: 4 }, { dataset: d, dimensions: [], measures: [{ field: "mismatches", agg: "sum" }], dateRange: last30 }, { higherIsBetter: false }),
        w("stacked_column", "Status by day", { x: 0, y: 10, w: 12, h: 8 }, { dataset: d, dimensions: [{ field: "date", grain: "day" }, { field: "status" }], measures: [{ agg: "count", alias: "Records" }], dateRange: last30, limit: 2000 }),
        w("bar", "Records by process", { x: 0, y: 18, w: 6, h: 9 }, { dataset: d, dimensions: [{ field: "process" }], measures: [{ agg: "count", alias: "Records" }], dateRange: last30, sort: [{ key: "m0", dir: "desc" }], limit: 50 }, { topN: 12 }),
        w("heatmap", "Process by status", { x: 6, y: 18, w: 6, h: 9 }, { dataset: d, dimensions: [{ field: "process" }, { field: "status" }], measures: [{ agg: "count", alias: "Records" }], dateRange: last30, limit: 600 }),
      ];
    },
  },
  {
    key: "headcount", name: "Headcount", description: "Active employees by process, branch and gender.", dataset: "headcount", theme: "corporate",
    build: () => {
      const d = "headcount"; const active = [{ field: "active", op: "eq" as const, value: 1 }];
      return [
        w("kpi", "Active employees", { x: 0, y: 0, w: 3, h: 4 }, { dataset: d, dimensions: [], measures: [{ field: "employees", agg: "count_distinct" }], filters: active }),
        w("donut", "By gender", { x: 3, y: 0, w: 4, h: 8 }, { dataset: d, dimensions: [{ field: "gender" }], measures: [{ field: "employees", agg: "count_distinct" }], filters: active, sort: [{ key: "m0", dir: "desc" }] }),
        w("column", "By branch", { x: 7, y: 0, w: 5, h: 8 }, { dataset: d, dimensions: [{ field: "branch" }], measures: [{ field: "employees", agg: "count_distinct" }], filters: active, sort: [{ key: "m0", dir: "desc" }] }, { dataLabels: true }),
        w("kpi", "Joined in the last 30 days", { x: 0, y: 4, w: 3, h: 4 }, { dataset: d, dimensions: [], measures: [{ field: "employees", agg: "count_distinct" }], filters: [{ field: "joined", op: "gte", value: "__LAST_30__" }] }),
        w("bar", "Largest processes", { x: 0, y: 8, w: 6, h: 10 }, { dataset: d, dimensions: [{ field: "process" }], measures: [{ field: "employees", agg: "count_distinct" }], filters: active, sort: [{ key: "m0", dir: "desc" }], limit: 40 }, { topN: 15, dataLabels: true }),
        w("line", "Joiners by month", { x: 6, y: 8, w: 6, h: 10 }, { dataset: d, dimensions: [{ field: "joined", grain: "month" }], measures: [{ field: "employees", agg: "count_distinct" }], filters: [{ field: "joined", op: "gte", value: "__YEAR_START__" }] }, { dots: true }),
      ];
    },
  },
  {
    key: "process_kpi", name: "Process KPI tracker", description: "Every KPI reading for the processes you can see, by metric and week.", dataset: "process_kpi_daily", theme: "light",
    build: () => {
      const d = "process_kpi_daily"; const r = { preset: "last_90" as const };
      return [
        w("kpi", "Readings", { x: 0, y: 0, w: 3, h: 4 }, { dataset: d, dimensions: [{ field: "date", grain: "week" }], measures: [{ agg: "count", alias: "Readings" }], dateRange: r }),
        w("kpi", "Processes reporting", { x: 3, y: 0, w: 3, h: 4 }, { dataset: d, dimensions: [], measures: [{ field: "process", agg: "count_distinct", alias: "Processes" }], dateRange: r }),
        w("column", "Readings per week", { x: 6, y: 0, w: 6, h: 8 }, { dataset: d, dimensions: [{ field: "date", grain: "week" }], measures: [{ agg: "count", alias: "Readings" }], dateRange: r }),
        w("text", "How to use", { x: 0, y: 4, w: 6, h: 4 }, null, { text: "Pick a **Process** in the filter bar, then click a metric in the table to focus every chart on it." }),
        w("table", "Average by metric", { x: 0, y: 8, w: 6, h: 10 }, { dataset: d, dimensions: [{ field: "metric" }], measures: [{ field: "value", agg: "avg", alias: "Average" }, { agg: "count", alias: "Readings" }], dateRange: r, sort: [{ key: "m1", dir: "desc" }], limit: 300 }, { decimals: 1 }),
        w("line", "Average value by week", { x: 6, y: 8, w: 6, h: 10 }, { dataset: d, dimensions: [{ field: "date", grain: "week" }], measures: [{ field: "value", agg: "avg", alias: "Average" }], dateRange: r }, { dots: true, decimals: 1 }),
      ];
    },
  },
  {
    key: "bbb_sales", name: "Bla Bli Blu sales", description: "Orders and revenue by campaign, agent, payment and time of day.", dataset: "bla_bli_blu_sales", theme: "gold",
    build: () => {
      const d = "bla_bli_blu_sales"; const r = { preset: "last_90" as const };
      const rts = [{ field: "business", op: "eq" as const, value: "Real Time Sales" }];
      return [
        w("kpi", "Orders", { x: 0, y: 0, w: 3, h: 4 }, { dataset: d, dimensions: [{ field: "date", grain: "day" }], measures: [{ field: "orders", agg: "count_distinct" }], filters: rts, dateRange: r }),
        w("kpi", "Revenue", { x: 3, y: 0, w: 3, h: 4 }, { dataset: d, dimensions: [{ field: "date", grain: "day" }], measures: [{ field: "amount", agg: "sum" }], filters: rts, dateRange: r }, { compact: true }),
        w("donut", "By campaign", { x: 6, y: 0, w: 3, h: 8 }, { dataset: d, dimensions: [{ field: "campaign" }], measures: [{ field: "orders", agg: "count_distinct" }], filters: rts, dateRange: r, sort: [{ key: "m0", dir: "desc" }] }),
        w("pie", "Prepaid vs COD", { x: 9, y: 0, w: 3, h: 8 }, { dataset: d, dimensions: [{ field: "payment" }], measures: [{ field: "orders", agg: "count_distinct" }], filters: rts, dateRange: r }),
        w("kpi", "Average order value", { x: 0, y: 4, w: 3, h: 4 }, { dataset: d, dimensions: [], measures: [{ field: "amount", agg: "avg" }], filters: rts, dateRange: r }, { decimals: 0 }),
        w("kpi", "Agents selling", { x: 3, y: 4, w: 3, h: 4 }, { dataset: d, dimensions: [], measures: [{ field: "agent_code", agg: "count_distinct", alias: "Agents" }], filters: rts, dateRange: r }),
        w("combo", "Orders and revenue by day", { x: 0, y: 8, w: 8, h: 8 }, { dataset: d, dimensions: [{ field: "date", grain: "day" }], measures: [{ field: "orders", agg: "count_distinct" }, { field: "amount", agg: "sum" }], filters: rts, dateRange: r }),
        w("leaderboard", "Top agents", { x: 8, y: 8, w: 4, h: 8 }, { dataset: d, dimensions: [{ field: "agent" }], measures: [{ field: "orders", agg: "count_distinct" }, { field: "amount", agg: "sum" }], filters: rts, dateRange: r, sort: [{ key: "m0", dir: "desc" }], limit: 50 }, { topN: 10 }),
        w("bar", "Order status", { x: 0, y: 16, w: 6, h: 9 }, { dataset: d, dimensions: [{ field: "order_status" }], measures: [{ field: "orders", agg: "count_distinct" }], filters: rts, dateRange: r, sort: [{ key: "m0", dir: "desc" }] }, { dataLabels: true }),
        w("heatmap", "Sales by weekday and hour", { x: 6, y: 16, w: 6, h: 9 }, { dataset: d, dimensions: [{ field: "call_time", grain: "weekday" }, { field: "call_time", grain: "hour" }], measures: [{ field: "orders", agg: "count_distinct" }], filters: [...rts, { field: "call_time", op: "not_null" }], dateRange: r, limit: 400 }),
      ];
    },
  },
];

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Widgets of a template, with relative date placeholders resolved to real dates at creation time. */
export function buildTemplate(t: Template, now = new Date()): Widget[] {
  const last30 = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30));
  const yearStart = `${now.getFullYear() - 1}-${pad(now.getMonth() + 1)}-01`;
  const swap = (v: unknown) => (v === "__LAST_30__" ? last30 : v === "__YEAR_START__" ? yearStart : v);
  return t.build().map((x) => (x.query ? { ...x, query: { ...x.query, filters: x.query.filters?.map((f) => ({ ...f, value: swap(f.value) })) } } : x));
}

export const availableTemplates = (datasets: DatasetDef[]): Template[] => TEMPLATES.filter((t) => datasets.some((d) => d.code === t.dataset));
