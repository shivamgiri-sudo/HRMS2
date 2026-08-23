import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { billQuery } from "../../db/billDb.js";

export interface ClientInvoice {
  id: number;
  client_name: string;
  branch_name: string;
  cost_centre: string;
  invoice_month: string;
  finance_year: string;
  invoice_amount: number;
  db_bill_status: string;
  hrms_status: string;
  amount_received: number;
  payment_date: string | null;
  last_updated: string | null;
}

export interface PaymentTrend {
  month: string;
  invoiced: number;
  received: number;
  pending: number;
  collection_rate: number;
}

export interface SeatRateInfo {
  branch: string;
  cost_centre: string;
  process_name?: string;
  client: string;
  service: string;
  particulars: string;
  seats: number;
  rate_per_seat: number;
  monthly_value: number;
}

export interface PaymentFilters {
  clientName?: string;
  branchName?: string;
  financeYear?: string;
  month?: string;
  status?: string;
  page?: number;
  limit?: number;
}

export interface UpdatePaymentPayload {
  invoice_ref_id: number;
  client_name: string;
  branch_name: string;
  cost_centre: string;
  invoice_month: string;
  finance_year: string;
  invoice_amount: number;
  payment_status: "pending" | "partial" | "paid" | "overdue" | "disputed";
  amount_received: number;
  payment_date?: string;
  payment_mode?: string;
  transaction_ref?: string;
  remarks?: string;
}

function monthLabelToPeriod(monthLabel: string, finYear: string): string {
  const months: Record<string, string> = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
  };
  const [mon] = monthLabel.split("-");
  const monthNum = months[mon] ?? "01";
  const [startYear] = finYear.split("-").map(Number);
  const year = Number(monthNum) >= 4 ? startYear : startYear + 1;
  return `${year}-${monthNum}`;
}

export async function getClientInvoices(filters: PaymentFilters): Promise<{
  invoices: ClientInvoice[];
  total: number;
  summary: { totalInvoiced: number; totalReceived: number; totalPending: number };
}> {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 50;
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.financeYear) {
    conditions.push("i.finance_year = ?");
    params.push(filters.financeYear);
  }
  if (filters.month) {
    conditions.push("i.month = ?");
    params.push(filters.month);
  }
  if (filters.clientName) {
    conditions.push("i.cost_client LIKE ?");
    params.push(`%${filters.clientName}%`);
  }
  if (filters.branchName) {
    conditions.push("i.branch_name = ?");
    params.push(filters.branchName);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const invoices = await billQuery<RowDataPacket>(
    `SELECT
       i.id,
       i.cost_client AS client_name,
       i.branch_name,
       i.cost_center AS cost_centre,
       i.month AS invoice_month,
       i.finance_year,
       CAST(COALESCE(i.grnd, 0) AS DECIMAL(14,2)) AS invoice_amount,
       COALESCE(i.PaymentStatus, 'N') AS db_bill_status
     FROM tbl_invoice i
     ${whereClause}
     ORDER BY i.id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  const [countRow] = await billQuery<RowDataPacket>(
    `SELECT COUNT(*) AS total FROM tbl_invoice i ${whereClause}`,
    params
  );
  const total = Number(countRow?.total ?? 0);

  const invoiceIds = invoices.map((i) => i.id);
  let hrmsStatuses: Map<number, any> = new Map();

  if (invoiceIds.length > 0) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT invoice_ref_id, payment_status, amount_received, payment_date, updated_at
       FROM client_invoice_payment_status
       WHERE invoice_ref_id IN (${invoiceIds.map(() => "?").join(",")})`,
      invoiceIds
    );
    for (const row of rows) {
      hrmsStatuses.set(row.invoice_ref_id, row);
    }
  }

  const result: ClientInvoice[] = invoices.map((i) => {
    const hrms = hrmsStatuses.get(i.id);
    return {
      id: i.id,
      client_name: i.client_name,
      branch_name: i.branch_name,
      cost_centre: i.cost_centre,
      invoice_month: i.invoice_month,
      finance_year: i.finance_year,
      invoice_amount: Number(i.invoice_amount),
      db_bill_status: i.db_bill_status === "Y" ? "paid" : "pending",
      hrms_status: hrms?.payment_status ?? (i.db_bill_status === "Y" ? "paid" : "pending"),
      amount_received: Number(hrms?.amount_received ?? 0),
      payment_date: hrms?.payment_date ?? null,
      last_updated: hrms?.updated_at ?? null,
    };
  });

  const totalInvoiced = result.reduce((sum, i) => sum + i.invoice_amount, 0);
  const totalReceived = result.reduce((sum, i) => sum + i.amount_received, 0);

  return {
    invoices: result,
    total,
    summary: {
      totalInvoiced,
      totalReceived,
      totalPending: totalInvoiced - totalReceived,
    },
  };
}

