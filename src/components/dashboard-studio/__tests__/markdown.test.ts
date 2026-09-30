import { describe, expect, it } from "vitest";
import { MAX_MARKDOWN_LENGTH, parseMarkdown, type Block, type Inline } from "../viz/markdown";

const flat = (nodes: Inline[]): Inline[] => nodes.flatMap((n) => ("c" in n ? [n, ...flat(n.c)] : [n]));
const inlines = (blocks: Block[]): Inline[] => blocks.flatMap((b) => (b.t === "list" ? b.items.flatMap(flat) : flat(b.c)));
const textOf = (blocks: Block[]) => inlines(blocks).map((n) => ("v" in n ? n.v : "")).join("");

describe("parseMarkdown", () => {
  it("returns no blocks for empty input", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("  \n\n ")).toEqual([]);
  });

  it("parses headings at three levels", () => {
    const b = parseMarkdown("# One\n## Two\n### Three\n#### Four");
    expect(b.slice(0, 3).map((x) => (x.t === "heading" ? x.level : 0))).toEqual([1, 2, 3]);
    expect(b[3]).toEqual({ t: "paragraph", c: [{ t: "text", v: "#### Four" }] });
  });

  it("parses bullet and numbered lists as separate blocks", () => {
    const b = parseMarkdown("- a\n* b\n1. c\n2) d");
    expect(b).toEqual([
      { t: "list", ordered: false, items: [[{ t: "text", v: "a" }], [{ t: "text", v: "b" }]] },
      { t: "list", ordered: true, items: [[{ t: "text", v: "c" }], [{ t: "text", v: "d" }]] },
    ]);
  });

  it("joins consecutive lines into one paragraph and splits on blank lines", () => {
    const b = parseMarkdown("one\ntwo\n\nthree");
    expect(b).toEqual([{ t: "paragraph", c: [{ t: "text", v: "one two" }] }, { t: "paragraph", c: [{ t: "text", v: "three" }] }]);
  });

  it("parses bold, italic and code inline", () => {
    const [p] = parseMarkdown("a **bold** and *it* and `x*y`");
    expect(p).toEqual({ t: "paragraph", c: [
      { t: "text", v: "a " }, { t: "bold", c: [{ t: "text", v: "bold" }] }, { t: "text", v: " and " },
      { t: "italic", c: [{ t: "text", v: "it" }] }, { t: "text", v: " and " }, { t: "code", v: "x*y" },
    ] });
  });

  it("keeps http, https and mailto links", () => {
    const hrefs = inlines(parseMarkdown("[a](https://x.test/p?q=1) [b](http://y.test) [c](mailto:hr@x.test)")).filter((n) => n.t === "link").map((n) => (n.t === "link" ? n.href : ""));
    expect(hrefs).toEqual(["https://x.test/p?q=1", "http://y.test", "mailto:hr@x.test"]);
  });

  it("turns a javascript: link into inert text", () => {
    for (const src of ["[click](javascript:alert(1))", "[click](JaVaScRiPt:alert(1))", "[click]( javascript:alert(1))", "[click](data:text/html,x)", "[click](//evil.test)", "[click](https://ok.test javascript:x)"]) {
      const b = parseMarkdown(src);
      expect(inlines(b).some((n) => n.t === "link")).toBe(false);
      expect(textOf(b)).toContain("click");
    }
  });

  it("keeps raw <script> as plain text", () => {
    const b = parseMarkdown("<script>alert(1)</script> and <img src=x onerror=alert(1)>");
    expect(b).toEqual([{ t: "paragraph", c: [{ t: "text", v: "<script>alert(1)</script> and <img src=x onerror=alert(1)>" }] }]);
  });

  it("does not nest links inside a link label", () => {
    const links = inlines(parseMarkdown("[**b** [x](https://in.test)](https://out.test)")).filter((n) => n.t === "link");
    expect(links.length).toBeLessThanOrEqual(1);
  });

  it("caps input length", () => {
    const b = parseMarkdown("x".repeat(MAX_MARKDOWN_LENGTH + 500));
    expect(textOf(b)).toHaveLength(MAX_MARKDOWN_LENGTH);
  });

  it("leaves unbalanced markers as text", () => {
    expect(textOf(parseMarkdown("2 * 3 ** 4 and `open"))).toBe("2 * 3 ** 4 and `open");
  });
});
