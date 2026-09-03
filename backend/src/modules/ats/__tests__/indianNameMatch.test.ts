/**
 * Name matching that survives how Indian names are actually written.
 *
 * The fraud control this supports compares the name a bank returns for an
 * account against the candidate's registered identity. That comparison is only
 * useful if it separates "different spelling of the same person" from
 * "different person" — otherwise it either waves through Y's account (the fraud)
 * or blocks thousands of genuine joiners (the bigger operational harm).
 *
 * The existing matchers cannot do this. There are four near-duplicate copies
 * (bgv-provider.adapter, bgv-verification.service, bgv.enhanced.service,
 * name-consistency.routes); the strictest requires an exact token-set match, so
 * "PRIYA SHARMA" and "PRIYA SHARMA E" are treated as different people, and none
 * handles initials, honorifics or S/O suffixes at all.
 *
 * The cases below are the ones that actually occur: a bank holding an expanded
 * name, an initial where the ID has the full given name, an honorific, an S/O
 * suffix, and — the one that matters most — two different people who happen to
 * share one of India's most common surnames.
 */
import { describe, it, expect } from "vitest";
import { classifyNameMatch, normalizeIndianName } from "../indian-name-match.js";

describe("normalizeIndianName", () => {
  it("strips honorifics", () => {
    expect(normalizeIndianName("Mr. Rajesh Kumar")).toBe("rajesh kumar");
    expect(normalizeIndianName("SMT. PRIYA SHARMA")).toBe("priya sharma");
    expect(normalizeIndianName("Late Ramesh Chand")).toBe("ramesh chand");
  });

  it("drops relational suffixes the bank sometimes carries", () => {
    expect(normalizeIndianName("RAJESH KUMAR S/O RAMESH KUMAR")).toBe("rajesh kumar");
    expect(normalizeIndianName("PRIYA SHARMA W/O ANIL SHARMA")).toBe("priya sharma");
  });

  it("removes punctuation and collapses whitespace", () => {
    expect(normalizeIndianName("  RAJESH   KUMAR.  ")).toBe("rajesh kumar");
  });
});

describe("classifyNameMatch — the same person, written differently", () => {
  const same: Array<[string, string, string]> = [
    ["RAJESH KUMAR", "RAJESH KUMAR", "identical"],
    ["Mr Rajesh Kumar", "RAJESH KUMAR", "honorific on one side"],
    ["RAJESH KUMAR", "KUMAR RAJESH", "tokens reordered"],
    ["RAJESH KUMAR S/O RAMESH", "RAJESH KUMAR", "S/O suffix on the bank record"],
  ];
  for (const [a, b, why] of same) {
    it(`treats "${a}" and "${b}" as the same person (${why})`, () => {
      expect(classifyNameMatch(a, b).tier).toBe("exact");
    });
  }

  const variants: Array<[string, string, string]> = [
    ["RAJESH KUMAR", "RAJESH KUMAR SINGH", "bank holds the fuller name"],
    ["PRIYA SHARMA", "PRIYA SHARMA E", "trailing initial on the bank record"],
    ["R KUMAR", "RAJESH KUMAR", "ID initial, bank expanded"],
    ["ROHIT", "ROHIT KUMAR", "single given name on one side"],
  ];
  for (const [a, b, why] of variants) {
    it(`accepts "${a}" vs "${b}" (${why})`, () => {
      const result = classifyNameMatch(a, b);
      // What matters is that it is not treated as a fraud signal — this is the
      // case that would otherwise strand genuine joiners. Whether it lands on
      // "exact" or "variant" depends on whether the difference was an initial
      // or a whole word, and either is a correct answer.
      expect(result.suspicious, `${result.tier}: ${result.reason}`).toBe(false);
      expect(["exact", "variant"]).toContain(result.tier);
    });
  }
});

describe("classifyNameMatch — Gujarati naming", () => {
  // Given name + father's name + surname, and the father's name is routinely
  // abbreviated to an initial on bank records.
  const cases: Array<[string, string, string]> = [
    ["DHAVAL RAMESHBHAI PATEL", "DHAVAL R PATEL", "father's name abbreviated by the bank"],
    ["RAMESHBHAI PATEL", "RAMESH PATEL", "-bhai present on one side only"],
    ["KOKILABEN SHAH", "KOKILA SHAH", "-ben present on one side only"],
    ["DHAVAL RAMESHBHAI PATEL", "PATEL DHAVAL RAMESHBHAI", "surname written first"],
  ];
  for (const [a, b, why] of cases) {
    it(`accepts "${a}" vs "${b}" (${why})`, () => {
      const result = classifyNameMatch(a, b);
      expect(result.suspicious, `${result.tier}: ${result.reason}`).toBe(false);
    });
  }
});

