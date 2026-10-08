import { describe, expect, it } from "vitest";
import { cleanName, displayFirstName } from "../he-name.js";

describe("he-name", () => {
  it("folds decorative unicode and accents", () => {
    expect(cleanName("Ñítîń Bhatia Bhãťîà Hàbŕí")).toBe("Nitin Bhatia Habri");
    expect(displayFirstName("𝓡𝓪𝓿𝓲 𝐊𝐮𝐦𝐚𝐫")).toBe("Ravi");
  });
  it("title-cases, drops emoji, honorifics and repeats", () => {
    expect(cleanName("  MR. RAHUL   rahul KUMAR 😊")).toBe("Rahul Kumar");
    expect(displayFirstName("pooja.singh_123")).toBe("Pooja");
  });
  it("falls back to 'there' when nothing usable", () => {
    expect(displayFirstName("")).toBe("there");
    expect(displayFirstName("😊😊 123")).toBe("there");
    expect(displayFirstName(null)).toBe("there");
  });
  it("drops markup and links typed into a name", () => {
    expect(cleanName("<img src=x onerror=alert(1)> Rohan")).toBe("Rohan");
    expect(cleanName("<b>Rohan</b> Kumar")).toBe("Rohan Kumar");
    expect(displayFirstName("http://spam.example/x")).toBe("there");
  });
  it("keeps non-latin scripts", () => {
    expect(displayFirstName("राहुल कुमार")).toBe("राहुल");
  });
});