export async function getClientPaymentTrends(
  clientName?: string,
  branchName?: string,
  months = 12
): Promise<PaymentTrend[]> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (clientName) {
    conditions.push("i.cost_client LIKE ?");
    params.push(`%${clientName}%`);
  }
  if (branchName) {
    conditions.push("i.branch_name = ?");
    params.push(branchName);
  }

  const whereClause = conditions.length ? `AND ${conditions.join(" AND ")}` : "";

  const trends = await billQuery<RowDataPacket>(
    `SELECT
       i.finance_year,
       i.month AS invoice_month,
       SUM(CAST(COALESCE(i.grnd, 0) AS DECIMAL(14,2))) AS total_invoiced,
       SUM(CASE WHEN i.PaymentStatus = 'Y' THEN CAST(COALESCE(i.grnd, 0) AS DECIMAL(14,2)) ELSE 0 END) AS total_paid
     FROM tbl_invoice i
     WHERE i.finance_year IN ('2025-26', '2026-27')
       ${whereClause}
     GROUP BY i.finance_year, i.month
     ORDER BY i.finance_year DESC,
       FIELD(i.month, 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar') DESC
     LIMIT ?`,
    [...params, months]
  );

  return trends.map((t) => {
    const invoiced = Number(t.total_invoiced);
    const received = Number(t.total_paid);
    return {
      month: `${t.invoice_month}-${t.finance_year.slice(2, 4)}`,
      invoiced,
      received,
      pending: invoiced - received,
      collection_rate: invoiced > 0 ? Math.round((received / invoiced) * 100) : 0,
    };
  });
}

export async function updateInvoicePayment(
  payload: UpdatePaymentPayload,
  userId: string
): Promise<{ success: boolean; id: string }> {
  const id = randomUUID();

  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM client_invoice_payment_status WHERE invoice_ref_id = ?`,
    [payload.invoice_ref_id]
  );

  if (existing.length > 0) {
    await db.execute(
      `UPDATE client_invoice_payment_status SET
         payment_status = ?,
         amount_received = ?,
         payment_date = ?,
         payment_mode = ?,
         transaction_ref = ?,
         remarks = ?,
         updated_by = ?
       WHERE invoice_ref_id = ?`,
      [
        payload.payment_status,
        payload.amount_received,
        payload.payment_date ?? null,
        payload.payment_mode ?? null,
        payload.transaction_ref ?? null,
        payload.remarks ?? null,
        userId,
        payload.invoice_ref_id,
      ]
    );

    if (payload.amount_received > 0) {
      const logId = randomUUID();
      await db.execute(
        `INSERT INTO client_invoice_payment_log
           (id, tracking_id, amount_paid, payment_date, payment_mode, transaction_ref, remarks, recorded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          logId,
          existing[0].id,
          payload.amount_received,
          payload.payment_date ?? new Date().toISOString().slice(0, 10),
          payload.payment_mode ?? null,
          payload.transaction_ref ?? null,
          payload.remarks ?? null,
          userId,
        ]
      );
    }

    return { success: true, id: existing[0].id };
  }

  await db.execute(
    `INSERT INTO client_invoice_payment_status
       (id, invoice_ref_id, client_name, branch_name, cost_centre, invoice_month, finance_year,
        invoice_amount, payment_status, amount_received, payment_date, payment_mode, transaction_ref,
        remarks, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      payload.invoice_ref_id,
      payload.client_name,
      payload.branch_name,
      payload.cost_centre,
      payload.invoice_month,
      payload.finance_year,
      payload.invoice_amount,
      payload.payment_status,
      payload.amount_received,
      payload.payment_date ?? null,
      payload.payment_mode ?? null,
      payload.transaction_ref ?? null,
      payload.remarks ?? null,
      userId,
    ]
  );

  if (payload.amount_received > 0) {
    const logId = randomUUID();
    await db.execute(
      `INSERT INTO client_invoice_payment_log
         (id, tracking_id, amount_paid, payment_date, payment_mode, transaction_ref, remarks, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        logId,
        id,
        payload.amount_received,
        payload.payment_date ?? new Date().toISOString().slice(0, 10),
        payload.payment_mode ?? null,
        payload.transaction_ref ?? null,
        payload.remarks ?? null,
        userId,
      ]
    );
  }

  return { success: true, id };
}

