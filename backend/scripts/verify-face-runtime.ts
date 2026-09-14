import fs from "node:fs";
import path from "node:path";
import { Canvas, Image, ImageData } from "canvas";
import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-wasm";
import * as faceapi from "@vladmandic/face-api/dist/face-api.node-wasm.js";

faceapi.env.monkeyPatch({ Canvas, Image, ImageData } as any);

const MODELS_PATH = path.resolve(
  process.env.FACE_MODELS_PATH ??
  path.join(process.cwd(), "face-models")
);

async function main() {
  if (!fs.existsSync(MODELS_PATH)) {
    throw new Error(`Face model directory not found: ${MODELS_PATH}`);
  }

  const entries = fs.readdirSync(MODELS_PATH);
  if (entries.length < 3) {
    throw new Error(`Face model directory is incomplete: ${MODELS_PATH}`);
  }

  await tf.setBackend("wasm");
  await tf.ready();

  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_PATH);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_PATH);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_PATH);

  console.log(`Face runtime verified with WASM backend at ${MODELS_PATH}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
