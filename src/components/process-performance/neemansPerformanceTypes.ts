/** Response shape of GET /api/process-performance/neemans-performance-dashboard
 * (mirrors backend neemans-performance-dashboard.service.ts). */

export interface SaleData {
  headline: { revenue: number; saleCount: number; aov: number; prepaidPct: number; codPct: number; rtoPct: number; activeAgents: number; target: number; achievementPct: number };
  dateWiseTrend: Array<{ date: string; saleCount: number; revenue: number; rtoCount: number }>;
  paymentBreakdown: Array<{ paymentStatus: string; count: number; revenue: number }>;
  orderStatusBreakdown: Array<{ status: string; count: number; revenue: number; pct: number }>;
  byTl: Array<{ tlName: string; saleCount: number; revenue: number; rtoPct: number; target: number; achievementPct: number }>;
  agents: Array<{ empId: string; name: string; tlName: string; saleCount: number; revenue: number; rtoPct: number; prepaidPct: number; target: number; achievementPct: number }>;
}

export interface AllocationData {
  headline: { totalAllocation: number; connected: number; connectedPct: number; notConnected: number; pending: number; uniquePhones: number; activeAgents: number };
  typeBreakdown: Array<{ type: string; count: number; connectedPct: number }>;
  statusBreakdown: Array<{ status: string; count: number; pct: number }>;
  subScenarioBreakdown: Array<{ subScenario: string; count: number; pct: number }>;
  dateWiseTrend: Array<{ date: string; allocationCount: number; connectedPct: number }>;
  agents: Array<{ agent: string; allocation: number; connected: number; connectedPct: number }>;
}

export interface ChatData {
  headline: {
    totalTickets: number; resolvedPct: number; avgFrtHrs: number; avgResolutionHrs: number; avgCsat: number;
    frtTatCompliancePct: number; resolutionTatCompliancePct: number;
  };
  byLob: Array<{ lob: string; tickets: number; resolvedPct: number }>;
  channelBreakdown: Array<{ channel: string; tickets: number; resolvedPct: number }>;
  statusBreakdown: Array<{ status: string; count: number; pct: number }>;
  dateWiseTrend: Array<{ date: string; tickets: number; resolvedPct: number }>;
  agents: Array<{ agent: string; empId: string; tickets: number; resolvedPct: number; avgCsat: number }>;
}

export interface ProductivityData {
  headline: { totalCalls: number; activeAgents: number; avgOccupancyPct: number; attendanceDays: number; avgNetLoginSec: number; avgTotalBreakSec: number };
  dateWiseTrend: Array<{ date: string; calls: number; avgOccupancyPct: number; loginAgents: number }>;
  lobBreakdown: Array<{ lob: string; calls: number; agents: number; avgOccupancyPct: number }>;
  agents: Array<{ empId: string; name: string; calls: number; loginTimeSec: number; talkTimeSec: number; occupancyPct: number; attendanceDays: number }>;
}

export interface CartOverview {
  headline: { totalCarts: number; totalCartValue: number; avgCartValue: number; uniqueCustomers: number; activeAgents: number };
  dateWiseTrend: Array<{ date: string; cartCount: number; cartValue: number }>;
  dispositionBreakdown: Array<{ disposition: string; count: number; value: number; pct: number }>;
  statusBreakdown: Array<{ status: string; count: number; pct: number }>;
}

export interface InboundOverview {
  headline: {
    offered: number; answered: number; abandoned: number;
    answerPct: number; abandonPct: number; slPct: number;
    ahtSec: number; loginCount: number; uniquePhones: number;
    fcrPct: number | null;
  };
  dateWiseTrend: Array<{ date: string; offered: number; answered: number; slPct: number }>;
}

export interface NeemansDashboardData {
  from: string | null;
  to: string | null;
  sale: SaleData;
  allocation: AllocationData;
  chat: ChatData;
  productivity: ProductivityData;
  cart: CartOverview;
  inbound: InboundOverview | null;
  inboundError: string | null;
}
