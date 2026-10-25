import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { BookOpen } from "lucide-react";

interface SubjectRadarChartProps {
  data: { subject: string; average: number; fullMark: number }[];
}

export function SubjectRadarChart({ data }: SubjectRadarChartProps) {
  // Limit to top 8 subjects sorted by average descending
  const limitedData = [...data]
    .sort((a, b) => b.average - a.average)
    .slice(0, 8)
    .map((d) => ({
      ...d,
      subject: d.subject.length > 8 ? d.subject.slice(0, 8) + "…" : d.subject,
    }));

  if (limitedData.length < 2) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground text-sm">
          Need at least 2 subjects for radar chart
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/40 to-transparent dark:from-indigo-950/20" />
      <CardHeader className="relative pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-indigo-500" />
          Subject Performance Comparison
        </CardTitle>
      </CardHeader>
      <CardContent className="relative">
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart cx="50%" cy="50%" outerRadius="65%" data={limitedData}>
              <defs>
                <linearGradient id="radarFillGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#818CF8" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#6366F1" stopOpacity={0.15} />
                </linearGradient>
              </defs>
              <PolarGrid stroke="hsl(var(--border))" />
              <PolarAngleAxis
                dataKey="subject"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              />
              <PolarRadiusAxis
                angle={90}
                domain={[0, 100]}
                tick={{ fontSize: 9 }}
                tickCount={5}
              />
              <Radar
                name="Average"
                dataKey="average"
                stroke="#6366F1"
                fill="url(#radarFillGrad)"
                fillOpacity={1}
                strokeWidth={2}
              />
              <Tooltip
                formatter={(value: number) => [`${value.toFixed(1)}%`, "Average"]}
                contentStyle={{ borderRadius: "8px", fontSize: "12px" }}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
