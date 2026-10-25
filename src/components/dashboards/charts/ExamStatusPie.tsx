import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { BarChart3 } from "lucide-react";

interface ExamStatusPieProps {
  distribution: { name: string; value: number; color: string }[];
}

export function ExamStatusPie({ distribution }: ExamStatusPieProps) {
  const total = distribution.reduce((sum, d) => sum + d.value, 0);
  const filtered = distribution.filter(d => d.value > 0);

  if (total === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground text-sm">
          No exam data available
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-purple-50/50 to-transparent dark:from-purple-950/20" />
      <CardHeader className="relative pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-purple-500" />
          Exam Pipeline
        </CardTitle>
      </CardHeader>
      <CardContent className="relative">
        <div className="h-[180px] relative">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={filtered}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={75}
                paddingAngle={3}
                dataKey="value"
                strokeWidth={2}
                stroke="hsl(var(--card))"
              >
                {filtered.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number, name: string) => [`${value} exams`, name]}
                contentStyle={{ borderRadius: "8px", fontSize: "12px" }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <div className="text-2xl font-bold">{total}</div>
              <div className="text-[10px] text-muted-foreground">Total Exams</div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap justify-center gap-3 mt-2">
          {filtered.map((d, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
              <span className="text-muted-foreground">{d.name}: {d.value}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
