import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { addPoints } from "./gamification.service.js";
import type {
  CreateKudosTemplateDTO,
  KudosFilters,
  KudosMaster,
  KudosWithDetailsResponse,
  SendKudosDTO,
} from "./engagement.types.js";

const MONTHLY_KUDOS_LIMIT = 10;

export async function createKudosTemplate(data: CreateKudosTemplateDTO): Promise<KudosMaster> {
  const id = randomUUID();
  await db.execute(
    `INSERT INTO kudos_master
       (kudos_template_id, kudos_title, kudos_message_template, kudos_icon,
        kudos_category, points_value, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.kudos_title,
      data.kudos_message_template ?? null,
      data.kudos_icon ?? null,
      data.kudos_category ?? null,
      data.points_value ?? 10,
      data.is_active ?? true,
    ]
  );
  const created = await getKudosTemplate(id);
  if (!created) throw new Error("Failed to create kudos template");
  return created;
}

export async function getKudosTemplate(id: string): Promise<KudosMaster | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM kudos_master WHERE kudos_template_id = ? LIMIT 1",
    [id]
  );
  return (rows as KudosMaster[])[0] ?? null;
}

export async function listKudosTemplates(activeOnly = true): Promise<KudosMaster[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM kudos_master
     ${activeOnly ? "WHERE is_active = 1" : ""}
     ORDER BY kudos_category, kudos_title`
  );
  return rows as KudosMaster[];
}

export async function getMonthlyKudosLimit(
  employeeId: string
): Promise<{ given: number; limit: number; remaining: number }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as given
       FROM kudos_transaction
      WHERE sender_id = ?
        AND sent_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`,
    [employeeId]
  );
  const given = Number(rows[0]?.given ?? 0);
  return {
    given,
    limit: MONTHLY_KUDOS_LIMIT,
    remaining: Math.max(0, MONTHLY_KUDOS_LIMIT - given),
  };
}

export async function sendKudos(data: SendKudosDTO): Promise<string> {
  if (data.sender_id === data.receiver_id) throw new Error("Cannot give kudos to yourself");

  const limit = await getMonthlyKudosLimit(data.sender_id);
  if (limit.remaining <= 0) throw new Error("Monthly kudos limit reached");

  const template = data.kudos_template_id
    ? await getKudosTemplate(data.kudos_template_id)
    : null;
  if (data.kudos_template_id && (!template || !template.is_active)) {
    throw new Error("Kudos template not found or inactive");
  }

  const id = randomUUID();
  const points = template?.points_value ?? 10;
  await db.execute(
    `INSERT INTO kudos_transaction
       (kudos_id, sender_id, receiver_id, kudos_template_id, custom_message,
        points_awarded, is_anonymous)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.sender_id,
      data.receiver_id,
      data.kudos_template_id ?? null,
      data.custom_message ?? null,
      points,
      data.is_anonymous ?? false,
    ]
  );
  await addPoints(data.receiver_id, points, "kudos_received", "Kudos received", id);
  return id;
}

export async function listKudos(
  filters: KudosFilters = {},
  limit = 50
): Promise<KudosWithDetailsResponse[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(Number(limit) || 50), 1), 100);
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.sender_id) {
    conditions.push("kt.sender_id = ?");
    params.push(filters.sender_id);
  }
  if (filters.receiver_id) {
    conditions.push("kt.receiver_id = ?");
    params.push(filters.receiver_id);
  }
  if (filters.date_from) {
    conditions.push("kt.sent_at >= ?");
    params.push(filters.date_from);
  }
  if (filters.date_to) {
    conditions.push("kt.sent_at <= ?");
    params.push(filters.date_to);
  }
  if (filters.is_anonymous !== undefined) {
    conditions.push("kt.is_anonymous = ?");
    params.push(filters.is_anonymous);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT kt.*, km.kudos_title, km.kudos_icon, km.kudos_category,
            CASE WHEN kt.is_anonymous = 1 THEN 'Anonymous' ELSE sender.full_name END as sender_name,
            receiver.full_name as receiver_name
       FROM kudos_transaction kt
       JOIN employees sender ON sender.id = kt.sender_id
       JOIN employees receiver ON receiver.id = kt.receiver_id
       LEFT JOIN kudos_master km ON km.kudos_template_id = kt.kudos_template_id
       ${where}
      ORDER BY kt.sent_at DESC
      LIMIT ${safeLimit}`,
    params
  );
  return rows as KudosWithDetailsResponse[];
}
