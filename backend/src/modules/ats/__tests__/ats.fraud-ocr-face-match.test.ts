import fs from "node:fs";
import os from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recognize: vi.fn(),
  execute: vi.fn().mockResolvedValue([[], []]),
  setBackend: vi.fn().mockResolvedValue(undefined),
  ready: vi.fn().mockResolvedValue(undefined),
  monkeyPatch: vi.fn(),
  loadFromDisk: vi.fn().mockResolvedValue(undefined),
  detectSingleFace: vi.fn(() => ({
    withFaceLandmarks: () => ({
      withFaceDescriptor: async () => ({ descriptor: null }),
    }),
  })),
  euclideanDistance: vi.fn(),
  loadImage: vi.fn().mockResolvedValue({}),
}));

vi.mock("tesseract.js", () => ({
  default: { recognize: mocks.recognize },
}));

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: mocks.execute },
}));

vi.mock("@tensorflow/tfjs", () => ({
  setBackend: mocks.setBackend,
  ready: mocks.ready,
}));

vi.mock("@tensorflow/tfjs-backend-wasm", () => ({}));

vi.mock("@vladmandic/face-api/dist/face-api.node-wasm.js", () => ({
  env: { monkeyPatch: mocks.monkeyPatch },
  nets: {
    ssdMobilenetv1: { loadFromDisk: mocks.loadFromDisk },
    faceLandmark68Net: { loadFromDisk: mocks.loadFromDisk },
    faceRecognitionNet: { loadFromDisk: mocks.loadFromDisk },
  },
  detectSingleFace: mocks.detectSingleFace,
  euclideanDistance: mocks.euclideanDistance,
}));

vi.mock("canvas", () => ({
  Canvas: class Canvas {},
  Image: class Image {},
  ImageData: class ImageData {},
  loadImage: mocks.loadImage,
}));

let compareFaces: typeof import("../face-match.service.js")["compareFaces"];
let isModelAvailable: typeof import("../face-match.service.js")["isModelAvailable"];
let crossValidateDocument: typeof import("../ocr.service.js")["crossValidateDocument"];
let extractFromDocument: typeof import("../ocr.service.js")["extractFromDocument"];

const modelDir = fs.mkdtempSync(resolve(os.tmpdir(), "hrms-face-models-"));
const previousFaceModelsPath = process.env.FACE_MODELS_PATH;

beforeAll(async () => {
  process.env.FACE_MODELS_PATH = modelDir;
  const faceModule = await import("../face-match.service.js");
  const ocrModule = await import("../ocr.service.js");
  compareFaces = faceModule.compareFaces;
  isModelAvailable = faceModule.isModelAvailable;
  crossValidateDocument = ocrModule.crossValidateDocument;
  extractFromDocument = ocrModule.extractFromDocument;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockReset().mockResolvedValue([[], []]);
  mocks.recognize.mockReset();
  mocks.setBackend.mockResolvedValue(undefined);
  mocks.ready.mockResolvedValue(undefined);
  mocks.loadFromDisk.mockResolvedValue(undefined);
  mocks.detectSingleFace.mockImplementation(() => ({
    withFaceLandmarks: () => ({
      withFaceDescriptor: async () => ({ descriptor: null }),
    }),
  }));
  mocks.euclideanDistance.mockReset();
  mocks.loadImage.mockResolvedValue({});
  fs.mkdirSync(modelDir, { recursive: true });
  fs.writeFileSync(resolve(modelDir, "ssdMobilenetv1.json"), "{}");
  fs.writeFileSync(resolve(modelDir, "faceLandmark68Net.json"), "{}");
  fs.writeFileSync(resolve(modelDir, "faceRecognitionNet.json"), "{}");
});

afterAll(() => {
  fs.rmSync(modelDir, { recursive: true, force: true });
  if (previousFaceModelsPath === undefined) {
    delete process.env.FACE_MODELS_PATH;
  } else {
    process.env.FACE_MODELS_PATH = previousFaceModelsPath;
  }
});

describe("ATS OCR and face matching", () => {
  it("extracts Aadhaar details from OCR text", async () => {
    mocks.recognize.mockResolvedValueOnce({
      data: {
        text: "John Doe\n1234 5678 9012",
        confidence: 88,
      },
    });

    const result = await extractFromDocument("/tmp/aadhaar.png", "aadhaar");

    expect(result.documentType).toBe("aadhaar");
    expect(result.extractedNumber).toBe("123456789012");
    expect(result.extractedName).toBe("John Doe");
    expect(result.confidence).toBe(88);
  });

  it("records OCR mismatches as fraud alerts", async () => {
    const storedHash = "b3a8fa0e8f821bf5e3a14a26d1e5d7b4ed4cbf4ec9d2bf1dd08db4f4f4e7e5e6";
    mocks.execute
      .mockResolvedValueOnce([[{ aadhaar_number_hash: storedHash }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []]);

    const result = await crossValidateDocument("candidate-1", "document-1", "aadhaar", {
      rawText: "John Doe\n1234 5678 9012",
      extractedNumber: "123456789012",
      extractedName: "John Doe",
      confidence: 88,
      documentType: "aadhaar",
    });

    expect(result.matched).toBe(false);
    expect(result.alertId).toBeDefined();
    expect(mocks.execute.mock.calls.some(([sql]) => String(sql).includes("candidate_fraud_alert"))).toBe(true);
  });

  it("initializes the WASM face runtime and returns no_face_detected when no faces are found", async () => {
    const result = await compareFaces("candidate-1", "/tmp/photo.png", "/tmp/id.png");

    expect(mocks.setBackend).toHaveBeenCalledWith("wasm");
    expect(mocks.ready).toHaveBeenCalled();
    expect(result.status).toBe("no_face_detected");
    expect(result.matched).toBe(false);
    expect(result.score).toBe(0);
    expect(mocks.execute.mock.calls.some(([sql]) => String(sql).includes("candidate_face_match"))).toBe(true);
  });

  it("reports the face runtime as available when models load", async () => {
    await expect(isModelAvailable()).resolves.toBe(true);
  });
});
