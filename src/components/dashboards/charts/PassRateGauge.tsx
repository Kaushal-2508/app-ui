import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadialBarChart, RadialBar, ResponsiveContainer } from "recharts";
import { CheckCircle } from "lucide-react";

interface PassRateGaugeProps {
  passRate: number;
}

export function PassRateGauge({ passRate }: PassRateGaugeProps) {
  const color = passRate >= 70 ? "#10B981" : passRate >= 50 ? "#F59E0B" : "#EF4444";
  const bgColor = passRate >= 70 ? "#10B98120" : passRate >= 50 ? "#F59E0B20" : "#EF444420";
  
  const data = [
    { name: "Pass Rate", value: passRate, fill: color },
  ];

  return (
    <Card className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-green-50/50 to-transparent dark:from-green-950/20" />
      <CardHeader className="relative pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <CheckCircle className="h-4 w-4 text-green-500" />
          Pass Rate
        </CardTitle>
      </CardHeader>
      <CardContent className="relative">
        <div className="h-[180px] relative">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              cx="50%"
              cy="50%"
              innerRadius="60%"
              outerRadius="85%"
              startAngle={210}
              endAngle={-30}
              data={data}
              barSize={14}
            >
              <RadialBar
                dataKey="value"
                cornerRadius={8}
                background={{ fill: bgColor }}
                max={100}
              />
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <div className="text-3xl font-bold" style={{ color }}>{passRate.toFixed(0)}%</div>
              <div className="text-[10px] text-muted-foreground">of students pass</div>
            </div>
          </div>
        </div>
        <div className="flex justify-center gap-3 mt-1">
          <span className="text-[10px] text-red-500">● &lt;50%</span>
          <span className="text-[10px] text-amber-500">● 50-70%</span>
          <span className="text-[10px] text-green-500">● &gt;70%</span>
        </div>
      </CardContent>
    </Card>
  );
}
