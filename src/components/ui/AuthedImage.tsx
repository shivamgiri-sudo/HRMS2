import { useEffect, useRef, useState } from "react";
import { apiBaseUrl } from "@/lib/apiBase";

interface AuthedImageProps {
  src: string;
  alt: string;
  className?: string;
  loading?: "eager" | "lazy";
}

// Categories served publicly — no auth header needed, plain <img> works
const PUBLIC_CATEGORIES = ["/api/files/company-feed/"];

function isPublicUrl(src: string): boolean {
  return PUBLIC_CATEGORIES.some((prefix) => src.includes(prefix));
}

function getToken(): string | null {
  return localStorage.getItem("hrms_access_token");
}

const HRMS_BASE = apiBaseUrl();

function resolveUrl(src: string): string {
  if (src.startsWith("http://") || src.startsWith("https://")) return src;
  return `${HRMS_BASE}${src}`;
}

function AuthedImagePrivate({ src, alt, className, loading = "lazy" }: AuthedImageProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [errored, setErrored] = useState(false);
  const prevUrl = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setErrored(false);
      const token = getToken();
      const resolved = resolveUrl(src);

      try {
        const res = await fetch(resolved, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        // Revoke previous object URL to free memory
        if (prevUrl.current) URL.revokeObjectURL(prevUrl.current);
        prevUrl.current = url;
        setObjectUrl(url);
      } catch {
        if (!cancelled) setErrored(true);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [src]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (prevUrl.current) URL.revokeObjectURL(prevUrl.current);
    };
  }, []);

  if (errored) {
    return (
      <div className={`flex items-center justify-center bg-slate-100 text-slate-400 text-xs ${className ?? ""}`}>
        Image unavailable
      </div>
    );
  }

  if (!objectUrl) {
    return <div className={`animate-pulse bg-slate-100 ${className ?? ""}`} aria-hidden="true" />;
  }

  return (
    <img
      src={objectUrl}
      alt={alt}
      loading={loading}
      className={className}
    />
  );
}

export function AuthedImage({ src, alt, className, loading = "lazy" }: AuthedImageProps) {
  if (isPublicUrl(src)) {
    return (
      <img
        src={resolveUrl(src)}
        alt={alt}
        loading={loading}
        className={className}
      />
    );
  }
  return <AuthedImagePrivate src={src} alt={alt} className={className} loading={loading} />;
}
