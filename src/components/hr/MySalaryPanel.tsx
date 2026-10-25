import { useState } from "react";
import { useMyPayroll } from "@/hooks/usePayroll";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SalarySlipViewer } from "./SalarySlipViewer";
import { IndianRupee, FileText } from "lucide-react";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function MySalaryPanel() {
  const { data: entries, isLoading } = useMyPayroll();
  const [slipEntry, setSlipEntry] = useState<any>(null);

  const fmt = (n: number) => `₹${Number(n).toLocaleString("en-IN")}`;

  if (isLoading) return <p className="text-muted-foreground text-sm">Loading...</p>;

  if (!entries || entries.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">
          <IndianRupee className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p>No salary records found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-foreground">My Salary History</h3>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Deductions</TableHead>
                <TableHead className="text-right">Net Salary</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e: any) => {
                const run = e.payroll_runs;
                const totalDeductions = e.pf_deduction + e.esi_deduction + e.professional_tax + e.tds_deduction;
                return (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">
                      {run ? `${MONTHS[run.month - 1]} ${run.year}` : "N/A"}
                    </TableCell>
                    <TableCell className="text-right">{fmt(e.gross_salary)}</TableCell>
                    <TableCell className="text-right">{fmt(totalDeductions)}</TableCell>
                    <TableCell className="text-right font-semibold">{fmt(e.net_salary)}</TableCell>
                    <TableCell>
                      <Badge variant={e.status === "paid" ? "default" : "secondary"}>{e.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setSlipEntry({
                            ...e,
                            staff_name: "My Salary",
                            month: run?.month,
                            year: run?.year,
                          })
                        }
                      >
                        <FileText className="h-4 w-4 mr-1" />Slip
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {slipEntry && <SalarySlipViewer entry={slipEntry} onClose={() => setSlipEntry(null)} />}
    </div>
  );
}
