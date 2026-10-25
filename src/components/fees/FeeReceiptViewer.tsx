import { useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, Download } from "lucide-react";
import { format } from "date-fns";
import { printHtml, saveBlob } from "@/lib/native";

/** The html2pdf.js worker chain we use; the package ships no typings. */
type Html2PdfWorker = {
  set: (opts: Record<string, unknown>) => Html2PdfWorker;
  from: (el: HTMLElement) => Html2PdfWorker;
  outputPdf: (type: "blob") => Promise<Blob>;
};

/**
 * The receipt fields this viewer renders. Callers hand over raw PostgREST rows
 * (with or without the profiles join), so the joined objects stay `unknown`
 * and are narrowed with `readText` below.
 */
type FeeReceipt = {
  receipt_number: string;
  payment_date: string;
  payment_method: string;
  amount: number | string;
  profiles?: unknown;
  receipt_data?: unknown;
};

function readText(obj: unknown, key: string): string | null {
  if (obj && typeof obj === "object" && key in obj) {
    const value = (obj as Record<string, unknown>)[key];
    return typeof value === "string" ? value : null;
  }
  return null;
}

interface FeeReceiptViewerProps {
  receipt: FeeReceipt | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FeeReceiptViewer({ receipt, open, onOpenChange }: FeeReceiptViewerProps) {
  const receiptRef = useRef<HTMLDivElement>(null);

  if (!receipt) return null;

  const studentName = readText(receipt.profiles, "full_name");
  const notes = readText(receipt.receipt_data, "notes");

  const handlePrint = () => {
    const content = receiptRef.current;
    if (!content) return;
    const html = `
      <html><head><title>Receipt ${receipt.receipt_number}</title>
      <style>
        body { font-family: system-ui, sans-serif; padding: 40px; max-width: 600px; margin: 0 auto; }
        table { width: 100%; border-collapse: collapse; margin: 16px 0; }
        td, th { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
        th { font-weight: 600; background: #f9fafb; }
        .header { text-align: center; margin-bottom: 24px; }
        .header h2 { margin: 0; font-size: 20px; }
        .header p { margin: 4px 0; color: #6b7280; font-size: 14px; }
        .amount { font-size: 24px; font-weight: 700; text-align: center; margin: 20px 0; }
        .footer { text-align: center; margin-top: 32px; color: #9ca3af; font-size: 12px; }
      </style></head><body>
      ${content.innerHTML}
      </body></html>
    `;
    void printHtml(html);
  };

  const handleDownload = async () => {
    const content = receiptRef.current;
    if (!content) return;
    try {
      const html2pdf = (await import("html2pdf.js")).default as () => Html2PdfWorker;
      const filename = `Receipt-${receipt.receipt_number}.pdf`;
      const blob: Blob = await html2pdf()
        .set({
          margin: 10,
          filename,
          html2canvas: { scale: 2 },
          jsPDF: { unit: "mm", format: "a5", orientation: "portrait" },
        })
        .from(content)
        .outputPdf("blob");
      saveBlob(blob, filename);
    } catch {
      handlePrint();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Fee Receipt</DialogTitle>
        </DialogHeader>
        <div ref={receiptRef} className="space-y-4 p-4">
          <div className="header text-center">
            <h2 className="text-xl font-bold">Fee Payment Receipt</h2>
            <p className="text-sm text-muted-foreground">Receipt #{receipt.receipt_number}</p>
          </div>

          <table className="w-full text-sm">
            <tbody>
              <tr>
                <td className="font-medium text-muted-foreground py-2">Student</td>
                <td className="py-2">{studentName || "N/A"}</td>
              </tr>
              <tr>
                <td className="font-medium text-muted-foreground py-2">Date</td>
                <td className="py-2">{format(new Date(receipt.payment_date), "dd MMM yyyy")}</td>
              </tr>
              <tr>
                <td className="font-medium text-muted-foreground py-2">Payment Method</td>
                <td className="py-2 capitalize">{receipt.payment_method}</td>
              </tr>
              <tr>
                <td className="font-medium text-muted-foreground py-2">Amount Paid</td>
                <td className="py-2 text-lg font-bold">₹{Number(receipt.amount).toLocaleString()}</td>
              </tr>
              {notes && (
                <tr>
                  <td className="font-medium text-muted-foreground py-2">Notes</td>
                  <td className="py-2">{notes}</td>
                </tr>
              )}
            </tbody>
          </table>

          <p className="footer text-center text-xs text-muted-foreground mt-4">
            This is a computer-generated receipt.
          </p>
        </div>

        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-1" /> Print
          </Button>
          <Button onClick={handleDownload}>
            <Download className="h-4 w-4 mr-1" /> Download PDF
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
