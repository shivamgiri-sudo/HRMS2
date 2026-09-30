/** Response contract of GET /api/process-performance/sbi-card-dashboard (SBI Card Collections, process SBI_CARD). */
export interface SbiFunnel {
  accounts: number; dials: number; answers: number; connects: number; ptp: number; pad: number; otp: number;
}
export interface SbiSummary extends SbiFunnel {
  contactRatePct: number | null; connectRatePct: number | null; ptpRatePct: number | null;
  amountCollected: number; agentsActive: number;
}
export interface SbiDailyRow extends SbiFunnel { date: string; campaign: string; contacts?: number; contactRatePct: number | null; ptpRatePct: number | null }
export interface SbiCampaignRow extends SbiFunnel { campaign: string; contactRatePct: number | null; ptpRatePct: number | null }
export interface SbiAgentRow {
  employeeId: string | null; dialerId: string | null; name: string | null; team: string | null; teamLeader: string | null;
  calls: number; contacts: number; ptp: number; pad: number; amountCollected: number;
  firstLogin: string | null; lastLogout: string | null; leakage: number | string | null; days: number;
}
export interface SbiTeamRow { team: string | null; teamLeader: string | null; agents: number; calls: number; contacts: number; ptp: number; pad: number; amountCollected: number }
export interface SbiDowntimeRow {
  date: string; startTime: string | null; upTime: string | null; downtimeMinutes: number | null;
  impactedUsers: number | null; reason: string | null; status: string | null;
}
export interface SbiAccounts {
  total: number; totalDue: number; curBal: number;
  byDelq: Array<{ delq: string; count: number; totalDue: number }>;
  byBillingCycle: Array<{ cycle: string; count: number }>;
}
export interface SbiCardData {
  range: { from: string; to: string }; campaigns: string[]; summary: SbiSummary;
  daily: SbiDailyRow[]; byCampaign: SbiCampaignRow[]; agents: SbiAgentRow[]; teams: SbiTeamRow[];
  downtime: SbiDowntimeRow[]; accounts: SbiAccounts;
}
