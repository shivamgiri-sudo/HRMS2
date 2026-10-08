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

    const storedNextSequence = Number(sequenceRows[0].next_sequence);

    /*
     * Self-heals against the db_bill -> grn_request sync, which inserts rows in this exact
     * Mas/{branch_seq}/{yy}/{n} shape using db_bill's own, much-further-ahead counter, entirely
     * bypassing finance_grn_sequence. Confirmed live: for one branch+year the native counter sat
     * at next_sequence=30 while db_bill-synced rows already occupied sequence numbers up to 334
     * for the same branch+year. Handing out storedNextSequence unchecked would collide with a
     * number the sync has already used, which either violates uq_grn_number or, if that
     * constraint were ever missing, silently duplicates a real financial record. The sync
     * reruns on its own schedule and keeps advancing past any one-time reseed of this counter,
     * so the true high-water mark has to be re-derived on every allocation, not fixed once.
     * Do not simplify this back to a plain next_sequence + 1.
     */
    const [maxRows] = await connection.execute<RowDataPacket[]>(
      `SELECT MAX(CAST(SUBSTRING_INDEX(grn_number, '/', -1) AS UNSIGNED)) AS max_seq
         FROM grn_request
        WHERE branch_id = ? AND financial_year = ?
          AND grn_number REGEXP '^Mas/[0-9]+/[0-9]{2}/[0-9]+$'`,
      [branchId, financialYear]
    );
    const maxSeqFromGrnRequest =
      maxRows[0]?.max_seq === null || maxRows[0]?.max_seq === undefined
        ? null
        : Number(maxRows[0].max_seq);

    const sequenceToUse = Math.max(storedNextSequence, (maxSeqFromGrnRequest ?? 0) + 1);
    if (!Number.isSafeInteger(sequenceToUse) || sequenceToUse < 1) {
      throw new Error("GRN sequence is invalid");
    }

    await connection.execute(
      `UPDATE finance_grn_sequence
          SET next_sequence = ?
        WHERE branch_id = ? AND financial_year = ?`,
      [sequenceToUse + 1, branchId, financialYear]
    );
    await connection.commit();

    const branchSequence = Number(branchRows[0].branch_seq ?? 0);
    const yy = financialYear.slice(2, 4);
    return `Mas/${branchSequence}/${yy}/${sequenceToUse}`;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
