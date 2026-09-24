/**
 * Issued-letter row buttons, the drawer's copy toggle and the accepted-copy
 * summary. No jsdom in this suite, so each is rendered with react-dom/server.
 */
import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AcceptedCopySummary, IssuedDownloadButtons, LetterCopyToggle, formatAcceptedAt, shortHash,
} from "./SignedCopyControls";

const el = (C: React.ElementType, props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(C, props));
const HASH = "ab12cd34ef56".padEnd(64, "0");
type ClickEl = React.ReactElement<{ onClick: () => void }>;
const childrenOf = (node: unknown) =>
  React.Children.toArray(((node as React.ReactElement).props as { children: React.ReactNode }).children) as ClickEl[];

describe("IssuedDownloadButtons", () => {
  it("a letter with an employee-signed copy leads with 'Signed copy' and keeps 'Original' as the secondary action", () => {
    const html = el(IssuedDownloadButtons, { row: { letter_number: "MCN-AL-1", has_accepted_copy: true }, onDownload: vi.fn() });
    expect(html).toContain("Signed copy");
    expect(html).toContain("Original");
    expect(html.indexOf("Signed copy")).toBeLessThan(html.indexOf("Original"));
    expect(html).not.toMatch(/>\s*PDF\s*</);
  });

  it("a letter without one keeps the single PDF button, exactly as before", () => {
    for (const row of [{ letter_number: "MCN-AL-2" }, { letter_number: "MCN-AL-2", has_accepted_copy: false }]) {
      const html = el(IssuedDownloadButtons, { row, onDownload: vi.fn() });
      expect(html).toMatch(/PDF/);
      expect(html).not.toContain("Signed copy");
      expect(html).not.toContain("Original");
      expect((html.match(/<button/g) ?? []).length).toBe(1);
    }
  });

  it("asks for the right copy: Signed copy -> accepted, Original -> original, PDF -> original", () => {
    const onDownload = vi.fn();
    const both = IssuedDownloadButtons({ row: { letter_number: "X", has_accepted_copy: true }, onDownload });
    const [signed, original] = childrenOf(both);
    signed.props.onClick();
    original.props.onClick();
    expect(onDownload.mock.calls).toEqual([["accepted"], ["original"]]);

    const only = IssuedDownloadButtons({ row: { letter_number: "X" }, onDownload }) as ClickEl;
    only.props.onClick();
    expect(onDownload.mock.calls.at(-1)).toEqual(["original"]);
  });
});

describe("LetterCopyToggle", () => {
  it("offers both copies, with the given one pressed", () => {
    const html = el(LetterCopyToggle, { value: "accepted", onChange: vi.fn() });
    expect(html).toContain("Employee-signed copy");
    expect(html).toContain("Company-signed original");
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toContain('aria-pressed="true"');
    expect(buttons[1]).toContain('aria-pressed="false"');
  });

  it("reflects the original being chosen", () => {
    const buttons = el(LetterCopyToggle, { value: "original", onChange: vi.fn() }).match(/<button[^>]*>/g) ?? [];
    expect(buttons[0]).toContain('aria-pressed="false"');
    expect(buttons[1]).toContain('aria-pressed="true"');
  });

  it("reports the picked copy", () => {
    const onChange = vi.fn();
    const [accepted, original] = childrenOf(LetterCopyToggle({ value: "accepted", onChange }));
    original.props.onClick();
    accepted.props.onClick();
    expect(onChange.mock.calls).toEqual([["original"], ["accepted"]]);
  });
});

describe("AcceptedCopySummary", () => {
  it("shows the accepted timestamp as DD/MM/YYYY HH:mm and the short sha256", () => {
    const iso = new Date(2026, 8, 24, 11, 5).toISOString(); // local 24/09/2026 11:05
    const html = el(AcceptedCopySummary, { row: { letter_number: "X", has_accepted_copy: true, employee_esign_at: iso, accepted_copy_sha256: HASH } });
    expect(html).toContain("24/09/2026 11:05");
    expect(html).toContain(HASH.slice(0, 12));
    expect(html).not.toContain(HASH);
  });

  it("renders nothing for a letter with no signed copy", () => {
    expect(el(AcceptedCopySummary, { row: { letter_number: "X", has_accepted_copy: false, accepted_copy_sha256: HASH } })).toBe("");
  });

  it("copes with a missing timestamp or hash", () => {
    const html = el(AcceptedCopySummary, { row: { letter_number: "X", has_accepted_copy: true } });
    expect(html).toContain("Signed by employee");
    expect(html).not.toContain("SHA-256");
  });
});

describe("helpers", () => {
  it("formatAcceptedAt is empty for junk and shortHash is 12 chars", () => {
    expect(formatAcceptedAt(null)).toBe("");
    expect(formatAcceptedAt("not a date")).toBe("");
    expect(shortHash(HASH)).toHaveLength(12);
    expect(shortHash(null)).toBe("");
  });
});
