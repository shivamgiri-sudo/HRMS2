import sharp from "sharp";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectFaceBbox } from "../ats/face-match.service.js";

/**
 * Longest side the face detector is given. The detector is a WASM model running on Node's main
 * thread, so cost scales with pixels: a 3000px phone selfie held the event loop for 10s+, which
 * delayed the approve response and every other request behind it. A face is easily found at 640px.
 */
const DETECTION_MAX_SIDE = 640;

/** Detects on a downscaled copy and maps the box back to the original's coordinates. */
async function detectFaceBboxDownscaled(imagePath: string) {
  const meta = await sharp(imagePath).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const longest = Math.max(width, height);
  if (!longest || longest <= DETECTION_MAX_SIDE) return detectFaceBbox(imagePath);

  const scale = longest / DETECTION_MAX_SIDE;
  const dir = await mkdtemp(path.join(tmpdir(), "facedet-"));
  try {
    const small = path.join(dir, "small.jpg");
    await writeFile(
      small,
      await sharp(imagePath).resize({ width: DETECTION_MAX_SIDE, height: DETECTION_MAX_SIDE, fit: "inside" }).jpeg({ quality: 85 }).toBuffer(),
    );
    const box = await detectFaceBbox(small);
    if (!box) return null;
    return {
      x: box.x * scale,
      y: box.y * scale,
      width: box.width * scale,
      height: box.height * scale,
      imageWidth: width,
      imageHeight: height,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Output size for auto-cropped profile/ID-card photos. Square so the same
 * file works for both the circular avatar and the circular ID-card frame
 * (see EmployeeIDCard.tsx, which frames whatever URL it's given with CSS
 * object-fit/object-position and does no cropping of its own).
 */
const OUTPUT_SIZE = 480;

/**
 * Portrait-crop convention: how much wider than the detected face the square
 * crop should be, so there's room for hair/shoulders instead of a tight
 * face-only box. 2.2x is a standard headshot ratio (face occupies roughly
 * the middle ~45% of the frame width).
 */
const PADDING_RATIO = 2.2;

/**
 * How far above the face's vertical center to bias the crop, as a fraction
 * of the crop's side length. Faces need more headroom above (forehead/hair)
 * than below (chin), so centering purely on the detected box looks bottom-
 * heavy; a small upward bias reads as a normal headshot.
 */
const VERTICAL_BIAS_RATIO = 0.12;

/**
 * Detect the face in a source image and produce a square, padded,
 * portrait-cropped JPEG buffer suitable for use as a profile photo / ID
 * card photo. Never throws — falls back to a center square crop of the
 * whole image if no face is detected (e.g. a poor-quality capture), so the
 * activation pipeline that calls this can stay non-blocking.
 */
export async function cropFaceForProfilePhoto(imagePath: string): Promise<Buffer> {
  const bbox = await detectFaceBboxDownscaled(imagePath);
  const source = sharp(imagePath);
  const metadata = await source.metadata();
  const imageWidth = bbox?.imageWidth ?? metadata.width ?? 0;
  const imageHeight = bbox?.imageHeight ?? metadata.height ?? 0;

  if (!imageWidth || !imageHeight) {
    // Can't even read dimensions — hand back the original re-encoded as JPEG
    // rather than failing the whole activation flow over a malformed image.
    return source.jpeg({ quality: 85 }).toBuffer();
  }

  const region = bbox
    ? computeSquareCropRegion(bbox, imageWidth, imageHeight)
    : centerSquareCropRegion(imageWidth, imageHeight);

  return sharp(imagePath)
    .extract(region)
    .resize(OUTPUT_SIZE, OUTPUT_SIZE)
    .jpeg({ quality: 85 })
    .toBuffer();
}

interface CropRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

function computeSquareCropRegion(
  bbox: { x: number; y: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number,
): CropRegion {
  const faceCenterX = bbox.x + bbox.width / 2;
  const faceCenterY = bbox.y + bbox.height / 2;

  let side = Math.round(Math.max(bbox.width, bbox.height) * PADDING_RATIO);
  side = Math.min(side, imageWidth, imageHeight);

  let top = Math.round(faceCenterY - side / 2 - side * VERTICAL_BIAS_RATIO);
  let left = Math.round(faceCenterX - side / 2);

  // Clamp/shift to stay fully inside the source image rather than shrinking
  // the crop asymmetrically, which would off-center the face.
  left = Math.max(0, Math.min(left, imageWidth - side));
  top = Math.max(0, Math.min(top, imageHeight - side));

  return { left, top, width: side, height: side };
}

function centerSquareCropRegion(imageWidth: number, imageHeight: number): CropRegion {
  const side = Math.min(imageWidth, imageHeight);
  const left = Math.round((imageWidth - side) / 2);
  const top = Math.round((imageHeight - side) / 2);
  return { left, top, width: side, height: side };
}
