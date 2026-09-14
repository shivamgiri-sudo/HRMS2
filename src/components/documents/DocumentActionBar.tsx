import { CheckCircle2, Download, Maximize2, RotateCw, ZoomIn, ZoomOut, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRotate: () => void;
  onFullscreen: () => void;
  onDownload: () => void;
  onVerify: () => void;
  onReject: () => void;
  busy?: boolean;
};

export function DocumentActionBar({ onZoomIn, onZoomOut, onRotate, onFullscreen, onDownload, onVerify, onReject, busy }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-3">
      <Button type="button" size="sm" variant="outline" onClick={onZoomOut} title="Zoom out"><ZoomOut className="h-4 w-4" /></Button>
      <Button type="button" size="sm" variant="outline" onClick={onZoomIn} title="Zoom in"><ZoomIn className="h-4 w-4" /></Button>
      <Button type="button" size="sm" variant="outline" onClick={onRotate} title="Rotate"><RotateCw className="h-4 w-4" /></Button>
      <Button type="button" size="sm" variant="outline" onClick={onFullscreen} title="Fullscreen"><Maximize2 className="h-4 w-4" /></Button>
      <Button type="button" size="sm" variant="outline" onClick={onDownload} title="Download"><Download className="h-4 w-4" /></Button>
      <div className="ml-auto flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onReject} disabled={busy}><XCircle className="mr-2 h-4 w-4" />Reject</Button>
        <Button type="button" size="sm" onClick={onVerify} disabled={busy}><CheckCircle2 className="mr-2 h-4 w-4" />Verify</Button>
      </div>
    </div>
  );
}
