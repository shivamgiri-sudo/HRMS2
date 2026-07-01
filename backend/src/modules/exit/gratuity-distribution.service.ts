import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export const gratuityDistributionService = {
  async calculateNomineePayouts(
    employeeId: string,
    gratuityAmount: number
  ): Promise<Array<{ nominee_id: string; nominee_name: string; payout_amount: number }>> {
    // Fetch all nominees with share percentages
    const [nomineeRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, nominee_name, share_percentage FROM employee_nominee
       WHERE employee_id = ? AND nominee_for IN ('gratuity', 'general')
       ORDER BY share_percentage DESC`,
      [employeeId]
    );

    if (nomineeRows.length === 0) {
      // No nominees — entire gratuity to employee bank account
      return [{ nominee_id: employeeId, nominee_name: "Employee Bank Account", payout_amount: gratuityAmount }];
    }

    // Validate share percentages sum to 100
    const totalShare = (nomineeRows as any[]).reduce((sum, n) => sum + (n.share_percentage || 0), 0);
    if (totalShare !== 100 && totalShare !== 0) {
      console.warn(`[gratuity] Employee ${employeeId}: nominee shares total ${totalShare}%, not 100%. Distributing proportionally.`);
    }

    // Calculate payout per nominee
    const payouts = (nomineeRows as any[]).map((n) => ({
      nominee_id: n.id,
      nominee_name: n.nominee_name,
      payout_amount: gratuityAmount * (n.share_percentage || 100) / Math.max(totalShare, 100),
    }));

    return payouts;
  },

  async recordNomineePayouts(
    exitRequestId: string,
    employeeId: string,
    gratuityAmount: number,
    payouts: Array<{ nominee_id: string; nominee_name: string; payout_amount: number }>
  ): Promise<void> {
    // Record each payout in gratuity_distribution table
    for (const payout of payouts) {
      await db.execute(
        `INSERT INTO gratuity_distribution
           (id, exit_request_id, employee_id, nominee_id, nominee_name, payout_amount, status, created_at)
         VALUES (UUID(), ?, ?, ?, ?, ?, 'pending', NOW())`,
        [exitRequestId, employeeId, payout.nominee_id, payout.nominee_name, payout.payout_amount]
      ).catch((err) => console.error(`[gratuity] Failed to record payout for ${payout.nominee_name}:`, err));
    }
  },
};
