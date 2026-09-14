import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ExportButtonProps {
  apiUrl: string;
  filename: string;
  label?: string;
  className?: string;
  variant?: "default" | "outline" | "secondary" | "ghost";
}

export function ExportButton({
  apiUrl,
  filename,
  label = "Export",
  className,
  variant = "outline",
}: ExportButtonProps) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    setError(null);

    try {
      const res = await fetch(apiUrl);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      // Determine filename extension from Content-Type if needed
      const contentType = res.headers.get("content-type") ?? "";
      let resolvedFilename = filename;
      if (!filename.includes(".")) {
        if (contentType.includes("csv")) resolvedFilename += ".csv";
        else if (contentType.includes("json")) resolvedFilename += ".json";
        else if (contentType.includes("excel") || contentType.includes("spreadsheet")) {
          resolvedFilename += ".xlsx";
        } else {
          resolvedFilename += ".csv";
        }
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = resolvedFilename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Export failed.";
      setError(message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <Button
        variant={variant}
        size="sm"
        onClick={handleExport}
        disabled={exporting}
        className={cn("gap-2", className)}
      >
        {exporting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        {exporting ? "Exporting..." : label}
      </Button>
      {error && (
        <span className="text-xs text-red-600">{error}</span>
      )}
    </div>
  );
}
