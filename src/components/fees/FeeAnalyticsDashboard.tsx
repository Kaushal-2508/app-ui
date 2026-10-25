import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IndianRupee, TrendingUp, AlertTriangle, Users, Percent, FileSpreadsheet } from "lucide-react";
import { useFeeAnalytics } from "@/hooks/useFeeAnalytics";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import * as XLSX from "xlsx";
import { saveBlob } from "@/lib/native";

interface FeeAnalyticsDashboardProps {
  institutionId: string;
}

const COLORS = ["hsl(var(--primary))", "hsl(var(--destructive))", "hsl(var(--muted-foreground))", "#f59e0b", "#10b981", "#8b5cf6"];

export function FeeAnalyticsDashboard({ institutionId }: FeeAnalyticsDashboardProps) {
  const { analytics, categoryBreakdown, isLoading } = useFeeAnalytics(institutionId);

  const handleExport = () => {
    const summaryData = [{
      "Total Expected": analytics?.total_expected || 0,
      "Total Collected": analytics?.total_collected || 0,
      "Total Pending": analytics?.total_pending || 0,
      "Total Overdue": analytics?.total_overdue || 0,
      "Collection Rate (%)": analytics?.collection_rate || 0,
      "Defaulters": analytics?.defaulter_count || 0,
    }];
    const categoryData = categoryBreakdown.map(c => ({
      "Category": c.name,
      "Collected (₹)": c.collected,
      "Pending (₹)": c.pending,
      "Total (₹)": c.collected + c.pending,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryData), "Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(categoryData), "Category Breakdown");
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    saveBlob(
      new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      "Fee_Analytics_Report.xlsx",
    );
  };

  if (isLoading) return <p className="text-muted-foreground text-sm">Loading analytics...</p>;

  const kpis = [
    {
      title: "Total Expected",
      value: analytics?.total_expected || 0,
      icon: IndianRupee,
      format: "currency",
    },
    {
      title: "Total Collected",
      value: analytics?.total_collected || 0,
      icon: TrendingUp,
      format: "currency",
      color: "text-green-600",
    },
    {
      title: "Total Pending",
      value: analytics?.total_pending || 0,
      icon: IndianRupee,
      format: "currency",
      color: "text-amber-600",
    },
    {
      title: "Total Overdue",
      value: analytics?.total_overdue || 0,
      icon: AlertTriangle,
      format: "currency",
      color: "text-destructive",
    },
    {
      title: "Collection Rate",
      value: analytics?.collection_rate || 0,
      icon: Percent,
      format: "percent",
    },
    {
      title: "Defaulters",
      value: analytics?.defaulter_count || 0,
      icon: Users,
      format: "number",
      color: "text-destructive",
    },
  ];

  const pieData = categoryBreakdown.map(c => ({
    name: c.name,
    value: c.collected + c.pending,
  }));

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={handleExport}>
          <FileSpreadsheet className="h-4 w-4 mr-1" /> Export to Excel
        </Button>
      </div>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {kpis.map(kpi => (
          <Card key={kpi.title}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <kpi.icon className={`h-4 w-4 ${kpi.color || "text-muted-foreground"}`} />
                <p className="text-xs text-muted-foreground">{kpi.title}</p>
              </div>
              <p className={`text-xl font-bold ${kpi.color || ""}`}>
                {kpi.format === "currency"
                  ? `₹${Number(kpi.value).toLocaleString()}`
                  : kpi.format === "percent"
                  ? `${Number(kpi.value).toFixed(1)}%`
                  : Number(kpi.value).toLocaleString()}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Category Breakdown Bar Chart */}
        <Card>
          <CardHeader><CardTitle className="text-lg">Collection by Category</CardTitle></CardHeader>
          <CardContent>
            {categoryBreakdown.length === 0 ? (
              <p className="text-muted-foreground text-sm">No data yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={categoryBreakdown}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip formatter={(v: number) => `₹${v.toLocaleString()}`} />
                  <Bar dataKey="collected" name="Collected" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="pending" name="Pending" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Category Pie Chart */}
        <Card>
          <CardHeader><CardTitle className="text-lg">Fee Distribution</CardTitle></CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <p className="text-muted-foreground text-sm">No data yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => `₹${v.toLocaleString()}`} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
