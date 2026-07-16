import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-wasm";
import * as faceapi from "@vladmandic/face-api/dist/face-api.node-wasm.js";
import { Canvas, Image, ImageData, loadImage } from "canvas";
import { db } from "../../db/mysql.js";

faceapi.env.monkeyPatch({ Canvas, Image, ImageData } as any);

let modelsLoaded = false;
let runtimeReady = false;
const MODELS_PATH = path.resolve(process.env.FACE_MODELS_PATH ?? path.join(process.cwd(), "face-models"));

async function ensureRuntime() {
  if (runtimeReady) return;
  await tf.setBackend("wasm");
  await tf.ready();
  runtimeReady = true;
}

async function ensureModels() {
  if (modelsLoaded) return;

  await ensureRuntime();

  if (!fs.existsSync(MODELS_PATH)) {
    fs.mkdirSync(MODELS_PATH, { recursive: true });
  }

  const modelFiles = fs.readdirSync(MODELS_PATH);
  if (modelFiles.length < 3) {
    throw new Error("Face models not available at " + MODELS_PATH);
  }

  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_PATH);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_PATH);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_PATH);
  modelsLoaded = true;
}

async function getDescriptor(imagePath: string): Promise<Float32Array | null> {
  try {
    await ensureModels();
    const image = await loadImage(imagePath);
    const detection = await faceapi.detectSingleFace(image as any).withFaceLandmarks().withFaceDescriptor();
    return detection?.descriptor ?? null;
  } catch (e: any) {
    console.error("[FaceMatch] Descriptor extraction failed:", e.message);
    return null;
  }
}

export async function compareFaces(
  candidateId: string,
  photoPath: string,
  idDocumentPath: string,
  photoDocId?: string,
  idDocId?: string
): Promise<{ score: number; matched: boolean; status: string }> {
  const id = randomUUID();

  try {
    const [photoDesc, idDesc] = await Promise.all([
      getDescriptor(photoPath),
      getDescriptor(idDocumentPath),
    ]);

    if (!photoDesc || !idDesc) {
      const status = "no_face_detected";
      await db.execute(
        `INSERT INTO candidate_face_match (id, candidate_id, photo_document_id, id_document_id, match_score, match_status, details)
         VALUES (?, ?, ?, ?, NULL, ?, ?)`,
        [id, candidateId, photoDocId ?? null, idDocId ?? null, status, JSON.stringify({ reason: "Could not detect face in one or both images" })]
      );
      return { score: 0, matched: false, status };
    }

    const distance = faceapi.euclideanDistance(photoDesc, idDesc);
    const score = Math.max(0, Math.round((1 - distance) * 100));
    const matched = distance < 0.6;

    const matchStatus = matched ? "matched" : "mismatch";
    await db.execute(
      `INSERT INTO candidate_face_match (id, candidate_id, photo_document_id, id_document_id, match_score, match_status, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, candidateId, photoDocId ?? null, idDocId ?? null, score, matchStatus, JSON.stringify({ euclidean_distance: distance })]
    );

    if (!matched) {
      const alertId = randomUUID();
      await db.execute(
        `INSERT INTO candidate_fraud_alert (id, candidate_id, alert_type, severity, details)
         VALUES (?, ?, 'FACE_MISMATCH', 'high', ?)`,
        [alertId, candidateId, JSON.stringify({ score, distance, photo_doc_id: photoDocId, id_doc_id: idDocId })]
      );
    }

    return { score, matched, status: matchStatus };
  } catch (error: any) {
    await db.execute(
      `INSERT INTO candidate_face_match (id, candidate_id, photo_document_id, id_document_id, match_status, details)
       VALUES (?, ?, ?, ?, 'failed', ?)`,
      [id, candidateId, photoDocId ?? null, idDocId ?? null, JSON.stringify({ error: error.message })]
    );
    return { score: 0, matched: false, status: "failed" };
  }
}

export async function isModelAvailable(): Promise<boolean> {
  try {
    await ensureModels();
    return true;
  } catch {
    return false;
  }
}
