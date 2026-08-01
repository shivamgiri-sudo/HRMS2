import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";

// Web Push — loaded lazily
let webpush: typeof import("web-push") | null = null;
try {
  webpush = (await import("web-push")).default as unknown as typeof import("web-push");
  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidEmail = process.env.VAPID_EMAIL;
  if (vapidPublic && vapidPrivate && vapidEmail) {
    webpush.setVapidDetails(`mailto:${vapidEmail}`, vapidPublic, vapidPrivate);
  } else {
    webpush = null;
  }
} catch {
  webpush = null;
}

interface PushSubscription extends RowDataPacket {
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

interface MeetingInfo {
  id: string;
  title: string;
  meeting_type: string;
  start_at: Date;
  mcnmeet_join_url: string;
  host_employee_id: string;
}

interface InviteeInfo extends RowDataPacket {
  employee_id: string;
  employee_name: string;
  email: string | null;
}

export async function notifyMeetingCreated(meetingId: string): Promise<void> {
  if (!env.MCNMEET_ENABLED) return;

  try {
    const [meetings] = await db.execute<(MeetingInfo & RowDataPacket)[]>(
      `SELECT id, title, meeting_type, start_at, mcnmeet_join_url, host_employee_id FROM mcnmeet_meeting WHERE id = ?`,
      [meetingId]
    );
    if (!meetings.length) return;
    const meeting = meetings[0];

    const [invitees] = await db.execute<InviteeInfo[]>(
      `SELECT i.employee_id, CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) as employee_name, e.email
       FROM mcnmeet_meeting_invitee i
       LEFT JOIN employees e ON i.employee_id = e.id
       WHERE i.meeting_id = ?`,
      [meetingId]
    );

    const startTime = new Date(meeting.start_at).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true,
    });

    const title = `New Meeting: ${meeting.title}`;
    const body = `You're invited to "${meeting.title}" on ${startTime}`;

    for (const invitee of invitees) {
      await sendPushToUser(invitee.employee_id, title, body, {
        type: "mcnmeet_invite",
        meetingId: meeting.id,
        url: `/meetings`,
      });
    }

    console.log(`[mcnmeet-notify] Sent ${invitees.length} push notifications for meeting created: ${meetingId}`);
  } catch (err) {
    console.error("[mcnmeet-notify] notifyMeetingCreated error:", err);
  }
}

export async function notifyMeetingCancelled(meetingId: string, reason: string): Promise<void> {
  if (!env.MCNMEET_ENABLED) return;

  try {
    const [meetings] = await db.execute<(MeetingInfo & RowDataPacket)[]>(
      `SELECT id, title FROM mcnmeet_meeting WHERE id = ?`,
      [meetingId]
    );
    if (!meetings.length) return;
    const meeting = meetings[0];

    const [invitees] = await db.execute<InviteeInfo[]>(
      `SELECT i.employee_id FROM mcnmeet_meeting_invitee i WHERE i.meeting_id = ?`,
      [meetingId]
    );

    const title = `Meeting Cancelled: ${meeting.title}`;
    const body = reason ? `Reason: ${reason.slice(0, 100)}` : "The meeting has been cancelled";

    for (const invitee of invitees) {
      await sendPushToUser(invitee.employee_id, title, body, {
        type: "mcnmeet_cancelled",
        meetingId: meeting.id,
      });
    }

    console.log(`[mcnmeet-notify] Sent ${invitees.length} cancellation notifications for meeting: ${meetingId}`);
  } catch (err) {
    console.error("[mcnmeet-notify] notifyMeetingCancelled error:", err);
  }
}

