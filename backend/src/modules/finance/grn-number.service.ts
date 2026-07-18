import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Allocates a unique GRN sequence for one branch and financial year.
 * The sequence row is locked and incremented in the same transaction, so two
 * concurrent requests cannot receive the same number.
 */
export async function allocateGrnNumber(
  branchId: string,
  financialYear: string
): Promise<string> {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [branchRows] = await connection.execute<RowDataPacket[]>(
      `SELECT branch_seq
         FROM branch_master
        WHERE id = ?
        LIMIT 1`,
      [branchId]
    );
    if (!branchRows[0]) throw new Error("Selected branch was not found");

    await connection.execute(
      `INSERT INTO finance_grn_sequence
        (branch_id, financial_year, next_sequence)
       VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE next_sequence = next_sequence`,
      [branchId, financialYear]
    );

    const [sequenceRows] = await connection.execute<RowDataPacket[]>(
      `SELECT next_sequence
         FROM finance_grn_sequence
        WHERE branch_id = ? AND financial_year = ?
        FOR UPDATE`,
      [branchId, financialYear]
    );
    if (!sequenceRows[0]) throw new Error("GRN sequence could not be initialized");

    const sequence = Number(sequenceRows[0].next_sequence);
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new Error("GRN sequence is invalid");
    }

    await connection.execute(
      `UPDATE finance_grn_sequence
          SET next_sequence = next_sequence + 1
        WHERE branch_id = ? AND financial_year = ?`,
      [branchId, financialYear]
    );
    await connection.commit();

    const branchSequence = Number(branchRows[0].branch_seq ?? 0);
    const yy = financialYear.slice(2, 4);
    return `Mas/${branchSequence}/${yy}/${sequence}`;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
