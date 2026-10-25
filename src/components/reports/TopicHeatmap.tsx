import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Grid3x3 } from "lucide-react";
import { cn } from "@/lib/utils";

interface HeatmapCell {
  studentId: string;
  studentName: string;
  topic: string;
  accuracy: number;
  status: "Strong" | "Average" | "Weak";
}

interface TopicHeatmapProps {
  data: HeatmapCell[];
  className?: string;
}

export function TopicHeatmap({ data, className }: TopicHeatmapProps) {
  // Group by student and topic
  const students = [...new Set(data.map(d => d.studentName))].slice(0, 10);
  const topics = [...new Set(data.map(d => d.topic))].slice(0, 8);

  const getCell = (student: string, topic: string) => {
    return data.find(d => d.studentName === student && d.topic === topic);
  };

  const getCellColor = (accuracy: number) => {
    if (accuracy >= 75) return "bg-green-500";
    if (accuracy >= 50) return "bg-amber-400";
    return "bg-red-500";
  };

  const getCellBg = (accuracy: number) => {
    if (accuracy >= 75) return "bg-green-50 dark:bg-green-950/30";
    if (accuracy >= 50) return "bg-amber-50 dark:bg-amber-950/30";
    return "bg-red-50 dark:bg-red-950/30";
  };

  if (data.length === 0) {
    return null;
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Grid3x3 className="h-4 w-4" />
          Chapter-Level Heatmap
        </CardTitle>
        <CardDescription>
          Student performance across topics (Green: ≥75%, Yellow: 50-74%, Red: &lt;50%)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="text-left p-2 font-medium text-muted-foreground sticky left-0 bg-background">
                  Student
                </th>
                {topics.map((topic, idx) => (
                  <th
                    key={idx}
                    className="p-2 font-medium text-muted-foreground text-center min-w-[80px]"
                  >
                    <span className="truncate block max-w-[80px]" title={topic}>
                      {topic}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {students.map((student, studentIdx) => (
                <tr key={studentIdx} className="border-t">
                  <td className="p-2 font-medium sticky left-0 bg-background">
                    <span className="truncate block max-w-[120px]" title={student}>
                      {student}
                    </span>
                  </td>
                  {topics.map((topic, topicIdx) => {
                    const cell = getCell(student, topic);
                    return (
                      <td key={topicIdx} className="p-1 text-center">
                        {cell ? (
                          <div
                            className={cn(
                              "rounded p-2 font-medium",
                              getCellBg(cell.accuracy)
                            )}
                            title={`${student}: ${cell.accuracy.toFixed(0)}% in ${topic}`}
                          >
                            <div
                              className={cn(
                                "w-3 h-3 rounded-full mx-auto",
                                getCellColor(cell.accuracy)
                              )}
                            />
                            <span className="text-[10px] text-muted-foreground">
                              {cell.accuracy.toFixed(0)}%
                            </span>
                          </div>
                        ) : (
                          <div className="p-2 text-muted-foreground">-</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-6 mt-4 pt-4 border-t">
          <div className="flex items-center gap-2 text-xs">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span>Strong (≥75%)</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <div className="w-3 h-3 rounded-full bg-amber-400" />
            <span>Average (50-74%)</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <span>Weak (&lt;50%)</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
