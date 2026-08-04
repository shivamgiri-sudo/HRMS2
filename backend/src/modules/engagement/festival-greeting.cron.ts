import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { emailService } from "../communication/email.service.js";
import { festivalGreetingEmail } from "../communication/professional-email-templates.js";

const RUN_HOUR = 8; // 8 AM IST — same as birthday/anniversary cron

// ─── Types ────────────────────────────────────────────────────────────────────

interface FestivalRow {
  id: string;
  festival_name: string;
  festival_date: string;
  greeting_subject: string;
  greeting_body: string;
  emoji: string;
}

interface EmployeeEmail {
  id: string;
  full_name: string;
  official_email: string;
  personal_email: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function resolveSystemUserId(): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT au.id FROM auth_user au
     JOIN user_roles ur ON ur.user_id = au.id
     WHERE ur.role_key IN ('super_admin','hr_head','admin')
       AND au.is_blocked = 0
     ORDER BY FIELD(ur.role_key,'super_admin','hr_head','admin')
     LIMIT 1`,
  );
  return (rows[0]?.id as string) ?? null;
}

async function hasFestivalPostToday(festivalName: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM company_posts
      WHERE post_type = 'festival'
        AND DATE(created_at) = CURDATE()
        AND active_status = 1
        AND content_text LIKE ?
      LIMIT 1`,
    [`%${festivalName}%`],
  );
  return rows.length > 0;
}

async function getActiveEmployeeEmails(): Promise<EmployeeEmail[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, full_name, official_email,
            email AS personal_email
       FROM employees
      WHERE active_status = 1
        AND official_email IS NOT NULL
        AND official_email != ''`,
  );
  return rows as EmployeeEmail[];
}

// ─── Core sweep ──────────────────────────────────────────────────────────────

export async function runFestivalGreetingSweep(): Promise<{ festivals: number; emailsSent: number; failed: number }> {
  const [festivalRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, festival_name, festival_date, greeting_subject, greeting_body, emoji
       FROM festival_calendar
      WHERE is_active = 1
        AND festival_date = CURDATE()`,
  );
  const festivals = festivalRows as FestivalRow[];

  if (festivals.length === 0) return { festivals: 0, emailsSent: 0, failed: 0 };

  const sysUserId = await resolveSystemUserId();
  const employees = await getActiveEmployeeEmails();

  let emailsSent = 0;
  let failed = 0;
  let festivalCount = 0;

  for (const festival of festivals) {
    try {
      // Idempotency — skip if a post was already created today for this festival
      if (await hasFestivalPostToday(festival.festival_name)) continue;

      // 1. Create company feed post (all-staff, no specific celebrated_employee_id)
      if (sysUserId) {
        const contentText = `${festival.emoji} ${festival.greeting_subject}\n\n${festival.greeting_body}`;
        await db.execute(
          `INSERT INTO company_posts
             (id, author_user_id, author_employee_id, celebrated_employee_id,
              content_text, post_type, is_system_post,
              status, moderation_state, submitted_at, approved_at, approved_by, active_status)
           VALUES (?, ?, NULL, NULL, ?, 'festival', 1, 'approved', 'clean', NOW(), NOW(), ?, 1)`,
          [randomUUID(), sysUserId, contentText, sysUserId],
        );
      }

      // 2. Send email to all active employees (batch, no per-employee personalisation needed)
      const html = festivalGreetingEmail({
        festivalName: festival.festival_name,
        emoji: festival.emoji,
        greetingBody: festival.greeting_body,
      });

      for (const emp of employees) {
        try {
          await emailService.send({
            to: emp.official_email,
            subject: `${festival.emoji} ${festival.greeting_subject} — MAS Callnet`,
            html,
          });
          emailsSent++;
        } catch (err) {
          failed++;
          console.error(`[festival] Email failed for ${emp.id} (${festival.festival_name}):`, err);
        }
      }

      festivalCount++;
    } catch (err) {
      failed++;
      console.error(`[festival] Sweep failed for ${festival.festival_name}:`, err);
    }
  }

  return { festivals: festivalCount, emailsSent, failed };
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

let nextRun: ReturnType<typeof setTimeout> | undefined;

function msUntilNextRun(now = new Date()): number {
  const next = new Date(now);
  next.setHours(RUN_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

async function tick(): Promise<void> {
  try {
    const result = await runFestivalGreetingSweep();
    if (result.festivals > 0) {
      console.log(`[festival] Sweep complete: ${result.festivals} festival(s), ${result.emailsSent} emails sent, ${result.failed} failed`);
    }
  } catch (err) {
    console.error("[festival] Sweep threw:", err);
  } finally {
    nextRun = setTimeout(tick, msUntilNextRun());
  }
}

export function startFestivalGreetingScheduler(): void {
  if (nextRun) return;
  nextRun = setTimeout(tick, msUntilNextRun());
  console.log("[festival] Scheduler started — next run at 08:00");
}

export function stopFestivalGreetingScheduler(): void {
  if (nextRun) {
    clearTimeout(nextRun);
    nextRun = undefined;
  }
}
