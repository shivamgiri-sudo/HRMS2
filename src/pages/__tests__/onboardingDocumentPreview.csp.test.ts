import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Candidate document preview must not dead-end when the browser refuses to frame it.
 *
 * PDFs are previewed by fetching the file and pointing an <iframe> at a blob: URL. The
 * production CSP (verified live 2026-09-04) is:
 *
 *   default-src 'self'; … img-src 'self' data: blob: https:; … frame-ancestors 'none';
 *
 * There is no frame-src, so framing falls back to `default-src 'self'` and a blob: URL is
 * not 'self'. Chrome states it exactly: "Framing '' violates the following Content Security
 * Policy directive: default-src 'self'. … Note that 'frame-src' was not explicitly set, so
 * 'default-src' is used as a fallback." Reproduced in a real browser against that header —
 * the image path loaded (img-src lists blob:) and the iframe was blocked, which is why image
 * documents preview and PDFs do not.
 *
 * The proper fix is one nginx directive (`frame-src 'self' blob:`) outside this repo. This
 * pins the in-app behaviour until then: detect the refusal, explain it, offer a route that
 * works — and, because detection is the browser's own event, resume the inline viewer with
 * no code change on the day the header is fixed.
 *
 * Source-level assertions: this project has no jsdom (see vitest.config.ts) and the screen is
 * a 2,800-line page, so this guards the wiring rather than rendering it.
 */
const SOURCE = readFileSync(
  resolve(__dirname, "../NativeHROnboardingRequests.tsx"),
  "utf8"
);

describe("onboarding document preview — CSP framing refusal", () => {
  it("listens for the browser's own policy-violation event", () => {
    expect(SOURCE).toContain('document.addEventListener("securitypolicyviolation"');
    expect(SOURCE).toContain('document.removeEventListener("securitypolicyviolation"');
  });

  it("only treats a framing refusal of our own blob as the blocked case", () => {
    // A violation of, say, img-src or connect-src must not blank the PDF viewer.
    expect(SOURCE).toMatch(/violatedDirective/);
    expect(SOURCE).toMatch(/startsWith\("frame-src"\)/);
    expect(SOURCE).toMatch(/startsWith\("default-src"\)/);
    expect(SOURCE).toMatch(/blocked\.startsWith\("blob"\)/);
  });

  it("clears the flag when a new document is opened", () => {
    // Otherwise one blocked PDF would leave every later preview showing the fallback,
    // including images, which are not blocked at all.
    const openFn = SOURCE.slice(SOURCE.indexOf("setPreviewFramingBlocked(false)") - 400);
    expect(openFn).toContain("setPreviewFramingBlocked(false)");
    expect(openFn).toContain("documents/preview/");
  });

  it("offers a working route instead of an empty panel", () => {
    expect(SOURCE).toContain("Open in a new tab");
    // Top-level navigation is not restricted by frame-src, so this genuinely works under
    // the same policy that blocks the iframe.
    expect(SOURCE).toMatch(/window\.open\(documentPreviewUrl, '_blank', 'noopener'\)/);
    expect(SOURCE).toContain("This browser blocked the inline PDF preview");
  });

  it("does not sandbox the PDF frame, which stops Edge rendering it", () => {
    // Edge's built-in PDF viewer refuses to run inside a sandboxed frame and substitutes its
    // own "blocked by Microsoft Edge" page. The attribute was `allow-scripts allow-same-origin`
    // — the combination Chrome warns "can escape its sandboxing" — so it isolated nothing
    // while still costing the viewer. The framed blob is this page's own authenticated
    // response, not third-party content.
    const frame = SOURCE.slice(SOURCE.indexOf("<iframe"), SOURCE.indexOf("<iframe") + 600);
    expect(frame).not.toContain("sandbox=");
  });

  it("keeps the inline iframe as the default path", () => {
    // The fallback is conditional. If the CSP is fixed the event never fires, the flag stays
    // false, and the watermarked in-page viewer is what renders — no code change needed.
    expect(SOURCE).toContain("previewFramingBlocked ? (");
    expect(SOURCE).toMatch(/<iframe[\s\S]{0,200}src=\{documentPreviewUrl \?\? undefined\}/);
  });
});
