/**
 * PhotoUpload — click-to-upload employee avatar with circular crop modal,
 * progress indication, and 15 MB / jpg+png+webp validation.
 *
 * Usage:
 *   <PhotoUpload
 *     currentUrl={employee.avatar_url}
 *     employeeId={employee.id}       // omit for "me" (self-service)
 *     onSuccess={(url) => setAvatarUrl(url)}
 *   />
 */
import { useRef, useState, useCallback } from "react";
import { Camera, Loader2, Trash2, Upload, Check, X } from "lucide-react";
import ReactCrop, { type Crop, centerCrop, makeAspectCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { normalizeMediaUrl } from "@/lib/mediaUrl";
import { apiBaseUrl } from "@/lib/apiBase";

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const API_BASE = apiBaseUrl();
const CROP_OUTPUT_SIZE = 300; // px — output cropped square

// normalizeMediaUrl is imported from @/lib/mediaUrl — kept local alias for internal use
const normalizeFileUrl = normalizeMediaUrl;

interface PhotoUploadProps {
  /** Current avatar URL (from DB) */
  currentUrl?: string | null;
  /** Employee id — if provided uses /api/employees/:id/photo (admin/HR)
   *  If omitted uses /api/employees/me/photo (self-service) */
  employeeId?: string;
  /** Display name used for the avatar fallback initials */
  displayName?: string;
  /** Callback with the new avatar URL once upload succeeds */
  onSuccess?: (newUrl: string) => void;
  /** Allow delete? (admin / HR only) */
  canDelete?: boolean;
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
}

const sizeMap = {
  sm: "h-12 w-12",
  md: "h-16 w-16",
  lg: "h-24 w-24",
  xl: "h-32 w-32",
  "2xl": "h-40 w-40",
};

const cameraIconSizeMap = {
  sm: "h-3 w-3",
  md: "h-3.5 w-3.5",
  lg: "h-4 w-4",
  xl: "h-5 w-5",
  "2xl": "h-6 w-6",
};

function getInitials(name?: string) {
  if (!name) return "EMP";
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function getToken(): string | null {
  return (
    document.cookie
      .split("; ")
      .find((row) => row.startsWith("hrms_access_token="))
      ?.split("=")[1] ??
    localStorage.getItem("hrms_access_token") ??
    null
  );
}

async function readJsonSafely(res: Response): Promise<any> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return res.json();
  const text = await res.text();
  return { success: false, error: text || res.statusText };
}

function getCroppedBlob(
  image: HTMLImageElement,
  crop: Crop,
): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;
  canvas.width = CROP_OUTPUT_SIZE;
  canvas.height = CROP_OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);

  ctx.drawImage(
    image,
    (crop.x ?? 0) * scaleX,
    (crop.y ?? 0) * scaleY,
    (crop.width ?? 0) * scaleX,
    (crop.height ?? 0) * scaleY,
    0,
    0,
    CROP_OUTPUT_SIZE,
    CROP_OUTPUT_SIZE,
  );

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.92);
  });
}

