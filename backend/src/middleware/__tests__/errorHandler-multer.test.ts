import express from "express";
import multer from "multer";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { errorHandler } from "../errorHandler.js";

/**
 * A multer rejection must never reach a user as a reference number.
 *
 * `MulterError` carries a `code` (LIMIT_FILE_SIZE, LIMIT_UNEXPECTED_FILE, …) and no
 * `statusCode`, so it fell through to the handler's masking branch and surfaced as
 * "An unexpected server error occurred. Please quote reference <hex>". Nineteen route
 * files upload through multer, so this is answered once here rather than in each of
 * them — a user told "the file is too large" can act; a user given a hex string cannot.
 */
function app() {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024, files: 1 } });
  const a = express();
  a.post("/upload", upload.single("file"), (_req, res) => res.json({ success: true }));
  a.get("/boom", (_req, _res) => { throw new Error("connect ECONNREFUSED 10.0.0.1:3306"); });
  a.use(errorHandler);
  return a;
}

describe("errorHandler answers multer rejections with a reason", () => {
  it("names the size limit instead of a reference", async () => {
    const res = await request(app())
      .post("/upload")
      .attach("file", Buffer.alloc(4096, 97), { filename: "big.csv", contentType: "text/csv" });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe("LIMIT_FILE_SIZE");
    expect(res.body.message).toMatch(/too large/i);
    expect(res.body.message).not.toMatch(/quote reference/i);
    expect(res.body.reference).toBeUndefined();
  });

  it("names the wrong field instead of a reference", async () => {
    const res = await request(app())
      .post("/upload")
      .attach("attachment", Buffer.from("x"), { filename: "a.csv", contentType: "text/csv" });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe("LIMIT_UNEXPECTED_FILE");
    expect(res.body.message).toContain("attachment");
    expect(res.body.message).not.toMatch(/quote reference/i);
  });

  it("still masks a genuine server fault, and leaks no internals", async () => {
    const res = await request(app()).get("/boom");

    // The masking branch must still own genuine faults — it is what emits the
    // reference, and in production it is what replaces the message. (Outside
    // production the handler deliberately returns the real message, so the reference
    // is the invariant to assert on here, not the wording.)
    expect(res.status).toBe(500);
    expect(res.body.reference).toMatch(/^[0-9a-f]{8}$/);
    expect(res.body.errorCode).toBeUndefined();
  });
});
