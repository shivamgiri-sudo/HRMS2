import type { ReactNode } from "react";
import { Heading, Type } from "lucide-react";
import type { Theme, VizProps } from "../types";
import type { VizDef } from "./def";
import { parseMarkdown, type Inline } from "./markdown";

function inline(nodes: Inline[], theme: Theme, prefix: string): ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${prefix}-${i}`;
    if (n.t === "text") return <span key={key}>{n.v}</span>;
    if (n.t === "code") return <code key={key} className="rounded px-1 py-0.5 font-mono text-[0.9em]" style={{ background: theme.grid, color: theme.text }}>{n.v}</code>;
    if (n.t === "bold") return <strong key={key} className="font-semibold">{inline(n.c, theme, key)}</strong>;
    if (n.t === "italic") return <em key={key}>{inline(n.c, theme, key)}</em>;
    return (
      <a key={key} href={n.href} target="_blank" rel="noopener noreferrer" className="cursor-pointer rounded underline focus:outline-none focus-visible:outline focus-visible:outline-2" style={{ color: theme.accent, outlineColor: theme.accent }}>
        {inline(n.c, theme, key)}
      </a>
    );
  });
}

function TextWidget({ style, theme }: VizProps) {
  const blocks = parseMarkdown(style.text ?? "");
  const scale = style.fontScale && style.fontScale > 0 ? style.fontScale : 1;
  if (!blocks.length) return <div className="flex h-full w-full items-center justify-center p-3 text-sm" style={{ color: theme.muted }}>Add text in the Style tab.</div>;
  return (
    <div className={`h-full w-full overflow-auto p-3 text-sm leading-relaxed ${style.align === "center" ? "text-center" : ""}`} style={{ color: theme.text, fontSize: `${0.875 * scale}rem` }}>
      {blocks.map((b, i) => {
        const key = `b${i}`;
        if (b.t === "heading") {
          const size = b.level === 1 ? "1.5em" : b.level === 2 ? "1.25em" : "1.1em";
          const H = b.level === 1 ? "h2" : b.level === 2 ? "h3" : "h4";
          return <H key={key} className="mb-2 mt-1 font-semibold leading-snug" style={{ fontSize: size, color: theme.text }}>{inline(b.c, theme, key)}</H>;
        }
        if (b.t === "list") {
          const L = b.ordered ? "ol" : "ul";
          return (
            <L key={key} className={`mb-2 pl-5 text-left ${b.ordered ? "list-decimal" : "list-disc"}`}>
              {b.items.map((it, j) => <li key={`${key}-${j}`}>{inline(it, theme, `${key}-${j}`)}</li>)}
            </L>
          );
        }
        return <p key={key} className="mb-2">{inline(b.c, theme, key)}</p>;
      })}
    </div>
  );
}

function HeaderWidget({ style, theme }: VizProps) {
  const scale = style.fontScale && style.fontScale > 0 ? style.fontScale : 1;
  const text = (style.text ?? "").trim();
  return (
    <div className={`flex h-full w-full flex-col justify-center overflow-hidden px-3 ${style.align === "center" ? "items-center text-center" : "items-start"}`}>
      <h2 className="max-w-full truncate font-semibold leading-tight" style={{ color: text ? theme.text : theme.muted, fontSize: `${1.5 * scale}rem` }}>{text || "Section header"}</h2>
      <div className="mt-1.5 h-1 w-16 rounded-full" style={{ background: theme.accent }} aria-hidden="true" />
    </div>
  );
}

export const CONTENT_VIZ: VizDef[] = [
  {
    type: "text", label: "Text", category: "Content", icon: Type, description: "Use to add notes, context or links next to your charts.",
    needs: { dims: [0, 0], measures: [0, 0] }, noQuery: true, defaultSize: { w: 4, h: 4 }, styleOptions: ["text"], Component: TextWidget,
  },
  {
    type: "header", label: "Section header", category: "Content", icon: Heading, description: "Use to title a group of widgets and split a dashboard into sections.",
    needs: { dims: [0, 0], measures: [0, 0] }, noQuery: true, defaultSize: { w: 12, h: 2 }, styleOptions: ["text"], Component: HeaderWidget,
  },
];
