import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { emailService } from "../communication/email.service.js";
import {
  birthdayGreetingEmail,
  workAnniversaryEmail,
} from "../communication/professional-email-templates.js";

const PROD_BASE_URL = process.env.APP_BASE_URL ?? "https://mcnhrms.teammas.in";

type CelebrationEmployee = {
  id: string;
  full_name: string;
  email: string | null;
  avatar_url: string | null;
  branch_name: string | null;
  date_of_joining: string;
  years_completed?: number;
};

function resolvePhotoUrl(avatarUrl: string | null): string | undefined {
  if (!avatarUrl) return undefined;
  // avatar_url is already an absolute path like /api/files/employee-photos/...
  return avatarUrl.startsWith("http") ? avatarUrl : `${PROD_BASE_URL}${avatarUrl}`;
}

async function resolveSystemUserId(): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT u.id FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     WHERE ur.role IN ('super_admin','hr_head','admin')
       AND u.active_status = 1
     ORDER BY FIELD(ur.role,'super_admin','hr_head','admin')
     LIMIT 1`,
  );
  return (rows[0]?.id as string) ?? null;
}

export async function queryTodayBirthdays(): Promise<CelebrationEmployee[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.full_name, e.email, e.avatar_url,
            bm.branch_name,
            e.date_of_joining
       FROM employees e
       LEFT JOIN branch_master bm ON bm.id = e.branch_id
      WHERE e.active_status = 1
        AND e.date_of_birth IS NOT NULL
        AND MONTH(e.date_of_birth) = MONTH(CURDATE())
        AND DAY(e.date_of_birth)   = DAY(CURDATE())`,
  );
  return rows as CelebrationEmployee[];
}

export async function queryTodayAnniversaries(): Promise<CelebrationEmployee[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.full_name, e.email, e.avatar_url,
            bm.branch_name,
            e.date_of_joining,
            TIMESTAMPDIFF(YEAR, e.date_of_joining, CURDATE()) AS years_completed
       FROM employees e
       LEFT JOIN branch_master bm ON bm.id = e.branch_id
      WHERE e.active_status = 1
        AND e.date_of_joining IS NOT NULL
        AND MONTH(e.date_of_joining) = MONTH(CURDATE())
        AND DAY(e.date_of_joining)   = DAY(CURDATE())
        AND TIMESTAMPDIFF(YEAR, e.date_of_joining, CURDATE()) > 0`,
  );
  return rows as CelebrationEmployee[];
}

async function hasCelebrationPostToday(
  celebratedEmployeeId: string,
  postType: "birthday" | "anniversary",
): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM company_posts
      WHERE celebrated_employee_id = ?
        AND post_type = ?
        AND DATE(created_at) = CURDATE()
        AND active_status = 1
      LIMIT 1`,
    [celebratedEmployeeId, postType],
  );
  return rows.length > 0;
}

export async function sendBirthdayGreeting(emp: CelebrationEmployee): Promise<void> {
  // Skip if post already created today (idempotency guard)
  if (await hasCelebrationPostToday(emp.id, "birthday")) return;

  const photoUrl = resolvePhotoUrl(emp.avatar_url);
  const name = emp.full_name?.trim() || "Colleague";
  const branch = emp.branch_name ?? undefined;

  // 1. Send email (best-effort — don't fail the whole sweep if email bounces)
  if (emp.email) {
    try {
      await emailService.send({
        to: emp.email,
        subject: `🎂 Happy Birthday, ${name}! 🎉`,
        html: birthdayGreetingEmail({ employeeName: name, photoUrl, branchName: branch }),
      });
    } catch (err) {
      console.error(`[celebration] Birthday email failed for ${emp.id}:`, err);
    }
  }

  // 2. Auto-post to Company Feed
  const sysUserId = await resolveSystemUserId();
  if (!sysUserId) {
    console.warn("[celebration] No system user found — skipping feed post for birthday:", emp.id);
    return;
  }

  const branchTag = branch ? ` The ${branch} family is celebrating with you today! 🥳` : "";
  const contentText = `🎂 Wishing ${name} a very Happy Birthday! 🎉${branchTag} May your day be filled with joy, laughter, and everything wonderful! 🌸🎈🎁`;

  await db.execute(
    `INSERT INTO company_posts
       (id, author_user_id, author_employee_id, celebrated_employee_id,
        content_text, post_type, is_system_post,
        status, moderation_state, submitted_at, approved_at, approved_by, active_status)
     VALUES (?, ?, NULL, ?, ?, 'birthday', 1, 'approved', 'clean', NOW(), NOW(), ?, 1)`,
    [randomUUID(), sysUserId, emp.id, contentText, sysUserId],
  );
}

export async function sendAnniversaryGreeting(emp: CelebrationEmployee): Promise<void> {
  if (await hasCelebrationPostToday(emp.id, "anniversary")) return;

  const photoUrl = resolvePhotoUrl(emp.avatar_url);
  const name = emp.full_name?.trim() || "Colleague";
  const branch = emp.branch_name ?? undefined;
  const years = Number(emp.years_completed ?? 1);

  // Format join date for display
  const joinDateDisplay = emp.date_of_joining
    ? new Date(emp.date_of_joining).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";

  if (emp.email) {
    try {
      await emailService.send({
        to: emp.email,
        subject: `⭐ Happy ${years}-Year Work Anniversary, ${name}!`,
        html: workAnniversaryEmail({
          employeeName: name,
          yearsCompleted: years,
          joinDate: joinDateDisplay,
          photoUrl,
          branchName: branch,
        }),
      });
    } catch (err) {
      console.error(`[celebration] Anniversary email failed for ${emp.id}:`, err);
    }
  }

  const sysUserId = await resolveSystemUserId();
  if (!sysUserId) {
    console.warn("[celebration] No system user found — skipping feed post for anniversary:", emp.id);
    return;
  }

  const yearLabel = years === 1 ? "year" : "years";
  const branchTag = branch ? ` The entire ${branch} team is proud of you!` : "";
  const contentText = `🌟 Congratulations ${name} on completing ${years} wonderful ${yearLabel} with MAS Callnet! 🏆${branchTag} Your dedication, consistency, and contributions inspire everyone around you. Thank you for being an incredible part of our family! ✨`;

  await db.execute(
    `INSERT INTO company_posts
       (id, author_user_id, author_employee_id, celebrated_employee_id,
        content_text, post_type, is_system_post,
        status, moderation_state, submitted_at, approved_at, approved_by, active_status)
     VALUES (?, ?, NULL, ?, ?, 'anniversary', 1, 'approved', 'clean', NOW(), NOW(), ?, 1)`,
    [randomUUID(), sysUserId, emp.id, contentText, sysUserId],
  );
}

export async function runCelebrationSweep(): Promise<{ birthdays: number; anniversaries: number; failed: number }> {
  let birthdays = 0;
  let anniversaries = 0;
  let failed = 0;

  const [bdayEmployees, annivEmployees] = await Promise.all([
    queryTodayBirthdays(),
    queryTodayAnniversaries(),
  ]);

  for (const emp of bdayEmployees) {
    try {
      await sendBirthdayGreeting(emp);
      birthdays++;
    } catch (err) {
      failed++;
      console.error(`[celebration] Birthday sweep failed for ${emp.id}:`, err);
    }
  }

  for (const emp of annivEmployees) {
    try {
      await sendAnniversaryGreeting(emp);
      anniversaries++;
    } catch (err) {
      failed++;
      console.error(`[celebration] Anniversary sweep failed for ${emp.id}:`, err);
    }
  }

  return { birthdays, anniversaries, failed };
}
