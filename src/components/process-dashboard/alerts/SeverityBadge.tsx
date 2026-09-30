import { SEV_STYLE, SEV_TEXT } from "./alertUi";
import type { Severity } from "./api";

export function SeverityBadge({ s }: { s: Severity }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${SEV_STYLE[s]}`}>{SEV_TEXT[s]}</span>;
}