describe("classifyNameMatch — South Indian naming", () => {
  // Initials lead and expand to the father's name or house name, so the
  // identifying word is the last token, not the first. Telugu names often put
  // the surname first. Tamil names frequently have no surname at all.
  const cases: Array<[string, string, string]> = [
    ["S SRINIVASAN", "SRINIVASAN", "leading initial absent from the bank record"],
    ["SRINIVASAN", "S SRINIVASAN", "and the same the other way round"],
    ["K V RAMESH", "RAMESH", "two leading initials"],
    ["R KARTHIK", "KARTHIK RAJAN", "initial expanded to the father's name"],
    ["SRINIVASA PRASAD BELLAPPU", "BELLAPPU SRINIVASA PRASAD", "Telugu surname-first ordering"],
    ["VINOD KUMAR", "KALATHIL VINOD KUMAR", "Kerala house name prefixed"],
  ];
  for (const [a, b, why] of cases) {
    it(`accepts "${a}" vs "${b}" (${why})`, () => {
      const result = classifyNameMatch(a, b);
      expect(result.suspicious, `${result.tier}: ${result.reason}`).toBe(false);
    });
  }

  it("still separates two different South Indian names", () => {
    expect(classifyNameMatch("S SRINIVASAN", "S RAMACHANDRAN").suspicious).toBe(true);
    expect(classifyNameMatch("K V RAMESH", "K V SURESH").suspicious).toBe(true);
  });
});

describe("classifyNameMatch — genuinely different people", () => {
  it("a shared common surname alone is not evidence of the same person", () => {
    // Millions share KUMAR. Overlap on it must not read as a match, which a
    // plain token-overlap score would do at 50%.
    const result = classifyNameMatch("SURESH KUMAR", "RAJESH KUMAR");
    expect(result.tier).toBe("weak");
    expect(result.suspicious).toBe(true);
  });

  it("the same holds for SINGH, DEVI and SHARMA", () => {
    for (const [a, b] of [
      ["AMIT SINGH", "VIKRAM SINGH"],
      ["SUNITA DEVI", "KAVITA DEVI"],
      ["ANIL SHARMA", "SUNIL SHARMA"],
    ]) {
      expect(classifyNameMatch(a, b).suspicious, `${a} vs ${b}`).toBe(true);
    }
  });

  it("completely different names are the strongest signal", () => {
    const result = classifyNameMatch("HARSH THAKUR", "PRIYA SHARMA");
    expect(result.tier).toBe("none");
    expect(result.suspicious).toBe(true);
  });

  it("a differing given name is suspicious even when the surname matches exactly", () => {
    // This is the fraud shape: X uses Y's account, and they are relatives.
    expect(classifyNameMatch("RAJESH THAKUR", "HARSH THAKUR").suspicious).toBe(true);
  });

  it("an initial must match the letter it stands for", () => {
    expect(classifyNameMatch("S KUMAR", "RAJESH KUMAR").suspicious).toBe(true);
  });
});

describe("classifyNameMatch — missing data", () => {
  it("cannot conclude anything when either side is blank", () => {
    for (const [a, b] of [["", "RAJESH KUMAR"], ["RAJESH KUMAR", ""], ["", ""]]) {
      const result = classifyNameMatch(a, b);
      expect(result.tier).toBe("unknown");
      // Absent data is not evidence of fraud; it is a reason to ask a human.
      expect(result.suspicious).toBe(false);
    }
  });
});

/**
 * Spelling, not identity.
 *
 * A name reaches us transliterated, so the bank, the PAN and our own record
 * routinely spell one name three ways. Comparing the letters as typed made a
 * single letter decisive: on 2026-09-03 a candidate whose bank held
 * "Mr. RAHUL  CHHAPANE" against a record reading "RAHUL GAUTAM RAO CHHAPANEY"
 * scored 25/100, went to manual review, and was then refused permission to save
 * his own bank account ten times over — each refusal costing a real penny drop.
 *
 * The tolerance is bounded on purpose. It folds away letters that carry no
 * sound; it does NOT forgive a substituted consonant, because that is what
 * separates two people who are otherwise spelled alike.
 */
describe("classifyNameMatch — transliterated spelling", () => {
  it("clears the live case: one trailing letter apart", () => {
    const result = classifyNameMatch("RAHUL GAUTAM RAO CHHAPANEY", "Mr. RAHUL  CHHAPANE");
    expect(result.suspicious).toBe(false);
    expect(result.tier).toBe("variant");
  });

  it("forgives doubled letters, long vowels and a y written for i", () => {
    expect(classifyNameMatch("PRAVEEN KUMAAR SHARMA", "PRAVIN KUMAR SHARMA").suspicious).toBe(false);
    expect(classifyNameMatch("SANGEETA DEVI", "SANGITA DEVI").suspicious).toBe(false);
    expect(classifyNameMatch("BHATT MEHUL", "BHAT MEHUL").suspicious).toBe(false);
  });

  it("forgives one vowel inside a long name", () => {
    expect(classifyNameMatch("MOHAMMED ALI", "MOHAMMAD ALI").suspicious).toBe(false);
  });

  it("still separates two people one CONSONANT apart", () => {
    // The pair that rules out a plain edit-distance tolerance.
    expect(classifyNameMatch("RAMESH KUMAR", "RAKESH KUMAR").suspicious).toBe(true);
  });

  it("still separates short given names that differ only in their last vowel", () => {
    expect(classifyNameMatch("RITA SHARMA", "RITU SHARMA").suspicious).toBe(true);
    expect(classifyNameMatch("ANITA SINGH", "ANIL SINGH").suspicious).toBe(true);
  });

  it("never scores above 100 when one word matches under two spellings", () => {
    // Both sides contributed the matched word to the same set, so the old
    // count divided 3 matches by 2 words and reported 150.
    const result = classifyNameMatch("MOHAMMED ALI", "MOHAMMAD ALI");
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("a common surname spelled differently is still not distinctive on its own", () => {
    expect(classifyNameMatch("RAJESH KUMAAR", "HARSH KUMAR").suspicious).toBe(true);
  });
});
