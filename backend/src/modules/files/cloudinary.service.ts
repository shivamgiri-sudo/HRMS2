import { env } from "../../config/env.js";

let _client: any = null;

async function getClient(): Promise<any | null> {
  if (_client) return _client;
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    return null;
  }
  // Dynamic import — module only loaded when credentials are present
  const mod = await import("cloudinary");
  mod.v2.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key:    env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure:     true,
  });
  _client = mod.v2;
  return _client;
}

export function isCloudinaryEnabled(): boolean {
  return Boolean(
    env.CLOUDINARY_CLOUD_NAME &&
    env.CLOUDINARY_API_KEY &&
    env.CLOUDINARY_API_SECRET
  );
}

/**
 * Upload a local file path to Cloudinary under hrms/employee-photos/.
 * Uses the supplied publicId as a stable identifier so re-uploads overwrite
 * the same asset (no orphaned files).
 * Returns the permanent secure_url on success, null if Cloudinary is not configured.
 */
export async function uploadToCloudinary(
  filePath: string,
  publicId: string
): Promise<string | null> {
  const client = await getClient();
  if (!client) return null;

  const result = await client.uploader.upload(filePath, {
    public_id:     publicId,
    folder:        "hrms/employee-photos",
    resource_type: "image",
    overwrite:     true,
    transformation: [
      {
        width: 400, height: 400,
        crop: "fill", gravity: "face",
        quality: "auto", fetch_format: "auto",
      },
    ],
  });

  return result.secure_url as string;
}

/**
 * Delete a Cloudinary asset by public_id (relative to folder).
 * No-op if Cloudinary is not configured.
 */
export async function deleteFromCloudinary(publicId: string): Promise<void> {
  const client = await getClient();
  if (!client) return;
  await client.uploader.destroy(`hrms/employee-photos/${publicId}`);
}
