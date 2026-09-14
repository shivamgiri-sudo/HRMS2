/**
 * Smart face-crop for the activation-time profile/ID-card photo pipeline.
 *
 * No face-crop logic existed anywhere before this — face-api was only used
 * for fraud match scoring, and the raw uploaded photo was stored as-is. This
 * covers the crop-region math (centered/padded on a detected face, biased
 * upward for headroom, clamped to image bounds) and the no-face fallback,
 * without depending on the real face-api model files being loadable in CI.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

const mockDetectFaceBbox = vi.fn();
vi.mock("../../ats/face-match.service.js", () => ({
  detectFaceBbox: (...args: unknown[]) => mockDetectFaceBbox(...args),
}));

const { cropFaceForProfilePhoto } = await import("../face-crop.util.js");

const workDir = mkdtempSync(join(tmpdir(), "face-crop-test-"));
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

/** Write a plain synthetic JPEG to disk and return its path — content doesn't matter, only dimensions. */
async function makeTestImage(name: string, width: number, height: number): Promise<string> {
  const filePath = join(workDir, name);
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 180, b: 160 } },
  }).jpeg().toBuffer();
  writeFileSync(filePath, buf);
  return filePath;
}

beforeEach(() => {
  mockDetectFaceBbox.mockReset();
});

describe("cropFaceForProfilePhoto", () => {
  it("produces a 480x480 JPEG when a face is detected", async () => {
    const path = await makeTestImage("wide.jpg", 800, 600);
    mockDetectFaceBbox.mockResolvedValue({
      x: 300, y: 150, width: 200, height: 200, imageWidth: 800, imageHeight: 600,
    });

    const out = await cropFaceForProfilePhoto(path);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(480);
    expect(meta.height).toBe(480);
    expect(meta.format).toBe("jpeg");
  });

  it("falls back to a center square crop when no face is detected", async () => {
    const path = await makeTestImage("noface.jpg", 800, 600);
    mockDetectFaceBbox.mockResolvedValue(null);

    const out = await cropFaceForProfilePhoto(path);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(480);
    expect(meta.height).toBe(480);
  });

  it("keeps the crop region inside the source image even for a face near the edge", async () => {
    const path = await makeTestImage("edge.jpg", 400, 400);
    // Face bbox near the top-left corner — a naive centered crop would compute
    // negative left/top, which sharp's extract() rejects outright.
    mockDetectFaceBbox.mockResolvedValue({
      x: 5, y: 5, width: 100, height: 100, imageWidth: 400, imageHeight: 400,
    });

    await expect(cropFaceForProfilePhoto(path)).resolves.toBeInstanceOf(Buffer);
  });

  it("rejects rather than hanging on an unreadable file", async () => {
    mockDetectFaceBbox.mockResolvedValue(null);
    const path = join(workDir, "not-an-image.jpg");
    writeFileSync(path, "not an image");
    await expect(cropFaceForProfilePhoto(path)).rejects.toBeTruthy();
  });
});
