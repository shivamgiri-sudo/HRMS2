import { describe, expect, it } from "vitest";
import { DEFAULT_ASSESSMENT_TEMPLATES, publicTemplate } from "../assessment.catalog.js";

const processes = ["inbound", "outbound", "backoffice", "document", "email"] as const;
const roles = ["executive", "team_leader", "quality_auditor"] as const;

describe("default ATS assessment catalog", () => {
  it("contains every process and role combination", () => {
    expect(DEFAULT_ASSESSMENT_TEMPLATES).toHaveLength(15);
    const keys = new Set(
      DEFAULT_ASSESSMENT_TEMPLATES.map((template) => `${template.process}:${template.role}`),
    );
    for (const process of processes) {
      for (const role of roles) expect(keys.has(`${process}:${role}`)).toBe(true);
    }
  });

  it("contains a complete ten-question assessment for every combination", () => {
    for (const template of DEFAULT_ASSESSMENT_TEMPLATES) {
      expect(template.questions).toHaveLength(10);
      expect(new Set(template.questions.map((question) => question.id)).size).toBe(10);
      expect(template.instructions.length).toBeGreaterThanOrEqual(4);
      expect(template.passingPercentage).toBeGreaterThanOrEqual(60);
      expect(template.durationMinutes).toBeGreaterThanOrEqual(30);
      for (const question of template.questions) {
        expect(question.prompt.trim().length).toBeGreaterThan(15);
        expect(question.marks).toBeGreaterThan(0);
        if (question.type !== "text") {
          expect(question.options?.length).toBeGreaterThanOrEqual(4);
          expect(question.correctAnswer).toBeTruthy();
        }
      }
    }
  });

  it("requires typing only for backoffice, document, and email with exactly two attempts", () => {
    for (const template of DEFAULT_ASSESSMENT_TEMPLATES) {
      const shouldRequire = ["backoffice", "document", "email"].includes(template.process);
      expect(template.typing.required).toBe(shouldRequire);
      expect(template.typing.maxAttempts).toBe(2);
      expect(template.typing.passage.length).toBeGreaterThan(150);
    }
  });

  it("requires human review for leadership, quality, and email drafting scenarios", () => {
    for (const template of DEFAULT_ASSESSMENT_TEMPLATES) {
      const manualQuestions = template.questions.filter((question) => question.manualReview);
      if (template.role !== "executive" || template.process === "email") {
        expect(manualQuestions.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("never exposes answers, scoring keywords, explanations, or typing passages to candidates", () => {
    for (const template of DEFAULT_ASSESSMENT_TEMPLATES) {
      const safe = publicTemplate(template);
      expect("passage" in safe.typing).toBe(false);
      expect(JSON.stringify(safe)).not.toContain(template.typing.passage);
      for (const question of safe.questions) {
        expect("correctAnswer" in question).toBe(false);
        expect("keywords" in question).toBe(false);
        expect("explanation" in question).toBe(false);
      }
    }
  });
});
