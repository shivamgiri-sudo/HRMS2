/**
 * NoCalls Empty State
 * Shown when agent has no calls yet
 */
import { InboxIcon, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function NoCalls() {
  const handleTrainingClick = () => {
    window.open("/lms", "_blank");
  };

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="mb-4">
        <div className="mx-auto h-16 w-16 rounded-full bg-slate-100 flex items-center justify-center">
          <InboxIcon className="h-8 w-8 text-slate-400" />
        </div>
      </div>
      <h3 className="text-lg font-semibold text-slate-900 mb-2">
        Your first calls will appear here
      </h3>
      <p className="text-sm text-slate-500 mb-6 max-w-sm">
        Once you complete your inbound call training and start handling calls, your call quality metrics will be displayed here.
      </p>
      <Button
        onClick={handleTrainingClick}
        className="bg-blue-600 hover:bg-blue-700 text-white"
        size="sm"
      >
        View Training
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}
