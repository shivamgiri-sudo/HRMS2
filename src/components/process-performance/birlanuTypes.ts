/** Response of GET /api/process-performance/birlanu-mis (backend: birlanu-mis.ts). */

export interface PerfMonth {
  month: string; enquiries: number; connected: number; connectPct: number;
  validated: number; elvaPct: number; qualified: number; elqPct: number;
  converted: number; elcoPct: number; volMt: number; valueLacs: number;
  lcCloser: number; elcoCloserPct: number; volMtCloser: number; valueLacsCloser: number;
}
export interface BizMonth {
  month: string; validated: number; organicV: number; organicSharePct: number; conv: number; convOrganic: number; convPaid: number;
  convPct: number; convOrganicPct: number; convPaidPct: number; revenue: number; revenueOrganic: number; revenueOrganicPct: number; firstBilling: number;
}
export interface DispRow { status: string; by: Record<string, number>; total: number }
export interface TatRow { counts: number[]; within: number; out: number; total: number; withinPct: number }
export interface ProdCell { enquiries: number; leads: number; conversions: number; convPct: number; revenue: number }
export interface ProdTable { rows: Array<{ brand: string; overall: ProdCell; months: ProdCell[] }>; total: { overall: ProdCell; months: ProdCell[] } }

export interface BirlanuMis {
  filters: Record<string, string | undefined>;
  options: { months: string[]; closureMonths: string[]; channels: string[]; brands: string[]; statuses: string[] };
  scope: { months: string[]; latest: string; previous: string };
  asOf: string | null; rowCount: number; totalRows: number;
  performance: {
    months: PerfMonth[]; total: PerfMonth; callingSplit: { connected: number; notConnected: number };
    closers: Array<{ closer: string; lc: number; volMt: number; valueLacs: number }>; closerMonth: string;
  };
  business: {
    perMonth: BizMonth[];
    ytd: {
      validated: number; organicV: number; conv: number; convOrganic: number; convPaid: number; revenue: number; revenueOrganic: number; firstBilling: number;
      organicSharePct: number; convPct: number; convOrganicPct: number; convPaidPct: number; revenueOrganicPct: number;
    };
    closureBreakup: Array<{ status: string; count: number; pct: number }>; closureTotal: number;
    groups: { closed: number; followUp: number; dropped: number };
  };
  disposition: {
    fyStart: string; sources: string[]; connect: DispRow[]; notConnect: DispRow[];
    connectTotals: { by: Record<string, number>; total: number }; notConnectTotals: { by: Record<string, number>; total: number };
    grand: number; connectRatePct: number; bySourceTotal: Record<string, number>;
    monthly: Array<{ month: string; total: number; connected: number; notConnected: number; by: Record<string, number> }>;
  };
  leadTat: {
    month: string; week: string; weeks: string[]; buckets: string[];
    bySource: Array<TatRow & { source: string }>; totals: TatRow;
    medianHours: number | null; avgHoursUnder24: number | null;
    monthly: Array<TatRow & { month: string }>;
    sourcePerformance: Array<{ source: string; months: Array<{ month: string; enquiry: number; connected: number; las: number; contPct: number; lasPct: number }> }>;
  };
  enquiry: {
    sources: string[]; grand: number;
    months: Array<{ month: string; total: number; momPct: number | null; by: Record<string, number> }>;
    sourceTotals: Array<{ source: string; count: number; pct: number }>;
    brands: Array<{ brand: string; count: number; pct: number }>;
  };
  productWise: { brands: string[]; months: string[]; byRegister: ProdTable; byCloser: ProdTable };
}
