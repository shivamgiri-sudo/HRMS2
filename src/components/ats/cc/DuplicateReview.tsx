import { Loader2, Users2 } from "lucide-react";
import { Empty } from "@/components/ats/overview/viz";
import { Card, ExportButton, downloadCsv } from "./cc-kit";

export interface NameSuspect { a: string; b: string; reason: string }

/** Pure: keep well-formed pairs only, drop pairs naming the same string twice, and de-duplicate A/B vs B/A. */
export function cleanSuspects(raw: unknown): NameSuspect[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>(), out: NameSuspect[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const a = String(r?.a ?? "").trim(), b = String(r?.b ?? "").trim();
    if (!a || !b || a.toLowerCase() === b.toLowerCase()) continue;
    const key = [a.toLowerCase(), b.toLowerCase()].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key); out.push({ a, b, reason: String(r?.reason ?? "").trim() });
  }
  return out;
}

/**
 * Recruiter names that may be one person under two spellings. It is a review list: the page has no merge action, because
 * merging rewrites candidate ownership and belongs with a data administrator.
 */
export function DuplicateReview({ suspects, loading, error, forbidden, onRetry, i = 0 }: { suspects?: NameSuspect[]; loading: boolean; error: boolean; forbidden?: boolean; onRetry: () => void; i?: number }) {
  return (
    <Card i={i} title="Possible duplicate recruiter names" hint="Names that may be one person under two spellings. Hand this list to a data administrator to merge." icon={<Users2 className="h-4 w-4" />}
      right={suspects && suspects.length > 0 && <ExportButton onClick={() => downloadCsv("ats-recruiter-name-suspects.csv", ["Name A", "Name B", "Why they look alike"], suspects.map((s) => [s.a, s.b, s.reason]))} />}>
      {loading ? <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Checking recruiter names</div>
        : forbidden ? <Empty text="The recruiter name review is limited to head-office roles" />
        : error ? <div role="alert" className="py-6 text-sm text-red-600 dark:text-red-300">Could not load the review list. <button onClick={onRetry} className="cursor-pointer font-semibold underline">Try again</button></div>
        : !suspects || suspects.length === 0 ? <Empty text="No recruiter names look like duplicates" />
        : (
          <div className="max-h-80 overflow-auto rounded-xl border">
            <table className="w-full min-w-[460px] text-sm"><thead className="sticky top-0 bg-muted/80 text-left text-xs text-muted-foreground backdrop-blur"><tr><th className="px-3 py-2 font-medium">Name A</th><th className="px-3 font-medium">Name B</th><th className="px-3 font-medium">Why</th></tr></thead>
              <tbody>{suspects.map((s) => <tr key={`${s.a}|${s.b}`} className="border-t"><td className="px-3 py-1.5 font-medium">{s.a}</td><td className="px-3 font-medium">{s.b}</td><td className="px-3 text-xs text-muted-foreground">{s.reason || "Similar spelling"}</td></tr>)}</tbody></table>
          </div>
        )}
    </Card>
  );
}
