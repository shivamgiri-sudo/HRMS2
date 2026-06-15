import { integrationFlags } from "@/integrations/config/integrationFlags";

export function getInitials(name?: string | null): string {
  const cleanName = (name || "Employee").trim();
  const parts = cleanName.split(/\s+/).filter(Boolean);

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] || "E"}${parts[1][0] || "M"}`.toUpperCase();
}

export function getDiceBearAvatarUrl(name?: string | null, style = "initials"): string | undefined {
  if (!integrationFlags.avatarFallback) return undefined;

  const seed = encodeURIComponent((name || "Employee").trim() || "Employee");
  return `https://api.dicebear.com/9.x/${style}/svg?seed=${seed}`;
}
