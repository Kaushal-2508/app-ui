import { MySalaryPanel } from "@/components/hr/MySalaryPanel";
import { IndianRupee } from "lucide-react";

export default function MySalaryPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <IndianRupee className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">My Salary</h1>
          <p className="text-muted-foreground text-sm">View your payroll history and download salary slips</p>
        </div>
      </div>
      <MySalaryPanel />
    </div>
  );
}
