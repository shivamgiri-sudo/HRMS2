import { describe, expect, it } from "vitest";
import { cleanForSpeech, takeSpeakableSentences } from "../speechChunks";

/**
 * Ported from a manual verification run with tsx, because the frontend had no
 * test runner wired up at the time. Kept as the exact cases that mattered then:
 * decimals, percentages and version numbers must not be read as sentence
 * endings, and a whole answer fed one character at a time — the way a stream
 * actually delivers it — must still come out as whole sentences.
 */
describe("takeSpeakableSentences: numbers must not split", () => {
  it("does not break on a decimal point", () => {
    expect(takeSpeakableSentences("You have 11.5 days available. Next line").sentences).toEqual([
      "You have 11.5 days available.",
    ]);
  });

  it("does not break on a percentage", () => {
    expect(takeSpeakableSentences("That is 3.4% of days. Rest").sentences).toEqual([
      "That is 3.4% of days.",
    ]);
  });

  it("does not break on a version-like number", () => {
    expect(takeSpeakableSentences("Build 1.2.3 shipped. Rest").sentences).toEqual([
      "Build 1.2.3 shipped.",
    ]);
  });
});

describe("takeSpeakableSentences: real sentence endings", () => {
  it("splits two ordinary sentences", () => {
    expect(takeSpeakableSentences("Hello there. How can I help? ").sentences).toEqual([
      "Hello there.",
      "How can I help?",
    ]);
  });

  it("collapses an ellipsis into one ending", () => {
    expect(takeSpeakableSentences("Wait... Then go. ").sentences).toEqual(["Wait...", "Then go."]);
  });

  it("holds back an unfinished tail for the next chunk", () => {
    expect(takeSpeakableSentences("Done. And then").rest).toBe(" And then");
  });

  it("treats an abbreviation as not ending the sentence", () => {
    expect(takeSpeakableSentences("Ask Dr. Rao about it. ").sentences).toEqual([
      "Ask Dr. Rao about it.",
    ]);
  });
});

describe("takeSpeakableSentences: bullet lists", () => {
  it("treats a newline as closing a speakable unit", () => {
    expect(
      takeSpeakableSentences("- Casual Leave: 0.5 available\n- Earned Leave: 4 available\n").sentences,
    ).toEqual(["- Casual Leave: 0.5 available", "- Earned Leave: 4 available"]);
  });
});

describe("takeSpeakableSentences: fed the way a stream actually delivers text", () => {
  it("yields whole sentences when fed one character at a time", () => {
    const full = "You have 11.5 days available. Casual Leave is 0.5 days. How can I help?\n";
    let buffer = "";
    const spoken: string[] = [];
    for (const ch of full) {
      buffer += ch;
      const { sentences, rest } = takeSpeakableSentences(buffer);
      spoken.push(...sentences);
      buffer = rest;
    }
    expect(spoken).toEqual([
      "You have 11.5 days available.",
      "Casual Leave is 0.5 days.",
      "How can I help?",
    ]);
  });
});

describe("cleanForSpeech", () => {
  it("strips markdown symbols and reads currency aloud", () => {
    expect(cleanForSpeech("**Total**: ₹82,000 see https://x.co/y")).toBe(
      "Total : rupees 82,000 see",
    );
  });
});
