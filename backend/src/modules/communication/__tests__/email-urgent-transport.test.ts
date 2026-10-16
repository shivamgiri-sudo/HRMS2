import { describe, it, expect, vi, beforeEach } from "vitest";

const created: Array<Record<string, unknown>> = [];
vi.mock("nodemailer", () => ({
  default: {
    createTransport: (opts: Record<string, unknown>) => {
      created.push(opts);
      return { sendMail: async () => ({ messageId: "<x@y>" }), close: () => {} };
    },
  },
}));

beforeEach(() => {
  created.length = 0;
  process.env.SMTP_HOST = "smtp.test"; process.env.SMTP_PORT = "587";
  process.env.SMTP_USER = "u@test"; process.env.SMTP_PASS = "pw"; process.env.SMTP_FROM = "u@test";
});

describe("urgent sends skip the bulk throttle queue", () => {
  it("uses an unthrottled transporter with timeouts for urgent mail", async () => {
    const { emailService, resetTransporter } = await import("../email.service.js");
    resetTransporter();
    await emailService.send({ to: "a@b.c", subject: "s", html: "<p>x</p>", urgent: true });
    const o = created[created.length - 1]!;
    expect(o.rateLimit).toBeUndefined();
    expect(o.socketTimeout).toBe(20_000);
  });

  it("keeps the throttle for normal mail", async () => {
    const { emailService, resetTransporter } = await import("../email.service.js");
    resetTransporter();
    await emailService.send({ to: "a@b.c", subject: "s", html: "<p>x</p>" });
    expect(created[created.length - 1]!.rateLimit).toBeGreaterThan(0);
  });
});
