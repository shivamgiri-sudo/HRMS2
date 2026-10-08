import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

/**
 * Extracts the DigiLocker Aadhaar eKYC face photo for a candidate.
 *
 * The photo lives inside `candidate_bgv_check.result_json` for the row where
 * `check_type = 'digilocker'`. The payload shape varies by call site: some
 * writers store the whole provider envelope (photo at `result_json.data.image`),
 * others store just the inner `data` object (photo at `result_json.image`).
 * `sanitizeProviderPayload` (luckpay.transport.ts) does not strip the `image`
 * field, so it survives untouched in storage either way.
 *
 * This must never throw — any failure (missing row, unparseable JSON, no
 * image field) resolves to `null` so a calling page never breaks because a
 * photo happens to be absent.
 */
export async function getDigilockerFacePhotoBuffer(candidateId: string): Promise<Buffer | null> {
  try {
    if (!candidateId) return null;

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT result_json
         FROM candidate_bgv_check
        WHERE candidate_id = ? AND check_type = 'digilocker'
        ORDER BY updated_at DESC
        LIMIT 1`,
      [candidateId]
    );
    const row = rows[0];
    if (!row || row.result_json == null) return null;

    // mysql2 returns JSON columns already parsed into an object in most cases,
    // but some writers store it via CAST(? AS JSON) from a JS-stringified
    // value, and depending on driver/version it can come back as a string.
    let parsed: unknown = row.result_json;
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        return null;
      }
    }
    if (!parsed || typeof parsed !== "object") return null;

    const obj = parsed as Record<string, unknown>;
    const data = obj.data as Record<string, unknown> | undefined;
    const photoBase64 = (data?.image as string | undefined) ?? (obj.image as string | undefined) ?? null;

    if (!photoBase64 || typeof photoBase64 !== "string") return null;

    // Some providers prefix the value as a data URI (data:image/jpeg;base64,...).
    const base64Only = photoBase64.includes(",") && photoBase64.trim().startsWith("data:")
      ? photoBase64.slice(photoBase64.indexOf(",") + 1)
      : photoBase64;

    const buffer = Buffer.from(base64Only, "base64");
    if (!buffer || buffer.length === 0) return null;

    return buffer;
  } catch {
    return null;
  }
}
