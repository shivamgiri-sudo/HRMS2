import type { ChangeEvent } from "react";
import type { SurveyQuestion } from "@/components/engagement/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface SurveyQuestionRendererProps {
  question: SurveyQuestion;
  value: string;
  setValue: (value: string) => void;
}

function parseOptions(options: SurveyQuestion["options_json"]): string[] {
  if (Array.isArray(options)) return options;
  if (typeof options !== "string") return [];
  try {
    const parsed = JSON.parse(options) as unknown;
    return Array.isArray(parsed) ? parsed.filter((option): option is string => typeof option === "string") : [];
  } catch {
    return [];
  }
}

export function SurveyQuestionRenderer({ question, value, setValue }: SurveyQuestionRendererProps) {
  const options = parseOptions(question.options_json);
  const common = {
    value,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setValue(event.target.value),
    required: question.is_required,
  };

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">{question.question_text}</label>
      {options.length > 0 ? (
        <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" {...common}>
          <option value="">Select an answer</option>
          {options.map((option) => <option key={option}>{option}</option>)}
        </select>
      ) : question.question_type === "rating" || question.question_type === "scale" ? (
        <Input type="number" min={question.scale_min ?? 1} max={question.scale_max ?? 10} {...common} />
      ) : (
        <Textarea {...common} />
      )}
    </div>
  );
}
