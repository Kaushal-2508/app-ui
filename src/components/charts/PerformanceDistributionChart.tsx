import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface DistributionData {
  range: string;
  count: number;
  color?: string;
}

interface PerformanceDistributionChartProps {
  data: DistributionData[];
  title?: string;
  description?: string;
  onBarClick?: (range: string) => void;
}

const defaultColors = [
  "hsl(0, 84%, 60%)",    // Red (0-30%)
  "hsl(38, 92%, 50%)",   // Orange (31-50%)
  "hsl(48, 96%, 53%)",   // Yellow (51-70%)
  "hsl(142, 71%, 45%)",  // Green (71-85%)
  "hsl(142, 76%, 36%)",  // Dark Green (86-100%)
];

export function PerformanceDistributionChart({ 
  data, 
  title = "Score Distribution",
  description = "Distribution of students across score ranges",
  onBarClick 
}: PerformanceDistributionChartProps) {
  const chartData = data.map((d, idx) => ({
    ...d,
    fill: d.color || defaultColors[idx] || defaultColors[0],
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis 
                dataKey="range" 
                tick={{ fontSize: 11 }}
                interval={0}
                angle={-15}
                textAnchor="end"
              />
              <YAxis 
                tick={{ fontSize: 12 }}
                allowDecimals={false}
                label={{ value: "Students", angle: -90, position: "insideLeft", fontSize: 12 }}
              />
              <Tooltip 
                formatter={(value: number) => [`${value} students`, "Count"]}
                labelFormatter={(label) => `Score Range: ${label}`}
                contentStyle={{
                  backgroundColor: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
              />
              <Bar 
                dataKey="count" 
                radius={[4, 4, 0, 0]}
                cursor={onBarClick ? "pointer" : "default"}
                onClick={(data) => onBarClick?.(data.range)}
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
