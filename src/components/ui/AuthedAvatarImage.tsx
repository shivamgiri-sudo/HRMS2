import { useEffect, useState } from "react";
import { AvatarImage } from "@/components/ui/avatar";
import { apiBaseUrl } from "@/lib/apiBase";

const HRMS_BASE = apiBaseUrl();

function getToken(): string | null {
  return localStorage.getItem("hrms_access_token");
}

function resolveUrl(src: string): string {
  if (src.startsWith("http://") || src.startsWith("https://")) return src;
  return `${HRMS_BASE}${src}`;
}

interface AuthedAvatarImageProps {
  src?: string | null;
  alt?: string;
  className?: string;
}

/**
 * Drop-in replacement for shadcn/Radix <AvatarImage> for employee photos.
 * `/api/files/employee-photos/:filename` requires a Bearer session token
 * (SEC-04/SEC-08, 2026-07/09) that a plain <img>/<AvatarImage src> can never
 * send, so every employee avatar 401'd silently once the unauthenticated
 * shadow route in front of it was removed (SEC-08, 2026-09-11). This fetches
 * the image with the token instead and renders the result as a blob URL.
 *
 * Renders nothing while loading or on failure — same as Radix's own
 * not-yet-loaded/error state — so the sibling <AvatarFallback> shows through
 * exactly as it always has.
 *
 * A `src` that's already local (blob:/data:) — e.g. PhotoUpload's just-picked
 * preview before the server round-trip — is passed straight through with no
 * fetch, since it needs no auth and fetching it would just re-copy it.
 */
export function AuthedAvatarImage({ src, alt, className }: AuthedAvatarImageProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const isLocal = !!src && (src.startsWith("blob:") || src.startsWith("data:"));

  useEffect(() => {
    if (!src || isLocal) {
      setBlobUrl(null);
      return;
    }
    let cancelled = false;
    let localUrl: string | null = null;

    async function load() {
      const token = getToken();
      try {
        const res = await fetch(resolveUrl(src!), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        localUrl = URL.createObjectURL(blob);
        setBlobUrl(localUrl);
      } catch {
        if (!cancelled) setBlobUrl(null);
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, isLocal]);

  if (!src) return null;
  if (isLocal) return <AvatarImage src={src} alt={alt} className={className} />;
  if (!blobUrl) return null;
  return <AvatarImage src={blobUrl} alt={alt} className={className} />;
}
