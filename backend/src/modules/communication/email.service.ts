import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import { env } from "../../config/env.js";

export type EmailSendInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

function smtpSecure(): boolean {
  const explicit = String(process.env.SMTP_SECURE || "").trim().toLowerCase();
  if (["true", "1", "yes"].includes(explicit)) return true;
  if (["false", "0", "no"].includes(explicit)) return false;
  return Number(env.SMTP_PORT) === 465;
}

function fromAddress(): string {
  const name = String(process.env.SMTP_FROM_NAME || "MAS Callnet HRMS").trim().replace(/"/g, "");
  const from = String(env.SMTP_FROM || env.SMTP_USER || "noreply@mascallnet.com").trim();
  return name ? `"${name}" <${from}>` : from;
}

function smtpPassword(): string {
  // Gmail/Google Workspace app passwords are often copied with spaces.
  // SMTP requires the continuous 16-character value.
  return String(env.SMTP_PASS || "").replace(/\s+/g, "");
}

function createTransporter() {
  const options: SMTPTransport.Options = {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: smtpSecure(),
  };

  const pass = smtpPassword();
  if (env.SMTP_USER && pass) {
    options.auth = {
      user: env.SMTP_USER,
      pass,
    };
  }

  return nodemailer.createTransport(options);
}

export const emailService = {
  isConfigured(): boolean {
    return Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_FROM && env.SMTP_USER && smtpPassword());
  },

  safeConfig() {
    return {
      configured: this.isConfigured(),
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: smtpSecure(),
      userConfigured: Boolean(env.SMTP_USER),
      passConfigured: Boolean(smtpPassword()),
      from: env.SMTP_FROM,
      fromName: process.env.SMTP_FROM_NAME || "MAS Callnet HRMS",
    };
  },

  async verify(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    const transporter = createTransporter();
    await transporter.verify();
    return true;
  },

  async send(input: EmailSendInput): Promise<{ messageId?: string }> {
    if (!this.isConfigured()) {
      throw new Error("SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM.");
    }

    const transporter = createTransporter();
    const result = await transporter.sendMail({
      from: fromAddress(),
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });

    return { messageId: result.messageId };
  },
};
