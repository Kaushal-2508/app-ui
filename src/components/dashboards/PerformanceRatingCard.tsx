import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Info, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { formatNumber } from "@/lib/formatNumber";

interface PerformanceRatingCardProps {
  avgScorePercent: number;
  passRate: number;
  improvementRate: number;
  totalExamsEvaluated: number;
  isLoading?: boolean;
}

export function PerformanceRatingCard({
  avgScorePercent,
  passRate,
  improvementRate,
  totalExamsEvaluated,
  isLoading = false,
}: PerformanceRatingCardProps) {
  const [showDetails, setShowDetails] = useState(false);

  // Calculate overall performance rating (0-100)
  // Weights: Avg Score (40%), Pass Rate (35%), Improvement (25%)
  const performanceRating = calculatePerformanceRating(
    avgScorePercent,
    passRate,
    improvementRate
  );

  const ratingLabel = getRatingLabel(performanceRating);
  const ratingColor = getRatingColor(performanceRating);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            Performance Rating
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-8 w-20 bg-muted animate-pulse rounded" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Performance Rating
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 ml-auto"
                    onClick={() => setShowDetails(true)}
                  >
                    <Info className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <p className="text-sm">
                    Combined metric based on average scores (40%), pass rate (35%), 
                    and improvement trend (25%). Click for details.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <div className={`text-2xl font-bold ${ratingColor}`}>
              {performanceRating.toFixed(0)}%
            </div>
            <div className={`text-sm font-medium ${ratingColor}`}>
              {ratingLabel}
            </div>
          </div>
          <div className="flex items-center gap-1 mt-1">
            {improvementRate > 0 ? (
              <TrendingUp className="h-3 w-3 text-green-600" />
            ) : improvementRate < 0 ? (
              <TrendingDown className="h-3 w-3 text-red-600" />
            ) : (
              <Minus className="h-3 w-3 text-muted-foreground" />
            )}
            <span className="text-xs text-muted-foreground">
              {improvementRate > 0 ? "+" : ""}{improvementRate.toFixed(1)}% trend
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Details Dialog */}
      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Performance Rating Calculation</DialogTitle>
            <DialogDescription>
              Understanding how the school performance rating is calculated
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 mt-4">
            <div className="text-center p-4 bg-muted rounded-lg">
              <div className={`text-4xl font-bold ${ratingColor}`}>
                {performanceRating.toFixed(0)}%
              </div>
              <div className={`text-lg font-medium ${ratingColor}`}>
                {ratingLabel}
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="font-semibold">Metrics Breakdown:</h4>
              
              <MetricRow
                label="Average Score"
                value={avgScorePercent}
                weight={40}
                description="Mean score percentage across all evaluated exams"
              />
              
              <MetricRow
                label="Pass Rate"
                value={passRate}
                weight={35}
                description="Percentage of students meeting pass criteria"
              />
              
              <MetricRow
                label="Improvement Trend"
                value={Math.max(0, Math.min(100, 50 + improvementRate * 5))}
                weight={25}
                description="Score change compared to previous period (normalized)"
              />
            </div>

            <div className="text-xs text-muted-foreground border-t pt-3">
              <p className="font-medium mb-1">Formula:</p>
              <code className="bg-muted px-2 py-1 rounded text-xs">
                Rating = (AvgScore × 0.4) + (PassRate × 0.35) + (ImprovementIndex × 0.25)
              </code>
              <p className="mt-2">
                Based on {formatNumber(totalExamsEvaluated)} evaluated exams.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function MetricRow({
  label,
  value,
  weight,
  description,
}: {
  label: string;
  value: number;
  weight: number;
  description: string;
}) {
  return (
    <div className="flex items-center justify-between p-3 border rounded-lg">
      <div className="flex-1">
        <div className="flex items-center justify-between">
          <span className="font-medium">{label}</span>
          <span className="text-sm font-semibold">{value.toFixed(1)}%</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <div className="ml-4 text-xs bg-muted px-2 py-1 rounded">
        {weight}% weight
      </div>
    </div>
  );
}

function calculatePerformanceRating(
  avgScore: number,
  passRate: number,
  improvementRate: number
): number {
  // Normalize improvement rate: convert from -20 to +20 range to 0-100
  const normalizedImprovement = Math.max(0, Math.min(100, 50 + improvementRate * 2.5));
  
  // Calculate weighted average
  const rating = 
    avgScore * 0.4 + 
    passRate * 0.35 + 
    normalizedImprovement * 0.25;
  
  return Math.max(0, Math.min(100, rating));
}

function getRatingLabel(rating: number): string {
  if (rating >= 85) return "Excellent";
  if (rating >= 70) return "Good";
  if (rating >= 55) return "Average";
  if (rating >= 40) return "Needs Improvement";
  return "Critical";
}

function getRatingColor(rating: number): string {
  if (rating >= 85) return "text-green-600";
  if (rating >= 70) return "text-blue-600";
  if (rating >= 55) return "text-amber-600";
  if (rating >= 40) return "text-orange-600";
  return "text-red-600";
}