export async function notifyMeetingStartingSoon(meetingId: string): Promise<void> {
  if (!env.MCNMEET_ENABLED) return;

  try {
    const [meetings] = await db.execute<(MeetingInfo & RowDataPacket)[]>(
      `SELECT id, title, mcnmeet_join_url FROM mcnmeet_meeting WHERE id = ?`,
      [meetingId]
    );
    if (!meetings.length) return;
    const meeting = meetings[0];

    const [invitees] = await db.execute<InviteeInfo[]>(
      `SELECT i.employee_id FROM mcnmeet_meeting_invitee i
       WHERE i.meeting_id = ? AND i.joined_status = 'not_joined'`,
      [meetingId]
    );

    const title = `Starting Soon: ${meeting.title}`;
    const body = "Meeting starts in 15 minutes. Click to join.";

    for (const invitee of invitees) {
      await sendPushToUser(invitee.employee_id, title, body, {
        type: "mcnmeet_reminder",
        meetingId: meeting.id,
        url: meeting.mcnmeet_join_url,
      });
    }

    console.log(`[mcnmeet-notify] Sent ${invitees.length} reminder notifications for meeting: ${meetingId}`);
  } catch (err) {
    console.error("[mcnmeet-notify] notifyMeetingStartingSoon error:", err);
  }
}

export async function notifyRecordingAvailable(meetingId: string, recordingUrl: string): Promise<void> {
  if (!env.MCNMEET_ENABLED) return;

  try {
    const [meetings] = await db.execute<(MeetingInfo & RowDataPacket)[]>(
      `SELECT id, title FROM mcnmeet_meeting WHERE id = ?`,
      [meetingId]
    );
    if (!meetings.length) return;
    const meeting = meetings[0];

    // Notify only those who attended
    const [invitees] = await db.execute<InviteeInfo[]>(
      `SELECT i.employee_id FROM mcnmeet_meeting_invitee i
       WHERE i.meeting_id = ? AND i.joined_status IN ('joined', 'late')`,
      [meetingId]
    );

    const title = `Recording Available: ${meeting.title}`;
    const body = "The meeting recording is now available to view.";

    for (const invitee of invitees) {
      await sendPushToUser(invitee.employee_id, title, body, {
        type: "mcnmeet_recording",
        meetingId: meeting.id,
        url: `/meetings`,
      });
    }

    console.log(`[mcnmeet-notify] Sent ${invitees.length} recording notifications for meeting: ${meetingId}`);
  } catch (err) {
    console.error("[mcnmeet-notify] notifyRecordingAvailable error:", err);
  }
}

async function sendPushToUser(userId: string, title: string, body: string, data?: Record<string, string>): Promise<void> {
  if (!webpush) return;

  try {
    const [subs] = await db.execute<PushSubscription[]>(
      `SELECT endpoint, p256dh, auth_key FROM push_subscriptions WHERE user_id = ?`,
      [userId]
    );

    const payload = JSON.stringify({ title, body, data });

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          payload
        );
      } catch (err: any) {
        // 410 Gone = subscription expired; remove it
        if (err?.statusCode === 410) {
          await db.execute(`DELETE FROM push_subscriptions WHERE endpoint = ?`, [sub.endpoint]).catch(() => {});
        }
      }
    }
  } catch {
    // Push is best-effort
  }
}

// Cron helper: find meetings starting in 15 minutes and send reminders
export async function sendUpcomingMeetingReminders(): Promise<number> {
  if (!env.MCNMEET_ENABLED) return 0;

  try {
    // Find meetings starting in 14-16 minutes from now (to allow cron jitter)
    const [meetings] = await db.execute<(MeetingInfo & RowDataPacket)[]>(
      `SELECT id, title, mcnmeet_join_url FROM mcnmeet_meeting
       WHERE status = 'scheduled'
       AND start_at BETWEEN DATE_ADD(NOW(), INTERVAL 14 MINUTE) AND DATE_ADD(NOW(), INTERVAL 16 MINUTE)`,
      []
    );

    for (const meeting of meetings) {
      await notifyMeetingStartingSoon(meeting.id);
    }

    return meetings.length;
  } catch (err) {
    console.error("[mcnmeet-notify] sendUpcomingMeetingReminders error:", err);
    return 0;
  }
}
