import { Download, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ExportButtonGroup({
  onCSV,
  onExcel,
  onPDF,
  onTemplate,
  onBankFile,
}: {
  onCSV?: () => void;
  onExcel?: () => void;
  onPDF?: () => void;
  onTemplate?: () => void;
  onBankFile?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {onCSV && <Button variant="outline" className="h-10 rounded-[var(--r-md)]" onClick={onCSV}><Download className="mr-2 h-4 w-4" />CSV</Button>}
      {onExcel && <Button variant="outline" className="h-10 rounded-[var(--r-md)]" onClick={onExcel}><Download className="mr-2 h-4 w-4" />Excel</Button>}
      {onPDF && <Button variant="outline" className="h-10 rounded-[var(--r-md)]" onClick={onPDF}><FileDown className="mr-2 h-4 w-4" />PDF</Button>}
      {onTemplate && <Button variant="outline" className="h-10 rounded-[var(--r-md)]" onClick={onTemplate}>Template</Button>}
      {onBankFile && <Button variant="outline" className="h-10 rounded-[var(--r-md)]" onClick={onBankFile}>Bank File</Button>}
    </div>
  );
}
