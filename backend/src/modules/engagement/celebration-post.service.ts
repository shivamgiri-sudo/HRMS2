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
  official_email: string | null;
  email: string | null;
  avatar_url: string | null;
  branch_display: string | null;   // display_name from branch_master
  branch_id: string | null;
  date_of_joining: string;
  years_completed?: number;
  designation_name: string | null;
  dept_name: string | null;
  process_name: string | null;
  gender: string | null;
  blood_group: string | null;
  band: string | null;
  manager_name: string | null;
  employee_code: string | null;
};

function resolvePhotoUrl(avatarUrl: string | null): string | undefined {
  if (!avatarUrl) return undefined;
  return avatarUrl.startsWith("http") ? avatarUrl : `${PROD_BASE_URL}${avatarUrl}`;
}

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

async function resolveAdminBccEmails(): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT au.email
       FROM auth_user au
       JOIN user_roles ur ON ur.user_id = au.id
      WHERE ur.role_key IN ('super_admin','admin')
        AND au.is_blocked = 0
        AND au.email NOT LIKE '%example.com'
        AND au.email NOT LIKE 'test.demo%'`,
  );
  return (rows as Array<{ email: string }>).map((r) => r.email).filter(Boolean);
}

async function resolveBranchHrBccEmails(branchId: string | null): Promise<string[]> {
  if (!branchId) return [];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT au.email
       FROM auth_user au
       JOIN user_roles ur ON ur.user_id = au.id
       JOIN user_assignment_scope uas ON uas.user_id = au.id
      WHERE ur.role_key IN ('hr','payroll_hr','branch_admin','branch_head')
        AND uas.branch_id = ?
        AND uas.active_status = 1
        AND au.is_blocked = 0
        AND au.email NOT LIKE '%example.com'
        AND au.email NOT LIKE 'test.demo%'`,
    [branchId],
  );
  return (rows as Array<{ email: string }>).map((r) => r.email).filter(Boolean);
}

const CELEBRATION_SELECT = `
  SELECT e.id, e.full_name, e.official_email, e.email,
         e.avatar_url, e.branch_id, e.date_of_joining,
         e.gender, e.blood_group, e.band, e.employee_code,
         COALESCE(bm.display_name, bm.branch_name) AS branch_display,
         dm.designation_name,
         NULL AS dept_name,
         pm.process_name,
         mgr.full_name AS manager_name
    FROM employees e
    LEFT JOIN branch_master bm      ON bm.id  = e.branch_id
    LEFT JOIN designation_master dm ON dm.id  = e.designation_id
    LEFT JOIN process_master pm     ON pm.id  = e.process_id
    LEFT JOIN employees mgr         ON mgr.id = e.reporting_manager_id`;

// Same shape as CELEBRATION_SELECT but with years_completed added to the
// column list (not appended after the FROM/JOIN clauses, which produced
// invalid SQL — see queryTodayAnniversaries).
const CELEBRATION_SELECT_WITH_TENURE = `
  SELECT e.id, e.full_name, e.official_email, e.email,
         e.avatar_url, e.branch_id, e.date_of_joining,
         e.gender, e.blood_group, e.band, e.employee_code,
         COALESCE(bm.display_name, bm.branch_name) AS branch_display,
         dm.designation_name,
         NULL AS dept_name,
         pm.process_name,
         mgr.full_name AS manager_name,
         TIMESTAMPDIFF(YEAR, e.date_of_joining, CURDATE()) AS years_completed
    FROM employees e
    LEFT JOIN branch_master bm      ON bm.id  = e.branch_id
    LEFT JOIN designation_master dm ON dm.id  = e.designation_id
    LEFT JOIN process_master pm     ON pm.id  = e.process_id
    LEFT JOIN employees mgr         ON mgr.id = e.reporting_manager_id`;

export async function queryTodayBirthdays(): Promise<CelebrationEmployee[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `${CELEBRATION_SELECT}
      WHERE e.active_status = 1
        AND e.date_of_birth IS NOT NULL
        AND MONTH(e.date_of_birth) = MONTH(CURDATE())
        AND DAY(e.date_of_birth)   = DAY(CURDATE())`,
  );
  return rows as CelebrationEmployee[];
}

