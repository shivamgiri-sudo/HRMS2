import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import * as faceapi from "@vladmandic/face-api/dist/face-api.node-wasm.js";
import { Canvas, Image, ImageData, loadImage } from "canvas";
import { db } from "../../db/mysql.js";

faceapi.env.monkeyPatch({ Canvas, Image, ImageData } as any);

let modelsLoaded = false;
let runtimeReady = false;
let runtimeReadyPromise: Promise<void> | null = null;
const MODELS_PATH = path.resolve(
  process.env.FACE_MODELS_PATH ??
  path.join(process.cwd(), "face-models")
);

async function ensureRuntime() {
  if (runtimeReady) return;
  if (runtimeReadyPromise) {
    await runtimeReadyPromise;
    return;
  }

  runtimeReadyPromise = (async () => {
    const tf = await import("@tensorflow/tfjs");
    await import("@tensorflow/tfjs-backend-wasm");
    await tf.setBackend("wasm");
    await tf.ready();
    runtimeReady = true;
  })().finally(() => {
    runtimeReadyPromise = null;
  });

  await runtimeReadyPromise;
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
      // ON DUPLICATE KEY UPDATE against uq_candidate_face_match_pair — see
      // 444_candidate_face_match_unique_constraint.sql. compareFaces() is
      // triggered separately from both the selfie-upload and ID-doc-upload
      // paths, so the same (photo_document_id, id_document_id) pair is
      // re-scored more than once; this refreshes that pair's row in place
      // instead of stacking up duplicate rows (including stale
      // "no_face_detected" rows a later successful run should replace).
      await db.execute(
        `INSERT INTO candidate_face_match (id, candidate_id, photo_document_id, id_document_id, match_score, match_status, details)
         VALUES (?, ?, ?, ?, NULL, ?, ?) AS new_match
         ON DUPLICATE KEY UPDATE
           match_score = NULL,
           match_status = new_match.match_status,
           details = new_match.details,
           created_at = NOW()`,
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
       VALUES (?, ?, ?, ?, ?, ?, ?) AS new_match
       ON DUPLICATE KEY UPDATE
         match_score = new_match.match_score,
         match_status = new_match.match_status,
         details = new_match.details,
         created_at = NOW()`,
      [id, candidateId, photoDocId ?? null, idDocId ?? null, score, matchStatus, JSON.stringify({ euclidean_distance: distance })]
    );

    if (!matched) {
      const alertId = randomUUID();
      // ON DUPLICATE KEY UPDATE against uq_candidate_alert_type — see
      // 442_candidate_fraud_alert_unique_constraint.sql. A re-run of face
      // match (e.g. a document re-upload) refreshes this alert's
      // severity/details in place instead of adding another duplicate open
      // alert, and never overwrites a status HR already reviewed away from
      // 'open'. Mirrors the ON DUPLICATE KEY UPDATE style used for
      // candidate_bgv_check in bgv-verification.service.ts.
      await db.execute(
        `INSERT INTO candidate_fraud_alert (id, candidate_id, alert_type, severity, details)
         VALUES (?, ?, 'FACE_MISMATCH', 'high', ?) AS new_alert
         ON DUPLICATE KEY UPDATE
           severity = new_alert.severity,
           details = new_alert.details,
           status = CASE WHEN candidate_fraud_alert.status = 'open' THEN 'open' ELSE candidate_fraud_alert.status END,
           updated_at = NOW()`,
        [alertId, candidateId, JSON.stringify({ score, distance, photo_doc_id: photoDocId, id_doc_id: idDocId })]
      );
    }

    return { score, matched, status: matchStatus };
  } catch (error: any) {
    await db.execute(
      `INSERT INTO candidate_face_match (id, candidate_id, photo_document_id, id_document_id, match_status, details)
       VALUES (?, ?, ?, ?, 'failed', ?) AS new_match
       ON DUPLICATE KEY UPDATE
         match_score = NULL,
         match_status = new_match.match_status,
         details = new_match.details,
         created_at = NOW()`,
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

export interface FaceBbox {
  x: number;
  y: number;
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
}

export async function detectFaceBbox(imagePath: string): Promise<FaceBbox | null> {
  try {
    await ensureModels();
    const image = await loadImage(imagePath);
    const detection = await faceapi.detectSingleFace(image as any);
    if (!detection) return null;
    const box = detection.box;
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      imageWidth: (image as any).width,
      imageHeight: (image as any).height,
    };
  } catch {
    return null;
  }
}
