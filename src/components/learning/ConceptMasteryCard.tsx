import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Brain,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
} from "lucide-react";
import { useWeakConcepts, type ConceptMastery } from "@/hooks/useConceptMastery";

const trendIcons = {
  improving: TrendingUp,
  declining: TrendingDown,
  stable: Minus,
};

const trendColors = {
  improving: "text-green-600",
  declining: "text-red-600",
  stable: "text-gray-500",
};

interface ConceptMasteryCardProps {
  studentId?: string;
  showAll?: boolean;
}

export function ConceptMasteryCard({ studentId, showAll = false }: ConceptMasteryCardProps) {
  const { data: weakConcepts, isLoading } = useWeakConcepts(studentId);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="h-4 w-4" />
            Concept Mastery
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!weakConcepts || weakConcepts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="h-4 w-4" />
            Concept Mastery
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6">
            <div className="h-12 w-12 rounded-full bg-green-100 dark:bg-green-950 flex items-center justify-center mx-auto mb-3">
              <Brain className="h-6 w-6 text-green-600" />
            </div>
            <p className="font-medium text-green-600">Great Progress!</p>
            <p className="text-sm text-muted-foreground mt-1">
              No weak concepts detected. Keep up the good work!
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const displayConcepts = showAll ? weakConcepts : weakConcepts.slice(0, 5);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Brain className="h-4 w-4" />
          Areas to Improve
          {weakConcepts.length > 0 && (
            <Badge variant="secondary" className="ml-2">
              {weakConcepts.length}
            </Badge>
          )}
        </CardTitle>
        {weakConcepts.length > 0 && (
          <AlertTriangle className="h-4 w-4 text-amber-500" />
        )}
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {displayConcepts.map((concept) => {
            const TrendIcon = trendIcons[concept.trend];
            const masteryColor =
              concept.mastery_level < 30
                ? "bg-red-500"
                : concept.mastery_level < 50
                ? "bg-amber-500"
                : "bg-blue-500";

            return (
              <div key={concept.id} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-sm truncate">
                      {concept.topic?.topic_name || "Unknown Topic"}
                    </span>
                    <Badge variant="outline" className="text-xs flex-shrink-0">
                      {concept.subject?.name}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <TrendIcon
                      className={`h-4 w-4 ${trendColors[concept.trend]}`}
                    />
                    <span className="text-sm font-medium">
                      {concept.mastery_level}%
                    </span>
                  </div>
                </div>
                <Progress
                  value={concept.mastery_level}
                  className="h-2"
                  // @ts-ignore - custom styling
                  indicatorClassName={masteryColor}
                />
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>
                    {concept.total_questions_correct}/{concept.total_questions_attempted} correct
                  </span>
                  {concept.avg_time_per_question_seconds && (
                    <span>
                      Avg: {Math.round(concept.avg_time_per_question_seconds)}s/question
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {!showAll && weakConcepts.length > 5 && (
          <p className="text-sm text-muted-foreground text-center mt-4">
            +{weakConcepts.length - 5} more areas need attention
          </p>
        )}
      </CardContent>
    </Card>
  );
}
