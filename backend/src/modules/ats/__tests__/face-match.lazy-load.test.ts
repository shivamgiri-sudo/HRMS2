import fs from "node:fs";
import os from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const modelDir = fs.mkdtempSync(resolve(os.tmpdir(), "hrms-face-lazy-"));
const previousFaceModelsPath = process.env.FACE_MODELS_PATH;

const mocks = vi.hoisted(() => ({
  tfjsLoaded: false,
  wasmLoaded: false,
  setBackend: vi.fn().mockResolvedValue(undefined),
  ready: vi.fn().mockResolvedValue(undefined),
  monkeyPatch: vi.fn(),
  loadFromDisk: vi.fn().mockResolvedValue(undefined),
  detectSingleFace: vi.fn(),
  euclideanDistance: vi.fn(),
  loadImage: vi.fn(),
  execute: vi.fn().mockResolvedValue([[], []]),
}));

vi.mock("@tensorflow/tfjs", () => {
  mocks.tfjsLoaded = true;
  return {
    setBackend: mocks.setBackend,
    ready: mocks.ready,
  };
});

vi.mock("@tensorflow/tfjs-backend-wasm", () => {
  mocks.wasmLoaded = true;
  return {};
});

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

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: mocks.execute,
  },
}));

type FaceMatchModule = typeof import("../face-match.service.js");

let isModelAvailable: FaceMatchModule["isModelAvailable"];

const mockSetBackend = mocks.setBackend as ReturnType<typeof vi.fn>;
const mockReady = mocks.ready as ReturnType<typeof vi.fn>;
const mockMonkeyPatch = mocks.monkeyPatch as ReturnType<typeof vi.fn>;
const mockLoadFromDisk = mocks.loadFromDisk as ReturnType<typeof vi.fn>;
const mockDetectSingleFace = mocks.detectSingleFace as ReturnType<typeof vi.fn>;
const mockEuclideanDistance = mocks.euclideanDistance as ReturnType<typeof vi.fn>;
const mockLoadImage = mocks.loadImage as ReturnType<typeof vi.fn>;

beforeAll(async () => {
  process.env.FACE_MODELS_PATH = modelDir;
  fs.writeFileSync(resolve(modelDir, "ssd_mobilenetv1_model-weights_manifest.json"), "{}");
  fs.writeFileSync(resolve(modelDir, "face_landmark_68_model-weights_manifest.json"), "{}");
  fs.writeFileSync(resolve(modelDir, "face_recognition_model-weights_manifest.json"), "{}");

  const faceModule = await import("../face-match.service.js");
  isModelAvailable = faceModule.isModelAvailable;
});

beforeEach(() => {
  vi.clearAllMocks();

  mockSetBackend.mockResolvedValue(undefined);
  mockReady.mockResolvedValue(undefined);
  mockMonkeyPatch.mockReturnValue(undefined);
  mockLoadFromDisk.mockResolvedValue(undefined);
  mockEuclideanDistance.mockReturnValue(0.2);
  mockLoadImage.mockResolvedValue({});
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

describe("face match lazy runtime", () => {
  it("does not load TensorFlow modules at import time", () => {
    expect(mocks.tfjsLoaded).toBe(false);
    expect(mocks.wasmLoaded).toBe(false);
  });

  it("loads TensorFlow only when the face runtime is requested", async () => {
    await expect(isModelAvailable()).resolves.toBe(true);

    expect(mocks.tfjsLoaded).toBe(true);
    expect(mocks.wasmLoaded).toBe(true);
    expect(mockSetBackend).toHaveBeenCalledWith("wasm");
    expect(mockReady).toHaveBeenCalled();
    expect(mockLoadFromDisk).toHaveBeenCalledTimes(3);
  });
});
