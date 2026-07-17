import fs from "node:fs";
import os from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const modelDir = fs.mkdtempSync(resolve(os.tmpdir(), "hrms-face-models-"));
const previousFaceModelsPath = process.env.FACE_MODELS_PATH;

const mocks = vi.hoisted(() => ({
  setBackend: vi.fn().mockResolvedValue(undefined),
  ready: vi.fn().mockResolvedValue(undefined),
  monkeyPatch: vi.fn(),
  loadFromDisk: vi.fn().mockResolvedValue(undefined),
  detectSingleFace: vi.fn(),
  euclideanDistance: vi.fn(),
  loadImage: vi.fn(),
  recognize: vi.fn(),
  execute: vi.fn().mockResolvedValue([[], []]),
}));

vi.mock("@tensorflow/tfjs", () => ({
  setBackend: mocks.setBackend,
  ready: mocks.ready,
}));

vi.mock("@tensorflow/tfjs-backend-wasm", () => ({}));

vi.mock("@vladmandic/face-api/dist/face-api.node-wasm.js", () => ({
  env: {
    monkeyPatch: mocks.monkeyPatch,
  },
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

vi.mock("tesseract.js", () => ({
  default: {
    recognize: mocks.recognize,
  },
}));

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: mocks.execute,
  },
}));

type FaceMatchModule = typeof import("../face-match.service.js");
type OcrModule = typeof import("../ocr.service.js");

let compareFaces: FaceMatchModule["compareFaces"];
let isModelAvailable: FaceMatchModule["isModelAvailable"];
let extractFromDocument: OcrModule["extractFromDocument"];
let crossValidateDocument: OcrModule["crossValidateDocument"];
let checkDuplicates: OcrModule["checkDuplicates"];

const mockSetBackend = mocks.setBackend as ReturnType<typeof vi.fn>;
const mockReady = mocks.ready as ReturnType<typeof vi.fn>;
const mockMonkeyPatch = mocks.monkeyPatch as ReturnType<typeof vi.fn>;
const mockLoadFromDisk = mocks.loadFromDisk as ReturnType<typeof vi.fn>;
const mockDetectSingleFace = mocks.detectSingleFace as ReturnType<typeof vi.fn>;
const mockEuclideanDistance = mocks.euclideanDistance as ReturnType<typeof vi.fn>;
const mockLoadImage = mocks.loadImage as ReturnType<typeof vi.fn>;
const mockRecognize = mocks.recognize as ReturnType<typeof vi.fn>;
const mockExecute = mocks.execute as ReturnType<typeof vi.fn>;

beforeAll(async () => {
  process.env.FACE_MODELS_PATH = modelDir;
  fs.writeFileSync(resolve(modelDir, "ssd_mobilenetv1_model-weights_manifest.json"), "{}");
  fs.writeFileSync(resolve(modelDir, "face_landmark_68_model-weights_manifest.json"), "{}");
  fs.writeFileSync(resolve(modelDir, "face_recognition_model-weights_manifest.json"), "{}");

  const faceModule = await import("../face-match.service.js");
  const ocrModule = await import("../ocr.service.js");
  compareFaces = faceModule.compareFaces;
  isModelAvailable = faceModule.isModelAvailable;
  extractFromDocument = ocrModule.extractFromDocument;
  crossValidateDocument = ocrModule.crossValidateDocument;
  checkDuplicates = ocrModule.checkDuplicates;
});

beforeEach(() => {
  vi.clearAllMocks();

  mockSetBackend.mockResolvedValue(undefined);
  mockReady.mockResolvedValue(undefined);
  mockMonkeyPatch.mockReturnValue(undefined);
  mockLoadFromDisk.mockResolvedValue(undefined);
  mockEuclideanDistance.mockReturnValue(0.2);
  mockLoadImage.mockResolvedValue({});
  mockRecognize.mockResolvedValue({
    data: {
      text: "John Doe\n1234 5678 9012",
      confidence: 91,
    },
  });
  mockExecute.mockResolvedValue([[], []]);
  mockDetectSingleFace.mockImplementation(() => ({
    withFaceLandmarks: () => ({
      withFaceDescriptor: async () => ({ descriptor: new Float32Array([0.1, 0.2, 0.3]) }),
    }),
  }));
});

