import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import axios from "axios";
import {
  PinbotWhatsAppProvider,
  sanitizeTemplateParam,
  toMsisdn,
} from "../providers/whatsapp/pinbot.provider.js";

vi.mock("axios");

const post = vi.mocked(axios.post);

beforeEach(() => {
  process.env.PINBOT_API_KEY = "key-123";
  process.env.PINBOT_PHONE_NUMBER_ID = "555";
});

afterEach(() => {
  delete process.env.PINBOT_API_KEY;
  delete process.env.PINBOT_PHONE_NUMBER_ID;
  vi.clearAllMocks();
});

describe("PinbotWhatsAppProvider", () => {
  it("is not configured without key and phone number id", () => {
    delete process.env.PINBOT_PHONE_NUMBER_ID;
    expect(new PinbotWhatsAppProvider().isConfigured()).toBe(false);
  });

  it("does not call the network when unconfigured", async () => {
    delete process.env.PINBOT_API_KEY;
    const res = await new PinbotWhatsAppProvider().sendTemplate("9999999999", "t", []);
    expect(res.success).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it("posts an approved template with ordered body params and the apikey header", async () => {
    post.mockResolvedValue({ status: 200, data: { messages: [{ id: "wamid.1" }] } });

    const res = await new PinbotWhatsAppProvider().sendTemplate(
      "9999746258",
      "interview_invitation",
      ["Asha", "3 October 2026", "11:30 AM", "Noida", "https://bmi.example"],
    );

    expect(res).toEqual({ success: true, message_id: "wamid.1" });
    const [url, body, config] = post.mock.calls[0] as [string, any, any];
    expect(url).toBe("https://partnersv1.pinbot.ai/v3/555/messages");
    expect(config.headers.apikey).toBe("key-123");
    expect(body.to).toBe("919999746258");
    expect(body.template.name).toBe("interview_invitation");
    expect(body.template.components[0].parameters.map((p: any) => p.text)).toEqual([
      "Asha", "3 October 2026", "11:30 AM", "Noida", "https://bmi.example",
    ]);
  });

  it("reports a provider error instead of success when no message id comes back", async () => {
    post.mockResolvedValue({ status: 401, data: { error: { message: "invalid apikey" } } });
    const res = await new PinbotWhatsAppProvider().sendTemplate("9999746258", "t", []);
    expect(res).toEqual({ success: false, error: "invalid apikey" });
  });
});

describe("toMsisdn", () => {
  it("prefixes 91 on bare 10-digit numbers and strips formatting", () => {
    expect(toMsisdn("99997 46258")).toBe("919999746258");
    expect(toMsisdn("+91 9999746258")).toBe("919999746258");
    expect(toMsisdn("whatsapp:+919999746258")).toBe("919999746258");
  });
});

describe("template parameter sanitising (#132018)", () => {
  it("turns a multi-line address into one line", () => {
    expect(
      sanitizeTemplateParam("Gate No. 01, F-15, Jal Darshan Commercial Building,\nAshram Road, Near Bank of Baroda,\nOpp. Old Natraj Theatre,\nAhmedabad, Gujarat – 380006"),
    ).toBe("Gate No. 01, F-15, Jal Darshan Commercial Building, Ashram Road, Near Bank of Baroda, Opp. Old Natraj Theatre, Ahmedabad, Gujarat – 380006");
  });

  it("removes tabs and long space runs, trims, and never returns an empty parameter", () => {
    expect(sanitizeTemplateParam("a\t\tb      c  ")).toBe("a b c");
    expect(sanitizeTemplateParam("  \n ")).toBe("-");
    expect(sanitizeTemplateParam("")).toBe("-");
  });

  it("sends sanitised values in the template body", async () => {
    post.mockResolvedValue({ status: 200, data: { messages: [{ id: "wamid.2" }] } });
    await new PinbotWhatsAppProvider().sendTemplate("9999746258", "t", ["Ravi", "line1\nline2"]);
    const body = post.mock.calls[0]![1] as { template: { components: Array<{ parameters: Array<{ text: string }> }> } };
    expect(body.template.components[0]!.parameters.map((p) => p.text)).toEqual(["Ravi", "line1, line2"]);
  });
});
