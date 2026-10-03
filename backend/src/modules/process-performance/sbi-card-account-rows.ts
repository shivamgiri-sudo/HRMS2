import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { AccountOpsRow } from "./sbi-card-collections-ops.calc.js";

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** One day's account snapshot (every flow) as the analytics read it. Phone numbers are not stored, so none can come back. */
export async function loadAccountOpsRows(processId: string, reportDate: string): Promise<AccountOpsRow[]> {
  const attemptCols = [1, 2, 3, 4, 5, 6].map((n) => `DATE_FORMAT(call${n}_dt, '%Y-%m-%d %H:%i:%s') AS c${n}, disp${n}_c AS d${n}, agent${n}_id AS a${n}`).join(", ");
  const [ar] = await db.execute<RowDataPacket[]>(
    `SELECT account_no, delq1, billing_cycle, cibil_score, vintage, region, product_class, account_class, call_table_name, promo_code,
              ntc_flag, new_to_card_flag, total_amount_due, cur_bal, flow, cd, nrr, DATE_FORMAT(date_last_pmt, '%Y-%m-%d') AS lp, cur_bal_plus_dpi, last_action_code, DATE_FORMAT(last_ptp_date, '%Y-%m-%d') AS ptp_d,
              DATE_FORMAT(callback_dt, '%Y-%m-%d %H:%i:%s') AS cb, donotcall, dial_cnt, ${attemptCols}
         FROM sbi_card_account_file WHERE process_id = ? AND report_date = ?`, [processId, reportDate]);
  return ar.map((r) => ({
      accountNo: String(r.account_no), delq: r.delq1 ?? null, billingCycle: r.billing_cycle ?? null, cibil: num(r.cibil_score),
      vintage: num(r.vintage), region: r.region ?? null, productClass: r.product_class ?? null, accountClass: r.account_class ?? null,
      callTable: r.call_table_name ?? null, promo: r.promo_code ?? null, ntc: r.ntc_flag ?? null, newToCard: r.new_to_card_flag ?? null,
      totalDue: num(r.total_amount_due), curBal: num(r.cur_bal), flow: r.flow ?? null, cd: num(r.cd), nrr: r.nrr ?? null, lastPmtDate: r.lp ?? null, dpiBal: num(r.cur_bal_plus_dpi), lastActionCode: r.last_action_code ?? null, lastPtpDate: r.ptp_d ?? null,
      callbackDt: r.cb ?? null, dnc: r.donotcall ?? null, dialCnt: num(r.dial_cnt),
      attempts: [1, 2, 3, 4, 5, 6].map((n) => ({ dt: r[`c${n}`] ?? null, disp: r[`d${n}`] ?? null, agent: r[`a${n}`] ?? null })),
    }));
}
