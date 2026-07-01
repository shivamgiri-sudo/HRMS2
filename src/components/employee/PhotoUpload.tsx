/**
 * PhotoUpload — click-to-upload employee avatar with preview,
 * progress indication, and 3 MB / jpg+png+webp validation.
 *
 * Usage:
 *   <PhotoUpload
 *     currentUrl={employee.avatar_url}
 *     employeeId={employee.id}       // omit for "me" (self-service)
 *     onSuccess={(url) => setAvatarUrl(url)}
 *   />
 */
import { useRef, useState } from "react";
import { Camera, Loader2, Trash2, Upload } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { normalizeMediaUrl } from "@/lib/mediaUrl";

const MAX_BYTES = 3 * 1024 * 1024; // 3 MB
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const API_BASE = (import.meta.env.VITE_HRMS_API_URL || import.meta.env.VITE_API_URL || "http://localhost:5055").replace(/\/$/, "");

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

export function PhotoUpload({
  currentUrl,
  employeeId,
  displayName,
  onSuccess,
  canDelete = false,
  size = "lg",
}: PhotoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endpoint = employeeId
    ? `${API_BASE}/api/employees/${employeeId}/photo`
    : `${API_BASE}/api/employees/me/photo`;

  const deleteEndpoint = employeeId
    ? `${API_BASE}/api/employees/${employeeId}/photo`
    : null;

  const displayUrl = preview ?? normalizeFileUrl(currentUrl);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!inputRef.current) return;
    inputRef.current.value = ""; // reset so same file re-triggers
    if (!file) return;

    setError(null);

    if (!ALLOWED_TYPES.has(file.type)) {
      setError("Only JPG, PNG, or WebP images are allowed.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Image must be under 3 MB.");
      return;
    }

    // Show local preview immediately
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(file);

    // Upload
    setUploading(true);
    try {
      const form = new FormData();
      form.append("photo", file);

      const token = getToken();
      const res = await fetch(endpoint, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
        body: form,
      });

      const data = await readJsonSafely(res);
      if (!res.ok || !data.success) {
        console.error("[PhotoUpload Error]", { status: res.status, data, endpoint });
        throw new Error(data.error ?? data.message ?? `Upload failed with status ${res.status}`);
      }
      // Keep showing the uploaded URL directly (Facebook pattern - optimistic)
      const uploadedUrl = data.avatarUrl ?? data.photoUrl ?? data.url ?? "";
      setPreview(normalizeFileUrl(uploadedUrl) ?? uploadedUrl);
      onSuccess?.(uploadedUrl);
    } catch (err: any) {
      setError(err.message ?? "Upload failed — please try again.");
      setPreview(null);
    } finally {
      setUploading(false);
    }
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

      {/* Action buttons (shown only when there's a photo or on hover-intent) */}
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
        JPG, PNG or WebP · max 3 MB
      </p>
    </div>
  );
}
