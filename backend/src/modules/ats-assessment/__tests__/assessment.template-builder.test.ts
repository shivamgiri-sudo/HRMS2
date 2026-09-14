import { describe, expect, it } from "vitest";
import { validateCustomAssessmentTemplate } from "../assessment.template-builder.service.js";

function validTemplate() {
  return {
    code: "ats custom email executive",
    name: "Custom Email Executive Assessment",
    process: "email",
    role: "executive",
    experienceLevel: "any",
    durationMinutes: 30,
    passingPercentage: 60,
    difficulty: "intermediate",
    instructions: [
      "Submit the assessment only once.",
      "Do not copy or paste.",
    ],
    typing: {
      required: true,
      durationSeconds: 180,
      minNetWpm: 30,
      minAccuracy: 92,
      maxAttempts: 2,
      passage:
        "A professional email should identify the concern, acknowledge it with an appropriate tone, provide a complete response, explain the next step, avoid unsupported promises, and close politely so the customer can act with confidence.",
    },
    questions: [
      {
        id: "email-choice-1",
        sectionKey: "email",
        sectionTitle: "Email Handling",
        type: "single",
        prompt: "Which response provides the clearest next step for the customer?",
        options: ["Wait.", "We will update you by Friday at 4 PM.", "Soon.", "Try later."],
        correctAnswer: "We will update you by Friday at 4 PM.",
        marks: 10,
        difficulty: "intermediate",
      },
      {
        id: "email-written-1",
        sectionKey: "writing",
        sectionTitle: "Written Response",
        type: "text",
        prompt: "Draft a professional response for a delayed refund request.",
        keywords: ["concern", "review", "timeline"],
        marks: 20,
        difficulty: "advanced",
        manualReview: true,
      },
    ],
  };
}

describe("custom assessment template validation", () => {
  it("normalizes and accepts a complete template", () => {
    const result = validateCustomAssessmentTemplate(validTemplate());
    expect(result.code).toBe("ATS-CUSTOM-EMAIL-EXECUTIVE");
    expect(result.typing.maxAttempts).toBe(2);
    expect(result.questions).toHaveLength(2);
    expect(result.questions[1].manualReview).toBe(true);
  });

  it("rejects more or fewer than two typing attempts", () => {
    const input = validTemplate();
    input.typing.maxAttempts = 3;
    expect(() => validateCustomAssessmentTemplate(input)).toThrow(
      "Typing attempts must remain fixed at two",
    );
  });

  it("rejects duplicate question IDs", () => {
    const input = validTemplate();
    input.questions[1].id = input.questions[0].id;
    expect(() => validateCustomAssessmentTemplate(input)).toThrow(
      "invalid or duplicate ID",
    );
  });

  it("rejects a choice answer that is not one of its options", () => {
    const input = validTemplate();
    input.questions[0].correctAnswer = "An answer not shown";
    expect(() => validateCustomAssessmentTemplate(input)).toThrow(
      "correct answer must match an option",
    );
  });

  it("rejects an insufficient typing passage", () => {
    const input = validTemplate();
    input.typing.passage = "Too short";
    expect(() => validateCustomAssessmentTemplate(input)).toThrow(
      "80 to 5,000 characters",
    );
  });
});
