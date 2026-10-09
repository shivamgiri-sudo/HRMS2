/** Error text that is safe to log: the first line only, e-mail addresses and phone-like digit runs removed, at most 200 characters. */
export function logText(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : (err as { message?: unknown })?.message ?? String(err);
  return String(raw ?? "").split("\n")[0]
    .replace(/[^\s@'"<>]+@[^\s@'"<>]+/g, "[email]")
    .replace(/\+?\d[\d\s-]{4,}\d/g, "#")
    .slice(0, 200);
}