export async function getPaymentHistory(invoiceRefId: number): Promise<any[]> {
  const [logs] = await db.execute<RowDataPacket[]>(
    `SELECT l.*, u.full_name AS recorded_by_name
     FROM client_invoice_payment_log l
     LEFT JOIN employees u ON u.id = l.recorded_by
     WHERE l.tracking_id IN (
       SELECT id FROM client_invoice_payment_status WHERE invoice_ref_id = ?
     )
     ORDER BY l.recorded_at DESC`,
    [invoiceRefId]
  );
  return logs;
}

export async function getSeatRatesFromDbBill(
  financeYear: string,
  month: string,
  branchName?: string
): Promise<SeatRateInfo[]> {
  const conditions: string[] = ["p.fin_year = ?", "p.month_for = ?"];
  const params: (string | number)[] = [financeYear, month];

  if (branchName) {
    conditions.push("cm.branch = ?");
    params.push(branchName);
  }

  conditions.push("p.qty IS NOT NULL AND p.qty != ''");
  conditions.push("CAST(p.qty AS DECIMAL(10,2)) >= 1");
  conditions.push("CAST(p.rate AS DECIMAL(12,2)) BETWEEN 10000 AND 100000");

  const rates = await billQuery<RowDataPacket>(
    `SELECT
       cm.branch AS branch,
       cm.cost_center AS cost_centre,
       cm.process_name AS process_name,
       cm.client AS client,
       cm.revenueType AS revenue_type,
       COALESCE(p.particulars, '') AS particulars,
       CAST(p.qty AS DECIMAL(10,2)) AS seats,
       CAST(p.rate AS DECIMAL(12,0)) AS rate_per_seat,
       CAST(p.amount AS DECIMAL(14,0)) AS monthly_value
     FROM cost_master cm
     JOIN inv_particulars p ON p.cost_center = cm.cost_center
     WHERE cm.active = 1
       AND cm.Revenue = 1
       AND ${conditions.join(" AND ")}
     ORDER BY cm.branch, cm.client, CAST(p.amount AS DECIMAL(14,2)) DESC
     LIMIT 300`,
    params
  );

  return rates.map((r) => ({
    branch: r.branch,
    cost_centre: r.cost_centre,
    client: r.client || r.process_name || "",
    service: r.revenue_type || "",
    particulars: r.particulars,
    seats: Number(r.seats),
    rate_per_seat: Number(r.rate_per_seat),
    monthly_value: Number(r.monthly_value),
  }));
}

export async function getPredictiveRevenue(
  financeYear: string,
  month: string
): Promise<{
  total_seats: number;
  average_rate: number;
  predicted_revenue: number;
  branch_breakdown: Array<{ branch: string; seats: number; predicted: number }>;
}> {
  const rates = await getSeatRatesFromDbBill(financeYear, month);

  const branchMap = new Map<string, { seats: number; total: number }>();
  for (const r of rates) {
    const existing = branchMap.get(r.branch) ?? { seats: 0, total: 0 };
    existing.seats += r.seats;
    existing.total += r.monthly_value;
    branchMap.set(r.branch, existing);
  }

  const total_seats = rates.reduce((sum, r) => sum + r.seats, 0);
  const predicted_revenue = rates.reduce((sum, r) => sum + r.monthly_value, 0);
  const average_rate = total_seats > 0 ? predicted_revenue / total_seats : 0;

  const branch_breakdown = Array.from(branchMap.entries()).map(([branch, data]) => ({
    branch,
    seats: data.seats,
    predicted: data.total,
  }));

  return {
    total_seats,
    average_rate: Math.round(average_rate),
    predicted_revenue,
    branch_breakdown,
  };
}

export async function getClientSummary(): Promise<Array<{
  client_name: string;
  total_invoiced: number;
  total_received: number;
  pending: number;
  invoice_count: number;
  avg_collection_days: number;
}>> {
  const clients = await billQuery<RowDataPacket>(
    `SELECT
       i.cost_client AS client_name,
       COUNT(*) AS invoice_count,
       SUM(CAST(COALESCE(i.grnd, 0) AS DECIMAL(14,2))) AS total_invoiced,
       SUM(CASE WHEN i.PaymentStatus = 'Y' THEN CAST(COALESCE(i.grnd, 0) AS DECIMAL(14,2)) ELSE 0 END) AS total_received
     FROM tbl_invoice i
     WHERE i.finance_year IN ('2025-26', '2026-27')
       AND i.cost_client IS NOT NULL AND i.cost_client != ''
     GROUP BY i.cost_client
     ORDER BY total_invoiced DESC
     LIMIT 50`
  );

  return clients.map((c) => {
    const invoiced = Number(c.total_invoiced);
    const received = Number(c.total_received);
    return {
      client_name: c.client_name,
      total_invoiced: invoiced,
      total_received: received,
      pending: invoiced - received,
      invoice_count: Number(c.invoice_count),
      avg_collection_days: 45,
    };
  });
}