export function PhotoUpload({
  currentUrl,
  employeeId,
  displayName,
  onSuccess,
  canDelete = false,
  size = "lg",
}: PhotoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Crop modal state
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [pendingSrc, setPendingSrc] = useState<string | null>(null);
  const [pendingFileName, setPendingFileName] = useState("");
  const [crop, setCrop] = useState<Crop>();

  const endpoint = employeeId
    ? `${API_BASE}/api/employees/${employeeId}/photo`
    : `${API_BASE}/api/employees/me/photo`;

  const deleteEndpoint = employeeId
    ? `${API_BASE}/api/employees/${employeeId}/photo`
    : null;

  const displayUrl = preview ?? normalizeFileUrl(currentUrl);

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget;
    const initialCrop = centerCrop(
      makeAspectCrop({ unit: "%", width: 80 }, 1, width, height),
      width,
      height,
    );
    setCrop(initialCrop);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!inputRef.current) return;
    inputRef.current.value = "";
    if (!file) return;

    setError(null);

    if (!ALLOWED_TYPES.has(file.type)) {
      setError("Only JPG, PNG, or WebP images are allowed.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Image must be under 15 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setPendingSrc(reader.result as string);
      setPendingFileName(file.name);
      setCropModalOpen(true);
    };
    reader.readAsDataURL(file);
  };

  const handleCropConfirm = async () => {
    if (!imgRef.current || !crop) return;

    const blob = await getCroppedBlob(imgRef.current, crop);
    if (!blob) {
      setError("Failed to crop image — please try again.");
      setCropModalOpen(false);
      return;
    }

    setCropModalOpen(false);

    // Show cropped preview immediately
    const croppedUrl = URL.createObjectURL(blob);
    setPreview(croppedUrl);

    // Upload
    setUploading(true);
    try {
      const form = new FormData();
      const ext = pendingFileName.split(".").pop() ?? "jpg";
      form.append("photo", blob, `cropped-photo.${ext}`);

      console.log("[PhotoUpload] Uploading photo to:", endpoint);
      const token = getToken();
      const res = await fetch(endpoint, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
        body: form,
      });

      const data = await readJsonSafely(res);
      console.log("[PhotoUpload] Server response:", { status: res.status, data });

      if (!res.ok || !data.success) {
        console.error("[PhotoUpload Error]", { status: res.status, data, endpoint });
        throw new Error(data.error ?? data.message ?? `Upload failed with status ${res.status}`);
      }
      const uploadedUrl = data.avatarUrl ?? data.photoUrl ?? data.url ?? "";
      // Add cache-busting timestamp to force browser to reload the image
      const cacheBustedUrl = uploadedUrl ? `${uploadedUrl}?t=${Date.now()}` : uploadedUrl;
      console.log("[PhotoUpload] Success! URL:", uploadedUrl, "Cache-busted:", cacheBustedUrl);
      setPreview(normalizeFileUrl(cacheBustedUrl) ?? cacheBustedUrl);
      onSuccess?.(uploadedUrl);
    } catch (err: any) {
      setError(err.message ?? "Upload failed — please try again.");
      setPreview(null);
    } finally {
      setUploading(false);
    }
  };

  const handleCropCancel = () => {
    setCropModalOpen(false);
    setPendingSrc(null);
    setCrop(undefined);
  };

  const handleDelete = async () => {
    if (!deleteEndpoint) return;
    setUploading(true);
    try {
      const token = getToken();
      const res = await fetch(deleteEndpoint, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
      });
      const data = await readJsonSafely(res);
      if (!res.ok || data.success === false) {
        throw new Error(data.error ?? data.message ?? `Delete failed with status ${res.status}`);
      }
      setPreview(null);
      onSuccess?.("");
    } catch (err: any) {
      setError(err.message ?? "Delete failed — please try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Avatar + overlay trigger */}
      <div className="group relative cursor-pointer" onClick={() => inputRef.current?.click()}>
        <Avatar className={cn(sizeMap[size], "ring-2 ring-offset-2 ring-slate-200")}>
          <AvatarImage src={displayUrl} alt={displayName ?? "Employee photo"} />
          <AvatarFallback className="font-bold text-white" style={{ background: "#1B6AB5" }}>
            {getInitials(displayName)}
          </AvatarFallback>
        </Avatar>

        {/* Hover overlay */}
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center rounded-full",
            "bg-black/40 opacity-0 transition-opacity group-hover:opacity-100",
            uploading && "opacity-100"
          )}
        >
          {uploading ? (
            <Loader2 className={cn(cameraIconSizeMap[size], "animate-spin text-white")} />
          ) : (
            <Camera className={cn(cameraIconSizeMap[size], "text-white")} />
          )}
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileChange}
        aria-label="Upload employee photo"
      />

      {/* Action buttons */}
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 rounded-lg border-white bg-white px-2.5 text-xs font-bold text-slate-700 hover:bg-blue-50 hover:text-[#073f78]"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          <Upload className="h-3 w-3" />
          {currentUrl || preview ? "Change Photo" : "Upload Photo"}
        </Button>

        {canDelete && (currentUrl || preview) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 rounded-lg px-2 text-xs text-red-500 hover:bg-red-50 hover:text-red-600"
            onClick={handleDelete}
            disabled={uploading}
          >
            <Trash2 className="h-3 w-3" />
            Remove
          </Button>
        )}
      </div>

      {/* Error message */}
      {error && (
        <p className="text-center text-xs text-red-500" role="alert">
          {error}
        </p>
      )}

      {/* Format hint */}
      <p className="text-center text-[11px] text-slate-400">
        JPG, PNG or WebP · max 15 MB
      </p>

      {/* ── Circular Crop Modal ── */}
      <Dialog open={cropModalOpen} onOpenChange={(open) => { if (!open) handleCropCancel(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-center">Adjust Photo</DialogTitle>
          </DialogHeader>
          <p className="text-center text-xs text-slate-500 -mt-2">
            Position your face inside the circle, then confirm.
          </p>
          <div className="flex justify-center py-3">
            {pendingSrc && (
              <ReactCrop
                crop={crop}
                onChange={(c) => setCrop(c)}
                aspect={1}
                circularCrop
                className="max-h-[320px] rounded-lg"
              >
                <img
                  ref={imgRef}
                  src={pendingSrc}
                  alt="Crop preview"
                  onLoad={onImageLoad}
                  style={{ maxHeight: 320, maxWidth: "100%" }}
                />
              </ReactCrop>
            )}
          </div>
          <div className="flex justify-center gap-3 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={handleCropCancel}
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="gap-1.5 bg-[#1B6AB5] hover:bg-[#155a9a]"
              onClick={handleCropConfirm}
            >
              <Check className="h-3.5 w-3.5" />
              Confirm & Upload
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
