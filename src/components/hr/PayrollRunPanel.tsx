import { useState } from "react";
import { usePayrollRuns, usePayrollEntries } from "@/hooks/usePayroll";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SalarySlipViewer } from "./SalarySlipViewer";
import { Plus, CheckCircle, Download } from "lucide-react";
import * as XLSX from "xlsx";
import { saveBlob } from "@/lib/native";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function PayrollRunPanel() {
  const { data: runs, isLoading, createRun, completeRun } = usePayrollRuns();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const { data: entries } = usePayrollEntries(selectedRunId || undefined);
  const [createOpen, setCreateOpen] = useState(false);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [slipEntry, setSlipEntry] = useState<any>(null);

  const handleCreate = () => {
    createRun.mutate({ month, year }, { onSuccess: () => setCreateOpen(false) });
  };

  const fmt = (n: number) => `₹${Number(n).toLocaleString("en-IN")}`;

  const exportToExcel = () => {
    if (!entries) return;
    const ws = XLSX.utils.json_to_sheet(entries.map((e: any) => ({
      Name: e.staff_name, Basic: e.basic_salary, HRA: e.hra, DA: e.da, TA: e.ta,
      Gross: e.gross_salary, PF: e.pf_deduction, ESI: e.esi_deduction,
      "Prof. Tax": e.professional_tax, TDS: e.tds_deduction, Net: e.net_salary, Status: e.status,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Payroll");
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    saveBlob(
      new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `Payroll_${month}_${year}.xlsx`,
    );
  };

  const selectedRun = runs?.find((r: any) => r.id === selectedRunId);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Payroll Runs</h3>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />New Payroll Run</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Payroll Run</DialogTitle></DialogHeader>
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Month</Label><Input type="number" min={1} max={12} value={month} onChange={e => setMonth(+e.target.value)} /></div>
                <div><Label>Year</Label><Input type="number" value={year} onChange={e => setYear(+e.target.value)} /></div>
              </div>
              <Button onClick={handleCreate} disabled={createRun.isPending}>{createRun.isPending ? "Creating..." : "Create & Calculate"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Run list */}
      {isLoading ? <p className="text-muted-foreground">Loading...</p> : (
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {(runs || []).map((r: any) => (
            <Card key={r.id} className={`cursor-pointer hover:shadow-md transition-shadow ${selectedRunId === r.id ? "ring-2 ring-primary" : ""}`} onClick={() => setSelectedRunId(r.id)}>
              <CardContent className="p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium">{MONTHS[r.month - 1]} {r.year}</p>
                    <p className="text-xs text-muted-foreground mt-1">Net: {fmt(r.total_net)}</p>
                  </div>
                  <Badge variant={r.status === "completed" ? "default" : "secondary"}>{r.status}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Entries for selected run */}
      {selectedRunId && entries && (
        <Card>
          <CardHeader className="flex-row justify-between items-center pb-2">
            <CardTitle className="text-base">Payroll Entries: {MONTHS[(selectedRun?.month || 1) - 1]} {selectedRun?.year}</CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={exportToExcel}><Download className="h-4 w-4 mr-1" />Excel</Button>
              {selectedRun?.status === "draft" && (
                <Button size="sm" onClick={() => completeRun.mutate(selectedRunId)}>
                  <CheckCircle className="h-4 w-4 mr-1" />Complete Run
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Deductions</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e: any) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">{e.staff_name}</TableCell>
                    <TableCell className="text-right">{fmt(e.gross_salary)}</TableCell>
                    <TableCell className="text-right">{fmt(e.pf_deduction + e.esi_deduction + e.professional_tax + e.tds_deduction)}</TableCell>
                    <TableCell className="text-right font-medium">{fmt(e.net_salary)}</TableCell>
                    <TableCell><Badge variant="outline">{e.status}</Badge></TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => setSlipEntry({ ...e, month: selectedRun?.month, year: selectedRun?.year })}>
                        Slip
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {slipEntry && <SalarySlipViewer entry={slipEntry} onClose={() => setSlipEntry(null)} />}
    </div>
  );
}
