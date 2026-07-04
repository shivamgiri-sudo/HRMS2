import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { atsService } from "./ats.service.js";

export interface AtsQueueToken {
  id: string;
  candidate_id: string;
  token: string;
  arrival_time: string;
  current_stage: string;
  assigned_recruiter_id: string | null;
  assigned_interviewer_id: string | null;
  status: "active" | "walked_out" | "completed";
  wait_alert_sent: number;
  walk_out_at: string | null;
  created_at: string;
  updated_at: string;
}

const WAIT_ALERT_MINUTES = 20;

export const atsQueueService = {
  async createToken(candidateId: string, arrivalTime: string): Promise<AtsQueueToken> {
    // Verify candidate exists and is active
    const candidate = await atsService.getCandidate(candidateId);
    if (!candidate.active_status) {
      throw Object.assign(new Error("Candidate not found"), { statusCode: 404 as const });
    }

    // Prevent duplicate active token for same candidate
    const [existing] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM ats_queue_token WHERE candidate_id = ? AND status = 'active' LIMIT 1",
      [candidateId]
    );
    if ((existing as RowDataPacket[]).length > 0) {
      throw Object.assign(new Error("Candidate already has an active queue token"), {
        statusCode: 409 as const,
        code: 'DUPLICATE_QUEUE_TOKEN' as const,
      });
    }

    const id = randomUUID();
    const token = randomUUID();
    await db.execute(
      `INSERT INTO ats_queue_token
         (id, candidate_id, token, arrival_time, current_stage, status)
       VALUES (?, ?, ?, ?, 'Arrived', 'active')`,
      [id, candidateId, token, arrivalTime]
    );
    return this.getTokenById(id);
  },

  async getTokenById(id: string): Promise<AtsQueueToken> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM ats_queue_token WHERE id = ? LIMIT 1",
      [id]
    );
    const row = (rows as RowDataPacket[])[0];
    if (!row) throw Object.assign(new Error("Queue token not found"), { statusCode: 404 });
    return row as AtsQueueToken;
  },

  async getTokenByCandidateId(candidateId: string): Promise<AtsQueueToken> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM ats_queue_token WHERE candidate_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
      [candidateId]
    );
    const row = (rows as RowDataPacket[])[0];
    if (!row) throw Object.assign(new Error("No active queue token for this candidate"), { statusCode: 404 });
    return row as AtsQueueToken;
  },

  async walkOut(tokenId: string): Promise<AtsQueueToken> {
    const token = await this.getTokenById(tokenId);
    if (token.status !== 'active') {
      throw Object.assign(new Error("Token is not active"), { statusCode: 400 });
    }
    await db.execute(
      "UPDATE ats_queue_token SET status = 'walked_out', walk_out_at = NOW(), updated_at = NOW() WHERE id = ?",
      [tokenId]
    );
    return this.getTokenById(tokenId);
  },

  async reEntry(candidateId: string, arrivalTime: string): Promise<AtsQueueToken> {
    // Re-entry: create a new active token (previous must be walked_out or completed)
    const [existing] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM ats_queue_token WHERE candidate_id = ? AND status = 'active' LIMIT 1",
      [candidateId]
    );
    if ((existing as RowDataPacket[]).length > 0) {
      throw Object.assign(new Error("Candidate still has an active token; walk out first"), { statusCode: 409 });
    }
    return this.createToken(candidateId, arrivalTime);
  },

  async listActiveQueue(
    scopeFilter: { sql: string; params: unknown[] },
    now: Date
  ): Promise<Array<AtsQueueToken & { candidate_name: string; mobile: string; wait_minutes: number; over_threshold: boolean }>> {
    const scopeSql = scopeFilter.sql ? `AND (${scopeFilter.sql})` : '';
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT qt.*,
              c.full_name AS candidate_name,
              c.mobile,
              TIMESTAMPDIFF(MINUTE, qt.arrival_time, ?) AS wait_minutes
         FROM ats_queue_token qt
         JOIN ats_candidate c ON c.id = qt.candidate_id
        WHERE qt.status = 'active' ${scopeSql}
        ORDER BY qt.arrival_time ASC`,
      [now.toISOString().slice(0, 19).replace('T', ' '), ...(scopeFilter.params || [])]
    );

    return (rows as RowDataPacket[]).map((r) => ({
      ...(r as AtsQueueToken & { candidate_name: string; mobile: string }),
      wait_minutes: Number(r.wait_minutes ?? 0),
      over_threshold: Number(r.wait_minutes ?? 0) >= WAIT_ALERT_MINUTES,
    }));
  },

  async assignRecruiter(tokenId: string, recruiterId: string | null): Promise<AtsQueueToken> {
    await db.execute(
      "UPDATE ats_queue_token SET assigned_recruiter_id = ?, updated_at = NOW() WHERE id = ?",
      [recruiterId, tokenId]
    );
    return this.getTokenById(tokenId);
  },

  async assignInterviewer(tokenId: string, interviewerId: string | null): Promise<AtsQueueToken> {
    await db.execute(
      "UPDATE ats_queue_token SET assigned_interviewer_id = ?, updated_at = NOW() WHERE id = ?",
      [interviewerId, tokenId]
    );
    return this.getTokenById(tokenId);
  },

  async updateStage(tokenId: string, stage: string): Promise<AtsQueueToken> {
    await db.execute(
      "UPDATE ats_queue_token SET current_stage = ?, updated_at = NOW() WHERE id = ?",
      [stage, tokenId]
    );
    return this.getTokenById(tokenId);
  },
};
