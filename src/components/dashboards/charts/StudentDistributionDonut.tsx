import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { Users } from "lucide-react";

interface StudentDistributionDonutProps {
  needsAttention: number;
  developing: number;
  stable: number;
}

const COLORS = ["#EF4444", "#F59E0B", "#10B981"];

export function StudentDistributionDonut({ needsAttention, developing, stable }: StudentDistributionDonutProps) {
  const total = needsAttention + developing + stable;
  const data = [
    { name: "Needs Attention", value: needsAttention, color: COLORS[0] },
    { name: "Developing", value: developing, color: COLORS[1] },
    { name: "Stable", value: stable, color: COLORS[2] },
  ].filter(d => d.value > 0);

  if (total === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground text-sm">
          No student data available
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 to-transparent dark:from-blue-950/20" />
      <CardHeader className="relative pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Users className="h-4 w-4 text-blue-500" />
          Student Distribution
        </CardTitle>
      </CardHeader>
      <CardContent className="relative">
        <div className="h-[180px] relative">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={75}
                paddingAngle={3}
                dataKey="value"
                strokeWidth={2}
                stroke="hsl(var(--card))"
              >
                {data.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number, name: string) => [`${value} (${((value / total) * 100).toFixed(0)}%)`, name]}
                contentStyle={{ borderRadius: "8px", fontSize: "12px" }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <div className="text-2xl font-bold">{total}</div>
              <div className="text-[10px] text-muted-foreground">Students</div>
            </div>
          </div>
        </div>
        <div className="flex justify-center gap-4 mt-2">
          {data.map((d, i) => (
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
