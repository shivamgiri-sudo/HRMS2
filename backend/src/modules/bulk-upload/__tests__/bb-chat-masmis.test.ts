import { describe, it, expect } from "vitest";
import { importBbChatMasmisBatch } from "../bb-chat-masmis-bulk.service.js";

describe("exports", () => {
  it("exports importBbChatMasmisBatch as a function", () => {
    expect(typeof importBbChatMasmisBatch).toBe("function");
  });
});
