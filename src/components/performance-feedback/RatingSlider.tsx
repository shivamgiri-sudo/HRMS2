import React from "react";
import { Slider } from "@/components/ui/slider";

interface RatingSliderProps {
  value: number;
  onChange: (value: number) => void;
}

export function RatingSlider({ value, onChange }: RatingSliderProps) {
  const labels = ["Poor", "Below Avg", "Average", "Good", "Excellent"];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-sm font-medium text-gray-700">{labels[value - 1]}</span>
        <span className="text-sm font-semibold text-indigo-600">{value}/5</span>
      </div>
      <Slider
        min={1}
        max={5}
        step={1}
        value={[value]}
        onValueChange={([newValue]) => onChange(newValue)}
        className="cursor-pointer"
      />
      <div className="flex justify-between text-xs text-gray-400 px-1">
        {labels.map((label, idx) => (
          <span key={idx}>{idx + 1}</span>
        ))}
      </div>
    </div>
  );
}
