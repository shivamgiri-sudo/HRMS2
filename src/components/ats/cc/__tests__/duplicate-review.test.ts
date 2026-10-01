import { describe, expect, it } from "vitest";
import { cleanSuspects } from "../DuplicateReview";

describe("cleanSuspects", () => {
  it("keeps well-formed pairs and trims names", () => {
    expect(cleanSuspects([{ a: " Rahul K ", b: "Rahul Kumar", reason: "same surname" }])).toEqual([{ a: "Rahul K", b: "Rahul Kumar", reason: "same surname" }]);
  });
  it("drops pairs that name the same thing twice, ignoring case", () => {
    expect(cleanSuspects([{ a: "Neha", b: "neha", reason: "" }])).toEqual([]);
  });
  it("drops the mirror image of a pair it already has", () => {
    expect(cleanSuspects([{ a: "A Sharma", b: "Amit Sharma", reason: "x" }, { a: "Amit Sharma", b: "A Sharma", reason: "x" }])).toHaveLength(1);
  });
  it("tolerates junk input", () => {
    expect(cleanSuspects(undefined)).toEqual([]);
    expect(cleanSuspects([null, {}, { a: "x" }])).toEqual([]);
  });
});
