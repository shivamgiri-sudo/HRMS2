/**
 * DataError Empty State
 * Shown when quality data fetch fails
 */
import { AlertCircle, RefreshCw, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DataErrorProps {
  onRetry?: () => void;
}

export function DataError({ onRetry }: DataErrorProps) {
  const handleSupport = () => {
    window.location.href = "mailto:support@internal.local?subject=Quality%20Dashboard%20Error";
  };

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="mb-4">
        <div className="mx-auto h-16 w-16 rounded-full bg-red-100 flex items-center justify-center">
          <AlertCircle className="h-8 w-8 text-red-600" />
        </div>
      </div>
      <h3 className="text-lg font-semibold text-slate-900 mb-2">
        Quality data unavailable
      </h3>
      <p className="text-sm text-slate-500 mb-6 max-w-sm">
        We're having trouble loading your quality metrics. Please try again in 5 minutes or contact support.
      </p>
      <div className="flex gap-3 justify-center">
        {onRetry && (
          <Button
            onClick={onRetry}
            variant="outline"
            size="sm"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        )}
        <Button
          onClick={handleSupport}
          variant="outline"
          size="sm"
        >
          <Phone className="mr-2 h-4 w-4" />
          Support
        </Button>
      </div>
    </div>
  );
}
