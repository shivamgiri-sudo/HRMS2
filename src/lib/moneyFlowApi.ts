// src/lib/moneyFlowApi.ts
/** Ledger Analytics "Money Flow" — backend: backend/src/modules/finance/money-flow.routes.ts */
import { hrmsApi } from "@/lib/hrmsApi";

export type AgeBucket = "not_due" | "d0_30" | "d31_60" | "d61_90" | "d90_plus";
export type DrillKey =
  | "provision" | "proforma_pending" | "awaiting_bill_no" | "billed" | "billed_not_sent" | "sent_unpaid"
  | "part_paid" | "paid" | "received" | "outstanding" | "overdue" | AgeBucket | "payables";

export interface Agg { count: number; amount: number }

export interface MoneyFlowSummary {
  financeYear: string;
  asOf: string;
  kpis: {
    expected: Agg;
    billed: Agg;
    received: Agg & { tds: number; deduction: number; credited: number };
    outstanding: Agg;
    overdue: Agg;
    bankedThisMonth: { amount: number; from: string; to: string };
    awaitingBank: number;
    payables: Agg;
  };
  funnel: Array<Agg & { key: DrillKey; label: string }>;
  receivablesAgeing: Array<Agg & { key: AgeBucket }>;
  payablesAgeing: Array<Agg & { key: AgeBucket }>;
  weeklyIncoming: Array<{ weekStart: string; recorded: number; banked: number }>;
  topClients: Array<{ client: string; outstanding: number; overdue: number; bills: number }>;
  settlementSources: { receipts: number; clientPayments: number };
}

export interface MoneyFlowFilters { financeYear?: string; branchId?: string; client?: string }

export interface BillDrillRow {
  id: string; billNo: string; invoiceDate: string; dueDate: string | null; client: string; costCentre: string;
  branch: string; isMigrated: boolean; grandTotal: number; received: number; tds: number; deduction: number;
  credited: number; banked: number; outstanding: number; settlementSource: "receipts" | "client_payments" | "none";
  stage: string; daysOverdue: number;
}
export interface PipelineDrillRow { id: string; ref: string; date: string; client: string; costCentre: string; branch: string; amount: number }
export interface PayableDrillRow { id: string; grnNumber: string; vendor: string; branch: string; dueDate: string | null; amount: number }

export type DrillResult =
  | { kind: "bills"; rows: BillDrillRow[] }
  | { kind: "pipeline"; rows: PipelineDrillRow[] }
  | { kind: "payables"; rows: PayableDrillRow[] };

const qs = (f: MoneyFlowFilters) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
};

export async function getMoneyFlow(f: MoneyFlowFilters): Promise<MoneyFlowSummary> {
  const r = await hrmsApi.get<{ data: MoneyFlowSummary }>(`/api/finance/money-flow${qs(f)}`, 60_000);
  return r.data;
}

export async function getMoneyFlowOptions(f: MoneyFlowFilters) {
  const r = await hrmsApi.get<{ data: { financeYear: string; clients: string[]; branches: Array<{ id: string; name: string }> } }>(
    `/api/finance/money-flow/options${qs({ financeYear: f.financeYear })}`,
  );
  return r.data;
}

export async function getMoneyFlowRows(key: DrillKey, f: MoneyFlowFilters): Promise<DrillResult> {
  const r = await hrmsApi.get<{ data: DrillResult }>(`/api/finance/money-flow/rows/${key}${qs(f)}`, 60_000);
  return r.data;
}
