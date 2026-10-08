import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { Commentary } from "./portal.types.js";
import type { CreateCommentaryInput } from "./portal.validation.js";

const demoReplies: Array<{ id: string; replied_by_client_user_id: string; reply_text: string; created_at: string }> = [];
let demoAcknowledgedAt: string | null = null;
let demoAcknowledgedBy: string | null = null;

export const portalCommentaryService = {
  async get(processId: string, period: string): Promise<Commentary | null> {
    if (!/^\d{4}-\d{2}$/.test(period)) throw new Error(`Invalid period format: ${period}`);

    if (processId === "p-demo-1") {
      return {
        id: "comm-1",
        process_id: "p-demo-1",
        period,
        author_name: "Amit Patel",
        author_designation: "General Manager Operations",
        body: "During May, Customer Satisfaction remained steady at 88.5% and is within safe operational limits. Average Handle Time experienced a minor spike due to training of batch 4 agents, but is expected to normalize by week 2 of June. Action plans are underway for empathy coaching and KB lookups. No major escalations to report.",
        published_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        acknowledged_at: demoAcknowledgedAt,
        acknowledged_by_client_user_id: demoAcknowledgedBy,
        replies: demoReplies
      };
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM management_commentary WHERE process_id = ? AND period = ? LIMIT 1",
      [processId, period]
    );
    const row = (rows as RowDataPacket[])[0];
    if (!row) return null;

    const [replyRows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM management_commentary_reply WHERE commentary_id = ? ORDER BY created_at ASC",
      [row.id]
    );

    return {
      id: row.id,
      process_id: row.process_id,
      period: row.period,
      author_name: row.author_name,
      author_designation: row.author_designation,
      body: row.body,
      published_at: row.published_at,
      acknowledged_at: row.acknowledged_at ?? null,
      acknowledged_by_client_user_id: row.acknowledged_by_client_user_id ?? null,
      replies: (replyRows as RowDataPacket[]).map(r => ({
        id: r.id,
        replied_by_client_user_id: r.replied_by_client_user_id,
        reply_text: r.reply_text,
        created_at: r.created_at,
      })),
    };
  },

  async create(input: CreateCommentaryInput, authorId: string): Promise<Commentary> {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO management_commentary (id, process_id, period, author_id, author_name, author_designation, body)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, input.processId, input.period, authorId, input.authorName, input.authorDesignation, input.body]
    );
    const result = await portalCommentaryService.get(input.processId, input.period);
    if (!result) throw new Error("Failed to fetch created commentary");
    return result;
  },

  async acknowledge(commentaryId: string, clientUserId: string): Promise<void> {
    if (commentaryId === "comm-1") {
      demoAcknowledgedAt = new Date().toISOString();
      demoAcknowledgedBy = clientUserId;
      return;
    }
    await db.execute(
      "UPDATE management_commentary SET acknowledged_at = NOW(), acknowledged_by_client_user_id = ? WHERE id = ? AND acknowledged_at IS NULL",
      [clientUserId, commentaryId]
    );
  },

  async addReply(commentaryId: string, clientUserId: string, text: string): Promise<void> {
    if (commentaryId === "comm-1") {
      demoReplies.push({
        id: randomUUID(),
        replied_by_client_user_id: clientUserId,
        reply_text: text,
        created_at: new Date().toISOString(),
      });
      return;
    }
    await db.execute(
      "INSERT INTO management_commentary_reply (id, commentary_id, replied_by_client_user_id, reply_text) VALUES (?, ?, ?, ?)",
      [randomUUID(), commentaryId, clientUserId, text]
    );
  },
};
