import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn();
vi.mock("nodemailer", () => ({ default: { createTransport: vi.fn(() => ({ sendMail, close: vi.fn(), verify: vi.fn() })) } }));

const LIMIT = Object.assign(new Error("Data command failed: 550-5.4.5 Daily user sending limit exceeded."), { responseCode: 550 });

async function load() {
  vi.resetModules();
  process.env.SMTP_HOST = "smtp.test"; process.env.SMTP_PORT = "587"; process.env.SMTP_USER = "hrms@x.com";
  process.env.SMTP_PASS = "pw"; process.env.SMTP_FROM = "hrms@x.com";
  process.env.CAREERS_SMTP_ACCOUNTS = "c1@x.com,c2@x.com"; process.env.CAREERS_SMTP_PASS = "careers-pw";
  return import("../email.service.js");
}
const mail = { to: "cand@x.com", subject: "s", html: "<p>h</p>" };

describe("careers mailbox pool", () => {
  beforeEach(() => { sendMail.mockReset(); sendMail.mockResolvedValue({ messageId: "m" }); });

  it("round-robins and sends from the careers address", async () => {
    const { emailService } = await load();
    await emailService.send({ ...mail, pool: "careers" });
    await emailService.send({ ...mail, pool: "careers" });
    const froms = sendMail.mock.calls.map((c) => c[0].from);
    expect(froms[0]).toContain("c1@x.com");
    expect(froms[1]).toContain("c2@x.com");
  });

  it("parks a mailbox at its daily limit and moves to the next one", async () => {
    const { emailService } = await load();
    sendMail.mockRejectedValueOnce(LIMIT);
    await emailService.send({ ...mail, pool: "careers" });
    expect(sendMail).toHaveBeenCalledTimes(2);
    await emailService.send({ ...mail, pool: "careers" });
    expect(sendMail.mock.calls[2][0].from).toContain("c2@x.com");
  });

  it("throws EmailQuotaError without touching SMTP once every mailbox is parked", async () => {
    const { emailService, EmailQuotaError } = await load();
    sendMail.mockRejectedValue(LIMIT);
    await expect(emailService.send({ ...mail, pool: "careers" })).rejects.toBeInstanceOf(EmailQuotaError);
    const calls = sendMail.mock.calls.length;
    await expect(emailService.send({ ...mail, pool: "careers" })).rejects.toBeInstanceOf(EmailQuotaError);
    expect(sendMail.mock.calls.length).toBe(calls);
    expect(emailService.canSend("careers")).toBe(false);
  });

  it("default account trips its own breaker and does not use the careers pool", async () => {
    const { emailService, EmailQuotaError } = await load();
    sendMail.mockRejectedValueOnce(LIMIT);
    await expect(emailService.send(mail)).rejects.toBeInstanceOf(EmailQuotaError);
    await expect(emailService.send(mail)).rejects.toBeInstanceOf(EmailQuotaError);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(emailService.canSend("careers")).toBe(true);
  });
});

describe("careers pool - login failures", () => {
  it("falls back to the default account when every careers mailbox rejects the login", async () => {
    const { emailService } = await load();
    const AUTH = Object.assign(new Error("Invalid login: 535 5.7.8"), { responseCode: 535, code: "EAUTH" });
    sendMail.mockReset();
    sendMail.mockImplementation(async (m: { from: string }) => { if (/c[12]@x\.com/.test(m.from)) throw AUTH; return { messageId: "default" }; });
    const r = await emailService.send({ ...mail, pool: "careers" });
    expect(r.messageId).toBe("default");
    expect(sendMail.mock.calls.at(-1)![0].from).toContain("hrms@x.com");
  });
});
