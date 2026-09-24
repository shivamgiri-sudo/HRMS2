/**
 * The Resend appointment letter dialog: validation states.
 *
 * No jsdom in this suite, so the form is rendered with react-dom/server for each
 * state, and the rules behind it are tested directly.
 */
import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import fs from "fs";
import path from "path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ResendLetterForm, CONFIRMATION_LINE, emptyResendForm, type OnFileAddress,
} from "./ResendLetterDialog";
import { addressProblem, validateResendForm, type ResendFormState } from "@/lib/appointmentLetterResend";

const onFile: OnFileAddress[] = [
  { kind: "personal", masked: "h***@e***.com" },
  { kind: "official", masked: "h***@m***.in" },
];
const REASON = "Employee lost access to the old inbox";

function render(state: ResendFormState, extra: Partial<React.ComponentProps<typeof ResendLetterForm>> = {}) {
  return renderToStaticMarkup(
    React.createElement(ResendLetterForm, {
      onFile, state, touched: { addresses: [], reason: false },
      onChange: vi.fn(), onTouch: vi.fn(), onSubmit: vi.fn(), onCancel: vi.fn(),
      ...extra,
    }),
  );
}
const sendDisabled = (html: string) => /<button[^>]*disabled=""[^>]*type="submit"|<button[^>]*type="submit"[^>]*disabled=""/.test(html);

describe("validateResendForm", () => {
  it("on-file needs nothing and sends no recipients (the one-click path)", () => {
    expect(validateResendForm({ mode: "onfile", addresses: [""], reason: "" })).toMatchObject({ valid: true, recipients: [] });
  });

  it("custom needs an address and a reason of 8+ characters", () => {
    expect(validateResendForm({ mode: "custom", addresses: [""], reason: "" }).valid).toBe(false);
    expect(validateResendForm({ mode: "custom", addresses: ["a@x.com"], reason: "short" })).toMatchObject({
      valid: false, reasonError: expect.stringMatching(/at least 8/),
    });
    expect(validateResendForm({ mode: "custom", addresses: ["bad"], reason: REASON })).toMatchObject({
      valid: false, addressErrors: ["Enter a valid email address."],
    });
  });

  it("normalises and returns the recipients when valid; blank extra rows are ignored", () => {
    expect(validateResendForm({ mode: "custom", addresses: [" Jane@Gmail.com ", ""], reason: REASON })).toMatchObject({
      valid: true, recipients: ["jane@gmail.com"],
    });
  });

  it("flags duplicates on the second occurrence", () => {
    const v = validateResendForm({ mode: "custom", addresses: ["a@x.com", "A@x.com"], reason: REASON });
    expect(v.valid).toBe(false);
    expect(v.addressErrors).toEqual([null, "This address is already listed."]);
  });

  it.each(["a@x.com,b@x.com", "a b@x.com", "a@x", "<a@x.com>", "a@x.com\r\nBcc:e@evil.com"])("rejects %j", (bad) => {
    expect(addressProblem(bad)).not.toBeNull();
  });

  it("enforces 254 characters", () => {
    expect(addressProblem(`${"a".repeat(250)}@x.com`)).toMatch(/254/);
  });
});

describe("ResendLetterForm — states", () => {
  it("defaults to the on-file option: masked addresses shown, no input or reason, Send enabled", () => {
    const html = render(emptyResendForm(true));
    expect(html).toContain("h***@e***.com (personal)");
    expect(html).toContain("h***@m***.in (official)");
    expect(html).toContain("Another email address…");
    expect(html).not.toContain('type="email"');
    expect(html).not.toContain("resend-reason");
    expect(html).toContain(CONFIRMATION_LINE.replace("'", "&#x27;"));
    expect(sendDisabled(html)).toBe(false);
  });

  it("custom mode reveals the address input and a required reason; Send is disabled until valid", () => {
    const html = render({ mode: "custom", addresses: [""], reason: "" });
    expect(html).toContain('type="email"');
    expect(html).toContain("resend-reason");
    expect(html).toContain("Required (at least 8 characters)");
    expect(html).toContain("Add another address");
    expect(sendDisabled(html)).toBe(true);
    expect(html).not.toContain('role="alert"'); // a fresh form is not shouted at
  });

  it("shows inline errors for a typed-but-invalid address and a too-short reason", () => {
    const html = render({ mode: "custom", addresses: ["not-an-email"], reason: "short" });
    expect(html).toContain("Enter a valid email address.");
    expect(html).toContain("Give a reason of at least 8 characters.");
    expect(sendDisabled(html)).toBe(true);
  });

  it("shows 'required' for a field the user has left empty", () => {
    const html = render({ mode: "custom", addresses: [""], reason: "" }, { touched: { addresses: [true], reason: true } });
    expect(html).toContain("Enter an email address.");
    expect(html).toContain("Give a reason of at least 8 characters.");
  });

  it("enables Send once the address and reason are valid", () => {
    expect(sendDisabled(render({ mode: "custom", addresses: ["jane@gmail.com"], reason: REASON }))).toBe(false);
  });

  it("stops offering 'Add another address' at three rows and allows removing extra rows", () => {
    const three = render({ mode: "custom", addresses: ["a@x.com", "b@x.com", "c@x.com"], reason: REASON });
    expect(three).not.toContain("Add another address");
    expect(three).toContain("Remove email address 2");
    expect(three).toContain("Remove email address 3");
    expect(three).not.toContain("Remove email address 1");
  });

  it("flags a duplicate row", () => {
    expect(render({ mode: "custom", addresses: ["a@x.com", "a@x.com"], reason: REASON })).toContain("This address is already listed.");
  });

  it("with no address on record, the on-file option is disabled", () => {
    const html = render(emptyResendForm(false), { onFile: [] });
    expect(html).toContain("No email address is saved for this employee");
    expect(html).toContain('type="email"'); // custom is preselected
  });

  it("disables Send while sending or loading, and shows the API error verbatim", () => {
    expect(sendDisabled(render(emptyResendForm(true), { sending: true }))).toBe(true);
    expect(sendDisabled(render(emptyResendForm(true), { loading: true }))).toBe(true);
    const html = render(emptyResendForm(true), { apiError: "This letter has already been resent 5 times in the last hour. Please wait before trying again." });
    expect(html).toContain("This letter has already been resent 5 times in the last hour. Please wait before trying again.");
  });
});

describe("ResendLetterDialog wiring", () => {
  const dialog = fs.readFileSync(path.resolve(__dirname, "ResendLetterDialog.tsx"), "utf8");
  const page = fs.readFileSync(path.resolve(__dirname, "../../pages/NativeAppointmentLetterQueue.tsx"), "utf8");

  it("is a shadcn Dialog titled 'Resend appointment letter'", () => {
    expect(dialog).toContain('from "@/components/ui/dialog"');
    expect(dialog).toContain("<DialogTitle>Resend appointment letter</DialogTitle>");
  });

  it("the on-file option posts an empty body; a custom send posts recipients and reason", () => {
    expect(dialog).toContain('state.mode === "custom" ? { recipients: v.recipients, reason: state.reason.trim() } : {}');
    expect(dialog).toContain("/resend-link");
    expect(dialog).toContain("/resend-options");
  });

  it("the queue opens the dialog instead of a native confirm, and shows the resend history", () => {
    expect(page).toContain("<ResendLetterDialog");
    expect(page).not.toContain("window.confirm");
    expect(page).toContain("Resend history");
    expect(page).toContain("Reason: {h.reason}");
  });
});