export async function queryTodayAnniversaries(): Promise<CelebrationEmployee[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `${CELEBRATION_SELECT_WITH_TENURE}
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

function uniqueEmails(...lists: (string | null | undefined)[][]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const list of lists) {
    for (const e of list) {
      if (e && !seen.has(e)) {
        seen.add(e);
        result.push(e);
      }
    }
  }
  return result;
}

export async function sendBirthdayGreeting(emp: CelebrationEmployee): Promise<void> {
  if (await hasCelebrationPostToday(emp.id, "birthday")) return;

  const photoUrl = resolvePhotoUrl(emp.avatar_url);
  const name = emp.full_name?.trim() || "Colleague";
  const firstName = name.split(" ")[0];
  const branch = emp.branch_display ?? undefined;

  const toEmail = emp.official_email;
  if (toEmail) {
    try {
      const [adminEmails, branchHrEmails] = await Promise.all([
        resolveAdminBccEmails(),
        resolveBranchHrBccEmails(emp.branch_id),
      ]);
      const bccEmails = uniqueEmails(
        [emp.email],
        branchHrEmails,
        adminEmails,
      ).filter((e) => e !== toEmail);

      await emailService.send({
        to: toEmail,
        bcc: bccEmails.length ? bccEmails.join(",") : undefined,
        subject: `🎂 Happy Birthday, ${firstName} (${emp.employee_code})! 🎉`,
        html: birthdayGreetingEmail({
          employeeName: name,
          firstName,
          photoUrl,
          branchName: branch,
          designation: emp.designation_name ?? undefined,
          department: emp.dept_name ?? undefined,
          processName: emp.process_name ?? undefined,
          gender: emp.gender ?? undefined,
          bloodGroup: emp.blood_group ?? undefined,
          managerName: emp.manager_name ?? undefined,
          employeeCode: emp.employee_code ?? undefined,
        }),
      });
    } catch (err) {
      console.error(`[celebration] Birthday email failed for ${emp.id}:`, err);
    }
  }

  const sysUserId = await resolveSystemUserId();
  if (!sysUserId) {
    console.warn("[celebration] No system user — skipping feed post for birthday:", emp.id);
    return;
  }

  const branchTag = branch ? ` The ${branch} family is celebrating with you today! 🥳` : "";
  const masidTag = emp.employee_code ? ` [${emp.employee_code}]` : "";
  const contentText = `🎂 Wishing ${name}${masidTag} a very Happy Birthday! 🎉${branchTag} May your day be filled with joy, laughter, and everything wonderful! 🌸🎈🎁`;

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
  const firstName = name.split(" ")[0];
  const branch = emp.branch_display ?? undefined;
  const years = Number(emp.years_completed ?? 1);

  const joinDateDisplay = emp.date_of_joining
    ? new Date(emp.date_of_joining).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";

  const toEmail = emp.official_email;
  if (toEmail) {
    try {
      const [adminEmails, branchHrEmails] = await Promise.all([
        resolveAdminBccEmails(),
        resolveBranchHrBccEmails(emp.branch_id),
      ]);
      const bccEmails = uniqueEmails(
        [emp.email],
        branchHrEmails,
        adminEmails,
      ).filter((e) => e !== toEmail);

      await emailService.send({
        to: toEmail,
        bcc: bccEmails.length ? bccEmails.join(",") : undefined,
        subject: `⭐ Happy ${years}-Year Work Anniversary, ${firstName} (${emp.employee_code})!`,
        html: workAnniversaryEmail({
          employeeName: name,
          firstName,
          yearsCompleted: years,
          joinDate: joinDateDisplay,
          photoUrl,
          branchName: branch,
          designation: emp.designation_name ?? undefined,
          department: emp.dept_name ?? undefined,
          processName: emp.process_name ?? undefined,
          gender: emp.gender ?? undefined,
          band: emp.band ?? undefined,
          managerName: emp.manager_name ?? undefined,
          employeeCode: emp.employee_code ?? undefined,
        }),
      });
    } catch (err) {
      console.error(`[celebration] Anniversary email failed for ${emp.id}:`, err);
    }
  }

  const sysUserId = await resolveSystemUserId();
  if (!sysUserId) {
    console.warn("[celebration] No system user — skipping feed post for anniversary:", emp.id);
    return;
  }

  const yearLabel = years === 1 ? "year" : "years";
  const branchTag = branch ? ` The entire ${branch} team is proud of you!` : "";
  const masidTag = emp.employee_code ? ` [${emp.employee_code}]` : "";
  const contentText = `🌟 Congratulations ${name}${masidTag} on completing ${years} wonderful ${yearLabel} with MAS Callnet! 🏆${branchTag} Your dedication, consistency, and contributions inspire everyone around you. Thank you for being an incredible part of our family! ✨`;

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
