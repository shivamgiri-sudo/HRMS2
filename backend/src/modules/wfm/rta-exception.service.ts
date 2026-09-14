import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';

export interface RtaException {
  id: number;
  alertId: string;
  employeeId: string;
  exceptionDate: string;
  exceptionType: string;
  exceptionState: string;
  dispositionType: string | null;
  dispositionOwnerId: string | null;
  dispositionComment: string | null;
  dispositionAt: string | null;
  regularizationId: string | null;
  rosterAmendmentId: string | null;
  createdAt: string;
}

type RtaExceptionRow = RowDataPacket & {
  id: number;
  alert_id: string;
  employee_id: string;
  exception_date: string;
  exception_type: string;
  exception_state: string;
  disposition_type: string | null;
  disposition_owner_id: string | null;
  disposition_comment: string | null;
  disposition_at: string | null;
  regularization_id: string | null;
  roster_amendment_id: string | null;
  created_at: string;
  updated_at: string | null;
};

const VALID_TRANSITIONS: Record<string, string[]> = {
  OPEN: ['ACKNOWLEDGED', 'ESCALATED'],
  ACKNOWLEDGED: ['ACTIONED', 'ESCALATED'],
  ACTIONED: ['RESOLVED', 'ESCALATED'],
  RESOLVED: [],
  ESCALATED: [],
};

function mapRow(row: RtaExceptionRow): RtaException {
  return {
    id: row.id,
    alertId: row.alert_id,
    employeeId: row.employee_id,
    exceptionDate: row.exception_date,
    exceptionType: row.exception_type,
    exceptionState: row.exception_state,
    dispositionType: row.disposition_type,
    dispositionOwnerId: row.disposition_owner_id,
    dispositionComment: row.disposition_comment,
    dispositionAt: row.disposition_at,
    regularizationId: row.regularization_id,
    rosterAmendmentId: row.roster_amendment_id,
    createdAt: row.created_at,
  };
}

export const rtaExceptionService = {
  async listExceptions(filters: {
    date?: string;
    processId?: string;
    state?: string;
    employeeId?: string;
  }): Promise<RtaException[]> {
    let query = 'SELECT e.* FROM wfm_rta_exception e WHERE 1=1';
    const params: (string | undefined)[] = [];

    if (filters.date) {
      query += ' AND e.exception_date = ?';
      params.push(filters.date);
    }

    if (filters.employeeId) {
      query += ' AND e.employee_id = ?';
      params.push(filters.employeeId);
    }

    if (filters.state) {
      query += ' AND e.exception_state = ?';
      params.push(filters.state);
    }

    // Note: processId filter is not directly on this table — skip for now
    // as indicated in the brief

    query += ' ORDER BY e.created_at DESC';

    const [rows] = await db.execute<RtaExceptionRow[]>(query, params);
    return (rows as RtaExceptionRow[]).map(mapRow);
  },

  async createException(data: {
    alertId: string;
    employeeId: string;
    exceptionDate: string;
    exceptionType: string;
    comment?: string;
  }): Promise<RtaException> {
    const query = `
      INSERT INTO wfm_rta_exception
        (alert_id, employee_id, exception_date, exception_type, disposition_comment, exception_state)
      VALUES (?, ?, ?, ?, ?, 'OPEN')
    `;
    const params = [
      data.alertId,
      data.employeeId,
      data.exceptionDate,
      data.exceptionType,
      data.comment || null,
    ];

    const result = await db.execute(query, params);
    const insertId = (result as any).insertId || 0;

    // Fetch and return the created record
    const [rows] = await db.execute<RtaExceptionRow[]>(
      'SELECT * FROM wfm_rta_exception WHERE id = ?',
      [insertId]
    );

    const row = (rows as RtaExceptionRow[])[0];
    if (!row) {
      throw new Error('Failed to retrieve created exception');
    }

    return mapRow(row);
  },

  async updateDisposition(
    id: number,
    data: {
      dispositionType: string;
      comment?: string;
      regularizationId?: string;
      rosterAmendmentId?: string;
      ownerId: string;
    }
  ): Promise<RtaException> {
    const query = `
      UPDATE wfm_rta_exception
      SET
        disposition_type = ?,
        disposition_comment = ?,
        disposition_owner_id = ?,
        regularization_id = ?,
        roster_amendment_id = ?,
        disposition_at = NOW()
      WHERE id = ?
    `;
    const params = [
      data.dispositionType,
      data.comment || null,
      data.ownerId,
      data.regularizationId || null,
      data.rosterAmendmentId || null,
      id,
    ];

    await db.execute(query, params);

    // Fetch and return the updated record
    const [rows] = await db.execute<RtaExceptionRow[]>(
      'SELECT * FROM wfm_rta_exception WHERE id = ?',
      [id]
    );

    const row = (rows as RtaExceptionRow[])[0];
    if (!row) {
      throw new Error('Exception not found');
    }

    return mapRow(row);
  },

  async updateState(id: number, newState: string): Promise<RtaException> {
    // Get current state
    const [rows] = await db.execute<RtaExceptionRow[]>(
      'SELECT * FROM wfm_rta_exception WHERE id = ?',
      [id]
    );

    const row = (rows as RtaExceptionRow[])[0];
    if (!row) {
      throw new Error('Exception not found');
    }

    const currentState = row.exception_state;

    // Validate transition
    const validTransitions = VALID_TRANSITIONS[currentState] || [];
    if (!validTransitions.includes(newState)) {
      const error = new Error(`Cannot transition from ${currentState} to ${newState}`);
      (error as any).statusCode = 400;
      throw error;
    }

    // Update state
    await db.execute(
      'UPDATE wfm_rta_exception SET exception_state = ? WHERE id = ?',
      [newState, id]
    );

    // Fetch and return the updated record
    const [updatedRows] = await db.execute<RtaExceptionRow[]>(
      'SELECT * FROM wfm_rta_exception WHERE id = ?',
      [id]
    );

    const updatedRow = (updatedRows as RtaExceptionRow[])[0];
    if (!updatedRow) {
      throw new Error('Exception not found after update');
    }

    return mapRow(updatedRow);
  },
};
