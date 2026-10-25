import { useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, Download } from "lucide-react";
import { printHtml, saveBlob } from "@/lib/native";

/** The html2pdf.js worker chain we use; the package ships no typings. */
type Html2PdfWorker = {
  set: (opts: Record<string, unknown>) => Html2PdfWorker;
  from: (el: HTMLElement) => Html2PdfWorker;
  outputPdf: (type: "blob") => Promise<Blob>;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The payroll entry fields this slip renders. */
type SalarySlipEntry = {
  staff_name: string;
  month: number;
  year: number;
  working_days: number;
  attendance_days: number;
  basic_salary: number;
  hra: number;
  da: number;
  ta: number;
  medical_allowance: number;
  special_allowance: number;
  gross_salary: number;
  net_salary: number;
  pf_deduction: number;
  esi_deduction: number;
  professional_tax: number;
  tds_deduction: number;
};

interface Props {
  entry: SalarySlipEntry;
  onClose: () => void;
}

export function SalarySlipViewer({ entry, onClose }: Props) {
  const slipRef = useRef<HTMLDivElement>(null);

  const fmt = (n: number) => `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
  const totalDeductions = entry.pf_deduction + entry.esi_deduction + entry.professional_tax + entry.tds_deduction;

  const handlePrint = () => {
    const content = slipRef.current;
    if (!content) return;
    const html = `<html><head><title>Salary Slip</title><style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px;text-align:left}.right{text-align:right}</style></head><body>${content.innerHTML}</body></html>`;
    // The popup used to stay open after printing; keep that.
    void printHtml(html, { closeAfter: false });
  };

  const handleDownload = async () => {
    const content = slipRef.current;
    if (!content) return;
    try {
      const html2pdf = (await import("html2pdf.js")).default as () => Html2PdfWorker;
      const filename = `Salary_Slip_${entry.staff_name}_${entry.month}_${entry.year}.pdf`;
      const blob: Blob = await html2pdf().set({
        margin: 10,
        filename,
        html2canvas: { scale: 2 },
      }).from(content).outputPdf("blob");
      saveBlob(blob, filename);
    } catch {
      handlePrint();
    }
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Salary Slip</DialogTitle>
        </DialogHeader>

        <div ref={slipRef} className="text-sm space-y-4 p-4 border rounded-lg">
          <div className="text-center border-b pb-3">
            <h2 className="text-lg font-bold">SALARY SLIP</h2>
            <p className="text-muted-foreground">{MONTHS[(entry.month || 1) - 1]} {entry.year}</p>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><strong>Employee:</strong> {entry.staff_name}</div>
            <div><strong>Working Days:</strong> {entry.working_days}</div>
            <div><strong>Attendance Days:</strong> {entry.attendance_days}</div>
          </div>

          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-muted/50">
                <th className="border p-2 text-left">Earnings</th>
                <th className="border p-2 text-right">Amount</th>
                <th className="border p-2 text-left">Deductions</th>
                <th className="border p-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2">Basic Salary</td>
                <td className="border p-2 text-right">{fmt(entry.basic_salary)}</td>
                <td className="border p-2">PF</td>
                <td className="border p-2 text-right">{fmt(entry.pf_deduction)}</td>
              </tr>
              <tr>
                <td className="border p-2">HRA</td>
                <td className="border p-2 text-right">{fmt(entry.hra)}</td>
                <td className="border p-2">ESI</td>
                <td className="border p-2 text-right">{fmt(entry.esi_deduction)}</td>
              </tr>
              <tr>
                <td className="border p-2">DA</td>
                <td className="border p-2 text-right">{fmt(entry.da)}</td>
                <td className="border p-2">Prof. Tax</td>
                <td className="border p-2 text-right">{fmt(entry.professional_tax)}</td>
              </tr>
              <tr>
                <td className="border p-2">TA</td>
                <td className="border p-2 text-right">{fmt(entry.ta)}</td>
                <td className="border p-2">TDS</td>
                <td className="border p-2 text-right">{fmt(entry.tds_deduction)}</td>
              </tr>
              <tr>
                <td className="border p-2">Medical</td>
                <td className="border p-2 text-right">{fmt(entry.medical_allowance)}</td>
                <td className="border p-2"></td>
                <td className="border p-2"></td>
              </tr>
              <tr>
                <td className="border p-2">Special</td>
                <td className="border p-2 text-right">{fmt(entry.special_allowance)}</td>
                <td className="border p-2"></td>
                <td className="border p-2"></td>
              </tr>
              <tr className="font-bold bg-muted/30">
                <td className="border p-2">Gross Salary</td>
                <td className="border p-2 text-right">{fmt(entry.gross_salary)}</td>
                <td className="border p-2">Total Deductions</td>
                <td className="border p-2 text-right">{fmt(totalDeductions)}</td>
              </tr>
            </tbody>
          </table>

          <div className="text-center border-t pt-3">
            <p className="text-base font-bold">Net Salary: {fmt(entry.net_salary)}</p>
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={handlePrint}><Printer className="h-4 w-4 mr-1" />Print</Button>
          <Button size="sm" onClick={handleDownload}><Download className="h-4 w-4 mr-1" />Download PDF</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
