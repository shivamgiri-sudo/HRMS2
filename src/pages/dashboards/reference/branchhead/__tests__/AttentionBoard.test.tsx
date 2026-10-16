import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BranchOverview } from "../../../../../../backend/src/modules/branch-head-health/types";
import { AttentionBoard, chipCount, sortAttention, MAX_CHIPS } from "../AttentionBoard";

type Item = BranchOverview["attention"][number];
const w = (label: string, detail = `${label} detail`): Item => ({ label, detail, severity: "warning" });
const c = (label: string, detail = `${label} detail`): Item => ({ label, detail, severity: "critical" });
const items: Item[] = [w("W1", "12 employees arrived late today"), c("C1", "95% of monthly budget consumed"), w("W2"), c("C2"), w("W3"), w("W4"), c("C3")];
const wins = [{ label: "Hiring on track", detail: "3 selected" }];
const html = (p: { items?: Item[]; positives?: typeof wins; open?: boolean } = {}) => renderToStaticMarkup(
  <AttentionBoard items={p.items ?? items} positives={p.positives ?? wins} onOpenItem={() => {}}
    drawerOpen={p.open} onDrawerChange={() => {}} inlineDrawer />,
);

describe("chipCount", () => {
  it("takes the first number in the text, keeping % and the rupee sign", () => {
    expect(chipCount("12 employees arrived late today")).toBe("12");
    expect(chipCount("95% of monthly budget consumed")).toBe("95%");
    expect(chipCount("22.5% absent today (8/100)")).toBe("22.5%");
    expect(chipCount("Oldest open GRN is 6 days old")).toBe("6");
    expect(chipCount("Revenue ₹1,20,000 vs cost")).toBe("₹1,20,000");
    expect(chipCount("All employees arrived on time today")).toBeNull();
    expect(chipCount("")).toBeNull();
  });
});

describe("AttentionBoard", () => {
  it("sorts critical before warning, keeping payload order within a severity", () => {
    expect(sortAttention(items).map((x) => x.item.label)).toEqual(["C1", "C2", "C3", "W1", "W2", "W3", "W4"]);
    expect(sortAttention(items)[0].id).toBe("attention-1");
  });
  it("shows at most 5 chips plus '+N more'", () => {
    const out = html();
    expect(MAX_CHIPS).toBe(5);
    expect(out.split('data-chip="').length - 1).toBe(5);
    expect(out).toContain("+2 more");
    for (const l of ["C1", "C2", "C3", "W1", "W2"]) expect(out).toContain(`>${l}<`);
    expect(out).not.toContain(">W4<");
    const order = ["C1", "C2", "C3", "W1", "W2"].map((l) => out.indexOf(`>${l}<`));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("chips carry icon, severity text and count, but not the detail text", () => {
    const out = html();
    expect(out).toContain("Critical");
    expect(out).toContain(">95%<");
    expect(out).not.toContain("95% of monthly budget consumed");
  });
  it("no '+N more' with 5 or fewer items", () => {
    expect(html({ items: items.slice(0, 5) })).not.toContain("more");
  });
  it("the drawer lists every item with its detail", () => {
    const out = html({ open: true });
    for (const it of items) { expect(out).toContain(`>${it.label}<`); expect(out).toContain(it.detail); }
    expect(out).toContain("Needs attention (7)");
  });
  it("wins sit in a collapsed details toggle", () => {
    const out = html();
    expect(out).toMatch(/<details(?![^>]*\bopen\b)[^>]*data-group="wins"/);
    expect(out).toContain("Hiring on track");
    expect(out).toContain("3 selected");
  });
  it("empty state when nothing to show", () => {
    expect(html({ items: [], positives: [] })).toContain("Nothing needs attention right now.");
  });
});
