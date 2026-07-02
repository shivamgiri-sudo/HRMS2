import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import twilio from "twilio";
import type { Twilio } from "twilio";
import Handlebars from "handlebars";
import type { RowDataPacket } from "mysql2";

// Database connection (assume exists)
// import { db } from "../db/mysql.js";
// For now, we'll use a mock - replace with actual db import
let db: any;
try {
  const dbModule = await import("../db/mysql.js");
  db = dbModule.db;
} catch {
  console.warn("[NotificationService] Database module not found - notifications will fail");
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface NotificationTemplate {
  template_code: string;
  template_name: string;
  trigger_event: string;
  audience: string;
  channel: "email" | "sms" | "both";
  subject: string | null;
  body_template: string;
  sms_template: string | null;
  active_status: number;
}

export interface NotificationRecipient {
  type: "candidate" | "recruiter" | "hr";
  id?: string;
  email?: string;
  mobile?: string;
  name?: string;
}

export interface NotificationContext {
  [key: string]: string | number | null;
}

export interface SendNotificationInput {
  template_code: string;
  recipients: NotificationRecipient[];
  context: NotificationContext;
  channel?: "email" | "sms" | "both";
}

interface SmtpConfig {
  smtp_host: string;
  smtp_port: number;
  smtp_secure: number;
  smtp_user: string;
  smtp_pass: string;
  from_email: string;
  from_name: string;
}

interface SmsConfig {
  provider: string;
  account_sid?: string;
  auth_token?: string;
  from_number?: string;
  api_key?: string;
}

// ── Service Class ────────────────────────────────────────────────────────────

export class NotificationService {
  private emailTransporter: Transporter | null = null;
  private twilioClient: Twilio | null = null;
  private smtpConfig: SmtpConfig | null = null;
  private smsConfig: SmsConfig | null = null;

  /**
   * Initialize email transporter from database config
   */
  private async initEmailTransporter(): Promise<Transporter | null> {
    if (this.emailTransporter) return this.emailTransporter;

    try {
      const [rows] = await (db.execute(
        "SELECT * FROM smtp_config WHERE active_status = 1 ORDER BY id DESC LIMIT 1"
      ) as Promise<[RowDataPacket[], unknown]>);

      if (!rows || rows.length === 0) {
        console.warn("[NotificationService] No active SMTP config found");
        return null;
      }

      const config = rows[0] as SmtpConfig;
      this.smtpConfig = config;

      this.emailTransporter = nodemailer.createTransport({
        host: config.smtp_host,
        port: config.smtp_port,
        secure: config.smtp_secure === 1,
        auth: {
          user: config.smtp_user,
          pass: config.smtp_pass,
        },
      });

      // Verify connection
      await this.emailTransporter!.verify();
      console.log("[NotificationService] Email transporter initialized successfully");
      return this.emailTransporter;
    } catch (error: any) {
      console.error("[NotificationService] Failed to initialize email:", error.message);
      return null;
    }
  }

  /**
   * Initialize Twilio SMS client from database config
   */
  private async initSmsClient(): Promise<Twilio | null> {
    if (this.twilioClient) return this.twilioClient;

    try {
      const [rows] = await (db.execute(
        "SELECT * FROM sms_config WHERE active_status = 1 AND provider = 'twilio' ORDER BY id DESC LIMIT 1"
      ) as Promise<[RowDataPacket[], unknown]>);

      if (!rows || rows.length === 0) {
        console.warn("[NotificationService] No active Twilio config found");
        return null;
      }

      const config = rows[0] as SmsConfig;
      this.smsConfig = config;

      if (!config.account_sid || !config.auth_token) {
        console.warn("[NotificationService] Twilio credentials incomplete");
        return null;
      }

      this.twilioClient = twilio(config.account_sid, config.auth_token);
      console.log("[NotificationService] Twilio client initialized successfully");
      return this.twilioClient;
    } catch (error: any) {
      console.error("[NotificationService] Failed to initialize SMS:", error.message);
      return null;
    }
  }

  /**
   * Get template by code
   */
  private async getTemplate(templateCode: string): Promise<NotificationTemplate | null> {
    try {
      const [rows] = await (db.execute(
        "SELECT * FROM notification_template WHERE template_code = ? AND active_status = 1 LIMIT 1",
        [templateCode]
      ) as Promise<[RowDataPacket[], unknown]>);

      if (!rows || rows.length === 0) {
        console.warn(`[NotificationService] Template not found: ${templateCode}`);
        return null;
      }

      return rows[0] as NotificationTemplate;
    } catch (error: any) {
      console.error(`[NotificationService] Failed to fetch template ${templateCode}:`, error.message);
      return null;
    }
  }

  /**
   * Render template with Handlebars
   */
  private renderTemplate(template: string, context: NotificationContext): string {
    try {
      const compiled = Handlebars.compile(template);
      return compiled(context);
    } catch (error: any) {
      console.error("[NotificationService] Template render error:", error.message);
      return template; // Return unrendered on error
    }
  }

  /**
   * Send email
   */
  private async sendEmail(
    to: string,
    subject: string,
    body: string,
    logId: string
  ): Promise<boolean> {
    const transporter = await this.initEmailTransporter();
    if (!transporter || !this.smtpConfig) {
      await this.logNotificationStatus(logId, "failed", "SMTP not configured");
      return false;
    }

    try {
      await transporter.sendMail({
        from: `"${this.smtpConfig.from_name}" <${this.smtpConfig.from_email}>`,
        to,
        subject,
        text: body,
        html: body.replace(/\n/g, "<br>"),
      });

      await this.logNotificationStatus(logId, "sent");
      console.log(`[NotificationService] Email sent to ${to}`);
      return true;
    } catch (error: any) {
      await this.logNotificationStatus(logId, "failed", error.message);
      console.error(`[NotificationService] Email send failed to ${to}:`, error.message);
      return false;
    }
  }

  /**
   * Send SMS
   */
  private async sendSms(
    to: string,
    body: string,
    logId: string
  ): Promise<boolean> {
    const client = await this.initSmsClient();
    if (!client || !this.smsConfig?.from_number) {
      await this.logNotificationStatus(logId, "failed", "SMS not configured");
      return false;
    }

    try {
      await client.messages.create({
        body,
        from: this.smsConfig.from_number,
        to,
      });

      await this.logNotificationStatus(logId, "sent");
      console.log(`[NotificationService] SMS sent to ${to}`);
      return true;
    } catch (error: any) {
      await this.logNotificationStatus(logId, "failed", error.message);
      console.error(`[NotificationService] SMS send failed to ${to}:`, error.message);
      return false;
    }
  }

  /**
   * Log notification to database
   */
  private async createNotificationLog(
    templateCode: string,
    recipient: NotificationRecipient,
    channel: "email" | "sms",
    subject: string | null,
    body: string
  ): Promise<string> {
    try {
      const logId = crypto.randomUUID();
      await db.execute(
        `INSERT INTO notification_log
         (id, template_code, recipient_type, recipient_id, recipient_email, recipient_mobile, channel, subject, body, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
        [
          logId,
          templateCode,
          recipient.type,
          recipient.id || null,
          recipient.email || null,
          recipient.mobile || null,
          channel,
          subject,
          body,
        ]
      );
      return logId;
    } catch (error: any) {
      console.error("[NotificationService] Failed to create log:", error.message);
      return crypto.randomUUID(); // Return temp ID
    }
  }

  /**
   * Update notification log status
   */
  private async logNotificationStatus(
    logId: string,
    status: "sent" | "failed" | "bounced",
    errorMessage?: string
  ): Promise<void> {
    try {
      await db.execute(
        `UPDATE notification_log
         SET status = ?, error_message = ?, sent_at = IF(? = 'sent', NOW(), sent_at)
         WHERE id = ?`,
        [status, errorMessage || null, status, logId]
      );
    } catch (error: any) {
      console.error("[NotificationService] Failed to update log:", error.message);
    }
  }

  /**
   * Send notification (main public method)
   */
  async send(input: SendNotificationInput): Promise<{ sent: number; failed: number }> {
    const { template_code, recipients, context, channel } = input;

    // Get template
    const template = await this.getTemplate(template_code);
    if (!template) {
      console.error(`[NotificationService] Template ${template_code} not found`);
      return { sent: 0, failed: recipients.length };
    }

    // Determine channels
    const useEmail = (channel || template.channel) === "email" || (channel || template.channel) === "both";
    const useSms = (channel || template.channel) === "sms" || (channel || template.channel) === "both";

    let sent = 0;
    let failed = 0;

    // Send to each recipient
    for (const recipient of recipients) {
      // Email
      if (useEmail && recipient.email && template.subject && template.body_template) {
        const subject = this.renderTemplate(template.subject, context);
        const body = this.renderTemplate(template.body_template, context);
        const logId = await this.createNotificationLog(template_code, recipient, "email", subject, body);
        const success = await this.sendEmail(recipient.email, subject, body, logId);
        if (success) sent++;
        else failed++;
      }

      // SMS
      if (useSms && recipient.mobile && template.sms_template) {
        const smsBody = this.renderTemplate(template.sms_template, context);
        const logId = await this.createNotificationLog(template_code, recipient, "sms", null, smsBody);
        const success = await this.sendSms(recipient.mobile, smsBody, logId);
        if (success) sent++;
        else failed++;
      }
    }

    console.log(`[NotificationService] Template ${template_code}: sent=${sent}, failed=${failed}`);
    return { sent, failed };
  }
}

// ── Singleton Export ─────────────────────────────────────────────────────────

export const notificationService = new NotificationService();
