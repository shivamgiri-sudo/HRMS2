/**
 * A tiny, safe Markdown subset for the text widget. It returns data, never HTML: the renderer builds React elements
 * from it, so nothing the author types can become markup or an executable URL.
 */
export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "bold"; c: Inline[] }
  | { t: "italic"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] };
export type Block =
  | { t: "heading"; level: 1 | 2 | 3; c: Inline[] }
  | { t: "list"; ordered: boolean; items: Inline[][] }
  | { t: "paragraph"; c: Inline[] };

export const MAX_MARKDOWN_LENGTH = 5000;
const SAFE_URL = /^(https?:\/\/|mailto:)[^\s\u0000-\u001f]+$/i;
const TOKEN = /`([^`]+)`|\*\*([^*]+(?:\*(?!\*)[^*]+)*)\*\*|\*([^*\s](?:[^*]*[^*\s])?)\*|\[([^\]]+)\]\(([^)]*)\)/g;

export function parseInline(src: string, allowLinks = true): Inline[] {
  const out: Inline[] = [];
  const text = (v: string) => {
    if (!v) return;
    const last = out[out.length - 1];
    if (last && last.t === "text") last.v += v; else out.push({ t: "text", v });
  };
  let at = 0;
  for (const m of src.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    text(src.slice(at, i));
    at = i + m[0].length;
    if (m[1] !== undefined) out.push({ t: "code", v: m[1] });
    else if (m[2] !== undefined) out.push({ t: "bold", c: parseInline(m[2], allowLinks) });
    else if (m[3] !== undefined) out.push({ t: "italic", c: parseInline(m[3], allowLinks) });
    else {
      const href = (m[5] ?? "").trim();
      // Anything that is not http / https / mailto keeps only its label, as plain text.
      if (allowLinks && SAFE_URL.test(href)) out.push({ t: "link", href, c: parseInline(m[4], false) });
      else text(m[4]);
    }
  }
  text(src.slice(at));
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: Inline[][] } | null = null;
  const flush = () => {
    if (para.length) blocks.push({ t: "paragraph", c: parseInline(para.join(" ")) });
    if (list) blocks.push({ t: "list", ...list });
    para = []; list = null;
  };
  for (const raw of String(src ?? "").slice(0, MAX_MARKDOWN_LENGTH).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    if (h) { flush(); blocks.push({ t: "heading", level: h[1].length as 1 | 2 | 3, c: parseInline(h[2]) }); continue; }
    const b = /^[-*]\s+(.+)$/.exec(line), n = b ? null : /^\d{1,9}[.)]\s+(.+)$/.exec(line);
    const item = b ?? n;
    if (item) {
      const ordered = !b;
      if (para.length || (list && list.ordered !== ordered)) flush();
      list = list ?? { ordered, items: [] };
      list.items.push(parseInline(item[1]));
      continue;
    }
    if (list) flush();
    para.push(line);
  }
  flush();
  return blocks;
}
