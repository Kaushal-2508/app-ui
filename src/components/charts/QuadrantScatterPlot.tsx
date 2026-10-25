import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { 
  ScatterChart, 
  Scatter, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  ReferenceLine,
  Label
} from "recharts";

interface ScatterDataPoint {
  name: string;
  x: number;
  y: number;
  id?: string;
}

interface QuadrantScatterPlotProps {
  data: ScatterDataPoint[];
  title?: string;
  description?: string;
  xLabel?: string;
  yLabel?: string;
  xMidline?: number;
  yMidline?: number;
  quadrantLabels?: {
    topLeft: string;
    topRight: string;
    bottomLeft: string;
    bottomRight: string;
  };
  onPointClick?: (point: ScatterDataPoint) => void;
}

const defaultQuadrantLabels = {
  topLeft: "Slow & Accurate",
  topRight: "Fast & Accurate",
  bottomLeft: "Slow & Inaccurate",
  bottomRight: "Fast & Inaccurate",
};

export function QuadrantScatterPlot({
  data,
  title = "Time vs Accuracy Analysis",
  description = "Each dot represents a data point",
  xLabel = "Time (seconds)",
  yLabel = "Accuracy %",
  xMidline,
  yMidline,
  quadrantLabels = defaultQuadrantLabels,
  onPointClick,
}: QuadrantScatterPlotProps) {
  // Calculate midlines if not provided
  const avgX = xMidline ?? (data.length > 0 
    ? data.reduce((sum, d) => sum + d.x, 0) / data.length 
    : 50);
  const avgY = yMidline ?? (data.length > 0 
    ? data.reduce((sum, d) => sum + d.y, 0) / data.length 
    : 50);

  // Determine point color based on quadrant
  const getPointColor = (x: number, y: number) => {
    if (y >= avgY && x <= avgX) return "hsl(142, 71%, 45%)"; // Top Left - Green
    if (y >= avgY && x > avgX) return "hsl(142, 71%, 45%)"; // Top Right - Green
    if (y < avgY && x <= avgX) return "hsl(0, 84%, 60%)"; // Bottom Left - Red
    return "hsl(38, 92%, 50%)"; // Bottom Right - Orange
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 30, right: 30, bottom: 30, left: 30 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis 
                type="number" 
                dataKey="x" 
                name={xLabel}
                tick={{ fontSize: 12 }}
                domain={['auto', 'auto']}
              >
                <Label value={xLabel} position="bottom" offset={10} fontSize={12} />
              </XAxis>
              <YAxis 
                type="number" 
                dataKey="y" 
                name={yLabel}
                domain={[0, 100]}
                tick={{ fontSize: 12 }}
              >
                <Label value={yLabel} angle={-90} position="left" offset={10} fontSize={12} />
              </YAxis>
              
              {/* Reference lines for quadrants */}
              <ReferenceLine 
                x={avgX} 
                stroke="hsl(var(--muted-foreground))" 
                strokeDasharray="5 5" 
                strokeWidth={1}
              />
              <ReferenceLine 
                y={avgY} 
                stroke="hsl(var(--muted-foreground))" 
                strokeDasharray="5 5" 
                strokeWidth={1}
              />
              
              <Tooltip 
                cursor={{ strokeDasharray: '3 3' }}
                formatter={(value: number, name: string) => [
                  name === "y" ? `${value.toFixed(1)}%` : `${value.toFixed(1)}s`,
                  name === "y" ? yLabel : xLabel
                ]}
                labelFormatter={(_, payload) => payload[0]?.payload?.name || "Point"}
                contentStyle={{
                  backgroundColor: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
              />
              
              <Scatter 
                data={data} 
                cursor={onPointClick ? "pointer" : "default"}
                onClick={(data) => onPointClick?.(data as ScatterDataPoint)}
              >
                {data.map((entry, index) => (
                  <circle
                    key={`point-${index}`}
                    cx={0}
                    cy={0}
                    r={6}
                    fill={getPointColor(entry.x, entry.y)}
                    stroke="hsl(var(--background))"
                    strokeWidth={2}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        
        {/* Quadrant Legend */}
        <div className="grid grid-cols-2 gap-2 mt-4 text-xs">
          <div className="flex items-center gap-2 p-2 rounded bg-green-50 dark:bg-green-950/20">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span className="text-muted-foreground">{quadrantLabels.topRight}: Ideal</span>
          </div>
          <div className="flex items-center gap-2 p-2 rounded bg-green-50 dark:bg-green-950/20">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span className="text-muted-foreground">{quadrantLabels.topLeft}: Good but slow</span>
          </div>
          <div className="flex items-center gap-2 p-2 rounded bg-orange-50 dark:bg-orange-950/20">
            <div className="w-3 h-3 rounded-full bg-orange-500" />
            <span className="text-muted-foreground">{quadrantLabels.bottomRight}: Fast but inaccurate</span>
          </div>
          <div className="flex items-center gap-2 p-2 rounded bg-red-50 dark:bg-red-950/20">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <span className="text-muted-foreground">{quadrantLabels.bottomLeft}: Needs improvement</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
