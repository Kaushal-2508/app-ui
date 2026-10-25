import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface ChartDataPoint {
  name: string;
  value: number;
  [key: string]: any;
}

interface BaseChartProps {
  data: ChartDataPoint[];
  title?: string;
  description?: string;
  height?: number;
  className?: string;
  colors?: string[];
  showLegend?: boolean;
  showGrid?: boolean;
}

const defaultColors = [
  "hsl(var(--primary))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

const statusColors = {
  excellent: "#22c55e",
  good: "#3b82f6",
  developing: "#f59e0b",
  needsAttention: "#ef4444",
};

// Bar Chart
interface BarChartProps extends BaseChartProps {
  dataKeys?: string[];
  layout?: "horizontal" | "vertical";
  stacked?: boolean;
}

export function PerformanceBarChart({
  data,
  title,
  description,
  height = 300,
  className,
  colors = defaultColors,
  dataKeys = ["value"],
  layout = "horizontal",
  stacked = false,
  showLegend = dataKeys.length > 1,
  showGrid = true,
}: BarChartProps) {
  const ChartWrapper = ({ children }: { children: React.ReactNode }) =>
    title ? (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    ) : (
      <div className={className}>{children}</div>
    );

  return (
    <ChartWrapper>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={data}
          layout={layout === "vertical" ? "vertical" : "horizontal"}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        >
          {showGrid && <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />}
          {layout === "vertical" ? (
            <>
              <XAxis type="number" tick={{ fontSize: 12 }} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 12 }} width={100} />
            </>
          ) : (
            <>
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
            </>
          )}
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
            }}
          />
          {showLegend && <Legend />}
          {dataKeys.map((key, index) => (
            <Bar
              key={key}
              dataKey={key}
              fill={colors[index % colors.length]}
              radius={[4, 4, 0, 0]}
              stackId={stacked ? "stack" : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartWrapper>
  );
}

// Line Chart
interface LineChartProps extends BaseChartProps {
  dataKeys?: string[];
  curved?: boolean;
  showDots?: boolean;
  showArea?: boolean;
}

export function PerformanceLineChart({
  data,
  title,
  description,
  height = 300,
  className,
  colors = defaultColors,
  dataKeys = ["value"],
  curved = true,
  showDots = true,
  showArea = false,
  showLegend = dataKeys.length > 1,
  showGrid = true,
}: LineChartProps) {
  const ChartWrapper = ({ children }: { children: React.ReactNode }) =>
    title ? (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    ) : (
      <div className={className}>{children}</div>
    );

  const ChartComponent = showArea ? AreaChart : LineChart;

  return (
    <ChartWrapper>
      <ResponsiveContainer width="100%" height={height}>
        <ChartComponent data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          {showGrid && <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />}
          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
            }}
          />
          {showLegend && <Legend />}
          {dataKeys.map((key, index) => (
            showArea ? (
              <Area
                key={key}
                type={curved ? "monotone" : "linear"}
                dataKey={key}
                stroke={colors[index % colors.length]}
                fill={colors[index % colors.length]}
                fillOpacity={0.2}
                dot={showDots}
              />
            ) : (
              <Line
                key={key}
                type={curved ? "monotone" : "linear"}
                dataKey={key}
                stroke={colors[index % colors.length]}
                strokeWidth={2}
                dot={showDots}
              />
            )
          ))}
        </ChartComponent>
      </ResponsiveContainer>
    </ChartWrapper>
  );
}

// Pie/Donut Chart
interface PieChartProps extends BaseChartProps {
  donut?: boolean;
  showLabels?: boolean;
  labelType?: "name" | "value" | "percent" | "namePercent";
}

export function PerformancePieChart({
  data,
  title,
  description,
  height = 300,
  className,
  colors = defaultColors,
  donut = false,
  showLabels = true,
  labelType = "namePercent",
  showLegend = true,
}: PieChartProps) {
  const ChartWrapper = ({ children }: { children: React.ReactNode }) =>
    title ? (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    ) : (
      <div className={className}>{children}</div>
    );

  const total = data.reduce((sum, item) => sum + item.value, 0);

  const renderLabel = ({ name, value, percent }: any) => {
    switch (labelType) {
      case "name":
        return name;
      case "value":
        return value;
      case "percent":
        return `${(percent * 100).toFixed(0)}%`;
      case "namePercent":
      default:
        return `${name}: ${(percent * 100).toFixed(0)}%`;
    }
  };

  return (
    <ChartWrapper>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={donut ? "60%" : 0}
            outerRadius="80%"
            paddingAngle={2}
            dataKey="value"
            label={showLabels ? renderLabel : false}
            labelLine={showLabels}
          >
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
            }}
          />
          {showLegend && <Legend />}
        </PieChart>
      </ResponsiveContainer>
      {donut && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <p className="text-2xl font-bold">{total}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </div>
        </div>
      )}
    </ChartWrapper>
  );
}

// Distribution Chart (special bar chart for score distributions)
interface DistributionChartProps extends BaseChartProps {
  thresholds?: { label: string; value: number; color: string }[];
}

export function DistributionChart({
  data,
  title,
  description,
  height = 200,
  className,
  thresholds,
}: DistributionChartProps) {
  // Color bars based on performance thresholds
  const coloredData = data.map((item) => ({
    ...item,
    fill:
      item.value >= 85
        ? statusColors.excellent
        : item.value >= 65
        ? statusColors.good
        : item.value >= 50
        ? statusColors.developing
        : statusColors.needsAttention,
  }));

  return (
    <Card className={className}>
      {title && (
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={coloredData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
              }}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {coloredData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        {thresholds && (
          <div className="flex flex-wrap gap-3 mt-3 justify-center">
            {thresholds.map((t) => (
              <div key={t.label} className="flex items-center gap-1.5 text-xs">
                <div
                  className="w-3 h-3 rounded-sm"
                  style={{ backgroundColor: t.color }}
                />
                <span className="text-muted-foreground">{t.label}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Export all chart types
export { statusColors };
