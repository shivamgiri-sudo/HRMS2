/** Invitation page for invite tokens: pure model + static markup (node env). Taps and navigation need the live check. */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClosedOpeningCard, RsvpCard, StopConfirmCard, StopLink, StoppedCard } from "../InvitationParts";
import { answerErrorText, nextTokenAfterAnswer, pageMode, preAnswer } from "../invitationModel";

const noop = () => undefined;
const rsvp = (o: Partial<React.ComponentProps<typeof RsvpCard>> = {}) =>
  renderToStaticMarkup(<RsvpCard firstName="Asha" state="invited" picked={null} answered={null} showOptions busy={false} error={null} onPick={noop} onSend={noop} onChange={noop} {...o} />);

describe("invitation model", () => {
  it("reads ?a= including stop", () => {
    expect(preAnswer("yes")).toBe("yes");
    expect(preAnswer("stop")).toBe("stop");
    expect(preAnswer("maybe")).toBeNull();
    expect(preAnswer(null)).toBeNull();
  });
  it("switches to the booked match token after a Yes on an invite token", () => {
    const cur = "b".repeat(32);
    expect(nextTokenAfterAnswer(cur, { matchToken: "c".repeat(32) })).toBe("c".repeat(32));
    expect(nextTokenAfterAnswer(cur, { matchToken: cur })).toBeNull();
    expect(nextTokenAfterAnswer(cur, {})).toBeNull();
    expect(nextTokenAfterAnswer(cur, { matchToken: "../x" })).toBeNull();
  });
  it("page modes", () => {
    expect(pageMode({ kind: "invite", rsvpOpen: true, open: false, closedReason: null }, false)).toBe("answer");
    expect(pageMode({ kind: "invite", rsvpOpen: false, open: false, closedReason: "This opening is closed" }, false)).toBe("closed_opening");
    expect(pageMode({ kind: "invite", rsvpOpen: false, open: false, state: "stopped" }, false)).toBe("stopped");
    expect(pageMode({ rsvpOpen: true, open: false }, true)).toBe("stopped");
    expect(pageMode({ rsvpOpen: false, open: false, state: "confirmed" }, false)).toBe("booked");
  });
  it("error texts", () => {
    expect(answerErrorText(403)).toMatch(/passed/);
    expect(answerErrorText(500)).toMatch(/try again/);
    expect(answerErrorText(429)).toBe("We are still saving your last answer. Please wait a minute and try again.");
  });
});

describe("invite token page parts", () => {
  it("shows the three answers and the stop link", () => {
    const html = rsvp() + renderToStaticMarkup(<StopLink onPick={noop} />);
    expect(html).toContain("Yes, I will come");
    expect(html).toContain("I need another time");
    expect(html).toContain("I cannot come");
    expect(html).toContain("Stop messages about this job");
    expect((html.match(/role="radio"/g) ?? []).length).toBe(3);
  });
  it("after Yes it shows the confirmed card", () => {
    const html = rsvp({ answered: "yes", showOptions: false });
    expect(html).toContain("The branch will expect you");
    expect(html).toContain("Change my answer");
  });
  it("stop asks once more, then says no more messages", () => {
    const c = renderToStaticMarkup(<StopConfirmCard busy={false} error={null} onConfirm={noop} onCancel={noop} />);
    expect(c).toContain("Yes, stop messages");
    expect(c).toContain("Keep my invitation");
    expect(renderToStaticMarkup(<StoppedCard />)).toContain("You will not get more messages");
  });
  it("closed opening says so with no buttons", () => {
    const c = renderToStaticMarkup(<ClosedOpeningCard />);
    expect(c).toContain("This opening is closed");
    expect(c).not.toContain("<button");
  });
});