afterAll(() => {
  fs.rmSync(modelDir, { recursive: true, force: true });
  if (previousFaceModelsPath === undefined) {
    delete process.env.FACE_MODELS_PATH;
  } else {
    process.env.FACE_MODELS_PATH = previousFaceModelsPath;
  }
});

describe("ATS OCR and face runtime", () => {
  it("initializes TensorFlow WASM and loads all face models", async () => {
    await expect(isModelAvailable()).resolves.toBe(true);

    expect(mockSetBackend).toHaveBeenCalledWith("wasm");
    expect(mockReady).toHaveBeenCalled();
    expect(mockLoadFromDisk).toHaveBeenCalledTimes(3);
  });

  it("uses the configurable face model directory", async () => {
    await compareFaces("candidate-1", resolve(modelDir, "selfie.png"), resolve(modelDir, "id.png"));

    expect(mockLoadImage).toHaveBeenCalledWith(resolve(modelDir, "selfie.png"));
    expect(mockLoadImage).toHaveBeenCalledWith(resolve(modelDir, "id.png"));
  });

  it("returns no_face_detected when a face cannot be found", async () => {
    mockDetectSingleFace.mockImplementation(() => ({
      withFaceLandmarks: () => ({
        withFaceDescriptor: async () => null,
      }),
    }));

    const result = await compareFaces("candidate-1", "selfie.png", "id.png");

    expect(result).toEqual({ score: 0, matched: false, status: "no_face_detected" });
    expect(mockExecute.mock.calls.some(([sql]) => String(sql).includes("candidate_face_match"))).toBe(true);
  });

  it("records failed face matching safely when the runtime throws", async () => {
    mockDetectSingleFace.mockImplementation(() => ({
      withFaceLandmarks: () => ({
        withFaceDescriptor: async () => null,
      }),
    }));
    mockExecute.mockRejectedValueOnce(new Error("database unavailable"));

    const result = await compareFaces("candidate-1", "selfie.png", "id.png");

    expect(result).toEqual({ score: 0, matched: false, status: "failed" });
    expect(mockExecute.mock.calls.some(([sql]) => String(sql).includes("match_status, details"))).toBe(true);
  });

  it("keeps OCR extraction behavior for Aadhaar documents", async () => {
    const result = await extractFromDocument("aadhaar.png", "aadhaar");

    expect(result.documentType).toBe("aadhaar");
    expect(result.extractedNumber).toBe("123456789012");
    expect(result.extractedName).toBe("John Doe");
    expect(result.confidence).toBe(91);
  });

  it("records OCR fraud alerts when extracted document numbers mismatch", async () => {
    mockExecute
      .mockResolvedValueOnce([[{ aadhaar_number_hash: "deadbeef" }]])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []]);

    const result = await crossValidateDocument("candidate-1", "doc-1", "aadhaar", {
      rawText: "John Doe\n1234 5678 9012",
      extractedNumber: "123456789012",
      extractedName: "John Doe",
      confidence: 91,
      documentType: "aadhaar",
    });

    expect(result.matched).toBe(false);
    expect(result.alertId).toBeDefined();
    expect(mockExecute.mock.calls.some(([sql]) => String(sql).includes("candidate_fraud_alert"))).toBe(true);
  });

  it("keeps duplicate detection behavior unchanged", async () => {
    mockExecute.mockResolvedValueOnce([[{ candidate_id: "candidate-2" }]]);

    const result = await checkDuplicates("candidate-1", "aadhaar", "hashed-value");

    expect(result).toEqual({ isDuplicate: true, matchedCandidateId: "candidate-2" });
  });
});
